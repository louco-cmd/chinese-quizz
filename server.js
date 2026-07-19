require('dotenv').config();
const { Resend } = require('resend');

const resend = new Resend(process.env.SMTP_PASSWORD);
const path = require("path");
const express = require("express");
const compression = require("compression");
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
const { sendPasswordResetEmail, sendVerificationEmail, sendReengagementEmail } = require('./middleware/mail.service');
const { withSubscription } = require('./middleware/subscription');
const { initVapid, sendPushToUser } = require('./middleware/push.service');
initVapid();
const cron = require('node-cron');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PostgreSQLStore = require('connect-pg-simple')(session);
const { router: mobileRoutes } = require('./routes/mobile');
const { pool } = require('./config/database');
const { listenerCount } = require('process');
const app = express();
app.set('trust proxy', 1); // Pour les déploiements derrière un proxy (Heroku, Render, etc.)
app.use(compression()); // gzip/brotli sur HTML, CSS, JS, JSON → ~4x moins de transfert
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
// Cache headers : on cache agressivement les assets immuables, mais on garde
// frais le service worker, le manifeste et les JS applicatifs (mises à jour instantanées).
const publicCacheControl = (res, filePath) => {
  const base = path.basename(filePath);
  // Le SW et le manifeste doivent toujours être revérifiés pour propager les MAJ
  if (base === 'sw.js' || base === 'manifest.json' || base.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache');
    return;
  }
  // JS applicatif : on garde frais (pas de hash dans les noms de fichiers)
  if (filePath.includes(path.sep + 'js' + path.sep)) {
    res.setHeader('Cache-Control', 'no-cache');
    return;
  }
  // Images, polices, icônes, CSS : cache long
  res.setHeader('Cache-Control', 'public, max-age=2592000'); // 30 jours
};

// dotfiles: 'allow' pour servir .well-known/assetlinks.json (requis pour Android TWA)
app.use(express.static(path.join(__dirname, "public"), { dotfiles: 'allow', setHeaders: publicCacheControl }));
// Vendor (Bootstrap, icons) : versionné par npm → immuable, cache 1 an
const vendorOpts = { maxAge: '1y', immutable: true };
app.use('/vendor/bootstrap/css', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/css'), vendorOpts));
app.use('/vendor/bootstrap/js', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/js'), vendorOpts));
app.use('/vendor/bootstrap-icons/font', express.static(path.join(__dirname, 'node_modules/bootstrap-icons/font'), vendorOpts));
// ── App web React (Expo web) ──────────────────────────────────────────────
// Cutover de la migration : quand SERVE_WEB_APP=true, Express sert le bundle
// buildé (mobile/dist) et laisse le SPA gérer toutes les routes applicatives.
// Les routes /api, /auth, /webhook + les pages publiques EJS (/legal, /support)
// restent servies par le serveur. Flag OFF → comportement EJS actuel inchangé
// (rollback instantané en désactivant la variable d'env sur Render).
if (process.env.SERVE_WEB_APP === 'true') {
  const webDist = path.join(__dirname, 'mobile', 'dist');
  const indexHtml = path.join(webDist, 'index.html');
  // Le bundle doit avoir été généré au build (npm run build:web). S'il manque,
  // le Build Command Render n'a pas lancé build:web → on log clairement.
  if (!require('fs').existsSync(indexHtml)) {
    console.error('⚠️  SERVE_WEB_APP=true mais ' + indexHtml + ' est absent.');
    console.error('    → Ajoute "npm run build:web" au Build Command Render (npm install && npm run build:web).');
  }
  // Assets buildés (JS/CSS/fonts) : noms hashés → cache immuable 1 an.
  // index.html : JAMAIS mis en cache (sinon après un deploy, un visiteur avec
  // l'ancien index.html en cache pointe vers des assets hashés disparus → écran
  // blanc). index:false → '/' passe par le fallback SPA ci-dessous.
  app.use(express.static(webDist, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));

  const PASSTHROUGH = ['/api', '/auth', '/webhook', '/vendor'];
  const PUBLIC_EJS = new Set(['/legal', '/support', '/delete-account', '/privacy']);
  // Express 5 : pas de wildcard string ('*') → middleware sans path.
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    // Laisse passer l'API et les pages publiques EJS vers leurs handlers.
    if (PASSTHROUGH.some((p) => req.path === p || req.path.startsWith(p + '/'))) return next();
    if (PUBLIC_EJS.has(req.path)) return next();
    // Tout le reste = SPA React (navigation state-based côté client).
    if (!require('fs').existsSync(indexHtml)) {
      return res.status(503).send('Web app non buildée : lance "npm run build:web" au déploiement.');
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(session({
  store: new PostgreSQLStore({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true,
    pruneSessionInterval: false,
    ttl: 7 * 24 * 60 * 60
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  name: 'jiayou.sid',
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true, //TRUE in prod
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
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

// Parrainage : mémorise le code (?ref=CODE) d'un visiteur non connecté dans sa
// session. Il survit au détour OAuth Google et sera consommé à la fin de
// l'onboarding (cf. /api/user/complete-onboarding). Premier code vu = gardé.
app.use((req, res, next) => {
  const ref = req.query && req.query.ref;
  if (ref && !req.user && req.session && !req.session.pendingRef) {
    req.session.pendingRef = String(ref).trim().slice(0, 12);
  }
  next();
});

// Expose isPremium / isSpecialGuest / balance aux vues EJS
const i18n = require('./config/i18n');
app.use(async (req, res, next) => {
  res.locals.isPremium      = false;
  res.locals.isSpecialGuest = false;
  res.locals.balance        = 0;
  res.locals.user           = req.user || null;
  res.locals.vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
  res.locals.quizDirection  = req.user?.quiz_direction || 'en→zh';
  res.locals.onboardingDone = req.user?.onboarding_done || false;
  res.locals.ghostMode            = req.user?.ghost_mode || false;
  res.locals.notificationsEnabled = req.user?.notifications_enabled || false;
  res.locals.wordReviewEnabled    = req.user?.word_review_enabled || false;
  // Langue de l'interface : découplée de la direction d'apprentissage.
  // Priorité à interface_lang ; sinon on dérive de la direction (comptes non backfillés).
  const uiLang = (req.user?.interface_lang === 'zh' || req.user?.interface_lang === 'en')
    ? req.user.interface_lang
    : (req.user?.quiz_direction === 'zh→en' ? 'zh' : 'en');
  res.locals.interfaceLang = uiLang;
  res.locals.t = i18n[uiLang];

  if (!req.isAuthenticated()) return next();

  try {
    // Une seule requête : abonnement + special_guest + balance
    const { rows } = await pool.query(`
      SELECT
        u.balance,
        u.special_guest,
        us.plan_name,
        us.stripe_status,
        us.status         AS sub_status,
        us.current_period_end
      FROM users u
      LEFT JOIN user_subscriptions us ON us.user_id = u.id
      WHERE u.id = $1
    `, [req.user.id]);

    const row = rows[0] || {};
    const isSpecialGuest = row.special_guest === true;
    // Exige l'accord des 3 colonnes (plan_name + status + stripe_status).
    // ⚠️ On NE gate PAS sur current_period_end (date locale) : si un webhook de
    // renouvellement a été manqué, elle peut être périmée alors que Stripe est
    // toujours actif. stripe_status='active' fait foi ; la réconciliation Stripe
    // horaire (expireFinishedSubscriptions) corrige la date et coupe vraiment
    // l'accès quand Stripe lui-même n'est plus actif.
    const allActive      = row.plan_name === 'premium'
                        && row.sub_status  === 'active'
                        && row.stripe_status === 'active';
    const isPremium      = isSpecialGuest || allActive;

    req.user.isPremium      = isPremium;
    req.user.isSpecialGuest = isSpecialGuest;
    req.user.planName       = isSpecialGuest ? 'special_guest' : (isPremium ? 'premium' : 'free');

    res.locals.isPremium      = isPremium;
    res.locals.isSpecialGuest = isSpecialGuest;
    res.locals.balance        = row.balance || 0;
  } catch (err) {
    console.error('Erreur lecture abonnement global:', err);
  }

  next();
});


/* app.use(async (req, res, next) => {
  if (!req.isAuthenticated()) {
    res.locals.balance = 0;
    res.locals.isPremium = false;
    return next();
  }

  try {
 Vérifier l'abonnement avec notre logique d'interprétation
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
            SET plan_name = 'free', status = 'expired', stripe_status = 'expired', updated_at = NOW()
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
 */

/* Dans tes middlewares existants, remplace la partie complexe par:
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

      /* LOGIQUE SIMPLE :
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
}); */


// Rate limit généreux sur les API JSON : bloque le scraping/abus sans gêner
// l'usage normal (une page déclenche plusieurs fetch).
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessaie dans un instant' }
});
app.use('/api', apiLimiter);

app.use("/", mobileRoutes); // API mobile (JWT) pour l'app React Native


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
    failureRedirect: "/?error=auth_failed",
    keepSessionInfo: true // conserve session.pendingRef (parrainage) au login (passport ≥0.6 régénère la session)
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
      // Redirection consciente du rôle : un prof (onboarding fait) va vers /teach.
      const defaultHome = (req.user?.role === 'teacher' && req.user?.onboarding_done)
        ? '/teach' : '/dashboard';
      const returnTo = req.session.returnTo || defaultHome;
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
      'SELECT id, email, role, onboarding_done FROM users WHERE email = $1',
      [payload.email]
    );

    let user;

    if (result.rows.length === 0) {
      // Créer un nouvel utilisateur
      const newUser = await pool.query(
        `INSERT INTO users (email, provider, email_verified, balance)
         VALUES ($1, 'google', true, 200)
         RETURNING id, email`,
        [payload.email]
      );
      user = newUser.rows[0];
    } else {
      user = result.rows[0];
    }

    // Connectez l'utilisateur (avec Passport.js si vous l'utilisez)
    req.login(user, { keepSessionInfo: true }, (err) => {
      if (err) {
        return res.status(500).json({ error: 'Login failed' });
      }

      // ✅ IMPORTANT: Envoyer une réponse JSON valide (aiguillage par rôle)
      const redirect = (user.role === 'teacher' && user.onboarding_done) ? '/teach' : '/dashboard';
      res.json({ success: true, redirect });
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

    // Validations (inchangées)
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

    // Insertion utilisateur
    const userRes = await pool.query(
      `INSERT INTO users (email, password_hash, provider, email_verified, balance)
       VALUES ($1, $2, 'local', false, 200)
       RETURNING id, email`,
      [email, hash]
    );
    const user = userRes.rows[0];

    // Génération et sauvegarde du token
    const token = generateToken();
    console.log('🔑 Token généré :', token);
    await pool.query(
      `INSERT INTO email_verification_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
      [user.id, token]
    );
    console.log('✅ Token inséré en base pour user', user.id);

    console.log('📧 Envoi email à', user.email, 'avec token', token);
    // Tentative d'envoi d'email (ne doit jamais faire échouer la requête)
    let emailSent = false;
    try {
      await sendVerificationEmail(user.email, token);
      emailSent = true;
      console.log(`✅ Email de vérification envoyé à ${user.email}`);
    } catch (emailErr) {
      console.error(`❌ Échec envoi email à ${user.email}:`, emailErr.message);
    }

    // Réponse toujours positive
    res.status(201).json({
      success: true,
      userId: user.id,
      email: user.email,
      message: emailSent
        ? 'Compte créé avec succès. Vérifiez votre email.'
        : 'Compte créé, mais l\'email de confirmation n\'a pas pu être envoyé. Vous pourrez le renvoyer plus tard.',
      emailSent
    });

  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
    }
    console.error('❌ Erreur inattendue lors de l\'inscription:', err);
    res.status(500).json({ error: 'Erreur serveur. Veuillez réessayer.' });
  }
});

app.post('/auth/login-basic', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('📥 Tentative login pour', email);

    const result = await pool.query(
      'SELECT id, email, password_hash, email_verified, role, onboarding_done FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      console.log('❌ Utilisateur non trouvé');
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    console.log('✅ Utilisateur trouvé:', user.id);

    if (!user.email_verified) {
      console.log('⛔ Email non vérifié');
      return res.status(403).json({ error: 'Please verify your email first' });
    }

    if (!user.password_hash) {
      console.log('⛔ Compte Google uniquement');
      return res.status(401).json({ error: 'Use Google to sign in' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      console.log('❌ Mot de passe incorrect');
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    console.log('🔐 Appel de req.login...');
    req.login(user, { keepSessionInfo: true }, (err) => {
      if (err) {
        console.error('❌ Erreur req.login:', err);
        return res.status(500).json({ error: 'Login failed' });
      }

      console.log('✅ req.login réussi, utilisateur attaché. SessionID:', req.sessionID);
      // Vérifier que l'utilisateur est bien dans la session
      console.log('🔍 req.user après login:', req.user ? req.user.id : 'absent');

      // Forcer la sauvegarde de la session
      req.session.save(async (saveErr) => {
        if (saveErr) {
          console.error('❌ Erreur sauvegarde session:', saveErr);
        } else {
          console.log('💾 Session sauvegardée');
        }
        await pool.query(
          'UPDATE users SET last_login = NOW() WHERE id = $1',
          [user.id]
        );
        // Aiguillage par rôle : un prof (onboarding fait) va vers /teach.
        const redirect = (user.role === 'teacher' && user.onboarding_done) ? '/teach' : '/dashboard';
        res.json({ success: true, redirect });
      });
    });

  } catch (err) {
    console.error('💥 Erreur login:', err);
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
  try {
    const { token } = req.query;
    if (!token) return res.redirect('/?verify=expired');

    const result = await pool.query(
      `SELECT * FROM email_verification_tokens
       WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      // Token absent/expiré. Cause fréquente : les clients mail (Outlook, antivirus,
      // proxy Gmail) préchargent le lien à usage unique avant le vrai clic. Comme la
      // vérification est désormais idempotente et que le token n'est plus supprimé,
      // ce cas = lien vraiment expiré (>24h) → l'utilisateur peut juste se connecter.
      return res.redirect('/?verify=expired');
    }

    const { user_id } = result.rows[0];

    await pool.query(`UPDATE users SET email_verified = true WHERE id = $1`, [user_id]);

    // On NE supprime PAS le token du user tout de suite (sinon un préchargement mail
    // le consomme et le vrai clic échoue). On nettoie seulement les tokens expirés.
    await pool.query(`DELETE FROM email_verification_tokens WHERE expires_at < NOW()`);

    res.redirect('/?verified=1');
  } catch (err) {
    console.error('❌ verify-email:', err);
    res.redirect('/?verify=expired');
  }
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



app.get('/legal', (req, res) => {
  res.render('legal', {
    title: 'Legal Mentions - 加油！',
    currentPage: 'legal'
  });
});

// Page support publique — requise pour la soumission App Store / Play Store
app.get('/support', (req, res) => {
  res.render('support', {
    title: 'Support - Jiayou 加油！',
    currentPage: 'support'
  });
});

// Page publique de suppression de compte (exigée par Google Play - Data safety).
app.get('/delete-account', (req, res) => {
  const supportEmail = process.env.SUPPORT_EMAIL || process.env.RESEND_FROM_EMAIL || 'contact@jiayou.fr';
  res.type('html').send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Delete your Jiayou account</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:0 auto;padding:32px 20px;color:#1a1a2e;line-height:1.6}
  h1{color:#0d6efd;font-size:26px}h2{font-size:18px;margin-top:28px}
  .box{background:#f8f9fa;border:1px solid #e6e8ec;border-radius:12px;padding:16px 18px;margin:16px 0}
  code{background:#eef2f7;padding:2px 6px;border-radius:5px}a{color:#0d6efd}
  ol{padding-left:20px}li{margin:6px 0}
</style></head><body>
<h1>加油！ Delete your Jiayou account</h1>
<p>This page explains how to delete your <strong>Jiayou</strong> account and the data associated with it.</p>

<h2>Delete from the app (immediate)</h2>
<div class="box">
  <ol>
    <li>Open the Jiayou app (or <a href="https://app.jiayou.fr">app.jiayou.fr</a>) and sign in.</li>
    <li>Go to <strong>Settings → Danger zone → Delete account</strong>.</li>
    <li>Confirm. Your account is deleted <strong>immediately and permanently</strong>.</li>
  </ol>
</div>

<h2>Or request deletion by email</h2>
<p>If you can't sign in, email <a href="mailto:${supportEmail}">${supportEmail}</a> from the address linked to your account,
with the subject <code>Delete my account</code>. We process these requests within 30 days.</p>

<h2>What is deleted</h2>
<p>Deleting your account permanently removes: your profile (name, email, country), your word collection and learning
progress, your quiz and duel history, your coin balance and transactions, and any packs you created. This data is
<strong>not recoverable</strong> after deletion.</p>

<h2>What may be retained</h2>
<p>We may retain limited records required by law (e.g. payment/invoice records held by our payment processor) for the
legally mandated period. These are not used to identify you within the app.</p>

<p style="margin-top:32px;color:#6c757d;font-size:13px">Jiayou · <a href="/legal">Legal &amp; Privacy</a></p>
</body></html>`);
});

// Politique de confidentialité publique (exigée par Google Play & les stores).
app.get('/privacy', (req, res) => {
  const supportEmail = process.env.SUPPORT_EMAIL || process.env.RESEND_FROM_EMAIL || 'contact@jiayou.fr';
  const updated = 'July 2026';
  res.type('html').send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Privacy Policy - Jiayou 加油！</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:720px;margin:0 auto;padding:32px 20px;color:#1a1a2e;line-height:1.65}
  h1{color:#0d6efd;font-size:26px}h2{font-size:19px;margin-top:30px}
  a{color:#0d6efd}code{background:#eef2f7;padding:2px 6px;border-radius:5px}
  table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14.5px}
  td,th{border:1px solid #e6e8ec;padding:8px 10px;text-align:left;vertical-align:top}
  th{background:#f8f9fa}
  .muted{color:#6c757d;font-size:13px}
</style></head><body>
<h1>加油！ Privacy Policy</h1>
<p class="muted">Last updated: ${updated}</p>
<p>This Privacy Policy explains how <strong>Jiayou</strong> ("we", "the app") collects, uses and protects your
personal data when you use our Chinese-learning application and website (<a href="https://app.jiayou.fr">app.jiayou.fr</a>).
We act as the data controller. You can contact us at <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>

<h2>1. Data we collect</h2>
<table>
  <tr><th>Data</th><th>Purpose</th></tr>
  <tr><td>Email address, name, country, optional tagline</td><td>Account creation, authentication, profile &amp; leaderboard</td></tr>
  <tr><td>Password (stored hashed, never in clear text)</td><td>Authentication</td></tr>
  <tr><td>Learning activity: word collection, quiz and duel history, scores, coin balance and transactions</td><td>Core app functionality and progress tracking</td></tr>
  <tr><td>User ID and, if you sign in with Google, your Google account identifier</td><td>Account linking &amp; sign-in</td></tr>
  <tr><td>Technical logs (IP address, timestamps)</td><td>Security, abuse prevention, reliability</td></tr>
</table>
<p>We do <strong>not</strong> collect precise location, contacts, photos, or health data.</p>

<h2>2. Legal basis (GDPR)</h2>
<p>We process your data to <strong>perform our contract</strong> with you (providing the service), on the basis of your
<strong>consent</strong> where applicable (e.g. optional communications), and for our <strong>legitimate interests</strong>
(security and improving the app).</p>

<h2>3. Payments</h2>
<p>Premium subscriptions are processed by <strong>Stripe</strong> on our website. We never receive or store your full
card details — they are handled directly by Stripe.</p>

<h2>4. Sharing &amp; processors</h2>
<p>We do not sell your personal data. We rely on trusted service providers (data processors) who process data on our
behalf, solely to run the service:</p>
<ul>
  <li><strong>Neon</strong> — database hosting</li>
  <li><strong>Stripe</strong> — payment processing</li>
  <li><strong>Resend</strong> — transactional emails (verification, password reset, notifications)</li>
  <li><strong>Google</strong> — optional "Sign in with Google"</li>
</ul>

<h2>5. Data retention</h2>
<p>We keep your personal data for as long as your account exists. When you delete your account, your data is removed
(see section 7). Limited records required by law (e.g. payment/invoice records) may be retained by our processors for
the legally mandated period.</p>

<h2>6. Security</h2>
<p>All data is encrypted in transit (HTTPS/TLS). Passwords are hashed. Despite our measures, no system is completely
secure; in the event of a breach affecting your rights, we will notify you and the relevant authority (CNIL) as
required by GDPR Art. 33.</p>

<h2>7. Your rights &amp; account deletion</h2>
<p>You have the right to access, rectify, delete, and export your data, and to object to or restrict processing. You can
<strong>delete your account and all associated data</strong> at any time from <strong>Settings → Delete account</strong>,
or via our <a href="/delete-account">account deletion page</a>. To exercise other rights, email
<a href="mailto:${supportEmail}">${supportEmail}</a>. You may also lodge a complaint with the French data protection
authority (CNIL).</p>

<h2>8. Children</h2>
<p>Jiayou is not intended for children under 13 (or the minimum age required in your country). We do not knowingly
collect data from children.</p>

<h2>9. Changes</h2>
<p>We may update this policy; the "Last updated" date reflects the latest version. Material changes will be communicated
in the app or by email.</p>

<p class="muted" style="margin-top:32px">Jiayou · <a href="/legal">Legal notice</a> · <a href="/delete-account">Delete my account</a></p>
</body></html>`);
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

app.get('/subscribe', async (req, res) => {
  // Si non connecté : sauvegarder la destination et rediriger vers login
  if (!req.isAuthenticated() && !req.user) {
    const returnTo = `/subscribe?plan=${req.query.plan || 'premium'}`;
    if (req.session) req.session.returnTo = returnTo;
    console.log(`🔐 Utilisateur non connecté → returnTo: ${returnTo}`);
    return res.redirect('/');
  }

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
    // Récupérer le customer Stripe existant si l'utilisateur en a déjà un
    const existingSub = await pool.query(
      'SELECT stripe_customer_id FROM user_subscriptions WHERE user_id = $1 LIMIT 1',
      [req.user.id]
    );
    const existingCustomerId = existingSub.rows[0]?.stripe_customer_id || null;
    const sessionParams = {
      mode: 'subscription',
      line_items: [{ price: priceID, quantity: 1 }],
      success_url: `${baseUrl}/welcome-jiayou-premium?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/pricing`,
      metadata: {
        userId: req.user.id.toString(),
        planName: plan
      }
    };

    if (existingCustomerId) {
      // Réutilise le customer Stripe existant (évite les doublons)
      sessionParams.customer = existingCustomerId;
    } else {
      // Nouveau client : Stripe créera le customer
      sessionParams.customer_email = req.user.email;
    }

    let session;
    try {
      session = await stripe.checkout.sessions.create(sessionParams);
    } catch (err) {
      // Customer supprimé côté Stripe (env de test) : retry sans lui
      if (err.code === 'resource_missing' && existingCustomerId) {
        console.warn(`⚠️ Customer ${existingCustomerId} introuvable, fallback sur email`);
        delete sessionParams.customer;
        sessionParams.customer_email = req.user.email;
        session = await stripe.checkout.sessions.create(sessionParams);
      } else {
        throw err;
      }
    }

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

    // Customer Stripe supprimé (fréquent en env de test) : renvoie vers Checkout
    if (error.code === 'resource_missing' || error.statusCode === 404) {
      return res.json({ url: '/subscribe?plan=premium' });
    }

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

          // Récupérer les dates de période depuis Stripe
          let periodStart = null, periodEnd = null;
          try {
            const stripeSub = await stripe.subscriptions.retrieve(session.subscription);
            // API clover : les périodes sont sur l'item, pas à la racine.
            const p = extractStripePeriod(stripeSub);
            periodStart = p.periodStartDate;
            periodEnd = p.periodEndDate;
          } catch (e) {
            console.warn('⚠️ Impossible de récupérer les dates de période:', e.message);
          }

          await pool.query(`
            INSERT INTO user_subscriptions (
              user_id,
              plan_name,
              status,
              stripe_status,
              stripe_customer_id,
              stripe_subscription_id,
              current_period_start,
              current_period_end,
              metadata,
              created_at,
              updated_at
            ) VALUES ($1, 'premium', 'active', 'active', $2, $3, $4, $5, $6, NOW(), NOW())
            ON CONFLICT (user_id)
            DO UPDATE SET
              plan_name = 'premium',
              status = 'active',
              stripe_status = 'active',
              stripe_customer_id = EXCLUDED.stripe_customer_id,
              stripe_subscription_id = EXCLUDED.stripe_subscription_id,
              current_period_start = COALESCE(EXCLUDED.current_period_start, user_subscriptions.current_period_start),
              current_period_end   = COALESCE(EXCLUDED.current_period_end,   user_subscriptions.current_period_end),
              metadata = EXCLUDED.metadata,
              updated_at = NOW()
          `, [
            req.user.id,
            session.customer,
            session.subscription,
            periodStart,
            periodEnd,
            JSON.stringify({
              created_via: 'welcome_page',
              session_id: session_id,
              payment_date: new Date().toISOString()
            })
          ]);
          console.log(`✅ Abonnement activé (stripe_status=active) pour user ${req.user.id}`);
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
        const p = extractStripePeriod(stripeSub);
        stripeData = {
          id: stripeSub.id,
          status: stripeSub.status,
          current_period_start: p.periodStartDate,
          current_period_end: p.periodEndDate,
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

        // Renouvellement payé → rafraîchir la période (source la plus fiable).
        case 'invoice.paid':
        case 'invoice.payment_succeeded': {
          const subId = invoiceSubscriptionId(event.data.object);
          console.log(`✅ ${event.type}:`, subId);
          if (subId) {
            try {
              const stripeSub = await stripe.subscriptions.retrieve(subId);
              await handleSubscriptionEvent(stripeSub, event.type);
            } catch (e) {
              console.warn('⚠️ invoice.paid: retrieve subscription échoué:', e.message);
            }
          }
          break;
        }

        // Paiement échoué → passer en past_due / free
        case 'invoice.payment_failed':
          console.log('💸 invoice.payment_failed:', invoiceSubscriptionId(event.data.object));
          await handleInvoicePaymentFailed(event.data.object);
          break;

        // Paiement requis (3DS, etc.) → même traitement
        case 'invoice.payment_action_required':
          console.log('⚠️ invoice.payment_action_required:', event.data.object.subscription);
          await handleInvoicePaymentFailed(event.data.object);
          break;

        // Abonnement mis en pause
        case 'customer.subscription.paused':
          console.log('⏸️ Subscription paused:', event.data.object.id);
          await handleSubscriptionEvent(event.data.object, event.type);
          break;
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
// 🧰 HELPERS STRIPE (API 2025-12-15.clover)
// ==========================================
// ⚠️ Depuis l'API "basil/clover", current_period_start/end n'existent PLUS au
// niveau racine de l'objet Subscription : ils sont portés par l'item d'abonnement
// (subscription.items.data[0]). Toujours passer par ce helper pour les lire,
// sinon on récupère `undefined` → dates NULL → cache local incohérent.
function extractStripePeriod(subscription) {
  let periodEnd = null;
  let periodStart = null;
  if (subscription?.items?.data?.length > 0) {
    const firstItem = subscription.items.data[0];
    periodEnd = firstItem.current_period_end;
    periodStart = firstItem.current_period_start;
  }
  // Fallback pour d'éventuels objets pré-basil.
  if (!periodEnd && subscription?.current_period_end) periodEnd = subscription.current_period_end;
  if (!periodStart && subscription?.current_period_start) periodStart = subscription.current_period_start;
  return {
    periodEndDate: periodEnd ? new Date(periodEnd * 1000) : null,
    periodStartDate: periodStart ? new Date(periodStart * 1000) : null,
  };
}

// Résout l'ID de subscription depuis un objet Invoice de façon défensive :
// `invoice.subscription` a été retiré des API récentes au profit de
// invoice.parent.subscription_details.subscription (ou côté line items).
function invoiceSubscriptionId(invoice) {
  return (
    invoice.subscription ||
    invoice.parent?.subscription_details?.subscription ||
    invoice.lines?.data?.find((l) => l.parent?.subscription_item_details?.subscription)
      ?.parent?.subscription_item_details?.subscription ||
    null
  );
}

// ==========================================
// 📝 HANDLER SUBSCRIPTION - VERSION SIMPLIFIÉE
// ==========================================
async function handleSubscriptionEvent(subscription, eventType) {
  console.log(`🔔 ${eventType.toUpperCase()} - ID: ${subscription.id}`);

  try {
    // 1. EXTRAIRE LES DATES (item-first, cf. extractStripePeriod)
    const { periodEndDate, periodStartDate } = extractStripePeriod(subscription);

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
    stripe_customer_id = $9,
    updated_at = NOW()
  WHERE user_id = $10
  RETURNING id, stripe_status, status, plan_name
`;
    const updateParams = [
      planName, ourStatus, ourStatus,
      periodStartDate, periodEndDate,
      cancelAtPeriodEnd, canceledAtDate,
      subscription.id, subscription.customer, userId
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

/**
 * Gère invoice.payment_failed et invoice.payment_action_required
 * Met stripe_status à 'past_due' → l'utilisateur passe en free
 */
async function handleInvoicePaymentFailed(invoice) {
  try {
    const subscriptionId = invoiceSubscriptionId(invoice);
    if (!subscriptionId) {
      console.warn('⚠️ handleInvoicePaymentFailed: pas de subscription_id dans la facture');
      return;
    }

    const result = await pool.query(`
      UPDATE user_subscriptions
      SET
        stripe_status = 'past_due',
        status        = 'past_due',
        plan_name     = 'free',
        updated_at    = NOW()
      WHERE stripe_subscription_id = $1
      RETURNING user_id, stripe_status
    `, [subscriptionId]);

    if (result.rowCount > 0) {
      console.log(`💸 Paiement échoué → user ${result.rows[0].user_id} repassé en FREE (past_due)`);
    } else {
      console.warn(`⚠️ handleInvoicePaymentFailed: subscription ${subscriptionId} introuvable en base`);
    }
  } catch (err) {
    console.error('💥 ERREUR handleInvoicePaymentFailed:', err.message);
    throw err;
  }
}

// Downgrade "sec" en free (utilisé uniquement quand Stripe ne peut PAS être
// consulté et qu'une annulation était explicitement programmée localement).
async function downgradeToFree(userId, reason) {
  await pool.query(`
    UPDATE user_subscriptions
    SET plan_name = 'free', status = 'expired', stripe_status = 'expired', updated_at = NOW()
    WHERE user_id = $1
  `, [userId]);
  console.log(`⏰ user ${userId} → free (${reason})`);
}

// Filet de sécurité horaire.
// ⚠️ RÈGLE D'OR : on ne downgrade JAMAIS un abonnement que Stripe rapporte
// comme actif sur la seule foi d'une date locale (elle peut être périmée si un
// webhook de renouvellement a été manqué). On reconsulte Stripe : s'il est
// toujours actif, on RAFRAÎCHIT la période au lieu de couper l'accès ; sinon
// seulement on applique le vrai statut Stripe (canceled/unpaid/…).
async function expireFinishedSubscriptions() {
  try {
    console.log('🕐 Vérification des abonnements à expirer...');

    const { rows: candidates } = await pool.query(`
      SELECT user_id, stripe_subscription_id, status, stripe_status, current_period_end
      FROM user_subscriptions
      WHERE current_period_end < NOW()
        AND (
          (status = 'active_canceling')
          OR
          (stripe_status = 'active' AND current_period_end IS NOT NULL)
        )
    `);

    if (candidates.length === 0) {
      console.log('✅ Aucun abonnement à vérifier');
      return;
    }
    console.log(`🔎 ${candidates.length} abonnement(s) à revérifier auprès de Stripe`);

    for (const sub of candidates) {
      // Sans ID Stripe : impossible de vérifier. On n'expire QUE si une
      // annulation était explicitement programmée localement.
      if (!sub.stripe_subscription_id) {
        if (sub.status === 'active_canceling') await downgradeToFree(sub.user_id, 'active_canceling sans stripe_id');
        continue;
      }
      try {
        const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
        if (stripeSub.status === 'active' || stripeSub.status === 'trialing') {
          // Stripe = ACTIF → webhook de renouvellement manqué. On rafraîchit la
          // période (et le statut) SANS couper l'accès.
          await handleSubscriptionEvent(stripeSub, 'expire_check_refresh');
          console.log(`🔄 user ${sub.user_id}: Stripe actif → période rafraîchie, premium conservé.`);
        } else {
          // Stripe confirme la fin → on applique le vrai statut.
          await handleSubscriptionEvent(stripeSub, 'expire_check_downgrade');
          console.log(`⏰ user ${sub.user_id}: Stripe=${stripeSub.status} → downgrade légitime.`);
        }
      } catch (e) {
        // Lookup impossible (réseau, mismatch clé test/live) → NE PAS downgrader.
        console.warn(`⚠️ expire: lookup Stripe échoué pour ${sub.stripe_subscription_id} (${e.type || e.message}) — on NE touche PAS à la base.`);
      }
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
    // Garde-fou : ne pas réconcilier des abonnements LIVE avec une clé TEST
    // (typiquement un serveur de dev local branché sur la DB de prod).
    if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_live')) {
      console.log('⏭️ syncStripeSubscriptions ignoré (clé Stripe non-live).');
      return;
    }
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
        // ⚠️ NE JAMAIS annuler un abonnement sur une simple erreur de lookup.
        // Une "resource introuvable" arrive typiquement à cause d'un mismatch
        // clé test/live (ex: dev local avec sk_test qui lit une sub live) ou d'un
        // souci réseau — ce n'est PAS une annulation. Les vraies annulations
        // passent par le webhook `customer.subscription.deleted`.
        console.warn(`⚠️ Lookup Stripe échoué pour ${sub.stripe_subscription_id} (${stripeError.type || stripeError.message}) — on NE touche PAS à la base.`);
      }
    }
  } catch (error) {
    console.error('❌ Erreur syncStripeSubscriptions:', error);
  }
}

// Exécuter toutes les heures
setInterval(syncStripeSubscriptions, 60 * 60 * 1000);

// ── Relance "long time no see" : email aux inactifs (14 j), 1x par absence ───
cron.schedule('0 10 * * *', async () => {
  try {
    const { rows: users } = await pool.query(`
      SELECT id, email, name FROM users
      WHERE email IS NOT NULL
        AND last_login IS NOT NULL
        AND last_login <= NOW() - INTERVAL '14 days'
        AND (reengage_emailed_at IS NULL OR reengage_emailed_at < last_login)
      ORDER BY last_login ASC
      LIMIT 200
    `);
    for (const u of users) {
      try {
        await sendReengagementEmail(u.email, u.name);
        await pool.query('UPDATE users SET reengage_emailed_at = NOW() WHERE id = $1', [u.id]);
      } catch (e) { console.error('[Reengage] email failed for', u.id, e.message); }
    }
    if (users.length) console.log(`📧 Reengagement: ${users.length} email(s) envoyés.`);
  } catch (err) {
    console.error('[Reengage cron] Erreur:', err.message);
  }
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔗 Webhook endpoint: http://localhost:${PORT}/webhook`);
});