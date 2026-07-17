// ─────────────────────────────────────────────────────────────────────────────
// API MOBILE (React Native / Expo)
// Auth par token (JWT) au lieu des sessions cookie — une app native ne gère pas
// les cookies de session comme un navigateur. Réutilise le même bcrypt/password_hash
// que le login web. Toutes les routes sont préfixées /api (rate-limitées par apiLimiter).
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool } = require('../config/database');
const { generateDuelQuiz, addTransaction, updateWordScore } = require('../middleware/index');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const TOKEN_TTL = '30d';

// CORS léger pour les routes mobiles (utile si tu testes via Expo Web ;
// en natif ce n'est pas nécessaire, mais inoffensif).
router.use(['/api/auth', '/api/m'], (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Middleware : vérifie le Bearer token ─────────────────────────────────────
function requireToken(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(match[1], JWT_SECRET);
    req.tokenUser = { id: payload.id, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ── POST /api/auth/token : login email/mot de passe → JWT ────────────────────
router.post('/api/auth/token', async (req, res) => {
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
router.post('/api/auth/check-email', async (req, res) => {
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
router.post('/api/auth/register', async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (!/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(password)) {
      return res.status(400).json({ error: 'Password: 8+ characters, 1 uppercase, 1 digit' });
    }

    const hash = await bcrypt.hash(password, 10);
    let user;
    try {
      const ins = await pool.query(
        `INSERT INTO users (email, password_hash, provider, email_verified, balance)
         VALUES ($1, $2, 'local', false, 200)
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
      const { sendVerificationEmail } = require('../middleware/mail.service');
      await sendVerificationEmail(user.email, vtoken);
    } catch (mailErr) {
      console.error('m/register verification email:', mailErr.message);
    }

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
    if (!user) {
      const ins = await pool.query(
        `INSERT INTO users (email, name, provider, email_verified, balance)
         VALUES ($1, $2, 'google', true, 200)
         RETURNING id, email, name, role, onboarding_done`,
        [email, payload.name || null]
      );
      user = ins.rows[0];
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

// ── GET /api/m/me : profil courant ───────────────────────────────────────────
router.get('/api/m/me', requireToken, async (req, res) => {
  try {
    // Heartbeat d'activité : l'app reste connectée via son JWT sans repasser par
    // le login, donc on rafraîchit last_login ici (appelé à chaque ouverture),
    // throttlé à 1×/heure. Utile p.ex. au filtre "rivaux actifs (30 j)".
    // Fire-and-forget : ne bloque pas la réponse.
    pool.query(
      `UPDATE users SET last_login = NOW()
       WHERE id = $1 AND (last_login IS NULL OR last_login < NOW() - INTERVAL '1 hour')`,
      [req.tokenUser.id]
    ).catch(() => {});

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, u.balance, u.role,
              u.quiz_direction, u.interface_lang, u.special_guest,
              u.onboarding_done, u.has_seen_tutorial,
              us.plan_name, us.status AS sub_status, us.stripe_status
       FROM users u
       LEFT JOIN user_subscriptions us ON us.user_id = u.id
       WHERE u.id = $1`,
      [req.tokenUser.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const row = rows[0];

    // Statut premium : même logique que le web (stripe_status='active' fait foi,
    // pas de gate sur la date locale — cf. middleware/subscription.js).
    const isSpecialGuest = row.special_guest === true;
    const allActive = row.plan_name === 'premium'
      && row.sub_status === 'active'
      && row.stripe_status === 'active';
    const isPremium = isSpecialGuest || allActive;
    const plan = isSpecialGuest ? 'guest' : (isPremium ? 'premium' : 'free');

    res.json({
      id: row.id,
      email: row.email,
      name: row.name,
      balance: row.balance,
      role: row.role,
      quiz_direction: row.quiz_direction,
      interface_lang: row.interface_lang,
      onboarding_done: row.onboarding_done,
      has_seen_tutorial: row.has_seen_tutorial,
      isPremium,
      isSpecialGuest,
      plan, // 'premium' | 'guest' | 'free'
    });
  } catch (e) {
    console.error('me error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/onboarding : sauve le profil + marque l'onboarding fini ───────
// Miroir JWT de /api/user/update-profile + /api/user/complete-onboarding (web).
// `ref` (optionnel) = code de parrainage capté côté client → crédite le parrain.
const REFERRAL_REWARD = { student: 80, teacher: 150 };

// Crédite le parrain une seule fois, montant selon le rôle réel de l'invité.
async function creditReferralByCode(userId, code) {
  if (!code) return;
  const me = await pool.query(
    'SELECT role, referred_by, referral_rewarded FROM users WHERE id = $1',
    [userId]
  );
  if (!me.rows.length) return;
  if (me.rows[0].referred_by || me.rows[0].referral_rewarded) return;

  const ref = await pool.query('SELECT id FROM users WHERE referral_code = $1', [code]);
  if (!ref.rows.length) return;
  const referrerId = ref.rows[0].id;
  if (referrerId === userId) return; // pas d'auto-parrainage

  const reward = REFERRAL_REWARD[me.rows[0].role] || REFERRAL_REWARD.student;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE users SET referred_by = $1, referral_rewarded = TRUE
       WHERE id = $2 AND referred_by IS NULL AND referral_rewarded = FALSE`,
      [referrerId, userId]
    );
    if (upd.rowCount === 1) {
      await addTransaction(client, referrerId, reward, 'referral', 'Referral bonus');
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

router.post('/api/m/onboarding', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  const { role, name, tagline, country, quiz_direction, interface_lang, ref } = req.body || {};

  const VALID_ROLES = ['student', 'teacher'];
  const VALID_DIRECTIONS = ['zh→en', 'en→zh'];
  const chosenRole = VALID_ROLES.includes(role) ? role : 'student';
  const uiLang = ['en', 'zh'].includes(interface_lang) ? interface_lang : null;

  if (!name || String(name).trim().length === 0 || String(name).length > 50) {
    return res.status(400).json({ error: 'Name is required (max 50 characters)' });
  }
  if (tagline && String(tagline).length > 100) {
    return res.status(400).json({ error: 'Tagline must be under 100 characters' });
  }
  if (quiz_direction && !VALID_DIRECTIONS.includes(quiz_direction)) {
    return res.status(400).json({ error: 'Invalid quiz direction' });
  }
  const code = country ? String(country).toUpperCase().slice(0, 2) : null;

  try {
    await pool.query(
      `UPDATE users
       SET role = $1, name = $2, tagline = $3, country = $4,
           quiz_direction = $5, interface_lang = COALESCE($6, interface_lang),
           onboarding_done = TRUE
       WHERE id = $7`,
      [chosenRole, String(name).trim(), tagline ? String(tagline).trim() : null, code,
        quiz_direction || 'en→zh', uiLang, uid]
    );

    // Parrainage : montant selon le rôle réel choisi ici.
    try {
      await creditReferralByCode(uid, ref ? String(ref).trim().slice(0, 12) : null);
    } catch (e) { console.error('m/onboarding referral error:', e); }

    res.json({ success: true, role: chosenRole, onboarding_done: true });
  } catch (e) {
    console.error('m/onboarding error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/tutorial-complete : marque le tutoriel comme vu ───────────────
router.post('/api/m/tutorial-complete', requireToken, async (req, res) => {
  try {
    await pool.query('UPDATE users SET has_seen_tutorial = true WHERE id = $1', [req.tokenUser.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('m/tutorial-complete error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/collection : les mots de l'utilisateur (tranche verticale) ─────
router.get('/api/m/collection', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT mots.id, mots.chinese, mots.pinyin, mots.english, mots.hsk,
              mots.description, mots.description_zh,
              user_mots.score
       FROM mots
       JOIN user_mots ON mots.id = user_mots.mot_id
       WHERE user_mots.user_id = $1
       ORDER BY user_mots.score ASC, mots.id ASC`,
      [req.tokenUser.id]
    );
    res.json({ words: rows });
  } catch (e) {
    console.error('collection error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/search?q= : recherche permissive (chinois/anglais/pinyin) ──────
router.get('/api/m/search', requireToken, async (req, res) => {
  try {
    const raw = (req.query.q || '').trim();
    if (!raw) return res.json({ results: [] });

    const escaped = raw.replace(/[\\%_]/g, (c) => '\\' + c);
    const like = `%${escaped}%`;
    const pinyinNorm = raw.normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z]/g, '');

    const clauses = [`m.chinese ILIKE $1 ESCAPE '\\'`, `m.english ILIKE $1 ESCAPE '\\'`];
    const params = [like, req.tokenUser.id, raw];
    const pinyinColNorm =
      `regexp_replace(translate(lower(m.pinyin),'üāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ','uaaaaeeeeiiiioooouuuuuuuu'),'[^a-z]','','g')`;
    if (pinyinNorm) {
      params.push(`%${pinyinNorm}%`);
      clauses.push(`${pinyinColNorm} LIKE $${params.length}`);
    }

    const { rows } = await pool.query(
      `SELECT m.id, m.chinese, m.pinyin, m.english, m.hsk,
              BOOL_OR(um.user_id = $2) AS owned
       FROM mots m
       LEFT JOIN user_mots um ON um.mot_id = m.id
       WHERE ${clauses.join(' OR ')}
       GROUP BY m.id
       ORDER BY (m.chinese = $3 OR LOWER(m.english) = LOWER($3)) DESC, m.id ASC
       LIMIT 8`,
      params
    );
    res.json({ results: rows });
  } catch (e) {
    console.error('m/search error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/words/:motId/capture : ajoute un mot existant à sa collection ──
router.post('/api/m/words/:motId/capture', requireToken, async (req, res) => {
  try {
    const motId = parseInt(req.params.motId, 10);
    if (!motId) return res.status(400).json({ error: 'Invalid word' });
    await pool.query(
      `INSERT INTO user_mots (user_id, mot_id, score)
       SELECT $1, $2, 0
       WHERE NOT EXISTS (
         SELECT 1 FROM user_mots WHERE user_id = $1 AND mot_id = $2
       )`,
      [req.tokenUser.id, motId]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('m/capture error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/words : créer un nouveau mot + le capturer ───────────────────
// Miroir de /ajouter : coûte 3 coins, upsert du mot par `chinese`, association
// à la collection, débit + transaction. Utilisé par la popup "New word".
router.post('/api/m/words', requireToken, async (req, res) => {
  const { chinese, pinyin, english, description } = req.body || {};
  if (!chinese || !english) {
    return res.status(400).json({ error: 'Chinese and English are required' });
  }
  const userId = req.tokenUser.id;
  const COST = 3;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      'SELECT balance FROM users WHERE id = $1 FOR UPDATE', [userId]
    );
    if (!userRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    const balance = userRows[0].balance;
    if (balance < COST) {
      await client.query('ROLLBACK');
      return res.status(402).json({ error: 'Insufficient balance (3 coins required)' });
    }

    // Upsert du mot par `chinese`
    let { rows } = await client.query('SELECT id FROM mots WHERE chinese = $1', [chinese]);
    let motId;
    if (rows.length) {
      motId = rows[0].id;
    } else {
      const ins = await client.query(
        `INSERT INTO mots (chinese, pinyin, english, description)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [chinese, pinyin || null, english, description || null]
      );
      motId = ins.rows[0].id;
    }

    // Déjà possédé ?
    const { rows: owned } = await client.query(
      'SELECT 1 FROM user_mots WHERE user_id = $1 AND mot_id = $2', [userId, motId]
    );
    if (owned.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'You already captured this word' });
    }

    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [COST, userId]);
    await client.query(
      `INSERT INTO transactions (user_id, amount, type, description)
       VALUES ($1, $2, $3, $4)`,
      [userId, -COST, 'capture_word', `Captured word ${chinese}`]
    );
    await client.query('INSERT INTO user_mots (user_id, mot_id, score) VALUES ($1, $2, 0)', [userId, motId]);

    await client.query('COMMIT');
    const word = await pool.query(
      'SELECT id, chinese, pinyin, english, hsk FROM mots WHERE id = $1', [motId]
    );
    res.json({ success: true, word: word.rows[0], newBalance: balance - COST });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/words create error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ══ Import en masse (copier-coller) ══════════════════════════════════════════

const HAN_RE = /[㐀-鿿]/;
const PINYIN_TONE_RE = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹ]/i;

// Détecte le pinyin par SIGNAL FORT uniquement : accents de ton (xué) ou
// numéro de ton (ma1). Sans signal fort, un fragment latin seul est ambigu
// (« hello » ≈ une syllabe pinyin) → on le traite comme anglais, cas dominant
// d'une liste « chinois, anglais ». Le preview reste éditable.
function looksLikePinyin(s) {
  if (!s || HAN_RE.test(s)) return false;
  if (PINYIN_TONE_RE.test(s)) return true;                                  // accents de ton
  if (/[a-zü]+[1-5](\s|$)/i.test(s) && /^[a-zü1-5\s'’·-]+$/i.test(s)) return true; // pinyin numéroté
  return false;
}

// Une ligne composée UNIQUEMENT de caractères chinois (headword sur sa ligne).
const PURE_HAN_RE = /^[㐀-鿿·・]+$/;

function splitDelim(line) {
  if (line.includes('\t')) return line.split('\t');
  if (line.includes(';')) return line.split(';');
  if (line.includes(',')) return line.split(',');
  return [line];
}

// Nettoie une définition CC-CEDICT/Pleco : retire les annotations [pin1 yin1],
// les classificateurs « CL:… », et tout Hanzi résiduel (le champ est en latin).
function cleanDefinition(s) {
  return String(s || '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/;?\s*CL:.*$/i, '')
    .replace(/[㐀-鿿·・｜|]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*[;,]\s*$/g, '')
    .replace(/^[\s;,]+/, '')
    .trim();
}

// Extrait {pinyin, latin} d'une ligne "détail" (pinyin ⇥/, définition) sans y
// chercher de headword chinois (les Hanzi d'une déf. sont dans les CL:…).
function parseDetail(line) {
  const parts = splitDelim(line).map((p) => p.trim()).filter(Boolean);
  const pIdx = parts.findIndex(looksLikePinyin);
  const pinyin = pIdx >= 0 ? parts[pIdx] : '';
  const latin = cleanDefinition(parts.filter((_, i) => i !== pIdx).join(', '));
  return { pinyin, latin };
}

// Extrait les fragments d'une ligne "tout-en-un" (ex. 工作⇥gōng zuò⇥job…).
function fragmentsFrom(line) {
  const parts = splitDelim(line).map((p) => p.trim()).filter(Boolean);
  // headword = fragment PUREMENT chinois en priorité (évite les Hanzi de définition).
  const chinese = parts.find((p) => PURE_HAN_RE.test(p)) || parts.find((p) => HAN_RE.test(p)) || '';
  const rest = parts.filter((p) => p !== chinese);
  const pIdx = rest.findIndex(looksLikePinyin);
  const pinyin = pIdx >= 0 ? rest[pIdx] : '';
  const latin = cleanDefinition(rest.filter((_, i) => i !== pIdx).join(', '));
  return { chinese, pinyin, latin };
}

// Parse le texte collé en fragments { chinese, pinyin, latin }. Gère le format
// CC-CEDICT/Pleco sur 2 lignes (caractère seul, puis « pinyin ⇥ définition »)
// en fusionnant la paire, et le format tout-en-un sur une ligne.
function parseImportText(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (PURE_HAN_RE.test(line)) {
      const next = lines[i + 1];
      if (next && !PURE_HAN_RE.test(next) && /[a-zü]/i.test(next)) {
        const d = parseDetail(next);
        out.push({ chinese: line, pinyin: d.pinyin, latin: d.latin });
        i++; // consomme la ligne détail
      } else {
        out.push({ chinese: line, pinyin: '', latin: '' });
      }
    } else {
      const f = fragmentsFrom(line);
      if (f.chinese || f.latin) out.push(f);
    }
    if (out.length >= 2000) break; // garde-fou
  }
  return out;
}

async function isUserPremium(userId) {
  const { rows } = await pool.query(
    `SELECT u.special_guest, us.plan_name, us.status AS sub_status, us.stripe_status
     FROM users u LEFT JOIN user_subscriptions us ON us.user_id = u.id WHERE u.id = $1`, [userId]);
  if (!rows.length) return false;
  const r = rows[0];
  return r.special_guest === true
    || (r.plan_name === 'premium' && r.sub_status === 'active' && r.stripe_status === 'active');
}

// ── POST /api/m/import/preview : parse + enrichit, sans rien écrire ───────────
// Direction-aware : on isole les mots dans la langue APPRISE.
//  • en→zh (apprend le chinois) → on ne garde que les lignes contenant du chinois ;
//    clé = chinois, traduction = anglais (auto depuis le dico si absente).
//  • zh→en (apprend l'anglais)  → on ne garde que les lignes contenant du latin ;
//    clé = anglais, traduction = chinois (auto depuis le dico si absente).
router.post('/api/m/import/preview', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const dir = await pool.query('SELECT quiz_direction FROM users WHERE id = $1', [uid]);
    const learningChinese = (dir.rows[0]?.quiz_direction || 'en→zh') !== 'zh→en';

    const parsed = parseImportText(req.body?.text);
    let toPinyin = null;
    try { toPinyin = require('pinyin-pro').pinyin; } catch { /* lib absente */ }

    const emptyStats = { total: 0, new: 0, needsTranslation: 0, owned: 0, duplicates: 0 };

    if (learningChinese) {
      // On ne relève QUE les mots chinois trouvés dans le texte.
      const withCn = parsed.filter((r) => r.chinese);
      const seen = new Set();
      const unique = withCn.filter((r) => (seen.has(r.chinese) ? false : seen.add(r.chinese)));
      const duplicates = withCn.length - unique.length;
      if (!unique.length) return res.json({ rows: [], stats: emptyStats, direction: 'en→zh' });

      // GROUP BY chinese : robuste aux doublons de `mots` (pas de contrainte
      // unique). owned = true si AU MOINS un doublon est possédé ; english/pinyin
      // privilégient la ligne possédée.
      const { rows: dict } = await pool.query(
        `SELECT m.chinese,
                (array_agg(m.english ORDER BY (um.user_id IS NOT NULL) DESC, m.id))[1] AS english,
                (array_agg(m.pinyin  ORDER BY (um.user_id IS NOT NULL) DESC, m.id))[1] AS pinyin,
                bool_or(um.user_id IS NOT NULL) AS owned
         FROM mots m
         LEFT JOIN user_mots um ON um.mot_id = m.id AND um.user_id = $1
         WHERE m.chinese = ANY($2::text[])
         GROUP BY m.chinese`, [uid, unique.map((r) => r.chinese)]);
      const dictMap = new Map(dict.map((d) => [d.chinese, d]));

      const rows = unique.map((r) => {
        const d = dictMap.get(r.chinese);
        const pinyin = r.pinyin || d?.pinyin || (toPinyin ? toPinyin(r.chinese, { toneType: 'symbol' }) : '');
        const english = r.latin || d?.english || '';
        // owned = déjà dans ta collection ; known = reconnu dans le dictionnaire
        // (traduction auto) ; new = traduit depuis ton texte ; sinon à traduire.
        const status = d?.owned ? 'owned'
          : (!english ? 'needs_translation' : (d ? 'known' : 'new'));
        return { chinese: r.chinese, pinyin, english, status };
      });
      return res.json({ rows, stats: buildStats(rows, duplicates), direction: 'en→zh' });
    }

    // Apprend l'anglais : on relève les mots latins (anglais).
    const withEn = parsed.filter((r) => r.latin);
    const seen = new Set();
    const unique = withEn.filter((r) => { const k = r.latin.toLowerCase(); return seen.has(k) ? false : seen.add(k); });
    const duplicates = withEn.length - unique.length;
    if (!unique.length) return res.json({ rows: [], stats: emptyStats, direction: 'zh→en' });

    // GROUP BY lower(english) : owned = true si un mot d'anglais équivalent est
    // possédé (robuste aux doublons) ; chinois/pinyin privilégient la ligne possédée.
    const { rows: dict } = await pool.query(
      `SELECT lower(m.english) AS key,
              (array_agg(m.chinese ORDER BY (um.user_id IS NOT NULL) DESC, m.id))[1] AS chinese,
              (array_agg(m.pinyin  ORDER BY (um.user_id IS NOT NULL) DESC, m.id))[1] AS pinyin,
              bool_or(um.user_id IS NOT NULL) AS owned
       FROM mots m
       LEFT JOIN user_mots um ON um.mot_id = m.id AND um.user_id = $1
       WHERE lower(m.english) = ANY($2::text[])
       GROUP BY lower(m.english)`,
      [uid, unique.map((r) => r.latin.toLowerCase())]);
    const dictMap = new Map(dict.map((d) => [d.key, d]));

    const rows = unique.map((r) => {
      const d = dictMap.get(r.latin.toLowerCase());
      const chinese = r.chinese || d?.chinese || '';
      const pinyin = r.pinyin || d?.pinyin || (chinese && toPinyin ? toPinyin(chinese, { toneType: 'symbol' }) : '');
      const status = d?.owned ? 'owned'
        : (!chinese ? 'needs_translation' : (d ? 'known' : 'new'));
      return { chinese, pinyin, english: r.latin, status };
    });
    return res.json({ rows, stats: buildStats(rows, duplicates), direction: 'zh→en' });
  } catch (e) {
    console.error('m/import preview error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

function buildStats(rows, duplicates) {
  return {
    total: rows.length,
    new: rows.filter((r) => r.status === 'new').length,
    known: rows.filter((r) => r.status === 'known').length,
    needsTranslation: rows.filter((r) => r.status === 'needs_translation').length,
    owned: rows.filter((r) => r.status === 'owned').length,
    duplicates,
  };
}

// ── POST /api/m/import/commit : insère les mots confirmés (gratuit) ───────────
router.post('/api/m/import/commit', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  const words = Array.isArray(req.body?.words) ? req.body.words : [];
  // On ne garde que les lignes valides (chinois + anglais).
  const clean = [];
  const seen = new Set();
  for (const w of words) {
    const chinese = (w?.chinese || '').trim();
    const english = (w?.english || '').trim();
    const pinyin = (w?.pinyin || '').trim();
    if (!chinese || !english || seen.has(chinese)) continue;
    seen.add(chinese);
    clean.push({ chinese, english, pinyin });
  }
  if (!clean.length) return res.status(400).json({ error: 'Nothing to import (each word needs a Chinese and an English).' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const premium = await isUserPremium(uid);
    const maxWords = premium ? 100000 : 600;
    const { rows: cnt } = await client.query('SELECT COUNT(*)::int AS n FROM user_mots WHERE user_id = $1', [uid]);
    let remaining = maxWords - cnt[0].n;

    let added = 0, skippedOwned = 0;
    for (const w of clean) {
      if (remaining <= 0) break;
      // Upsert du mot par `chinese`
      let motId;
      const found = await client.query('SELECT id FROM mots WHERE chinese = $1', [w.chinese]);
      if (found.rows.length) {
        motId = found.rows[0].id;
      } else {
        const ins = await client.query(
          `INSERT INTO mots (chinese, pinyin, english) VALUES ($1, $2, $3) RETURNING id`,
          [w.chinese, w.pinyin || null, w.english]);
        motId = ins.rows[0].id;
      }
      const owned = await client.query('SELECT 1 FROM user_mots WHERE user_id = $1 AND mot_id = $2', [uid, motId]);
      if (owned.rows.length) { skippedOwned++; continue; }
      await client.query('INSERT INTO user_mots (user_id, mot_id, score) VALUES ($1, $2, 0)', [uid, motId]);
      added++;
      remaining--;
    }
    const limitReached = remaining <= 0 && (added + skippedOwned) < clean.length;
    await client.query('COMMIT');
    res.json({ success: true, added, skippedOwned, limitReached, maxWords });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/import commit error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── PUT /api/m/words/:motId : éditer un mot (chinois/pinyin/anglais) ──────────
router.put('/api/m/words/:motId', requireToken, async (req, res) => {
  try {
    const motId = parseInt(req.params.motId, 10);
    if (!motId) return res.status(400).json({ error: 'Invalid word' });
    const { chinese, pinyin, english, description } = req.body || {};

    // On n'édite que si l'utilisateur possède le mot dans sa collection
    const owns = await pool.query(
      'SELECT 1 FROM user_mots WHERE user_id = $1 AND mot_id = $2',
      [req.tokenUser.id, motId]
    );
    if (!owns.rows.length) return res.status(403).json({ error: 'Not your word' });

    const { rows } = await pool.query(
      `UPDATE mots
       SET chinese     = COALESCE($2, chinese),
           pinyin      = COALESCE($3, pinyin),
           english     = COALESCE($4, english),
           description = COALESCE($5, description)
       WHERE id = $1
       RETURNING id, chinese, pinyin, english, description, hsk`,
      [motId, chinese ?? null, pinyin ?? null, english ?? null, description ?? null]
    );
    res.json({ word: rows[0] });
  } catch (e) {
    console.error('m/word update error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/m/words/:motId : retirer un mot de sa collection ──────────────
router.delete('/api/m/words/:motId', requireToken, async (req, res) => {
  try {
    const motId = parseInt(req.params.motId, 10);
    if (!motId) return res.status(400).json({ error: 'Invalid word' });
    await pool.query(
      'DELETE FROM user_mots WHERE user_id = $1 AND mot_id = $2',
      [req.tokenUser.id, motId]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('m/word delete error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/character/:char : sens d'un caractère seul (tap sur la carte) ──
router.get('/api/m/character/:char', requireToken, async (req, res) => {
  try {
    const ch = decodeURIComponent(req.params.char || '').trim();
    if (!ch) return res.status(400).json({ error: 'Missing character' });
    // Correspondance exacte d'un mot d'un seul caractère dans le dictionnaire
    const { rows } = await pool.query(
      'SELECT chinese, pinyin, english, hsk FROM mots WHERE chinese = $1 ORDER BY id ASC LIMIT 1',
      [ch]
    );
    res.json({ character: rows[0] || null });
  } catch (e) {
    console.error('m/character error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══ JiaStore : marketplace de packs de mots ═══════════════════════════════════

// ── GET /api/m/market/packs : liste (recherche + filtre prix + tri) ──────────
router.get('/api/m/market/packs', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const q = (req.query.q || '').trim();
    const min = Number.isFinite(+req.query.min) ? Math.max(0, parseInt(req.query.min, 10) || 0) : 0;
    const max = Number.isFinite(+req.query.max) && req.query.max !== '' ? parseInt(req.query.max, 10) : 1000000;
    const sortMap = {
      recent: 'wp.created_at DESC',
      price_asc: 'wp.price ASC, wp.created_at DESC',
      price_desc: 'wp.price DESC, wp.created_at DESC',
      popular: 'wp.sales_count DESC, wp.created_at DESC',
    };
    const orderBy = sortMap[req.query.sort] || sortMap.recent;

    const params = [uid, min, max];
    let where = 'wp.published = TRUE AND wp.price >= $2 AND wp.price <= $3';
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (wp.title ILIKE $${params.length} OR wp.description ILIKE $${params.length} OR COALESCE(u.name, wp.creator_name, '') ILIKE $${params.length})`;
    }
    const { rows } = await pool.query(
      `SELECT wp.id, wp.title, wp.price, wp.cover_key, wp.is_official, wp.sales_count,
              COALESCE(u.name, wp.creator_name, 'Anonymous') AS creator,
              (SELECT COUNT(*) FROM word_pack_items i WHERE i.pack_id = wp.id)::int AS word_count,
              EXISTS(SELECT 1 FROM pack_purchases pp WHERE pp.pack_id = wp.id AND pp.buyer_id = $1) AS owned
       FROM word_packs wp
       LEFT JOIN users u ON u.id = wp.creator_id
       WHERE ${where}
       ORDER BY ${orderBy}`, params);
    res.json({ packs: rows });
  } catch (e) {
    console.error('m/market packs error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/market/packs/:id : détail + aperçu des mots ────────────────────
router.get('/api/m/market/packs/:id', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid pack' });
    const { rows } = await pool.query(
      `SELECT wp.id, wp.title, wp.description, wp.price, wp.cover_key, wp.is_official, wp.sales_count,
              wp.creator_id,
              COALESCE(u.name, wp.creator_name, 'Anonymous') AS creator,
              (SELECT COUNT(*) FROM word_pack_items i WHERE i.pack_id = wp.id)::int AS word_count,
              EXISTS(SELECT 1 FROM pack_purchases pp WHERE pp.pack_id = wp.id AND pp.buyer_id = $1) AS owned
       FROM word_packs wp
       LEFT JOIN users u ON u.id = wp.creator_id
       WHERE wp.id = $2 AND wp.published = TRUE`, [uid, id]);
    if (!rows.length) return res.status(404).json({ error: 'Pack not found' });
    const pack = rows[0];
    const { rows: preview } = await pool.query(
      `SELECT m.id, m.chinese, m.pinyin, m.english FROM word_pack_items i
       JOIN mots m ON m.id = i.mot_id WHERE i.pack_id = $1 ORDER BY m.id LIMIT 8`, [id]);
    pack.isMine = pack.creator_id === uid;
    delete pack.creator_id;
    res.json({ pack, preview });
  } catch (e) {
    console.error('m/market pack detail error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/market/packs/:id/buy : achat atomique ────────────────────────
router.post('/api/m/market/packs/:id/buy', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid pack' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: pk } = await client.query(
      'SELECT id, title, price, creator_id FROM word_packs WHERE id = $1 AND published = TRUE FOR UPDATE', [id]);
    if (!pk.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pack not found' }); }
    const pack = pk[0];
    if (pack.creator_id === uid) { await client.query('ROLLBACK'); return res.status(400).json({ error: "It's your own pack." }); }

    const { rows: already } = await client.query(
      'SELECT 1 FROM pack_purchases WHERE pack_id = $1 AND buyer_id = $2', [id, uid]);
    if (already.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'You already own this pack.' }); }

    const { rows: cnt } = await client.query('SELECT COUNT(*)::int AS n FROM word_pack_items WHERE pack_id = $1', [id]);
    if (cnt[0].n === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'This pack is not available yet.' }); }

    const { rows: bal } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [uid]);
    if (!bal.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }
    if (bal[0].balance < pack.price) { await client.query('ROLLBACK'); return res.status(402).json({ error: 'Not enough coins' }); }

    // Ajoute les mots du pack non déjà possédés
    const ins = await client.query(
      `INSERT INTO user_mots (user_id, mot_id, score, nb_quiz, nb_correct, last_seen)
       SELECT $1, i.mot_id, 0, 0, 0, NULL FROM word_pack_items i
       WHERE i.pack_id = $2 AND NOT EXISTS (SELECT 1 FROM user_mots um WHERE um.user_id = $1 AND um.mot_id = i.mot_id)
       RETURNING mot_id`, [uid, id]);
    const added = ins.rowCount;

    // Débit acheteur
    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [pack.price, uid]);
    await client.query(
      `INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, 'pack_purchase', $3)`,
      [uid, -pack.price, `Pack: ${pack.title}`]);

    // Crédit créateur (packs communautaires uniquement ; officiels = puits de coins)
    if (pack.creator_id && pack.price > 0) {
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [pack.price, pack.creator_id]);
      await client.query(
        `INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, 'pack_sale', $3)`,
        [pack.creator_id, pack.price, `Sold: ${pack.title}`]);
    }

    await client.query(
      'INSERT INTO pack_purchases (pack_id, buyer_id, price_paid) VALUES ($1, $2, $3)', [id, uid, pack.price]);
    await client.query('UPDATE word_packs SET sales_count = sales_count + 1 WHERE id = $1', [id]);

    await client.query('COMMIT');
    res.json({ success: true, wordsAdded: added, newBalance: bal[0].balance - pack.price });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/market buy error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

// ── GET /api/m/wallet : solde + transactions (page bank) ─────────────────────
router.get('/api/m/wallet', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const [me, tx] = await Promise.all([
      pool.query('SELECT balance FROM users WHERE id = $1', [uid]),
      pool.query(
        `SELECT id, amount, type, description, created_at
         FROM transactions WHERE user_id = $1 AND amount != 0
         ORDER BY created_at DESC LIMIT 100`, [uid]),
    ]);
    res.json({ balance: me.rows[0]?.balance || 0, transactions: tx.rows });
  } catch (e) {
    console.error('m/wallet error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/mentors : annuaire des mentors ────────────────────────────────
router.get('/api/m/mentors', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.languages_spoken, u.teaching_languages, u.session_price, u.session_currency,
              u.years_experience, u.mentor_bio, u.mentor_links,
              (SELECT COUNT(DISTINCT cs.student_id)
                 FROM classrooms c JOIN classroom_students cs ON cs.classroom_id = c.id
                 WHERE c.teacher_id = u.id AND cs.status = 'active')::int AS student_count,
              (SELECT COUNT(l.id)
                 FROM lessons l JOIN classrooms c ON c.id = l.classroom_id
                 WHERE c.teacher_id = u.id)::int AS task_count
       FROM users u
       WHERE u.role = 'teacher' AND u.mentor_listed = TRUE
       ORDER BY student_count DESC, u.name ASC`
    );
    const mentors = rows.map((m) => {
      const links = Array.isArray(m.mentor_links) ? m.mentor_links : [];
      return {
        id: m.id, name: m.name, languages_spoken: m.languages_spoken,
        teaching_languages: (m.teaching_languages || '').split(',').map((s) => s.trim()).filter(Boolean),
        session_price: m.session_price != null ? Number(m.session_price) : null,
        session_currency: m.session_currency || 'EUR',
        years_experience: m.years_experience, mentor_bio: m.mentor_bio,
        student_count: m.student_count, task_count: m.task_count,
        link: links[0] || null,
      };
    });
    res.json({ mentors });
  } catch (e) {
    console.error('m/mentors error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/student/classes : mentors rejoints + tasks en cours ───────────
// Miroir de /api/student/my-classes : sert à la page account ET au quiz.
router.get('/api/m/student/classes', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const { rows: mentors } = await pool.query(
      `SELECT t.id, COALESCE(NULLIF(TRIM(t.name), ''), 'Your teacher') AS name, MIN(cs.joined_at) AS since
       FROM classroom_students cs
       JOIN classrooms c ON c.id = cs.classroom_id
       JOIN users t ON t.id = c.teacher_id
       WHERE cs.student_id = $1 AND cs.status = 'active'
       GROUP BY t.id, t.name
       ORDER BY since ASC`, [uid]);

    const { rows: taskRows } = await pool.query(
      `SELECT l.id, l.title, c.name AS class_name,
              (SELECT COUNT(*) FROM lesson_words lw WHERE lw.lesson_id = l.id)::int AS word_count,
              (SELECT COALESCE(ROUND(AVG(COALESCE(um.score, 0))), 0)
                 FROM lesson_words lw
                 LEFT JOIN user_mots um ON um.mot_id = lw.mot_id AND um.user_id = $1
                 WHERE lw.lesson_id = l.id)::int AS knowledge
       FROM lessons l
       JOIN classrooms c ON c.id = l.classroom_id
       JOIN classroom_students cs ON cs.classroom_id = c.id AND cs.student_id = $1 AND cs.status = 'active'
       WHERE l.created_at >= COALESCE(cs.joined_at, 'epoch')
       ORDER BY l.created_at DESC`, [uid]);

    const tasks = taskRows
      .filter((t) => t.word_count > 0 && t.knowledge < 100)
      .map((t) => ({ id: t.id, title: t.title, class_name: t.class_name, word_count: t.word_count, knowledge: t.knowledge }));

    res.json({ mentors, tasks });
  } catch (e) {
    console.error('m/student classes error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/student/lessons/:id : détail d'un cours (notes + mots) ─────────
router.get('/api/m/student/lessons/:id', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const lessonId = parseInt(req.params.id, 10);
    const access = await pool.query(
      `SELECT l.id FROM lessons l
       JOIN classroom_students cs ON cs.classroom_id = l.classroom_id
       WHERE l.id = $1 AND cs.student_id = $2 AND cs.status = 'active'`, [lessonId, uid]);
    if (!access.rows.length) return res.status(404).json({ error: 'Course not found' });

    const [lrows, words] = await Promise.all([
      pool.query(
        `SELECT l.id, l.title, l.summary, l.created_at, c.name AS class_name
         FROM lessons l JOIN classrooms c ON c.id = l.classroom_id WHERE l.id = $1`, [lessonId]),
      pool.query(
        `SELECT m.id, m.chinese, m.pinyin, m.english
         FROM lesson_words lw JOIN mots m ON m.id = lw.mot_id
         WHERE lw.lesson_id = $1 ORDER BY lw.id ASC`, [lessonId]),
    ]);
    res.json({ lesson: lrows.rows[0], words: words.rows });
  } catch (e) {
    console.error('m/student lesson error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/student/mentors/:teacherId/leave : quitter un prof ───────────
router.post('/api/m/student/mentors/:teacherId/leave', requireToken, async (req, res) => {
  try {
    const teacherId = parseInt(req.params.teacherId, 10);
    if (!teacherId) return res.status(400).json({ error: 'Invalid mentor' });
    await pool.query(
      `UPDATE classroom_students cs SET status = 'removed'
       FROM classrooms c
       WHERE cs.classroom_id = c.id AND c.teacher_id = $1 AND cs.student_id = $2 AND cs.status = 'active'`,
      [teacherId, req.tokenUser.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('m/student leave mentor error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/student/tasks/:id/start : démarre une task (retourne les ids) ─
router.post('/api/m/student/tasks/:id/start', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const lessonId = parseInt(req.params.id, 10);
    const access = await pool.query(
      `SELECT l.id FROM lessons l
       JOIN classroom_students cs ON cs.classroom_id = l.classroom_id
       WHERE l.id = $1 AND cs.student_id = $2 AND cs.status = 'active'`, [lessonId, uid]);
    if (!access.rows.length) return res.status(404).json({ error: 'Task not found' });

    const { rows } = await pool.query('SELECT mot_id FROM lesson_words WHERE lesson_id = $1', [lessonId]);
    const ids = rows.map((r) => r.mot_id);
    if (!ids.length) return res.status(400).json({ error: 'Task has no words' });

    // Ajoute les mots manquants à la collection de l'élève
    await pool.query(
      `INSERT INTO user_mots (user_id, mot_id)
       SELECT $1, m FROM unnest($2::int[]) AS m
       WHERE NOT EXISTS (SELECT 1 FROM user_mots WHERE user_id = $1 AND mot_id = m)`,
      [uid, ids]);

    res.json({ success: true, ids, type: 'pinyin' });
  } catch (e) {
    console.error('m/student task start error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/student/tasks/:id/result : enregistre le résultat (côté prof) ─
router.post('/api/m/student/tasks/:id/result', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const lessonId = parseInt(req.params.id, 10);
    const access = await pool.query(
      `SELECT l.id FROM lessons l
       JOIN classroom_students cs ON cs.classroom_id = l.classroom_id
       WHERE l.id = $1 AND cs.student_id = $2 AND cs.status = 'active'`, [lessonId, uid]);
    if (!access.rows.length) return res.status(404).json({ error: 'Task not found' });
    const score = parseInt(req.body?.score, 10);
    const total = parseInt(req.body?.total, 10);
    await pool.query(
      `INSERT INTO lesson_quiz_results (lesson_id, student_id, score, total) VALUES ($1, $2, $3, $4)`,
      [lessonId, uid, Number.isInteger(score) ? score : null, Number.isInteger(total) ? total : null]);
    res.json({ success: true });
  } catch (e) {
    console.error('m/student task result error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/classes/join : rejoindre une classe avec un code ─────────────
router.post('/api/m/classes/join', requireToken, async (req, res) => {
  try {
    const code = (req.body?.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Code required' });
    const { rows } = await pool.query(
      'SELECT id, teacher_id, name FROM classrooms WHERE join_code = $1 AND archived = FALSE', [code]
    );
    if (!rows.length) return res.status(404).json({ error: 'Class not found' });
    const classroom = rows[0];
    if (classroom.teacher_id === req.tokenUser.id) {
      return res.status(400).json({ error: "You're the teacher of this class" });
    }
    await pool.query(
      `INSERT INTO classroom_students (classroom_id, student_id)
       VALUES ($1, $2)
       ON CONFLICT (classroom_id, student_id) DO UPDATE SET status = 'active'`,
      [classroom.id, req.tokenUser.id]
    );
    res.json({ success: true, classroom: { id: classroom.id, name: classroom.name } });
  } catch (e) {
    console.error('m/classes join error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/account : profil complet (façon page account EJS) ─────────────
// Renvoie : identité (nom/tagline/pays/direction), solde, stats globales,
// distribution de maîtrise (pinyin + caractères), stats HSK, heatmap de quiz
// et les 5 derniers quiz. Assez pour reconstruire toute la page côté mobile.
router.get('/api/m/account', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const year = new Date().getFullYear();
    const [me, wordRows, quizzes, duels, contrib, recent] = await Promise.all([
      pool.query('SELECT name, balance, tagline, country, quiz_direction FROM users WHERE id = $1', [uid]),
      pool.query(
        `SELECT um.score, um.score_character, m.hsk
         FROM user_mots um JOIN mots m ON m.id = um.mot_id
         WHERE um.user_id = $1`, [uid]),
      pool.query('SELECT COUNT(*)::int AS n FROM quiz_history WHERE user_id = $1', [uid]),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM duels
         WHERE (challenger_id = $1 OR opponent_id = $1) AND status = 'completed'`, [uid]),
      pool.query(
        `SELECT DATE(date_completed) AS date, COUNT(*) AS count
         FROM quiz_history
         WHERE user_id = $1 AND EXTRACT(YEAR FROM date_completed) = $2
         GROUP BY DATE(date_completed) ORDER BY date ASC`, [uid, year]),
      pool.query(
        `SELECT score, total_questions, ratio, quiz_type, date_completed
         FROM quiz_history WHERE user_id = $1
         ORDER BY date_completed DESC LIMIT 5`, [uid]),
    ]);

    const words = wordRows.rows;

    // Distribution de maîtrise (mêmes seuils que l'EJS)
    const bucket = (scores) => ({
      mastered: scores.filter((s) => s >= 90).length,
      learning: scores.filter((s) => s >= 60 && s < 90).length,
      medium:   scores.filter((s) => s >= 30 && s < 60).length,
      novice:   scores.filter((s) => s < 30).length,
    });
    const pinyinDist = bucket(words.map((w) => w.score || 0));
    const charDist   = bucket(words.map((w) => w.score_character || 0));

    // Stats HSK : nombre + % maîtrisé par niveau
    const HSK_ORDER = ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6', 'Street'];
    const groups = {};
    words.forEach((w) => {
      const lvl = w.hsk ? `HSK${w.hsk}` : 'Street';
      (groups[lvl] = groups[lvl] || []).push(w.score || 0);
    });
    const hsk = HSK_ORDER.map((key) => {
      const scores = groups[key] || [];
      if (!scores.length) return null;
      const mastered = scores.filter((s) => s >= 90).length;
      return {
        key,
        label: key === 'Street' ? 'HSK Street' : key.replace('HSK', 'HSK '),
        count: scores.length,
        masteredPct: Math.round((mastered / scores.length) * 100),
      };
    }).filter(Boolean);

    res.json({
      name: me.rows[0]?.name || '',
      tagline: me.rows[0]?.tagline || 'Learning Chinese!',
      country: me.rows[0]?.country || null,
      quizDirection: me.rows[0]?.quiz_direction || 'en→zh',
      balance: me.rows[0]?.balance || 0,
      words: words.length,
      quizzes: quizzes.rows[0].n,
      duels: duels.rows[0].n,
      mastery: { pinyin: pinyinDist, character: charDist, total: words.length },
      hsk,
      recentQuizzes: recent.rows.map((r) => ({
        score: r.score, total: r.total_questions,
        ratio: r.ratio != null ? Number(r.ratio) : null,
        type: r.quiz_type || 'quiz',
        date: r.date_completed instanceof Date ? r.date_completed.toISOString() : String(r.date_completed),
      })),
      year,
      contributions: contrib.rows.map((r) => ({
        date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
        count: parseInt(r.count, 10) || 0,
      })),
    });
  } catch (e) {
    console.error('m/account error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /api/m/account : éditer nom / tagline / pays (popup "Edit info") ──────
router.put('/api/m/account', requireToken, async (req, res) => {
  try {
    const { name, tagline, country } = req.body || {};
    if (!name || String(name).length > 50) {
      return res.status(400).json({ error: 'Name is required (max 50 characters)' });
    }
    if (tagline && String(tagline).length > 100) {
      return res.status(400).json({ error: 'Tagline must be under 100 characters' });
    }
    const code = country ? String(country).toUpperCase().slice(0, 2) : null;
    await pool.query(
      `UPDATE users SET name = $1, tagline = $2, country = $3 WHERE id = $4`,
      [String(name).trim(), tagline ? String(tagline).trim() : null, code, req.tokenUser.id]
    );
    res.json({ success: true, name: String(name).trim(), tagline: tagline || null, country: code });
  } catch (e) {
    console.error('m/account update error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/users/:id : profil public d'un joueur (page user-profile EJS) ──
// Identité + stats globales + maîtrise (pinyin/caractères) + répartition HSK.
router.get('/api/m/users/:id', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const targetId = parseInt(req.params.id, 10);
    if (!targetId) return res.status(400).json({ error: 'Invalid user' });

    const [me, wordRows, quizzes, duels] = await Promise.all([
      pool.query('SELECT id, name, tagline, country, created_at FROM users WHERE id = $1', [targetId]),
      pool.query(
        `SELECT um.score, um.score_character, m.hsk
         FROM user_mots um JOIN mots m ON m.id = um.mot_id
         WHERE um.user_id = $1`, [targetId]),
      pool.query('SELECT COUNT(*)::int AS n FROM quiz_history WHERE user_id = $1', [targetId]),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM duels
         WHERE (challenger_id = $1 OR opponent_id = $1) AND status = 'completed'`, [targetId]),
    ]);
    if (!me.rows.length) return res.status(404).json({ error: 'User not found' });
    const u = me.rows[0];
    const words = wordRows.rows;

    // Distribution de maîtrise (mêmes seuils que l'EJS)
    const bucket = (scores) => ({
      mastered: scores.filter((s) => s >= 90).length,
      learning: scores.filter((s) => s >= 60 && s < 90).length,
      medium:   scores.filter((s) => s >= 30 && s < 60).length,
      novice:   scores.filter((s) => s < 30).length,
    });
    const pinyinDist = bucket(words.map((w) => w.score || 0));
    const charDist   = bucket(words.map((w) => w.score_character || 0));

    // Répartition HSK (nombre de mots par niveau)
    const HSK_ORDER = ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6', 'Street'];
    const groups = {};
    words.forEach((w) => {
      const lvl = w.hsk ? `HSK${w.hsk}` : 'Street';
      groups[lvl] = (groups[lvl] || 0) + 1;
    });
    const hsk = HSK_ORDER
      .filter((key) => groups[key])
      .map((key) => ({ label: key === 'Street' ? 'Street' : key.replace('HSK', 'HSK '), count: groups[key] }));

    res.json({
      id: u.id,
      name: u.name || '',
      tagline: u.tagline || null,
      country: u.country || null,
      created_at: u.created_at instanceof Date ? u.created_at.toISOString() : (u.created_at || null),
      isMe: u.id === uid,
      words: words.length,
      quizzes: quizzes.rows[0].n,
      duels: duels.rows[0].n,
      mastery: { pinyin: pinyinDist, character: charDist, total: words.length },
      hsk,
    });
  } catch (e) {
    console.error('m/user profile error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/settings : préférences (direction, langue, toggles) ───────────
router.get('/api/m/settings', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT quiz_direction, interface_lang, ghost_mode,
              notifications_enabled, word_review_enabled
       FROM users WHERE id = $1`, [req.tokenUser.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const u = rows[0];
    res.json({
      quiz_direction: u.quiz_direction || 'en→zh',
      interface_lang: u.interface_lang || 'en',
      ghost_mode: !!u.ghost_mode,
      notifications_enabled: !!u.notifications_enabled,
      word_review_enabled: !!u.word_review_enabled,
    });
  } catch (e) {
    console.error('m/settings get error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /api/m/settings : met à jour un sous-ensemble de préférences ────────
router.patch('/api/m/settings', requireToken, async (req, res) => {
  try {
    const body = req.body || {};
    const sets = [];
    const params = [];
    const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (body.quiz_direction !== undefined) {
      if (!['en→zh', 'zh→en'].includes(body.quiz_direction)) {
        return res.status(400).json({ error: 'Invalid direction' });
      }
      push('quiz_direction', body.quiz_direction);
    }
    if (body.interface_lang !== undefined) {
      if (!['en', 'zh'].includes(body.interface_lang)) {
        return res.status(400).json({ error: 'Invalid language' });
      }
      push('interface_lang', body.interface_lang);
    }
    if (typeof body.ghost_mode === 'boolean') push('ghost_mode', body.ghost_mode);
    if (typeof body.notifications_enabled === 'boolean') push('notifications_enabled', body.notifications_enabled);
    if (typeof body.word_review_enabled === 'boolean') push('word_review_enabled', body.word_review_enabled);

    if (!sets.length) return res.status(400).json({ error: 'No valid fields' });

    params.push(req.tokenUser.id);
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    res.json({ success: true });
  } catch (e) {
    console.error('m/settings patch error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/m/account/delete : supprimer le compte (danger zone) ─────────
router.delete('/api/m/account/delete', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Bloque si abonnement premium actif non résilié (même règle que le web)
    const sub = await client.query(
      `SELECT cancel_at_period_end FROM user_subscriptions WHERE user_id = $1 AND status = 'active'`, [uid]
    );
    if (sub.rows.some((r) => r.cancel_at_period_end !== true)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cancel your premium subscription before deleting your account.' });
    }
    await client.query('DELETE FROM user_mots WHERE user_id = $1', [uid]);
    await client.query('DELETE FROM user_subscriptions WHERE user_id = $1', [uid]);
    const del = await client.query('DELETE FROM users WHERE id = $1 RETURNING id', [uid]);
    if (!del.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/account delete error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── GET /api/m/duels : duels en attente + bilan ──────────────────────────────
router.get('/api/m/duels', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const [pending, stats, recent, bullies] = await Promise.all([
      pool.query(
        `SELECT d.id, d.bet_amount, d.status, d.created_at,
                u1.name AS challenger_name, u2.name AS opponent_name,
                CASE WHEN d.challenger_id = $1 THEN 'challenger' ELSE 'opponent' END AS user_role,
                CASE WHEN d.challenger_id = $1 THEN d.challenger_score ELSE d.opponent_score END AS my_score
         FROM duels d
         JOIN users u1 ON d.challenger_id = u1.id
         JOIN users u2 ON d.opponent_id = u2.id
         WHERE (d.challenger_id = $1 OR d.opponent_id = $1) AND d.status = 'pending'
           -- Un duel en attente > 7 jours est considéré périmé : on ne l'affiche pas.
           AND d.created_at > NOW() - INTERVAL '7 days'
         ORDER BY d.created_at DESC`, [uid]),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE winner_id = $1)::int AS wins,
           COUNT(*) FILTER (WHERE winner_id IS NOT NULL AND winner_id <> $1
             AND (challenger_id = $1 OR opponent_id = $1))::int AS losses
         FROM duels
         WHERE (challenger_id = $1 OR opponent_id = $1) AND status = 'completed'`, [uid]),
      // Duels récents terminés (avec scores + issue vue par l'utilisateur)
      pool.query(
        `SELECT d.id, d.bet_amount, d.created_at,
                CASE WHEN d.challenger_id = $1 THEN u2.name ELSE u1.name END AS opponent_name,
                CASE WHEN d.challenger_id = $1 THEN d.challenger_score ELSE d.opponent_score END AS my_score,
                CASE WHEN d.challenger_id = $1 THEN d.opponent_score ELSE d.challenger_score END AS opp_score,
                CASE WHEN d.winner_id = $1 THEN 'won'
                     WHEN d.winner_id IS NULL THEN 'draw'
                     ELSE 'lost' END AS result
         FROM duels d
         JOIN users u1 ON d.challenger_id = u1.id
         JOIN users u2 ON d.opponent_id = u2.id
         WHERE (d.challenger_id = $1 OR d.opponent_id = $1) AND d.status = 'completed'
         ORDER BY d.created_at DESC LIMIT 5`, [uid]),
      // Rivaux : bilan net des paris face à chaque adversaire (comme /api/duels/bullies)
      pool.query(
        `SELECT opponent.id, opponent.name,
           SUM(CASE
             WHEN (d.challenger_id = $1 AND d.challenger_score > d.opponent_score)
               OR (d.opponent_id = $1 AND d.opponent_score > d.challenger_score) THEN d.bet_amount
             WHEN d.challenger_score = d.opponent_score THEN 0
             ELSE -d.bet_amount END)::int AS balance
         FROM duels d
         JOIN users opponent ON (
           (d.challenger_id = $1 AND d.opponent_id = opponent.id) OR
           (d.opponent_id = $1 AND d.challenger_id = opponent.id))
         WHERE d.challenger_score IS NOT NULL AND d.opponent_score IS NOT NULL
           AND d.bet_amount > 0 AND opponent.id <> $1
           AND opponent.quiz_direction = (SELECT quiz_direction FROM users WHERE id = $1)
           AND opponent.ghost_mode = FALSE
           -- Seulement les rivaux connectés au moins une fois ces 30 derniers jours.
           AND opponent.last_login >= NOW() - INTERVAL '30 days'
         GROUP BY opponent.id, opponent.name
         ORDER BY balance DESC LIMIT 8`, [uid]),
    ]);
    res.json({
      pending: pending.rows,
      wins: stats.rows[0]?.wins || 0,
      losses: stats.rows[0]?.losses || 0,
      recent: recent.rows,
      bullies: bullies.rows,
    });
  } catch (e) {
    console.error('m/duels error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/leaderboard : classement (profs exclus) ───────────────────────
router.get('/api/m/leaderboard', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.tagline, u.country,
         COUNT(*) FILTER (WHERE d.winner_id = u.id)::int AS wins,
         COUNT(*) FILTER (WHERE d.status = 'completed' AND d.winner_id IS NOT NULL
           AND d.winner_id <> u.id)::int AS losses,
         (SELECT COUNT(*)::int FROM user_mots um WHERE um.user_id = u.id) AS total_words
       FROM users u
       LEFT JOIN duels d ON (d.challenger_id = u.id OR d.opponent_id = u.id) AND d.status = 'completed'
       WHERE u.quiz_direction = (SELECT quiz_direction FROM users WHERE id = $1)
         AND u.ghost_mode = FALSE AND u.role <> 'teacher'
       GROUP BY u.id, u.name, u.tagline, u.country
       HAVING COUNT(*) FILTER (WHERE d.status = 'completed') > 0
       ORDER BY wins DESC, losses ASC
       LIMIT 50`, [uid]);
    const leaderboard = rows.map((r) => {
      const played = r.wins + r.losses;
      return { ...r, ratio: played > 0 ? Math.round((r.wins / played) * 100) : 0, isMe: r.id === uid };
    });
    res.json({ leaderboard });
  } catch (e) {
    console.error('m/leaderboard error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/referral : code de parrainage + lien partageable ──────────────
function genReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(7);
  let s = '';
  for (let i = 0; i < 7; i++) s += chars[bytes[i] % chars.length];
  return s;
}
async function ensureReferralCode(userId) {
  const cur = await pool.query('SELECT referral_code FROM users WHERE id = $1', [userId]);
  if (cur.rows[0] && cur.rows[0].referral_code) return cur.rows[0].referral_code;
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = genReferralCode();
    try {
      await pool.query(
        'UPDATE users SET referral_code = $1 WHERE id = $2 AND referral_code IS NULL',
        [code, userId]
      );
    } catch (e) { /* collision → réessai */ }
    const chk = await pool.query('SELECT referral_code FROM users WHERE id = $1', [userId]);
    if (chk.rows[0] && chk.rows[0].referral_code) return chk.rows[0].referral_code;
  }
  throw new Error('referral code generation failed');
}
router.get('/api/m/referral', requireToken, async (req, res) => {
  try {
    const code = await ensureReferralCode(req.tokenUser.id);
    res.json({ code, link: `https://jiayou.fr/?ref=${encodeURIComponent(code)}` });
  } catch (e) {
    console.error('m/referral error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/duels/players?q= : recherche d'adversaires (même direction) ───
router.get('/api/m/duels/players', requireToken, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ players: [] });
    const { rows } = await pool.query(
      `SELECT id, name FROM users
       WHERE name ILIKE $1 AND id <> $2 AND ghost_mode = FALSE
         AND quiz_direction = (SELECT quiz_direction FROM users WHERE id = $2)
       ORDER BY name ASC LIMIT 8`,
      [`%${q}%`, req.tokenUser.id]
    );
    res.json({ players: rows });
  } catch (e) {
    console.error('m/duels players error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/duels/recent-opponents : adversaires déjà affrontés ────────────
// Suggestions sous le champ "opponent" du popup. Distinct, plus récents d'abord,
// même direction, non fantômes. (Enregistrée AVANT /:id pour ne pas être masquée.)
router.get('/api/m/duels/recent-opponents', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const { rows } = await pool.query(
      `SELECT o.id, o.name, MAX(d.created_at) AS last_at
       FROM duels d
       JOIN users o ON o.id = CASE WHEN d.challenger_id = $1 THEN d.opponent_id ELSE d.challenger_id END
       WHERE (d.challenger_id = $1 OR d.opponent_id = $1)
         AND o.id <> $1 AND o.ghost_mode = FALSE
         AND o.quiz_direction = (SELECT quiz_direction FROM users WHERE id = $1)
       GROUP BY o.id, o.name
       ORDER BY last_at DESC
       LIMIT 5`,
      [uid]
    );
    res.json({ players: rows.map((r) => ({ id: r.id, name: r.name })) });
  } catch (e) {
    console.error('m/duels recent-opponents error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/duels/create : créer un duel (avec pari optionnel) ────────────
// Reprend la logique de /api/duels/create (génération du quiz + blocage des mises)
// mais en auth token. Limite : 5 duels en cours max, mêmes règles de solde.
router.post('/api/m/duels/create', requireToken, async (req, res) => {
  const challengerId = req.tokenUser.id;
  const {
    opponent_id, duel_type = 'classic', word_count = 20,
    quiz_type = 'pinyin', bet_amount = 0,
  } = req.body || {};
  const bet = Math.max(0, parseInt(bet_amount, 10) || 0);

  if (!opponent_id) return res.status(400).json({ error: 'Opponent required' });
  if (opponent_id === challengerId) return res.status(400).json({ error: "You can't duel yourself." });

  const client = await pool.connect();
  try {
    const opp = await client.query('SELECT id, name, balance FROM users WHERE id = $1', [opponent_id]);
    if (!opp.rows.length) return res.status(404).json({ error: 'Opponent not found' });

    const active = await client.query(
      `SELECT COUNT(*) FROM duels
       WHERE (challenger_id = $1 OR opponent_id = $1)
         AND status IN ('pending','active') AND created_at > NOW() - INTERVAL '7 days'`,
      [challengerId]
    );
    if (parseInt(active.rows[0].count, 10) >= 5) {
      return res.status(400).json({ error: 'You already have 5 duels in progress.' });
    }
    if (bet > 0 && opp.rows[0].balance < bet) {
      return res.status(400).json({ error: `${opp.rows[0].name} doesn't have enough coins to accept.` });
    }

    await client.query('BEGIN');
    const chal = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [challengerId]);
    if (chal.rows[0].balance < bet) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient coins to bet.' });
    }
    const oppLock = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [opponent_id]);
    if (bet > 0 && oppLock.rows[0].balance < bet) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `${opp.rows[0].name} doesn't have enough coins.` });
    }

    if (bet > 0) {
      const dChal = await addTransaction(client, challengerId, -bet, 'bet', 'Duel bet');
      const dOpp = await addTransaction(client, opponent_id, -bet, 'bet', 'Duel bet');
      if (!dChal || !dOpp) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Transaction failed' }); }
    }

    const quizData = await generateDuelQuiz(client, challengerId, opponent_id, duel_type, quiz_type, word_count);
    if (!quizData) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Not enough shared words to generate the duel.' });
    }

    const ins = await client.query(
      `INSERT INTO duels
        (challenger_id, opponent_id, duel_type, word_count, quiz_type, quiz_data, bet_amount, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING id`,
      [challengerId, opponent_id, duel_type, word_count, quiz_type, JSON.stringify(quizData), bet]
    );
    await client.query('COMMIT');
    res.json({ success: true, duelId: ins.rows[0].id });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/duels create error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── GET /api/m/duels/:id : détail d'un duel + mots à jouer ────────────────────
router.get('/api/m/duels/:id', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid duel' });
    const { rows } = await pool.query(
      `SELECT d.*, u1.name AS challenger_name, u2.name AS opponent_name
       FROM duels d JOIN users u1 ON d.challenger_id = u1.id JOIN users u2 ON d.opponent_id = u2.id
       WHERE d.id = $1 AND (d.challenger_id = $2 OR d.opponent_id = $2)`, [id, uid]);
    if (!rows.length) return res.status(404).json({ error: 'Duel not found' });
    const d = rows[0];
    const isChallenger = d.challenger_id === uid;
    const qd = typeof d.quiz_data === 'string' ? JSON.parse(d.quiz_data || '{}') : (d.quiz_data || {});
    const myScore = isChallenger ? d.challenger_score : d.opponent_score;
    const oppScore = isChallenger ? d.opponent_score : d.challenger_score;
    // Issue vue par l'utilisateur (uniquement quand le duel est terminé).
    let result = null;
    if (d.status === 'completed') {
      if (d.winner_id === uid) result = 'won';
      else if (d.winner_id === null) result = 'draw';
      else result = 'lost';
    }
    res.json({
      id: d.id,
      quiz_type: d.quiz_type || 'pinyin',
      duel_type: d.duel_type,
      status: d.status,
      bet_amount: d.bet_amount,
      opponent_name: isChallenger ? d.opponent_name : d.challenger_name,
      opponent_id: isChallenger ? d.opponent_id : d.challenger_id,
      my_name: isChallenger ? d.challenger_name : d.opponent_name,
      words: qd.words || [],
      my_score: myScore,
      opp_score: oppScore,
      result,
      created_at: d.created_at,
      already_played: myScore !== null,
    });
  } catch (e) {
    console.error('m/duel detail error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/duels/:id/submit : soumettre le score (miroir web) ────────────
router.post('/api/m/duels/:id/submit', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  const id = parseInt(req.params.id, 10);
  const score = parseInt(req.body?.score, 10) || 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const check = await client.query(
      `SELECT * FROM duels WHERE id = $1 AND (challenger_id = $2 OR opponent_id = $2) AND status = 'pending'`,
      [id, uid]
    );
    if (!check.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Duel not found or already completed' });
    }
    const duel = check.rows[0];
    const isChallenger = duel.challenger_id === uid;
    await client.query(
      `UPDATE duels SET ${isChallenger ? 'challenger_score' : 'opponent_score'} = $1 WHERE id = $2`,
      [score, id]
    );

    const upd = await client.query('SELECT * FROM duels WHERE id = $1', [id]);
    const cur = upd.rows[0];
    const bothPlayed = cur.challenger_score !== null && cur.opponent_score !== null;
    let winnerId = null;

    if (bothPlayed) {
      if (cur.challenger_score > cur.opponent_score) winnerId = cur.challenger_id;
      else if (cur.opponent_score > cur.challenger_score) winnerId = cur.opponent_id;

      if (winnerId && cur.bet_amount > 0) {
        await addTransaction(client, winnerId, cur.bet_amount * 2, 'bet_reward', 'Duel win');
      } else if (cur.bet_amount > 0) {
        // Match nul : remboursement des deux mises
        await addTransaction(client, cur.challenger_id, cur.bet_amount, 'bet_refund', 'Duel draw refund');
        await addTransaction(client, cur.opponent_id, cur.bet_amount, 'bet_refund', 'Duel draw refund');
      }
      await client.query(
        `UPDATE duels SET winner_id = $1, status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [winnerId, id]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, duel_completed: bothPlayed, winner_id: winnerId, you_won: winnerId === uid });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/duel submit error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── GET /api/m/quiz/words : mots pour un quiz scoré (type/count/hsk/difficulty) ─
// Reprend la logique de /quiz-mots : filtre HSK + plage de score selon la
// difficulté, avec élargissement progressif si pas assez de mots.
router.get('/api/m/quiz/words', requireToken, async (req, res) => {
  const userId = req.tokenUser.id;
  const requestedCount = parseInt(req.query.count, 10) || 10;
  const hskParam = req.query.hsk || 'all';
  const difficulty = req.query.difficulty || 'balanced';
  const idsParam = req.query.ids; // liste explicite (quick quiz sur "Your difficulties")

  try {
    // Mode liste explicite : on renvoie exactement ces mots de la collection.
    if (idsParam) {
      const ids = String(idsParam).split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
      if (!ids.length) return res.status(400).json({ error: 'invalid_ids' });
      const { rows } = await pool.query(
        `SELECT m.id, m.chinese, m.pinyin, m.english, m.hsk, COALESCE(um.score, 0) AS score
         FROM user_mots um INNER JOIN mots m ON um.mot_id = m.id
         WHERE um.user_id = $1 AND m.id = ANY($2)`, [userId, ids]);
      if (!rows.length) return res.status(400).json({ error: 'not_enough_words' });
      rows.sort(() => Math.random() - 0.5);
      await pool.query('UPDATE user_mots SET last_seen = NOW() WHERE user_id = $1 AND mot_id = ANY($2)', [userId, rows.map((r) => r.id)]);
      return res.json({ words: rows, count: rows.length });
    }

    // 1. Parse HSK (all | min-max ; max 7 → inclut "street" = hsk NULL)
    let hskMin = null, hskMax = null, includeStreet = false;
    if (hskParam === 'all') { /* pas de filtre */ }
    else if (hskParam === 'street') { includeStreet = true; }
    else {
      const parts = String(hskParam).split('-');
      if (parts.length === 2) {
        hskMin = parseInt(parts[0], 10); hskMax = parseInt(parts[1], 10);
        if (hskMax === 7) { includeStreet = true; hskMax = 6; }
      } else {
        const lvl = parseInt(hskParam, 10);
        if (lvl >= 1 && lvl <= 6) hskMin = hskMax = lvl;
      }
    }
    const buildHsk = (startIdx) => {
      const conds = [], params = []; let idx = startIdx;
      if (hskMin !== null && hskMax !== null) { conds.push(`m.hsk BETWEEN $${idx} AND $${idx + 1}`); params.push(hskMin, hskMax); idx += 2; }
      if (includeStreet) conds.push('m.hsk IS NULL');
      return { conds, params };
    };

    // 2. Plages de score par difficulté (essai du plus strict au plus large)
    const ranges = {
      discovery: [[0, 29], [0, 49], [0, 69], [0, 100]],
      balanced: [[30, 80], [15, 90], [5, 95], [0, 100]],
      revision: [[80, 100], [60, 100], [40, 100], [0, 100]],
    }[difficulty] || [[0, 100]];

    // 3. Élargissement progressif : on garde le plus grand pool trouvé
    let words = [];
    for (const [sMin, sMax] of ranges) {
      const { conds, params } = buildHsk(4);
      let q = `
        SELECT m.id, m.chinese, m.pinyin, m.english, m.hsk, COALESCE(um.score, 0) AS score
        FROM user_mots um INNER JOIN mots m ON um.mot_id = m.id
        WHERE um.user_id = $1 AND COALESCE(um.score, 0) BETWEEN $2 AND $3`;
      const qp = [userId, sMin, sMax];
      if (conds.length) { q += ` AND (${conds.join(' OR ')})`; qp.push(...params); }
      q += ` ORDER BY RANDOM() LIMIT $${qp.length + 1}`;
      qp.push(requestedCount);
      const { rows } = await pool.query(q, qp);
      if (rows.length > words.length) words = rows;
      if (words.length >= requestedCount) break;
    }

    if (!words.length) {
      return res.status(400).json({ error: 'not_enough_words', message: 'Not enough words in your collection for these settings.' });
    }
    // Marque comme vus
    await pool.query('UPDATE user_mots SET last_seen = NOW() WHERE user_id = $1 AND mot_id = ANY($2)',
      [userId, words.map((r) => r.id)]);
    res.json({ words: words.slice(0, requestedCount), count: Math.min(words.length, requestedCount) });
  } catch (e) {
    console.error('m/quiz/words error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/difficult-words : mots à retravailler (section "Your difficulties") ─
// Version allégée de /api/difficult-words : mots les plus ratés / score bas.
router.get('/api/m/difficult-words', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.chinese, m.pinyin, m.english,
         CASE WHEN COALESCE(um.nb_quiz, 0) >= 2
              THEN (1.0 - (COALESCE(um.nb_correct, 0)::float / NULLIF(um.nb_quiz, 0)))
              ELSE 0.5 END AS error_rate
       FROM user_mots um JOIN mots m ON um.mot_id = m.id
       WHERE um.user_id = $1 AND um.nb_quiz > 0
         AND ((um.nb_quiz >= 2 AND (um.nb_correct::float / um.nb_quiz) < 0.6) OR COALESCE(um.score,0) < 50)
       ORDER BY error_rate DESC, COALESCE(um.score,0) ASC, um.last_seen ASC NULLS FIRST
       LIMIT 12`,
      [req.tokenUser.id]
    );
    res.json({ words: rows.map((r) => ({ id: r.id, chinese: r.chinese, pinyin: r.pinyin, english: r.english })) });
  } catch (e) {
    console.error('m/difficult-words error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/quiz/stats : stats de quiz (section "My statistics") ───────────
// Quizzes joués + précision moyenne/meilleure (ratio 0-100) + mots & maîtrisés.
router.get('/api/m/quiz/stats', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const [hist, words, me] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS quizzes,
                COALESCE(ROUND(AVG(ratio)), 0)::int AS avg_pct,
                COALESCE(ROUND(MAX(ratio)), 0)::int AS best_pct
         FROM quiz_history WHERE user_id = $1`, [uid]),
      pool.query(
        `SELECT COUNT(*)::int AS words,
                COUNT(*) FILTER (WHERE COALESCE(score, 0) >= 90)::int AS mastered
         FROM user_mots WHERE user_id = $1`, [uid]),
      pool.query('SELECT quiz_direction FROM users WHERE id = $1', [uid]),
    ]);
    res.json({
      quizzes: hist.rows[0].quizzes,
      avg: hist.rows[0].avg_pct,
      best: hist.rows[0].best_pct,
      words: words.rows[0].words,
      mastered: words.rows[0].mastered,
      direction: me.rows[0]?.quiz_direction || 'en→zh',
    });
  } catch (e) {
    console.error('m/quiz stats error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/quiz/save : enregistre le quiz + met à jour scores + coins ────
router.post('/api/m/quiz/save', requireToken, async (req, res) => {
  const userId = req.tokenUser.id;
  const { score, total_questions, quiz_type = 'pinyin', results } = req.body || {};
  if (score === undefined || total_questions === undefined) {
    return res.status(400).json({ error: 'Missing score data' });
  }
  const scoreNum = parseInt(score, 10);
  const totalNum = parseInt(total_questions, 10);
  const ratio = totalNum > 0 ? ((scoreNum / totalNum) * 100).toFixed(2) : '0';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Coins = somme par mot réussi selon la maîtrise AVANT le quiz (autorité serveur)
    let coinsEarned = 0;
    if (Array.isArray(results)) {
      const correctIds = results.filter((r) => r.correct === true && r.mot_id)
        .map((r) => parseInt(r.mot_id, 10)).filter(Number.isInteger);
      if (correctIds.length) {
        const { rows: pre } = await client.query(
          `SELECT mot_id, COALESCE(score, 0) AS score FROM user_mots WHERE user_id = $1 AND mot_id = ANY($2)`,
          [userId, correctIds]
        );
        const byMot = {};
        pre.forEach((r) => { byMot[r.mot_id] = Number(r.score) || 0; });
        let raw = 0;
        for (const id of correctIds) {
          const s = byMot[id] ?? 0;
          if (s < 50) raw += 0.5; else if (s < 80) raw += 0.3; else raw += 0.1;
        }
        coinsEarned = Math.round(raw);
      }
    }

    const wordsForHistory = Array.isArray(results) ? results.map((r) => r.pinyin) : [];
    await client.query(
      `INSERT INTO quiz_history (user_id, score, total_questions, ratio, quiz_type, words_used)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, scoreNum, totalNum, ratio, quiz_type, JSON.stringify(wordsForHistory)]
    );

    if (Array.isArray(results)) {
      for (const r of results) {
        if (r.mot_id && r.correct !== null && r.correct !== undefined) {
          await updateWordScore(userId, r.mot_id, r.correct, quiz_type);
        }
      }
    }

    if (coinsEarned > 0) {
      await client.query(
        `INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, 'quiz_reward', $3)`,
        [userId, coinsEarned, `Quiz ${quiz_type}: ${scoreNum}/${totalNum} (${ratio}%)`]
      );
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [coinsEarned, userId]);
    }

    await client.query('COMMIT');
    res.json({ success: true, coins_earned: coinsEarned });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/quiz/save error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── GET /api/m/quiz?count= : mots à réviser (flashcards) ─────────────────────
router.get('/api/m/quiz', requireToken, async (req, res) => {
  try {
    const count = Math.min(parseInt(req.query.count, 10) || 10, 30);
    const { rows } = await pool.query(
      `SELECT mots.id, mots.chinese, mots.pinyin, mots.english, user_mots.score
       FROM mots JOIN user_mots ON mots.id = user_mots.mot_id
       WHERE user_mots.user_id = $1
       ORDER BY user_mots.score ASC, RANDOM()
       LIMIT $2`, [req.tokenUser.id, count]);
    res.json({ words: rows });
  } catch (e) {
    console.error('m/quiz error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  PLATEFORME PROFESSEUR (JWT) — miroir de routes/teach.js pour l'app mobile.
// ════════════════════════════════════════════════════════════════════════════
const TEACH_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CNY', 'JPY', 'CAD', 'AUD', 'SGD', 'HKD'];
const MENTOR_LINK_ALLOWLIST = [
  'preply.com', 'italki.com', 'superprof.', 'verbling.com', 'lingoda.com',
  'amazingtalker.com', 'wyzant.com', 'tutoroo.co', 'calendly.com', 'cal.com',
  'linktr.ee', 'youtube.com', 'instagram.com',
];
function isAllowedMentorUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return MENTOR_LINK_ALLOWLIST.some((d) =>
      d.endsWith('.') ? host.includes(d) : (host === d || host.endsWith('.' + d)));
  } catch { return false; }
}

// Middleware : exige que l'utilisateur du token soit professeur.
async function requireTeacher(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT role, quiz_direction FROM users WHERE id = $1', [req.tokenUser.id]);
    if (!rows.length || rows[0].role !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
    req.teacher = { id: req.tokenUser.id, quiz_direction: rows[0].quiz_direction || 'en→zh' };
    next();
  } catch (e) {
    console.error('requireTeacher error:', e);
    res.status(500).json({ error: 'Server error' });
  }
}

async function teacherOwnsClass(teacherId, classId) {
  const { rows } = await pool.query('SELECT 1 FROM classrooms WHERE id = $1 AND teacher_id = $2', [classId, teacherId]);
  return rows.length > 0;
}
async function genClassCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 8; attempt++) {
    const bytes = crypto.randomBytes(6);
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[bytes[i] % chars.length];
    const { rows } = await pool.query('SELECT 1 FROM classrooms WHERE join_code = $1', [code]);
    if (!rows.length) return code;
  }
  throw new Error('code generation failed');
}

// ── Stats globales du prof ───────────────────────────────────────────────────
router.get('/api/m/teacher/overview', requireToken, requireTeacher, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM classrooms WHERE teacher_id = $1 AND archived = FALSE)::int AS classes,
         (SELECT COUNT(DISTINCT cs.student_id)
            FROM classroom_students cs JOIN classrooms cl ON cl.id = cs.classroom_id
            WHERE cl.teacher_id = $1 AND cs.status = 'active')::int AS students,
         (SELECT COUNT(l.id)
            FROM lessons l JOIN classrooms cl ON cl.id = l.classroom_id
            WHERE cl.teacher_id = $1)::int AS tasks,
         (SELECT COALESCE(ROUND(AVG(um.score)), 0)
            FROM classroom_students cs
            JOIN classrooms cl ON cl.id = cs.classroom_id AND cl.teacher_id = $1
            JOIN user_mots um ON um.user_id = cs.student_id
            WHERE cs.status = 'active')::int AS avg_knowledge`,
      [req.teacher.id]
    );
    res.json(rows[0]);
  } catch (e) { console.error('m/teacher overview:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── Classes du prof ──────────────────────────────────────────────────────────
router.get('/api/m/teacher/classes', requireToken, requireTeacher, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.type, c.join_code, c.archived, c.created_at,
              COUNT(DISTINCT cs.student_id) FILTER (WHERE cs.status = 'active')::int AS student_count,
              COUNT(DISTINCT l.id)::int AS lesson_count
       FROM classrooms c
       LEFT JOIN classroom_students cs ON cs.classroom_id = c.id
       LEFT JOIN lessons l ON l.classroom_id = c.id
       WHERE c.teacher_id = $1
       GROUP BY c.id
       ORDER BY c.archived ASC, c.created_at DESC`,
      [req.teacher.id]
    );
    res.json({ classrooms: rows });
  } catch (e) { console.error('m/teacher classes:', e); res.status(500).json({ error: 'Server error' }); }
});

router.post('/api/m/teacher/classes', requireToken, requireTeacher, async (req, res) => {
  try {
    const name = (req.body?.name || '').trim();
    const type = req.body?.type === 'private' ? 'private' : 'group';
    if (!name || name.length > 80) return res.status(400).json({ error: 'Class name required (max 80 characters)' });
    const join_code = await genClassCode();
    const { rows } = await pool.query(
      `INSERT INTO classrooms (teacher_id, name, type, join_code)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, type, join_code, archived, created_at`,
      [req.teacher.id, name, type, join_code]
    );
    res.json({ success: true, classroom: rows[0] });
  } catch (e) { console.error('m/teacher create class:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── Détail d'une classe : élèves ─────────────────────────────────────────────
router.get('/api/m/teacher/classes/:id', requireToken, requireTeacher, async (req, res) => {
  try {
    const { rows: classRows } = await pool.query(
      `SELECT id, name, type, join_code, archived, created_at
       FROM classrooms WHERE id = $1 AND teacher_id = $2`,
      [req.params.id, req.teacher.id]
    );
    if (!classRows.length) return res.status(404).json({ error: 'Class not found' });
    const { rows: students } = await pool.query(
      `SELECT u.id, u.name, cs.joined_at,
              COUNT(um.mot_id)::int AS word_count,
              COALESCE(ROUND(AVG(um.score)), 0)::int AS avg_score
       FROM classroom_students cs
       JOIN users u ON u.id = cs.student_id
       LEFT JOIN user_mots um ON um.user_id = u.id
       WHERE cs.classroom_id = $1 AND cs.status = 'active'
       GROUP BY u.id, u.name, cs.joined_at
       ORDER BY u.name ASC`,
      [req.params.id]
    );
    res.json({ classroom: classRows[0], students });
  } catch (e) { console.error('m/teacher class detail:', e); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/api/m/teacher/classes/:id', requireToken, requireTeacher, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM classrooms WHERE id = $1 AND teacher_id = $2', [req.params.id, req.teacher.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Class not found' });
    res.json({ success: true });
  } catch (e) { console.error('m/teacher delete class:', e); res.status(500).json({ error: 'Server error' }); }
});

router.post('/api/m/teacher/classes/:id/students/:studentId/revoke', requireToken, requireTeacher, async (req, res) => {
  try {
    if (!(await teacherOwnsClass(req.teacher.id, req.params.id))) return res.status(404).json({ error: 'Class not found' });
    await pool.query(
      `UPDATE classroom_students SET status = 'removed' WHERE classroom_id = $1 AND student_id = $2`,
      [req.params.id, req.params.studentId]
    );
    res.json({ success: true });
  } catch (e) { console.error('m/teacher revoke:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── Tasks d'une classe ───────────────────────────────────────────────────────
router.get('/api/m/teacher/classes/:id/lessons', requireToken, requireTeacher, async (req, res) => {
  try {
    if (!(await teacherOwnsClass(req.teacher.id, req.params.id))) return res.status(404).json({ error: 'Class not found' });
    const { rows } = await pool.query(
      `SELECT l.id, l.title, l.summary, l.created_at,
              (SELECT COUNT(*) FROM lesson_words lw WHERE lw.lesson_id = l.id)::int AS word_count,
              (SELECT COALESCE(ROUND(AVG(COALESCE(um.score, 0))), 0)
                 FROM lesson_words lw
                 JOIN classroom_students cs ON cs.classroom_id = l.classroom_id AND cs.status = 'active'
                 LEFT JOIN user_mots um ON um.mot_id = lw.mot_id AND um.user_id = cs.student_id
                 WHERE lw.lesson_id = l.id)::int AS avg_knowledge
       FROM lessons l WHERE l.classroom_id = $1 ORDER BY l.created_at DESC`,
      [req.params.id]
    );
    res.json({ lessons: rows });
  } catch (e) { console.error('m/teacher lessons:', e); res.status(500).json({ error: 'Server error' }); }
});

router.post('/api/m/teacher/classes/:id/lessons', requireToken, requireTeacher, async (req, res) => {
  const client = await pool.connect();
  try {
    const classId = req.params.id;
    const title = (req.body?.title || '').trim();
    const summary = (req.body?.summary || '').trim();
    const words = Array.isArray(req.body?.words) ? req.body.words.slice(0, 50) : [];
    if (!title || title.length > 120) return res.status(400).json({ error: 'Title required (max 120)' });
    if (summary.length > 2000) return res.status(400).json({ error: 'Summary too long (max 2000)' });
    if (!(await teacherOwnsClass(req.teacher.id, classId))) return res.status(404).json({ error: 'Class not found' });

    await client.query('BEGIN');
    const { rows: lrows } = await client.query(
      `INSERT INTO lessons (classroom_id, title, summary) VALUES ($1, $2, $3) RETURNING id`,
      [classId, title, summary]
    );
    const lessonId = lrows[0].id;
    const motIds = [];
    for (const w of words) {
      const chinese = String(w.chinese || '').trim();
      if (!chinese) continue;
      const pinyin = String(w.pinyin || '').trim().slice(0, 100);
      const english = String(w.english || '').trim().slice(0, 300);
      const existing = await client.query('SELECT id, hsk FROM mots WHERE chinese = $1 LIMIT 1', [chinese]);
      let motId;
      if (existing.rows.length) {
        motId = existing.rows[0].id;
        if (existing.rows[0].hsk == null && english) {
          await client.query('UPDATE mots SET pinyin = $1, english = $2 WHERE id = $3', [pinyin, english, motId]);
        }
      } else {
        if (!english) continue;
        const ins = await client.query(
          `INSERT INTO mots (chinese, pinyin, english) VALUES ($1, $2, $3) RETURNING id`,
          [chinese.slice(0, 50), pinyin, english]
        );
        motId = ins.rows[0].id;
      }
      motIds.push(motId);
    }
    for (const motId of [...new Set(motIds)]) {
      await client.query(
        `INSERT INTO lesson_words (lesson_id, mot_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [lessonId, motId]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, lesson_id: lessonId });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/teacher create lesson:', e);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

// ── Progression d'une task ───────────────────────────────────────────────────
router.get('/api/m/teacher/lessons/:lessonId/progress', requireToken, requireTeacher, async (req, res) => {
  try {
    const { rows: lrows } = await pool.query(
      `SELECT l.id, l.title, l.summary, l.classroom_id, l.created_at
       FROM lessons l JOIN classrooms c ON c.id = l.classroom_id
       WHERE l.id = $1 AND c.teacher_id = $2`,
      [req.params.lessonId, req.teacher.id]
    );
    if (!lrows.length) return res.status(404).json({ error: 'Task not found' });
    const lesson = lrows[0];
    const { rows: words } = await pool.query(
      `SELECT m.id, m.chinese, m.pinyin, m.english
       FROM lesson_words lw JOIN mots m ON m.id = lw.mot_id
       WHERE lw.lesson_id = $1 ORDER BY lw.id ASC`, [lesson.id]);
    const { rows: students } = await pool.query(
      `SELECT cs.student_id, u.name,
              ROUND(AVG(COALESCE(um.score, 0)))::int AS knowledge,
              COALESCE(qc.cnt, 0)::int AS quiz_count
       FROM classroom_students cs
       JOIN users u ON u.id = cs.student_id
       JOIN lesson_words lw ON lw.lesson_id = $1
       LEFT JOIN user_mots um ON um.mot_id = lw.mot_id AND um.user_id = cs.student_id
       LEFT JOIN (
         SELECT student_id, COUNT(*) AS cnt FROM lesson_quiz_results WHERE lesson_id = $1 GROUP BY student_id
       ) qc ON qc.student_id = cs.student_id
       WHERE cs.classroom_id = $2 AND cs.status = 'active'
       GROUP BY cs.student_id, u.name, qc.cnt
       ORDER BY knowledge DESC, u.name ASC`,
      [lesson.id, lesson.classroom_id]
    );
    res.json({ lesson, words, students });
  } catch (e) { console.error('m/teacher progress:', e); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/api/m/teacher/lessons/:lessonId', requireToken, requireTeacher, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM lessons l USING classrooms c
       WHERE l.id = $1 AND l.classroom_id = c.id AND c.teacher_id = $2`,
      [req.params.lessonId, req.teacher.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true });
  } catch (e) { console.error('m/teacher delete lesson:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── Résolution des mots (find dans le dico partagé, direction-aware) ──────────
router.post('/api/m/teacher/mots/lookup', requireToken, requireTeacher, async (req, res) => {
  try {
    const words = Array.isArray(req.body?.words) ? req.body.words : [];
    const cleaned = [...new Set(words.map((w) => String(w || '').trim()).filter(Boolean))].slice(0, 50);
    if (!cleaned.length) return res.json({ results: [] });
    const isZhEn = req.teacher.quiz_direction === 'zh→en';
    const byKey = {};
    if (isZhEn) {
      const { rows } = await pool.query(
        `SELECT id, chinese, pinyin, english FROM mots WHERE LOWER(english) = ANY($1::text[])`,
        [cleaned.map((w) => w.toLowerCase())]
      );
      rows.forEach((r) => { byKey[(r.english || '').toLowerCase()] = r; });
      return res.json({ results: cleaned.map((w) => ({ input: w, mot: byKey[w.toLowerCase()] || null })) });
    }
    const { rows } = await pool.query(
      `SELECT id, chinese, pinyin, english FROM mots WHERE chinese = ANY($1::text[])`, [cleaned]
    );
    rows.forEach((r) => { byKey[r.chinese] = r; });
    // Mot introuvable dans le dico → on génère le pinyin (pinyin-pro), comme le web.
    let toPinyin = null;
    try { toPinyin = require('pinyin-pro').pinyin; } catch { /* lib absente → pinyin vide */ }
    const genPinyin = (cn) => {
      if (!toPinyin) return '';
      try { return toPinyin(cn, { toneType: 'symbol' }) || ''; } catch { return ''; }
    };
    res.json({
      results: cleaned.map((w) => ({
        input: w,
        mot: byKey[w] || null,
        pinyin: byKey[w] ? undefined : genPinyin(w),
      })),
    });
  } catch (e) { console.error('m/teacher lookup:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── Tous les élèves du prof ──────────────────────────────────────────────────
router.get('/api/m/teacher/students', requireToken, requireTeacher, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name,
              COUNT(DISTINCT um.mot_id)::int AS word_count,
              COALESCE(ROUND(AVG(um.score)), 0)::int AS avg_score,
              COUNT(DISTINCT cs.classroom_id)::int AS class_count
       FROM classroom_students cs
       JOIN classrooms c ON c.id = cs.classroom_id AND c.teacher_id = $1
       JOIN users u ON u.id = cs.student_id
       LEFT JOIN user_mots um ON um.user_id = u.id
       WHERE cs.status = 'active'
       GROUP BY u.id, u.name
       ORDER BY word_count DESC, u.name ASC`,
      [req.teacher.id]
    );
    res.json({ students: rows });
  } catch (e) { console.error('m/teacher students:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── Profil mentor ────────────────────────────────────────────────────────────
router.get('/api/m/teacher/profile', requireToken, requireTeacher, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT name, mentor_bio, mentor_links, years_experience, languages_spoken,
              teaching_languages, session_price, session_currency, mentor_listed
       FROM users WHERE id = $1`, [req.teacher.id]
    );
    res.json({ profile: rows[0] || {} });
  } catch (e) { console.error('m/teacher get profile:', e); res.status(500).json({ error: 'Server error' }); }
});

router.post('/api/m/teacher/profile', requireToken, requireTeacher, async (req, res) => {
  try {
    const name = (req.body?.name || '').trim();
    const bio = (req.body?.bio || '').trim();
    const languages = (req.body?.languages || '').trim();
    let years = parseInt(req.body?.years_experience, 10);
    const listed = req.body?.mentor_listed === true;
    let links = Array.isArray(req.body?.links) ? req.body.links : [];

    const teachingArr = Array.isArray(req.body?.teaching_languages)
      ? req.body.teaching_languages
      : String(req.body?.teaching_languages || '').split(',');
    const teaching = teachingArr.map((s) => String(s).trim()).filter(Boolean).slice(0, 12).join(', ').slice(0, 200);

    let price = null;
    const rawPrice = req.body?.session_price;
    if (rawPrice !== '' && rawPrice != null) {
      const p = parseFloat(rawPrice);
      if (!isNaN(p) && p >= 0) price = Math.min(Math.round(p * 100) / 100, 100000);
    }
    const currency = TEACH_CURRENCIES.includes(req.body?.session_currency) ? req.body.session_currency : 'EUR';

    if (!name || name.length > 50) return res.status(400).json({ error: 'Name required (max 50)' });
    if (bio.length > 500) return res.status(400).json({ error: 'Intro too long (max 500)' });
    if (languages.length > 200) return res.status(400).json({ error: 'Languages: max 200 characters' });
    if (isNaN(years) || years < 0) years = null; else if (years > 80) years = 80;

    links = links
      .filter((l) => l && typeof l.url === 'string')
      .slice(0, 5)
      .map((l) => ({ label: String(l.label || '').trim().slice(0, 30), url: l.url.trim() }));
    const bad = links.find((l) => !isAllowedMentorUrl(l.url));
    if (bad) return res.status(400).json({ error: `Link not allowed: ${bad.url}. Accepted: Preply, iTalki, Superprof, Calendly, etc.` });

    await pool.query(
      `UPDATE users SET name = $1, mentor_bio = $2, languages_spoken = $3,
              years_experience = $4, mentor_links = $5::jsonb, mentor_listed = $6,
              teaching_languages = $7, session_price = $8, session_currency = $9
       WHERE id = $10`,
      [name, bio, languages, years, JSON.stringify(links), listed, teaching, price, currency, req.teacher.id]
    );
    res.json({ success: true });
  } catch (e) { console.error('m/teacher save profile:', e); res.status(500).json({ error: 'Server error' }); }
});

module.exports = { router, requireToken };
