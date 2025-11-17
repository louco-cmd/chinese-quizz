

const { Pool } = require("pg");
const path = require("path");
const express = require("express");
const passport = require("passport");
const session = require('express-session');
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { OAuth2Client } = require('google-auth-library');

const app = express();
app.set('trust proxy', 1); // Pour les déploiements derrière un proxy (Heroku, Render, etc.)

// -------------------- Connexion PostgreSQL --------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// -------------------- Configuration Express --------------------
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// -------------------- Session Cloud Optimisée --------------------
const PostgreSQLStore = require('connect-pg-simple')(session);

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

// Middleware pour s'assurer que les cookies sont set
app.use((req, res, next) => {
  console.log('🍪 Cookies reçus:', req.headers.cookie);
  console.log('🔐 Session ID:', req.sessionID);
  next();
});
// 🛡️ MIDDLEWARE DE RÉSILIENCE CLOUD
app.use((req, res, next) => {
  // Log de debug
  console.log('🌐 Session Check:', {
    id: req.sessionID?.substring(0, 8),
    hasSession: !!req.session,
    hasUser: !!req.user,
    cookies: req.headers.cookie ? 'present' : 'missing'
  });

  // Sauvegarde automatique après chaque requête
  const originalEnd = res.end;
  res.end = function(...args) {
    if (req.session && typeof req.session.save === 'function') {
      req.session.save((err) => {
        if (err) {
          console.error('❌ Erreur sauvegarde session:', err);
        }
        originalEnd.apply(this, args);
      });
    } else {
      originalEnd.apply(this, args);
    }
  };
  
  next();
});
// 🔧 RÉPARATEUR DE SESSIONS CORROMPUES
app.use((req, res, next) => {
  if (req.session && !req.session.initialized) {
    req.session.initialized = true;
    req.session.createdAt = new Date().toISOString();
  }
  
  // Réparer les sessions Passport corrompues
  if (req.session && req.session.passport && !req.user) {
    console.log('🔄 Tentative de réparation session...');
    // La désérialisation se fera automatiquement
  }
  
  next();
});

// 🧪 VÉRIFICATEUR DE SESSION EN TEMPS RÉEL
app.use((req, res, next) => {
  console.log('🔍 Session State:', {
    id: req.sessionID?.substring(0, 8),
    exists: !!req.session,
    user: req.user?.id || 'none',
    cookies: req.headers.cookie ? req.headers.cookie.length + ' chars' : 'none',
    url: req.url
  });
  next();
});

// -------------------- Initialisation Passport --------------------
app.use(passport.initialize());
app.use(passport.session());


// -------------------- Initialisation des tables --------------------
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mots (
        id SERIAL PRIMARY KEY,
        chinese TEXT NOT NULL,
        english TEXT NOT NULL,
        pinyin TEXT,
        description TEXT,
        hsk TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        provider TEXT NOT NULL,
        provider_id TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP

      )
    `);

    // Table quiz_history nécessaire pour les contributions / historique quiz
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiz_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        score INTEGER,
        total_questions INTEGER,
        ratio NUMERIC,
        quiz_type TEXT,
        words_used JSONB,
        date_completed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

       // 🆕 TABLE SESSION OBLIGATOIRE POUR connect-pg-simple
    await pool.query(`
      CREATE TABLE IF NOT EXISTS session (
        sid VARCHAR NOT NULL COLLATE "default",
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL
      )
    `);

      await pool.query(`
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" 
      ON session ("expire")
    `);
    
    console.log("✅ Table 'session' vérifiée ou créée.");

    
    console.log("✅ Tables 'mots' et 'users' vérifiées ou créées.");
  } catch (err) {
    console.error("❌ Erreur lors de l'initialisation :", err);
  }
})();

// -------------------- Serialize / Deserialize DEBUG --------------------
// 🔐 PASSPORT POUR CLOUD - VERSION STABLE
passport.serializeUser((user, done) => {
  console.log('🔒 Sérialisation:', user.id);
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    console.log('🔓 Désérialisation:', id);
    const res = await pool.query(
      "SELECT id, email, name FROM users WHERE id = $1", 
      [id]
    );
    
    if (res.rows.length === 0) {
      console.log('❌ Utilisateur non trouvé');
      return done(null, false);
    }
    
    const user = res.rows[0];
    console.log('✅ Utilisateur chargé:', user.email);
    done(null, user);
    
  } catch (err) {
    console.error('❌ Erreur désérialisation:', err);
    done(err, null);
  }
});

// -------------------- Passport Google --------------------
const Client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// 🔥 CONFIGURATION AMÉLIORÉE DE PASSPORT
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "https://chinese-quizz.onrender.com/auth/google/callback",
    passReqToCallback: true, // ← IMPORTANT pour accéder à req
    scope: ['profile', 'email'],
    state: true // Sécurité contre les attaques CSRF
  },
  async function(req, accessToken, refreshToken, profile, done) {
    const transaction = await pool.connect();
    try {
      console.log('🔐 Début authentification Google');
      const { id, displayName, emails, photos } = profile;
      const email = emails[0].value;

      await transaction.query('BEGIN');

      // ✅ CORRIGER : Déclarer userRes avec 'let'
      let userRes = await transaction.query(
        `SELECT id, email, name, provider_id FROM users 
         WHERE provider_id = $1 OR email = $2 
         ORDER BY CASE WHEN provider_id = $1 THEN 1 ELSE 2 END 
         LIMIT 1`,
        [id, email]
      );

      let isNewUser = false;
      let user;

      if (userRes.rows.length === 0) {
        // 🆕 NOUVEL UTILISATEUR
        console.log('👤 Création nouveau utilisateur:', email);
        const newUser = await transaction.query(
          `INSERT INTO users (email, name, provider, provider_id, last_login) 
           VALUES ($1, $2, 'google', $3, NOW())  -- ✅ Commentaire correct
           RETURNING id, email, name`,
          [email, displayName, id]
        );
        user = newUser.rows[0];
        isNewUser = true;
      } else {
        // 🔄 UTILISATEUR EXISTANT
        user = userRes.rows[0];
        
        if (user.provider_id !== id) {
          console.log('🔗 Liaison compte existant avec Google');
          await transaction.query(
            'UPDATE users SET provider_id = $1, provider = $2, last_login = NOW() WHERE id = $3',
            [id, 'google', user.id]
          );
        } else {
          await transaction.query(
            'UPDATE users SET last_login = NOW() WHERE id = $1',
            [user.id]
          );
        }
      }

      await transaction.query('COMMIT');
      
      console.log('✅ Authentification réussie pour:', user.email);
      done(null, { 
        id: user.id,
        email: user.email, 
        name: user.name,
        isNewUser: isNewUser
      });

    } catch (err) {
      await transaction.query('ROLLBACK');
      console.error('❌ Erreur Passport Google:', err);
      
      // Erreur plus spécifique
      const errorMessage = err.code === '23505' ? 
        'Un compte avec cet email existe déjà' : 
        'Erreur de base de données';
      
      done(new Error(errorMessage), null);
    } finally {
      transaction.release();
    }
  }
));

// 🔥 ROUTES AMÉLIORÉES
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
    failureRedirect: "/index?error=auth_failed"
  }),
  (req, res) => {
    console.log('✅ Connexion réussie via callback');
    
    // Forcer la sauvegarde de la session AVANT redirection
    req.session.save((err) => {
      if (err) {
        console.error('❌ Erreur sauvegarde session:', err);
        return res.redirect('/index?error=session_error');
      }
      
      console.log('💾 Session sauvegardée, redirection...');
      const returnTo = req.session.returnTo || '/dashboard';
      delete req.session.returnTo;
      
      res.redirect(returnTo);
    });
  }
);

// 🔥 ONE-TAP AMÉLIORÉ AVEC GESTION D'ERREUR ROBUSTE
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

// 🆕 ROUTE DE DÉCONNEXION AMÉLIORÉE
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

// 🆕 MIDDLEWARE DE VÉRIFICATION DE SESSION
app.use((req, res, next) => {
  if (req.isAuthenticated()) {
    // Mettre à jour le last_activity
    req.session.lastActivity = Date.now();
  }
  next();
});

// 🆕 MIDDLEWARE DE SÉCURITÉ DES SESSIONS
app.use((req, res, next) => {
  if (req.session) {
    // Initialiser le compteur d'activité
    if (!req.session.lastActivity) {
      req.session.lastActivity = Date.now();
    }
    
    // Vérifier l'inactivité (24h max)
    const inactiveTime = Date.now() - req.session.lastActivity;
    const maxInactiveTime = 24 * 60 * 60 * 1000; // 24 heures
    
    if (inactiveTime > maxInactiveTime && req.isAuthenticated()) {
      console.log('🔐 Session expirée par inactivité');
      return req.logout((err) => {
        if (err) console.error('Erreur déconnexion:', err);
        res.redirect('/index?error=session_expired');
      });
    }
    
    // Mettre à jour l'activité à chaque requête authentifiée
    if (req.isAuthenticated()) {
      req.session.lastActivity = Date.now();
    }
  }
  next();
});

// 🆕 MIDDLEWARE POUR LA RÉAUTHENTIFICATION AUTOMATIQUE
app.use(async (req, res, next) => {
  if (req.isAuthenticated() && !req.user) {
    try {
      // Tentative de récupération de l'utilisateur depuis la base
      const userRes = await pool.query(
        'SELECT id, email, name FROM users WHERE id = $1',
        [req.session.passport.user]
      );
      
      if (userRes.rows.length > 0) {
        req.user = userRes.rows[0];
        console.log('🔄 Utilisateur récupéré depuis la base');
      } else {
        // Utilisateur supprimé de la base
        console.log('❌ Utilisateur non trouvé en base, déconnexion');
        req.logout();
        return res.redirect('/index?error=user_not_found');
      }
    } catch (error) {
      console.error('Erreur récupération utilisateur:', error);
    }
  }
  next();
});

// -------------------- Protection --------------------
function ensureAuth(req, res, next) {
  console.log('🔐 ensureAuth appelé pour:', req.method, req.url);
  console.log('🔐 Session ID:', req.sessionID);
  console.log('🔐 User:', req.user);
  console.log('🔐 isAuthenticated:', req.isAuthenticated ? req.isAuthenticated() : 'method_not_available');
  
  // Méthode 1: Passport standard
  if (req.isAuthenticated && req.isAuthenticated()) {
    console.log('✅ Auth réussie (Passport)');
    return next();
  }
  
  // Méthode 2: User direct
  if (req.user) {
    console.log('✅ Auth réussie (req.user)');
    return next();
  }
  
  // Méthode 3: Session avec user
  if (req.session && req.session.user) {
    console.log('✅ Auth réussie (session.user)');
    req.user = req.session.user;
    return next();
  }
  
  // Méthode 4: Session avec passport
  if (req.session && req.session.passport && req.session.passport.user) {
    console.log('✅ Auth réussie (session.passport)');
    return next();
  }
  
  console.log('❌ Auth échouée - Redirection vers /index');
  
  // Si c'est une API, retourner JSON
  if (req.url.startsWith('/api/')) {
    return res.status(401).json({ 
      error: 'Non authentifié',
      redirect: '/'
    });
  }
  
  // Sinon redirection HTML
  res.redirect('/');
}

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

//---------------------- Middleware
// NOUVELLE FONCTION: Mettre à jour le score d'un mot
async function updateWordScore(userId, motId, isCorrect) {
  try {
    console.log(`🎯 updateWordScore - User:${userId}, Mot:${motId}, Correct:${isCorrect}`);
    
    // Vérifier si le mot existe dans user_mots
    const existing = await pool.query(
      'SELECT * FROM user_mots WHERE user_id = $1 AND mot_id = $2',
      [userId, motId]
    );

    if (existing.rows.length === 0) {
      // Nouveau mot - l'ajouter avec score initial
      const initialScore = isCorrect ? 15 : 0;
      console.log(`➕ Nouveau mot ${motId} - Score initial: ${initialScore}`);
      
      await pool.query(
        'INSERT INTO user_mots (user_id, mot_id, score, nb_quiz, nb_correct) VALUES ($1, $2, $3, $4, $5)',
        [userId, motId, initialScore, 1, isCorrect ? 1 : 0]
      );
    } else {
      // Mettre à jour le score existant
      const current = existing.rows[0];
      const newNbQuiz = (current.nb_quiz || 0) + 1;
      const newNbCorrect = (current.nb_correct || 0) + (isCorrect ? 1 : 0);
      
      // 🔥 NOUVEAU SYSTÈME : +15 si correct, -20 si incorrect
      let newScore;
      if (isCorrect) {
        newScore = Math.min(100, (current.score || 0) + 15);
      } else {
        newScore = Math.max(0, (current.score || 0) - 20);
      }
      
      console.log(`✏️ Mise à jour mot ${motId}: ${current.score} -> ${newScore} (${isCorrect ? '+15' : '-20'})`);
      
      await pool.query(
        'UPDATE user_mots SET score = $1, nb_quiz = $2, nb_correct = $3 WHERE user_id = $4 AND mot_id = $5',
        [newScore, newNbQuiz, newNbCorrect, userId, motId]
      );
    }
    
    console.log(`✅ Score mis à jour pour mot ${motId}`);
  } catch (error) {
    console.error('❌ Erreur updateWordScore:', error);
  }
}

// ---------------------API

// 🎯 ROUTE AVEC LA BONNE TABLE user_mots
app.get("/check-user-word/:chinese", ensureAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    const chinese = decodeURIComponent(req.params.chinese);
    console.log('🔍 DEBUG - Vérification:', { userId, chinese });

    const { rows } = await pool.query(`
      SELECT mots.*
      FROM mots
      JOIN user_mots ON mots.id = user_mots.mot_id
      WHERE user_mots.user_id = $1 AND mots.chinese = $2
    `, [userId, chinese]);

    console.log('✅ DEBUG - Résultats:', rows);
    const alreadyExists = rows.length > 0;
    
    res.json({ alreadyExists });

  } catch (err) {
    console.error('❌ DEBUG - Erreur:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/contributions", ensureAuth, async (req, res) => {
  try {
    console.log('🔍 Requête reçue pour /api/contributions');
    console.log('🔍 Utilisateur connecté (req.user) :', req.user);
    console.log('🔍 Paramètres query:', req.query);

    const userId = req.user ? req.user.id : null;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    if (!userId) {
      console.warn('⚠️ Aucun utilisateur connecté');
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // 🎯 CORRECTION : Filtrer par année
    const result = await pool.query(`
      SELECT 
        DATE(date_completed) as date,
        COUNT(*) as count
      FROM quiz_history 
      WHERE user_id = $1 
        AND EXTRACT(YEAR FROM date_completed) = $2
      GROUP BY DATE(date_completed)
      ORDER BY date ASC
    `, [userId, year]);

    const rows = result.rows.map(r => ({
      date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
      count: parseInt(r.count, 10) || 0
    }));

    console.log(`📦 Résultat des contributions pour ${year}:`, rows);
    res.json(rows);
  } catch (error) {
    console.error('❌ Erreur dans /api/contributions :', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get("/api/quiz/history", ensureAuth, async (req, res) => {
  try {
    console.log('📊 Route /api/quiz/history appelée');
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 10;
    
    // Récupérer les derniers quiz
    const quizzesResult = await pool.query(
      `SELECT * FROM quiz_history 
       WHERE user_id = $1 
       ORDER BY date_completed DESC 
       LIMIT $2`,
      [userId, limit]
    );
    
    // Récupérer les stats globales - avec COALESCE pour gérer les valeurs NULL
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_quizzes,
        COALESCE(AVG(ratio), 0) as average_ratio,
        COALESCE(MAX(ratio), 0) as best_score
      FROM quiz_history 
      WHERE user_id = $1
    `, [userId]);
    
    console.log(`📊 Données trouvées: ${quizzesResult.rows.length} quiz`);
    
    res.json({
      quizzes: quizzesResult.rows,
      stats: statsResult.rows[0]
    });
    
  } catch (err) {
    console.error('❌ Erreur récupération historique quiz:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/quiz/save", ensureAuth, express.json(), async (req, res) => {
  try {
    console.log('💾 /api/quiz/save - Données reçues:', req.body);
    
    const {
      score,
      total_questions,
      quiz_type,
      results,      // NOUVEAU : pour les scores détaillés
      words_used    // ANCIEN : pour la compatibilité
    } = req.body;

    // Validation
    if (score === undefined || total_questions === undefined || !quiz_type) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    const scoreNum = parseInt(score);
    const totalNum = parseInt(total_questions);
    const ratio = ((scoreNum / totalNum) * 100).toFixed(2);

    // 🔥 GÉRER LA COMPATIBILITÉ : utiliser results OU words_used
    let wordsForHistory = [];
    
    if (words_used) {
      // Ancien format : words_used est un tableau de pinyins
      wordsForHistory = words_used;
    } else if (results) {
      // Nouveau format : results est un tableau d'objets
      wordsForHistory = results.map(r => r.pinyin);
    }

    console.log('📝 Données pour historique:', wordsForHistory);

    // 1. Sauvegarder le quiz dans l'historique
    const quizResult = await pool.query(
      `INSERT INTO quiz_history 
       (user_id, score, total_questions, ratio, quiz_type, words_used) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [req.user.id, scoreNum, totalNum, ratio, quiz_type, JSON.stringify(wordsForHistory)]
    );

    // 2. NOUVEAU : Mettre à jour les scores des mots
    if (results && Array.isArray(results)) {
      console.log(`🔄 Mise à jour de ${results.length} scores de mots...`);
      
      for (const result of results) {
        console.log(`🎯 Traitement mot:`, result);
        
        if (result.mot_id && result.correct !== null && result.correct !== undefined) {
          await updateWordScore(req.user.id, result.mot_id, result.correct);
        } else {
          console.log('❌ Données manquantes pour mot:', result);
        }
      }
      console.log('✅ Tous les scores mis à jour');
    } else {
      console.log('ℹ️ Aucun résultat détaillé à traiter');
    }
    
    res.json({ 
      success: true, 
      quiz: quizResult.rows[0],
      message: `Quiz sauvegardé avec ${results ? results.length : 0} scores mis à jour`
    });
    
  } catch (err) {
    console.error('❌ Erreur sauvegarde quiz:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tous-les-mots", ensureAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM mots 
      ORDER BY id ASC
    `);

    console.log(`📚 Chargement de ${rows.length} mots depuis la table 'mots'`);
    res.json(rows);

  } catch (err) {
    console.error('❌ Erreur /api/tous-les-mots:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/mes-mots", ensureAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(`
      SELECT mots.*, 
             user_mots.score,
             user_mots.nb_quiz,
             user_mots.nb_correct
      FROM mots
      JOIN user_mots ON mots.id = user_mots.mot_id
      WHERE user_mots.user_id = $1
      ORDER BY user_mots.score ASC, mots.id ASC
    `, [userId]);

    console.log(`📊 ${rows.length} mots avec scores récupérés pour l'utilisateur ${userId}`);
    
    // Log du premier mot pour vérifier
    if (rows.length > 0) {
      console.log('🔍 Exemple mot avec score:', {
        id: rows[0].id,
        chinese: rows[0].chinese, 
        score: rows[0].score,
        nb_quiz: rows[0].nb_quiz
      });
    }

    res.json(rows);

  } catch (err) {
    console.error('❌ Erreur récupération mes-mots:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/verifier", ensureAuth, async (req, res) => {
  const { chinese, answer } = req.body;
  try {
    const { rows } = await pool.query("SELECT * FROM mots WHERE chinese=$1", [chinese]);
    const row = rows[0];
    const correct = row && row.english.toLowerCase() === answer.toLowerCase();
    res.json({ correct, correctAnswer: row ? row.english : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/ajouter", ensureAuth , async (req, res) => {
  const { chinese, pinyin, english, description, hsk } = req.body;
  const userId = req.user.id; // récupère l'utilisateur connecté

  try {
    // 1. Vérifier si le mot existe déjà dans la table mots
    let { rows } = await pool.query("SELECT * FROM mots WHERE chinese=$1", [chinese]);
    let motId;

    if (rows.length > 0) {
      // Le mot existe déjà
      motId = rows[0].id;
    } else {
      // Créer le mot
      const insertRes = await pool.query(
        "INSERT INTO mots (chinese,pinyin,english,description,hsk) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [chinese, pinyin, english, description, hsk]
      );
      motId = insertRes.rows[0].id;
    }

    // 2. Vérifier si le mot est déjà lié à l'utilisateur
    const { rows: userMotRows } = await pool.query(
      "SELECT * FROM user_mots WHERE user_id=$1 AND mot_id=$2",
      [userId, motId]
    );

    if (userMotRows.length > 0) {
      return res.json({ success: false, message: "Mot déjà dans votre liste" });
    }

    // 3. Ajouter le lien utilisateur ↔ mot
    await pool.query(
      "INSERT INTO user_mots (user_id, mot_id) VALUES ($1,$2)",
      [userId, motId]
    );

    res.json({ success: true, motId });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/liste", ensureAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM mots ORDER BY id ASC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/update/:id", ensureAuth, async (req, res) => {
  const { id } = req.params;
  const { chinese, pinyin, english, description, hsk } = req.body;
  try {
    await pool.query(
      "UPDATE mots SET chinese=$1,pinyin=$2,english=$3,description=$4,hsk=$5 WHERE id=$6",
      [chinese,pinyin,english,description,hsk,id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "update failed" });
  }
});

app.get("/check-mot/:chinese", ensureAuth, async (req, res) => {
  const { chinese } = req.params;
  try {
    const { rows } = await pool.query("SELECT * FROM mots WHERE chinese=$1", [chinese]);
    if (rows.length > 0) {
      res.json({ exists: true, mot: rows[0] });
    } else {
      res.json({ exists: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/quiz-mots', ensureAuth, async (req, res) => {
  const userId = req.user.id;
  const requestedCount = req.query.count === 'all' ? null : parseInt(req.query.count) || 10;
  const hskLevel = req.query.hsk || 'all';

  console.log('🎯 API /quiz-mots appelée avec:', { 
    userId, 
    requestedCount, 
    hskLevel 
  });

  try {
    let query = `
      SELECT mots.*, 
             COALESCE(user_mots.score, 0) as score,
             COALESCE(user_mots.nb_quiz, 0) as nb_quiz
      FROM user_mots 
      JOIN mots ON user_mots.mot_id = mots.id
      WHERE user_mots.user_id = $1
      AND user_mots.score < 100
    `;
    
    let params = [userId];
    let paramCount = 1;

    // Filtre HSK corrigé
    if (hskLevel !== 'all') {
      if (hskLevel === 'street') {
        query += ` AND mots.hsk IS NULL`;  // Street Chinese = hsk IS NULL
      } else {
        paramCount++;
        query += ` AND mots.hsk = $${paramCount}`;  // HSK normal = hsk = valeur
        params.push(parseInt(hskLevel));
      }
    }

    console.log('📝 Query:', query);
    console.log('🔧 Paramètres:', params);

    const { rows } = await pool.query(query, params);
    console.log('✅ Résultats DB:', rows.length, 'lignes');

    if (rows.length === 0) {
      console.log('ℹ️ Aucun mot trouvé avec ces critères');
      return res.json([]);
    }

    // Le reste de ta logique de sélection intelligente...
    const motsFaibles = rows.filter(mot => mot.score < 50)
      .sort((a, b) => a.nb_quiz - b.nb_quiz);
    const motsMoyens = rows.filter(mot => mot.score >= 50 && mot.score < 80)
      .sort((a, b) => a.nb_quiz - b.nb_quiz);
    const motsForts = rows.filter(mot => mot.score >= 80)
      .sort((a, b) => a.nb_quiz - b.nb_quiz);

    const totalMots = requestedCount || rows.length;
    
    let nbFaibles = Math.ceil(totalMots * 0.7);
    let nbMoyens = Math.ceil(totalMots * 0.2);
    let nbForts = Math.ceil(totalMots * 0.1);

    // Ajustements des proportions...
    if (motsFaibles.length < nbFaibles) {
      const deficit = nbFaibles - motsFaibles.length;
      nbFaibles = motsFaibles.length;
      const ratio = nbMoyens / (nbMoyens + nbForts);
      nbMoyens += Math.ceil(deficit * ratio);
      nbForts += Math.floor(deficit * (1 - ratio));
    }

    if (motsMoyens.length < nbMoyens) {
      const deficit = nbMoyens - motsMoyens.length;
      nbMoyens = motsMoyens.length;
      nbFaibles = Math.min(motsFaibles.length, nbFaibles + deficit);
    }

    if (motsForts.length < nbForts) {
      const deficit = nbForts - motsForts.length;
      nbForts = motsForts.length;
      nbFaibles = Math.min(motsFaibles.length, nbFaibles + deficit);
    }

    const selectionFaibles = motsFaibles.slice(0, nbFaibles);
    const selectionMoyens = motsMoyens.slice(0, nbMoyens);
    const selectionForts = motsForts.slice(0, nbForts);

    let motsSelectionnes = [...selectionFaibles, ...selectionMoyens, ...selectionForts];
    motsSelectionnes = shuffleArray(motsSelectionnes);

    console.log('📈 Distribution finale:', {
      faibles: selectionFaibles.length,
      moyens: selectionMoyens.length,
      forts: selectionForts.length,
      total: motsSelectionnes.length,
      hsk: hskLevel
    });

    res.json(motsSelectionnes);

  } catch (err) {
    console.error('💥 ERREUR /quiz-mots:');
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
    
    res.status(500).json({ 
      error: 'Erreur serveur',
      details: err.message
    });
  }
});

// Route FINALE pour mettre à jour le prénom
app.post('/api/user/update-name', ensureAuth, async (req, res) => {
  try {
    console.log('🔵 Route update-name appelée');
    console.log('Body reçu:', req.body);

    // METHODE 1: Récupérer l'userId depuis le body (plus simple)
    const { name, userId } = req.body;
    
    // METHODE 2: Si userId n'est pas dans le body, essayez la session
    const finalUserId = userId || req.session.userId || req.session.user?.id;
    
    console.log('UserId utilisé:', finalUserId);

    if (!finalUserId) {
      return res.status(401).json({ 
        success: false, 
        message: 'ID utilisateur manquant' 
      });
    }

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Le prénom est requis' 
      });
    }

    // Mise à jour dans la base de données
    const result = await pool.query(
      'UPDATE users SET name = $1 WHERE id = $2 RETURNING id, name',
      [name.trim(), finalUserId]
    );

    console.log('Résultat DB:', result.rows);

    if (result.rows.length > 0) {
      res.json({ 
        success: true,
        message: 'Prénom mis à jour avec succès !',
        newName: result.rows[0].name
      });
    } else {
      res.status(404).json({ 
        success: false, 
        message: 'Utilisateur non trouvé' 
      });
    }
    
  } catch (error) {
    console.error('❌ Erreur:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur: ' + error.message 
    });
  }
});

// Duels API
    // 📍 CLASSEMENT
    app.get('/api/duels/leaderboard', ensureAuth, async (req, res) => {
      try {
        console.log('🏆 Chargement classement...');
        
        const result = await pool.query(`
          SELECT 
            u.id,
            u.name,
            u.email,
            COUNT(CASE WHEN d.status = 'completed' AND (
              (d.challenger_id = u.id AND d.challenger_score > d.opponent_score) OR
              (d.opponent_id = u.id AND d.opponent_score > d.challenger_score)
            ) THEN 1 END) as wins,
            COUNT(CASE WHEN d.status = 'completed' AND (
              (d.challenger_id = u.id AND d.challenger_score < d.opponent_score) OR
              (d.opponent_id = u.id AND d.opponent_score < d.challenger_score)
            ) THEN 1 END) as losses,
            CASE 
              WHEN COUNT(CASE WHEN d.status = 'completed' AND (d.challenger_id = u.id OR d.opponent_id = u.id) THEN 1 END) > 0 THEN
                ROUND(
                  (COUNT(CASE WHEN d.status = 'completed' AND (
                    (d.challenger_id = u.id AND d.challenger_score > d.opponent_score) OR
                    (d.opponent_id = u.id AND d.opponent_score > d.challenger_score)
                  ) THEN 1 END) * 100.0) / 
                  COUNT(CASE WHEN d.status = 'completed' AND (d.challenger_id = u.id OR d.opponent_id = u.id) THEN 1 END)
                , 1)
              ELSE 0
            END as ratio
          FROM users u
          LEFT JOIN duels d ON (d.challenger_id = u.id OR d.opponent_id = u.id) AND d.status = 'completed'
          GROUP BY u.id, u.name, u.email
          HAVING COUNT(CASE WHEN d.status = 'completed' THEN 1 END) > 0
          ORDER BY wins DESC, ratio DESC
          LIMIT 50
        `);

        console.log(`✅ Classement chargé: ${result.rows.length} joueurs`);
        res.json(result.rows);
        
      } catch (err) {
        console.error('❌ Erreur classement:', err);
        res.status(500).json({ error: 'Erreur chargement classement' });
      }
    });

    // 📍 RECHERCHE UTILISATEURS
    app.get('/api/duels/search', ensureAuth, async (req, res) => {
      try {
        const searchQuery = `%${req.query.q}%`;
        console.log('🔍 Recherche utilisateur:', searchQuery);

        const result = await pool.query(`
          SELECT id, name, email 
          FROM users 
          WHERE (email ILIKE $1 OR name ILIKE $1) 
            AND id != $2
          LIMIT 5
        `, [searchQuery, req.user.id]);

        console.log(`✅ Résultats recherche: ${result.rows.length} utilisateurs`);
        res.json(result.rows);
        
      } catch (err) {
        console.error('❌ Erreur recherche:', err);
        res.status(500).json({ error: 'Erreur recherche' });
      }
    });


// 📊 STATISTIQUES DE TOUS LES JOUEURS - CORRIGÉE
app.get('/api/players/stats', ensureAuth, async (req, res) => {
  try {
    console.log('📊 Chargement stats tous les joueurs');
    
    // TEST : Vérifie d'abord la connexion à la DB
    const testQuery = await pool.query('SELECT NOW() as time');
    console.log('✅ Connexion DB OK:', testQuery.rows[0].time);

    const result = await pool.query(`
      SELECT 
        u.id,
        u.name,
        u.email,
        COUNT(DISTINCT uw.mot_id) as total_words,           -- ⬅️ CORRIGÉ : mot_id au lieu de word_id
        COUNT(DISTINCT CASE 
          WHEN d.status = 'completed' AND (
            (d.challenger_id = u.id AND d.challenger_score > d.opponent_score) OR
            (d.opponent_id = u.id AND d.opponent_score > d.challenger_score)
          ) THEN d.id
        END) as wins,
        COUNT(DISTINCT CASE 
          WHEN d.status = 'completed' AND (
            (d.challenger_id = u.id AND d.challenger_score < d.opponent_score) OR
            (d.opponent_id = u.id AND d.opponent_score < d.challenger_score)
          ) THEN d.id
        END) as losses,
        CASE 
          WHEN COUNT(DISTINCT CASE 
            WHEN d.status = 'completed' AND (d.challenger_id = u.id OR d.opponent_id = u.id) THEN d.id
          END) > 0 THEN
            ROUND(
              (COUNT(DISTINCT CASE 
                WHEN d.status = 'completed' AND (
                  (d.challenger_id = u.id AND d.challenger_score > d.opponent_score) OR
                  (d.opponent_id = u.id AND d.opponent_score > d.challenger_score)
                ) THEN d.id
              END) * 100.0) / 
              COUNT(DISTINCT CASE 
                WHEN d.status = 'completed' AND (d.challenger_id = u.id OR d.opponent_id = u.id) THEN d.id
              END)
            , 1)
          ELSE 0
        END as win_ratio
      FROM users u
      LEFT JOIN user_mots uw ON u.id = uw.user_id           -- ⬅️ CORRIGÉ : user_mots au lieu de user_words
      LEFT JOIN duels d ON (d.challenger_id = u.id OR d.opponent_id = u.id)
      WHERE u.id IN (SELECT DISTINCT user_id FROM user_mots) -- ⬅️ CORRIGÉ : user_mots
      GROUP BY u.id, u.name, u.email
      ORDER BY wins DESC, total_words DESC
    `);

    console.log(`✅ ${result.rows.length} joueurs trouvés`);
    if (result.rows.length > 0) {
      console.log('📊 Exemple joueur:', result.rows[0]);
    }
    
    // ✅ RETOURNE BIEN LE TABLEAU
    res.json(result.rows);
    
  } catch (err) {
    console.error('❌ Erreur détaillée stats joueurs:', err);
    
    // ✅ RETOURNE UNE ERREUR PROPRE
    res.status(500).json({ 
      error: 'Erreur chargement des statistiques joueurs',
      details: err.message 
    });
  }
});

    // 📍 STATS PERSO
    app.get('/api/duels/stats', ensureAuth, async (req, res) => {
      try {
        console.log('📊 Chargement stats perso pour:', req.user.id);
        
        const result = await pool.query(`
          SELECT 
            COUNT(*) as total_duels,
            COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_duels,
            COUNT(CASE WHEN status = 'completed' AND (
              (challenger_id = $1 AND challenger_score > opponent_score) OR
              (opponent_id = $1 AND opponent_score > challenger_score)
            ) THEN 1 END) as wins,
            COUNT(CASE WHEN status = 'completed' AND (
              (challenger_id = $1 AND challenger_score < opponent_score) OR
              (opponent_id = $1 AND opponent_score < challenger_score)
            ) THEN 1 END) as losses,
            CASE 
              WHEN COUNT(CASE WHEN status = 'completed' AND (challenger_id = $1 OR opponent_id = $1) THEN 1 END) > 0 THEN
                ROUND(
                  (COUNT(CASE WHEN status = 'completed' AND (
                    (challenger_id = $1 AND challenger_score > opponent_score) OR
                    (opponent_id = $1 AND opponent_score > challenger_score)
                  ) THEN 1 END) * 100.0) / 
                  COUNT(CASE WHEN status = 'completed' AND (challenger_id = $1 OR opponent_id = $1) THEN 1 END)
                , 1)
              ELSE 0
            END as ratio
          FROM duels 
          WHERE (challenger_id = $1 OR opponent_id = $1)
        `, [req.user.id]);

        const stats = result.rows[0] || { wins: 0, losses: 0, ratio: 0, total_duels: 0 };
        console.log('✅ Stats perso:', stats);
        res.json(stats);
        
      } catch (err) {
        console.error('❌ Erreur stats perso:', err);
        res.status(500).json({ error: 'Erreur chargement stats' });
      }
    });

    // 📍 CRÉATION D'UN DUEL
    app.post('/api/duels/create', ensureAuth, async (req, res) => {
      const transaction = await pool.connect();
      
      try {
        const { opponent_id, duel_type = 'classic', quiz_type = 'pinyin' } = req.body;
        console.log('🎯 Création duel:', { challenger: req.user.id, opponent_id, duel_type, quiz_type });

        // Vérifier que l'opposant existe
        const opponentCheck = await transaction.query(
          'SELECT id, name FROM users WHERE id = $1',
          [opponent_id]
        );

        if (opponentCheck.rows.length === 0) {
          return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        if (opponent_id === req.user.id) {
          return res.status(400).json({ error: 'Vous ne pouvez pas vous défier vous-même' });
        }

        await transaction.query('BEGIN');

        // Générer les données du quiz
        const quizData = await generateDuelQuiz(transaction, req.user.id, opponent_id, duel_type, quiz_type);
        
        if (!quizData) {
          await transaction.query('ROLLBACK');
          return res.status(400).json({ error: 'Impossible de générer le quiz (pas assez de mots)' });
        }

        // Créer le duel
        const duelResult = await transaction.query(`
          INSERT INTO duels 
          (challenger_id, opponent_id, duel_type, quiz_type, quiz_data, status)
          VALUES ($1, $2, $3, $4, $5, 'pending')
          RETURNING *
        `, [req.user.id, opponent_id, duel_type, quiz_type, JSON.stringify(quizData)]);

        await transaction.query('COMMIT');

        const duel = duelResult.rows[0];
        console.log('✅ Duel créé avec ID:', duel.id);
        
        res.json({ 
          success: true, 
          duel: duel,
          message: `Défi lancé contre ${opponentCheck.rows[0].name} !`
        });

      } catch (err) {
        await transaction.query('ROLLBACK');
        console.error('❌ Erreur création duel:', err);
        res.status(500).json({ error: 'Erreur création duel' });
      } finally {
        transaction.release();
      }
    });

    // 📍 DUELS EN ATTENTE (pour /account et /quiz)
    app.get('/api/duels/pending', ensureAuth, async (req, res) => {
      try {
        console.log('⏳ Chargement duels en attente pour:', req.user.id);
        
        const result = await pool.query(`
          SELECT 
            d.*,
            u1.name as challenger_name,
            u2.name as opponent_name,
            CASE 
              WHEN d.challenger_id = $1 THEN 'challenger'
              ELSE 'opponent'
            END as user_role
          FROM duels d
          JOIN users u1 ON d.challenger_id = u1.id
          JOIN users u2 ON d.opponent_id = u2.id
          WHERE (d.challenger_id = $1 OR d.opponent_id = $1)
            AND d.status = 'pending'
            AND d.expires_at > NOW()
          ORDER BY d.created_at DESC
        `, [req.user.id]);

        console.log(`✅ ${result.rows.length} duels en attente`);
        res.json(result.rows);
        
      } catch (err) {
        console.error('❌ Erreur duels en attente:', err);
        res.status(500).json({ error: 'Erreur chargement duels' });
      }
    });

    // 📍 HISTORIQUE DES DUELS
    app.get('/api/duels/history', ensureAuth, async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 10;
        console.log('📜 Chargement historique duels, limit:', limit);
        
        const result = await pool.query(`
          SELECT 
            d.*,
            u1.name as challenger_name,
            u2.name as opponent_name,
            CASE 
              WHEN d.challenger_score > d.opponent_score THEN d.challenger_id
              WHEN d.opponent_score > d.challenger_score THEN d.opponent_id
              ELSE NULL
            END as winner_id
          FROM duels d
          JOIN users u1 ON d.challenger_id = u1.id
          JOIN users u2 ON d.opponent_id = u2.id
          WHERE (d.challenger_id = $1 OR d.opponent_id = $1)
            AND d.status = 'completed'
          ORDER BY d.completed_at DESC
          LIMIT $2
        `, [req.user.id, limit]);

        console.log(`✅ ${result.rows.length} duels dans l'historique`);
        res.json(result.rows);
        
      } catch (err) {
        console.error('❌ Erreur historique:', err);
        res.status(500).json({ error: 'Erreur chargement historique' });
      }
    });

    // 📍 DÉTAIL D'UN DUEL
    app.get('/api/duels/:id', ensureAuth, async (req, res) => {
      try {
        const duelId = req.params.id;
        console.log('🔍 Détail duel:', duelId);
        
        const result = await pool.query(`
          SELECT 
            d.*,
            u1.name as challenger_name,
            u2.name as opponent_name
          FROM duels d
          JOIN users u1 ON d.challenger_id = u1.id
          JOIN users u2 ON d.opponent_id = u2.id
          WHERE d.id = $1 AND (d.challenger_id = $2 OR d.opponent_id = $2)
        `, [duelId, req.user.id]);

        if (result.rows.length === 0) {
          return res.status(404).json({ error: 'Duel non trouvé' });
        }

        res.json(result.rows[0]);
        
      } catch (err) {
        console.error('❌ Erreur détail duel:', err);
        res.status(500).json({ error: 'Erreur chargement duel' });
      }
    });

    // 📍 SOUMETTRE SCORE
    app.post('/api/duels/:id/submit', ensureAuth, async (req, res) => {
      const transaction = await pool.connect();
      
      try {
        const duelId = req.params.id;
        const { score } = req.body;
        console.log('🎯 Soumission score:', { duelId, userId: req.user.id, score });

        await transaction.query('BEGIN');

        // Vérifier le duel
        const duelCheck = await transaction.query(`
          SELECT * FROM duels 
          WHERE id = $1 AND (challenger_id = $2 OR opponent_id = $2)
          AND status = 'pending'
        `, [duelId, req.user.id]);

        if (duelCheck.rows.length === 0) {
          await transaction.query('ROLLBACK');
          return res.status(404).json({ error: 'Duel non trouvé ou déjà terminé' });
        }

        const duel = duelCheck.rows[0];
        const isChallenger = duel.challenger_id === req.user.id;

        // Mettre à jour le score
        if (isChallenger) {
          await transaction.query(`
            UPDATE duels SET challenger_score = $1 WHERE id = $2
          `, [score, duelId]);
        } else {
          await transaction.query(`
            UPDATE duels SET opponent_score = $1 WHERE id = $2
          `, [score, duelId]);
        }

        // Vérifier si les deux ont joué
        const updatedDuel = await transaction.query(`
          SELECT * FROM duels WHERE id = $1
        `, [duelId]);

        const currentDuel = updatedDuel.rows[0];
        
        if (currentDuel.challenger_score !== null && currentDuel.opponent_score !== null) {
          // Les deux ont joué → marquer comme complété
          await transaction.query(`
            UPDATE duels SET 
              status = 'completed',
              completed_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `, [duelId]);
        }

        await transaction.query('COMMIT');

        console.log('✅ Score soumis avec succès');
        res.json({ 
          success: true, 
          message: 'Score enregistré !',
          duel_completed: currentDuel.challenger_score !== null && currentDuel.opponent_score !== null
        });

      } catch (err) {
        await transaction.query('ROLLBACK');
        console.error('❌ Erreur soumission score:', err);
        res.status(500).json({ error: 'Erreur enregistrement score' });
      } finally {
        transaction.release();
      }
    });

    // ==================== FONCTIONS UTILITAIRES ====================

    async function generateDuelQuiz(transaction, user1Id, user2Id, duelType, quizType) {
      try {
        console.log('🎲 Génération quiz duel:', { duelType, quizType });
        
        let wordIds = [];
        const wordCount = duelType === 'classic' ? 20 : 10;

        if (duelType === 'classic') {
          // 10 mots user1 + 10 mots user2
          const user1Words = await getRandomUserWords(transaction, user1Id, 10);
          const user2Words = await getRandomUserWords(transaction, user2Id, 10);
          
          if (user1Words.length < 10 || user2Words.length < 10) {
            console.warn('⚠️ Pas assez de mots pour un duel classique');
            return null;
          }
          
          wordIds = [...user1Words, ...user2Words];
          
        } else if (duelType === 'match_aa') {
          // 10 mots en commun
          wordIds = await getCommonWords(transaction, user1Id, user2Id, 10);
          
          if (wordIds.length < 10) {
            console.warn('⚠️ Pas assez de mots communs pour un match AA');
            return null;
          }
        }

        // Mélanger les mots
        wordIds = shuffleArray(wordIds);

        // Récupérer les infos complètes des mots
        const wordsResult = await transaction.query(`
          SELECT id, chinese, pinyin, english, description, hsk
          FROM mots 
          WHERE id = ANY($1)
        `, [wordIds]);

        const quizData = {
          words: wordsResult.rows,
          total_questions: wordCount,
          duel_type: duelType,
          quiz_type: quizType,
          generated_at: new Date().toISOString()
        };

        console.log(`✅ Quiz généré: ${wordCount} mots`);
        return quizData;

      } catch (err) {
        console.error('❌ Erreur génération quiz:', err);
        return null;
      }
    }

    async function getRandomUserWords(transaction, userId, limit) {
      const result = await transaction.query(`
        SELECT mots.id 
        FROM mots 
        JOIN user_mots ON mots.id = user_mots.mot_id 
        WHERE user_mots.user_id = $1 
        ORDER BY RANDOM() 
        LIMIT $2
      `, [userId, limit]);
      
      return result.rows.map(row => row.id);
    }

    async function getCommonWords(transaction, user1Id, user2Id, limit) {
      const result = await transaction.query(`
        SELECT m1.id 
        FROM user_mots um1
        JOIN user_mots um2 ON um1.mot_id = um2.mot_id
        JOIN mots m1 ON um1.mot_id = m1.id
        WHERE um1.user_id = $1 AND um2.user_id = $2
        ORDER BY RANDOM()
        LIMIT $3
      `, [user1Id, user2Id, limit]);
      
      return result.rows.map(row => row.id);
    }

    function shuffleArray(array) {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }

// Pages EJS
app.get("/", (req, res) => {
  if (req.user) {
    res.redirect("/dashboard");
  } else {
    res.render("index", { user: req.user });
  }
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

//Middleware de simulation d'utilisateur pour les tests
app.use((req, res, next) => {
  if (req.session && req.session.userId && !req.user) {
    // Tentative de récupération de l'utilisateur
    User.findById(req.session.userId)
      .then(user => {
        if (user) {
          req.user = user;
        }
        next();
      })
      .catch(() => next());
  } else {
    next();
  }
});

// -------------------- Lancer serveur --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));