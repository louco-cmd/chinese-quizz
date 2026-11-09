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

// ── Shim DEV « time machine » ────────────────────────────────────────────────
// En local on peut servir les images d'évolution depuis un DOSSIER (cache du
// pipeline d'extraction) au lieu de la base, pour tout valider AVANT d'importer
// en prod. Activé par EXPO… non : par la variable d'env EVOLUTION_LOCAL_DIR.
// INERTE en prod (variable non définie sur Render) → on sert depuis hanzi_evolution.
const fs = require('fs');
const path = require('path');
const EVO_DIR = process.env.EVOLUTION_LOCAL_DIR || null;
function localEvoEras(ch) {
  const eras = [];
  try {
    for (let e = 0; e <= 5; e++) {
      if (fs.existsSync(path.join(EVO_DIR, `${ch}_${e}.webp`))) eras.push(e);
    }
  } catch { /* ignore */ }
  return eras;
}

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
    //
    // TOLÉRANCE SINGULIER/PLURIEL (occidental) : en plus du terme saisi, on cherche
    // aussi sa forme « dé-pluralisée » (retrait d'un -s / -es final). Taper « cat »
    // trouve déjà « cat »/« category » (préfixe), mais taper « poubelles » (plus long
    // que le mot stocké « poubelle ») échouait. En ajoutant le radical « poubelle » à
    // l'alternance `\y(poubelles|poubelle)`, le mot stocké « poubelle » matche. Le
    // radical le plus court préfixe-matche aussi le pluriel → les deux sens couverts,
    // sans bruit notable.
    const escapeRe = (s) => s.replace(/[^a-zA-Z0-9]/g, '\\$&');
    const wbVariants = (() => {
      const set = new Set([raw]);
      if (/[a-z]$/i.test(raw)) {
        if (raw.length >= 4 && /s$/i.test(raw)) set.add(raw.slice(0, -1));   // chats→chat, poubelles→poubelle
        if (raw.length >= 5 && /es$/i.test(raw)) set.add(raw.slice(0, -2));  // boxes→box
      }
      return [...set];
    })();
    const wbTerm = '\\y(' + wbVariants.map(escapeRe).join('|') + ')';
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
       ),
       -- Score qualité P2P calculé UNE fois par ligne : le crawler externe note des
       -- PAIRES dirigées dans lexeme_pair_scores (src_mot_id, tgt_mot_id, meaning_id
       -- + confidence/possession/trust). On prend le MEILLEUR score reliant le mot
       -- appris (d.id) à un mot de la langue native ($4) pour ce sens, dans les DEUX
       -- directions. Absent → NEUTRE (0.325).
       scored AS (
         SELECT d.*,
                (d.chinese = $3 OR lower(d.english) = lower($3)) AS exactm,
                COALESCE((
                  SELECT MAX(lexeme_rank(ps.confidence, ps.possession_count, ps.trust))
                  FROM lexeme_pair_scores ps
                  WHERE ps.meaning_id = d.meaning_id
                    AND ((ps.src_mot_id = d.id AND ps.tgt_lang = $4)
                      OR (ps.tgt_mot_id = d.id AND ps.src_lang = $4))
                ), 0.325) AS rk,
                (char_length(d.chinese) = 1 AND d.hsk IS NULL) AS niche
         FROM deduped d
       ),
       -- Numérote les mots POSSÉDÉS par désirabilité → on n'en remonte qu'un nombre
       -- limité en tête (cap), le reste du vocab capturé se trie comme la découverte.
       ranked AS (
         SELECT s.*,
                CASE WHEN s.owned THEN ROW_NUMBER() OVER (
                  PARTITION BY s.owned
                  ORDER BY s.exactm DESC, (s.hsk IS NOT NULL) DESC, s.rk DESC, s.niche ASC, s.id ASC
                ) END AS own_pos
         FROM scored s
       )
       -- Tri à paliers « safe/populaire d'abord » :
       --  1) match EXACT ;
       --  2) jusqu'à 3 mots DÉJÀ POSSÉDÉS en tête (app centrée collection) ; au-delà,
       --     les possédés se trient normalement (pas de monopole du haut de liste) ;
       --  3) vocabulaire HSK d'abord (meilleur signal « populaire » curé) ;
       --  4) qualité/popularité P2P (lexeme_rank) ;
       --  5) DÉMOTION des mono-caractères hors HSK (imports de masse niches) ;
       --  6) id (ordre stable).
       SELECT id, chinese, pinyin, hsk, meaning_id, english, owned
       FROM ranked
       ORDER BY exactm DESC,
                (owned AND own_pos <= 3) DESC,
                (hsk IS NOT NULL) DESC,
                rk DESC,
                niche ASC,
                id ASC
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

// ── Exports Pleco (fichiers flashcards) ──────────────────────────────────────
// Les exports Pleco arrivent en 2 formats. Le parseur générique ci-dessus les
// gère mal (XML sur peu de lignes → 1 mot par ligne ; TXT → pinyin/glose pollués
// par les phrases d'exemple). On détecte donc ces formats et on les parse à part.

// Décode les entités XML/HTML courantes d'une définition Pleco.
function decodeEntities(s) {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ''; } })
    .replace(/&amp;/g, '&');
}

// Glose anglaise concise : une définition Pleco/CC-CEDICT met TOUJOURS la glose
// AVANT les exemples (中文 pinyin traduction). On coupe donc au 1er caractère Han,
// on nettoie (crochets, CL:/M:), et on plafonne la longueur.
function plecoGloss(defn) {
  let s = decodeEntities(defn).replace(/\s+/g, ' ').trim();
  const m = s.match(HAN_RE);
  if (m) s = s.slice(0, s.indexOf(m[0]));
  s = cleanDefinition(s).replace(/\b(?:M|CL):\s*$/i, '').trim();
  return s.length > 90 ? s.slice(0, 90).trim() : s;
}

// Pinyin numéroté Pleco (yi1xia4, lu:3) → diacritique (yīxià, lǚ).
const PY_TONE_MARKS = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', ü: 'ǖǘǚǜ' };
function sylToDiacritic(syl) {
  const m = syl.match(/^([a-zü:]+?)([1-5])$/i);
  if (!m) return syl.replace(/u:/gi, 'ü');
  const base = m[1].replace(/u:/gi, 'ü'); const tone = +m[2];
  if (tone === 5) return base;
  const low = base.toLowerCase();
  let idx = -1;
  if (low.includes('a')) idx = low.indexOf('a');
  else if (low.includes('e')) idx = low.indexOf('e');
  else if (low.includes('ou')) idx = low.indexOf('o');
  else for (let k = low.length - 1; k >= 0; k--) if ('iouü'.includes(low[k])) { idx = k; break; }
  if (idx < 0) return base;
  const mark = PY_TONE_MARKS[low[idx]] ? PY_TONE_MARKS[low[idx]][tone - 1] : low[idx];
  const cased = base[idx] === base[idx].toUpperCase() ? mark.toUpperCase() : mark;
  return base.slice(0, idx) + cased + base.slice(idx + 1);
}
function numberedPinyin(s) {
  const parts = String(s || '').match(/[a-zü:]+[1-5]?/gi);
  return parts ? parts.map(sylToDiacritic).join('') : '';
}

// Pleco XML (<plecoflash>) : un fragment par <card>, headword simplifié (sc).
function parsePlecoXml(text) {
  const out = [];
  const cards = text.match(/<card\b[\s\S]*?<\/card>/gi) || [];
  for (const c of cards) {
    const sc = c.match(/<headword[^>]*charset="sc"[^>]*>([\s\S]*?)<\/headword>/i)
            || c.match(/<headword[^>]*>([\s\S]*?)<\/headword>/i);
    const chinese = sc ? decodeEntities(sc[1]).replace(/\s+/g, '').trim() : '';
    if (!chinese) continue;
    const pr = c.match(/<pron[^>]*>([\s\S]*?)<\/pron>/i);
    const df = c.match(/<defn>([\s\S]*?)<\/defn>/i);
    const gloss = df ? plecoGloss(df[1]) : '';
    out.push({ chinese, pinyin: pr ? numberedPinyin(pr[1]) : '', latin: gloss, gloss });
    if (out.length >= 2000) break;
  }
  return out;
}

// Pleco TXT : "一下[一下]⇥yi1xia4⇥définition" (tabulé, un mot par ligne).
function parsePlecoTxt(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.includes('\t')) continue;
    const cols = line.split('\t');
    const chinese = (cols[0] || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, '').trim();
    if (!HAN_RE.test(chinese)) continue;
    const gloss = plecoGloss(cols.slice(2).join(' '));
    out.push({ chinese, pinyin: numberedPinyin(cols[1] || ''), latin: gloss, gloss });
    if (out.length >= 2000) break;
  }
  return out;
}

// Une majorité de lignes « <han…>⇥<pinyin numéroté>⇥<def> » → export TXT Pleco.
function looksLikePlecoTxt(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 40);
  if (lines.length < 2) return false;
  let hits = 0;
  for (const l of lines) {
    const cols = l.split('\t');
    if (cols.length >= 3 && HAN_RE.test(cols[0]) && /\d/.test(cols[1]) && /^[a-zü1-5:·'’\s]+$/i.test(cols[1].trim())) hits++;
  }
  return hits >= Math.ceil(lines.length * 0.6);
}

// Parse le texte collé en fragments { chinese, pinyin, latin }. Détecte d'abord
// les exports Pleco (XML flashcards, TXT tabulé), sinon retombe sur le parseur
// générique : format CC-CEDICT sur 2 lignes (caractère seul puis « pinyin ⇥ déf »)
// et format tout-en-un sur une ligne.
function parseImportText(text) {
  const src = String(text || '');
  if (/<plecoflash|<card\b/i.test(src)) {
    const p = parsePlecoXml(src);
    if (p.length) return p;
  }
  if (looksLikePlecoTxt(src)) {
    const p = parsePlecoTxt(src);
    if (p.length) return p;
  }
  const lines = src.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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
        // Anglais : base d'abord, sinon CEDICT (mot à créer), sinon glose fournie
        // par le fichier importé (Pleco), sinon vide.
        const cedictEn = d?.english ? '' : cedict.translate(r.chinese);
        const english = d?.english || cedictEn || r.gloss || '';
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
    // Garde-fou anti-vandalisme : plafond d'éditions partagées par jour.
    if (await editQuotaReached(req.tokenUser)) {
      return res.status(429).json({ error: `Daily edit limit reached (${DAILY_EDIT_LIMIT}/day).`, limitReached: true, feature: 'edit' });
    }
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

// Composants « réels » d'une chaîne de décomposition IDS (makemeahanzi) : on retire
// les caractères de description idéographique (⿰⿱⿲…, U+2FF0–2FFF), les inconnus
// (『？』) et le caractère lui-même ; on garde les sous-caractères Han uniques.
function parseHanziComponents(decomposition, self) {
  if (!decomposition) return [];
  const out = [];
  for (const c of Array.from(decomposition)) {
    const code = c.codePointAt(0);
    if (code >= 0x2ff0 && code <= 0x2fff) continue;  // IDC
    if (c === '？' || c === '?') continue;            // composant inconnu
    if (!/[㐀-鿿]/.test(c)) continue;                  // hors plage Han unifiée
    if (c === self) continue;                         // pas le caractère lui-même
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

// Raccourcit une définition makemeahanzi (souvent multi-sens) pour l'affichage :
// on garde les 3 premiers sens et on plafonne la longueur.
function trimGloss(def) {
  const parts = String(def || '').split(/\s*[;/]\s*/).map((s) => s.trim()).filter(Boolean);
  let s = parts.slice(0, 3).join('; ');
  if (s.length > 80) s = s.slice(0, 80).replace(/[;,\s]+\S*$/, '') + '…';
  return s;
}

// ── GET /api/m/character/:char : sens d'un caractère seul (tap sur la carte) ──
// Fusionne NOTRE donnée (pinyin/trad/HSK depuis `mots`, langue native) avec la
// décomposition makemeahanzi (radical, décompo IDS, composants, étymologie).
router.get('/api/m/character/:char', requireToken, async (req, res) => {
  try {
    const ch = decodeURIComponent(req.params.char || '').trim();
    if (!ch) return res.status(400).json({ error: 'Missing character' });
    const nat = (await getUserLangs(req.tokenUser.id)).native;
    const uid = req.tokenUser.id;
    const [motQ, hanziQ, evoQ] = await Promise.all([
      pool.query(
        `SELECT m.id, m.chinese, m.pinyin, mot_tr(m.id, $2) AS english, m.hsk,
                (SELECT min(meaning_id) FROM lexeme_senses ls WHERE ls.mot_id = m.id) AS meaning_id,
                EXISTS(SELECT 1 FROM user_mots um WHERE um.user_id = $3 AND um.mot_id = m.id) AS owned
         FROM mots m WHERE m.chinese = $1 AND m.lang = 'zh' ORDER BY m.id ASC LIMIT 1`,
        [ch, nat, uid]),
      pool.query('SELECT radical, decomposition, etymology, etym_note, pinyin, definition FROM hanzi WHERE char = $1', [ch]),
      pool.query('SELECT era FROM hanzi_evolution WHERE char = $1 ORDER BY era', [ch]),
    ]);
    const mot = motQ.rows[0] || null;
    const hz = hanziQ.rows[0] || null;
    // Rien du tout (ni dans mots ni dans hanzi) → null (popup « non répertorié »).
    if (!mot && !hz) return res.json({ character: null });
    const character = {
      id: mot ? mot.id : null,
      meaning_id: mot ? mot.meaning_id : null,
      owned: mot ? mot.owned : false,
      chinese: (mot && mot.chinese) || ch,
      // Pinyin : celui de la collection/mots d'abord, sinon la lecture makemeahanzi
      // (utile pour un composant tapé qui n'est pas un mot à part entière).
      pinyin: (mot && mot.pinyin) || (hz && hz.pinyin) || null,
      // Traduction : celle de la collection/mots (langue native) d'abord ; sinon
      // repli sur la définition ANGLAISE makemeahanzi (sinon « unknown »).
      english: (mot && mot.english) || (hz && hz.definition ? trimGloss(hz.definition) : null),
      // Signale que la trad affichée est un repli anglais (le mot n'est pas dans mots).
      english_fallback: !(mot && mot.english) && !!(hz && hz.definition),
      hsk: mot ? mot.hsk : null,
      radical: hz ? hz.radical : null,
      decomposition: hz ? hz.decomposition : null,
      components: hz ? parseHanziComponents(hz.decomposition, ch) : [],
      etymology: hz ? hz.etymology : null,
      // Explication prête à afficher (enrichie) ; l'app la préfère au hint brut.
      etym_note: hz ? hz.etym_note : null,
      // « Time machine » : liste des eras historiques disponibles (EVOBC). Les
      // images sont servies par /api/m/evolution/:char/:era.
      evolution: EVO_DIR ? localEvoEras(ch) : evoQ.rows.map((r) => r.era),
      // Forme traditionnelle (si différente) → stop 繁 inséré avant le moderne dans
      // la frise. Seulement utile quand il y a une évolution à remonter.
      traditional: (EVO_DIR ? localEvoEras(ch).length : evoQ.rows.length) ? simptrad.toTrad(ch) : null,
    };
    res.json({ character });
  } catch (e) {
    console.error('m/character error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/evolution/:char/:era : image historique d'un caractère (EVOBC) ─
// PUBLIC (une balise <Image> n'envoie pas le token) ; immutable → mis en cache
// une fois pour toutes par le client. Sert le bytea depuis hanzi_evolution.
router.get('/api/m/evolution/:char/:era', async (req, res) => {
  try {
    const ch = decodeURIComponent(req.params.char || '').trim();
    const era = parseInt(req.params.era, 10);
    if (!ch || !Number.isInteger(era)) return res.status(400).end();
    // DEV : sert le WebP local si EVOLUTION_LOCAL_DIR est défini (cf. shim en tête).
    if (EVO_DIR) {
      const fp = path.join(EVO_DIR, `${ch}_${era}.webp`);
      if (fs.existsSync(fp)) {
        res.set('Content-Type', 'image/webp');
        res.set('Cache-Control', 'no-store');
        return res.send(fs.readFileSync(fp));
      }
      return res.status(404).end();
    }
    const { rows } = await pool.query('SELECT image, mime FROM hanzi_evolution WHERE char = $1 AND era = $2', [ch, era]);
    if (!rows.length) return res.status(404).end();
    res.set('Content-Type', rows[0].mime || 'image/png');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(rows[0].image);
  } catch (e) {
    console.error('m/evolution error:', e);
    res.status(500).end();
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
