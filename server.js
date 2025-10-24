const { Pool } = require("pg");
const path = require("path");
const express = require("express");
const passport = require("passport");
const session = require('express-session');
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);


const app = express();

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


// -------------------- Configuration Vercel --------------------
app.set('trust proxy', 1);

// -------------------- Session pour Vercel --------------------
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
    callbackURL: "https://chinese-quizz.vercel.app/auth/google/callback",
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

// 🎁 FONCTION POUR LE MOT CADEAU
async function addWelcomeGift(transaction, userId) {
  try {
    console.log('🎁 Recherche du mot cadeau "加油"');
    
    const motRes = await transaction.query(
      "SELECT id, chinese, pinyin, english FROM mots WHERE chinese = '加油'"
    );
    
    if (motRes.rows.length > 0) {
      const mot = motRes.rows[0];
      console.log('✅ Mot cadeau trouvé:', mot);
      
      await transaction.query(
        `INSERT INTO user_mots (user_id, mot_id, mastered, review_count, next_review) 
         VALUES ($1, $2, false, 0, NOW() + INTERVAL '1 day')`,
        [userId, mot.id]
      );
      
      console.log('🎁 Mot "加油" ajouté à la collection du nouvel utilisateur');
      
      // 🆕 AJOUT DE QUELQUES MOTS SUPPLÉMENTAIRES POUR COMMENCER
      await addStarterWords(transaction, userId);
      
    } else {
      console.warn('⚠️ Mot "加油" non trouvé dans la base');
    }
  } catch (giftError) {
    console.error('❌ Erreur ajout mot cadeau:', giftError);
    throw giftError; // Propager l'erreur pour rollback
  }
}

// 🆕 MOTS DE DÉMARAGE SUPPLÉMENTAIRES
async function addStarterWords(transaction, userId) {
  try {
    const starterWords = ['你好', '谢谢', '我', '你', '是'];
    
    for (const word of starterWords) {
      const wordRes = await transaction.query(
        "SELECT id FROM mots WHERE chinese = $1",
        [word]
      );
      
      if (wordRes.rows.length > 0) {
        await transaction.query(
          `INSERT INTO user_mots (user_id, mot_id, mastered, review_count, next_review) 
           VALUES ($1, $2, false, 0, NOW() + INTERVAL '1 day')`,
          [userId, wordRes.rows[0].id]
        );
      }
    }
    
    console.log(`🎁 ${starterWords.length} mots de démarrage ajoutés`);
  } catch (error) {
    console.error('❌ Erreur mots démarrage:', error);
    // Ne pas propager pour ne pas bloquer l'inscription
  }
}

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

app.get('/cookie-debug', (req, res) => {
  console.log('=== 🍪 COOKIE DEBUG ULTIME ===');
  console.log('Session ID:', req.sessionID);
  console.log('Cookies REÇUS:', req.headers.cookie);
  
  // Test 1: Cookie de session normal
  req.session.testValue = 'session_works';
  req.session.save((err) => {
    if (err) {
      console.error('❌ Session save error:', err);
    }
    
    // Test 2: Cookie manuel
    res.cookie('manual_cookie', 'manual_value', {
      secure: true,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax'
      // Pas de domain
    });
    
    // Vérifier les headers qui seront envoyés
    console.log('Headers à envoyer:', res.getHeaders()['set-cookie']);
    
    res.json({
      sessionID: req.sessionID,
      cookiesReceived: req.headers.cookie,
      setCookieHeaders: res.getHeaders()['set-cookie'],
      message: 'Check browser cookies and network tab'
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
