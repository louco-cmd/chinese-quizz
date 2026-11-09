// ════════════════════════════════════════════════════════════════════════════
//  COMPTE / PROFIL — page account (stats, maîtrise, HSK, heatmap), édition du
//  profil, profil public d'un user, trophées, réglages, langues & parcours
//  d'apprentissage, export RGPD et suppression de compte.
//  Extrait de routes/mobile.js. Monté via registerAccountRoutes(router, deps).
// ════════════════════════════════════════════════════════════════════════════
const { pool } = require('../../config/database');

module.exports = function registerAccountRoutes(router, deps) {
  const { requireToken, notify, getUserLangs, LANG_CATALOG, resolveCourseLangs, setActiveLangs, ensureLearnable, isUserPremium, PREMIUM_PACK_COVERS, splitSenses, isVerified, verifyRequired, learnableLangs } = deps;

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

};
