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
const { sendExpoPush, sendExpoPushBulk } = require('../middleware/push.service');
const { registerLimiter, loginLimiter, validateSignupEmail } = require('../middleware/signup-guard');
const { rewardPendingReferral } = require('../lib/referral');
const { SIGNUP_GRANT } = require('../lib/economy');
const cedict = require('../lib/cedict');
const simptrad = require('../lib/simptrad');
const { SLOT_MIN, BOOKING_HORIZON_DAYS, validTz, deriveTeacherSlots } = require('../lib/teacher-schedule');

const fs = require('fs');
const path = require('path');
// (Le shim DEV « time machine » de l'évolution vit dans routes/mobile/collection.js.)

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

// Premium actif ? (special_guest OU RevenueCat non expiré OU abonnement Stripe actif)
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

// GARDE-FOU ANTI-VANDALISME : plafond d'éditions de la base PARTAGÉE par
// jour/utilisateur. Chaque mutation partagée est journalisée dans edit_log ; au-delà
// de la limite on refuse, ce qui casse toute modification malveillante en masse
// (script). Les users légitimes n'approchent pas ce seuil. L'admin (ADMIN_EMAIL) en
// est exempt (imports/corrections de masse). Premium ne lève PAS cette limite : elle
// protège le contenu partagé, ce n'est pas une limite de confort.
const DAILY_EDIT_LIMIT = 25;
async function editQuotaReached(tokenUser) {
  const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'locochet.08@gmail.com').toLowerCase();
  if ((tokenUser?.email || '').toLowerCase() === ADMIN_EMAIL) return false;
  // On ne compte QUE les éditions de contenu partagé existant (surface + sens) —
  // PAS les créations de mots (POST, coûtent déjà des pièces, ajoutent à SA propre
  // collection) : un gros contributeur légitime ne doit pas être bloqué.
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM edit_log
     WHERE user_id = $1 AND action IN ('edit_surface', 'edit_meaning')
       AND created_at::date = CURRENT_DATE`,
    [tokenUser.id]);
  return (rows[0]?.n || 0) >= DAILY_EDIT_LIMIT;
}
// Packs verrouillés au premium (niveaux avancés), repérés par cover_key.
const PREMIUM_PACK_COVERS = ['hsk4', 'hsk5', 'hsk6', 'hsk7'];

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

// GARDE-FOU ANTI SUR-FUSION. Un concept ne doit PAS accumuler des synonymes
// distincts de la MÊME langue (ex. 极/无比/极其 tous « extremely » écrasés en un
// seul « meaning ») : ça rend ces mots inapprenables séparément et les fait fuiter
// entre packs/quiz. On plafonne donc le merge-on-save : rejoindre un concept
// existant n'est permis que s'il compte STRICTEMENT moins de SAME_LANG_MERGE_CAP
// lexèmes de la langue du mot courant ; au-delà, on fabrique une boîte neuve
// (le mot devient son propre concept). Non destructif : les concepts déjà
// sur-fusionnés ne sont pas touchés, ils cessent juste de grossir.
const SAME_LANG_MERGE_CAP = 2;
async function sameLangLexemeCount(client, meaningId, lang, excludeMotId) {
  const r = await client.query(
    `SELECT COUNT(DISTINCT ls.mot_id)::int AS n
     FROM lexeme_senses ls JOIN mots m ON m.id = ls.mot_id
     WHERE ls.meaning_id = $1 AND m.lang = $2 AND ls.mot_id <> $3`,
    [meaningId, lang, excludeMotId]);
  return r.rows[0].n;
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
      //      GARDE-FOU : refusé si ce concept est déjà saturé en lexèmes de la
      //      langue du mot courant (anti sur-fusion de synonymes) → boîte neuve.
      if (n.meaning_id) {
        if (await sameLangLexemeCount(client, n.meaning_id, selfLang, motId) < SAME_LANG_MERGE_CAP) { meaningId = n.meaning_id; break; }
        continue;
      }
      // (2b) sinon, s'il n'a qu'un seul sens non ambigu, on le rejoint (même garde-fou).
      const one = await client.query(
        'SELECT min(meaning_id) AS meaning_id FROM lexeme_senses WHERE mot_id = $1 HAVING count(*) = 1',
        [n.id]);
      if (one.rows.length) {
        if (await sameLangLexemeCount(client, one.rows[0].meaning_id, selfLang, motId) < SAME_LANG_MERGE_CAP) { meaningId = one.rows[0].meaning_id; break; }
        continue;
      }
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
              (u.created_at <= NOW() - INTERVAL '3 days' AND COALESCE(u.ig_promo_seen, FALSE) = FALSE) AS show_ig_promo,
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
      // Drawer « suivez-nous sur Instagram » : après 3 j d'ancienneté, 1×/user.
      showIgPromo: row.show_ig_promo === true,
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

// ── POST /api/m/promo/instagram/seen : marque le drawer Instagram comme vu ────
// (affiché une seule fois par utilisateur, cf. showIgPromo dans /api/m/me).
router.post('/api/m/promo/instagram/seen', requireToken, async (req, res) => {
  try {
    await pool.query('UPDATE users SET ig_promo_seen = TRUE WHERE id = $1', [req.tokenUser.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('ig promo seen error:', e);
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

// ── Auth (login email/mdp, register, Google, Apple) → routes/mobile/auth.js ──
// ── Collection / dictionnaire (mots, recherche, import, édition) → routes/mobile/collection.js ──
require('./mobile/collection')(router, { requireToken, getUserLangs, syncConceptSiblings, logEdit, isUserPremium, editQuotaReached, verifyRequired, isVerified, DAILY_EDIT_LIMIT });

require('./mobile/auth')(router, { JWT_SECRET, TOKEN_TTL, creditReferralByCode });

// ── Admin (réconciliation, modération packs, intégrité) → routes/mobile/admin.js ──
require('./mobile/admin')(router, { requireToken });

// ── Notifications / push (token, centre, read) → routes/mobile/notifications.js ──
require('./mobile/notifications')(router, { requireToken });



// ── Compte / profil / réglages / langues / parcours / RGPD → routes/mobile/account.js ──
require('./mobile/account')(router, { requireToken, notify, getUserLangs, LANG_CATALOG, resolveCourseLangs, setActiveLangs, ensureLearnable, isUserPremium, PREMIUM_PACK_COVERS, splitSenses, isVerified, verifyRequired, learnableLangs: () => LEARNABLE_LANGS });


// ── Social / compétition (duels, leaderboard, parrainage) → routes/mobile/social.js ──
require('./mobile/social')(router, { requireToken, notify, getUserLangs, isUserPremium, FREE_LIMITS, countToday, creditReferralByCode });



// ── Côté élève (mentors, réservation, classes, tâches) → routes/mobile/student.js ──
require('./mobile/student')(router, { requireToken, notify, getUserLangs });

// ── JiaStore marketplace (packs, wallet, bank) → routes/mobile/market.js ─────
require('./mobile/market')(router, { requireToken, notify, isUserPremium, FREE_LIMITS, getUserLangs, syncConceptSiblings, splitSenses, verifyRequired, isVerified, PREMIUM_PACK_COVERS, learnableLangs: () => LEARNABLE_LANGS });

// ── Quiz (packs entraînables, révision, stats, save) → routes/mobile/quiz.js ──
require('./mobile/quiz')(router, { requireToken, notify, getUserLangs, isUserPremium, FREE_LIMITS, countToday, syncConceptSiblings });

// ── Plateforme professeur + leçons / créneaux → routes/mobile/lessons.js ─────
require('./mobile/lessons')(router, { requireToken, notify, getUserLangs, syncConceptSiblings });


// ── Billing (Stripe web) → routes/mobile/billing.js ──────────────────────────
require('./mobile/billing')(router, { requireToken });

// ── Contenu public (hanzi tracés + TTS) → routes/mobile/content.js ───────────
require('./mobile/content')(router);

module.exports = { router, requireToken };
