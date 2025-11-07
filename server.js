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
        
        await addWelcomeGift(transaction, user.id);
        
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
      
      if (req.user.isNewUser) {
        return res.redirect('/welcome');
      }
      
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
          redirect: isNewUser ? '/welcome' : '/dashboard',
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
    console.log('💾 /api/quiz/save - User authentifié:', req.user);
    
    const {
      score,
      total_questions,
      quiz_type,
      words_used
    } = req.body;

    // Validation
    if (score === undefined || total_questions === undefined || !quiz_type) {
      return res.status(400).json({ 
        error: 'Données manquantes',
        received: req.body
      });
    }

    const scoreNum = parseInt(score);
    const totalNum = parseInt(total_questions);
    
    if (isNaN(scoreNum) || isNaN(totalNum)) {
      return res.status(400).json({ 
        error: 'Score ou total_questions invalide'
      });
    }

    const ratio = ((scoreNum / totalNum) * 100).toFixed(2);
    
    console.log(`💾 Insertion - User:${req.user.id}, Score:${scoreNum}/${totalNum}`);

    const result = await pool.query(
      `INSERT INTO quiz_history 
       (user_id, score, total_questions, ratio, quiz_type, words_used) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [req.user.id, scoreNum, totalNum, ratio, quiz_type, JSON.stringify(words_used || [])]
    );

    console.log('✅ Quiz sauvegardé avec ID:', result.rows[0].id);
    
    res.json({ 
      success: true, 
      quiz: result.rows[0],
      message: `Quiz sauvegardé : ${scoreNum}/${totalNum} (${ratio}%)`
    });
    
  } catch (err) {
    console.error('❌ Erreur sauvegarde quiz:', err);
    res.status(500).json({ 
      error: err.message,
      details: 'Erreur base de données'
    });
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
      SELECT mots.*
      FROM mots
      JOIN user_mots ON mots.id = user_mots.mot_id
      WHERE user_mots.user_id = $1
      ORDER BY mots.id ASC
    `, [userId]);

    res.json(rows);

  } catch (err) {
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

  try {
    const { rows } = await pool.query(`
      SELECT mots.*
      FROM mots
      JOIN user_mots ON mots.id = user_mots.mot_id
      WHERE user_mots.user_id = $1
      ORDER BY RANDOM()
    `, [userId]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
          LIMIT 10
        `, [searchQuery, req.user.id]);

        console.log(`✅ Résultats recherche: ${result.rows.length} utilisateurs`);
        res.json(result.rows);
        
      } catch (err) {
        console.error('❌ Erreur recherche:', err);
        res.status(500).json({ error: 'Erreur recherche' });
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
  const userId = req.user.id; 

  try {
    // 1. Récupérer les données utilisateur
    // Nous demandons UNIQUEMENT les colonnes existantes : name et email
    const userRes = await pool.query('SELECT name, email FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0] || {};
    
    // 2. Récupérer les mots de l'utilisateur (on n'a besoin que du hsk pour les stats)
    const wordsRes = await pool.query(`
      SELECT mots.hsk
      FROM mots
      JOIN user_mots ON mots.id = user_mots.mot_id
      WHERE user_mots.user_id = $1
    `, [userId]);
    
    // Calcul des Stats HSK
    const stats = { HSK1: 0, HSK2: 0, HSK3: 0, HSK4: 0, HSK5: 0, HSK6: 0, Street: 0 };
    wordsRes.rows.forEach(w => {
      const hskKey = w.hsk && stats[`HSK${w.hsk}`] !== undefined ? `HSK${w.hsk}` : 'Street';
      stats[hskKey]++;
    });

    // 3. Renvoyer toutes les données
    res.json({
      name: user.name,
      // Nous ne renvoyons plus photoUrl, le client utilisera un avatar par défaut
      wordCount: wordsRes.rows.length,
      stats: stats
    });

  } catch (err) {
    console.error("Erreur API /account-info:", err);
    res.status(500).json({ error: "Erreur serveur lors de la récupération des données" });
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

// Middleware de simulation d'utilisateur pour les tests
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