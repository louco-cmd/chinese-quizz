require('dotenv').config();

const { Pool } = require("pg");
const path = require("path");
const express = require("express");
const passport = require("passport");
const session = require('express-session');
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { OAuth2Client } = require('google-auth-library');
const { createClient } = require('@supabase/supabase-js');

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

const PostgreSQLStore = require('connect-pg-simple')(session);

app.use(session({
  store: new PostgreSQLStore({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 1 semaine
  }
}));

// --------------------- Initialisation Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    }
  }
);

app.use(async (req, res, next) => {
  if (req.session.userId && !req.user) {
    try {
      const userRes = await pool.query(
        'SELECT id, email, name FROM users WHERE id = $1', 
        [req.session.userId]
      );
      if (userRes.rows.length > 0) {
        req.user = userRes.rows[0];
      }
    } catch (err) {
      console.error('Erreur récupération user:', err);
    }
  }
  next();
});

app.use(async (req, res, next) => {
  if (req.session.userId && !req.user) {
    try {
      const userRes = await pool.query(
        'SELECT id, email, name FROM users WHERE id = $1', 
        [req.session.userId]
      );
      if (userRes.rows.length > 0) {
        req.user = userRes.rows[0];
      }
    } catch (err) {
      console.error('Erreur récupération user:', err);
    }
  }
  next();
});

app.use((req, res, next) => {
  // Log minimal pour production
  if (process.env.NODE_ENV === 'development') {
    console.log('🔐 Session:', {
      id: req.sessionID?.substring(0, 8),
      user: req.user?.id || 'anonymous'
    });
  }
  next();
});

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

    await pool.query(`
  CREATE TABLE IF NOT EXISTS user_mots (
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    mot_id INTEGER REFERENCES mots(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, mot_id)
  )
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS duels (
    id SERIAL PRIMARY KEY,
    challenger_id INTEGER REFERENCES users(id),
    opponent_id INTEGER REFERENCES users(id),
    duel_type TEXT DEFAULT 'classic',
    quiz_type TEXT DEFAULT 'pinyin',
    quiz_data JSONB,
    challenger_score INTEGER,
    opponent_score INTEGER,
    status TEXT DEFAULT 'pending',
    expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '24 hours'),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
  )
`);
    
    console.log("✅ Table 'session' vérifiée ou créée.");

    
    console.log("✅ Tables 'mots' et 'users' vérifiées ou créées.");
  } catch (err) {
    console.error("❌ Erreur lors de l'initialisation :", err);
  }
})();



// -------------------- Auth Supabase --------------------

app.get('/auth/supabase', (req, res) => {
  const redirectTo = `${process.env.SUPABASE_URL}/auth/v1/authorize`;
  const params = new URLSearchParams({
    provider: 'google',
    redirect_to: `${req.protocol}://${req.get('host')}/auth/callback`
  });
  
  res.redirect(`${redirectTo}?${params.toString()}`);
});

// -------------------- Auth Email (Magic Link) --------------------

// Route pour envoyer le magic link
app.post('/auth/email', async (req, res) => {
  const { email } = req.body;
  
  try {
    console.log('📧 Envoi magic link à:', email);
    
    const { data, error } = await supabase.auth.signInWithOtp({
      email: email,
      options: {
        emailRedirectTo: `http://localhost:3000/auth/callback`
      }
    });
    
    if (error) {
      console.error('❌ Erreur magic link:', error);
      return res.status(400).json({ 
        success: false, 
        message: 'Erreur: ' + error.message 
      });
    }
    
    console.log('✅ Magic link envoyé à:', email);
    res.json({ 
      success: true, 
      message: 'Lien de connexion envoyé à ' + email 
    });
    
  } catch (error) {
    console.error('❌ Erreur envoi email:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur: ' + error.message 
    });
  }
});

// Route pour la page de login email
app.get('/login-email', (req, res) => {
  res.render('login-email', {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_ANON_KEY
  });
});

// Callback - Version optimisée et propre
app.get('/auth/callback', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Connexion en cours...</title>
        <style>
            body { 
                font-family: Arial, sans-serif; 
                text-align: center; 
                margin: 100px auto;
                max-width: 400px;
            }
            .spinner {
                border: 4px solid #f3f3f3;
                border-top: 4px solid #3B82F6;
                border-radius: 50%;
                width: 40px;
                height: 40px;
                animation: spin 1s linear infinite;
                margin: 20px auto;
            }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        </style>
    </head>
    <body>
        <h2>Connexion en cours...</h2>
        <div class="spinner"></div>
        <p>Redirection automatique...</p>
        
        <script>
            // Récupère le token du hash
            const hash = window.location.hash.substring(1);
            const params = new URLSearchParams(hash);
            const accessToken = params.get('access_token');

            if (accessToken) {
                // Envoie le token au serveur
                fetch('/auth/token-handler', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ access_token: accessToken })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        window.location.href = '/dashboard';
                    } else {
                        window.location.href = '/?error=auth_failed';
                    }
                })
                .catch(error => {
                    console.error('Erreur:', error);
                    window.location.href = '/?error=network_error';
                });
            } else {
                window.location.href = '/?error=no_token';
            }
        </script>
    </body>
    </html>
  `);
});

// Route pour traiter le token
app.post('/auth/token-handler', async (req, res) => {
  try {
    const { access_token, refresh_token } = req.body;
    
    console.log('🔐 Token reçu pour traitement');

    if (!access_token) {
      throw new Error('Aucun token reçu');
    }

    // Utilise le token pour récupérer l'user
    const { data: { user }, error } = await supabase.auth.getUser(access_token);
    
    if (error) {
      console.error('❌ Erreur getUser:', error);
      throw error;
    }
    
    if (!user) {
      throw new Error('Utilisateur non trouvé avec ce token');
    }

    console.log('✅ Utilisateur récupéré:', user.email);

    // SYNCHRONISATION avec ta base Neon
    let neonUser = await pool.query('SELECT * FROM users WHERE email = $1', [user.email]);
    
    if (neonUser.rows.length === 0) {
      // Nouvel user - créer dans Neon
      console.log('🆕 Création nouvel utilisateur dans Neon');
      neonUser = await pool.query(
        `INSERT INTO users (email, name, provider, provider_id, created_at) 
         VALUES ($1, $2, 'google', $3, NOW()) RETURNING *`,
        [user.email, user.user_metadata.full_name || user.email.split('@')[0], user.id]
      );
      console.log('✅ Nouvel utilisateur créé:', user.email);
    } else {
      // User existant - mettre à jour si nécessaire
      console.log('✅ Utilisateur existant trouvé:', user.email);
      
      if (!neonUser.rows[0].provider_id) {
        await pool.query(
          'UPDATE users SET provider_id = $1, provider = $2 WHERE id = $3',
          [user.id, 'google', neonUser.rows[0].id]
        );
        console.log('🔄 Provider ID mis à jour');
      }
    }

    // Crée la session Express
    req.session.userId = neonUser.rows[0].id;
    req.session.user = neonUser.rows[0];
    req.session.supabaseAccessToken = access_token;

    // Sauvegarde la session
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error('❌ Erreur sauvegarde session:', err);
          reject(err);
        } else {
          console.log('✅ Session sauvegardée - User ID:', neonUser.rows[0].id);
          resolve();
        }
      });
    });

    res.json({ 
      success: true, 
      user: {
        id: neonUser.rows[0].id,
        email: neonUser.rows[0].email,
        name: neonUser.rows[0].name
      }
    });

  } catch (error) {
    console.error('❌ Erreur token-handler:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Fonction pour synchroniser un user
async function syncUserWithSupabase(supabaseUser) {
  try {
    let neonUser = await pool.query('SELECT * FROM users WHERE email = $1', [supabaseUser.email]);
    
    if (neonUser.rows.length === 0) {
      // Créer dans Neon
      const result = await pool.query(
        `INSERT INTO users (email, name, provider, provider_id, created_at) 
         VALUES ($1, $2, 'google', $3, NOW()) RETURNING *`,
        [supabaseUser.email, supabaseUser.user_metadata.full_name, supabaseUser.id]
      );
      return result.rows[0];
    } else {
      // Mettre à jour si nécessaire
      if (!neonUser.rows[0].provider_id) {
        await pool.query(
          'UPDATE users SET provider_id = $1, provider = $2 WHERE id = $3',
          [supabaseUser.id, 'google', neonUser.rows[0].id]
        );
      }
      return neonUser.rows[0];
    }
  } catch (error) {
    console.error('❌ Erreur sync user:', error);
    throw error;
  }
}

// Nouvelle route pour traiter le token
app.post('/auth/token', async (req, res) => {
  try {
    const { access_token, refresh_token } = req.body;
    
    console.log('🔐 Token reçu:', access_token ? 'OUI' : 'NON');

    if (!access_token) {
      throw new Error('Aucun token reçu');
    }

    // Utilise le token pour récupérer la session
    const { data: { user }, error } = await supabase.auth.getUser(access_token);
    
    if (error) throw error;
    if (!user) throw new Error('Utilisateur non trouvé');

    console.log('✅ Utilisateur récupéré:', user.email);

    // Trouve ou crée l'user dans ta base
    let dbUser = await pool.query('SELECT * FROM users WHERE email = $1', [user.email]);
    
    if (dbUser.rows.length === 0) {
      dbUser = await pool.query(
        `INSERT INTO users (email, name, provider, provider_id, created_at) 
         VALUES ($1, $2, 'google', $3, NOW()) RETURNING *`,
        [user.email, user.user_metadata.full_name || user.email.split('@')[0], user.id]
      );
      console.log('👤 Nouvel utilisateur créé:', user.email);
    }

    // Crée la session
    req.session.userId = dbUser.rows[0].id;
    req.session.user = dbUser.rows[0];
    req.session.supabaseAccessToken = access_token;

    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log('✅ Session créée pour:', user.email);
    res.json({ success: true, user: dbUser.rows[0] });

  } catch (error) {
    console.error('❌ Erreur token auth:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Middleware d'auth mis à jour
function ensureAuth(req, res, next) {
  if (req.session.userId) {
    return next();
  }
  res.redirect('/auth/supabase');
}

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
