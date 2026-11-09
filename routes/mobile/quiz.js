// ════════════════════════════════════════════════════════════════════════════
//  QUIZ (JWT) — packs entraînables, mots à réviser, stats, sauvegarde de session.
//  Extrait de routes/mobile.js. Monté via registerQuizRoutes(router, deps).
// ════════════════════════════════════════════════════════════════════════════
const { pool } = require('../../config/database');
const { updateWordScore } = require('../../middleware/index');

module.exports = function registerQuizRoutes(router, deps) {
  const { requireToken, notify, getUserLangs, isUserPremium, FREE_LIMITS, countToday, syncConceptSiblings } = deps;

// ── GET /api/m/quiz/packs : packs entraînables (créés ∪ achetés) ─────────────
// word_count = mots du pack réellement possédés (donc quizzables).
router.get('/api/m/quiz/packs', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    // Parcours-conscient : les mots du pack sont résolus par CONCEPT (lexeme_senses →
    // meaning_id) puis matchés à la collection de l'utilisateur DANS SA LANGUE APPRISE.
    // Une jointure directe um.mot_id = i.mot_id ne marcherait que si l'apprenant
    // pratique la langue de stockage des items (zh) ; un apprenant en←zh possède
    // les mots ANGLAIS du même concept, pas les mot_id chinois du pack.
    const langs = await getUserLangs(uid);
    const { rows } = await pool.query(
      `SELECT wp.id, wp.title, wp.cover_key, wp.cover_color, wp.cover_icon, wp.logo_url, wp.is_official,
              COALESCE(u.name, wp.creator_name, 'Anonymous') AS creator,
              (SELECT COUNT(*) FROM user_mots um
                 JOIN mots mo ON mo.id = um.mot_id AND mo.lang = $2
               WHERE um.user_id = $1 AND (
                 um.mot_id IN (SELECT mot_id FROM word_pack_items WHERE pack_id = wp.id)
                 OR um.meaning_id IN (
                   SELECT lp.meaning_id FROM word_pack_items i
                   JOIN mots pm ON pm.id = i.mot_id AND pm.lang <> $2
                   JOIN lexeme_senses lp ON lp.mot_id = i.mot_id
                   WHERE i.pack_id = wp.id)))::int AS word_count,
              (SELECT COALESCE(ROUND(AVG(um.score)), 0) FROM user_mots um
                 JOIN mots mo ON mo.id = um.mot_id AND mo.lang = $2
               WHERE um.user_id = $1 AND (
                 um.mot_id IN (SELECT mot_id FROM word_pack_items WHERE pack_id = wp.id)
                 OR um.meaning_id IN (
                   SELECT lp.meaning_id FROM word_pack_items i
                   JOIN mots pm ON pm.id = i.mot_id AND pm.lang <> $2
                   JOIN lexeme_senses lp ON lp.mot_id = i.mot_id
                   WHERE i.pack_id = wp.id)))::int AS mastery
       FROM word_packs wp
       LEFT JOIN users u ON u.id = wp.creator_id
       WHERE wp.creator_id = $1
          OR wp.id IN (SELECT pack_id FROM pack_purchases WHERE buyer_id = $1)
       ORDER BY wp.created_at DESC`, [uid, langs.learning]);
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
      // Parcours-conscient (cf. /api/m/quiz/packs) : on résout les items du pack par
      // CONCEPT puis on tire les mots possédés dans la LANGUE APPRISE. Indispensable
      // pour un apprenant en←zh (ses mots sont anglais, pas les mot_id chinois du pack).
      // Appartenance au pack SANS fuite inter-concepts : un mot possédé compte pour le
      // pack s'il EST un item du pack (match direct mot_id — exact dans la langue des
      // items), OU — uniquement pour les items d'une AUTRE langue — s'il partage leur
      // concept (bridge par meaning, indispensable au cross-langue en←zh). Résoudre
      // TOUT par meaning fuitait : des synonymes zh distincts partageant un même concept
      // (ex. 到 tiré par 达到) remontaient dans le quiz d'un pack dont ils ne font pas partie.
      const { rows } = await pool.query(
        `SELECT m.id, m.chinese, m.pinyin, mot_tr_sense(m.id, um.meaning_id, $4) AS english, m.hsk, um.description, COALESCE(um.${scoreCol}, 0) AS score
         FROM user_mots um
         JOIN mots m ON m.id = um.mot_id AND m.lang = $5
         WHERE um.user_id = $1 AND (
           um.mot_id IN (SELECT mot_id FROM word_pack_items WHERE pack_id = $2)
           OR um.meaning_id IN (
             SELECT lp.meaning_id FROM word_pack_items i
             JOIN mots pm ON pm.id = i.mot_id AND pm.lang <> $5
             JOIN lexeme_senses lp ON lp.mot_id = i.mot_id
             WHERE i.pack_id = $2))
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
        `SELECT m.id, m.chinese, m.pinyin, mot_tr_sense(m.id, um.meaning_id, $3) AS english, m.hsk, um.description, COALESCE(um.score, 0) AS score
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
      SELECT m.id, m.chinese, m.pinyin, mot_tr_sense(m.id, um.meaning_id, $${natIdx}) AS english, m.hsk, um.description, COALESCE(um.score, 0) AS score
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
// Mots les plus ratés vus RÉCEMMENT (fenêtre glissante ~2 semaines via last_seen),
// classés par taux d'échec puis score bas. Max 20. Approximation : faute d'un
// journal d'essais horodaté, on utilise last_seen (dernière révision) + le taux
// d'échec cumulé — proche de « les plus échoués sur 2 semaines ».
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
         AND um.last_seen >= NOW() - INTERVAL '14 days'
         AND ((um.nb_quiz >= 2 AND (um.nb_correct::float / um.nb_quiz) < 0.6) OR COALESCE(um.score,0) < 50)
       ORDER BY error_rate DESC, COALESCE(um.score,0) ASC, um.last_seen ASC NULLS FIRST
       LIMIT 20`,
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
                COUNT(*) FILTER (WHERE COALESCE(um.score, 0) >= 85)::int AS mastered
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
          // Récompense dégressive avec la maîtrise, mais un mot maîtrisé (≥85, même
          // borne que « mastered ») rapporte 0.2 au lieu de 0.1 : réviser ses mots
          // acquis ne doit pas payer quasi rien.
          if (s < 50) raw += 0.5; else if (s < 85) raw += 0.3; else raw += 0.2;
        }
        // Bonus : sens supplémentaires correctement donnés (mots à plusieurs
        // traductions) → 0.1 pièce chacun. Plafonné pour éviter tout abus.
        const bonusTotal = results.reduce((n, r) => n + (Number.isInteger(r?.bonus) && r.bonus > 0 ? Math.min(r.bonus, 5) : 0), 0);
        raw += bonusTotal * 0.1;
        // Plancher anti-zéro : au moins 1 coin dès qu'il y a une bonne réponse
        // (sinon Math.round d'un petit total tombait à 0 → quiz « gratuit »).
        coinsEarned = raw > 0 ? Math.max(1, Math.round(raw)) : 0;
      }
    }

    const wordsForHistory = Array.isArray(results) ? results.map((r) => r.pinyin) : [];
    const quizLang = (await getUserLangs(userId)).learning; // tag pour stats par parcours
    await client.query(
      `INSERT INTO quiz_history (user_id, score, total_questions, ratio, quiz_type, words_used, lang, coins_earned)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, scoreNum, totalNum, ratio, quiz_type, JSON.stringify(wordsForHistory), quizLang, coinsEarned]
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

};
