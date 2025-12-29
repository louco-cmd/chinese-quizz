require('dotenv').config();

const path = require("path");
const express = require("express");
const session = require('express-session');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
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
const { sendVerificationEmail } = require('./middleware/mail.service');

const PostgreSQLStore = require('connect-pg-simple')(session);
const apiRoutes = require('./routes/api');
const { pool } = require('./config/database');


const app = express();
app.set('trust proxy', 1); // Pour les déploiements derrière un proxy (Heroku, Render, etc.)
console.log("Callback URL utilisée :", process.env.GOOGLE_CALLBACK_URL
);

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    error: 'Too many attempts, try later'
  }
});


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
  resave: true, // ⬅️ IMPORTANT: false pour PostgreSQL
  saveUninitialized: false, // ⬅️ IMPORTANT: false pour la sécurité
  rolling: false, // ⬅️ false pour plus de stabilité
  cookie: {
    secure: false, // ⬅️ true pour HTTPS
    httpOnly: true, // ⬅️ empêcher l'accès JS
    maxAge: 7 * 24 * 60 * 60 * 1000, // 1 semaine
    sameSite: 'lax',
  }
}));
app.use('/auth', authLimiter);
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
      `SELECT id, email, name, provider_id, balance FROM users 
       WHERE provider_id = $1 OR email = $2 
       ORDER BY CASE WHEN provider_id = $1 THEN 1 ELSE 2 END 
       LIMIT 1`,
      [googleId, email]
    );

    let isNewUser = false;
    let user;

    if (userRes.rows.length === 0) {
      // 🆕 NOUVEL UTILISATEUR - DONNER 100 PIÈCES
      userRes = await transaction.query(
        `INSERT INTO users (email, name, provider, provider_id, last_login, balance) 
         VALUES ($1, $2, 'google', $3, NOW(), 100)  -- ✅ 100 pièces pour les nouveaux
         RETURNING id, email, name, balance`,
        [email, name, googleId]
      );
      user = userRes.rows[0];
      isNewUser = true;
      console.log(`🎉 Nouvel utilisateur One Tap créé avec ${user.balance} pièces`);
    } else {
      user = userRes.rows[0];
      await transaction.query(
        'UPDATE users SET last_login = NOW() WHERE id = $1',
        [user.id]
      );
    }

    await transaction.query('COMMIT');

    req.login(user, async (err) => {
      if (err) {
        console.error('❌ Erreur login Passport:', err);
        return res.status(500).json({ success: false, error: 'Erreur authentification' });
      }

      req.session.save((err) => {
        if (err) {
          console.error('❌ Erreur sauvegarde session:', err);
          return res.status(500).json({ success: false, error: 'Erreur session' });
        }

        console.log('✅ Session créée avec succès. Balance:', user.balance);
        res.json({
          success: true,
          redirect: '/dashboard',
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            balance: user.balance,
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

// connexion normale
/* const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many signups, try later' }
}); */

app.post('/auth/signup-basic', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        error: 'Mot de passe : 8 caractères min, 1 majuscule, 1 chiffre'
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const userRes = await pool.query(
      `INSERT INTO users (email, password_hash, provider, email_verified, balance)
       VALUES ($1, $2, 'local', false, 100)
       RETURNING id, email`,
      [email, hash]
    );

    const user = userRes.rows[0];

    // 🔐 token email
    const token = generateToken();

    await pool.query(
      `INSERT INTO email_verification_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
      [user.id, token]
    );

    // 📧 envoyer mail
    await sendVerificationEmail(user.email, token);

    res.json({
      success: true,
      message: 'Verification email sent'
    });

  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email déjà utilisé' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/auth/login-basic', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      'SELECT id, email, password_hash, email_verified FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    if (!user.email_verified) {
      return res.status(403).json({
        error: 'Please verify your email first'
      });
    }

    if (!user.password_hash) {
      return res.status(401).json({ error: 'Use Google to sign in' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.login(user, err => {
      if (err) {
        return res.status(500).json({ error: 'Login failed' });
      }

      res.json({
        success: true,
        redirect: '/dashboard'
      });
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/auth/check-email', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    const result = await pool.query(
      'SELECT email, password_hash, provider FROM users WHERE email = $1',
      [email]
    );

    // Aucun compte
    if (result.rows.length === 0) {
      return res.json({ step: 'signup' });
    }

    const user = result.rows[0];

    // Compte Google uniquement
    if (!user.password_hash && user.provider === 'google') {
      return res.json({ step: 'google_only' });
    }

    // Compte email + mot de passe
    return res.json({ step: 'login' });

  } catch (err) {
    console.error('check-email error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/auth/verify-email', async (req, res) => {
  const { token } = req.query;

  const result = await pool.query(
    `SELECT * FROM email_verification_tokens
     WHERE token = $1 AND expires_at > NOW()`,
    [token]
  );

  if (result.rows.length === 0) {
    return res.send('Invalid or expired token');
  }

  const { user_id } = result.rows[0];

  await pool.query(
    `UPDATE users SET email_verified = true WHERE id = $1`,
    [user_id]
  );

  await pool.query(
    `DELETE FROM email_verification_tokens WHERE user_id = $1`,
    [user_id]
  );

  res.redirect('/?verified=true');
});



// Pages EJS
app.get('/', (req, res) => {
  const error = req.query.error;
  if (req.user) {
    res.redirect('/dashboard');
  } else {
    res.render('index', {
      user: req.user,
      error: error,
      // Assure-toi de passer le GOOGLE_CLIENT_ID
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID
    });
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

app.get('/quiz-play', ensureAuth, (req, res) => {
  res.render('quiz-play', {
    currentPage: 'quiz-play',
    user: req.user
  });
});

app.get('/duels', ensureAuth, (req, res) => {
  res.render('duels', {
    currentPage: 'duels',
    user: req.user
  });
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

    // Récupérer les infos de l'utilisateur AVEC pays et tagline
    const userResult = await pool.query(`
      SELECT id, name, email, created_at, country, tagline, balance
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

    // Stats
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

    res.render('user-profile', {
      currentPage: 'duels',
      user: req.user,
      profileUser: user,
      stats: stats,
      hskStats: hskResult.rows,
      isOwnProfile: userId == currentUserId,
      balance: user.balance || 0  // ← AJOUTE CETTE LIGNE
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

app.get('/bank', ensureAuth, async (req, res) => {
  try {
    console.log('🏦 Chargement page compte bancaire pour user:', req.user.id);

    res.render('bank', {
      user: req.user,
      title: 'Mon Compte - 加油！',
      currentPage: 'bank'
    });

  } catch (err) {
    console.error('❌ Erreur chargement page bank:', err);
    res.status(500).render('error', { error: 'Erreur lors du chargement de la page' });
  }
});

// Route pour JOUER un duel (page de quiz)
app.get('/duel-play/:id', ensureAuth, async (req, res) => {
  try {
    const duelId = req.params.id;
    const userId = req.user.id;

    console.log('🎯 Route /duel-play/:id appelée avec:', { duelId, userId });

    // Récupérer les infos du duel
    const duelResult = await pool.query(`
      SELECT 
        d.*,
        c.name as challenger_name,
        o.name as opponent_name
      FROM duels d
      LEFT JOIN users c ON d.challenger_id = c.id
      LEFT JOIN users o ON d.opponent_id = o.id
      WHERE d.id = $1 AND (d.challenger_id = $2 OR d.opponent_id = $2)
    `, [duelId, userId]);

    if (duelResult.rows.length === 0) {
      return res.status(404).render('error', { message: 'Duel non trouvé' });
    }

    const duel = duelResult.rows[0];

    // Vérifier que l'utilisateur peut jouer (n'a pas déjà joué)
    const isChallenger = duel.challenger_id === userId;
    const userScore = isChallenger ? duel.challenger_score : duel.opponent_score;

    if (userScore !== null) {
      console.log('❌ Utilisateur a déjà joué, redirection vers détail');
      return res.redirect(`/duel/${duelId}`);
    }

    console.log('📊 quiz_data brut:', duel.quiz_data);

    // Parse les données du quiz
    let quizData = [];
    if (duel.quiz_data) {
      try {
        let parsedData = typeof duel.quiz_data === 'string'
          ? JSON.parse(duel.quiz_data)
          : duel.quiz_data;

        // Extraction des mots
        if (parsedData.words && Array.isArray(parsedData.words)) {
          quizData = { words: parsedData.words }; // Structure attendue par le frontend
          console.log('✅ Mots extraits de quiz_data.words:', quizData.words.length);
        } else if (Array.isArray(parsedData)) {
          // Ancien format
          quizData = { words: parsedData };
          console.log('✅ Mots dans array direct:', quizData.words.length);
        } else {
          console.log('❌ Structure inconnue de quiz_data');
          quizData = { words: [] };
        }

      } catch (e) {
        console.error('❌ Erreur parsing quiz_data:', e);
        quizData = { words: [] };
      }
    }

    console.log('📝 quizData final:', quizData.words ? quizData.words.length : 0, 'mots');

    // Rendre le template de jeu de duel
    res.render('duel-play', {
      currentPage: 'duels',
      user: req.user,
      duel: duel,
      quizData: quizData,  // Doit être un objet avec propriété "words"
      isChallenger: isChallenger
    });

  } catch (error) {
    console.error('💥 ERREUR /duel-play/:id:', error);
    res.status(500).render('error', { message: 'Erreur serveur' });
  }
});

// Route pour afficher la page store
app.get('/store', ensureAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT balance FROM users WHERE id = $1',
      [req.user.id]
    );

    res.render('store', {
      user: {
        ...req.user,
        balance: rows[0].balance
      }
    });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).send('Erreur serveur');
  }
});

app.use(errorHandler);



// -------------------- Lancer serveur --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));