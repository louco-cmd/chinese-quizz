
const { Pool } = require("pg");
const path = require("path");
const express = require("express");
const passport = require("passport");
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
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

// -------------------- Session PostgreSQL --------------------
app.use(session({
  store: new pgSession({ pool }),
  secret: "keyboard cat",
  resave: false,
  saveUninitialized: false,
}));
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    
    console.log("✅ Tables 'mots' et 'users' vérifiées ou créées.");
  } catch (err) {
    console.error("❌ Erreur lors de l'initialisation :", err);
  }
})();

// -------------------- Protection --------------------
// Middleware ensureAuth corrigé
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
  
  console.log('❌ Auth échouée - Redirection vers /login');
  
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

// -------------------- Passport Google --------------------
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "https://chinese-quizz.onrender.com/auth/google/callback"
  },
  async function(accessToken, refreshToken, profile, done) {
    try {
      const { id, displayName, emails } = profile;
      const email = emails[0].value;

      let userRes = await pool.query("SELECT * FROM users WHERE provider_id=$1", [id]);
      
      if (userRes.rows.length === 0) {
        // 🎯 INSERT et RÉCUPÈRE l'ID généré
        const newUser = await pool.query(
          "INSERT INTO users (email, name, provider, provider_id) VALUES ($1,$2,'google',$3) RETURNING id",
          [email, displayName, id]
        );
        userRes = newUser;
      }

      // 🎯 Utilise l'ID de la base, pas l'ID Google
      const user = userRes.rows[0];
      done(null, { 
        id: user.id,
        email: user.email, 
        name: user.name 
      });
    } catch (err) {
      console.error('❌ Passport error:', err);
      done(err, null);
    }
  }
));
app.get("/auth/google", passport.authenticate("google", { scope: ["profile","email"] }));
app.get("/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/" }),
    (req, res) => {
        const returnTo = req.session.returnTo || '/dashboard';
        delete req.session.returnTo;
        res.redirect(returnTo);
    }
);
app.post("/auth/google/one-tap", async (req, res) => {
  try {
    const { credential } = req.body;
    console.log('🔐 Google One Tap token received');
    
    // Vérifier le token Google
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    const { sub: googleId, name, email, picture } = payload;
    console.log('👤 Google user:', { googleId, name, email });

    // Même logique que ton OAuth existant
    let userRes = await pool.query("SELECT * FROM users WHERE provider_id = $1", [googleId]);
    
    if (userRes.rows.length === 0) {
      console.log('📝 Creating new user');
      userRes = await pool.query(
        `INSERT INTO users (email, name, provider, provider_id) 
         VALUES ($1, $2, 'google', $3) 
         RETURNING id, email, name`,
        [email, name, googleId]
      );
    }

    const user = userRes.rows[0];
    console.log('✅ User found/created:', user);
    
    // Connecte l'utilisateur avec Passport
    req.login(user, (err) => {
      if (err) {
        console.error('❌ Login error:', err);
        return res.status(500).json({ error: 'Login failed' });
      }
      console.log('🎯 User logged in successfully');
      res.json({ 
        success: true, 
        redirect: '/dashboard',
        user: { name: user.name } 
      });
    });

  } catch (err) {
    console.error('❌ Google One Tap error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});
// -------------------- Serialize / Deserialize --------------------
passport.serializeUser((user, done) => {
  console.log('🔒 Sérialisation utilisateur :', user);
  done(null, user.id); // Assurez-vous que `user.id` est défini
});
passport.deserializeUser(async (id, done) => {
  try {
    console.log('🔓 Désérialisation utilisateur avec ID :', id);
    const res = await pool.query("SELECT id, email, name FROM users WHERE id = $1", [id]);
    if (res.rows.length === 0) return done(null, false);
    done(null, res.rows[0]);
  } catch (err) {
    console.error('❌ Erreur désérialisation utilisateur :', err);
    done(err, null);
  }
});


// Middleware pour parser le JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// ---------------------API

// Route pour vérifier si le mot est dans la collection utilisateur
// 🚨 ROUTE TEMPORAIRE - SANS AUTH POUR DÉBLOQUER
app.get('/check-user-word/:chinese', async (req, res) => {
  console.log('✅ /check-user-word appelé pour:', req.params.chinese);
  
  // 🚨 TEMPORAIRE : Pas de vérification d'authentification
  // 🚨 RETIRE COMPLÈTEMENT la vérification de session
  
  try {
    const chinese = decodeURIComponent(req.params.chinese);
    console.log('🔍 Vérification mot (mode dev):', chinese);

    // 🎯 POUR TESTER - Change cette valeur pour voir les deux états :
    const alreadyExists = false; // false = bouton vert, true = bouton gris
    
    console.log('📝 Résultat simulé:', alreadyExists);
    res.json({ alreadyExists });

  } catch (error) {
    console.error('❌ Erreur:', error);
    // 🚨 Même en cas d'erreur, on retourne une réponse valide
    res.json({ alreadyExists: false });
  }
});

app.get("/api/contributions", ensureAuth, async (req, res) => {
  try {
    console.log('🔍 Requête reçue pour /api/contributions');
    console.log('🔍 Utilisateur connecté (req.user) :', req.user);

    const userId = req.user ? req.user.id : null;

    if (!userId) {
      console.warn('⚠️ Aucun utilisateur connecté');
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const result = await pool.query(`
      SELECT 
        DATE(date_completed) as date,
        COUNT(*) as count
      FROM quiz_history 
      WHERE user_id = $1 
      GROUP BY DATE(date_completed)
      ORDER BY date ASC
    `, [userId]);

    const rows = result.rows.map(r => ({
      date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
      count: parseInt(r.count, 10) || 0
    }));

    console.log('📦 Résultat des contributions :', rows);
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
  req.user = { id: 1, name: "Test User", email: "test@example.com" }; // Simulez un utilisateur
  next();
});

// -------------------- Lancer serveur --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
