require('dotenv').config();

const path = require("path");
const express = require("express");
const session = require('express-session');
const { passport, setupAuthRoutes } = require('./config/connexion');
const {
  ensureAuth,
  resilience,
  repair,
  checker,
  security,
  reauth,
  requestLogger,
  errorHandler,
  shuffleArray,
  generateDuelQuiz,
  getRandomUserWords,
  getCommonWords,
  updateWordScore,
  addTransaction
} = require('./middleware/index');
const PostgreSQLStore = require('connect-pg-simple')(session);
const apiRoutes = require('./routes/api');
const { pool } = require('./config/database');


const app = express();
app.set('trust proxy', 1); // Pour les déploiements derrière un proxy (Heroku, Render, etc.)
console.log("Callback URL utilisée :", process.env.GOOGLE_CALLBACK_URL
);


// -------------------- Configuration Express --------------------
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(session({
  store: new PostgreSQLStore({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true,
    pruneSessionInterval: false, // Désactiver le nettoyage auto
    ttl: 7 * 24 * 60 * 60 // 7 jours en secondes
  }),
  secret: process.env.SESSION_SECRET || require('crypto').randomBytes(64).toString('hex'),
  name: 'jiayou.sid',
  resave: false, // ⬅️ IMPORTANT: false pour PostgreSQL
  saveUninitialized: false, // ⬅️ IMPORTANT: false pour la sécurité
  rolling: false, // ⬅️ false pour plus de stabilité
  cookie: {
    secure: true, // ⬅️ true pour HTTPS
    httpOnly: true, // ⬅️ empêcher l'accès JS
    maxAge: 7 * 24 * 60 * 60 * 1000, // 1 semaine
    sameSite: 'lax',
  }
}));
setupAuthRoutes(app);
app.use(resilience);
app.use(repair);
app.use(checker);
app.use(security);
app.use(reauth);
app.use(requestLogger);
app.use("/", apiRoutes);
app.use(async (req, res, next) => {
  if (req.session && req.session.userId) {
    try {
      res.locals.balance = await getUserBalance(req.session.userId);
    } catch {
      res.locals.balance = 0;
    }
  } else {
    res.locals.balance = 0;
  }
  next();
});

// Connexion google
app.get("/auth/google", 
  (req, res, next) => {
    // Sauvegarde l'URL de retour
    if (req.query.returnTo) {
      req.session.returnTo = req.query.returnTo;
    }
    next();
  },
  passport.authenticate("google", { 
    scope: ["profile", "email"],
    prompt: "select_account" // ← Laisse l'utilisateur choisir son compte
  })
);

app.get("/auth/google/callback",
  passport.authenticate("google", { 
    failureRedirect: "/?error=auth_failed"
  }),
  (req, res) => {
    console.log("AUTH OK - USER :", req.user); // 👈 ajoute ça
    console.log("📡 Passport callback déclenché");
    console.log("➡️ URL callback reçue :", req.originalUrl);
    // Forcer la sauvegarde de la session AVANT redirection
    req.session.save((err) => {
      if (err) {
        console.error('❌ Erreur sauvegarde session:', err);
        return res.redirect('/?error=session_error');
      }
      
      console.log('💾 Session sauvegardée, redirection...');
      const returnTo = req.session.returnTo || '/dashboard';
      delete req.session.returnTo;
      
      res.redirect(returnTo);
    });
  }
);

app.post("/auth/google/one-tap", async (req, res) => {
  const transaction = await pool.connect();
  
  try {
    const { credential } = req.body;
    console.log('🔐 Google One Tap token reçu');
    
    if (!credential) {
      return res.status(400).json({ 
        success: false, 
        error: 'Token manquant' 
      });
    }

    const ticket = await Client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    const { sub: googleId, name, email } = payload;

    await transaction.query('BEGIN');

    let userRes = await transaction.query(
      `SELECT id, email, name, provider_id FROM users 
       WHERE provider_id = $1 OR email = $2 
       ORDER BY CASE WHEN provider_id = $1 THEN 1 ELSE 2 END 
       LIMIT 1`,
      [googleId, email]
    );

    let isNewUser = false;
    let user;

    if (userRes.rows.length === 0) {
      userRes = await transaction.query(
        `INSERT INTO users (email, name, provider, provider_id, last_login) 
         VALUES ($1, $2, 'google', $3, NOW()) 
         RETURNING id, email, name`,
        [email, name, googleId]
      );
      user = userRes.rows[0];
      isNewUser = true;
    } else {
      user = userRes.rows[0];
      await transaction.query(
        'UPDATE users SET last_login = NOW() WHERE id = $1',
        [user.id]
      );
    }

    await transaction.query('COMMIT');

    // Modification ici : Utiliser login() de Passport
    req.login(user, async (err) => {
      if (err) {
        console.error('❌ Erreur login Passport:', err);
        return res.status(500).json({ success: false, error: 'Erreur authentification' });
      }

      // Puis sauvegarder la session
      req.session.save((err) => {
        if (err) {
          console.error('❌ Erreur sauvegarde session:', err);
          return res.status(500).json({ success: false, error: 'Erreur session' });
        }

        console.log('✅ Session créée avec succès:', req.session);
        res.json({ 
          success: true, 
          redirect: '/dashboard',
          user: { 
            id: user.id,
            name: user.name,
            email: user.email,
            isNewUser: isNewUser
          }
        });
      });
    });

  } catch (err) {
    await transaction.query('ROLLBACK');
    console.error('❌ Erreur Google One Tap:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    transaction.release();
  }
});

app.post('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('❌ Erreur déconnexion:', err);
    }
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });
});


// Cookies
// Test de durée réelle de session
app.get('/session-timeout-test', (req, res) => {
  console.log('=== ⏰ SESSION TIMEOUT TEST ===');
  console.log('Session ID:', req.sessionID);
  console.log('Session data:', req.session);
  
  if (!req.session.testStart) {
    req.session.testStart = new Date().toISOString();
    req.session.accessCount = 0;
    console.log('🆕 Nouvelle session créée');
  }
  
  req.session.accessCount++;
  req.session.lastAccess = new Date().toISOString();
  
  const sessionAge = Math.floor((new Date() - new Date(req.session.testStart)) / 1000);
  
  req.session.save((err) => {
    if (err) {
      console.error('❌ Session save error:', err);
      return res.json({ error: 'Session save failed' });
    }
    
    console.log(`✅ Session sauvegardée (âge: ${sessionAge}s, accès: ${req.session.accessCount})`);
    
    res.json({
      sessionID: req.sessionID,
      sessionAge: sessionAge + ' seconds',
      accessCount: req.session.accessCount,
      testStart: req.session.testStart,
      lastAccess: req.session.lastAccess,
      user: req.user,
      isAuthenticated: req.isAuthenticated()
    });
  });
});

app.get('/force-session-cookie', (req, res) => {
  console.log('=== 🚀 FORCE SESSION COOKIE ===');
  
  // Forcer la régénération du cookie de session
  req.session.regenerate((err) => {
    if (err) {
      console.error('❌ Regenerate error:', err);
      return res.json({ error: 'Regenerate failed' });
    }
    
    console.log('✅ Session régénérée:', req.sessionID);
    
    // SET le cookie manuellement
    res.cookie('jiayou.sid', req.sessionID, {
      secure: true,
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    });
    
    req.session.testValue = 'forced_session';
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('❌ Session save error:', saveErr);
      }
      
      console.log('Headers Set-Cookie:', res.getHeaders()['set-cookie']);
      
      res.json({
        message: 'Session cookie forcé',
        sessionID: req.sessionID,
        setCookies: res.getHeaders()['set-cookie']
      });
    });
  });
});

app.get('/session-persistence-test', (req, res) => {
  console.log('=== 🧪 SESSION PERSISTENCE TEST ===');
  console.log('URL:', req.url);
  console.log('Session ID:', req.sessionID);
  console.log('req.user:', req.user);
  console.log('req.isAuthenticated():', req.isAuthenticated());
  console.log('Cookies reçus:', req.headers.cookie);
  
  // Compter les visites
  if (!req.session.visitCount) {
    req.session.visitCount = 1;
  } else {
    req.session.visitCount++;
  }
  
  req.session.lastVisit = new Date().toISOString();
  
  req.session.save((err) => {
    if (err) {
      console.error('❌ Erreur sauvegarde session:', err);
    }
    
    res.json({
      sessionID: req.sessionID,
      visitCount: req.session.visitCount,
      user: req.user,
      isAuthenticated: req.isAuthenticated(),
      cookies: req.headers.cookie
    });
  });
});

// Route pour inspecter la session
app.get('/api/debug-session', (req, res) => {
  console.log('=== SESSION COMPLETE ===');
  console.log('Session ID:', req.sessionID);
  console.log('Session data:', req.session);
  console.log('========================');
  
  res.json({
    sessionId: req.sessionID,
    sessionData: req.session,
    userId: req.session.userId,
    user: req.session.user
  });
});



// Pages EJS
app.get("/", (req, res) => {
    const error = req.query.error;  // <-- récupère l'erreur depuis la query string
  if (req.user) {
    res.redirect("dashboard");
  } else {
    res.render("index", { user: req.user, error});
  }
});

app.get('/index', (req, res) => {
  res.redirect('/');
});

app.get('/dashboard', ensureAuth, async (req, res) => {
  const userId = req.user.id; 

  try {
    const userRes = await pool.query('SELECT name FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0] || {};
    const userData = {
      name: user.name || 'Friend'
    };

    console.log('📊 Rendering dashboard with:', { userData, currentPage: 'dashboard' });

    res.render('dashboard', {
      userData: userData,
      currentPage: 'dashboard'
    });

  } catch (err) {
    console.error("❌ Dashboard error:", err);
    res.status(500).send("Erreur serveur");
  }
});

app.get('/account-info', ensureAuth, async (req, res) => {
  // Permet de récupérer les données d'un autre utilisateur si user_id est fourni
  const targetUserId = req.query.user_id || req.user.id;
  const currentUserId = req.user.id;
  
  console.log('🎯 /account-info appelé:', { targetUserId, currentUserId });
  
  try {
    // Vérifier que l'utilisateur a le droit d'accéder à ces données
    // (optionnel: pour restreindre l'accès aux données sensibles)
    
    // 1. Récupérer les infos utilisateur
    const userInfo = await pool.query(`
      SELECT name FROM users WHERE id = $1
    `, [targetUserId]);

    if (userInfo.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // 2. Récupérer les mots avec leurs scores et niveau HSK
    const userMots = await pool.query(`
      SELECT 
        user_mots.score,
        user_mots.mot_id,
        mots.chinese, 
        mots.pinyin, 
        mots.english,
        mots.hsk
      FROM user_mots 
      JOIN mots ON user_mots.mot_id = mots.id 
      WHERE user_mots.user_id = $1
    `, [targetUserId]);
    
    // 3. Calculer les stats HSK
    const hskStats = {
      HSK1: 0,
      HSK2: 0,
      HSK3: 0,
      HSK4: 0,
      HSK5: 0,
      HSK6: 0,
      Street: 0
    };

    userMots.rows.forEach(mot => {
      if (mot.hsk) {
        hskStats[`HSK${mot.hsk}`] = (hskStats[`HSK${mot.hsk}`] || 0) + 1;
      } else {
        hskStats.Street++;
      }
    });

    // 4. Récupérer les stats quiz/duels
    const quizStats = await pool.query(`
      SELECT COUNT(*) as total_quizzes
      FROM quiz_history 
      WHERE user_id = $1
    `, [targetUserId]);
    
    const duelStats = await pool.query(`
      SELECT COUNT(*) as total_duels
      FROM duels 
      WHERE challenger_id = $1 OR opponent_id = $1
    `, [targetUserId]);
    
    // Construire la réponse
    const response = {
      name: userInfo.rows[0].name,
      wordCount: userMots.rows.length,
      user_mots: userMots.rows,
      stats: {
        ...hskStats,
        total_quizzes: parseInt(quizStats.rows[0].total_quizzes),
        total_duels: parseInt(duelStats.rows[0].total_duels)
      }
    };

    console.log('✅ /account-info réponse:', {
      name: response.name,
      wordCount: response.wordCount,
      totalQuizzes: response.stats.total_quizzes,
      totalDuels: response.stats.total_duels
    });
    
    res.json(response);
    
  } catch (err) {
    console.error('❌ Erreur /account-info:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/collection', ensureAuth, async (req, res) => {
  const userId = req.user.id;
  const cardIndex = parseInt(req.query.card) || 0;

  try {
    const { rows } = await pool.query(`
      SELECT mots.* FROM mots
      JOIN user_mots ON mots.id = user_mots.mot_id
      WHERE user_mots.user_id = $1
      ORDER BY mots.id ASC
    `, [userId]);

    // Réorganiser les mots pour commencer à l'index demandé
    const sortedWords = [...rows.slice(cardIndex), ...rows.slice(0, cardIndex)];

    res.render('collection', {
      words: sortedWords,
      currentPage: 'collection'
    });
  } catch (err) {
    console.error('Collection error:', err);
    res.status(500).send('Server error');
  }
});

app.get('/quiz-pinyin', ensureAuth, (req, res) => {
  res.render('quiz-pinyin', {
    currentPage: 'quiz-pinyin',
    user: req.user
  });
});

app.get('/quiz-character', ensureAuth, (req, res) => {
  res.render('quiz-character', {
    currentPage: 'quiz-character', 
    user: req.user
  });
});

app.get('/account', ensureAuth, (req, res) => {
  res.render('account', {
    currentPage: 'account',
    user: req.user
  });
});

app.get('/quiz', ensureAuth, (req, res) => {
  res.render('quiz', {
    currentPage: 'quiz',
    user: req.user
  });
});

app.get('/duels', ensureAuth, (req, res) => {
  res.render('duels', {
    currentPage: 'duels',
    user: req.user
  });
});

app.get('/duel-play/:id', ensureAuth, async (req, res) => {
  try {
    const duelId = req.params.id;
    
    // Vérifier que l'utilisateur peut jouer ce duel
    const duelResult = await pool.query(`
      SELECT d.*, 
             u1.name as challenger_name,
             u2.name as opponent_name
      FROM duels d
      JOIN users u1 ON d.challenger_id = u1.id
      JOIN users u2 ON d.opponent_id = u2.id
      WHERE d.id = $1 AND (d.challenger_id = $2 OR d.opponent_id = $2)
      AND d.status = 'pending'
      AND d.expires_at > NOW()
    `, [duelId, req.user.id]);

    if (duelResult.rows.length === 0) {
      return res.redirect('/duels?error=duel_not_found');
    }

    const duel = duelResult.rows[0];
    const isChallenger = duel.challenger_id === req.user.id;
    
    // Vérifier si l'utilisateur a déjà joué
    const userScore = isChallenger ? duel.challenger_score : duel.opponent_score;
    
    if (userScore !== null) {
      return res.render('duel-waiting', {
        duel: duel,
        userScore: userScore,
        currentPage: 'duels',
        user: req.user // 🔥 AJOUTÉ ICI
      });
    }

    res.render('duel-play', {
      duel: duel,
      quizData: duel.quiz_data,
      currentPage: 'duels',
      user: req.user // 🔥 AJOUTÉ ICI
    });

  } catch (err) {
    console.error('Erreur page duel:', err);
    res.redirect('/duels?error=server_error');
  }
});

app.get('/duel/:id', ensureAuth, async (req, res) => {
  try {
    const duelId = req.params.id;
    const userId = req.user.id;

    const duelResult = await pool.query(`
      SELECT 
        d.*,
        c.name as challenger_name,
        c.email as challenger_email,
        o.name as opponent_name, 
        o.email as opponent_email
      FROM duels d
      LEFT JOIN users c ON d.challenger_id = c.id
      LEFT JOIN users o ON d.opponent_id = o.id
      WHERE d.id = $1 AND (d.challenger_id = $2 OR d.opponent_id = $2)
    `, [duelId, userId]);

    if (duelResult.rows.length === 0) {
      return res.status(404).render('error', { message: 'Duel non trouvé' });
    }

    const duel = duelResult.rows[0];
    
    console.log('🔍 Duel trouvé:', duel.id);
    console.log('📊 quiz_data brut:', duel.quiz_data);
    
    // Parse les données du quiz - CORRECTION ICI
    let quizData = [];
    if (duel.quiz_data) {
      try {
        let parsedData = typeof duel.quiz_data === 'string' 
          ? JSON.parse(duel.quiz_data) 
          : duel.quiz_data;
        
        // ⬅️ EXTRACTION DES MOTS DEPUIS LA STRUCTURE
        if (parsedData.words && Array.isArray(parsedData.words)) {
          quizData = parsedData.words;
          console.log('✅ Mots extraits de quiz_data.words:', quizData.length);
        } else if (Array.isArray(parsedData)) {
          // Ancien format où les mots sont directement dans l'array
          quizData = parsedData;
          console.log('✅ Mots dans array direct:', quizData.length);
        } else {
          console.log('❌ Structure inconnue de quiz_data');
        }
        
      } catch (e) {
        console.error('❌ Erreur parsing quiz_data:', e);
      }
    }

    console.log('📝 quizData final:', quizData.length, 'mots');

    res.render('duel-detail', {
      currentPage: 'duels',
      user: req.user,
      duel: duel,
      quizData: quizData,
      isChallenger: duel.challenger_id === userId
    });

  } catch (error) {
    console.error('Erreur détail duel:', error);
    res.status(500).render('error', { message: 'Erreur serveur' });
  }
});

app.get('/user/:id', ensureAuth, async (req, res) => {
  try {
    const userId = req.params.id;
    const currentUserId = req.user.id;

    console.log('🎯 Route /user/:id appelée avec:', { userId, currentUserId });

    // Récupérer les infos de l'utilisateur
    const userResult = await pool.query(`
      SELECT id, name, email, created_at
      FROM users 
      WHERE id = $1
    `, [userId]);

    console.log('📊 Résultat query user:', userResult.rows);

    if (userResult.rows.length === 0) {
      console.log('❌ Utilisateur non trouvé');
      return res.status(404).send(`
        <div class="alert alert-warning">
          Utilisateur non trouvé
          <a href="/duels">Retour aux duels</a>
        </div>
      `);
    }

    const user = userResult.rows[0];
    console.log('✅ Utilisateur trouvé:', user.name);

    // 🗳️ CORRECTION : Requête sans la table quizzes qui n'existe pas
    const statsResult = await pool.query(`
      SELECT 
        COUNT(DISTINCT um.mot_id) as total_words,
        COUNT(DISTINCT d.id) as total_duels
      FROM users u
      LEFT JOIN user_mots um ON u.id = um.user_id
      LEFT JOIN duels d ON (u.id = d.challenger_id OR u.id = d.opponent_id)
      WHERE u.id = $1
      GROUP BY u.id
    `, [userId]);

    const stats = statsResult.rows[0] || {};
    console.log('📈 Stats récupérées:', stats);

    // Récupérer la répartition HSK
    const hskResult = await pool.query(`
      SELECT 
        CASE 
          WHEN m.hsk IS NULL THEN 'Street' 
          ELSE 'HSK ' || m.hsk::text 
        END as level,
        COUNT(*) as count
      FROM user_mots um
      JOIN mots m ON um.mot_id = m.id
      WHERE um.user_id = $1
      GROUP BY CASE WHEN m.hsk IS NULL THEN 'Street' ELSE 'HSK ' || m.hsk::text END
      ORDER BY level
    `, [userId]);

    console.log('🎯 Données HSK:', hskResult.rows);

    res.render('user-profile', {
      currentPage: 'duels',
      user: req.user,
      profileUser: user,
      stats: stats,
      hskStats: hskResult.rows,
      isOwnProfile: userId == currentUserId
    });

  } catch (error) {
    console.error('💥 ERREUR COMPLÈTE /user/:id:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Erreur</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"></head>
      <body class="container mt-5">
        <div class="alert alert-danger">
          <h4>Erreur serveur</h4>
          <p>${error.message}</p>
          <a href="/duels" class="btn btn-primary">Retour aux duels</a>
        </div>
      </body>
      </html>
    `);
  }
});

app.get('/leaderboard', ensureAuth, async (req, res) => {
  try {
    console.log('📄 Chargement page classement pour:', req.user.name);
    res.render('leaderboard', {  // ← SUPPRIME 'players/'
      user: req.user,
      title: 'Classement des Joueurs - Jiayou'
    });
  } catch (err) {
    console.error('❌ Erreur page classement:', err);
    res.status(500).render('error', { error: 'Erreur chargement page' });
  }
});

app.use(errorHandler);

// -------------------- Lancer serveur --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));