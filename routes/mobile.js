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
const { pool, reconcileHskPacks } = require('../config/database');
const { generateDuelQuiz, addTransaction, updateWordScore } = require('../middleware/index');
const { sendExpoPush } = require('../middleware/push.service');
const { registerLimiter, loginLimiter, validateSignupEmail } = require('../middleware/signup-guard');
const { rewardPendingReferral } = require('../lib/referral');
const { SIGNUP_GRANT } = require('../lib/economy');
const cedict = require('../lib/cedict');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const router = express.Router();

// Secret JWT : JAMAIS de fallback en dur (un secret prévisible = tokens forgeables
// → prise de contrôle de n'importe quel compte). En prod on refuse de démarrer s'il
// manque (fail-fast) ; en dev on tolère un secret local éphémère pour le confort.
const JWT_SECRET = process.env.JWT_SECRET
  || (process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('JWT_SECRET manquant en production — refus de démarrer'); })()
    : 'dev-only-insecure-secret');
const TOKEN_TTL = '30d';

// Limites du plan gratuit (le premium lève tout). maxWords appliqué ailleurs (600).
const FREE_LIMITS = { quizPerDay: 3, duelPerDay: 1, packsMax: 3 };
// Packs verrouillés au premium (niveaux avancés), repérés par cover_key.
const PREMIUM_PACK_COVERS = ['hsk4', 'hsk5', 'hsk6'];

// Dernier build natif publié par plateforme, pour la popup « mise à jour dispo »
// (soft, non bloquante). Modifiable sans redéploiement via variables d'env :
// quand tu publies un nouvel AAB/IPA, monte LATEST_ANDROID_BUILD / LATEST_IOS_BUILD.
const APP_VERSION = {
  android: {
    latestBuild: parseInt(process.env.LATEST_ANDROID_BUILD || '14', 10),
    url: process.env.ANDROID_STORE_URL || 'https://play.google.com/store/apps/details?id=fr.jiayou.app',
  },
  ios: {
    latestBuild: parseInt(process.env.LATEST_IOS_BUILD || '1', 10),
    url: process.env.IOS_STORE_URL || '',
  },
};

// GET /api/m/app-version : le client compare son build natif installé à latestBuild
// et affiche une popup incitative si une mise à jour store existe. Public + caché.
router.get('/api/m/app-version', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(APP_VERSION);
});

// Compte les lignes d'aujourd'hui (fuseau serveur). `dateCol` diffère selon la
// table (quiz_history = date_completed, duels = created_at).
async function countToday(table, userCol, dateCol, userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${userCol} = $1 AND ${dateCol}::date = CURRENT_DATE`,
    [userId]);
  return rows[0]?.n || 0;
}

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
    // `algorithms` épinglé : refuse tout token signé autrement qu'en HS256
    // (protège des attaques de confusion d'algorithme, ex. `alg: none`).
    const payload = jwt.verify(match[1], JWT_SECRET, { algorithms: ['HS256'] });
    req.tokenUser = { id: payload.id, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Résout les langues d'un user : `learning` (langue apprise → filtre les lexèmes
// `mots.lang`) et `native` (langue connue → langue de la traduction). Valeurs par
// défaut sûres (zh/en) pour tout compte antérieur au multilingue.
async function getUserLangs(userId) {
  try {
    const { rows } = await pool.query(
      'SELECT learning_lang, native_lang FROM users WHERE id = $1', [userId]);
    const u = rows[0] || {};
    return { learning: u.learning_lang || 'zh', native: u.native_lang || 'en' };
  } catch {
    return { learning: 'zh', native: 'en' };
  }
}

// Catalogue de métadonnées des langues (nom, endonyme, pinyin, voix TTS). Sert à
// afficher joliment une langue dès qu'elle apparaît. Pré-rempli pour les langues
// courantes → ajouter l'espagnol = juste peupler ses mots, aucun code à toucher.
const LANG_CATALOG = {
  zh: { name: 'Chinese', endonym: '中文', has_pinyin: true, tts: 'zh-CN' },
  en: { name: 'English', endonym: 'English', has_pinyin: false, tts: 'en-US' },
  fr: { name: 'French', endonym: 'Français', has_pinyin: false, tts: 'fr-FR' },
  es: { name: 'Spanish', endonym: 'Español', has_pinyin: false, tts: 'es-ES' },
  de: { name: 'German', endonym: 'Deutsch', has_pinyin: false, tts: 'de-DE' },
  it: { name: 'Italian', endonym: 'Italiano', has_pinyin: false, tts: 'it-IT' },
  pt: { name: 'Portuguese', endonym: 'Português', has_pinyin: false, tts: 'pt-PT' },
  ja: { name: 'Japanese', endonym: '日本語', has_pinyin: false, tts: 'ja-JP' },
  ko: { name: 'Korean', endonym: '한국어', has_pinyin: false, tts: 'ko-KR' },
  ru: { name: 'Russian', endonym: 'Русский', has_pinyin: false, tts: 'ru-RU' },
};

// Langues apprenables = celles ENREGISTRÉES (table languages, alimentée par le
// listener/trigger) ET ayant du contenu. Cache rafraîchi au boot + périodiquement
// → la validation devient réactive à l'ajout d'une langue, sans redéploiement.
let LEARNABLE_LANGS = ['zh', 'en', 'fr'];
async function refreshLearnableLangs() {
  try {
    const { rows } = await pool.query(
      `SELECT l.code FROM languages l
       WHERE l.learnable = TRUE AND EXISTS (SELECT 1 FROM mots m WHERE m.lang = l.code)
       ORDER BY l.code`);
    if (rows.length) LEARNABLE_LANGS = rows.map((r) => r.code);
  } catch { /* table pas encore prête (premier boot) → garde le fallback */ }
}
// Rafraîchit toutes les 5 min (capte une nouvelle langue sans redémarrage).
setInterval(refreshLearnableLangs, 5 * 60 * 1000).unref?.();
refreshLearnableLangs();
// Valide des codes langue en se ré-alignant sur la base en cas de miss : le cache
// LEARNABLE_LANGS peut avoir jusqu'à 5 min de retard sur /api/m/languages (fraîche),
// donc une langue tout juste ajoutée serait rejetée à tort → on rafraîchit et on
// re-teste avant de conclure. Garantit aussi que resolveCourseLangs voit le code
// (sinon il retomberait sur zh/en).
async function ensureLearnable(...codes) {
  const wanted = codes.filter(Boolean);
  if (wanted.every((c) => LEARNABLE_LANGS.includes(c))) return true;
  await refreshLearnableLangs();
  return wanted.every((c) => LEARNABLE_LANGS.includes(c));
}
// Normalise (learning, native) et dérive le binaire quiz_direction de compat
// (legacy duel/teacher) : learning=zh → on apprend le chinois ('en→zh'), sinon
// on n'apprend pas le chinois ('zh→en'). Garde-fous : valeurs sûres par défaut,
// et native ≠ learning.
function resolveCourseLangs(learningIn, nativeIn) {
  let learning = LEARNABLE_LANGS.includes(learningIn) ? learningIn : 'zh';
  let native = LEARNABLE_LANGS.includes(nativeIn) ? nativeIn : 'en';
  if (native === learning) native = learning === 'en' ? 'zh' : 'en';
  const quizDir = learning === 'zh' ? 'en→zh' : 'zh→en';
  return { learning, native, quizDir };
}

// Source de vérité = `learning_paths`. Ce helper est le SEUL point qui définit la
// paire active d'un user : il garantit un parcours pour (user, langue apprise),
// met à jour sa base, le désigne comme actif (users.active_path_id) et resynchro-
// nise le MIROIR users.(learning_lang, native_lang, interface_lang, quiz_direction)
// — que le reste de l'app lit encore. L'interface suit la base (native) et
// quiz_direction reste dérivé (compat duel/teacher). Renvoie la paire posée.
async function setActiveLangs(userId, learningIn, nativeIn) {
  // Ré-aligne le cache si une des langues vient d'être ajoutée (sinon resolve la
  // coercerait vers zh/en).
  await ensureLearnable(learningIn, nativeIn);
  const { learning, native, quizDir } = resolveCourseLangs(learningIn, nativeIn);
  const up = await pool.query(
    `INSERT INTO learning_paths (user_id, learning_lang, native_lang)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, learning_lang) DO UPDATE SET native_lang = EXCLUDED.native_lang
     RETURNING id`, [userId, learning, native]);
  const pathId = up.rows[0].id;
  await pool.query(
    `UPDATE users SET active_path_id = $1, learning_lang = $2, native_lang = $3,
            interface_lang = $3, quiz_direction = $4 WHERE id = $5`,
    [pathId, learning, native, quizDir, userId]);
  return { learning_lang: learning, native_lang: native, interface_lang: native, active_path_id: pathId };
}

// Modèle concept MANY-TO-MANY (lexeme_senses) : garantit que le lexème appris
// (motId) a un sens M et qu'un lexème natif CANONIQUE existe pour CHAQUE sens de
// `gloss`, relié à M. Les lexèmes sont dédupliqués (un seul « can »), un lexème
// peut appartenir à plusieurs sens.
//   • replace=true (édition) : délie de M les lexèmes natifs non possédés, puis relie.
//   • MERGE-ON-SAVE prudent : si le lexème appris n'a pas encore de sens et qu'un
//     sens de glose correspond à un lexème natif NON AMBIGU (un seul sens), on
//     rejoint ce sens (lien multilingue réel) ; si le natif est un homonyme
//     (plusieurs sens, ex. « can »), on crée un sens neuf plutôt que sur-lier.
// Découpe une glose (champ de traduction LIBRE) en sens distincts. L'utilisateur
// sépare comme il veut : « / , ; 、 » (+ retours à la ligne). On normalise TOUS ces
// séparateurs en sens séparés, on retire les annotations entre parenthèses/crochets
// (ex. « (lit. and fig.) », « (dialect) », « [pinyin] ») — ignorées au quiz et bruit
// sur la carte — et on nettoie la ponctuation de bord (dont le point final). Chaque
// sens devient un lexème frère → la carte affiche « a / b / c » via mot_tr.
// NB : on NE découpe PAS sur le point « . » interne (abréviations : « e.g. », « fig. »,
// décimales) ; seul le point de fin d'un sens est retiré.
function splitSenses(gloss) {
  const out = [];
  const seen = new Set();
  for (const raw of String(gloss || '').split(/[;,/／；，、\n\r]+/)) {
    const s = raw
      .replace(/[（(][^）)]*[）)]/g, ' ') // annotations entre parenthèses
      .replace(/\[[^\]]*\]/g, ' ')        // annotations entre crochets (pinyin CEDICT)
      .replace(/\s+/g, ' ')
      .replace(/^[\s.;,、]+|[\s.;,、]+$/g, '') // ponctuation/espaces aux bords (dont point final)
      .trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out;
}

// Garde-fous P2P — Phase 1 : journalise une mutation du graphe (append-only) et
// marque le dernier modificateur du lexème. À exécuter DANS la transaction (client)
// pour être atomique avec l'édition (rollback ensemble). La table edit_log est créée
// au boot → l'INSERT ne peut pas échouer sur une base à jour.
async function logEdit(client, userId, motId, action, surface, before, after) {
  await client.query(
    `INSERT INTO edit_log (user_id, mot_id, action, surface, before, after)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId || null, motId, action, surface || null,
     before == null ? null : JSON.stringify(before),
     after == null ? null : JSON.stringify(after)]);
  await client.query('UPDATE mots SET last_edited_by = $1, last_edited_at = NOW() WHERE id = $2', [userId || null, motId]);
}

// À exécuter DANS la transaction de l'appelant (client).
async function syncConceptSiblings(client, motId, gloss, nativeLang, { replace = false, meaningId: explicitMeaning = null, freshBox = false, userId = null } = {}) {
  const uniq = splitSenses(gloss);

  const self = await client.query('SELECT lang, meaning_id, chinese FROM mots WHERE id = $1', [motId]);
  if (!self.rows.length) return null;
  const selfLang = self.rows[0].lang || 'zh';
  if (!nativeLang || nativeLang === selfLang) return null; // rien à dériver
  // Glose vide → ne PAS fabriquer de sens orphelin ; on garde le sens courant.
  if (!explicitMeaning && uniq.length === 0) return self.rows[0].meaning_id || null;
  // Audit : traduction AVANT mutation (pour le diff avant/après dans edit_log).
  const beforeTr = userId
    ? (await client.query('SELECT mot_tr($1, $2) AS tr', [motId, nativeLang])).rows[0].tr || ''
    : null;

  // Détermine le SENS à alimenter :
  //   (0) sens explicite (édition d'une entrée précise) ;
  //   (1) un sens de CE lexème qui contient déjà une des gloses (ré-enrichissement) ;
  //   (2) merge-on-save : le lexème natif de la glose existe déjà → on rejoint son
  //       sens PRIMAIRE (concept canonique), sinon son unique sens s'il n'en a qu'un ;
  //   (3) sinon un SENS NEUF (même si le lexème a déjà d'autres sens → homonyme).
  // `freshBox` (création d'un NOUVEAU mot de pack) : on SAUTE le merge-on-save (1)+(2)
  // → on ne rejoint JAMAIS une boîte existante. Sinon, un mot neuf dont une glose
  // coïncide avec un lexème natif existant (ex. « writer » déjà dans la boîte
  // d'« écrivain ») se ferait absorber par ce concept, contaminant des mots corrects
  // et rattachant à la collection le mauvais lexème. On lui fabrique sa PROPRE boîte ;
  // les lexèmes natifs des gloses y sont reliés (réutilisés, sans toucher leurs
  // autres boîtes).
  let meaningId = explicitMeaning;
  if (!meaningId && !freshBox) {
    for (const sense of uniq) {
      const r = await client.query(
        `SELECT ls_self.meaning_id
         FROM lexeme_senses ls_self
         JOIN lexeme_senses ls_n ON ls_n.meaning_id = ls_self.meaning_id
         JOIN mots n ON n.id = ls_n.mot_id
         WHERE ls_self.mot_id = $1 AND n.lang = $2 AND lower(n.chinese) = lower($3)
         LIMIT 1`, [motId, nativeLang, sense]);
      if (r.rows.length) { meaningId = r.rows[0].meaning_id; break; }
    }
  }
  if (!meaningId && !freshBox) {
    for (const sense of uniq) {
      const nat = await client.query(
        'SELECT id, meaning_id FROM mots WHERE lang = $1 AND lower(chinese) = lower($2) ORDER BY id LIMIT 1',
        [nativeLang, sense]);
      if (!nat.rows.length) continue;
      const n = nat.rows[0];
      // (2a) rejoint le concept PRIMAIRE (canonique) du lexème natif s'il en a un.
      if (n.meaning_id) { meaningId = n.meaning_id; break; }
      // (2b) sinon, s'il n'a qu'un seul sens non ambigu, on le rejoint.
      const one = await client.query(
        'SELECT min(meaning_id) AS meaning_id FROM lexeme_senses WHERE mot_id = $1 HAVING count(*) = 1',
        [n.id]);
      if (one.rows.length) { meaningId = one.rows[0].meaning_id; break; }
    }
  }
  if (!meaningId) {
    const m = await client.query('INSERT INTO meanings(note) VALUES ($1) RETURNING id', ['word:' + motId]);
    meaningId = m.rows[0].id;
  }
  await client.query('INSERT INTO lexeme_senses(mot_id, meaning_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [motId, meaningId]);
  await client.query('UPDATE mots SET meaning_id = COALESCE(meaning_id, $1) WHERE id = $2', [meaningId, motId]);

  // 2) édition : délie de M les lexèmes natifs non possédés / hors pack.
  if (replace) {
    await client.query(
      `DELETE FROM lexeme_senses ls USING mots e
       WHERE ls.meaning_id = $1 AND ls.mot_id = e.id AND e.lang = $2 AND e.id <> $3
         AND NOT EXISTS (SELECT 1 FROM user_mots um WHERE um.mot_id = e.id)
         AND NOT EXISTS (SELECT 1 FROM word_pack_items w WHERE w.mot_id = e.id)`,
      [meaningId, nativeLang, motId]);
    // ANTI-RÉSURRECTION : le DELETE ci-dessus ne coupe que lexeme_senses. Un lexème
    // délié qui garde `mots.meaning_id = M` (son pointeur de sens primaire) serait
    // re-lié à M au prochain boot par l'auto-réparation orphelins (config/database.js)
    // → la connexion supprimée réapparaîtrait au redémarrage. On re-pointe donc
    // meaning_id vers un sens que le lexème possède ENCORE (min restant), sinon NULL.
    await client.query(
      `UPDATE mots m
       SET meaning_id = (SELECT min(ls.meaning_id) FROM lexeme_senses ls WHERE ls.mot_id = m.id)
       WHERE m.lang = $2 AND m.meaning_id = $1 AND m.id <> $3
         AND NOT EXISTS (SELECT 1 FROM lexeme_senses ls WHERE ls.mot_id = m.id AND ls.meaning_id = $1)`,
      [meaningId, nativeLang, motId]);
  }

  // 3) Pour chaque sens : lexème natif CANONIQUE (réutilisé si existant), relié à M.
  for (const sense of uniq) {
    let nid;
    const ex = await client.query(
      'SELECT id FROM mots WHERE lang = $1 AND lower(chinese) = lower($2) ORDER BY id LIMIT 1',
      [nativeLang, sense]);
    if (ex.rows.length) {
      nid = ex.rows[0].id;
    } else {
      const ins = await client.query(
        `INSERT INTO mots (chinese, pinyin, lang, meaning_id)
         VALUES ($1, NULL, $2, $3) RETURNING id`,
        [sense, nativeLang, meaningId]);
      nid = ins.rows[0].id;
    }
    await client.query('INSERT INTO lexeme_senses(mot_id, meaning_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [nid, meaningId]);
  }
  // Audit : ne journalise QUE si la traduction a réellement changé (évite le bruit).
  if (userId) {
    const afterTr = (await client.query('SELECT mot_tr($1, $2) AS tr', [motId, nativeLang])).rows[0].tr || '';
    if (afterTr !== beforeTr) {
      await logEdit(client, userId, motId, beforeTr ? 'edit_meaning' : 'create',
        self.rows[0].chinese, { tr: beforeTr || null }, { tr: afterTr || null });
    }
  }
  return meaningId; // sens utilisé (créé/rejoint) → l'appelant capture ce sens
}

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
      const { sendVerificationEmail } = require('../middleware/mail.service');
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
              u.quiz_direction, u.interface_lang, u.learning_lang, u.native_lang, u.special_guest,
              u.onboarding_done, u.has_seen_tutorial, u.email_verified, u.provider,
              u.avatar_icon, u.avatar_color,
              u.rc_expires_at, u.rc_will_renew,
              us.plan_name, us.status AS sub_status, us.stripe_status,
              us.cancel_at_period_end, us.current_period_end
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
    // Premium via RevenueCat (Play Billing / StoreKit) : actif tant que non expiré.
    const rcActive = row.rc_expires_at && new Date(row.rc_expires_at) > new Date();
    const isPremium = isSpecialGuest || allActive || rcActive;
    const plan = isSpecialGuest ? 'guest' : (isPremium ? 'premium' : 'free');

    res.json({
      id: row.id,
      email: row.email,
      name: row.name,
      balance: row.balance,
      role: row.role,
      quiz_direction: row.quiz_direction,
      interface_lang: row.interface_lang,
      learning_lang: row.learning_lang || 'zh',
      native_lang: row.native_lang || 'en',
      onboarding_done: row.onboarding_done,
      has_seen_tutorial: row.has_seen_tutorial,
      // Vérification email : les comptes OAuth (Google/Apple) sont vérifiés d'office.
      // Sert au bandeau de rappel + au gate des actions à risque côté serveur.
      emailVerified: row.email_verified === true || row.provider === 'google' || row.provider === 'apple',
      provider: row.provider,
      avatar_icon: row.avatar_icon,
      avatar_color: row.avatar_color,
      isPremium,
      isSpecialGuest,
      plan, // 'premium' | 'guest' | 'free'
      // Annulation programmée : l'accès premium reste jusqu'à la fin de période.
      cancelAtPeriodEnd: rcActive ? (row.rc_will_renew === false) : (row.cancel_at_period_end === true),
      currentPeriodEnd: rcActive
        ? (row.rc_expires_at instanceof Date ? row.rc_expires_at.toISOString() : row.rc_expires_at)
        : (row.current_period_end instanceof Date ? row.current_period_end.toISOString() : (row.current_period_end || null)),
    });
  } catch (e) {
    console.error('me error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Renvoie true si l'utilisateur peut réaliser une action à risque : email
// vérifié, ou compte OAuth (Google/Apple) intrinsèquement vérifié.
async function isVerified(userId) {
  const r = await pool.query('SELECT email_verified, provider FROM users WHERE id = $1', [userId]);
  const u = r.rows[0];
  return !!u && (u.email_verified === true || u.provider === 'google' || u.provider === 'apple');
}
// Réponse 403 standard pour les gates de vérification (le client affiche un CTA).
function verifyRequired(res) {
  return res.status(403).json({ error: 'Please verify your email to use this feature.', verifyRequired: true });
}

// ── POST /api/m/resend-verification : renvoyer l'email de vérification ────────
router.post('/api/m/resend-verification', requireToken, loginLimiter, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const r = await pool.query('SELECT email, email_verified, provider FROM users WHERE id = $1', [uid]);
    const u = r.rows[0];
    if (!u) return res.status(404).json({ error: 'Not found' });
    // Déjà vérifié (ou OAuth) → rien à faire, on répond OK (idempotent, pas de fuite d'info).
    if (u.email_verified === true || u.provider === 'google' || u.provider === 'apple') {
      return res.json({ ok: true, alreadyVerified: true });
    }
    const vtoken = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO email_verification_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
      [uid, vtoken]
    );
    const { sendVerificationEmail } = require('../middleware/mail.service');
    await sendVerificationEmail(u.email, vtoken);
    res.json({ ok: true });
  } catch (e) {
    console.error('m/resend-verification error:', e.message);
    res.status(500).json({ error: 'Could not send verification email' });
  }
});

// ── POST /api/m/onboarding : sauve le profil + marque l'onboarding fini ───────
// Miroir JWT de /api/user/update-profile + /api/user/complete-onboarding (web).
// `ref` (optionnel) = code de parrainage capté côté client. On POSE le lien
// (referred_by) à l'onboarding, mais la RÉCOMPENSE du parrain n'est versée que
// lorsque l'invité a un email vérifié (rewardPendingReferral) — anti-farming :
// un faux compte non vérifié ne rapporte aucun coin. Pour les comptes déjà
// vérifiés (Google/Apple), rewardPendingReferral crédite immédiatement.
async function creditReferralByCode(userId, code) {
  // Tolérant à la saisie manuelle (champ « code » à l'inscription) : les codes
  // stockés sont en MAJUSCULES → on normalise (trim + upper) pour accepter un
  // collage en minuscule ou avec des espaces. Lookup insensible à la casse.
  const norm = code ? String(code).trim().toUpperCase() : '';
  if (norm) {
    const me = await pool.query(
      'SELECT referred_by, referral_rewarded FROM users WHERE id = $1', [userId]);
    if (me.rows.length && !me.rows[0].referred_by && !me.rows[0].referral_rewarded) {
      const ref = await pool.query('SELECT id FROM users WHERE upper(referral_code) = $1', [norm]);
      if (ref.rows.length && ref.rows[0].id !== userId) { // pas d'auto-parrainage
        await pool.query(
          `UPDATE users SET referred_by = $1
           WHERE id = $2 AND referred_by IS NULL AND referral_rewarded = FALSE`,
          [ref.rows[0].id, userId]);
      }
    }
  }
  await rewardPendingReferral(userId);
}

router.post('/api/m/onboarding', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  const { role, name, tagline, country, learning_lang, native_lang, interface_lang, ref } = req.body || {};

  const VALID_ROLES = ['student', 'teacher'];
  const chosenRole = VALID_ROLES.includes(role) ? role : 'student';
  const uiLang = ['en', 'zh', 'fr'].includes(interface_lang) ? interface_lang : null;

  if (!name || String(name).trim().length === 0 || String(name).length > 50) {
    return res.status(400).json({ error: 'Name is required (max 50 characters)' });
  }
  if (tagline && String(tagline).length > 100) {
    return res.status(400).json({ error: 'Tagline must be under 100 characters' });
  }
  // Langues du cours. On dérive quiz_direction (binaire legacy) pour compat duel/teacher.
  await ensureLearnable(learning_lang, native_lang); // capte une langue tout juste ajoutée
  const { learning, native, quizDir } = resolveCourseLangs(learning_lang, native_lang);
  const code = country ? String(country).toUpperCase().slice(0, 2) : null;

  try {
    await pool.query(
      `UPDATE users
       SET role = $1, name = $2, tagline = $3, country = $4,
           onboarding_done = TRUE
       WHERE id = $5`,
      [chosenRole, String(name).trim(), tagline ? String(tagline).trim() : null, code, uid]
    );
    // Crée/pointe le parcours initial (learning_paths = vérité) + miroir users.*.
    // Étudiant uniquement : le prof n'a pas de cours (learning/native ignorés).
    if (chosenRole !== 'teacher') {
      await setActiveLangs(uid, learning, native);
    }
    // interface_lang (chrome de l'app) : posé séparément si fourni au picker.
    if (uiLang) await pool.query('UPDATE users SET interface_lang = $1 WHERE id = $2', [uiLang, uid]);

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
    const langs = await getUserLangs(req.tokenUser.id);
    const { rows } = await pool.query(
      // `english` = la traduction dans la langue CONNUE (native_lang), dérivée du
      // concept (meaning_id) via mot_tr() : agrège les lexèmes frères natifs en
      // « a / b / c » (l'alias reste `english` pour le contrat frontend).
      `SELECT mots.id, mots.chinese, mots.pinyin,
              mot_tr_sense(mots.id, user_mots.meaning_id, $3) AS english,
              user_mots.meaning_id,
              mots.hsk, user_mots.description,
              user_mots.score,
              -- Appartenance à un pack par CONCEPT (meaning), pas par mot exact :
              -- un apprenant occidental possède le lexème en/fr alors que le pack
              -- contient le lexème zh du même concept → il faut matcher le sens.
              ARRAY(
                SELECT DISTINCT wpi.pack_id FROM word_pack_items wpi
                JOIN lexeme_senses lp ON lp.mot_id = wpi.mot_id
                JOIN word_packs wp ON wp.id = wpi.pack_id
                WHERE lp.meaning_id = user_mots.meaning_id
                  AND (wp.creator_id = $1
                       OR EXISTS(SELECT 1 FROM pack_purchases pp WHERE pp.pack_id = wpi.pack_id AND pp.buyer_id = $1))
              ) AS pack_ids
       FROM mots
       JOIN user_mots ON mots.id = user_mots.mot_id
       WHERE user_mots.user_id = $1 AND mots.lang = $2
       ORDER BY user_mots.score ASC, mots.id ASC`,
      [req.tokenUser.id, langs.learning, langs.native]
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

    // Recherche par DÉBUT DE MOT pour les langues à mots séparés : « cat » remonte
    // « cat » / « category » / « green cat », mais PAS « vaCATion » / « loCATed »
    // (cat au milieu d'un mot). On matche sur une frontière de mot au début du
    // terme (regex `\ycat`, insensible à la casse via `~*`). Pour le chinois/kana/
    // hangul (pas de séparation de mots), on garde la sous-chaîne ILIKE.
    const hasCJK = /[㐀-鿿豈-﫿぀-ヿ가-힯]/.test(raw);
    const useWordBoundary = !hasCJK && /[a-z]/i.test(raw);
    // Terme échappé pour la regex, borné par une frontière de mot AU DÉBUT
    // seulement (`\ycat`) → « hol » remonte « holiday » (saisie progressive).
    const wbTerm = '\\y' + raw.replace(/[^a-zA-Z0-9]/g, '\\$&');
    const matchCol = (col) => (useWordBoundary ? `${col} ~* $1` : `${col} ILIKE $1 ESCAPE '\\'`);

    // $1=terme (regex mot-entier OU like)  $2=uid  $3=raw  $4=native  $5=learning
    const langs = await getUserLangs(req.tokenUser.id);
    const params = [useWordBoundary ? wbTerm : like, req.tokenUser.id, raw, langs.native, langs.learning];
    const pinyinColNorm =
      `regexp_replace(translate(lower(m.pinyin),'üāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ','uaaaaeeeeiiiioooouuuuuuuu'),'[^a-z]','','g')`;
    // Match : terme appris (m.chinese), OU sa traduction native (lexème frère du
    // concept), OU le pinyin (chinois). La traduction se matche via EXISTS sur un
    // frère (rapide) plutôt que mot_tr sur toutes les lignes.
    const clauses = [
      matchCol('m.chinese'),
      `EXISTS (SELECT 1 FROM lexeme_senses a JOIN lexeme_senses b ON b.meaning_id = a.meaning_id
               JOIN mots s ON s.id = b.mot_id
               WHERE a.mot_id = m.id AND s.lang = $4 AND ${matchCol('s.chinese')})`,
    ];
    if (pinyinNorm) {
      params.push(`%${pinyinNorm}%`);
      clauses.push(`${pinyinColNorm} LIKE $${params.length}`);
    }

    // Une carte PAR SENS (lexème × meaning). On ne garde QUE les sens ayant une
    // traduction native (`english IS NOT NULL`) : un mot sans traduction dans la
    // langue de base n'est jamais remonté, quelle que soit la direction (en↔fr).
    // L'unification/complétion des termes manquants se fait en back-office.
    // Dédup par CONTENU affiché (chinese + english).
    const { rows } = await pool.query(
      `WITH matched AS (
         SELECT DISTINCT m.id, m.chinese, m.pinyin, m.hsk
         FROM mots m
         WHERE m.lang = $5 AND (${clauses.join(' OR ')})
       ),
       pairs AS (
         SELECT mm.id, mm.chinese, mm.pinyin, mm.hsk, ls.meaning_id,
                mot_tr_sense(mm.id, ls.meaning_id, $4) AS english,
                EXISTS (SELECT 1 FROM user_mots um WHERE um.user_id = $2 AND um.mot_id = mm.id AND um.meaning_id = ls.meaning_id) AS owned
         FROM matched mm JOIN lexeme_senses ls ON ls.mot_id = mm.id
       ),
       deduped AS (
         SELECT DISTINCT ON (lower(chinese), lower(coalesce(english,'')))
                id, chinese, pinyin, hsk, meaning_id, english, owned
         FROM pairs
         WHERE english IS NOT NULL
         ORDER BY lower(chinese), lower(coalesce(english,'')), owned DESC, meaning_id ASC
       )
       SELECT d.id, d.chinese, d.pinyin, d.hsk, d.meaning_id, d.english, d.owned
       FROM deduped d
       -- Qualité P2P (Phase A) : scores confiance/possession posés par le crawler
       -- externe. LEFT JOIN → absents = NULL → lexeme_rank() applique un score
       -- NEUTRE. Sert UNIQUEMENT de tie-breaker APRÈS la pertinence (exact match,
       -- présence de traduction) : un résultat pertinent mais peu trusté reste visible.
       LEFT JOIN lexeme_sense_scores s ON s.mot_id = d.id AND s.meaning_id = d.meaning_id
       ORDER BY (d.chinese = $3 OR lower(d.english) = lower($3)) DESC,
                (d.english IS NOT NULL) DESC,
                lexeme_rank(s.confidence, s.possession_count, s.trust) DESC,
                d.id ASC
       LIMIT 8`,
      params
    );
    res.json({ results: rows });
  } catch (e) {
    console.error('m/search error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/pinyin?cn= : génère le pinyin d'un mot chinois (pinyin-pro) ────
router.get('/api/m/pinyin', requireToken, async (req, res) => {
  try {
    const cn = (req.query.cn || '').trim();
    if (!cn || !/[㐀-鿿]/.test(cn)) return res.json({ pinyin: '' });
    let toPinyin = null;
    try { toPinyin = require('pinyin-pro').pinyin; } catch { /* lib absente */ }
    res.json({ pinyin: toPinyin ? toPinyin(cn, { toneType: 'symbol' }) : '' });
  } catch (e) {
    console.error('m/pinyin error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/translate?cn= : suggestion anglaise pour un mot chinois ────────
// Aide la saisie dans « New word » (même principe que /api/m/pinyin). Base `mots`
// curée d'abord, sinon fallback CC-CEDICT (~120k entrées). Chinois → anglais.
router.get('/api/m/translate', requireToken, async (req, res) => {
  try {
    const cn = (req.query.cn || '').trim();
    if (!cn || !/[㐀-鿿]/.test(cn)) return res.json({ english: '' });
    const nat = (await getUserLangs(req.tokenUser.id)).native;
    const { rows } = await pool.query(
      "SELECT mot_tr(id, $2) AS english FROM mots WHERE chinese = $1 AND lang = 'zh' ORDER BY id LIMIT 1",
      [cn, nat]
    );
    const english = rows[0]?.english || cedict.translate(cn) || '';
    res.json({ english });
  } catch (e) {
    console.error('m/translate error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/words/:motId/capture : ajoute un mot existant à sa collection ──
// Capturer un mot du dico dans sa collection COÛTE 3 coins (même tarif que la
// création d'un mot). Transaction : solde verrouillé, débit + ledger + insert.
// Idempotent : si déjà possédé, aucun débit.
router.post('/api/m/words/:motId/capture', requireToken, async (req, res) => {
  const motId = parseInt(req.params.motId, 10);
  if (!motId) return res.status(400).json({ error: 'Invalid word' });
  const userId = req.tokenUser.id;
  const COST = 3;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Le mot doit exister dans le dictionnaire.
    const { rows: motRows } = await client.query('SELECT id, chinese FROM mots WHERE id = $1', [motId]);
    if (!motRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Word not found' }); }

    // Sens capturé : celui demandé (s'il appartient bien au mot), sinon le primaire.
    let meaningId = parseInt(req.body?.meaning_id, 10) || null;
    const { rows: senseRows } = await client.query(
      `SELECT meaning_id FROM lexeme_senses WHERE mot_id = $1
       ORDER BY (meaning_id = $2) DESC, meaning_id ASC LIMIT 1`, [motId, meaningId]);
    meaningId = senseRows[0]?.meaning_id || null;
    if (!meaningId) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Word has no sense' }); }

    // Déjà possédé (ce SENS) → no-op idempotent, aucun débit.
    const { rows: owned } = await client.query(
      'SELECT 1 FROM user_mots WHERE user_id = $1 AND mot_id = $2 AND meaning_id = $3', [userId, motId, meaningId]
    );
    if (owned.length) {
      await client.query('ROLLBACK');
      const { rows: b } = await pool.query('SELECT balance FROM users WHERE id = $1', [userId]);
      return res.json({ success: true, alreadyOwned: true, newBalance: b[0]?.balance ?? null });
    }

    // Solde verrouillé + vérification du coût.
    const { rows: userRows } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!userRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }
    const balance = userRows[0].balance;
    if (balance < COST) {
      await client.query('ROLLBACK');
      return res.status(402).json({ error: 'Insufficient balance (3 coins required)', insufficient: true, cost: COST, balance });
    }

    // Plafond du plan free (600 mots), comme à la création.
    const premium = await isUserPremium(userId);
    const maxWords = premium ? 100000 : 600;
    const { rows: wc } = await client.query('SELECT COUNT(*)::int AS n FROM user_mots WHERE user_id = $1', [userId]);
    if (wc[0].n >= maxWords) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: `Free limit reached (${maxWords} words). Go Premium for unlimited.`, limitReached: true, upgradeRequired: true, feature: 'words', max: maxWords });
    }

    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [COST, userId]);
    await client.query(
      `INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, $3, $4)`,
      [userId, -COST, 'capture_word', `Captured word ${motRows[0].chinese}`]
    );
    await client.query('INSERT INTO user_mots (user_id, mot_id, meaning_id, score) VALUES ($1, $2, $3, 0)', [userId, motId, meaningId]);

    await client.query('COMMIT');
    res.json({ success: true, newBalance: balance - COST });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/capture error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
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
  const langs = await getUserLangs(userId);
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
      return res.status(402).json({ error: 'Insufficient balance (3 coins required)', insufficient: true, cost: COST, balance });
    }

    // Réutilise un lexème existant du MÊME terme (insensible à la casse) dans la
    // langue apprise → jamais de doublon (« frame »/« Frame », spoon×2…). L'ancien
    // `forceNew` ne duplique plus : « éditer avant de capturer » enrichit le concept.
    let motId;
    const { rows: ex } = await client.query(
      'SELECT id, meaning_id FROM mots WHERE lower(chinese) = lower($1) AND lang = $2 ORDER BY id LIMIT 1',
      [chinese, langs.learning]);
    if (ex.length) motId = ex[0].id;
    if (!motId) {
      // Filet de sécurité : génère le pinyin si absent.
      let py = (pinyin || '').trim();
      if (!py && /[㐀-鿿]/.test(chinese)) {
        try { py = require('pinyin-pro').pinyin(chinese, { toneType: 'symbol' }); } catch { /* lib absente */ }
      }
      const ins = await client.query(
        `INSERT INTO mots (chinese, pinyin, lang)
         VALUES ($1, $2, $3) RETURNING id`,
        [chinese, py || null, langs.learning]
      );
      motId = ins.rows[0].id;
    }
    // Modèle concept : rattache/merge la glose saisie → renvoie le SENS utilisé,
    // qu'on capturera (possession par-sens). Si le lexème appris EXISTAIT déjà avec
    // un concept primaire, la glose ENRICHIT ce concept (frame + cadre + 框架 réunis)
    // au lieu de créer un sens détaché. Un lexème neuf laisse sync décider.
    const targetMeaning = ex.length ? (ex[0].meaning_id || null) : null;
    const meaningId = await syncConceptSiblings(client, motId, english, langs.native, { meaningId: targetMeaning, userId: req.tokenUser.id });

    // Déjà possédé — par SENS (on peut posséder un autre sens du même terme).
    const { rows: owned } = await client.query(
      'SELECT 1 FROM user_mots WHERE user_id = $1 AND mot_id = $2 AND meaning_id = $3', [userId, motId, meaningId]
    );
    if (owned.length) {
      // Le user possède déjà ce concept → la création servait à AJOUTER une
      // traduction : le concept vient d'être enrichi ci-dessus. On valide sans
      // recharger de pièces ni dupliquer la possession. Une description saisie
      // met à jour la note perso (user_mots) de CE sens.
      if (description != null && String(description).trim()) {
        await client.query(
          'UPDATE user_mots SET description = $4 WHERE user_id = $1 AND mot_id = $2 AND meaning_id = $3',
          [userId, motId, meaningId, String(description).trim()]);
      }
      await client.query('COMMIT');
      const { rows: w } = await pool.query(
        `SELECT m.id, m.chinese, m.pinyin, mot_tr_sense(m.id, $2, $3) AS english, m.hsk,
                (SELECT description FROM user_mots WHERE user_id = $4 AND mot_id = m.id AND meaning_id = $2) AS description
         FROM mots m WHERE m.id = $1`,
        [motId, meaningId, langs.native, userId]);
      return res.json({ success: true, enriched: true, word: w[0] });
    }

    // Plafond du plan free (600 mots). Ne concerne que l'ajout d'un mot nouveau.
    const premium = await isUserPremium(userId);
    const maxWords = premium ? 100000 : 600;
    const { rows: wc } = await client.query('SELECT COUNT(*)::int AS n FROM user_mots WHERE user_id = $1', [userId]);
    if (wc[0].n >= maxWords) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: `Free limit reached (${maxWords} words). Go Premium for unlimited.`,
        limitReached: true, upgradeRequired: true, feature: 'words', max: maxWords,
      });
    }

    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [COST, userId]);
    await client.query(
      `INSERT INTO transactions (user_id, amount, type, description)
       VALUES ($1, $2, $3, $4)`,
      [userId, -COST, 'capture_word', `Captured word ${chinese}`]
    );
    // Description = note PERSO du user (portée par user_mots, plus par mots).
    await client.query(
      'INSERT INTO user_mots (user_id, mot_id, meaning_id, score, description) VALUES ($1, $2, $3, 0, $4)',
      [userId, motId, meaningId, (description && String(description).trim()) || null]);

    await client.query('COMMIT');
    const word = await pool.query(
      `SELECT m.id, m.chinese, m.pinyin, mot_tr_sense(m.id, $2, $3) AS english, m.hsk,
              (SELECT description FROM user_mots WHERE user_id = $4 AND mot_id = m.id AND meaning_id = $2) AS description
       FROM mots m WHERE m.id = $1`,
      [motId, meaningId, langs.native, userId]);
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
// Groupe contigu de Hanzi (pour isoler le mot chinois même collé au reste).
const HAN_RUN_RE = /[㐀-鿿]+/g;

// Classe des tokens latins/pinyin en (pinyin, anglais) : un token avec ton ou
// numéro est du pinyin, le reste est de l'anglais. On garde l'anglais multi-mots.
function splitPinyinEnglish(rest) {
  const tokens = String(rest || '').split(/[\t;,]|\s+/).map((t) => t.trim()).filter(Boolean);
  const pinyin = tokens.filter(looksLikePinyin).join(' ');
  const latin = cleanDefinition(tokens.filter((t) => !looksLikePinyin(t)).join(' '));
  return { pinyin, latin };
}

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
  return splitPinyinEnglish(line);
}

// Extrait les fragments d'une ligne "tout-en-un" (ex. 工作⇥gōng zuò⇥job…).
function fragmentsFrom(line) {
  // Headword chinois = 1er groupe contigu de Hanzi, isolé par regex (robuste même
  // si tout est sur la même ligne / collé / séparé par des espaces).
  const runs = line.match(HAN_RUN_RE) || [];
  const chinese = runs[0] || '';
  // Le reste (ligne sans les Hanzi) est classé en pinyin / anglais.
  const { pinyin, latin } = splitPinyinEnglish(line.replace(HAN_RUN_RE, ' '));
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
    `SELECT u.special_guest, u.rc_expires_at, us.plan_name, us.status AS sub_status, us.stripe_status
     FROM users u LEFT JOIN user_subscriptions us ON us.user_id = u.id WHERE u.id = $1`, [userId]);
  if (!rows.length) return false;
  const r = rows[0];
  const rcActive = r.rc_expires_at && new Date(r.rc_expires_at) > new Date();
  return r.special_guest === true
    || rcActive
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
    // Direction fournie par le client (onboarding, avant sauvegarde) sinon en base.
    const bodyDir = req.body?.direction;
    let direction = (bodyDir === 'en→zh' || bodyDir === 'zh→en') ? bodyDir : null;
    if (!direction) {
      const dir = await pool.query('SELECT quiz_direction FROM users WHERE id = $1', [uid]);
      direction = dir.rows[0]?.quiz_direction || 'en→zh';
    }
    const learningChinese = direction !== 'zh→en';

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
      const nat = (await getUserLangs(uid)).native;
      const { rows: dict } = await pool.query(
        `SELECT chinese, mot_tr(mid, $3) AS english, pinyin, owned FROM (
           SELECT m.chinese,
                  (array_agg(m.id     ORDER BY (um.user_id IS NOT NULL) DESC, m.id))[1] AS mid,
                  (array_agg(m.pinyin ORDER BY (um.user_id IS NOT NULL) DESC, m.id))[1] AS pinyin,
                  bool_or(um.user_id IS NOT NULL) AS owned
           FROM mots m
           LEFT JOIN user_mots um ON um.mot_id = m.id AND um.user_id = $1
           WHERE m.chinese = ANY($2::text[]) AND m.lang = 'zh'
           GROUP BY m.chinese
         ) t`, [uid, unique.map((r) => r.chinese), nat]);
      const dictMap = new Map(dict.map((d) => [d.chinese, d]));

      const rows = unique.map((r) => {
        const d = dictMap.get(r.chinese);
        // On ne fait JAMAIS confiance au pinyin/anglais tapé par l'utilisateur.
        //  • Mot connu du dico → on source pinyin + anglais depuis la base.
        //  • Mot inconnu → pinyin toujours généré par pinyin-pro ; l'anglais est
        //    auto-rempli via CC-CEDICT s'il existe, sinon laissé VIDE.
        const pinyin = d?.pinyin || (toPinyin ? toPinyin(r.chinese, { toneType: 'symbol' }) : '');
        // Anglais : base d'abord, sinon CEDICT (mot à créer), sinon vide.
        const cedictEn = d?.english ? '' : cedict.translate(r.chinese);
        const english = d?.english || cedictEn || '';
        // owned : déjà dans ta collection · known : trad de la base (lecture seule)
        // new : rempli via CEDICT (mot créé, éditable) · needs_translation : à saisir.
        const status = d?.owned ? 'owned'
          : d?.english ? 'known'
            : english ? 'new'
              : 'needs_translation';
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

    // Apprend l'anglais : les lexèmes appris sont 'en' (leur terme = colonne
    // chinese). On matche par terme et la « traduction » (champ chinese renvoyé)
    // se dérive du concept dans la langue native (drop-safe, plus de m.english).
    const nat = (await getUserLangs(uid)).native;
    const { rows: dict } = await pool.query(
      `SELECT key, mot_tr(mid, $3) AS chinese, pinyin, owned FROM (
         SELECT lower(m.chinese) AS key,
                (array_agg(m.id     ORDER BY (um.user_id IS NOT NULL) DESC, m.id))[1] AS mid,
                (array_agg(m.pinyin ORDER BY (um.user_id IS NOT NULL) DESC, m.id))[1] AS pinyin,
                bool_or(um.user_id IS NOT NULL) AS owned
         FROM mots m
         LEFT JOIN user_mots um ON um.mot_id = m.id AND um.user_id = $1
         WHERE m.lang = 'en' AND lower(m.chinese) = ANY($2::text[])
         GROUP BY lower(m.chinese)
       ) t`,
      [uid, unique.map((r) => r.latin.toLowerCase()), nat]);
    const dictMap = new Map(dict.map((d) => [d.key, d]));

    const rows = unique.map((r) => {
      const d = dictMap.get(r.latin.toLowerCase());
      // Mot connu → traduction (chinois) du dico ; inconnu → celle de ta liste.
      const chinese = d?.chinese || r.chinese || '';
      const pinyin = d?.pinyin || r.pinyin || (chinese && toPinyin ? toPinyin(chinese, { toneType: 'symbol' }) : '');
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
  const langs = await getUserLangs(uid);
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
    const remaining = Math.max(0, maxWords - cnt[0].n);

    // ── Version ensembliste (quelques requêtes, pas une boucle N×round-trips) ──
    // 1. Mots déjà présents dans le dico (par chinois).
    const chineseArr = clean.map((w) => w.chinese);
    const { rows: existing } = await client.query(
      `SELECT DISTINCT ON (chinese) chinese, id FROM mots WHERE chinese = ANY($1::text[]) ORDER BY chinese, id`,
      [chineseArr]);
    const idByChinese = new Map(existing.map((r) => [r.chinese, r.id]));

    // 2. Insertion en masse des mots manquants (avec la trad de ta liste).
    const missing = clean.filter((w) => !idByChinese.has(w.chinese));
    if (missing.length) {
      const { rows: ins } = await client.query(
        `INSERT INTO mots (chinese, pinyin, lang)
         SELECT c, p, $3 FROM unnest($1::text[], $2::text[]) AS t(c, p) RETURNING chinese, id`,
        [missing.map((w) => w.chinese), missing.map((w) => w.pinyin || null), langs.learning]);
      ins.forEach((r) => idByChinese.set(r.chinese, r.id));
      // Modèle concept : concept + frère(s) natif(s) par sens pour chaque mot créé.
      const glossByChinese = new Map(missing.map((w) => [w.chinese, w.english]));
      for (const r of ins) {
        await syncConceptSiblings(client, r.id, glossByChinese.get(r.chinese), langs.native, { userId: req.tokenUser.id });
      }
    }

    // 3. Mots déjà dans la collection (pour ne pas les recompter).
    const allIds = [...new Set(clean.map((w) => idByChinese.get(w.chinese)).filter(Boolean))];
    const { rows: ownedRows } = await client.query(
      'SELECT mot_id FROM user_mots WHERE user_id = $1 AND mot_id = ANY($2::int[])', [uid, allIds]);
    const ownedSet = new Set(ownedRows.map((r) => r.mot_id));

    // 4. Candidats = non possédés, dédoublonnés ; on cape à la limite free.
    const candidates = [];
    const pushed = new Set();
    let skippedOwned = 0;
    for (const w of clean) {
      const id = idByChinese.get(w.chinese);
      if (!id || pushed.has(id)) continue;
      if (ownedSet.has(id)) { skippedOwned++; continue; }
      pushed.add(id);
      candidates.push(id);
    }
    // Free déjà au plafond : rien ne peut être ajouté → paywall (au lieu d'un
    // import « 0 mot » silencieux avec un simple succès).
    if (!premium && remaining === 0 && candidates.length > 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: `Free limit reached (${maxWords} words). Go Premium for unlimited.`, upgradeRequired: true, feature: 'words', max: maxWords });
    }
    const toAdd = candidates.slice(0, remaining);
    if (toAdd.length) {
      await client.query(
        `INSERT INTO user_mots (user_id, mot_id, meaning_id, score)
         SELECT $1, x, (SELECT min(meaning_id) FROM lexeme_senses WHERE mot_id = x), 0
         FROM unnest($2::int[]) AS x
         WHERE EXISTS (SELECT 1 FROM lexeme_senses WHERE mot_id = x)
         ON CONFLICT DO NOTHING`, [uid, toAdd]);
    }
    const added = toAdd.length;
    const limitReached = candidates.length > added;
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
    // Gate anti-faux-comptes : modifier un mot (édite la base partagée) exige un
    // email vérifié, pour éviter qu'un compte non vérifié pollue le contenu.
    if (!(await isVerified(req.tokenUser.id))) return verifyRequired(res);
    const motId = parseInt(req.params.motId, 10);
    if (!motId) return res.status(400).json({ error: 'Invalid word' });
    const { chinese, pinyin, english, description } = req.body || {};

    // Édite le SENS possédé (meaning_id du body, sinon un sens possédé du mot).
    const reqMeaning = parseInt(req.body?.meaning_id, 10) || null;
    const owns = await pool.query(
      `SELECT meaning_id FROM user_mots WHERE user_id = $1 AND mot_id = $2
       ORDER BY (meaning_id = $3) DESC, meaning_id ASC LIMIT 1`,
      [req.tokenUser.id, motId, reqMeaning]
    );
    if (!owns.rows.length) return res.status(403).json({ error: 'Not your word' });
    const meaningId = owns.rows[0].meaning_id;

    const langs = await getUserLangs(req.tokenUser.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // chinese/pinyin = base partagée (mots) ; description = note PERSO (user_mots).
      // Audit : on journalise si la SURFACE partagée change réellement.
      const beforeRow = (await client.query('SELECT chinese, pinyin FROM mots WHERE id = $1', [motId])).rows[0] || {};
      await client.query(
        `UPDATE mots
         SET chinese = COALESCE($2, chinese),
             pinyin  = COALESCE($3, pinyin)
         WHERE id = $1`,
        [motId, chinese ?? null, pinyin ?? null]
      );
      const afterRow = (await client.query('SELECT chinese, pinyin FROM mots WHERE id = $1', [motId])).rows[0] || {};
      if (beforeRow.chinese !== afterRow.chinese || beforeRow.pinyin !== afterRow.pinyin) {
        await logEdit(client, req.tokenUser.id, motId, 'edit_surface', afterRow.chinese,
          { chinese: beforeRow.chinese, pinyin: beforeRow.pinyin },
          { chinese: afterRow.chinese, pinyin: afterRow.pinyin });
      }
      if (description != null) {
        await client.query(
          'UPDATE user_mots SET description = $4 WHERE user_id = $1 AND mot_id = $2 AND meaning_id = $3',
          [req.tokenUser.id, motId, meaningId, String(description).trim() || null]);
      }
      // Glose modifiée → réécrit les frères natifs de CE sens (replace, ciblé).
      if (english != null && String(english).trim()) {
        await syncConceptSiblings(client, motId, english, langs.native, { replace: true, meaningId, userId: req.tokenUser.id });
      }
      const { rows: out } = await client.query(
        `SELECT m.id, m.chinese, m.pinyin, mot_tr_sense(m.id, $2, $3) AS english, m.hsk,
                (SELECT description FROM user_mots WHERE user_id = $4 AND mot_id = m.id AND meaning_id = $2) AS description
         FROM mots m WHERE m.id = $1`,
        [motId, meaningId, langs.native, req.tokenUser.id]);
      await client.query('COMMIT');
      res.json({ word: { ...out[0], meaning_id: meaningId } });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
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
    // Suppression du SENS précis si fourni (?meaning_id=), sinon tous les sens du mot.
    const meaningId = parseInt(req.query.meaning_id, 10) || null;
    if (meaningId) {
      await pool.query('DELETE FROM user_mots WHERE user_id = $1 AND mot_id = $2 AND meaning_id = $3', [req.tokenUser.id, motId, meaningId]);
    } else {
      await pool.query('DELETE FROM user_mots WHERE user_id = $1 AND mot_id = $2', [req.tokenUser.id, motId]);
    }
    res.json({ success: true });
  } catch (e) {
    console.error('m/word delete error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/words/bulk-delete : suppression EN MASSE (PREMIUM) ────────────
// body: { ids:[motId…] } et/ou { packId }. Réservé au premium (403 upgradeRequired
// sinon). `packId` → retire tous les mots possédés qui appartiennent à ce pack ;
// `ids` → retire exactement ces mots. On ne touche QUE user_mots (la base globale
// `mots` et les packs restent intacts).
router.post('/api/m/words/bulk-delete', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  if (!(await isUserPremium(uid))) {
    return res.status(403).json({ error: 'Premium required', upgradeRequired: true, feature: 'bulk_delete' });
  }
  try {
    const packId = parseInt(req.body?.packId, 10) || null;
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 5000)
      : [];
    if (!packId && !ids.length) return res.status(400).json({ error: 'Nothing to delete' });

    let deleted = 0;
    if (packId) {
      const r = await pool.query(
        `DELETE FROM user_mots WHERE user_id = $1
           AND mot_id IN (SELECT mot_id FROM word_pack_items WHERE pack_id = $2)`, [uid, packId]);
      deleted += r.rowCount || 0;
      // « Forget » = oublier complètement le pack : on retire aussi l'achat pour
      // qu'il redevienne « non acheté » (re-téléchargeable) dans le store.
      await pool.query('DELETE FROM pack_purchases WHERE pack_id = $1 AND buyer_id = $2', [packId, uid]);
    }
    if (ids.length) {
      const r = await pool.query('DELETE FROM user_mots WHERE user_id = $1 AND mot_id = ANY($2)', [uid, ids]);
      deleted += r.rowCount || 0;
    }
    res.json({ success: true, deleted });
  } catch (e) {
    console.error('m/words bulk-delete error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/character/:char : sens d'un caractère seul (tap sur la carte) ──
router.get('/api/m/character/:char', requireToken, async (req, res) => {
  try {
    const ch = decodeURIComponent(req.params.char || '').trim();
    if (!ch) return res.status(400).json({ error: 'Missing character' });
    // Correspondance exacte d'un mot d'un seul caractère dans le dictionnaire
    const nat = (await getUserLangs(req.tokenUser.id)).native;
    const { rows } = await pool.query(
      "SELECT chinese, pinyin, mot_tr(id, $2) AS english, hsk FROM mots WHERE chinese = $1 AND lang = 'zh' ORDER BY id ASC LIMIT 1",
      [ch, nat]
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
      // Défaut : score = ventes + bonus nouveauté (+3 si < 7 j). Les ventes
      // dominent, mais un pack récent remonte un peu (équivaut à 3 achats).
      featured: "(wp.sales_count + CASE WHEN wp.created_at > NOW() - INTERVAL '7 days' THEN 3 ELSE 0 END) DESC, wp.created_at DESC",
      recent: 'wp.created_at DESC',
      price_asc: 'wp.price ASC, wp.created_at DESC',
      price_desc: 'wp.price DESC, wp.created_at DESC',
      popular: 'wp.sales_count DESC, wp.created_at DESC',
    };
    const orderBy = sortMap[req.query.sort] || sortMap.featured;

    // Un pack couvre UNE PAIRE de langues (celle de son créateur). On le montre
    // uniquement aux apprenants de CETTE paire, dans un sens OU l'autre (réciprocité
    // zh↔en : montré à zh→en ET en→zh), mais JAMAIS à une autre paire — un pack
    // zh↔en est culturellement chinois et n'a pas de sens pour un apprenant fr↔en.
    // On exige AUSSI que chaque concept soit atteignable dans les deux langues de la
    // paire du viewer (réachabilité) → un pack incomplet reste caché. L'affichage
    // est ensuite orienté selon le viewer (gauche = langue apprise, droite = trad).
    // En onboarding les langues ne sont pas encore persistées → le front peut les
    // passer en query pour prévisualiser la bonne paire.
    const stored = await getUserLangs(uid);
    const qLearn = LEARNABLE_LANGS.includes(req.query.learning) ? req.query.learning : null;
    const qNative = LEARNABLE_LANGS.includes(req.query.native) ? req.query.native : null;
    const langs = { learning: qLearn || stored.learning, native: qNative || stored.native };
    const params = [uid, min, max, langs.learning, langs.native];
    let where = `wp.published = TRUE AND wp.price >= $2 AND wp.price <= $3
      AND ((wp.lang = $4 AND wp.native_lang = $5) OR (wp.lang = $5 AND wp.native_lang = $4))
      AND NOT EXISTS (
        SELECT 1 FROM word_pack_items i2 JOIN mots pm ON pm.id = i2.mot_id
        WHERE i2.pack_id = wp.id
          AND (NOT EXISTS (
                SELECT 1 FROM lexeme_senses a JOIN lexeme_senses b ON b.meaning_id = a.meaning_id
                JOIN mots sib ON sib.id = b.mot_id
                WHERE a.mot_id = pm.id AND sib.lang = $4)
            OR NOT EXISTS (
                SELECT 1 FROM lexeme_senses a JOIN lexeme_senses b ON b.meaning_id = a.meaning_id
                JOIN mots sib ON sib.id = b.mot_id
                WHERE a.mot_id = pm.id AND sib.lang = $5))
      )`;
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (wp.title ILIKE $${params.length} OR wp.description ILIKE $${params.length} OR COALESCE(u.name, wp.creator_name, '') ILIKE $${params.length})`;
    }
    const { rows } = await pool.query(
      `SELECT wp.id, wp.title, wp.description, wp.price, wp.cover_key, wp.is_official, wp.sales_count,
              COALESCE(u.name, wp.creator_name, 'Anonymous') AS creator,
              (SELECT COUNT(*) FROM word_pack_items i WHERE i.pack_id = wp.id)::int AS word_count,
              -- Mots possédés DANS LA LANGUE APPRISE du viewer ($4) — pas cross-langue.
              -- Sur un parcours miroir, posséder « manger » (fr) ne compte pas le pack
              -- comme possédé côté en (où l'on n'a pas « to eat »).
              (SELECT COUNT(*) FROM word_pack_items i
                 WHERE i.pack_id = wp.id AND EXISTS (
                   SELECT 1 FROM lexeme_senses lp
                   JOIN user_mots um ON um.meaning_id = lp.meaning_id AND um.user_id = $1
                   JOIN mots mo ON mo.id = um.mot_id AND mo.lang = $4
                   WHERE lp.mot_id = i.mot_id))::int AS owned_words,
              (wp.created_at > NOW() - INTERVAL '7 days') AS is_new,
              (wp.creator_id = $1) AS is_mine,
              -- Possédé = ACQUIS : acheté, OU c'est SON pack et on en a tous les mots
              -- dans la langue apprise courante (donc « possédé » sur le parcours de la
              -- langue du pack, pas sur un parcours miroir). Simplement CONNAÎTRE le
              -- vocabulaire (sans l'avoir acheté ni créé) ne compte PAS comme possédé.
              (EXISTS(SELECT 1 FROM pack_purchases pp WHERE pp.pack_id = wp.id AND pp.buyer_id = $1)
                OR (wp.creator_id = $1
                    AND (SELECT COUNT(*) FROM word_pack_items i WHERE i.pack_id = wp.id) > 0
                    AND NOT EXISTS (
                      SELECT 1 FROM word_pack_items i WHERE i.pack_id = wp.id AND NOT EXISTS (
                        SELECT 1 FROM lexeme_senses lp
                        JOIN user_mots um ON um.meaning_id = lp.meaning_id AND um.user_id = $1
                        JOIN mots mo ON mo.id = um.mot_id AND mo.lang = $4
                        WHERE lp.mot_id = i.mot_id)))) AS owned
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
    // Langues du viewer : servent à l'affichage orienté-viewer ET au décompte des
    // mots possédés DANS LA LANGUE APPRISE (parcours-conscient, cohérent avec la liste).
    const vlangs = await getUserLangs(uid);
    const { rows } = await pool.query(
      `SELECT wp.id, wp.title, wp.description, wp.price, wp.cover_key, wp.is_official, wp.sales_count,
              wp.creator_id,
              COALESCE(u.name, wp.creator_name, 'Anonymous') AS creator,
              (SELECT COUNT(*) FROM word_pack_items i WHERE i.pack_id = wp.id)::int AS word_count,
              -- Mots possédés DANS LA LANGUE APPRISE du viewer ($3) — pas cross-langue.
              (SELECT COUNT(*) FROM word_pack_items i
                 WHERE i.pack_id = wp.id AND EXISTS(
                   SELECT 1 FROM lexeme_senses lp
                   JOIN user_mots um ON um.meaning_id = lp.meaning_id AND um.user_id = $1
                   JOIN mots mo ON mo.id = um.mot_id AND mo.lang = $3
                   WHERE lp.mot_id = i.mot_id))::int AS owned_words,
              EXISTS(SELECT 1 FROM pack_purchases pp WHERE pp.pack_id = wp.id AND pp.buyer_id = $1) AS owned
       FROM word_packs wp
       LEFT JOIN users u ON u.id = wp.creator_id
       WHERE wp.id = $2 AND wp.published = TRUE`, [uid, id, vlangs.learning]);
    if (!rows.length) return res.status(404).json({ error: 'Pack not found' });
    const pack = rows[0];
    pack.isMine = pack.creator_id === uid;
    delete pack.creator_id;
    // Possédé = acheté OU (mon pack ET j'en ai TOUS les mots dans la langue apprise) —
    // même règle que la liste. Un créateur ne « possède » son pack que sur le parcours
    // où il en a les mots ; sur un parcours miroir il devra l'acquérir (gratuitement).
    pack.owned = pack.owned || (pack.isMine && pack.word_count > 0 && pack.owned_words >= pack.word_count);
    // Créateur → toujours la liste complète (c'est son contenu) ; acheteur possédant →
    // complète aussi ; sinon aperçu de 3.
    const full = pack.owned || pack.isMine;
    // Affichage ORIENTÉ VIEWER : pour chaque item, on résout le concept vers le
    // lexème de la langue APPRISE (colonne gauche) et de la langue CONNUE (droite),
    // peu importe la langue du mot stocké. Un pack de concepts s'affiche donc dans
    // le sens de CHAQUE apprenant (zh→en le voit zh|en ; en→zh le voit en|zh).
    const { rows: words } = await pool.query(
      `SELECT i.mot_id AS id,
              (SELECT string_agg(DISTINCT lx.chinese, ' / ' ORDER BY lx.chinese)
                 FROM lexeme_senses a JOIN lexeme_senses b ON b.meaning_id = a.meaning_id
                 JOIN mots lx ON lx.id = b.mot_id
                 WHERE a.mot_id = i.mot_id AND lx.lang = $2) AS chinese,
              (SELECT lx.pinyin
                 FROM lexeme_senses a JOIN lexeme_senses b ON b.meaning_id = a.meaning_id
                 JOIN mots lx ON lx.id = b.mot_id
                 WHERE a.mot_id = i.mot_id AND lx.lang = $2 AND lx.pinyin IS NOT NULL
                 ORDER BY lx.id LIMIT 1) AS pinyin,
              (SELECT string_agg(DISTINCT lx.chinese, ' / ' ORDER BY lx.chinese)
                 FROM lexeme_senses a JOIN lexeme_senses b ON b.meaning_id = a.meaning_id
                 JOIN mots lx ON lx.id = b.mot_id
                 WHERE a.mot_id = i.mot_id AND lx.lang = $3) AS english,
              -- Surface CHINOISE du concept (pour l'édition, non encore câblée hors zh).
              (SELECT string_agg(DISTINCT lx.chinese, ' / ' ORDER BY lx.chinese)
                 FROM lexeme_senses a JOIN lexeme_senses b ON b.meaning_id = a.meaning_id
                 JOIN mots lx ON lx.id = b.mot_id
                 WHERE a.mot_id = i.mot_id AND lx.lang = 'zh') AS zh,
              -- Surface RÉELLE du lexème de l'item (le mot curé, PAS l'agrégat du
              -- concept). Sert au RÉ-REMPLISSAGE à l'édition : réinjecter l'agrégat
              -- « A / B » ferait une ligne non-possédable (planPack ne trouve aucun
              -- lexème « A / B ») → faux « non possédé » + re-demande d'achat/trad.
              (SELECT chinese FROM mots WHERE id = i.mot_id) AS raw
       FROM word_pack_items i WHERE i.pack_id = $1 ORDER BY i.mot_id`,
      [id, vlangs.learning, vlangs.native]);
    if (full) { res.json({ pack, words }); return; }
    // Aperçu : on montre TOUS les mots proposés, mais la traduction n'est visible
    // que pour les 3 premiers. Pour les suivants on NE renvoie PAS la traduction
    // (anti-triche) → le front la floute. `zh` (surface d'édition) aussi masqué.
    const UNLOCKED = 3;
    const preview = words.map((w, i) => (i < UNLOCKED ? w : { id: w.id, chinese: w.chinese, pinyin: w.pinyin, english: null, zh: null, locked: true }));
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
  // Langue apprise : ce qu'on ajoute à la collection est le lexème du concept DANS
  // cette langue (un pack zh↔en acheté par un apprenant d'anglais ajoute les mots
  // ANGLAIS des concepts, pas les mots chinois). CTE partagée pour compter/insérer.
  const langs = await getUserLangs(uid);
  // Pour chaque item du pack → son sens primaire → le(s) lexème(s) de la langue
  // apprise reliés à ce sens. C'est ce qui atterrit dans user_mots.
  const targetsCTE = `
    items AS (
      SELECT i.mot_id,
             (SELECT min(meaning_id) FROM lexeme_senses WHERE mot_id = i.mot_id) AS meaning_id,
             (SELECT lang FROM mots WHERE id = i.mot_id) AS item_lang
      FROM word_pack_items i WHERE i.pack_id = $2
    ),
    -- Un target par item du pack : si le mot du pack est DÉJÀ dans la langue apprise
    -- (cas normal), on le garde tel quel (curation du pack préservée) ; sinon (sens
    -- réciproque) on prend un lexème de la langue apprise du même concept.
    targets AS (
      SELECT DISTINCT ON (it.mot_id)
             CASE WHEN it.item_lang = $3 THEN it.mot_id ELSE learn.id END AS mot_id,
             it.meaning_id
      FROM items it
      LEFT JOIN lexeme_senses ls ON ls.meaning_id = it.meaning_id
      LEFT JOIN mots learn ON learn.id = ls.mot_id AND learn.lang = $3
      WHERE it.meaning_id IS NOT NULL
        AND (it.item_lang = $3 OR learn.id IS NOT NULL)
      ORDER BY it.mot_id, learn.id
    )`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: pk } = await client.query(
      'SELECT id, title, price, creator_id, cover_key FROM word_packs WHERE id = $1 AND published = TRUE FOR UPDATE', [id]);
    if (!pk.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pack not found' }); }
    const pack = pk[0];
    // Le CRÉATEUR peut acquérir SON propre pack GRATUITEMENT (ex. récupérer les mots
    // dans la langue d'un parcours miroir) : pas de paiement, pas de crédit à
    // lui-même, pas d'enregistrement d'achat — juste l'ajout des mots. Sinon achat
    // normal (paiement + crédit créateur + purchase).
    const isCreator = pack.creator_id === uid;
    const price = isCreator ? 0 : pack.price;

    if (!isCreator) {
      const { rows: already } = await client.query(
        'SELECT 1 FROM pack_purchases WHERE pack_id = $1 AND buyer_id = $2', [id, uid]);
      if (already.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'You already own this pack.' }); }
    }

    // Limites gratuites : packs HSK avancés réservés au premium + plafond d'achats.
    // Ne s'appliquent pas au créateur récupérant son propre pack.
    if (!isCreator && !(await isUserPremium(uid))) {
      if (PREMIUM_PACK_COVERS.includes(pack.cover_key)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'HSK 4/5/6 packs are Premium.', upgradeRequired: true, feature: 'hsk_pack' });
      }
      const { rows: bought } = await client.query('SELECT COUNT(*)::int AS n FROM pack_purchases WHERE buyer_id = $1', [uid]);
      if (bought[0].n >= FREE_LIMITS.packsMax) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: `Free users can buy up to ${FREE_LIMITS.packsMax} packs.`, upgradeRequired: true, feature: 'pack_limit' });
      }
      // Plafond de mots : un pack ne doit pas faire dépasser les 600 mots du free.
      // On compte les mots du pack pas encore possédés (ceux qui seraient ajoutés).
      const { rows: wc } = await client.query('SELECT COUNT(*)::int AS n FROM user_mots WHERE user_id = $1', [uid]);
      const { rows: newW } = await client.query(
        `WITH ${targetsCTE}
         SELECT COUNT(*)::int AS n FROM targets t
         WHERE NOT EXISTS (SELECT 1 FROM user_mots um
                           WHERE um.user_id = $1 AND um.mot_id = t.mot_id AND um.meaning_id = t.meaning_id)`,
        [uid, id, langs.learning]);
      if (wc[0].n + newW[0].n > 600) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Free limit reached (600 words). This pack would exceed it. Go Premium for unlimited.', upgradeRequired: true, feature: 'words', max: 600 });
      }
    }

    const { rows: cnt } = await client.query('SELECT COUNT(*)::int AS n FROM word_pack_items WHERE pack_id = $1', [id]);
    if (cnt[0].n === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'This pack is not available yet.' }); }

    const { rows: bal } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [uid]);
    if (!bal.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }
    if (bal[0].balance < price) { await client.query('ROLLBACK'); return res.status(402).json({ error: 'Not enough coins', insufficient: true, cost: price, balance: bal[0].balance }); }

    // Ajoute à la collection le lexème de la langue APPRISE de chaque concept du
    // pack (pas forcément le lexème stocké dans le pack — cf. sens zh↔en réciproque).
    const ins = await client.query(
      `WITH ${targetsCTE}
       INSERT INTO user_mots (user_id, mot_id, meaning_id, score, nb_quiz, nb_correct, last_seen)
       SELECT $1, t.mot_id, t.meaning_id, 0, 0, 0, NULL FROM targets t
       WHERE NOT EXISTS (SELECT 1 FROM user_mots um
                         WHERE um.user_id = $1 AND um.mot_id = t.mot_id AND um.meaning_id = t.meaning_id)
       ON CONFLICT DO NOTHING
       RETURNING mot_id`, [uid, id, langs.learning]);
    const added = ins.rowCount;

    // Paiement + enregistrement : UNIQUEMENT pour un achat réel (pas le créateur).
    if (!isCreator) {
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
    }

    await client.query('COMMIT');
    // Notif "vente de pack" pour le créateur (achats réels uniquement).
    if (!isCreator && pack.creator_id && pack.creator_id !== uid) {
      pool.query('SELECT name FROM users WHERE id = $1', [uid])
        .then((r) => notify(pack.creator_id, 'pack_sold', 'Pack sold! 🎉', `${r.rows[0]?.name || 'Someone'} bought "${pack.title}" — +${pack.price} ₵.`, { packId: id }))
        .catch(() => {});
    }
    res.json({ success: true, wordsAdded: added, newBalance: bal[0].balance - price });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/market buy error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

// Extrait la liste de mots chinois (texte collé OU tableau), dédoublonnée.
function extractWordList(body) {
  // Création de pack = « un mot par ligne », TOUTES langues. On ne passe PLUS par le
  // parser Han-centré (parseImportText) : celui-ci ne gardait que `r.chinese` et
  // jetait donc silencieusement toute ligne sans hanzi (mots occidentaux) → popup
  // vide sur un parcours chinois. Découpe verbatim par ligne = prévisible et
  // multilingue. (parseImportText reste utilisé pour l'import en masse.)
  let words;
  if (typeof body?.text === 'string') words = String(body.text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  else if (Array.isArray(body?.words)) words = body.words.map((w) => String(w || '').trim()).filter(Boolean);
  else words = [];
  const seen = new Set();
  return words.filter((w) => (seen.has(w) ? false : seen.add(w)));
}

const ACQUIRE_COST = 3; // coût pour ajouter à sa collection un mot manquant

// ── POST /api/m/market/packs/plan : classe les mots avant publication ────────
// possédés / à acheter (dans le dico) / à traduire (hors dico) + coût (3 ₵/mot
// manquant) + solde. Le client s'en sert pour le checkout.
router.post('/api/m/market/packs/plan', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const langs = await getUserLangs(uid);
    const learn = langs.learning;    // langue apprise = langue du CONTENU du pack
    const nat = langs.native;        // langue connue  = langue de la TRADUCTION
    const isZh = learn === 'zh';
    const words = extractWordList(req.body);
    const { rows: bal } = await pool.query('SELECT balance FROM users WHERE id = $1', [uid]);
    const balance = bal[0]?.balance ?? 0;
    if (!words.length) return res.json({ owned: [], toBuy: [], needsTranslation: [], cost: 0, balance });

    // Rapprochement des surfaces insensible à la casse/espaces (no-op en zh), DANS
    // LA LANGUE APPRISE (surface + lang), pour ne pas confondre un homographe d'une
    // autre langue. Les résultats sont RENVOYÉS avec la surface TAPÉE (le front les
    // ré-associe aux lignes saisies).
    const normKey = (s) => String(s || '').trim().toLowerCase();
    const wnorm = words.map(normKey);
    const { rows: ownedRows } = await pool.query(
      `SELECT DISTINCT ON (lower(btrim(m.chinese))) lower(btrim(m.chinese)) AS k, m.pinyin, mot_tr(m.id, $3) AS english
       FROM mots m JOIN user_mots um ON um.mot_id = m.id AND um.user_id = $1
       WHERE lower(btrim(m.chinese)) = ANY($2::text[]) AND m.lang = $4 ORDER BY lower(btrim(m.chinese)), m.id`, [uid, wnorm, nat, learn]);
    const ownedByKey = new Map(ownedRows.map((r) => [r.k, r]));
    const owned = words.filter((w) => ownedByKey.has(normKey(w)))
      .map((w) => ({ chinese: w, pinyin: ownedByKey.get(normKey(w)).pinyin || '', english: ownedByKey.get(normKey(w)).english || '' }));

    const notOwned = words.filter((w) => !ownedByKey.has(normKey(w)));
    let dictByKey = new Map();
    if (notOwned.length) {
      const { rows: dictRows } = await pool.query(
        `SELECT DISTINCT ON (lower(btrim(m.chinese))) lower(btrim(m.chinese)) AS k, m.pinyin, mot_tr(m.id, $2) AS english
         FROM mots m WHERE lower(btrim(m.chinese)) = ANY($1::text[]) AND m.lang = $3 ORDER BY lower(btrim(m.chinese)), m.id`, [notOwned.map(normKey), nat, learn]);
      dictByKey = new Map(dictRows.map((d) => [d.k, d]));
    }
    const toBuy = notOwned.filter((w) => dictByKey.has(normKey(w)))
      .map((w) => ({ chinese: w, pinyin: dictByKey.get(normKey(w)).pinyin || '', english: dictByKey.get(normKey(w)).english || '' }));
    // Mots hors dico → aides à la saisie SPÉCIFIQUES au chinois : pinyin (pinyin-pro)
    // + suggestion CC-CEDICT. Sans objet pour les autres langues (champ vide).
    let toPinyin = null;
    if (isZh) { try { toPinyin = require('pinyin-pro').pinyin; } catch { /* lib absente → pinyin vide */ } }
    const needsTranslation = notOwned.filter((w) => !dictByKey.has(normKey(w))).map((w) => ({
      chinese: w,
      pinyin: toPinyin ? toPinyin(w, { toneType: 'symbol' }) : '',
      // Suggestion de traduction (CC-CEDICT, zh→en uniquement) pour pré-remplir — éditable.
      suggested: isZh ? (cedict.translate(w) || '') : '',
    }));
    const cost = ACQUIRE_COST * (toBuy.length + needsTranslation.length);
    res.json({ owned, toBuy, needsTranslation, cost, balance });
  } catch (e) {
    console.error('m/market plan error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/market/packs : créer un pack (acquiert les mots manquants) ────
// body: title, description, price, text|words, translations {cn:en}, acquire.
// Si des mots ne sont pas possédés : refus (400) sauf `acquire=true`, auquel cas
// on les ajoute à la collection (3 ₵/mot ; création + traduction si hors dico).
router.post('/api/m/market/packs', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  // Gate anti-faux-comptes : publier/vendre un pack exige un email vérifié.
  if (!(await isVerified(uid))) return verifyRequired(res);
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();
  const price = parseInt(req.body?.price, 10);
  // Langue apprise = langue du CONTENU du pack ; langue connue = la TRADUCTION.
  // (Ex. apprenant le français depuis l'anglais → pack français, trad anglaise.)
  const langs = await getUserLangs(uid);
  let words = extractWordList(req.body);
  let translations = (req.body?.translations && typeof req.body.translations === 'object') ? req.body.translations : {};
  const acquire = req.body?.acquire === true;
  // Garde-fou UX : l'utilisateur a saisi les colonnes à l'envers (mots tapés = sa
  // langue CONNUE, langue apprise mise dans les champs de trad). Le front envoie
  // `swap` → on inverse : les valeurs des champs deviennent les mots (langue
  // apprise = contenu du pack), les mots tapés deviennent leurs traductions.
  // La valeur d'un champ pouvait contenir PLUSIEURS mots séparés (« a,b,c ») — elle
  // servait de traduction (donc découpée). Une fois promue en CONTENU, on la découpe
  // pareil (splitSenses) → chaque valeur devient un mot distinct, plutôt qu'un seul
  // lexème « a,b,c ». Le mot tapé sert de traduction à chacun.
  if (req.body?.swap === true) {
    const nw = []; const nt = {};
    for (const w of words) {
      for (const sense of splitSenses(translations[w])) {
        if (nt[sense] === undefined) { nw.push(sense); nt[sense] = w; }
      }
    }
    words = nw; translations = nt;
  }
  // Mode édition : packId d'un pack existant appartenant à l'utilisateur.
  const editId = Number.isInteger(parseInt(req.body?.packId, 10)) ? parseInt(req.body.packId, 10) : null;

  if (!title || title.length > 80) return res.status(400).json({ error: 'Title is required (max 80 characters).' });
  if (description.length > 300) return res.status(400).json({ error: 'Description is too long (max 300 characters).' });
  if (!Number.isInteger(price) || price < 0 || price > 100000) return res.status(400).json({ error: 'Enter a valid price.' });
  if (words.length < 1) return res.status(400).json({ error: 'Add at least one word.' });
  if (words.length > 500) return res.status(400).json({ error: 'Too many words (max 500).' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Édition : le pack doit exister et appartenir à l'utilisateur.
    if (editId) {
      const { rows: own } = await client.query('SELECT creator_id FROM word_packs WHERE id = $1 FOR UPDATE', [editId]);
      if (!own.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pack not found.' }); }
      if (own[0].creator_id !== uid) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Not your pack.' }); }
    }
    // Le mot tapé est dans la langue APPRISE (`content`) ; la traduction va vers
    // la langue connue (`other` = native). Généralise l'ancien modèle hanzi-only :
    // avant, le contenu était forcé à 'zh' et `other` = la langue non-zh du créateur.
    const content = langs.learning;
    const other = langs.native;
    const isZh = content === 'zh';
    // Rapprochement des surfaces insensible à la casse/espaces (no-op en zh) : un
    // mot déjà possédé ("Bonjour") doit être reconnu quand l'utilisateur tape
    // "bonjour" — sinon il serait refacturé et re-traduit à tort.
    const normKey = (s) => String(s || '').trim().toLowerCase();
    const wnorm = words.map(normKey);
    const { rows: owned } = await client.query(
      `SELECT DISTINCT ON (lower(btrim(m.chinese))) lower(btrim(m.chinese)) AS k, m.id
       FROM mots m JOIN user_mots um ON um.mot_id = m.id AND um.user_id = $1
       WHERE lower(btrim(m.chinese)) = ANY($2::text[]) AND m.lang = $3
       ORDER BY lower(btrim(m.chinese)), m.id`, [uid, wnorm, content]);
    const ownedByKey = new Map(owned.map((r) => [r.k, r.id]));
    const ownedMap = new Map();
    for (const w of words) { const id = ownedByKey.get(normKey(w)); if (id) ownedMap.set(w, id); }
    const notOwned = words.filter((w) => !ownedMap.has(w));

    if (notOwned.length) {
      if (!acquire) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: "You cannot sell words you don't own yourself.", missing: notOwned });
      }
      const cost = ACQUIRE_COST * notOwned.length;
      const { rows: balRows } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [uid]);
      if ((balRows[0]?.balance ?? 0) < cost) {
        await client.query('ROLLBACK');
        return res.status(402).json({ error: `Not enough coins (need ${cost} ₵).`, insufficient: true, cost, balance: balRows[0]?.balance ?? 0 });
      }
      let toPinyin = null;
      if (isZh) { try { toPinyin = require('pinyin-pro').pinyin; } catch { /* lib absente */ } }
      for (const w of notOwned) {
        // On cible le lexème de la langue APPRISE du concept (le contenu du pack) :
        // c'est lui que le créateur possédera et que verront les apprenants de la
        // même langue. (En zh c'est le hanzi ; en fr/en c'est le mot latin.)
        // Rapprochement insensible à la casse/espaces (comme syncConceptSiblings)
        // pour RÉUTILISER un lexème existant ("Bonjour") plutôt que d'en dupliquer
        // un ("bonjour"). Sans effet en zh (les hanzi n'ont pas de casse).
        const found = await client.query(
          'SELECT id FROM mots WHERE lower(btrim(chinese)) = lower(btrim($1)) AND lang = $2 ORDER BY id LIMIT 1',
          [w, content]);
        let motId;
        if (found.rows.length) {
          motId = found.rows[0].id;
        } else {
          const english = String(translations[w] || '').trim();
          if (!english) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Add a translation for ${w}.`, needsTranslation: [w] });
          }
          const pinyin = toPinyin ? toPinyin(w, { toneType: 'symbol' }) : null;
          const ins = await client.query('INSERT INTO mots (chinese, pinyin, lang) VALUES ($1, $2, $3) RETURNING id', [w, pinyin, content]);
          motId = ins.rows[0].id;
          // Mot NEUF → boîte de sens PROPRE (pas de merge-on-save) : ne pas absorber
          // un concept existant qui partagerait une glose ni contaminer des mots corrects.
          await syncConceptSiblings(client, motId, english, other, { freshBox: true, userId: req.tokenUser.id });
        }
        ownedMap.set(w, motId);
      }
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [cost, uid]);
      await client.query(
        `INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, 'capture_word', $3)`,
        [uid, -cost, `Acquired ${notOwned.length} word(s) for a pack`]);
    }

    // Applique les traductions saisies dans la popup à TOUS les mots du pack
    // (mots déjà en base compris) : remplit celles qui manquaient et enregistre
    // les corrections de l'utilisateur. On ne touche qu'aux mots dont la glose
    // fournie diffère de la traduction actuelle (évite de churner le graphe).
    if (other && other !== content) {
      const uniqIds = [...new Set(words.map((w) => ownedMap.get(w)).filter(Boolean))];
      const curTr = new Map();
      const meaningOf = new Map();
      if (uniqIds.length) {
        const { rows: cur } = await client.query(
          `SELECT m.id,
                  COALESCE(m.meaning_id, (SELECT min(meaning_id) FROM lexeme_senses ls WHERE ls.mot_id = m.id)) AS meaning_id,
                  mot_tr(m.id, $2) AS english
           FROM mots m WHERE m.id = ANY($1::int[])`,
          [uniqIds, other]);
        cur.forEach((r) => { curTr.set(r.id, r.english || ''); meaningOf.set(r.id, r.meaning_id); });
      }
      // Même découpe que syncConceptSiblings → « a; b » et « a / b » sont vus égaux
      // (pas de re-churn du graphe si seule la ponctuation de séparation diffère).
      const norm = (s) => splitSenses(s).map((x) => x.toLowerCase()).sort().join('/');
      for (const w of words) {
        const motId = ownedMap.get(w);
        const gloss = String(translations[w] || '').trim();
        if (!motId || !gloss) continue;
        if (norm(gloss) === norm(curTr.get(motId))) continue; // inchangé → on n'y touche pas
        // Cible le SENS primaire du mot : remplir/corriger sa traduction (dans la
        // langue non-zh de la paire) sans fabriquer de sens orphelin.
        const meaningId = meaningOf.get(motId) || null;
        await syncConceptSiblings(client, motId, gloss, other, { replace: true, meaningId, userId: req.tokenUser.id });
      }
    }

    // Le CRÉATEUR possède chaque concept du pack DANS SA LANGUE APPRISE (visible
    // dans sa collection), pour TOUS les mots — y compris ceux qu'il "possédait"
    // déjà en zh. Sinon un apprenant occidental ne voit pas son propre pack
    // (collection filtrée sur learning_lang) car aucun lexème de sa langue apprise
    // n'aurait été capturé. Idempotent (ON CONFLICT DO NOTHING).
    for (const w of words) {
      const motId = ownedMap.get(w);
      if (!motId) continue;
      const lr = await client.query(
        `SELECT learn.id, ls.meaning_id
           FROM lexeme_senses a
           JOIN lexeme_senses ls ON ls.meaning_id = a.meaning_id
           JOIN mots learn ON learn.id = ls.mot_id AND learn.lang = $2
         WHERE a.mot_id = $1 ORDER BY learn.id LIMIT 1`, [motId, langs.learning]);
      if (!lr.rows.length) continue; // pas de lexème dans la langue apprise → rien à capturer
      await client.query(
        `INSERT INTO user_mots (user_id, mot_id, meaning_id, score)
         VALUES ($1, $2, $3, 0) ON CONFLICT DO NOTHING`,
        [uid, lr.rows[0].id, lr.rows[0].meaning_id]);
    }

    let packId;
    if (editId) {
      // Édition : met à jour les métadonnées et remplace la liste de mots.
      await client.query(
        'UPDATE word_packs SET title = $1, description = $2, price = $3 WHERE id = $4',
        [title, description || null, price, editId]);
      await client.query('DELETE FROM word_pack_items WHERE pack_id = $1', [editId]);
      packId = editId;
    } else {
      // Paire du pack = content (langue apprise) ↔ other (langue connue). Le store
      // filtre sur cette paire dans les DEUX sens (réciprocité) et l'affichage est
      // orienté viewer. Ex. pack fr↔en visible par les apprenants fr-depuis-en ET
      // en-depuis-fr, chacun voyant sa langue apprise à gauche.
      const { rows: pk } = await client.query(
        `INSERT INTO word_packs (creator_id, title, description, price, cover_key, is_official, published, lang, native_lang)
         VALUES ($1, $2, $3, $4, 'user', FALSE, TRUE, $5, $6) RETURNING id`,
        [uid, title, description || null, price, content, other]);
      packId = pk[0].id;
    }
    const motIds = words.map((w) => ownedMap.get(w));
    await client.query(
      `INSERT INTO word_pack_items (pack_id, mot_id) SELECT $1, UNNEST($2::int[]) ON CONFLICT DO NOTHING`,
      [packId, motIds]);

    // Propagation des mises à jour aux acheteurs : l'achat d'un pack donne droit
    // à ses évolutions. On ajoute à la collection de chaque acheteur les mots du
    // pack qu'il ne possède pas encore (les mots retirés du pack lui restent : on
    // n'enlève jamais un mot déjà étudié). Sur édition uniquement (à la création
    // il n'y a pas encore d'acheteurs).
    let propagated = 0;
    if (editId) {
      const prop = await client.query(
        `INSERT INTO user_mots (user_id, mot_id, meaning_id, score, nb_quiz, nb_correct, last_seen)
         SELECT pp.buyer_id, wpi.mot_id, (SELECT min(meaning_id) FROM lexeme_senses WHERE mot_id = wpi.mot_id), 0, 0, 0, NULL
         FROM pack_purchases pp
         JOIN word_pack_items wpi ON wpi.pack_id = pp.pack_id
         WHERE pp.pack_id = $1
           AND EXISTS (SELECT 1 FROM lexeme_senses WHERE mot_id = wpi.mot_id)
           AND NOT EXISTS (SELECT 1 FROM user_mots um WHERE um.user_id = pp.buyer_id AND um.mot_id = wpi.mot_id)
         ON CONFLICT DO NOTHING`,
        [editId]);
      propagated = prop.rowCount;
    }

    await client.query('COMMIT');
    res.json({ success: true, id: packId, wordCount: motIds.length, acquired: notOwned.length, edited: !!editId, propagated });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/market create error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

// ── GET /api/m/market/my-packs : packs créés par l'utilisateur ───────────────
router.get('/api/m/market/my-packs', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT wp.id, wp.title, wp.description, wp.price, wp.published, wp.sales_count,
              (SELECT COUNT(*) FROM word_pack_items i WHERE i.pack_id = wp.id)::int AS word_count
       FROM word_packs wp
       WHERE wp.creator_id = $1
       ORDER BY wp.created_at DESC`, [req.tokenUser.id]);
    res.json({ packs: rows });
  } catch (e) {
    console.error('m/market my-packs error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/market/purchased-packs : packs achetés par l'utilisateur ──────
router.get('/api/m/market/purchased-packs', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT wp.id, wp.title, wp.price, wp.cover_key,
              COALESCE(u.name, wp.creator_name, 'Anonymous') AS creator,
              (SELECT COUNT(*) FROM word_pack_items i WHERE i.pack_id = wp.id)::int AS word_count
       FROM pack_purchases pp
       JOIN word_packs wp ON wp.id = pp.pack_id
       LEFT JOIN users u ON u.id = wp.creator_id
       WHERE pp.buyer_id = $1
       ORDER BY pp.created_at DESC`, [req.tokenUser.id]);
    res.json({ packs: rows });
  } catch (e) {
    console.error('m/market purchased-packs error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /api/m/market/packs/:id : éditer un pack (titre/description/prix) ─────
router.put('/api/m/market/packs/:id', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid pack' });
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const price = parseInt(req.body?.price, 10);
    if (!title || title.length > 80) return res.status(400).json({ error: 'Title is required (max 80 characters).' });
    if (description.length > 300) return res.status(400).json({ error: 'Description is too long (max 300 characters).' });
    if (!Number.isInteger(price) || price < 0 || price > 100000) return res.status(400).json({ error: 'Enter a valid price.' });

    const { rowCount } = await pool.query(
      `UPDATE word_packs SET title = $1, description = $2, price = $3
       WHERE id = $4 AND creator_id = $5`,
      [title, description || null, price, id, uid]);
    if (!rowCount) return res.status(404).json({ error: 'Pack not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('m/market update error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/m/market/packs/:id : supprimer un pack (créateur) ─────────────
router.delete('/api/m/market/packs/:id', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid pack' });
    // items + purchases suivent via ON DELETE CASCADE ; les mots déjà achetés
    // restent dans les collections (user_mots n'est pas lié au pack).
    const { rowCount } = await pool.query(
      'DELETE FROM word_packs WHERE id = $1 AND creator_id = $2', [id, uid]);
    if (!rowCount) return res.status(404).json({ error: 'Pack not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('m/market delete error:', e);
    res.status(500).json({ error: 'Server error' });
  }
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

// ══ Red envelopes (虹包) : virements de coins ═════════════════════════════════

// ── GET /api/m/users/search?q= : trouver un destinataire (par nom) ───────────
router.get('/api/m/users/search', requireToken, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 1) return res.json({ users: [] });
    const { rows } = await pool.query(
      `SELECT id, name FROM users
       WHERE name ILIKE $1 AND id <> $2 AND ghost_mode = FALSE
       ORDER BY name ASC LIMIT 8`,
      [`%${q}%`, req.tokenUser.id]);
    res.json({ users: rows });
  } catch (e) {
    console.error('m/users search error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/bank/red-envelope : envoyer un virement ──────────────────────
router.post('/api/m/bank/red-envelope', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  // Gate anti-faux-comptes : envoyer des coins exige un email vérifié.
  if (!(await isVerified(uid))) return verifyRequired(res);
  const recipientId = parseInt(req.body?.recipientId, 10);
  const amount = parseInt(req.body?.amount, 10);
  const message = String(req.body?.message || '').trim().slice(0, 140) || null;

  if (!recipientId || recipientId === uid) return res.status(400).json({ error: 'Pick a friend to send to.' });
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100000) return res.status(400).json({ error: 'Enter a valid amount.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: rcpt } = await client.query('SELECT id, name FROM users WHERE id = $1', [recipientId]);
    if (!rcpt.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Recipient not found.' }); }

    const { rows: me } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [uid]);
    if ((me[0]?.balance ?? 0) < amount) { await client.query('ROLLBACK'); return res.status(402).json({ error: 'Not enough coins.', insufficient: true, cost: amount, balance: me[0]?.balance ?? 0 }); }

    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amount, uid]);
    await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, recipientId]);
    await client.query(
      `INSERT INTO red_envelopes (sender_id, recipient_id, amount, message) VALUES ($1, $2, $3, $4)`,
      [uid, recipientId, amount, message]);
    const { rows: sender } = await client.query('SELECT name FROM users WHERE id = $1', [uid]);
    await client.query(
      `INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, 'red_envelope_sent', $3)`,
      [uid, -amount, `Red envelope to ${rcpt[0].name || 'a friend'}`]);
    await client.query(
      `INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, 'red_envelope_received', $3)`,
      [recipientId, amount, `Red envelope from ${sender[0]?.name || 'a friend'}`]);
    await client.query('COMMIT');
    notify(recipientId, 'red_envelope', 'Red envelope received 🧧', `${sender[0]?.name || 'A friend'} sent you ${amount} ₵.`, {});
    res.json({ success: true, newBalance: (me[0].balance - amount) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/red-envelope send error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

// ── GET /api/m/red-envelopes/unseen : à révéler à la prochaine connexion ─────
router.get('/api/m/red-envelopes/unseen', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT re.id, re.amount, re.message, re.created_at, COALESCE(s.name, 'A friend') AS sender_name
       FROM red_envelopes re
       LEFT JOIN users s ON s.id = re.sender_id
       WHERE re.recipient_id = $1 AND re.seen = FALSE
       ORDER BY re.created_at ASC`, [req.tokenUser.id]);
    res.json({ envelopes: rows });
  } catch (e) {
    console.error('m/red-envelopes unseen error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/red-envelopes/seen : marquer comme vues ──────────────────────
router.post('/api/m/red-envelopes/seen', requireToken, async (req, res) => {
  try {
    await pool.query('UPDATE red_envelopes SET seen = TRUE WHERE recipient_id = $1 AND seen = FALSE', [req.tokenUser.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('m/red-envelopes seen error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══ Notifications in-app (centre 🔔) ══════════════════════════════════════════

// Insère une notification (best-effort, ne bloque jamais l'action déclenchante).
async function notify(userId, type, title, body = null, data = null) {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1, $2, $3, $4, $5)`,
      [userId, type, title, body, data ? JSON.stringify(data) : null]);
  } catch (e) { console.error('notify error:', e.message); }
  // Push natif (Expo) — fire-and-forget, gated par le token + le réglage user.
  sendExpoPush(userId, { title, body: body || '', data: { type, ...(data || {}) } }).catch(() => {});
}

// ── POST /api/m/admin/reconcile-packs : re-synchronise les packs HSK (admin) ──
// À appeler après avoir mis à jour la base HSK (mots) pour rafraîchir les packs
// sans redéployer. Réservé à l'admin (ADMIN_EMAIL).
router.post('/api/m/admin/reconcile-packs', requireToken, async (req, res) => {
  const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'locochet.08@gmail.com').toLowerCase();
  if ((req.tokenUser.email || '').toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const r = await reconcileHskPacks();
    res.json({ ok: true, counts: r.counts });
  } catch (e) {
    console.error('m/admin reconcile-packs error:', e);
    res.status(500).json({ error: 'Reconcile failed' });
  }
});

// ── POST /api/m/push-token : enregistre le token Expo Push de l'appareil ─────
router.post('/api/m/push-token', requireToken, async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Missing token' });
    await pool.query('UPDATE users SET expo_push_token = $1 WHERE id = $2', [token, req.tokenUser.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('m/push-token error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/notifications : liste récente + nombre de non-lues ─────────────
router.get('/api/m/notifications', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const [list, unread] = await Promise.all([
      pool.query(
        `SELECT id, type, title, body, data, read, created_at
         FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 40`, [uid]),
      pool.query('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read = FALSE', [uid]),
    ]);
    res.json({ notifications: list.rows, unread: unread.rows[0].n });
  } catch (e) {
    console.error('m/notifications error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/notifications/read : marque tout comme lu ─────────────────────
router.post('/api/m/notifications/read', requireToken, async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE', [req.tokenUser.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('m/notifications read error:', e);
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
    const nat = (await getUserLangs(uid)).native;

    const [lrows, words] = await Promise.all([
      pool.query(
        `SELECT l.id, l.title, l.summary, l.created_at, c.name AS class_name
         FROM lessons l JOIN classrooms c ON c.id = l.classroom_id WHERE l.id = $1`, [lessonId]),
      pool.query(
        `SELECT m.id, m.chinese, m.pinyin, mot_tr(m.id, $2) AS english
         FROM lesson_words lw JOIN mots m ON m.id = lw.mot_id
         WHERE lw.lesson_id = $1 ORDER BY lw.id ASC`, [lessonId, nat]),
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
      `INSERT INTO user_mots (user_id, mot_id, meaning_id)
       SELECT $1, m, (SELECT min(meaning_id) FROM lexeme_senses WHERE mot_id = m)
       FROM unnest($2::int[]) AS m
       WHERE EXISTS (SELECT 1 FROM lexeme_senses WHERE mot_id = m)
         AND NOT EXISTS (SELECT 1 FROM user_mots WHERE user_id = $1 AND mot_id = m)
       ON CONFLICT DO NOTHING`,
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
    // Stats scopées au PARCOURS ACTIF (learning_lang) — sauf le calendrier
    // d'activité (contributions) qui reste GLOBAL (jours travaillés, tous cours).
    const L = (await getUserLangs(uid)).learning;
    const [me, wordRows, quizzes, duels, contrib, recent, duelRank] = await Promise.all([
      pool.query('SELECT name, balance, tagline, country, quiz_direction, learning_lang, native_lang, avatar_icon, avatar_color FROM users WHERE id = $1', [uid]),
      pool.query(
        `SELECT um.score, um.score_character, um.score_reading, m.hsk
         FROM user_mots um JOIN mots m ON m.id = um.mot_id
         WHERE um.user_id = $1 AND m.lang = $2`, [uid, L]),
      pool.query('SELECT COUNT(*)::int AS n FROM quiz_history WHERE user_id = $1 AND lang = $2', [uid, L]),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM duels
         WHERE (challenger_id = $1 OR opponent_id = $1) AND status = 'completed' AND lang = $2`, [uid, L]),
      // Calendrier d'activité : GLOBAL (tous parcours confondus).
      pool.query(
        `SELECT DATE(date_completed) AS date, COUNT(*) AS count
         FROM quiz_history
         WHERE user_id = $1 AND EXTRACT(YEAR FROM date_completed) = $2
         GROUP BY DATE(date_completed) ORDER BY date ASC`, [uid, year]),
      pool.query(
        `SELECT score, total_questions, ratio, quiz_type, date_completed
         FROM quiz_history WHERE user_id = $1 AND lang = $2
         ORDER BY date_completed DESC LIMIT 5`, [uid, L]),
      // Rang au classement des duels = position par victoires, DANS le même cours
      // (cohérent avec le leaderboard, lui aussi par learning_lang).
      pool.query(
        `WITH wins AS (
           SELECT winner_id AS uid, COUNT(*)::int AS w
           FROM duels WHERE status = 'completed' AND winner_id IS NOT NULL AND lang = $2
           GROUP BY winner_id
         ), ranked AS (
           SELECT uid, RANK() OVER (ORDER BY w DESC) AS rank FROM wins
         )
         SELECT r.rank::int AS rank, (SELECT COUNT(*) FROM wins)::int AS total
         FROM ranked r WHERE r.uid = $1`, [uid, L]),
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
    const readingDist = bucket(words.map((w) => w.score_reading || 0));

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
      avatar_icon: me.rows[0]?.avatar_icon || null,
      avatar_color: me.rows[0]?.avatar_color || null,
      quizDirection: me.rows[0]?.quiz_direction || 'en→zh',
      learning_lang: me.rows[0]?.learning_lang || 'zh',
      native_lang: me.rows[0]?.native_lang || 'en',
      balance: me.rows[0]?.balance || 0,
      words: words.length,
      wordsKnown: pinyinDist.mastered,
      quizzes: quizzes.rows[0].n,
      duels: duels.rows[0].n,
      duelRank: duelRank.rows[0]?.rank || null,
      duelRankTotal: duelRank.rows[0]?.total || 0,
      mastery: { pinyin: pinyinDist, character: charDist, reading: readingDist, total: words.length },
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
// Allowlists avatar : DOIVENT rester synchro avec mobile/src/components/Avatar.js.
const AVATAR_ICONS = ['happy', 'paw', 'rocket', 'planet', 'flame', 'flash', 'star', 'heart', 'leaf', 'musical-notes', 'football', 'game-controller', 'fish', 'diamond', 'moon', 'sunny'];
const AVATAR_COLORS = ['#0d6efd', '#6f42c1', '#e83e8c', '#dc3545', '#fd7e14', '#f7b500', '#198754', '#20c997', '#0dcaf0', '#495057'];

router.put('/api/m/account', requireToken, async (req, res) => {
  try {
    const { name, tagline, country, avatar_icon, avatar_color } = req.body || {};
    if (!name || String(name).length > 50) {
      return res.status(400).json({ error: 'Name is required (max 50 characters)' });
    }
    if (tagline && String(tagline).length > 100) {
      return res.status(400).json({ error: 'Tagline must be under 100 characters' });
    }
    const code = country ? String(country).toUpperCase().slice(0, 2) : null;
    // Avatar validé contre l'allowlist (null = pas d'avatar / repli initiale).
    const icon = AVATAR_ICONS.includes(avatar_icon) ? avatar_icon : null;
    const color = AVATAR_COLORS.includes(avatar_color) ? avatar_color : null;
    await pool.query(
      `UPDATE users SET name = $1, tagline = $2, country = $3, avatar_icon = $4, avatar_color = $5 WHERE id = $6`,
      [String(name).trim(), tagline ? String(tagline).trim() : null, code, icon, color, req.tokenUser.id]
    );
    res.json({ success: true, name: String(name).trim(), tagline: tagline || null, country: code, avatar_icon: icon, avatar_color: color });
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

    // Stats scopées au parcours actif du user consulté (cohérent avec /account).
    const L = (await getUserLangs(targetId)).learning;
    const [me, wordRows, quizzes, duels] = await Promise.all([
      pool.query('SELECT id, name, tagline, country, avatar_icon, avatar_color, created_at FROM users WHERE id = $1', [targetId]),
      pool.query(
        `SELECT um.score, um.score_character, um.score_reading, m.hsk
         FROM user_mots um JOIN mots m ON m.id = um.mot_id
         WHERE um.user_id = $1 AND m.lang = $2`, [targetId, L]),
      pool.query('SELECT COUNT(*)::int AS n FROM quiz_history WHERE user_id = $1 AND lang = $2', [targetId, L]),
      pool.query(
        `SELECT COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE winner_id = $1)::int AS wins,
                COUNT(*) FILTER (WHERE winner_id IS NOT NULL AND winner_id <> $1)::int AS losses
         FROM duels
         WHERE (challenger_id = $1 OR opponent_id = $1) AND status = 'completed' AND lang = $2`, [targetId, L]),
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
    const readingDist = bucket(words.map((w) => w.score_reading || 0));

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
      avatar_icon: u.avatar_icon || null,
      avatar_color: u.avatar_color || null,
      created_at: u.created_at instanceof Date ? u.created_at.toISOString() : (u.created_at || null),
      isMe: u.id === uid,
      words: words.length,
      quizzes: quizzes.rows[0].n,
      duels: duels.rows[0].n,
      wins: duels.rows[0].wins,
      losses: duels.rows[0].losses,
      ratio: (duels.rows[0].wins + duels.rows[0].losses) > 0
        ? Math.round((duels.rows[0].wins / (duels.rows[0].wins + duels.rows[0].losses)) * 100) : 0,
      mastery: { pinyin: pinyinDist, character: charDist, reading: readingDist, total: words.length },
      learning_lang: L,
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
      `SELECT quiz_direction, interface_lang, learning_lang, native_lang, ghost_mode,
              notifications_enabled, word_review_enabled
       FROM users WHERE id = $1`, [req.tokenUser.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const u = rows[0];
    res.json({
      quiz_direction: u.quiz_direction || 'en→zh',
      learning_lang: u.learning_lang || 'zh',
      native_lang: u.native_lang || 'en',
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

    // Langues du cours : la vérité est `learning_paths`. Toute demande de changement
    // de paire passe par setActiveLangs (parcours + pointeur + miroir), JAMAIS par
    // une écriture directe de users.* → plus de contradiction possible. On ne
    // touche pas non plus quiz_direction ici (dérivé). Le reste (toggles) suit.
    let langsChanged = false;
    if (body.learning_lang !== undefined || body.native_lang !== undefined) {
      const cur = await pool.query('SELECT learning_lang, native_lang FROM users WHERE id = $1', [req.tokenUser.id]);
      const c = cur.rows[0] || {};
      await setActiveLangs(
        req.tokenUser.id,
        body.learning_lang !== undefined ? body.learning_lang : c.learning_lang,
        body.native_lang !== undefined ? body.native_lang : c.native_lang,
      );
      langsChanged = true;
    }
    if (body.interface_lang !== undefined) {
      if (!['en', 'zh', 'fr'].includes(body.interface_lang)) {
        return res.status(400).json({ error: 'Invalid language' });
      }
      push('interface_lang', body.interface_lang);
    }
    if (typeof body.ghost_mode === 'boolean') {
      // Ghost mode réservé au premium (on autorise toujours la DÉSACTIVATION).
      if (body.ghost_mode && !(await isUserPremium(req.tokenUser.id))) {
        return res.status(403).json({ error: 'Ghost mode is Premium.', upgradeRequired: true, feature: 'ghost' });
      }
      push('ghost_mode', body.ghost_mode);
    }
    if (typeof body.notifications_enabled === 'boolean') push('notifications_enabled', body.notifications_enabled);
    if (typeof body.word_review_enabled === 'boolean') push('word_review_enabled', body.word_review_enabled);

    if (!sets.length) {
      if (langsChanged) return res.json({ success: true });
      return res.status(400).json({ error: 'No valid fields' });
    }

    params.push(req.tokenUser.id);
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    res.json({ success: true });
  } catch (e) {
    console.error('m/settings patch error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/languages : langues apprenables (réactif) ──────────────────────
// Renvoie les langues ENREGISTRÉES (table languages, alimentée par le trigger dès
// qu'un mot d'une nouvelle langue est inséré) qui ont du contenu. Métadonnées
// enrichies depuis LANG_CATALOG (fallback : la ligne DB, puis le code brut). Le
// front consomme cette liste → une nouvelle langue apparaît sans toucher au code.
router.get('/api/m/languages', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.code, l.name, l.endonym, l.has_pinyin, l.tts
       FROM languages l
       WHERE l.learnable = TRUE AND EXISTS (SELECT 1 FROM mots m WHERE m.lang = l.code)
       ORDER BY (l.code = 'zh') DESC, (l.code = 'en') DESC, l.code`);
    const languages = rows.map((r) => {
      const cat = LANG_CATALOG[r.code] || {};
      return {
        code: r.code,
        name: r.name || cat.name || r.code,
        endonym: r.endonym || cat.endonym || r.code,
        has_pinyin: r.has_pinyin != null ? r.has_pinyin : !!cat.has_pinyin,
        tts: r.tts || cat.tts || null,
      };
    });
    res.json({ languages });
  } catch (e) {
    console.error('m/languages error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══ Learning paths : parcours d'apprentissage multi-langues ═══════════════════
// Un parcours = (learning_lang, native_lang, title). Le parcours ACTIF est celui
// dont learning_lang == users.learning_lang (dérivé). La collection est déjà
// scindée par mots.lang = learning_lang → basculer un parcours = changer la paire.

// ── GET /api/m/learning-paths : liste les parcours du user ────────────────────
router.get('/api/m/learning-paths', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const { rows } = await pool.query(
      `SELECT lp.id, lp.learning_lang, lp.native_lang, lp.title,
              (lp.id = u.active_path_id) AS is_active,
              (SELECT COUNT(*)::int FROM user_mots um JOIN mots m ON m.id = um.mot_id
                 WHERE um.user_id = $1 AND m.lang = lp.learning_lang) AS word_count
       FROM learning_paths lp JOIN users u ON u.id = lp.user_id
       WHERE lp.user_id = $1
       ORDER BY lp.created_at ASC, lp.id ASC`, [uid]);
    res.json({ paths: rows });
  } catch (e) {
    console.error('learning-paths list error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/learning-paths : créer un parcours (et l'activer aussitôt) ─────
router.post('/api/m/learning-paths', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    // Free : jusqu'à 2 parcours (le parcours par défaut compte). Au-delà = premium.
    // Premium : illimité. Basculer/éditer les parcours existants reste gratuit.
    if (!(await isUserPremium(uid))) {
      const { rows: cnt } = await pool.query('SELECT COUNT(*)::int AS n FROM learning_paths WHERE user_id = $1', [uid]);
      if (cnt[0].n >= 2) {
        return res.status(403).json({ error: 'Free accounts can have up to 2 learning paths. Upgrade for more.', upgradeRequired: true, feature: 'learning_path' });
      }
    }
    const { learning_lang, native_lang, title } = req.body || {};
    if (!(await ensureLearnable(learning_lang, native_lang))) {
      return res.status(400).json({ error: 'Invalid languages' });
    }
    const { learning, native } = resolveCourseLangs(learning_lang, native_lang);
    const cleanTitle = (typeof title === 'string' && title.trim()) ? title.trim().slice(0, 60) : null;
    // Un seul parcours par langue cible (la collection est scindée par learning_lang).
    const exists = await pool.query(
      'SELECT 1 FROM learning_paths WHERE user_id = $1 AND learning_lang = $2', [uid, learning]);
    if (exists.rows.length) {
      return res.status(409).json({ error: 'You already have a learning path for this language.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO learning_paths (user_id, learning_lang, native_lang, title)
       VALUES ($1, $2, $3, $4)
       RETURNING id, learning_lang, native_lang, title`, [uid, learning, native, cleanTitle]);
    const active = await setActiveLangs(uid, learning, native);
    res.json({ path: rows[0], active });
  } catch (e) {
    console.error('learning-paths create error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /api/m/learning-paths/:id : renommer / changer la base (PAS la cible) ─
router.patch('/api/m/learning-paths/:id', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid path' });
    const { rows: pr } = await pool.query(
      'SELECT * FROM learning_paths WHERE id = $1 AND user_id = $2', [id, uid]);
    if (!pr.length) return res.status(404).json({ error: 'Path not found' });
    const path = pr[0];
    const body = req.body || {};
    const sets = []; const params = [];
    const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (body.title !== undefined) {
      push('title', (typeof body.title === 'string' && body.title.trim()) ? body.title.trim().slice(0, 60) : null);
    }
    let newNative = null;
    if (body.native_lang !== undefined) {
      if (!(await ensureLearnable(body.native_lang))) return res.status(400).json({ error: 'Invalid language' });
      // La direction (langue apprise) est verrouillée → la base ne peut pas l'égaler.
      if (body.native_lang === path.learning_lang) {
        return res.status(400).json({ error: 'Base language cannot equal the learned language.' });
      }
      newNative = body.native_lang;
      push('native_lang', newNative);
    }
    // learning_lang volontairement ignoré (direction non modifiable).
    if (!sets.length) return res.status(400).json({ error: 'No valid fields' });
    params.push(id);
    await pool.query(`UPDATE learning_paths SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

    // Si c'est le parcours actif et que la base change → répercute sur users.
    let active = null;
    const langs = await getUserLangs(uid);
    if (newNative && langs.learning === path.learning_lang) {
      active = await setActiveLangs(uid, path.learning_lang, newNative);
    }
    res.json({ success: true, active });
  } catch (e) {
    console.error('learning-paths patch error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/learning-paths/:id/activate : basculer sur ce parcours ─────────
router.post('/api/m/learning-paths/:id/activate', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid path' });
    const { rows } = await pool.query(
      'SELECT learning_lang, native_lang FROM learning_paths WHERE id = $1 AND user_id = $2', [id, uid]);
    if (!rows.length) return res.status(404).json({ error: 'Path not found' });
    const active = await setActiveLangs(uid, rows[0].learning_lang, rows[0].native_lang);
    res.json({ success: true, active });
  } catch (e) {
    console.error('learning-paths activate error:', e);
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
    const langs = await getUserLangs(uid);
    const [pending, stats, recent, bullies, wordsRow] = await Promise.all([
      pool.query(
        `SELECT d.id, d.bet_amount, d.status, d.created_at,
                u1.name AS challenger_name, u2.name AS opponent_name,
                CASE WHEN d.challenger_id = $1 THEN u2.avatar_icon ELSE u1.avatar_icon END AS opponent_avatar_icon,
                CASE WHEN d.challenger_id = $1 THEN u2.avatar_color ELSE u1.avatar_color END AS opponent_avatar_color,
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
                CASE WHEN d.challenger_id = $1 THEN u2.avatar_icon ELSE u1.avatar_icon END AS opponent_avatar_icon,
                CASE WHEN d.challenger_id = $1 THEN u2.avatar_color ELSE u1.avatar_color END AS opponent_avatar_color,
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
      // Taille de la collection (langue apprise) → gate "trop peu de mots" côté client.
      pool.query(
        `SELECT COUNT(*)::int AS words FROM user_mots um JOIN mots m ON m.id = um.mot_id
         WHERE um.user_id = $1 AND m.lang = $2`, [uid, langs.learning]),
    ]);
    res.json({
      pending: pending.rows,
      wins: stats.rows[0]?.wins || 0,
      losses: stats.rows[0]?.losses || 0,
      recent: recent.rows,
      bullies: bullies.rows,
      words: wordsRow.rows[0]?.words || 0,
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
      `SELECT u.id, u.name, u.tagline, u.country, u.avatar_icon, u.avatar_color,
         COUNT(*) FILTER (WHERE d.winner_id = u.id)::int AS wins,
         COUNT(*) FILTER (WHERE d.status = 'completed' AND d.winner_id IS NOT NULL
           AND d.winner_id <> u.id)::int AS losses,
         (SELECT COUNT(*)::int FROM user_mots um WHERE um.user_id = u.id) AS total_words,
         (u.last_login IS NOT NULL AND u.last_login >= NOW() - INTERVAL '14 days') AS active
       FROM users u
       LEFT JOIN duels d ON (d.challenger_id = u.id OR d.opponent_id = u.id) AND d.status = 'completed'
       WHERE u.learning_lang = (SELECT learning_lang FROM users WHERE id = $1)
         AND u.ghost_mode = FALSE AND u.role <> 'teacher'
         AND u.name IS NOT NULL AND TRIM(u.name) <> ''
       GROUP BY u.id, u.name, u.tagline, u.country, u.avatar_icon, u.avatar_color, u.last_login
       ORDER BY active DESC, wins DESC, losses ASC, total_words DESC, u.id
       LIMIT 100`, [uid]);
    const leaderboard = rows.map((r) => {
      const played = r.wins + r.losses;
      const { active, ...rest } = r;
      return { ...rest, ratio: played > 0 ? Math.round((r.wins / played) * 100) : 0, sleeping: !active, isMe: r.id === uid };
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
    // Lien vers l'app web RN (app.jiayou.fr) qui capte ?ref= ; jiayou.fr est le
    // site vitrine et n'embarque pas la logique de parrainage.
    const base = process.env.APP_WEB_URL || 'https://app.jiayou.fr';
    res.json({ code, link: `${base}/?ref=${encodeURIComponent(code)}` });
  } catch (e) {
    console.error('m/referral error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/referral/check?code= : valide un code saisi à l'inscription ────
// PUBLIC (pas de requireToken) : le champ « code » vit sur l'écran de connexion,
// AVANT que le compte (donc le token) n'existe. Renvoie { valid, name } pour un
// feedback live. L'auto-parrainage est de toute façon bloqué côté serveur au
// moment du crédit (creditReferralByCode, id !== userId).
router.get('/api/m/referral/check', async (req, res) => {
  try {
    const norm = String(req.query.code || '').trim().toUpperCase();
    if (!norm) return res.json({ valid: false });
    const r = await pool.query(
      'SELECT name FROM users WHERE upper(referral_code) = $1', [norm]);
    if (!r.rows.length) return res.json({ valid: false });
    const first = (r.rows[0].name || '').trim().split(' ')[0] || null;
    res.json({ valid: true, name: first });
  } catch (e) {
    console.error('m/referral/check error:', e);
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
         AND learning_lang = (SELECT learning_lang FROM users WHERE id = $2)
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
         AND o.learning_lang = (SELECT learning_lang FROM users WHERE id = $1)
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

  // Limite gratuite : N duel lancé par jour (le premium lève la limite).
  if (!(await isUserPremium(challengerId))) {
    const today = await countToday('duels', 'challenger_id', 'created_at', challengerId);
    if (today >= FREE_LIMITS.duelPerDay) {
      return res.status(403).json({
        error: `Daily duel limit reached (${FREE_LIMITS.duelPerDay}/day on Free).`,
        limitReached: true, upgradeRequired: true, feature: 'duel',
      });
    }
  }

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

    const duelLang = (await getUserLangs(challengerId)).learning; // cours du défi (2 joueurs même langue)
    const ins = await client.query(
      `INSERT INTO duels
        (challenger_id, opponent_id, duel_type, word_count, quiz_type, quiz_data, bet_amount, status, lang)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8) RETURNING id`,
      [challengerId, opponent_id, duel_type, word_count, quiz_type, JSON.stringify(quizData), bet, duelLang]
    );
    await client.query('COMMIT');
    const newDuelId = ins.rows[0].id;
    // Notif "nouveau duel" pour l'adversaire (best-effort).
    if (opponent_id && opponent_id !== challengerId) {
      pool.query('SELECT name FROM users WHERE id = $1', [challengerId])
        .then((r) => notify(opponent_id, 'duel_new', 'New duel ⚔️', `${r.rows[0]?.name || 'Someone'} challenged you to a duel.`, { duelId: newDuelId }))
        .catch(() => {});
    }
    res.json({ success: true, duelId: newDuelId });
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
      `SELECT d.*, u1.name AS challenger_name, u2.name AS opponent_name,
              u1.avatar_icon AS challenger_avatar_icon, u1.avatar_color AS challenger_avatar_color,
              u2.avatar_icon AS opponent_avatar_icon, u2.avatar_color AS opponent_avatar_color
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
      opponent_avatar_icon: isChallenger ? d.opponent_avatar_icon : d.challenger_avatar_icon,
      opponent_avatar_color: isChallenger ? d.opponent_avatar_color : d.challenger_avatar_color,
      my_name: isChallenger ? d.challenger_name : d.opponent_name,
      my_avatar_icon: isChallenger ? d.challenger_avatar_icon : d.opponent_avatar_icon,
      my_avatar_color: isChallenger ? d.challenger_avatar_color : d.opponent_avatar_color,
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
    // Notifs de résultat pour les deux joueurs (best-effort).
    if (bothPlayed) {
      (async () => {
        const { rows: u } = await pool.query('SELECT id, name FROM users WHERE id = ANY($1::int[])', [[cur.challenger_id, cur.opponent_id]]);
        const nameOf = (pid) => u.find((x) => x.id === pid)?.name || 'your opponent';
        for (const pid of [cur.challenger_id, cur.opponent_id]) {
          const opp = pid === cur.challenger_id ? cur.opponent_id : cur.challenger_id;
          let title, body;
          if (winnerId === null) { title = 'Duel draw 🤝'; body = `Your duel with ${nameOf(opp)} ended in a draw.`; }
          else if (winnerId === pid) { title = 'You won your duel! 🏆'; body = `You beat ${nameOf(opp)}${cur.bet_amount > 0 ? ` — +${cur.bet_amount * 2} ₵` : ''}.`; }
          else { title = 'Duel lost 😔'; body = `${nameOf(opp)} beat you this time.`; }
          await notify(pid, 'duel_result', title, body, { duelId: id });
        }
      })().catch(() => {});
    }
    res.json({ success: true, duel_completed: bothPlayed, winner_id: winnerId, you_won: winnerId === uid });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/duel submit error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── GET /api/m/quiz/packs : packs entraînables (créés ∪ achetés) ─────────────
// word_count = mots du pack réellement possédés (donc quizzables).
router.get('/api/m/quiz/packs', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const { rows } = await pool.query(
      `SELECT wp.id, wp.title, wp.cover_key, wp.is_official,
              COALESCE(u.name, wp.creator_name, 'Anonymous') AS creator,
              (SELECT COUNT(*) FROM word_pack_items i
                 JOIN user_mots um ON um.mot_id = i.mot_id AND um.user_id = $1
               WHERE i.pack_id = wp.id)::int AS word_count,
              (SELECT COALESCE(ROUND(AVG(um.score)), 0) FROM word_pack_items i
                 JOIN user_mots um ON um.mot_id = i.mot_id AND um.user_id = $1
               WHERE i.pack_id = wp.id)::int AS mastery
       FROM word_packs wp
       LEFT JOIN users u ON u.id = wp.creator_id
       WHERE wp.creator_id = $1
          OR wp.id IN (SELECT pack_id FROM pack_purchases WHERE buyer_id = $1)
       ORDER BY wp.created_at DESC`, [uid]);
    res.json({ packs: rows.filter((p) => p.word_count > 0) });
  } catch (e) {
    console.error('m/quiz packs error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/quiz/words : mots pour un quiz scoré (type/count/hsk/difficulty) ─
// Reprend la logique de /quiz-mots : filtre HSK + plage de score selon la
// difficulté, avec élargissement progressif si pas assez de mots.
router.get('/api/m/quiz/words', requireToken, async (req, res) => {
  const userId = req.tokenUser.id;
  const requestedCount = parseInt(req.query.count, 10) || 10;
  const hskParam = req.query.hsk || 'all';
  // Niveaux de maîtrise sélectionnés (mêmes buckets que le filtre collection).
  const levelsParam = req.query.levels || '';
  const idsParam = req.query.ids; // liste explicite (quick quiz sur "Your difficulties")
  const packId = parseInt(req.query.packId, 10) || null; // entraînement sur un pack

  try {
    // Langue native → traduction dérivée du concept (mot_tr) dans les 3 requêtes.
    const langs = await getUserLangs(userId);
    // Limite gratuite : N quiz par jour (le premium lève la limite).
    if (!(await isUserPremium(userId))) {
      const today = await countToday('quiz_history', 'user_id', 'date_completed', userId);
      if (today >= FREE_LIMITS.quizPerDay) {
        return res.status(403).json({
          error: `Daily quiz limit reached (${FREE_LIMITS.quizPerDay}/day on Free).`,
          limitReached: true, upgradeRequired: true, feature: 'quiz',
        });
      }
    }

    // Mode pack : mots du pack que l'utilisateur possède. On mélange à chaque
    // partie tout en priorisant les mots les MOINS maîtrisés : tri aléatoire
    // pondéré par le score `RANDOM() * (score + K)` — un score bas tend à sortir
    // en premier (0 → intervalle [0..K]) mais avec de la variété (pas d'ordre figé,
    // pas toujours le même sous-ensemble). Score sur la bonne colonne selon le type.
    if (packId) {
      const type = String(req.query.type || 'pinyin');
      const scoreCol = type === 'character' ? 'score_character' : type === 'reading' ? 'score_reading' : 'score';
      const { rows } = await pool.query(
        `SELECT m.id, m.chinese, m.pinyin, mot_tr_sense(m.id, um.meaning_id, $4) AS english, m.hsk, COALESCE(um.${scoreCol}, 0) AS score
         FROM word_pack_items i
         JOIN user_mots um ON um.mot_id = i.mot_id AND um.user_id = $1
         JOIN mots m ON m.id = i.mot_id
         WHERE i.pack_id = $2 AND m.lang = $5
         ORDER BY RANDOM() * (COALESCE(um.${scoreCol}, 0) + 15)
         LIMIT $3`, [userId, packId, requestedCount, langs.native, langs.learning]);
      if (!rows.length) return res.status(400).json({ error: 'not_enough_words' });
      await pool.query('UPDATE user_mots SET last_seen = NOW() WHERE user_id = $1 AND mot_id = ANY($2)', [userId, rows.map((r) => r.id)]);
      return res.json({ words: rows, count: rows.length });
    }

    // Mode liste explicite : on renvoie exactement ces mots de la collection.
    if (idsParam) {
      const ids = String(idsParam).split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
      if (!ids.length) return res.status(400).json({ error: 'invalid_ids' });
      const { rows } = await pool.query(
        `SELECT m.id, m.chinese, m.pinyin, mot_tr_sense(m.id, um.meaning_id, $3) AS english, m.hsk, COALESCE(um.score, 0) AS score
         FROM user_mots um INNER JOIN mots m ON um.mot_id = m.id
         WHERE um.user_id = $1 AND m.id = ANY($2) AND m.lang = $4`, [userId, ids, langs.native, langs.learning]);
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
    // 2. Plages de score des niveaux de maîtrise sélectionnés (union). Aucun
    //    sélectionné → tous. Mêmes seuils que scorePicto / le filtre collection.
    const LEVEL_RANGES = { trophy: [90, 100], cool: [75, 89], ok: [50, 74], meh: [25, 49], seed: [0, 24] };
    const selectedLevels = String(levelsParam).split(',').map((s) => s.trim()).filter((k) => LEVEL_RANGES[k]);
    const ranges = selectedLevels.length ? selectedLevels.map((k) => LEVEL_RANGES[k]) : [[0, 100]];

    // 3. Une seule requête : mots dans l'union des plages de score + filtre HSK.
    const params = [userId, langs.native, langs.learning];
    const natIdx = 2;  // $2 : native pour mot_tr
    const learnIdx = 3; // $3 : langue apprise (filtre le cours)
    const scoreParts = ranges.map(([a, b]) => {
      params.push(a, b);
      return `COALESCE(um.score, 0) BETWEEN $${params.length - 1} AND $${params.length}`;
    });
    let q = `
      SELECT m.id, m.chinese, m.pinyin, mot_tr_sense(m.id, um.meaning_id, $${natIdx}) AS english, m.hsk, COALESCE(um.score, 0) AS score
      FROM user_mots um INNER JOIN mots m ON um.mot_id = m.id
      WHERE um.user_id = $1 AND m.lang = $${learnIdx} AND (${scoreParts.join(' OR ')})`;
    const hskConds = [];
    if (hskMin !== null && hskMax !== null) { params.push(hskMin, hskMax); hskConds.push(`m.hsk BETWEEN $${params.length - 1} AND $${params.length}`); }
    if (includeStreet) hskConds.push('m.hsk IS NULL');
    if (hskConds.length) q += ` AND (${hskConds.join(' OR ')})`;
    params.push(requestedCount);
    q += ` ORDER BY RANDOM() LIMIT $${params.length}`;
    const { rows: words } = await pool.query(q, params);

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
    const langs = await getUserLangs(req.tokenUser.id);
    const { rows } = await pool.query(
      `SELECT m.id, m.chinese, m.pinyin, mot_tr_sense(m.id, um.meaning_id, $2) AS english,
         CASE WHEN COALESCE(um.nb_quiz, 0) >= 2
              THEN (1.0 - (COALESCE(um.nb_correct, 0)::float / NULLIF(um.nb_quiz, 0)))
              ELSE 0.5 END AS error_rate
       FROM user_mots um JOIN mots m ON um.mot_id = m.id
       WHERE um.user_id = $1 AND m.lang = $3 AND um.nb_quiz > 0
         AND ((um.nb_quiz >= 2 AND (um.nb_correct::float / um.nb_quiz) < 0.6) OR COALESCE(um.score,0) < 50)
       ORDER BY error_rate DESC, COALESCE(um.score,0) ASC, um.last_seen ASC NULLS FIRST
       LIMIT 12`,
      [req.tokenUser.id, langs.native, langs.learning]
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
    const langs = await getUserLangs(uid);
    const [hist, words, me] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS quizzes,
                COALESCE(ROUND(AVG(ratio)), 0)::int AS avg_pct,
                COALESCE(ROUND(MAX(ratio)), 0)::int AS best_pct
         FROM quiz_history WHERE user_id = $1`, [uid]),
      pool.query(
        `SELECT COUNT(*)::int AS words,
                COUNT(*) FILTER (WHERE COALESCE(um.score, 0) >= 90)::int AS mastered
         FROM user_mots um JOIN mots m ON m.id = um.mot_id
         WHERE um.user_id = $1 AND m.lang = $2`, [uid, langs.learning]),
      pool.query('SELECT quiz_direction FROM users WHERE id = $1', [uid]),
    ]);
    res.json({
      quizzes: hist.rows[0].quizzes,
      avg: hist.rows[0].avg_pct,
      best: hist.rows[0].best_pct,
      words: words.rows[0].words,
      mastered: words.rows[0].mastered,
      direction: me.rows[0]?.quiz_direction || 'en→zh',
      learning_lang: langs.learning,
      native_lang: langs.native,
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
        // La récompense décroît avec la maîtrise DU MODE joué : chaque type de
        // quiz a sa propre colonne de score (pinyin='score', caractères=
        // 'score_character', lecture='score_reading' ; l'écriture EN/FR reste sur
        // 'score'). Même mapping que updateWordScore — sinon un quiz caractères/
        // lecture paierait selon la maîtrise pinyin. Colonne = littéral sûr.
        const scoreCol = quiz_type === 'character' ? 'score_character'
          : quiz_type === 'reading' ? 'score_reading'
          : 'score';
        const { rows: pre } = await client.query(
          `SELECT mot_id, COALESCE(${scoreCol}, 0) AS score FROM user_mots WHERE user_id = $1 AND mot_id = ANY($2)`,
          [userId, correctIds]
        );
        const byMot = {};
        pre.forEach((r) => { byMot[r.mot_id] = Number(r.score) || 0; });
        let raw = 0;
        for (const id of correctIds) {
          const s = byMot[id] ?? 0;
          if (s < 50) raw += 0.5; else if (s < 80) raw += 0.3; else raw += 0.1;
        }
        // Bonus : sens supplémentaires correctement donnés (mots à plusieurs
        // traductions) → 0.1 pièce chacun. Plafonné pour éviter tout abus.
        const bonusTotal = results.reduce((n, r) => n + (Number.isInteger(r?.bonus) && r.bonus > 0 ? Math.min(r.bonus, 5) : 0), 0);
        raw += bonusTotal * 0.1;
        coinsEarned = Math.round(raw);
      }
    }

    const wordsForHistory = Array.isArray(results) ? results.map((r) => r.pinyin) : [];
    const quizLang = (await getUserLangs(userId)).learning; // tag pour stats par parcours
    await client.query(
      `INSERT INTO quiz_history (user_id, score, total_questions, ratio, quiz_type, words_used, lang)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, scoreNum, totalNum, ratio, quiz_type, JSON.stringify(wordsForHistory), quizLang]
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
    const langs = await getUserLangs(req.tokenUser.id);
    const { rows } = await pool.query(
      `SELECT mots.id, mots.chinese, mots.pinyin, mot_tr_sense(mots.id, user_mots.meaning_id, $3) AS english, user_mots.score
       FROM mots JOIN user_mots ON mots.id = user_mots.mot_id
       WHERE user_mots.user_id = $1 AND mots.lang = $4
       ORDER BY user_mots.score ASC, RANDOM()
       LIMIT $2`, [req.tokenUser.id, count, langs.native, langs.learning]);
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
    const langs = await getUserLangs(req.tokenUser.id);
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
          await client.query('UPDATE mots SET pinyin = $1 WHERE id = $2', [pinyin, motId]);
          await syncConceptSiblings(client, motId, english, langs.native, { replace: true, userId: req.tokenUser.id });
        }
      } else {
        if (!english) continue;
        const ins = await client.query(
          `INSERT INTO mots (chinese, pinyin, lang) VALUES ($1, $2, $3) RETURNING id`,
          [chinese.slice(0, 50), pinyin, langs.learning]
        );
        motId = ins.rows[0].id;
        await syncConceptSiblings(client, motId, english, langs.native, { userId: req.tokenUser.id });
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
    const nat = (await getUserLangs(req.tokenUser.id)).native;
    const { rows: words } = await pool.query(
      `SELECT m.id, m.chinese, m.pinyin, mot_tr(m.id, $2) AS english
       FROM lesson_words lw JOIN mots m ON m.id = lw.mot_id
       WHERE lw.lesson_id = $1 ORDER BY lw.id ASC`, [lesson.id, nat]);
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
    const nat = (await getUserLangs(req.tokenUser.id)).native;
    const byKey = {};
    if (isZhEn) {
      // Le prof colle des termes anglais → on retrouve le mot zh via son lexème
      // frère 'en' partageant le concept (drop-safe, plus de colonne english).
      const { rows } = await pool.query(
        `SELECT z.id, z.chinese, z.pinyin, mot_tr(z.id, 'en') AS english, lower(e.chinese) AS matchkey
         FROM mots z
         JOIN lexeme_senses zs ON zs.mot_id = z.id
         JOIN lexeme_senses es ON es.meaning_id = zs.meaning_id
         JOIN mots e ON e.id = es.mot_id AND e.lang = 'en'
         WHERE z.lang = 'zh' AND lower(e.chinese) = ANY($1::text[])`,
        [cleaned.map((w) => w.toLowerCase())]
      );
      rows.forEach((r) => { byKey[r.matchkey] = r; });
      return res.json({ results: cleaned.map((w) => ({ input: w, mot: byKey[w.toLowerCase()] || null })) });
    }
    const { rows } = await pool.query(
      `SELECT id, chinese, pinyin, mot_tr(id, $2) AS english FROM mots WHERE chinese = ANY($1::text[])`, [cleaned, nat]
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

// Resync live d'un abonnement depuis Stripe → user_subscriptions. Fiabilité si
// le webhook n'est pas arrivé (annulation via le portail non répercutée). Lit la
// période au niveau item (API récente) avec fallback top-level. Renvoie l'état,
// ou null si l'utilisateur n'a pas d'abonnement Stripe.
async function syncSubscriptionFromStripe(userId) {
  const { rows } = await pool.query(
    'SELECT stripe_subscription_id FROM user_subscriptions WHERE user_id = $1 LIMIT 1', [userId]);
  const subId = rows[0]?.stripe_subscription_id;
  if (!subId) return null;

  const sub = await stripe.subscriptions.retrieve(subId);
  const item = sub.items?.data?.[0];
  const periodEnd = item?.current_period_end ?? sub.current_period_end;
  const periodStart = item?.current_period_start ?? sub.current_period_start;
  const cancelAtPeriodEnd = sub.cancel_at_period_end === true
    || (typeof sub.cancel_at === 'number' && sub.cancel_at > Math.floor(Date.now() / 1000));
  const canceledAt = sub.canceled_at || sub.ended_at;
  const active = sub.status === 'active';
  const toDate = (s) => (typeof s === 'number' ? new Date(s * 1000) : null);

  await pool.query(
    `UPDATE user_subscriptions SET
       plan_name = $1, status = $2, stripe_status = $2,
       current_period_start = $3, current_period_end = $4,
       cancel_at_period_end = $5, canceled_at = $6, updated_at = NOW()
     WHERE user_id = $7`,
    [active ? 'premium' : 'free', sub.status,
     toDate(periodStart), toDate(periodEnd),
     cancelAtPeriodEnd, toDate(canceledAt), userId]);

  return {
    isPremium: active,
    cancelAtPeriodEnd,
    currentPeriodEnd: toDate(periodEnd)?.toISOString() || null,
  };
}

// ── POST /api/m/subscription/refresh : resync Stripe → renvoie l'état à jour ──
router.post('/api/m/subscription/refresh', requireToken, async (req, res) => {
  try {
    const state = await syncSubscriptionFromStripe(req.tokenUser.id);
    if (!state) return res.json({ isPremium: false, cancelAtPeriodEnd: false, currentPeriodEnd: null });
    res.json(state);
  } catch (e) {
    console.error('m/subscription refresh error:', e);
    res.status(500).json({ error: 'Could not refresh subscription' });
  }
});

// ── POST /api/m/subscription/rc-sync : premium depuis l'API RevenueCat ────────
// Secours quand le webhook n'a pas (encore) écrit rc_expires_at : on interroge
// directement RevenueCat par app_user_id (= id backend, fixé via Purchases.configure)
// et on met à jour la base. Nécessite REVENUECAT_SECRET_KEY (clé secrète v1).
router.post('/api/m/subscription/rc-sync', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  const key = process.env.REVENUECAT_SECRET_KEY || '';
  if (!key) return res.json({ synced: false, reason: 'no_key' });
  if (typeof fetch !== 'function') return res.json({ synced: false, reason: 'no_fetch' });
  try {
    const r = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    if (!r.ok) {
      // 404 = RevenueCat n'a AUCUN abonné pour cet app_user_id → l'achat n'est
      // jamais remonté jusqu'à RevenueCat (validation Google KO côté RC).
      console.log(`🔄 rc-sync user ${uid} → HTTP ${r.status} (RevenueCat ne connaît pas cet utilisateur)`);
      return res.json({ synced: false, reason: `http_${r.status}` });
    }
    const data = await r.json();
    const sub = data?.subscriber || {};
    const entKeys = Object.keys(sub.entitlements || {});
    const subKeys = Object.keys(sub.subscriptions || {});
    const ent = sub.entitlements?.premium;
    const expires = ent?.expires_date ? new Date(ent.expires_date) : null;
    const active = !!(expires && expires > new Date());
    if (active) {
      await pool.query('UPDATE users SET rc_expires_at = $1, rc_will_renew = TRUE WHERE id = $2', [expires, uid]);
    } else if (ent) {
      // Entitlement connu mais expiré → on nettoie (sans toucher à l'état Stripe).
      await pool.query('UPDATE users SET rc_expires_at = $1, rc_will_renew = FALSE WHERE id = $2', [expires, uid]);
    }
    // Diagnostic complet : entitlements et abonnements connus de RevenueCat pour
    // cet utilisateur. Si entitlements=[] mais subscriptions=[...], le produit
    // Play n'est pas rattaché à l'entitlement `premium`. Si les deux sont vides,
    // RevenueCat n'a jamais validé l'achat (droits du compte de service Google).
    console.log(`🔄 rc-sync user ${uid} → active=${active} expires=${expires?.toISOString() || 'n/a'} entitlements=[${entKeys.join(',')}] subscriptions=[${subKeys.join(',')}]`);
    res.json({ synced: true, active, expires: expires ? expires.toISOString() : null, entitlements: entKeys, subscriptions: subKeys });
  } catch (e) {
    console.error('rc-sync error:', e.message);
    res.json({ synced: false, reason: 'error' });
  }
});

// ── POST /api/m/billing-portal : portail de facturation Stripe (annulation) ──
// Équivalent mobile de /create-portal-session (web). Renvoie l'URL du portail
// client Stripe pour gérer/annuler l'abonnement.
router.post('/api/m/billing-portal', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT stripe_customer_id FROM user_subscriptions WHERE user_id = $1 LIMIT 1',
      [req.tokenUser.id]);
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) return res.status(400).json({ error: 'No subscription found' });

    const returnUrl = `${process.env.BASE_URL || 'https://app.jiayou.fr'}/account`;
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    res.json({ url: portalSession.url });
  } catch (e) {
    console.error('m/billing-portal error:', e);
    res.status(500).json({ error: 'Could not open the billing portal' });
  }
});

// ── POST /api/m/create-checkout : session Stripe Checkout (web) → { url } ─────
// Abonnement web SANS détour par le site public : on crée la session Stripe et
// le client ouvre l'URL directement. Retour géré par le SPA via ?session_id=.
router.post('/api/m/create-checkout', requireToken, async (req, res) => {
  try {
    const priceID = process.env.STRIPE_PRICE_PREMIUM;
    if (!priceID) return res.status(500).json({ error: 'Stripe not configured' });
    const uid = req.tokenUser.id;
    const { rows: u } = await pool.query('SELECT email FROM users WHERE id = $1', [uid]);
    const email = u[0]?.email;

    // Origine de retour : allowlist stricte (anti open-redirect).
    const ALLOWED = ['https://app.jiayou.fr', 'https://jiayou.fr', 'http://localhost:8081'];
    const raw = String(req.body?.returnUrl || '').replace(/\/+$/, '');
    const base = ALLOWED.includes(raw) ? raw : 'https://app.jiayou.fr';

    const { rows: sub } = await pool.query(
      'SELECT stripe_customer_id FROM user_subscriptions WHERE user_id = $1 LIMIT 1', [uid]);
    const customerId = sub[0]?.stripe_customer_id || null;

    const params = {
      mode: 'subscription',
      line_items: [{ price: priceID, quantity: 1 }],
      success_url: `${base}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/`,
      metadata: { userId: String(uid), planName: 'premium' },
    };
    if (customerId) params.customer = customerId; else params.customer_email = email;

    let session;
    try {
      session = await stripe.checkout.sessions.create(params);
    } catch (err) {
      // Customer supprimé côté Stripe (test) : retry sans lui.
      if (err.code === 'resource_missing' && customerId) {
        delete params.customer; params.customer_email = email;
        session = await stripe.checkout.sessions.create(params);
      } else throw err;
    }
    res.json({ url: session.url });
  } catch (e) {
    console.error('m/create-checkout error:', e);
    res.status(500).json({ error: 'Could not start checkout' });
  }
});

// -------------------- Données de tracés (hanzi-writer) --------------------
// L'app ne peut pas taper jsDelivr : le CDN est bloqué / très instable en Chine,
// où se trouve l'essentiel des utilisateurs. Le serveur (hors Chine) va donc
// chercher le JSON de tracés et le relaie. Cache mémoire : ces données sont
// immuables et un même caractère revient sans cesse.
const hanziCache = new Map();
const HANZI_CACHE_MAX = 3000;

router.get('/api/m/hanzi/:char', async (req, res) => {
  const ch = Array.from(req.params.char || '')[0] || '';
  if (!/[㐀-鿿]/.test(ch)) return res.status(400).json({ error: 'not a Han character' });

  if (hanziCache.has(ch)) {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res.json(hanziCache.get(ch));
  }
  try {
    const r = await fetch(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/${encodeURIComponent(ch)}.json`);
    if (!r.ok) return res.status(404).json({ error: 'character not found' });
    const data = await r.json();
    if (hanziCache.size >= HANZI_CACHE_MAX) hanziCache.clear(); // purge simple
    hanziCache.set(ch, data);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.json(data);
  } catch (e) {
    console.error('hanzi data:', e.message);
    res.status(502).json({ error: 'could not fetch character data' });
  }
});

module.exports = { router, requireToken };
