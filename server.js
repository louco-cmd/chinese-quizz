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
const { sendPasswordResetEmail, sendVerificationEmail } = require('./middleware/mail.service');
const { withSubscription } = require('./middleware/subscription');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PostgreSQLStore = require('connect-pg-simple')(session);
const apiRoutes = require('./routes/api');
const { pool } = require('./config/database');
const { listenerCount } = require('process');
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
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') {
    // Pour le webhook, ne PAS parser le JSON
    next();
  } else {
    // Pour toutes les autres routes, parser normalement
    express.json()(req, res, next);
  }
});
// MIDDLEWARE GLOBAL pour capturer le body RAW
app.use('/webhook', express.raw({
  type: 'application/json',
  verify: (req, res, buf) => {
    // Sauvegarder le body brut pour la vérification
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ extended: true }));
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
  saveUninitialized: true, // ⬅️ IMPORTANT: false pour la sécurité
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
app.use(async (req, res, next) => {
  if (!req.isAuthenticated()) {
    res.locals.balance = 0;
    res.locals.isPremium = false;
    return next();
  }

  try {
    // Vérifier l'abonnement avec notre logique d'interprétation
    const subResult = await pool.query(`
      SELECT 
        plan_name,
        status,
        stripe_status,
        cancel_at_period_end,
        current_period_end
      FROM user_subscriptions 
      WHERE user_id = $1
    `, [req.user.id]);

    if (subResult.rows.length === 0) {
      res.locals.isPremium = false;
    } else {
      const sub = subResult.rows[0];
      const now = new Date();

      // NOTRE LOGIQUE D'INTERPRÉTATION
      let isPremium = false;

      if (sub.plan_name === 'premium' && sub.status === 'active') {
        // Vérifier si la période est expirée
        if (sub.current_period_end && new Date(sub.current_period_end) < now) {
          // Période expirée, mettre à jour
          await pool.query(`
            UPDATE user_subscriptions 
            SET plan_name = 'free', status = 'expired', updated_at = NOW()
            WHERE user_id = $1
          `, [req.user.id]);
          isPremium = false;
        } else {
          // Vérifier si annulé à la fin de la période
          if (sub.cancel_at_period_end === true) {
            console.log(`⚠️ User ${req.user.id}: Premium mais annulé à la fin`);
          }
          isPremium = true;
        }
      }

      res.locals.isPremium = isPremium;
    }

    // Solde
    const balanceResult = await pool.query(
      'SELECT balance FROM users WHERE id = $1',
      [req.user.id]
    );
    res.locals.balance = balanceResult.rows[0]?.balance || 0;

  } catch (err) {
    console.error('Erreur vérification abonnement:', err);
    res.locals.isPremium = false;
    res.locals.balance = 0;
  }

  next();
});
// Dans tes middlewares existants, remplace la partie complexe par:
app.use(async (req, res, next) => {
  if (!req.isAuthenticated()) {
    res.locals.balance = 0;
    res.locals.isPremium = false;
    return next();
  }

  try {
    // Vérifier l'abonnement
    const subResult = await pool.query(`
      SELECT 
        stripe_status,
        cancel_at_period_end,
        current_period_end
      FROM user_subscriptions 
      WHERE user_id = $1
    `, [req.user.id]);

    let isPremium = false;

    if (subResult.rows.length === 0) {
      // Pas d'abonnement = free
      isPremium = false;
    } else {
      const sub = subResult.rows[0];
      const now = new Date();

      // LOGIQUE SIMPLE :
      // Premium si stripe_status = 'active' ET période pas expirée
      if (sub.stripe_status === 'active') {
        if (sub.current_period_end && new Date(sub.current_period_end) < now) {
          // Période expirée, mettre à jour le statut
          await pool.query(`
            UPDATE user_subscriptions 
            SET stripe_status = 'expired', updated_at = NOW()
            WHERE user_id = $1
          `, [req.user.id]);
          isPremium = false;
        } else {
          isPremium = true;
        }
      } else {
        isPremium = false;
      }
    }

    // METTRE À JOUR req.user.planName (IMPORTANT !)
    req.user.planName = isPremium ? 'premium' : 'free';

    // Mettre à jour les variables locales
    res.locals.isPremium = isPremium;
    res.locals.user = req.user; // S'assurer que user est dans locals

    // Récupérer le solde
    const balanceResult = await pool.query(
      'SELECT balance FROM users WHERE id = $1',
      [req.user.id]
    );
    res.locals.balance = balanceResult.rows[0]?.balance || 0;

  } catch (err) {
    console.error('Erreur vérification abonnement:', err);
    res.locals.isPremium = false;
    res.locals.balance = 0;
    req.user.planName = 'free'; // Valeur par défaut en cas d'erreur
  }

  next();
});
app.use("/", apiRoutes);


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

// Dans votre server.js ou routes/auth.js
app.post('/auth/google/one-tap', async (req, res) => {
  try {
    // ✅ IMPORTANT: Ajoutez ces headers CORS
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ error: 'No credential provided' });
    }

    // Vérifiez le token Google
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();

    // Vérifiez ou créez l'utilisateur dans votre base de données
    const result = await pool.query(
      'SELECT id, email FROM users WHERE email = $1',
      [payload.email]
    );

    let user;

    if (result.rows.length === 0) {
      // Créer un nouvel utilisateur
      const newUser = await pool.query(
        `INSERT INTO users (email, provider, email_verified, balance)
         VALUES ($1, 'google', true, 100)
         RETURNING id, email`,
        [payload.email]
      );
      user = newUser.rows[0];
    } else {
      user = result.rows[0];
    }

    // Connectez l'utilisateur (avec Passport.js si vous l'utilisez)
    req.login(user, (err) => {
      if (err) {
        return res.status(500).json({ error: 'Login failed' });
      }

      // ✅ IMPORTANT: Envoyer une réponse JSON valide
      res.json({
        success: true,
        redirect: '/dashboard'
      });
    });

  } catch (err) {
    console.error('💥 Google One Tap error:', err);
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
});

app.post('/auth/logout', (req, res) => {
  // Vérifier si l'utilisateur est connecté
  if (!req.isAuthenticated()) {
    return res.json({ success: true, message: 'Already logged out' });
  }

  console.log(`👋 Déconnexion de l'utilisateur: ${req.user?.email || 'Unknown'}`);

  // Déconnexion avec Passport
  req.logout((err) => {
    if (err) {
      console.error('❌ Erreur lors de la déconnexion Passport:', err);
      // On continue quand même pour nettoyer la session
    }

    // Destruction de la session
    req.session.destroy((destroyErr) => {
      if (destroyErr) {
        console.error('❌ Erreur lors de la destruction de session:', destroyErr);
        // On tente quand même de clear le cookie
      }

      // Clear le cookie de session
      res.clearCookie('connect.sid', {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
      });

      // Optionnel: Clear d'autres cookies spécifiques
      res.clearCookie('user_session');

      console.log('✅ Déconnexion réussie');
      res.json({
        success: true,
        redirect: '/'
      });
    });
  });
});

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

// Route de reinitialisation mot de passe
// Route pour demander une réinitialisation
app.post('/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email requis' });
    }

    // Vérifier si l'utilisateur existe
    const userResult = await pool.query(
      'SELECT id, email FROM users WHERE email = $1 AND provider = $2',
      [email, 'local']
    );

    if (userResult.rows.length === 0) {
      // Pour la sécurité, ne pas révéler si l'email existe ou non
      return res.json({
        success: true,
        message: 'Si votre email est associé à un compte, vous recevrez un lien de réinitialisation'
      });
    }

    const user = userResult.rows[0];

    // Générer un token unique
    const token = crypto.randomBytes(32).toString('hex');

    // Supprimer les anciens tokens non utilisés
    await pool.query(
      'DELETE FROM password_reset_tokens WHERE user_id = $1 AND (expires_at < NOW() OR used = true)',
      [user.id]
    );

    // Créer un nouveau token
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [user.id, token]
    );

    // Envoyer l'email
    await sendPasswordResetEmail(user.email, token);

    res.json({
      success: true,
      message: 'Si votre email est associé à un compte, vous recevrez un lien de réinitialisation'
    });

  } catch (err) {
    console.error('💥 Erreur forgot-password:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// Vérifier si le token est valide
app.get('/auth/verify-reset-token', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ valid: false, error: 'Token manquant' });
    }

    const result = await pool.query(
      `SELECT prt.*, u.email 
       FROM password_reset_tokens prt
       JOIN users u ON prt.user_id = u.id
       WHERE prt.token = $1 
         AND prt.expires_at > NOW() 
         AND prt.used = false`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.json({
        valid: false,
        error: 'Token invalide ou expiré'
      });
    }

    res.json({
      valid: true,
      email: result.rows[0].email
    });

  } catch (err) {
    console.error('💥 Erreur verify-reset-token:', err);
    res.status(500).json({ valid: false, error: 'Erreur serveur' });
  }
});
// Réinitialiser le mot de passe
app.post('/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token et nouveau mot de passe requis' });
    }

    // Vérifier les critères du mot de passe
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        error: 'Mot de passe : 8 caractères min, 1 majuscule, 1 chiffre'
      });
    }

    // Vérifier le token
    const tokenResult = await pool.query(
      `SELECT * FROM password_reset_tokens 
       WHERE token = $1 
         AND expires_at > NOW() 
         AND used = false`,
      [token]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ error: 'Token invalide ou expiré' });
    }

    const resetToken = tokenResult.rows[0];
    const userId = resetToken.user_id;

    // Hasher le nouveau mot de passe
    const hash = await bcrypt.hash(newPassword, 10);

    // Mettre à jour le mot de passe
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hash, userId]
    );

    // Marquer le token comme utilisé
    await pool.query(
      'UPDATE password_reset_tokens SET used = true WHERE id = $1',
      [resetToken.id]
    );

    // Supprimer tous les tokens de réinitialisation pour cet utilisateur
    await pool.query(
      'DELETE FROM password_reset_tokens WHERE user_id = $1',
      [userId]
    );

    res.json({
      success: true,
      message: 'Mot de passe réinitialisé avec succès'
    });

  } catch (err) {
    console.error('💥 Erreur reset-password:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
// Route pour afficher la page de réinitialisation
app.get('/auth/reset-password', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.redirect('/forgot-password');
    }

    // Vérifier si le token est valide
    const result = await pool.query(
      `SELECT prt.*, u.email 
       FROM password_reset_tokens prt
       JOIN users u ON prt.user_id = u.id
       WHERE prt.token = $1 
         AND prt.expires_at > NOW() 
         AND prt.used = false`,
      [token]
    );

    if (result.rows.length === 0) {
      // Token invalide ou expiré
      return res.render('reset-password', {
        error: 'Invalid or expired reset link. Please request a new one.',
        token: null,
        email: null
      });
    }

    const resetToken = result.rows[0];

    // Rendre la page avec le token et l'email
    res.render('reset-password', {
      error: null,
      token: resetToken.token,
      email: resetToken.email
    });

  } catch (err) {
    console.error('❌ Erreur reset-password page:', err);
    res.render('reset-password', {
      error: 'An error occurred. Please try again.',
      token: null,
      email: null
    });
  }
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

app.get('/tutorial', (req, res) => {
  res.render('tutorial', { user: req.user, balance: req.user?.balance });
});

app.get('/dashboard', ensureAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    const userRes = await pool.query('SELECT name, balance, last_login FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0] || {};

    // Récupérer le solde
    const balance = user.balance || 0;


    console.log('📊 Rendering dashboard with:', {
      userId,
      name: user.name,
      balance,
      currentPage: 'dashboard'
    });

    res.render('dashboard', {
      user: req.user,        // ← Passez req.user comme "user"
      userData: {            // ← Gardez pour compatibilité
        name: user.name || 'Friend',
        balance: balance,
        lastLogin: user.last_login
      },
      balance: balance,      // ← Passez aussi balance directement
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

    // Récupérer le solde de l'utilisateur
    const balanceResult = await pool.query(
      'SELECT balance FROM users WHERE id = $1',
      [userId]
    );
    const balance = balanceResult.rows[0]?.balance || 0;

    res.render('collection', {
      user: req.user,        // ← AJOUTEZ CE CI
      balance: balance,      // ← AJOUTEZ CE CI
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

app.get('/duels', ensureAuth, async (req, res) => {
  let players = [];
  try {
    console.log('📄 Chargement page classement SIMPLIFIÉ');
    const results = await pool.query(`
        SELECT 
        u.id,
        u.name,
        u.email,
        u.country,
        u.tagline,
        COALESCE(um.word_count, 0) AS total_words,   -- évite NULL
        COUNT(CASE WHEN d.status = 'completed' AND (
            (d.challenger_id = u.id AND d.challenger_score > d.opponent_score) OR
            (d.opponent_id = u.id AND d.opponent_score > d.challenger_score)
        ) THEN 1 END) AS wins,
        COUNT(CASE WHEN d.status = 'completed' AND (
            (d.challenger_id = u.id AND d.challenger_score < d.opponent_score) OR
            (d.opponent_id = u.id AND d.opponent_score < d.challenger_score)
        ) THEN 1 END) AS losses,
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
        END AS ratio
    FROM users u
    LEFT JOIN duels d 
        ON (d.challenger_id = u.id OR d.opponent_id = u.id)
        AND d.status = 'completed'
        -- 🔽 Filtre sur l'année en cours (adaptez le nom de la colonne si nécessaire)
        AND EXTRACT(YEAR FROM d.created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
    LEFT JOIN (
        SELECT user_id, COUNT(*) AS word_count 
        FROM user_mots 
        GROUP BY user_id
    ) um ON um.user_id = u.id
    WHERE u.name IS NOT NULL
    GROUP BY u.id, u.name, u.email, u.country, u.tagline, um.word_count
    ORDER BY 
        wins DESC, 
        total_words DESC, 
        ratio DESC, 
        u.name
    LIMIT 10;
`);
    players = results.rows;
    console.log(`✅ ${players.rows.length} joueurs chargés (version simple)`);

  } catch (err) {
    console.error('❌ Erreur simple page classement:', err.message);
  }

  res.render('duels', {
    user: req.user,
    players: players,  // ← LES DONNÉES
    currentUserId: req.user.id,
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
  let players = [];
  try {
    console.log('📄 Chargement page classement SIMPLIFIÉ');
    // REQUÊTE ULTRA SIMPLE POUR COMMENCER
    const results = await pool.query(`
              SELECT 
          u.id,
          u.name,
          u.email,
          u.country,
          u.tagline,
          COALESCE(um.word_count, 0) AS total_words,   -- évite NULL
          COUNT(CASE WHEN d.status = 'completed' AND (
              (d.challenger_id = u.id AND d.challenger_score > d.opponent_score) OR
              (d.opponent_id = u.id AND d.opponent_score > d.challenger_score)
          ) THEN 1 END) AS wins,
          COUNT(CASE WHEN d.status = 'completed' AND (
              (d.challenger_id = u.id AND d.challenger_score < d.opponent_score) OR
              (d.opponent_id = u.id AND d.opponent_score < d.challenger_score)
          ) THEN 1 END) AS losses,
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
          END AS ratio
      FROM users u
      LEFT JOIN duels d 
          ON (d.challenger_id = u.id OR d.opponent_id = u.id)
          AND d.status = 'completed'
          -- 🔽 Filtre sur l'année en cours (adaptez le nom de la colonne si nécessaire)
          AND EXTRACT(YEAR FROM d.created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
      LEFT JOIN (
          SELECT user_id, COUNT(*) AS word_count 
          FROM user_mots 
          GROUP BY user_id
      ) um ON um.user_id = u.id
      WHERE u.name IS NOT NULL
      GROUP BY u.id, u.name, u.email, u.country, u.tagline, um.word_count
      ORDER BY 
          wins DESC, 
          total_words DESC, 
          ratio DESC, 
          u.name
      LIMIT 100;
`);
    players = results.rows;
    console.log(`✅ ${players.rows.length} joueurs chargés (version simple)`);

  } catch (err) {
    console.error('❌ Erreur simple page classement:', err.message);
  }
  res.render('leaderboard', {
    user: req.user,
    players: players,  // ← LES DONNÉES
    currentUserId: req.user.id,
    currentPage: 'leaderboard',
    title: 'Classement des Joueurs - Jiayou'
  });
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

// Routes pour les pages
app.get('/forgot-password', (req, res) => {
  res.render('forgot-password');
});

app.get('/auth/reset-password', (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.redirect('/forgot-password');
  }
  res.render('reset-password', { token });
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

// Page de pricing
app.get('/pricing', ensureAuth, async (req, res) => {
  try {
    // Récupérer les plans depuis la base
    const plansResult = await pool.query(
      'SELECT * FROM subscription_plans WHERE is_active = true ORDER BY display_order'
    );

    // Récupérer l'abonnement actuel de l'utilisateur
    const subResult = await pool.query(`
      SELECT 
        stripe_status,
        stripe_customer_id,
        stripe_subscription_id,
        current_period_end,
        cancel_at_period_end,
        updated_at
      FROM user_subscriptions 
      WHERE user_id = $1
    `, [req.user.id]);

    const userSubscription = subResult.rows[0] || null;

    // ⚠️ LOGIQUE CORRIGÉE : Utiliser la même logique que withSubscription
    let isPremium = false;
    let hasInactiveSubscription = false;
    let subscriptionStatus = 'none';

    if (userSubscription) {
      subscriptionStatus = userSubscription.stripe_status;

      // Si le statut Stripe est 'active', alors premium = true
      if (userSubscription.stripe_status === 'active') {
        isPremium = true;
        hasInactiveSubscription = false;
      } else {
        // Tous les autres statuts sont inactifs
        isPremium = false;
        hasInactiveSubscription = true;
      }
    }

    // Récupérer le solde
    const balanceResult = await pool.query(
      'SELECT balance FROM users WHERE id = $1',
      [req.user.id]
    );
    const balance = balanceResult.rows[0]?.balance || 0;

    res.render('pricing', {
      user: req.user,
      plans: plansResult.rows,
      currentPage: 'pricing',
      isPremium: isPremium,
      hasInactiveSubscription: hasInactiveSubscription,
      subscriptionStatus: subscriptionStatus,
      userSubscription: userSubscription,
      balance: balance
    });
  } catch (err) {
    console.error('Error loading pricing page:', err);
    res.render('pricing', {
      user: req.user,
      plans: [],
      currentPage: 'pricing',
      isPremium: false,
      hasInactiveSubscription: false,
      subscriptionStatus: 'none',
      userSubscription: null,
      balance: 0
    });
  }
});

app.get('/subscribe', ensureAuth, async (req, res) => {
  try {
    const { plan } = req.query;

    if (!plan) {
      return res.redirect('/pricing');
    }

    // Vérifier que BASE_URL est défini
    if (!process.env.BASE_URL) {
      console.error('❌ BASE_URL non défini dans .env');
      return res.status(500).send('Configuration serveur manquante');
    }

    // S'assurer que BASE_URL a un schéma
    let baseUrl = process.env.BASE_URL;
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      baseUrl = `http://${baseUrl}`; // Par défaut http
      console.warn(`⚠️  BASE_URL sans schéma, ajouté automatiquement: ${baseUrl}`);
    }

    let priceID;
    switch (plan.toLowerCase()) {
      case 'premium':
        priceID = process.env.STRIPE_PRICE_PREMIUM;
        break;
      default:
        return res.redirect('/pricing');
    }

    // Vérifier que priceID est défini
    if (!priceID) {
      console.error('❌ STRIPE_PRICE_PREMIUM non défini dans .env');
      return res.status(500).send('Configuration Stripe manquante');
    }

    console.log(`🎯 Création de session pour ${req.user.email}, plan: ${plan}`);
    console.log(`🌐 Base URL: ${baseUrl}`);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: priceID,
          quantity: 1
        }
      ],
      success_url: `${baseUrl}/welcome-jiayou-premium?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/pricing`,
      customer_email: req.user.email,
      metadata: {
        userId: req.user.id.toString(),
        planName: plan
      }
    });

    console.log('✅ Stripe session created:', session.id);
    console.log('🔗 URL de checkout:', session.url);

    // REDIRIGER vers l'URL de checkout !!!
    res.redirect(session.url);

  } catch (error) {
    console.error('❌ Erreur lors de la création de la session Stripe:', error.message);
    console.error('Stack:', error.stack);

    // Gestion d'erreur plus détaillée
    if (error.type === 'StripeInvalidRequestError') {
      return res.status(400).send(`
        <h1>Erreur de configuration Stripe</h1>
        <p>${error.message}</p>
        <p>Vérifiez que vos clés Stripe et price_id sont corrects.</p>
        <a href="/pricing">Retour aux tarifs</a>
      `);
    }

    res.status(500).send(`
      <h1>Erreur interne</h1>
      <p>${error.message}</p>
      <a href="/pricing">Retour aux tarifs</a>
    `);
  }
});

// Route pour créer une session de portail client Stripe
app.post('/create-portal-session', ensureAuth, async (req, res) => {
  try {
    // Trouver le customer_id de l'utilisateur
    const subResult = await pool.query(
      'SELECT stripe_customer_id FROM user_subscriptions WHERE user_id = $1 LIMIT 1',
      [req.user.id]
    );

    if (subResult.rows.length === 0 || !subResult.rows[0].stripe_customer_id) {
      return res.status(400).json({ error: 'No subscription found' });
    }

    const customerId = subResult.rows[0].stripe_customer_id;

    // Créer la session du portail
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.BASE_URL}/account`,
    });

    res.json({ url: portalSession.url });
  } catch (error) {
    console.error('Error creating portal session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Page de succès après paiement
app.get('/welcome-jiayou-premium', ensureAuth, async (req, res) => {
  const { session_id } = req.query;

  try {
    // DEBUG
    console.log(`🎯 Page de bienvenue pour user ${req.user.id}, session: ${session_id || 'none'}`);

    // Vérifier si l'utilisateur a déjà un abonnement premium
    const existingSub = await pool.query(`
      SELECT * FROM user_subscriptions 
      WHERE user_id = $1 
      AND plan_name = 'premium'
      AND status = 'active'
      LIMIT 1
    `, [req.user.id]);

    // Si pas d'abonnement mais on a une session Stripe, vérifier Stripe
    if (existingSub.rows.length === 0 && session_id) {
      try {
        const session = await stripe.checkout.sessions.retrieve(session_id);

        if (session.payment_status === 'paid' && session.subscription) {
          // Le paiement est OK, créer l'abonnement en base
          console.log(`💰 Paiement confirmé, création abonnement pour user ${req.user.id}`);

          await pool.query(`
            INSERT INTO user_subscriptions (
              user_id,
              plan_name,
              status,
              stripe_customer_id,
              stripe_subscription_id,
              metadata,
              created_at,
              updated_at
            ) VALUES ($1, 'premium', 'active', $2, $3, $4, NOW(), NOW())
            ON CONFLICT (user_id) 
            DO UPDATE SET
              plan_name = 'premium',
              status = 'active',
              stripe_customer_id = EXCLUDED.stripe_customer_id,
              stripe_subscription_id = EXCLUDED.stripe_subscription_id,
              metadata = EXCLUDED.metadata,
              updated_at = NOW()
          `, [
            req.user.id,
            session.customer,
            session.subscription,
            JSON.stringify({
              created_via: 'welcome_page',
              session_id: session_id,
              payment_date: new Date().toISOString()
            })
          ]);
        }
      } catch (stripeError) {
        console.error('Erreur Stripe:', stripeError.message);
        // Continuer quand même
      }
    }

    // Récupérer l'abonnement (peut avoir été créé juste au-dessus)
    const finalSub = await pool.query(`
      SELECT * FROM user_subscriptions 
      WHERE user_id = $1 
      AND plan_name = 'premium'
      LIMIT 1
    `, [req.user.id]);

    // Toujours afficher la page de bienvenue, même sans abonnement en base
    // (le webhook peut arriver plus tard)
    res.render('welcome-jiayou-premium', {
      user: req.user,
      subscription: finalSub.rows[0] || null,
      sessionId: session_id,
      currentPage: 'account',
      isPremium: finalSub.rows.length > 0
    });

  } catch (error) {
    console.error('Error processing welcome page:', error);

    // Fallback: afficher la page quand même
    res.render('welcome-jiayou-premium', {
      user: req.user,
      subscription: null,
      currentPage: 'account',
      isPremium: false
    });
  }
});

app.get('/check-subscription-dates', ensureAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Vérifier l'abonnement en base
    const subResult = await pool.query(`
      SELECT 
        id,
        plan_name,
        status,
        current_period_start,
        current_period_end,
        stripe_subscription_id,
        created_at,
        updated_at,
        metadata
      FROM user_subscriptions 
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [userId]);

    if (subResult.rows.length === 0) {
      return res.json({ message: 'Aucun abonnement trouvé' });
    }

    const subscription = subResult.rows[0];

    // Vérifier Stripe
    let stripeData = null;
    if (subscription.stripe_subscription_id) {
      try {
        const stripeSub = await stripe.subscriptions.retrieve(
          subscription.stripe_subscription_id
        );
        stripeData = {
          id: stripeSub.id,
          status: stripeSub.status,
          current_period_start: new Date(stripeSub.current_period_start * 1000),
          current_period_end: new Date(stripeSub.current_period_end * 1000),
          cancel_at_period_end: stripeSub.cancel_at_period_end
        };
      } catch (stripeError) {
        stripeData = { error: stripeError.message };
      }
    }

    res.json({
      database: subscription,
      stripe: stripeData,
      comparison: stripeData ? {
        dates_match:
          subscription.current_period_start?.getTime() === stripeData.current_period_start?.getTime() &&
          subscription.current_period_end?.getTime() === stripeData.current_period_end?.getTime(),
        status_match: subscription.status === stripeData.status
      } : null
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/webhook',
  async (req, res) => {
    console.log('=== WEBHOOK REÇU ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body length:', req.body.length);

    const sig = req.headers['stripe-signature'];

    if (!sig) {
      console.error('❌ Pas de signature Stripe');
      return res.status(400).send('No Stripe signature');
    }

    let event;
    try {
      // Log le body pour vérification
      console.log('📝 Body (preview):', req.body.toString().substring(0, 500));

      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      console.log(`✅ Signature OK: ${event.type} (${event.id})`);
      console.log('📦 Event data:', JSON.stringify(event.data.object, null, 2));

    } catch (err) {
      console.error('❌ Erreur signature:', err.message);
      console.error('🔍 Erreur complète:', err);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Traitement de l'événement
    try {
      console.log(`🎯 Traitement: ${event.type}`);

      switch (event.type) {
        case 'checkout.session.completed':
          console.log('💳 Détails checkout:', {
            customer: event.data.object.customer,
            subscription: event.data.object.subscription,
            metadata: event.data.object.metadata
          });
          await handleCheckoutSessionCompleted(event.data.object);
          break;

        case 'customer.subscription.created':
          console.log('🆕 Subscription created:', event.data.object.id);
          await handleSubscriptionEvent(event.data.object, event.type);
          break;

        case 'customer.subscription.updated':
          console.log('🔄 Subscription updated details:', {
            id: event.data.object.id,
            status: event.data.object.status,
            cancel_at_period_end: event.data.object.cancel_at_period_end,
            current_period_end: event.data.object.current_period_end
          });
          await handleSubscriptionEvent(event.data.object, event.type);
          break;

        case 'customer.subscription.deleted':
          console.log('🗑️ Subscription deleted:', event.data.object.id);
          await handleSubscriptionEvent(event.data.object, event.type);
          break;

        // ... autres cas ...
      }

      console.log('=== WEBHOOK RÉUSSI ===');
      res.json({ received: true });

    } catch (error) {
      console.error('💥 Erreur traitement:', error);
      console.error('Stack:', error.stack);
      res.status(500).json({ error: 'Internal error' });
    }
  }
);


async function handleCheckoutSessionCompleted(session) {
  try {
    console.log('💳 Checkout complété:', session.id);

    // Récupérer l'email du client
    const customerEmail = session.customer_email || session.customer_details?.email;

    if (!customerEmail) {
      console.error('❌ Pas d\'email client dans la session');
      return;
    }

    console.log('📧 Email client:', customerEmail);

    // Trouver l'utilisateur
    const userResult = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [customerEmail]
    );

    if (userResult.rows.length === 0) {
      console.error('❌ Utilisateur non trouvé:', customerEmail);
      return;
    }

    const userId = userResult.rows[0].id;
    console.log('👤 User ID:', userId);

    // Récupérer la subscription depuis Stripe pour avoir les dates
    if (session.subscription) {
      try {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        await handleSubscriptionEvent(subscription, 'checkout.session.completed');
      } catch (err) {
        console.error('Erreur récupération subscription:', err.message);

        // Fallback: créer une ligne de base sans les dates
        await pool.query(`
          INSERT INTO user_subscriptions (
            user_id,
            plan_name,
            status,
            stripe_status,
            stripe_customer_id,
            stripe_subscription_id,
            created_at,
            updated_at
          ) VALUES ($1, 'premium', 'active', 'active', $2, $3, NOW(), NOW())
          ON CONFLICT (user_id) 
          DO UPDATE SET
            plan_name = 'premium',
            status = 'active',
            stripe_status = 'active',
            stripe_customer_id = EXCLUDED.stripe_customer_id,
            stripe_subscription_id = EXCLUDED.stripe_subscription_id,
            updated_at = NOW()
        `, [
          userId,
          session.customer,
          session.subscription
        ]);

        console.log('✅ Abonnement créé (fallback) pour user', userId);
      }
    } else {
      console.error('❌ Pas de subscription_id dans la session');
    }

  } catch (error) {
    console.error('❌ Erreur handleCheckoutSessionCompleted:', error);
  }
}

// ==========================================
// 📝 HANDLER SUBSCRIPTION - VERSION SIMPLIFIÉE
// ==========================================
async function handleSubscriptionEvent(subscription, eventType) {
  console.log(`🔔 ${eventType.toUpperCase()} - ID: ${subscription.id}`);

  try {
    // 1. EXTRAIRE LES DATES
    let periodEnd = null;
    let periodStart = null;

    if (subscription.items?.data?.length > 0) {
      const firstItem = subscription.items.data[0];
      periodEnd = firstItem.current_period_end;
      periodStart = firstItem.current_period_start;
    }

    if (!periodEnd && subscription.current_period_end) {
      periodEnd = subscription.current_period_end;
    }
    if (!periodStart && subscription.current_period_start) {
      periodStart = subscription.current_period_start;
    }

    const periodEndDate = periodEnd ? new Date(periodEnd * 1000) : null;
    const periodStartDate = periodStart ? new Date(periodStart * 1000) : null;

    // Extraire cancel_at (date programmée) et canceled_at (date effective)
    const cancelAt = subscription.cancel_at; // Date d'annulation programmée
    const canceledAt = subscription.canceled_at || subscription.ended_at; // Date d'annulation effective

    const cancelAtDate = cancelAt ? new Date(cancelAt * 1000) : null;
    const canceledAtDate = canceledAt ? new Date(canceledAt * 1000) : null;

    // 2. TROUVER L'UTILISATEUR
    let userId = null;
    let result = await pool.query(
      `SELECT user_id FROM user_subscriptions WHERE stripe_customer_id = $1`,
      [subscription.customer]
    );

    if (result.rows.length === 0) {
      // Si pas trouvé, chercher par email Stripe
      let email = subscription.customer_email || subscription.customer_details?.email;
      if (!email && subscription.customer) {
        // Récupérer le customer Stripe pour avoir l'email
        try {
          const customer = await stripe.customers.retrieve(subscription.customer);
          email = customer.email;
        } catch (e) {
          console.error('❌ Impossible de récupérer le customer Stripe:', e.message);
        }
      }
      if (email) {
        const userRes = await pool.query(
          'SELECT id FROM users WHERE email = $1',
          [email]
        );
        if (userRes.rows.length > 0) {
          userId = userRes.rows[0].id;
        }
      }
      if (!userId) {
        console.log('❌ User non trouvé pour customer:', subscription.customer);
        return false;
      }
    } else {
      userId = result.rows[0].user_id;
    }

    console.log('👤 User trouvé:', userId);

    // 3. LOGIQUE D'INTERPRÉTATION
    const stripeStatus = subscription.status;
    const cancelAtPeriodEnd =
      (subscription.cancel_at_period_end === true) ||
      (
        typeof subscription.cancel_at === 'number' &&
        subscription.cancel_at > Math.floor(Date.now() / 1000)
      );
    console.log('📊 Analyse annulation:', {
      stripe_status: stripeStatus,
      cancel_at_period_end: cancelAtPeriodEnd,
      cancel_at: cancelAtDate?.toISOString(),
      canceled_at: canceledAtDate?.toISOString()
    });

    // 4. DÉTERMINER LE PLAN
    let planName = 'free';
    let ourStatus = stripeStatus;

    if (stripeStatus === 'active') {
      planName = 'premium';
      ourStatus = 'active';

      if (cancelAtPeriodEnd) {
        console.log(`⚠️ Annulation programmée pour la fin de la période`);
      }
    } else {
      planName = 'free';
      console.log(`🔴 Abonnement terminé (${stripeStatus})`);
    }

    // 5. MISE À JOUR DE LA BASE AVEC LES BONS NOMS DE COLONNES
    // -> Utiliser RETURNING pour contrôler la mise à jour, et fallback INSERT si besoin
    const updateQuery = `
      UPDATE user_subscriptions 
      SET 
        plan_name = $1,
        status = $2,
        stripe_status = $3,
        current_period_start = $4,
        current_period_end = $5,
        cancel_at_period_end = $6,
        canceled_at = $7,
        stripe_subscription_id = $8,
        updated_at = NOW()
      WHERE user_id = $9
      RETURNING id, stripe_status, status, plan_name
    `;
    const updateParams = [
      planName,
      ourStatus,
      ourStatus,
      periodStartDate,
      periodEndDate,
      cancelAtPeriodEnd,
      canceledAtDate,
      subscription.id,
      userId
    ];

    const updateResult = await pool.query(updateQuery, updateParams);

    if (updateResult.rowCount === 0) {
      console.log('⚠️ Aucun enregistrement mis à jour (user_id mismatch?). Tentative d\'INSERT / upsert.');
      // Tentative d'INSERT si la ligne n'existe pas pour l'user_id
      const insertQuery = `
        INSERT INTO user_subscriptions (
          user_id,
          plan_name,
          status,
          stripe_status,
          current_period_start,
          current_period_end,
          cancel_at_period_end,
          canceled_at,
          stripe_subscription_id,
          stripe_customer_id,
          created_at,
          updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          plan_name = EXCLUDED.plan_name,
          status = EXCLUDED.status,
          stripe_status = EXCLUDED.stripe_status,
          current_period_start = EXCLUDED.current_period_start,
          current_period_end = EXCLUDED.current_period_end,
          cancel_at_period_end = EXCLUDED.cancel_at_period_end,
          canceled_at = EXCLUDED.canceled_at,
          stripe_subscription_id = EXCLUDED.stripe_subscription_id,
          stripe_customer_id = EXCLUDED.stripe_customer_id,
          updated_at = NOW()
        RETURNING id, stripe_status, status, plan_name
      `;
      const insertParams = [
        userId,
        planName,
        ourStatus,
        ourStatus,
        periodStartDate,
        periodEndDate,
        cancelAtPeriodEnd,
        canceledAtDate,
        subscription.id,
        subscription.customer
      ];
      const insertResult = await pool.query(insertQuery, insertParams);
      console.log('✅ Insert/Upsert result:', insertResult.rows[0]);
    } else {
      console.log('✅ Base mise à jour (UPDATE):', updateResult.rows[0]);
    }

    return true;

  } catch (error) {
    console.error('💥 ERREUR handleSubscriptionEvent:');
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  }
}

async function expireFinishedSubscriptions() {
  try {
    console.log('🕐 Vérification des abonnements à expirer...');

    const result = await pool.query(`
      UPDATE user_subscriptions
      SET 
        plan_name = 'free',
        status = 'expired',
        stripe_status = 'expired',
        updated_at = NOW()
      WHERE 
        plan_name = 'premium'
        AND status = 'active_canceling'
        AND current_period_end < NOW()
      RETURNING user_id, current_period_end, stripe_subscription_id
    `);

    if (result.rows.length > 0) {
      console.log(`⏰ ${result.rows.length} abonnement(s) expiré(s):`, result.rows);
    } else {
      console.log('✅ Aucun abonnement à expirer');
    }
  } catch (error) {
    console.error('❌ Erreur expireFinishedSubscriptions:', error);
  }
}

// Exécuter toutes les heures
setInterval(expireFinishedSubscriptions, 60 * 60 * 1000);

// ==========================================
// 🔄 SYNCHRONISATION STRIPE
// ==========================================
async function syncStripeSubscriptions() {
  try {
    console.log('🔄 Synchronisation des abonnements Stripe...');

    const dbSubs = await pool.query(`
      SELECT stripe_subscription_id, user_id, stripe_status
      FROM user_subscriptions 
      WHERE stripe_subscription_id IS NOT NULL 
      AND status NOT IN ('canceled', 'expired')
    `);

    console.log(`📊 ${dbSubs.rows.length} abonnements à vérifier`);

    for (const sub of dbSubs.rows) {
      try {
        const stripeSub = await stripe.subscriptions.retrieve(
          sub.stripe_subscription_id,
          { expand: ['latest_invoice'] }
        );

        if (sub.stripe_status !== stripeSub.status) {
          console.log(`🔄 Mise à jour nécessaire pour ${sub.stripe_subscription_id}`);
          await handleSubscriptionEvent(stripeSub, 'sync');
        }
      } catch (stripeError) {
        if (stripeError.type === 'StripeInvalidRequestError') {
          console.log(`❌ Abonnement ${sub.stripe_subscription_id} non trouvé chez Stripe`);
          await pool.query(`
            UPDATE user_subscriptions 
            SET status = 'canceled', plan_name = 'free', updated_at = NOW()
            WHERE stripe_subscription_id = $1
          `, [sub.stripe_subscription_id]);
        }
      }
    }
  } catch (error) {
    console.error('❌ Erreur syncStripeSubscriptions:', error);
  }
}

// Exécuter toutes les heures
setInterval(syncStripeSubscriptions, 60 * 60 * 1000);



app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔗 Webhook endpoint: http://localhost:${PORT}/webhook`);
});