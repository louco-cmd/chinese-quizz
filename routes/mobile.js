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

// ── Masquer/afficher un pack du JiaStore (admin) — utile pour une démo/présentation ─
// Masqué = exclu du listing du store (les propriétaires gardent l'accès). Réapparaît
// automatiquement une fois `hidden_until` dépassé, ou via unhide.
function isAdminReq(req) {
  const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'locochet.08@gmail.com').toLowerCase();
  return (req.tokenUser.email || '').toLowerCase() === ADMIN_EMAIL;
}
// POST /api/m/admin/packs/:id/hide  body { hours? | until? }  → masque le pack.
router.post('/api/m/admin/packs/:id/hide', requireToken, async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid pack' });
    let until;
    if (req.body?.until) { until = new Date(req.body.until); if (isNaN(until)) return res.status(400).json({ error: 'Invalid until' }); }
    else { const hours = Math.min(24 * 365, Math.max(1, parseInt(req.body?.hours, 10) || 24)); until = new Date(Date.now() + hours * 3600 * 1000); }
    const { rowCount } = await pool.query('UPDATE word_packs SET hidden_until = $1 WHERE id = $2', [until.toISOString(), id]);
    if (!rowCount) return res.status(404).json({ error: 'Pack not found' });
    res.json({ ok: true, id, hidden_until: until.toISOString() });
  } catch (e) { console.error('m/admin hide pack:', e); res.status(500).json({ error: 'Server error' }); }
});
// POST /api/m/admin/packs/:id/unhide → ré-affiche immédiatement.
router.post('/api/m/admin/packs/:id/unhide', requireToken, async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid pack' });
    await pool.query('UPDATE word_packs SET hidden_until = NULL WHERE id = $1', [id]);
    res.json({ ok: true, id });
  } catch (e) { console.error('m/admin unhide pack:', e); res.status(500).json({ error: 'Server error' }); }
});
// GET /api/m/admin/packs/hidden → packs actuellement masqués (pour vérifier).
router.get('/api/m/admin/packs/hidden', requireToken, async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const { rows } = await pool.query(
      `SELECT id, title, to_char(hidden_until,'YYYY-MM-DD HH24:MI') AS hidden_until FROM word_packs WHERE hidden_until > NOW() ORDER BY hidden_until`);
    res.json({ packs: rows });
  } catch (e) { console.error('m/admin hidden packs:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── GET /api/m/admin/integrity : audit d'intégrité du graphe concept/lexème ──
// Garde-fou de MONITORING (admin). Mesure la corruption : références pendantes
// (normalement 0, protégées par FK), pointeurs de sens « fantômes » (risque de
// résurrection), sens de possession cassés, DOUBLONS de lexèmes, et SUR-FUSION
// (concepts avec trop de lexèmes d'une même langue — cause de fuite inter-packs).
// La corruption DURE (dangling/résurrection/ownership) est loggée en WARN (visible
// dans les logs Render) pour repérage précoce. À appeler à la main ou via un cron.
async function computeIntegrity() {
  const scalar = async (s) => (await pool.query(s)).rows[0].n;
  const [
    danglingLsMot, danglingLsMeaning, danglingMotMeaning, resurrection,
    brokenOwnership, danglingUmMot, danglingPackMot, dupMotGroups, overmerge, biggest,
  ] = await Promise.all([
    scalar(`SELECT COUNT(*)::int n FROM lexeme_senses ls LEFT JOIN mots m ON m.id=ls.mot_id WHERE m.id IS NULL`),
    scalar(`SELECT COUNT(*)::int n FROM lexeme_senses ls LEFT JOIN meanings mn ON mn.id=ls.meaning_id WHERE mn.id IS NULL`),
    scalar(`SELECT COUNT(*)::int n FROM mots m WHERE m.meaning_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM meanings mn WHERE mn.id=m.meaning_id)`),
    scalar(`SELECT COUNT(*)::int n FROM mots m WHERE m.meaning_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lexeme_senses ls WHERE ls.mot_id=m.id AND ls.meaning_id=m.meaning_id)`),
    scalar(`SELECT COUNT(*)::int n FROM user_mots um WHERE um.meaning_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lexeme_senses ls WHERE ls.mot_id=um.mot_id AND ls.meaning_id=um.meaning_id)`),
    scalar(`SELECT COUNT(*)::int n FROM user_mots um LEFT JOIN mots m ON m.id=um.mot_id WHERE m.id IS NULL`),
    scalar(`SELECT COUNT(*)::int n FROM word_pack_items i LEFT JOIN mots m ON m.id=i.mot_id WHERE m.id IS NULL`),
    scalar(`SELECT COUNT(*)::int n FROM (SELECT 1 FROM mots GROUP BY lower(chinese), lang HAVING COUNT(*)>1) t`),
    pool.query(`SELECT m.lang, COUNT(*)::int n FROM (
        SELECT ls.meaning_id, mo.lang FROM lexeme_senses ls JOIN mots mo ON mo.id=ls.mot_id
        GROUP BY ls.meaning_id, mo.lang HAVING COUNT(DISTINCT ls.mot_id) >= 3
      ) m GROUP BY m.lang ORDER BY n DESC`).then((r) => r.rows),
    pool.query(`SELECT COUNT(DISTINCT ls.mot_id)::int lexemes FROM lexeme_senses ls GROUP BY ls.meaning_id ORDER BY lexemes DESC LIMIT 1`).then((r) => r.rows[0]?.lexemes || 0),
  ]);
  const hardCorruption = danglingLsMot + danglingLsMeaning + danglingMotMeaning + resurrection + brokenOwnership + danglingUmMot + danglingPackMot;
  return {
    dangling: { lexeme_senses_mot: danglingLsMot, lexeme_senses_meaning: danglingLsMeaning, mots_meaning: danglingMotMeaning, user_mots_mot: danglingUmMot, pack_items_mot: danglingPackMot },
    resurrection_risk: resurrection,
    broken_ownership_sense: brokenOwnership,
    duplicate_mot_groups: dupMotGroups,
    overmerge_concepts_ge3_samelang: overmerge,
    biggest_concept_lexemes: biggest,
    hard_corruption_total: hardCorruption,
  };
}
router.get('/api/m/admin/integrity', requireToken, async (req, res) => {
  const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'locochet.08@gmail.com').toLowerCase();
  if ((req.tokenUser.email || '').toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const report = await computeIntegrity();
    // Alerte précoce : toute corruption DURE est anormale (les FK l'empêchent déjà
    // en théorie) → on la remonte dans les logs pour investigation immédiate.
    if (report.hard_corruption_total > 0) {
      console.warn('[integrity] HARD CORRUPTION DETECTED:', JSON.stringify(report));
    }
    res.json({ ok: true, at: new Date().toISOString(), report });
  } catch (e) {
    console.error('m/admin integrity error:', e);
    res.status(500).json({ error: 'Integrity check failed' });
  }
});

// ── GET /api/m/admin/edit-activity : détection d'anomalies d'édition (admin) ──
// Garde-fou DÉTECTIF contre le vandalisme : qui édite la base partagée, à quel
// rythme, et quoi. Remonte les top éditeurs (24h/7j), les éditions de SURFACE
// récentes (chinese/pinyin — les plus sensibles) avec before/after, et logue une
// alerte WARN si un user a atteint/dépassé le plafond quotidien (signal d'abus).
router.get('/api/m/admin/edit-activity', requireToken, async (req, res) => {
  const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'locochet.08@gmail.com').toLowerCase();
  if ((req.tokenUser.email || '').toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const [top24, top7, recentSurface, totals] = await Promise.all([
      pool.query(
        `SELECT el.user_id, u.email, u.name, COUNT(*)::int AS edits,
                COUNT(*) FILTER (WHERE el.action='edit_surface')::int AS surface,
                COUNT(*) FILTER (WHERE el.action='edit_meaning')::int AS meaning
         FROM edit_log el LEFT JOIN users u ON u.id = el.user_id
         WHERE el.action IN ('edit_surface','edit_meaning') AND el.created_at >= NOW() - INTERVAL '24 hours'
         GROUP BY el.user_id, u.email, u.name ORDER BY edits DESC LIMIT 20`).then((r) => r.rows),
      pool.query(
        `SELECT el.user_id, u.email, COUNT(*)::int AS edits
         FROM edit_log el LEFT JOIN users u ON u.id = el.user_id
         WHERE el.action IN ('edit_surface','edit_meaning') AND el.created_at >= NOW() - INTERVAL '7 days'
         GROUP BY el.user_id, u.email ORDER BY edits DESC LIMIT 20`).then((r) => r.rows),
      pool.query(
        `SELECT el.id, el.user_id, el.mot_id, el.surface, el.before, el.after, el.created_at
         FROM edit_log el WHERE el.action='edit_surface'
         ORDER BY el.created_at DESC LIMIT 30`).then((r) => r.rows),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS d1,
                COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS d7
         FROM edit_log WHERE action IN ('edit_surface','edit_meaning')`).then((r) => r.rows[0]),
    ]);
    // Alerte précoce : un user qui a atteint le plafond quotidien est suspect.
    const flagged = top24.filter((u) => u.edits >= DAILY_EDIT_LIMIT);
    if (flagged.length) {
      console.warn('[edit-activity] users at/over daily edit cap:', JSON.stringify(flagged.map((u) => ({ user_id: u.user_id, email: u.email, edits: u.edits }))));
    }
    res.json({
      ok: true, at: new Date().toISOString(), daily_edit_limit: DAILY_EDIT_LIMIT,
      totals, flagged, top_editors_24h: top24, top_editors_7d: top7, recent_surface_edits: recentSurface,
    });
  } catch (e) {
    console.error('m/admin edit-activity error:', e);
    res.status(500).json({ error: 'Edit activity check failed' });
  }
});

// ── POST /api/m/push-token : enregistre le token Expo Push de l'appareil ─────
router.post('/api/m/push-token', requireToken, async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Missing token' });
    // Accorder la permission OS = consentement : on active les notifs à la 1re
    // inscription du token (ou à sa rotation). Le CASE évalue l'ANCIENNE valeur de
    // expo_push_token, donc un token INCHANGÉ n'écrase jamais un opt-out fait dans
    // les réglages (l'utilisateur peut couper via le toggle, ça reste sticky).
    await pool.query(
      `UPDATE users
         SET notifications_enabled = CASE WHEN expo_push_token IS DISTINCT FROM $1 THEN TRUE ELSE notifications_enabled END,
             expo_push_token = $1
       WHERE id = $2`,
      [token, req.tokenUser.id]);
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

// ── GET /api/m/mentors/:id : profil complet d'un mentor + stats ──────────────
router.get('/api/m/mentors/:id', requireToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid teacher' });
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.languages_spoken, u.teaching_languages, u.session_price, u.session_currency,
              u.years_experience, u.mentor_bio, u.mentor_links, u.presentation_video,
              (SELECT COUNT(DISTINCT cs.student_id) FROM classrooms c JOIN classroom_students cs ON cs.classroom_id = c.id
                 WHERE c.teacher_id = u.id AND cs.status = 'active')::int AS student_count,
              (SELECT COUNT(l.id) FROM lessons l JOIN classrooms c ON c.id = l.classroom_id WHERE c.teacher_id = u.id)::int AS task_count,
              (SELECT COUNT(*) FROM teacher_slots ts WHERE ts.teacher_id = u.id AND ts.status = 'booked' AND ts.ends_at < NOW())::int AS courses_given,
              (SELECT ROUND(AVG(rating)::numeric, 1) FROM teacher_ratings WHERE teacher_id = u.id) AS rating,
              (SELECT COUNT(*) FROM teacher_ratings WHERE teacher_id = u.id)::int AS rating_count
       FROM users u
       WHERE u.id = $1 AND u.role = 'teacher' AND u.mentor_listed = TRUE`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Teacher not found' });
    const m = rows[0];
    const links = Array.isArray(m.mentor_links) ? m.mentor_links : [];
    res.json({
      mentor: {
        id: m.id, name: m.name, languages_spoken: m.languages_spoken,
        teaching_languages: (m.teaching_languages || '').split(',').map((s) => s.trim()).filter(Boolean),
        session_price: m.session_price != null ? Number(m.session_price) : null,
        session_currency: m.session_currency || 'EUR',
        years_experience: m.years_experience, mentor_bio: m.mentor_bio,
        student_count: m.student_count, task_count: m.task_count, courses_given: m.courses_given,
        rating: m.rating != null ? Number(m.rating) : null, rating_count: m.rating_count,
        presentation_video: m.presentation_video || null,
        links, link: links[0] || null,
      },
    });
  } catch (e) { console.error('m/mentor detail error:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── GET /api/m/mentors/:id/slots : créneaux réservables d'un mentor (ESSAI) ───
// Pas besoin d'être déjà élève du prof. Dérivé de sa semaine type dans SON fuseau ;
// l'élève affiche les instants UTC dans le sien. Renvoie aussi le fuseau du prof.
router.get('/api/m/mentors/:id/slots', requireToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid teacher' });
    const t = await pool.query(`SELECT name, timezone FROM users WHERE id = $1 AND role = 'teacher' AND mentor_listed = TRUE`, [id]);
    if (!t.rows.length) return res.status(404).json({ error: 'Teacher not found' });
    const tz = validTz(t.rows[0].timezone) || 'UTC';
    const [av, dav, booked] = await Promise.all([
      pool.query(`SELECT weekday, hour FROM teacher_availability WHERE teacher_id = $1`, [id]),
      pool.query(`SELECT to_char(day,'YYYY-MM-DD') AS day, hour FROM teacher_date_slots WHERE teacher_id = $1 AND day >= CURRENT_DATE`, [id]),
      pool.query(`SELECT starts_at FROM teacher_slots WHERE teacher_id = $1 AND status = 'booked' AND starts_at > NOW()`, [id]),
    ]);
    const dateMap = new Map();
    dav.rows.forEach((r) => { if (!dateMap.has(r.day)) dateMap.set(r.day, new Set()); dateMap.get(r.day).add(r.hour); });
    const bookedSet = new Set(booked.rows.map((r) => new Date(r.starts_at).toISOString()));
    const slots = deriveTeacherSlots({ tz, blocks: av.rows, dateMap, bookedSet, horizonDays: BOOKING_HORIZON_DAYS });
    res.json({ teacher_name: t.rows[0].name, timezone: tz, slots: slots.slice(0, 200) });
  } catch (e) { console.error('m/mentor slots:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── POST /api/m/mentors/:id/book-trial : réserver une séance d'essai ─────────
// Ne nécessite PAS d'adhésion. Un seul cours d'essai à venir par (élève, prof).
router.post('/api/m/mentors/:id/book-trial', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const id = parseInt(req.params.id, 10);
    const start = new Date(req.body?.starts_at);
    if (!id || isNaN(start)) return res.status(400).json({ error: 'Invalid request' });
    if (id === uid) return res.status(400).json({ error: 'Cannot book yourself' });
    if (start.getTime() <= Date.now()) return res.status(400).json({ error: 'Slot is in the past' });
    if (start.getUTCMinutes() !== 0 || start.getUTCSeconds() !== 0) return res.status(400).json({ error: 'Invalid slot time' });
    const t = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'teacher' AND mentor_listed = TRUE`, [id]);
    if (!t.rows.length) return res.status(404).json({ error: 'Teacher not found' });
    if (!(await slotOpenForTeacher(id, start))) return res.status(409).json({ error: 'Slot not available', taken: true });
    // Déjà un cours à venir avec ce prof ? (évite le spam de réservations d'essai)
    const dup = await pool.query(
      `SELECT 1 FROM teacher_slots WHERE teacher_id = $1 AND student_id = $2 AND status = 'booked' AND starts_at > NOW() LIMIT 1`, [id, uid]);
    if (dup.rows.length) return res.status(409).json({ error: 'You already have an upcoming lesson with this teacher.', already: true });
    const end = new Date(start.getTime() + SLOT_MIN * 60000);
    const ins = await pool.query(
      `INSERT INTO teacher_slots (teacher_id, starts_at, ends_at, student_id, status, booked_at, note)
       VALUES ($1, $2, $3, $4, 'booked', NOW(), 'trial')
       ON CONFLICT (teacher_id, starts_at) WHERE status = 'booked' DO NOTHING RETURNING id`,
      [id, start.toISOString(), end.toISOString(), uid]);
    if (!ins.rows.length) return res.status(409).json({ error: 'Slot no longer available', taken: true });
    res.json({ ok: true, id: ins.rows[0].id });
  } catch (e) { console.error('m/mentor book-trial:', e); res.status(500).json({ error: 'Server error' }); }
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

// ── GET /api/m/student/history : TOUS les cours reçus (terminés inclus, profs
// quittés inclus) → la page « Mes cours » (Settings). Contrairement à
// /student/classes (profs actifs + tasks en cours), ne filtre NI sur la complétion
// NI sur le statut d'adhésion. `completed` = connaissance ≥ 100 ; `membership` =
// 'active' | 'removed' (un prof quitté/retiré → cours en lecture seule côté app).
router.get('/api/m/student/history', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const { rows } = await pool.query(
      `SELECT l.id, l.title, l.created_at,
              c.name AS class_name, t.id AS teacher_id,
              COALESCE(NULLIF(TRIM(t.name), ''), 'Your teacher') AS teacher_name,
              cs.status AS membership,
              (SELECT COUNT(*) FROM lesson_words lw WHERE lw.lesson_id = l.id)::int AS word_count,
              (SELECT COALESCE(ROUND(AVG(COALESCE(um.score, 0))), 0)
                 FROM lesson_words lw
                 LEFT JOIN user_mots um ON um.mot_id = lw.mot_id AND um.user_id = $1
                 WHERE lw.lesson_id = l.id)::int AS knowledge
       FROM lessons l
       JOIN classrooms c ON c.id = l.classroom_id
       JOIN users t ON t.id = c.teacher_id
       JOIN classroom_students cs ON cs.classroom_id = c.id AND cs.student_id = $1
       WHERE l.created_at >= COALESCE(cs.joined_at, 'epoch')
       ORDER BY (cs.status = 'active') DESC, t.name ASC, l.created_at DESC`, [uid]);
    const lessons = rows
      .filter((r) => r.word_count > 0)
      .map((r) => ({
        id: r.id, title: r.title, class_name: r.class_name,
        teacher_id: r.teacher_id, teacher_name: r.teacher_name, membership: r.membership,
        word_count: r.word_count, knowledge: r.knowledge, completed: r.knowledge >= 100,
      }));
    res.json({ lessons });
  } catch (e) {
    console.error('m/student history error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/student/lessons/:id : détail d'un cours (notes + mots) ─────────
router.get('/api/m/student/lessons/:id', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const lessonId = parseInt(req.params.id, 10);
    // Lecture autorisée à tout membre (même adhésion 'removed') → consultation de
    // l'historique des cours ; la PRATIQUE (start/result) reste réservée aux profs actifs.
    const access = await pool.query(
      `SELECT l.id FROM lessons l
       JOIN classroom_students cs ON cs.classroom_id = l.classroom_id
       WHERE l.id = $1 AND cs.student_id = $2`, [lessonId, uid]);
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

// ── GET /api/m/student/mentors/:teacherId/overview : page « mon prof » ────────
// Vue côté élève d'un prof qu'il a rejoint : identité + stats, ses classes avec
// ce prof, ses cours à venir, et sa propre note. Pas de filtre mentor_listed —
// on autorise dès qu'un lien élève↔prof existe (classe ou cours réservé).
router.get('/api/m/student/mentors/:teacherId/overview', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const teacherId = parseInt(req.params.teacherId, 10);
    if (!teacherId) return res.status(400).json({ error: 'Invalid mentor' });

    const [enroll, slotLink] = await Promise.all([
      pool.query(
        `SELECT 1 FROM classroom_students cs JOIN classrooms c ON c.id = cs.classroom_id
         WHERE c.teacher_id = $1 AND cs.student_id = $2 LIMIT 1`, [teacherId, uid]),
      pool.query(`SELECT 1 FROM teacher_slots WHERE teacher_id = $1 AND student_id = $2 LIMIT 1`, [teacherId, uid]),
    ]);
    if (!enroll.rows.length && !slotLink.rows.length) return res.status(404).json({ error: 'Teacher not found' });

    const tq = await pool.query(
      `SELECT u.id, COALESCE(NULLIF(TRIM(u.name), ''), 'Your teacher') AS name,
              u.teaching_languages, u.session_price, u.session_currency,
              (SELECT COUNT(DISTINCT cs.student_id) FROM classrooms c JOIN classroom_students cs ON cs.classroom_id = c.id
                 WHERE c.teacher_id = u.id AND cs.status = 'active')::int AS student_count,
              (SELECT COUNT(*) FROM teacher_slots ts WHERE ts.teacher_id = u.id AND ts.status = 'booked' AND ts.ends_at < NOW())::int AS courses_given,
              (SELECT ROUND(AVG(rating)::numeric, 1) FROM teacher_ratings WHERE teacher_id = u.id) AS rating,
              (SELECT COUNT(*) FROM teacher_ratings WHERE teacher_id = u.id)::int AS rating_count
       FROM users u WHERE u.id = $1 AND u.role = 'teacher'`, [teacherId]);
    if (!tq.rows.length) return res.status(404).json({ error: 'Teacher not found' });
    const t = tq.rows[0];

    const [classes, lessons, upcoming, mine] = await Promise.all([
      pool.query(
        `SELECT c.id, c.name, cs.status, MIN(cs.joined_at) AS since,
                (SELECT COUNT(*) FROM lessons l WHERE l.classroom_id = c.id)::int AS task_count
         FROM classroom_students cs JOIN classrooms c ON c.id = cs.classroom_id
         WHERE c.teacher_id = $1 AND cs.student_id = $2
         GROUP BY c.id, c.name, cs.status ORDER BY since ASC`, [teacherId, uid]),
      // Cours reçus de ce prof (même forme que /student/history → composant partagé).
      pool.query(
        `SELECT l.id, l.title, l.created_at, c.name AS class_name, cs.status AS membership,
                (SELECT COUNT(*) FROM lesson_words lw WHERE lw.lesson_id = l.id)::int AS word_count,
                (SELECT COALESCE(ROUND(AVG(COALESCE(um.score, 0))), 0)
                   FROM lesson_words lw
                   LEFT JOIN user_mots um ON um.mot_id = lw.mot_id AND um.user_id = $2
                   WHERE lw.lesson_id = l.id)::int AS knowledge
         FROM lessons l
         JOIN classrooms c ON c.id = l.classroom_id
         JOIN classroom_students cs ON cs.classroom_id = c.id AND cs.student_id = $2
         WHERE c.teacher_id = $1 AND l.created_at >= COALESCE(cs.joined_at, 'epoch')
         ORDER BY l.created_at DESC`, [teacherId, uid]),
      pool.query(
        `SELECT ts.id, ts.starts_at, ts.ends_at, ts.note
         FROM teacher_slots ts
         WHERE ts.teacher_id = $1 AND ts.student_id = $2 AND ts.status = 'booked' AND ts.ends_at > NOW()
         ORDER BY ts.starts_at ASC`, [teacherId, uid]),
      pool.query(`SELECT rating, comment FROM teacher_ratings WHERE teacher_id = $1 AND student_id = $2`, [teacherId, uid]),
    ]);

    const isActive = classes.rows.some((c) => c.status === 'active');
    res.json({
      teacher: {
        id: t.id, name: t.name,
        teaching_languages: (t.teaching_languages || '').split(',').map((s) => s.trim()).filter(Boolean),
        session_price: t.session_price != null ? Number(t.session_price) : null,
        session_currency: t.session_currency || 'EUR',
        student_count: t.student_count, courses_given: t.courses_given,
        rating: t.rating != null ? Number(t.rating) : null, rating_count: t.rating_count,
      },
      is_active: isActive,
      classes: classes.rows.map((c) => ({ id: c.id, name: c.name, status: c.status, since: c.since, task_count: c.task_count })),
      lessons: lessons.rows
        .filter((r) => r.word_count > 0)
        .map((r) => ({
          id: r.id, title: r.title, class_name: r.class_name, membership: r.membership,
          word_count: r.word_count, knowledge: r.knowledge, completed: r.knowledge >= 100,
        })),
      upcoming_lessons: upcoming.rows,
      my_rating: mine.rows[0] || null,
    });
  } catch (e) { console.error('m/student mentor overview error:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── POST /api/m/student/mentors/:teacherId/rate : noter un prof (1 note/élève) ─
router.post('/api/m/student/mentors/:teacherId/rate', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const teacherId = parseInt(req.params.teacherId, 10);
    const rating = parseInt(req.body?.rating, 10);
    const comment = (req.body?.comment || '').trim().slice(0, 500) || null;
    if (!teacherId) return res.status(400).json({ error: 'Invalid mentor' });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    const link = await pool.query(
      `SELECT 1 FROM classroom_students cs JOIN classrooms c ON c.id = cs.classroom_id
       WHERE c.teacher_id = $1 AND cs.student_id = $2 LIMIT 1`, [teacherId, uid]);
    if (!link.rows.length) return res.status(403).json({ error: 'You are not enrolled with this teacher' });
    await pool.query(
      `INSERT INTO teacher_ratings (teacher_id, student_id, rating, comment) VALUES ($1, $2, $3, $4)
       ON CONFLICT (teacher_id, student_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = CURRENT_TIMESTAMP`,
      [teacherId, uid, rating, comment]);
    res.json({ success: true });
  } catch (e) { console.error('m/student rate mentor error:', e); res.status(500).json({ error: 'Server error' }); }
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
    // Distribution de maîtrise : agrégée EN SQL (4 buckets × 3 colonnes de score),
    // une seule ligne — au lieu de rapatrier toute la collection pour compter en JS
    // (économise le transfert DB, qui croît avec la taille des collections).
    const distBuckets = (col) => `
      COUNT(*) FILTER (WHERE COALESCE(um.${col},0) >= 85)::int AS ${col}_mastered,
      COUNT(*) FILTER (WHERE COALESCE(um.${col},0) >= 60 AND COALESCE(um.${col},0) < 85)::int AS ${col}_learning,
      COUNT(*) FILTER (WHERE COALESCE(um.${col},0) >= 30 AND COALESCE(um.${col},0) < 60)::int AS ${col}_medium,
      COUNT(*) FILTER (WHERE COALESCE(um.${col},0) < 30)::int AS ${col}_novice`;
    const [me, distAgg, hskAgg, quizzes, duels, contrib, recent, duelRank, trophies] = await Promise.all([
      pool.query('SELECT name, balance, tagline, country, quiz_direction, learning_lang, native_lang, avatar_icon, avatar_color FROM users WHERE id = $1', [uid]),
      pool.query(
        `SELECT COUNT(*)::int AS total,
                ${distBuckets('score')},
                ${distBuckets('score_character')},
                ${distBuckets('score_reading')}
         FROM user_mots um JOIN mots m ON m.id = um.mot_id
         WHERE um.user_id = $1 AND m.lang = $2`, [uid, L]),
      // Stats par niveau HSK : count + nb « maîtrisé » (≥85) par colonne de score,
      // groupé côté base → ~7 lignes.
      pool.query(
        `SELECT COALESCE(CASE WHEN $2 = 'zh' THEN 'HSK' || m.hsk::text ELSE m.hsk::text END, 'Street') AS lvl, COUNT(*)::int AS count,
                COUNT(*) FILTER (WHERE COALESCE(um.score,0) >= 85)::int AS p_mast,
                COUNT(*) FILTER (WHERE COALESCE(um.score_character,0) >= 85)::int AS c_mast,
                COUNT(*) FILTER (WHERE COALESCE(um.score_reading,0) >= 85)::int AS r_mast
         FROM user_mots um JOIN mots m ON m.id = um.mot_id
         WHERE um.user_id = $1 AND m.lang = $2
         GROUP BY m.hsk`, [uid, L]),
      pool.query('SELECT COUNT(*)::int AS n FROM quiz_history WHERE user_id = $1 AND lang = $2', [uid, L]),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM duels
         WHERE (challenger_id = $1 OR opponent_id = $1) AND status = 'completed' AND lang = $2`, [uid, L]),
      // Calendrier d'activité : GLOBAL (tous parcours confondus). Un événement de
      // révision = un quiz OU un duel joué. Pour le duel, la date de jeu de CE
      // joueur ≈ created_at s'il est le challengeur (il joue à la création),
      // completed_at s'il est l'adversaire (il joue en terminant le duel).
      pool.query(
        `SELECT date, COUNT(*) AS count FROM (
           SELECT DATE(date_completed) AS date
           FROM quiz_history
           WHERE user_id = $1 AND EXTRACT(YEAR FROM date_completed) = $2
           UNION ALL
           SELECT DATE(CASE WHEN challenger_id = $1 THEN created_at ELSE completed_at END) AS date
           FROM duels
           WHERE (challenger_id = $1 OR opponent_id = $1)
             AND (challenger_id = $1 OR status = 'completed')
             AND (CASE WHEN challenger_id = $1 THEN created_at ELSE completed_at END) IS NOT NULL
             AND EXTRACT(YEAR FROM (CASE WHEN challenger_id = $1 THEN created_at ELSE completed_at END)) = $2
         ) ev
         GROUP BY date ORDER BY date ASC`, [uid, year]),
      pool.query(
        `SELECT score, total_questions, ratio, quiz_type, coins_earned, date_completed
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
      // Trophées débloqués (global, tous parcours) — affiché dans la tuile account.
      pool.query('SELECT COUNT(*)::int AS n FROM user_trophies WHERE user_id = $1', [uid]),
    ]);

    // Distribution de maîtrise (mêmes seuils que l'EJS), lue depuis l'agrégat SQL.
    const d0 = distAgg.rows[0] || {};
    const dist = (col) => ({
      mastered: d0[`${col}_mastered`] || 0,
      learning: d0[`${col}_learning`] || 0,
      medium:   d0[`${col}_medium`] || 0,
      novice:   d0[`${col}_novice`] || 0,
    });
    const pinyinDist = dist('score');
    const charDist   = dist('score_character');
    const readingDist = dist('score_reading');
    const totalWords = d0.total || 0;

    // Stats HSK : nombre + % maîtrisé PAR TYPE de quiz et par niveau, à partir des
    // compteurs agrégés en base (score='score', caractères='score_character',
    // lecture='score_reading'), même seuil « maîtrisé » (≥85) qu'ailleurs.
    const LEVEL_ORDER = L === 'zh'
      ? ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6', 'HSK7', 'Street']
      : ['A1', 'A2', 'B1', 'B2', 'Street'];
    const byLvl = {};
    hskAgg.rows.forEach((r) => { byLvl[r.lvl] = r; });
    const hsk = LEVEL_ORDER.map((key) => {
      const r = byLvl[key];
      if (!r || !r.count) return null;
      const pct = (n) => (r.count ? Math.round((n / r.count) * 100) : 0);
      const pinyinPct = pct(r.p_mast);
      const label = key === 'Street' ? (L === 'zh' ? 'HSK Street' : 'Unclassified')
        : L === 'zh' ? key.replace('HSK', 'HSK ') : `CEFR ${key}`;
      return {
        key,
        label,
        count: r.count,
        masteredPct: pinyinPct,
        pinyinPct,
        characterPct: pct(r.c_mast),
        readingPct: pct(r.r_mast),
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
      words: totalWords,
      wordsKnown: pinyinDist.mastered,
      quizzes: quizzes.rows[0].n,
      duels: duels.rows[0].n,
      duelRank: duelRank.rows[0]?.rank || null,
      duelRankTotal: duelRank.rows[0]?.total || 0,
      trophiesEarned: trophies.rows[0]?.n || 0,
      mastery: { pinyin: pinyinDist, character: charDist, reading: readingDist, total: totalWords },
      hsk,
      recentQuizzes: recent.rows.map((r) => ({
        score: r.score, total: r.total_questions,
        ratio: r.ratio != null ? Number(r.ratio) : null,
        type: r.quiz_type || 'quiz',
        coins: r.coins_earned != null ? r.coins_earned : null, // null = quiz d'avant le suivi → « — »
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
    // Distribution/HSK agrégées en SQL (voir /api/m/account) → pas de rapatriement
    // de toute la collection du joueur consulté.
    const distBuckets = (col) => `
      COUNT(*) FILTER (WHERE COALESCE(um.${col},0) >= 85)::int AS ${col}_mastered,
      COUNT(*) FILTER (WHERE COALESCE(um.${col},0) >= 60 AND COALESCE(um.${col},0) < 85)::int AS ${col}_learning,
      COUNT(*) FILTER (WHERE COALESCE(um.${col},0) >= 30 AND COALESCE(um.${col},0) < 60)::int AS ${col}_medium,
      COUNT(*) FILTER (WHERE COALESCE(um.${col},0) < 30)::int AS ${col}_novice`;
    const [me, distAgg, hskAgg, quizzes, duels] = await Promise.all([
      pool.query('SELECT id, name, tagline, country, avatar_icon, avatar_color, created_at FROM users WHERE id = $1', [targetId]),
      pool.query(
        `SELECT COUNT(*)::int AS total,
                ${distBuckets('score')},
                ${distBuckets('score_character')},
                ${distBuckets('score_reading')}
         FROM user_mots um JOIN mots m ON m.id = um.mot_id
         WHERE um.user_id = $1 AND m.lang = $2`, [targetId, L]),
      pool.query(
        `SELECT COALESCE(CASE WHEN $2 = 'zh' THEN 'HSK' || m.hsk::text ELSE m.hsk::text END, 'Street') AS lvl, COUNT(*)::int AS count
         FROM user_mots um JOIN mots m ON m.id = um.mot_id
         WHERE um.user_id = $1 AND m.lang = $2
         GROUP BY m.hsk`, [targetId, L]),
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

    // Distribution de maîtrise (mêmes seuils que l'EJS), lue depuis l'agrégat SQL.
    const d0 = distAgg.rows[0] || {};
    const dist = (col) => ({
      mastered: d0[`${col}_mastered`] || 0,
      learning: d0[`${col}_learning`] || 0,
      medium:   d0[`${col}_medium`] || 0,
      novice:   d0[`${col}_novice`] || 0,
    });
    const pinyinDist = dist('score');
    const charDist   = dist('score_character');
    const readingDist = dist('score_reading');
    const totalWords = d0.total || 0;

    const LEVEL_ORDER = L === 'zh'
      ? ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6', 'HSK7', 'Street']
      : ['A1', 'A2', 'B1', 'B2', 'Street'];
    const byLvl = {};
    hskAgg.rows.forEach((r) => { byLvl[r.lvl] = r.count; });
    const hsk = LEVEL_ORDER
      .filter((key) => byLvl[key])
      .map((key) => ({
        label: key === 'Street' ? (L === 'zh' ? 'Street' : 'Unclassified')
          : L === 'zh' ? key.replace('HSK', 'HSK ') : `CEFR ${key}`,
        count: byLvl[key],
      }));

    res.json({
      id: u.id,
      name: u.name || '',
      tagline: u.tagline || null,
      country: u.country || null,
      avatar_icon: u.avatar_icon || null,
      avatar_color: u.avatar_color || null,
      created_at: u.created_at instanceof Date ? u.created_at.toISOString() : (u.created_at || null),
      isMe: u.id === uid,
      words: totalWords,
      quizzes: quizzes.rows[0].n,
      duels: duels.rows[0].n,
      wins: duels.rows[0].wins,
      losses: duels.rows[0].losses,
      ratio: (duels.rows[0].wins + duels.rows[0].losses) > 0
        ? Math.round((duels.rows[0].wins / (duels.rows[0].wins + duels.rows[0].losses)) * 100) : 0,
      mastery: { pinyin: pinyinDist, character: charDist, reading: readingDist, total: totalWords },
      learning_lang: L,
      hsk,
    });
  } catch (e) {
    console.error('m/user profile error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Trophées : catalogue (source unique) + endpoint qui calcule la progression,
// débloque les paliers atteints et crédite la récompense (idempotent). ───────────
// Chaque palier = [cible, récompense₵]. id = `${cat}_${cible}`. Le front n'affiche
// que ce que renvoie l'endpoint (catégorie, unité, cible, reward, progress, unlocked).
const TROPHY_CATALOG = [
  { cat: 'captures',     unit: 'captures',      tiers: [[350, 50], [600, 100], [1000, 200], [2000, 350], [3500, 500], [5000, 800], [8000, 1200]] },
  { cat: 'mastered',     unit: 'mastered',      tiers: [[100, 80], [500, 200], [800, 300], [1000, 400], [1500, 600], [2000, 900], [3000, 1500]] },
  // Assiduité : jours d'activité CUMULÉS sur l'année en cours (quiz OU duel),
  // remis à zéro le 1er janvier → paliers ré-obtenables chaque année (id daté).
  { cat: 'streak',       unit: 'days_year', yearly: true, tiers: [[7, 30], [30, 80], [60, 150], [120, 300], [180, 500], [270, 800], [360, 1200]] },
  { cat: 'quiz',         unit: 'quizzes',       tiers: [[10, 20], [50, 60], [100, 120], [300, 250], [800, 500], [2000, 900], [5000, 1800]] },
  { cat: 'duel_win',     unit: 'duels_won',     tiers: [[10, 40], [25, 80], [50, 150], [100, 300], [250, 600], [500, 1000], [1000, 2000]] },
  { cat: 'duel_play',    unit: 'duels_played',  tiers: [[10, 30], [25, 60], [50, 120], [100, 250], [250, 500], [500, 800], [1000, 1500]] },
  { cat: 'money',        unit: 'coins_bank',    tiers: [[1000, 100], [5000, 200], [10000, 300], [25000, 500], [50000, 800], [100000, 1500]] },
  { cat: 'pack_create',  unit: 'packs_created', tiers: [[1, 50], [5, 150], [10, 300]] },
  { cat: 'pack_buy',     unit: 'packs_bought',  tiers: [[1, 20], [5, 80], [20, 200]] },
  // ── Trophées « échec » (anti-héros) : lot de CONSOLATION (récompenses modestes).
  // Pas d'exploit de farm : chaque palier se débloque UNE seule fois (ON CONFLICT).
  // comeback = en plus un petit « welcome back » qui sert la rétention.
  { cat: 'comeback',     unit: 'days_away',         tiers: [[7, 50], [30, 120], [90, 250]] },
  { cat: 'duel_loss',    unit: 'duels_lost_streak', tiers: [[5, 30], [10, 60], [20, 120]] },
  { cat: 'goose_egg',    unit: 'zero_quiz',         tiers: [[10, 25], [20, 50], [30, 80], [100, 300]] },
];

router.get('/api/m/trophies', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  const year = new Date().getFullYear();
  // id de trophée : daté pour les catégories annuelles (reset au 1er janvier).
  const trophyId = (cat, target, yearly) => (yearly ? `${cat}_${target}_${year}` : `${cat}_${target}`);
  try {
    const [wordsQ, masteredQ, quizQ, duelQ, meQ, packCreateQ, packBuyQ, daysQ, comebackQ, lossStreakQ, gooseQ] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM user_mots WHERE user_id = $1', [uid]),
      pool.query('SELECT COUNT(*)::int AS n FROM user_mots WHERE user_id = $1 AND COALESCE(score,0) >= 85', [uid]),
      pool.query('SELECT COUNT(*)::int AS n FROM quiz_history WHERE user_id = $1', [uid]),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE winner_id = $1)::int AS won,
                COUNT(*) FILTER (WHERE status = 'completed' AND (challenger_id = $1 OR opponent_id = $1))::int AS played
         FROM duels WHERE challenger_id = $1 OR opponent_id = $1`, [uid]),
      pool.query('SELECT balance, trophies_init FROM users WHERE id = $1', [uid]),
      pool.query('SELECT COUNT(*)::int AS n FROM word_packs WHERE creator_id = $1', [uid]),
      pool.query('SELECT COUNT(*)::int AS n FROM pack_purchases WHERE buyer_id = $1', [uid]),
      // Assiduité : jours d'activité DISTINCTS de l'ANNÉE en cours (quiz OU duel).
      pool.query(
        `SELECT COUNT(*)::int AS n FROM (
           SELECT DATE(date_completed) AS d FROM quiz_history
           WHERE user_id = $1 AND EXTRACT(YEAR FROM date_completed) = $2
           UNION
           SELECT DATE(CASE WHEN challenger_id = $1 THEN created_at ELSE completed_at END) AS d
           FROM duels
           WHERE (challenger_id = $1 OR opponent_id = $1)
             AND (challenger_id = $1 OR status = 'completed')
             AND (CASE WHEN challenger_id = $1 THEN created_at ELSE completed_at END) IS NOT NULL
             AND EXTRACT(YEAR FROM (CASE WHEN challenger_id = $1 THEN created_at ELSE completed_at END)) = $2
         ) days`, [uid, year]),
      // ── Trophées « échec » (anti-héros) ──────────────────────────────────────
      // comeback : plus grand ÉCART (jours) entre deux jours d'activité — on ajoute
      // CURRENT_DATE pour que « revenu après X jours d'absence » compte dès l'ouverture.
      pool.query(
        `WITH days AS (
           SELECT DISTINCT d FROM (
             SELECT DATE(date_completed) AS d FROM quiz_history WHERE user_id = $1
             UNION SELECT DATE(created_at) FROM duels WHERE challenger_id = $1
             UNION SELECT DATE(completed_at) FROM duels WHERE opponent_id = $1 AND status = 'completed' AND completed_at IS NOT NULL
             UNION SELECT CURRENT_DATE
           ) x WHERE d IS NOT NULL
         ), g AS (SELECT (d - LAG(d) OVER (ORDER BY d)) AS gap FROM days)
         SELECT COALESCE(MAX(gap), 0)::int AS n FROM g`, [uid]),
      // duel_loss : plus longue série de défaites consécutives (gaps-and-islands).
      pool.query(
        `WITH d AS (
           SELECT (winner_id IS NOT NULL AND winner_id <> $1) AS lost,
                  COALESCE(completed_at, created_at) AS ts
           FROM duels WHERE status = 'completed' AND (challenger_id = $1 OR opponent_id = $1)
         ), r AS (SELECT lost, ROW_NUMBER() OVER (ORDER BY ts) rn FROM d),
         grp AS (SELECT lost, rn - ROW_NUMBER() OVER (PARTITION BY lost ORDER BY rn) AS island FROM r)
         SELECT COALESCE(MAX(cnt), 0)::int AS n FROM (
           SELECT COUNT(*) cnt FROM grp WHERE lost GROUP BY island
         ) s`, [uid]),
      // goose_egg : plus grand quiz terminé à 0 bonne réponse (0/N).
      pool.query(
        `SELECT COALESCE(MAX(total_questions), 0)::int AS n
         FROM quiz_history WHERE user_id = $1 AND COALESCE(score, 0) = 0 AND total_questions IS NOT NULL`, [uid]),
    ]);
    const stats = {
      captures: wordsQ.rows[0].n,
      mastered: masteredQ.rows[0].n,
      quiz: quizQ.rows[0].n,
      duel_win: duelQ.rows[0].won,
      duel_play: duelQ.rows[0].played,
      money: meQ.rows[0]?.balance || 0,
      pack_create: packCreateQ.rows[0].n,
      pack_buy: packBuyQ.rows[0].n,
      streak: daysQ.rows[0].n,
      comeback: comebackQ.rows[0].n,
      duel_loss: lossStreakQ.rows[0].n,
      goose_egg: gooseQ.rows[0].n,
    };

    // Trophées déjà débloqués.
    const { rows: owned } = await pool.query('SELECT trophy_id, unlocked_at FROM user_trophies WHERE user_id = $1', [uid]);
    const unlockedMap = new Map(owned.map((r) => [r.trophy_id, r.unlocked_at]));

    // Débloque les paliers atteints pas encore possédés + crédite (atomique).
    const toAward = [];
    for (const c of TROPHY_CATALOG) {
      for (const [target, reward] of c.tiers) {
        const id = trophyId(c.cat, target, c.yearly);
        if ((stats[c.cat] || 0) >= target && !unlockedMap.has(id)) toAward.push({ id, reward, cat: c.cat, target });
      }
    }
    const firstSync = !meQ.rows[0]?.trophies_init;
    let newlyUnlocked = [];
    if (toAward.length || firstSync) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (firstSync) {
          // 1er sync : backfill des paliers déjà atteints à 0 ₵ (badges rétro, aucun
          // crédit → pas d'inflation). Pas de célébration (newlyUnlocked vide).
          for (const a of toAward) {
            await client.query(
              'INSERT INTO user_trophies (user_id, trophy_id, coins_awarded) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING',
              [uid, a.id]);
            unlockedMap.set(a.id, new Date().toISOString());
          }
          await client.query('UPDATE users SET trophies_init = TRUE WHERE id = $1', [uid]);
        } else {
          // Débloque + crédite les paliers franchis (une seule fois chacun).
          let credited = 0;
          for (const a of toAward) {
            const ins = await client.query(
              'INSERT INTO user_trophies (user_id, trophy_id, coins_awarded) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING trophy_id',
              [uid, a.id, a.reward]);
            if (ins.rowCount) { credited += a.reward; newlyUnlocked.push(a); unlockedMap.set(a.id, new Date().toISOString()); }
          }
          if (credited > 0) {
            await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [credited, uid]);
            await client.query(
              `INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, 'trophy', $3)`,
              [uid, credited, `Trophies unlocked (${newlyUnlocked.length})`]);
          }
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        console.error('trophy award error:', e.message);
        newlyUnlocked = [];
      } finally { client.release(); }
    }

    const categories = TROPHY_CATALOG.map((c) => ({
      key: c.cat,
      unit: c.unit,
      yearly: !!c.yearly,
      trophies: c.tiers.map(([target, reward]) => {
        const id = trophyId(c.cat, target, c.yearly);
        return {
          id, target, reward, unit: c.unit,
          current: Math.min(stats[c.cat] || 0, target),
          value: stats[c.cat] || 0,
          unlocked: unlockedMap.has(id),
          unlocked_at: unlockedMap.get(id) || null,
        };
      }),
    }));

    const { rows: bal } = await pool.query('SELECT balance FROM users WHERE id = $1', [uid]);
    res.json({ balance: bal[0]?.balance || 0, categories, newlyUnlocked });
  } catch (e) {
    console.error('m/trophies error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/settings : préférences (direction, langue, toggles) ───────────
router.get('/api/m/settings', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT quiz_direction, interface_lang, learning_lang, native_lang, ghost_mode,
              notifications_enabled, word_review_enabled,
              notif_duels, notif_packs, notif_social, notif_reminders
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
      // Catégories (par défaut actives) — gated par le master ci-dessus.
      notif_duels: u.notif_duels !== false,
      notif_packs: u.notif_packs !== false,
      notif_social: u.notif_social !== false,
      notif_reminders: u.notif_reminders !== false,
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
    // Toggles de catégories de notifs.
    for (const col of ['notif_duels', 'notif_packs', 'notif_social', 'notif_reminders']) {
      if (typeof body[col] === 'boolean') push(col, body[col]);
    }

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

// ── GET /api/m/account/export : export des données perso (RGPD, portabilité) ──
// IMPORTANT : on EXCLUT volontairement la COLLECTION de vocabulaire (user_mots) et
// tout champ qui la révélerait (quiz_history.words_used, duels.quiz_data) → protection
// anti-migration de plateforme. Une vraie demande d'accès (Art. 15) incluant la
// collection reste traitable manuellement via info@jiayou.fr (mention dans le JSON).
router.get('/api/m/account/export', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  try {
    const [u, qh, tx, dz, tr, sub] = await Promise.all([
      pool.query(
        `SELECT id, email, name, tagline, country, provider, created_at, last_login, balance,
                email_verified, role, interface_lang, native_lang, learning_lang, quiz_direction,
                referral_code, avatar_icon, avatar_color, notifications_enabled,
                notif_duels, notif_packs, notif_social, notif_reminders, rc_expires_at, rc_will_renew
           FROM users WHERE id = $1`, [uid]),
      // historique quiz SANS words_used (ne pas divulguer les mots pratiqués)
      pool.query(
        `SELECT score, total_questions, ratio, quiz_type, lang, coins_earned, date_completed
           FROM quiz_history WHERE user_id = $1 ORDER BY date_completed`, [uid]),
      pool.query(
        `SELECT amount, type, description, created_at
           FROM transactions WHERE user_id = $1 ORDER BY created_at`, [uid]),
      // duels SANS quiz_data (qui contient les mots)
      pool.query(
        `SELECT id, duel_type, quiz_type, challenger_id, opponent_id, challenger_score,
                opponent_score, status, winner_id, bet_amount, word_count, lang, created_at, completed_at
           FROM duels WHERE challenger_id = $1 OR opponent_id = $1 ORDER BY created_at`, [uid]),
      pool.query(
        `SELECT trophy_id, coins_awarded, unlocked_at
           FROM user_trophies WHERE user_id = $1 ORDER BY unlocked_at`, [uid]),
      pool.query(
        `SELECT plan_name, status, current_period_start, current_period_end, cancel_at_period_end, created_at
           FROM user_subscriptions WHERE user_id = $1 ORDER BY created_at`, [uid]),
    ]);
    if (!u.rows.length) return res.status(404).json({ error: 'User not found' });
    const payload = {
      _about: 'Jiayou personal data export (GDPR Art. 20). Your vocabulary collection is intentionally NOT included. To request a full access copy including your collection (GDPR Art. 15), email info@jiayou.fr.',
      _generated_at: new Date().toISOString(),
      profile: u.rows[0],
      quiz_history: qh.rows,
      transactions: tx.rows,
      duels: dz.rows,
      trophies: tr.rows,
      subscription: sub.rows,
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="jiayou-data-export.json"');
    res.send(JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error('m/account export error:', e);
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
    // RGPD — effacement complet : le dictionnaire collaboratif garde des liens vers
    // l'auteur des éditions (mots.last_edited_by, edit_log.user_id, sans FK → non
    // cascadés). On les ANONYMISE (NULL) pour ne pas laisser l'id d'un compte
    // supprimé traîner dans l'historique, tout en conservant l'intégrité de l'audit.
    await client.query('UPDATE mots SET last_edited_by = NULL WHERE last_edited_by = $1', [uid]);
    await client.query('UPDATE edit_log SET user_id = NULL WHERE user_id = $1', [uid]);
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


// ── Social / compétition (duels, leaderboard, parrainage) → routes/mobile/social.js ──
require('./mobile/social')(router, { requireToken, notify, getUserLangs, isUserPremium, FREE_LIMITS, countToday, creditReferralByCode });



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
