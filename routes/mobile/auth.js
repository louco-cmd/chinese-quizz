// ════════════════════════════════════════════════════════════════════════════
//  AUTH (app mobile) — login email/mdp, check-email, register, Google & Apple
//  sign-in → JWT. Extrait de routes/mobile.js. Monté via registerAuthRoutes(
//  router, deps). requireToken + le secret JWT restent côté mobile.js (injectés).
// ════════════════════════════════════════════════════════════════════════════
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../../config/database');
const { registerLimiter, loginLimiter, validateSignupEmail } = require('../../middleware/signup-guard');
const { SIGNUP_GRANT } = require('../../lib/economy');
const { rewardPendingReferral } = require('../../lib/referral');

module.exports = function registerAuthRoutes(router, deps) {
  const { JWT_SECRET, TOKEN_TTL, creditReferralByCode } = deps;

// ── POST /api/auth/token : login email/mot de passe → JWT ────────────────────
router.post('/api/auth/token', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const { rows } = await pool.query(
      `SELECT id, email, name, password_hash, role, onboarding_done,
              quiz_direction, interface_lang
       FROM users WHERE email = $1`,
      [String(email).toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    // Trace la connexion (comme le login web) — sert p.ex. au filtre "rivaux actifs".
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
    res.json({
      token,
      user: {
        id: user.id, email: user.email, name: user.name, role: user.role,
        onboarding_done: user.onboarding_done,
        quiz_direction: user.quiz_direction, interface_lang: user.interface_lang,
      },
    });
  } catch (e) {
    console.error('Token login error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/auth/check-email : email-first (signup / login / google_only) ──
// Miroir de /auth/check-email : dit au client quelle étape présenter.
router.post('/api/auth/check-email', loginLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email required' });
    const { rows } = await pool.query('SELECT password_hash, provider FROM users WHERE email = $1', [email]);
    if (!rows.length) return res.json({ step: 'signup' });
    if (!rows[0].password_hash && rows[0].provider === 'google') return res.json({ step: 'google_only' });
    return res.json({ step: 'login' });
  } catch (e) {
    console.error('m/check-email error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/auth/register : créer un compte email/mot de passe → JWT ────────
// Mêmes règles que /auth/signup-basic (mot de passe 8+/1 maj/1 chiffre) + envoi
// de l'email de vérification. Auto-login (renvoie un JWT) pour une UX mobile fluide.
router.post('/api/auth/register', registerLimiter, async (req, res) => {
  try {
    const password = String(req.body?.password || '');
    // Anti-spam : format + domaine (rejette les emails jetables / @example.com).
    const chk = validateSignupEmail(req.body?.email);
    if (!chk.ok) return res.status(400).json({ error: chk.reason });
    const email = chk.email;
    if (!password) return res.status(400).json({ error: 'Email and password required' });
    if (!/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(password)) {
      return res.status(400).json({ error: 'Password: 8+ characters, 1 uppercase, 1 digit' });
    }

    const hash = await bcrypt.hash(password, 10);
    let user;
    try {
      const ins = await pool.query(
        `INSERT INTO users (email, password_hash, provider, email_verified, balance)
         VALUES ($1, $2, 'local', false, ${SIGNUP_GRANT})
         RETURNING id, email, name, role, onboarding_done`,
        [email, hash]
      );
      user = ins.rows[0];
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'This email is already in use.' });
      throw e;
    }

    // Email de vérification (best-effort, comme le web) — ne bloque jamais la création.
    try {
      const vtoken = crypto.randomBytes(32).toString('hex');
      await pool.query(
        `INSERT INTO email_verification_tokens (user_id, token, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
        [user.id, vtoken]
      );
      const { sendVerificationEmail } = require('../../middleware/mail.service');
      await sendVerificationEmail(user.email, vtoken);
    } catch (mailErr) {
      console.error('m/register verification email:', mailErr.message);
    }

    // Parrainage capté à l'INSCRIPTION (champ « code » de l'écran de connexion) :
    // pose referred_by. La récompense (parrain + bonus invité +50) n'est versée
    // qu'à la vérification de l'email (rewardPendingReferral, anti-farming).
    try { await creditReferralByCode(user.id, req.body?.ref); }
    catch (e) { console.error('register referral:', e.message); }

    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, onboarding_done: user.onboarding_done },
    });
  } catch (e) {
    console.error('m/register error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/auth/google-token : ID token Google → JWT ──────────────────────
// L'app obtient un id_token Google (via expo-auth-session) et l'échange ici.
// Réutilise la même vérification que le One-Tap web (google-auth-library).
router.post('/api/auth/google-token', async (req, res) => {
  try {
    const { id_token } = req.body || {};
    if (!id_token) return res.status(400).json({ error: 'Missing id_token' });

    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = (payload.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'No email in Google token' });

    let { rows } = await pool.query(
      'SELECT id, email, name, role, onboarding_done FROM users WHERE email = $1',
      [email]
    );
    let user = rows[0];
    let created = false;
    if (!user) {
      const ins = await pool.query(
        `INSERT INTO users (email, name, provider, email_verified, balance)
         VALUES ($1, $2, 'google', true, ${SIGNUP_GRANT})
         RETURNING id, email, name, role, onboarding_done`,
        [email, payload.name || null]
      );
      user = ins.rows[0];
      created = true;
    }

    // Parrainage : uniquement pour un NOUVEAU compte Google (Google = déjà vérifié
    // → le crédit parrain + bonus invité +50 est immédiat via rewardPendingReferral).
    if (created) {
      try { await creditReferralByCode(user.id, req.body?.ref); }
      catch (e) { console.error('google referral:', e.message); }
    }

    // Trace la connexion (comme le login web) — sert p.ex. au filtre "rivaux actifs".
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
    res.json({
      token,
      user: {
        id: user.id, email: user.email, name: user.name,
        role: user.role, onboarding_done: user.onboarding_done,
      },
    });
  } catch (e) {
    console.error('google-token error:', e);
    res.status(401).json({ error: 'Invalid Google token' });
  }
});

// ── POST /api/auth/apple-token : identityToken Apple → JWT ───────────────────
// L'app (expo-apple-authentication, iOS) obtient un identityToken signé par Apple
// et l'échange ici. Liaison : apple_id (sub stable) d'abord, sinon email (comme
// Google), sinon création. Le nom n'est fourni par Apple qu'au 1er login → le
// client le passe dans le body ; on ne l'a plus ensuite.
router.post('/api/auth/apple-token', async (req, res) => {
  try {
    const { identity_token, name } = req.body || {};
    if (!identity_token) return res.status(400).json({ error: 'Missing identity_token' });

    const appleSignin = require('apple-signin-auth');
    // Audience acceptée : le bundle iOS (login natif) ET le Services ID (login web,
    // flux « Sign in with Apple JS »). Le `sub` est le même entre les deux tant que
    // le Services ID est rattaché au même App ID primaire → même compte lié.
    const audience = [process.env.APPLE_BUNDLE_ID || 'fr.jiayou.app', process.env.APPLE_SERVICES_ID || 'fr.jiayou.web'].filter(Boolean);
    const data = await appleSignin.verifyIdToken(identity_token, {
      audience,
      ignoreExpiration: false,
    });
    const appleId = data.sub;
    const email = (data.email || '').toLowerCase().trim();
    if (!appleId) return res.status(400).json({ error: 'Invalid Apple token' });

    // 1) match par apple_id (le plus fiable — email peut être un relais privé).
    let { rows } = await pool.query(
      'SELECT id, email, name, role, onboarding_done FROM users WHERE apple_id = $1', [appleId]);
    let user = rows[0];

    // 2) sinon, match par email → on lie le compte existant à cet Apple ID.
    if (!user && email) {
      const byEmail = await pool.query(
        'SELECT id, email, name, role, onboarding_done FROM users WHERE email = $1', [email]);
      if (byEmail.rows[0]) {
        user = byEmail.rows[0];
        await pool.query('UPDATE users SET apple_id = $1 WHERE id = $2', [appleId, user.id]);
      }
    }

    // 3) sinon création (email requis pour un nouveau compte).
    let created = false;
    if (!user) {
      if (!email) return res.status(400).json({ error: 'No email in Apple token' });
      const ins = await pool.query(
        `INSERT INTO users (email, name, provider, apple_id, email_verified, balance)
         VALUES ($1, $2, 'apple', $3, true, ${SIGNUP_GRANT})
         RETURNING id, email, name, role, onboarding_done`,
        [email, (name || '').trim() || null, appleId]);
      user = ins.rows[0];
      created = true;
    }

    // Parrainage : uniquement pour un NOUVEAU compte Apple (Apple = déjà vérifié
    // → crédit parrain + bonus invité +50 immédiat via rewardPendingReferral).
    if (created) {
      try { await creditReferralByCode(user.id, req.body?.ref); }
      catch (e) { console.error('apple referral:', e.message); }
    }

    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
    res.json({
      token,
      user: {
        id: user.id, email: user.email, name: user.name,
        role: user.role, onboarding_done: user.onboarding_done,
      },
    });
  } catch (e) {
    console.error('apple-token error:', e);
    res.status(401).json({ error: 'Invalid Apple token' });
  }
});

};
