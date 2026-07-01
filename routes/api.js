const express = require('express');
const { pool } = require('../config/database');
const router = express.Router();
const crypto = require('crypto');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
  addTransaction,
  selectWordsNormal,
  selectForAdvancedUser,
  isValidEmail
} = require('../middleware/index');
const { withSubscription, canPlayDuel, canAddWord, canTakeQuiz } = require('../middleware/subscription');
const { sendPushToUser } = require('../middleware/push.service');
const dailyCache = new Map(); // ⬅️ AJOUTER CECI EN HAUT



// ---------------------API

router.get('/account-info', ensureAuth, async (req, res) => {
  // Permet de récupérer les données d'un autre utilisateur si user_id est fourni
  const targetUserId = req.query.user_id || req.user.id;
  const currentUserId = req.user.id;

  try {
    // 1. Récupérer les infos utilisateur COMPLÈTES
    const userInfo = await pool.query(`
      SELECT name, tagline, country FROM users WHERE id = $1
    `, [targetUserId]);

    if (userInfo.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const user = userInfo.rows[0];

    // 2. Récupérer les mots avec leurs scores et niveau HSK
    const userMots = await pool.query(`
      SELECT 
        user_mots.score,
        user_mots.score_character,
        user_mots.mot_id,
        mots.chinese, 
        mots.pinyin, 
        mots.english,
        mots.hsk
      FROM user_mots 
      JOIN mots ON user_mots.mot_id = mots.id 
      WHERE user_mots.user_id = $1
    `, [targetUserId]);

    // 3. Calculer les stats HSK
    const hskStats = {
      HSK1: 0,
      HSK2: 0,
      HSK3: 0,
      HSK4: 0,
      HSK5: 0,
      HSK6: 0,
      Street: 0
    };

    userMots.rows.forEach(mot => {
      if (mot.hsk) {
        hskStats[`HSK${mot.hsk}`] = (hskStats[`HSK${mot.hsk}`] || 0) + 1;
      } else {
        hskStats.Street++;
      }
    });

    // 4. Récupérer les stats quiz/duels
    const quizStats = await pool.query(`
      SELECT COUNT(*) as total_quizzes
      FROM quiz_history 
      WHERE user_id = $1
    `, [targetUserId]);

    const duelStats = await pool.query(`
      SELECT COUNT(*) as total_duels
      FROM duels 
      WHERE challenger_id = $1 OR opponent_id = $1
    `, [targetUserId]);

    // Construire la réponse COMPLÈTE
    const response = {
      name: user.name,
      tagline: user.tagline,        // ← NOUVEAU
      country: user.country,        // ← NOUVEAU
      wordCount: userMots.rows.length,
      user_mots: userMots.rows,
      stats: {
        ...hskStats,
        total_quizzes: parseInt(quizStats.rows[0].total_quizzes),
        total_duels: parseInt(duelStats.rows[0].total_duels)
      }
    };

    res.json(response);

  } catch (err) {
    console.error('❌ Erreur /account-info:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get("/api/contributions", ensureAuth, async (req, res) => {
  try {
    console.log('🔍 Requête reçue pour /api/contributions');
    console.log('🔍 Utilisateur connecté (req.user) :', req.user);
    console.log('🔍 Paramètres query:', req.query);

    const userId = req.user ? req.user.id : null;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    if (!userId) {
      console.warn('⚠️ Aucun utilisateur connecté');
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // 🎯 CORRECTION : Filtrer par année
    const result = await pool.query(`
      SELECT 
        DATE(date_completed) as date,
        COUNT(*) as count
      FROM quiz_history 
      WHERE user_id = $1 
        AND EXTRACT(YEAR FROM date_completed) = $2
      GROUP BY DATE(date_completed)
      ORDER BY date ASC
    `, [userId, year]);

    const rows = result.rows.map(r => ({
      date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
      count: parseInt(r.count, 10) || 0
    }));

    console.log(`📦 Résultat des contributions pour ${year}:`, rows);
    res.json(rows);
  } catch (error) {
    console.error('❌ Erreur dans /api/contributions :', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get("/api/quiz/history", ensureAuth, async (req, res) => {
  try {
    console.log('📊 Route /api/quiz/history routerelée');
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 10;

    // Récupérer les derniers quiz
    const quizzesResult = await pool.query(
      `SELECT * FROM quiz_history 
       WHERE user_id = $1 
       ORDER BY date_completed DESC 
       LIMIT $2`,
      [userId, limit]
    );

    // Récupérer les stats globales - avec COALESCE pour gérer les valeurs NULL
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_quizzes,
        COALESCE(AVG(ratio), 0) as average_ratio,
        COALESCE(MAX(ratio), 0) as best_score
      FROM quiz_history 
      WHERE user_id = $1
    `, [userId]);

    console.log(`📊 Données trouvées: ${quizzesResult.rows.length} quiz`);

    res.json({
      quizzes: quizzesResult.rows,
      stats: statsResult.rows[0]
    });

  } catch (err) {
    console.error('❌ Erreur récupération historique quiz:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/quiz/save", ensureAuth, express.json(), async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    console.log('💾 /api/quiz/save - Données reçues:', req.body);

    const {
      score,
      total_questions,
      quiz_type,
      results,
      words_used
    } = req.body;

    if (score === undefined || total_questions === undefined || !quiz_type) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: 'Données manquantes' });
    }

    const scoreNum = parseInt(score);
    const totalNum = parseInt(total_questions);
    const ratio = ((scoreNum / totalNum) * 100).toFixed(2);

    // 🔥 NOUVEAU : Calcul des pièces gagnées selon les conditions
    let coinsEarned = 0;
    if (scoreNum === 0) {
      coinsEarned = 0;
    } else if (ratio > 0 && ratio <= 50) {
      coinsEarned = 2;
    } else if (ratio > 50 && ratio <= 70) {
      coinsEarned = 3;
    } else if (ratio > 70) {
      coinsEarned = 5;
    }

    console.log(`💰 Calcul récompense: ${scoreNum}/${totalNum} = ${ratio}% → ${coinsEarned} coins`);

    let wordsForHistory = [];

    if (words_used) {
      wordsForHistory = words_used;
    } else if (results) {
      wordsForHistory = results.map(r => r.pinyin);
    }

    console.log('📝 Données pour historique:', wordsForHistory);

    // 1. Sauvegarder le quiz dans l'historique
    const quizResult = await client.query(
      `INSERT INTO quiz_history 
       (user_id, score, total_questions, ratio, quiz_type, words_used) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [req.user.id, scoreNum, totalNum, ratio, quiz_type, JSON.stringify(wordsForHistory)]
    );

    // 2. Mettre à jour les scores des mots (si présents)
    if (results && Array.isArray(results)) {
      console.log(`🔄 Mise à jour de ${results.length} scores de mots...`);

      for (const result of results) {
        if (result.mot_id && result.correct !== null && result.correct !== undefined) {
          await updateWordScore(req.user.id, result.mot_id, result.correct, quiz_type);
        }
      }
      console.log('✅ Tous les scores mis à jour');
    } else {
      console.log('ℹ️ Aucun résultat détaillé à traiter');
    }

    // 3. 🔥 MODIFIÉ : Créditer la récompense conditionnelle au joueur

    // Récupérer le solde actuel avec verrou (FOR UPDATE)
    const { rows: userRows } = await client.query(
      "SELECT balance FROM users WHERE id = $1 FOR UPDATE",
      [req.user.id]
    );

    if (userRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Utilisateur introuvable" });
    }

    // Insérer la transaction + mise à jour du solde (seulement si coins gagnés)
    if (coinsEarned > 0) {
      await client.query(
        "INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, $3, $4)",
        [req.user.id, coinsEarned, 'quiz_reward',
        `Quiz ${quiz_type}: ${scoreNum}/${totalNum} correct (${ratio}%) - ${coinsEarned} coins earned`]
      );

      await client.query(
        "UPDATE users SET balance = balance + $1 WHERE id = $2",
        [coinsEarned, req.user.id]
      );

      console.log(`💰 ${coinsEarned} coins crédités à l'utilisateur ${req.user.id}`);
    } else {
      console.log(`ℹ️ Aucune récompense pour ${scoreNum}/${totalNum} (${ratio}%)`);
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      quiz: quizResult.rows[0],
      coins_earned: coinsEarned, // 🔥 NOUVEAU : Retourner le nombre de pièces gagnées
      message: `Quiz sauvegardé avec ${results ? results.length : 0} scores mis à jour${coinsEarned > 0 ? `, et ${coinsEarned} coins crédités` : ', aucune récompense'}`
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error('❌ Erreur sauvegarde quiz:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.get("/api/tous-les-mots", ensureAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM mots 
      ORDER BY id ASC
    `);

    console.log(`📚 Chargement de ${rows.length} mots depuis la table 'mots'`);
    res.json(rows);

  } catch (err) {
    console.error('❌ Erreur /api/tous-les-mots:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/mes-mots", ensureAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(`
      SELECT mots.*, 
             user_mots.score,
             user_mots.nb_quiz,
             user_mots.nb_correct
      FROM mots
      JOIN user_mots ON mots.id = user_mots.mot_id
      WHERE user_mots.user_id = $1
      ORDER BY user_mots.score ASC, mots.id ASC
    `, [userId]);

    console.log(`📊 ${rows.length} mots avec scores récupérés pour l'utilisateur ${userId}`);

    // Log du premier mot pour vérifier
    if (rows.length > 0) {
      console.log('🔍 Exemple mot avec score:', {
        id: rows[0].id,
        chinese: rows[0].chinese,
        score: rows[0].score,
        nb_quiz: rows[0].nb_quiz
      });
    }

    res.json(rows);

  } catch (err) {
    console.error('❌ Erreur récupération mes-mots:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/verifier", ensureAuth, async (req, res) => {
  const { chinese, answer } = req.body;
  try {
    const { rows } = await pool.query("SELECT * FROM mots WHERE chinese=$1", [chinese]);
    const row = rows[0];
    const correct = row && row.english.toLowerCase() === answer.toLowerCase();
    res.json({ correct, correctAnswer: row ? row.english : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/ajouter",
  ensureAuth,
  withSubscription,
  canAddWord,      // ← Vérifie le nombre TOTAL de mots
  async (req, res) => {  // UN SEUL handler
    // AJOUTEZ CES LOGS POUR DÉBOGUER
    console.log('🔍 DEBUG canAddWord - user object:', {
      id: req.user.id,
      isPremium: req.user.isPremium,
      planName: req.user.planName,
      subscription: req.user.subscription
    });
    // VÉRIFIER SI LA LIMITE EST ATTEINTE
    console.log('🎯 /ajouter route handler called');
    console.log('🔍 req.limitReached:', req.limitReached);
    console.log('🔍 req.limitData:', req.limitData);
    if (req.limitReached) {
      console.log('🚫 Returning limit reached response');

      return res.json({
        success: false,
        limitReached: true,
        current: req.limitData.current,
        max: req.limitData.max,
        message: `Word limit reached (${req.limitData.current}/${req.limitData.max})`
      });
    }

    const { chinese, pinyin, english, description, hsk } = req.body;
    const userId = req.user.id;

    const COST = 3;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Vérifier solde
      const { rows: userRows } = await client.query(
        "SELECT balance FROM users WHERE id=$1 FOR UPDATE",
        [userId]
      );

      if (userRows.length === 0) {
        await client.query("ROLLBACK");
        return res.json({ success: false, message: "User not found." });
      }

      const currentBalance = userRows[0].balance;

      if (currentBalance < COST) {
        await client.query("ROLLBACK");
        return res.json({
          success: false,
          message: "Insufficient balance (3 coins required)"
        });
      }

      // Vérifier si le mot existe
      let { rows } = await client.query(
        "SELECT id FROM mots WHERE chinese=$1",
        [chinese]
      );

      let motId;

      if (rows.length > 0) {
        motId = rows[0].id;
      } else {
        const insertRes = await client.query(
          `INSERT INTO mots (chinese,pinyin,english,description,hsk)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING id`,
          [chinese, pinyin, english, description, hsk]
        );
        motId = insertRes.rows[0].id;
      }

      // Vérifier si déjà possédé
      const { rows: userMotRows } = await client.query(
        "SELECT 1 FROM user_mots WHERE user_id=$1 AND mot_id=$2",
        [userId, motId]
      );

      if (userMotRows.length > 0) {
        await client.query("ROLLBACK");
        return res.json({
          success: false,
          message: "You already captured this word"
        });
      }

      // Débiter
      await client.query(
        "UPDATE users SET balance = balance - $1 WHERE id = $2",
        [COST, userId]
      );

      // Transaction
      await client.query(
        `INSERT INTO transactions (user_id, amount, type, description)
         VALUES ($1, $2, $3, $4)`,
        [userId, -COST, "capture_word", `Captured word ${chinese}`]
      );

      // Associer le mot
      await client.query(
        "INSERT INTO user_mots (user_id, mot_id) VALUES ($1,$2)",
        [userId, motId]
      );

      await client.query("COMMIT");

      res.json({
        success: true,
        motId,
        newBalance: currentBalance - COST,
        message: "Word added successfully. 3 coins deducted.",
        wordCount: req.user.currentWordCount + 1  // Nouveau total
      });

    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Error adding word:", err);
      res.status(500).json({ success: false, message: "Internal server error." });
    } finally {
      client.release();
    }
  }
);

router.post("/mes-mots/delete", ensureAuth, async (req, res) => {
  const userId = req.user.id; // L'id de l'utilisateur connecté
  const { mot_id } = req.body;

  if (!mot_id) {
    return res.status(400).json({ error: "mot_id manquant" });
  }

  try {
    // Supprimer le mot de la liste personnelle de l'utilisateur
    const result = await pool.query(
      `DELETE FROM user_mots WHERE user_id = $1 AND mot_id = $2 RETURNING *`,
      [userId, mot_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Mot non trouvé dans votre liste" });
    }

    res.json({ success: true, message: "Mot supprimé avec succès" });
  } catch (err) {
    console.error("Erreur suppression mot :", err);
    res.status(500).json({ error: "Erreur serveur lors de la suppression" });
  }
});

router.get("/liste", ensureAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM mots ORDER BY id ASC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/update/:id", ensureAuth, async (req, res) => {
  const { id } = req.params;
  const { chinese, pinyin, english, description, description_zh, hsk } = req.body;
  const isAdmin = req.user?.is_admin;

  // Validation : on borne la taille des champs (anti-abus / anti-payload géant)
  const lim = (v, max) => v == null || (typeof v === 'string' && v.length <= max);
  if (!lim(chinese, 50) || !lim(pinyin, 100) || !lim(english, 300)
      || !lim(description, 2000) || !lim(description_zh, 2000)) {
    return res.status(400).json({ error: 'Champ trop long ou invalide' });
  }

  try {
    if (!isAdmin) {
      const { rows } = await pool.query(
        "SELECT chinese, pinyin, english, hsk FROM mots WHERE id=$1",
        [id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Word not found" });
      const current = rows[0];

      if (current.hsk !== null && (chinese !== current.chinese || pinyin !== current.pinyin || english !== current.english)) {
        return res.status(403).json({
          error: 'forbidden',
          message: 'Only Admin can modify translation/pinyin/characters of verified HSK words, if you got feedback, please contact support.'
        });
      }

      await pool.query("UPDATE mots SET chinese=$1,pinyin=$2,english=$3,description=$4,description_zh=$5 WHERE id=$6", [chinese, pinyin, english, description, description_zh || null, id]);
      return res.json({ success: true });
    }

    await pool.query(
      "UPDATE mots SET chinese=$1,pinyin=$2,english=$3,description=$4,description_zh=$5,hsk=$6 WHERE id=$7",
      [chinese, pinyin, english, description, description_zh || null, hsk, id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "update failed" });
  }
});

router.get("/check-mot/:chinese", ensureAuth, async (req, res) => {
  const { chinese } = req.params;
  try {
    const { rows } = await pool.query("SELECT * FROM mots WHERE chinese=$1", [chinese]);
    if (rows.length > 0) {
      res.json({ exists: true, mot: rows[0] });
    } else {
      res.json({ exists: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recherche par mot anglais (mode zh→en : apprendre anglais depuis le chinois)
router.get("/check-mot-by-english/:english", ensureAuth, async (req, res) => {
  const english = decodeURIComponent(req.params.english).trim().toLowerCase();
  try {
    // Match exact uniquement — "fuck" ne doit pas matcher "fucking awesome"
    // Tolérance slash : "good / fine" → chaque variante séparée par " / "
    const { rows } = await pool.query(
      `SELECT * FROM mots WHERE LOWER(english) = $1 LIMIT 5`,
      [english]
    );
    if (rows.length > 0) {
      res.json({ exists: true, mot: rows[0], results: rows });
    } else {
      res.json({ exists: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/check-user-word/:chinese", ensureAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    const chinese = decodeURIComponent(req.params.chinese);
    console.log('🔍 DEBUG - Vérification:', { userId, chinese });

    const { rows } = await pool.query(`
      SELECT mots.*
      FROM mots
      JOIN user_mots ON mots.id = user_mots.mot_id
      WHERE user_mots.user_id = $1 AND mots.chinese = $2
    `, [userId, chinese]);

    console.log('✅ DEBUG - Résultats:', rows);
    const alreadyExists = rows.length > 0;

    res.json({ alreadyExists });

  } catch (err) {
    console.error('❌ DEBUG - Erreur:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/quiz-mots', ensureAuth, withSubscription, canTakeQuiz, async (req, res) => {
  const userId = req.user.id;
  const requestedCount = parseInt(req.query.count) || 10;
  const hskParam = req.query.hsk || 'all';
  const difficulty = req.query.difficulty || 'balanced';
  const idsParam = req.query.ids; // ← liste explicite d'IDs (utilisée par le "quick quiz")

  console.log('🎯 API /quiz-mots appelée', { userId, requestedCount, hskParam, difficulty, idsParam });

  // === MODE LISTE EXPLICITE ===
  // Si "ids" est fourni, on bypasse toute la logique HSK/difficulté/cooldown :
  // on retourne exactement les mots demandés (qui appartiennent à l'utilisateur).
  if (idsParam) {
    try {
      const ids = idsParam
        .split(',')
        .map(s => parseInt(s, 10))
        .filter(n => Number.isInteger(n) && n > 0)
        .slice(0, 100);

      if (!ids.length) {
        return res.status(400).json({ success: false, error: 'invalid_ids' });
      }

      const { rows } = await pool.query(`
        SELECT
          m.*,
          COALESCE(um.score, 0) AS score,
          COALESCE(um.nb_quiz, 0) AS nb_quiz,
          um.last_seen
        FROM user_mots um
        INNER JOIN mots m ON um.mot_id = m.id
        WHERE um.user_id = $1 AND m.id = ANY($2)
      `, [userId, ids]);

      if (!rows.length) {
        return res.status(400).json({
          success: false,
          error: 'not_enough_words_in_collection',
          message: 'No matching words in your collection.',
          requested: ids.length,
          available: 0
        });
      }

      // Mélange + mise à jour last_seen (cohérent avec le mode normal)
      rows.sort(() => Math.random() - 0.5);
      await pool.query(
        `UPDATE user_mots SET last_seen = NOW() WHERE user_id = $1 AND mot_id = ANY($2)`,
        [userId, rows.map(r => r.id)]
      );

      return res.json({
        success: true,
        words: rows,
        count: rows.length,
        requestedCount: ids.length,
        mode: 'explicit_ids'
      });
    } catch (err) {
      console.error('💥 ERREUR /quiz-mots (ids mode):', err);
      return res.status(500).json({ success: false, error: 'server_error' });
    }
  }

  try {
    // =============================
    // 1. PARSER LE PARAMÈTRE HSK
    // =============================
    let hskMin = null;
    let hskMax = null;
    let includeStreet = false;

    if (hskParam === 'all') {
      // aucun filtre
    } else if (hskParam === 'street') {
      includeStreet = true; // seulement street
    } else {
      const parts = hskParam.split('-');
      if (parts.length === 2) {
        hskMin = parseInt(parts[0]);
        hskMax = parseInt(parts[1]);
        if (hskMax === 7) {
          includeStreet = true;
          hskMax = 6; // on traite les niveaux 1-6 normalement, street à part
        }
      } else {
        // Si un seul nombre (ancien format), on le traite comme min=max
        const level = parseInt(hskParam);
        if (!isNaN(level) && level >= 1 && level <= 6) {
          hskMin = hskMax = level;
        } else {
          return res.status(400).json({ error: 'Invalid hsk parameter' });
        }
      }
    }

    // =============================
    // 2. DÉTERMINER LES RANGES DE SCORE SELON LA DIFFICULTÉ
    // =============================
    // Les ranges sont ordonnés par priorité : on tente le plus strict d'abord,
    // puis on élargit progressivement si pas assez de mots.
    const difficultyRanges = {
      discovery: [
        { scoreMin: 0, scoreMax: 29 },
        { scoreMin: 0, scoreMax: 49 },
        { scoreMin: 0, scoreMax: 69 },
        { scoreMin: 0, scoreMax: 100 }, // fallback total
      ],
      balanced: [
        { scoreMin: 30, scoreMax: 80 },
        { scoreMin: 15, scoreMax: 90 },
        { scoreMin: 5,  scoreMax: 95 },
        { scoreMin: 0,  scoreMax: 100 },
      ],
      revision: [
        { scoreMin: 80, scoreMax: 100 },
        { scoreMin: 60, scoreMax: 100 },
        { scoreMin: 40, scoreMax: 100 },
        { scoreMin: 0,  scoreMax: 100 },
      ],
    };
    const activeRanges = difficultyRanges[difficulty] || [{ scoreMin: 0, scoreMax: 100 }];

    // =============================
    // Helper : construit les clauses WHERE HSK (réutilisé 2 fois)
    // =============================
    const buildHskClause = (paramStart) => {
      const conditions = [];
      const params = [];
      let idx = paramStart;
      if (hskMin !== null && hskMax !== null) {
        conditions.push(`m.hsk BETWEEN $${idx} AND $${idx + 1}`);
        params.push(hskMin, hskMax);
        idx += 2;
      }
      if (includeStreet || hskParam === 'street') {
        conditions.push(`m.hsk IS NULL`);
      }
      return { conditions, params, nextIdx: idx };
    };

    // =============================
    // 3. BOUCLE : trouver le range de score qui donne assez de mots
    // =============================
    // On pousse le filtre score + HSK + cooldown directement en SQL pour
    // éviter de récupérer des centaines de mots en mémoire pour en jeter 80%.

    const COOLDOWN_HOURS = 12;
    let finalPool = [];
    let bypassedCooldown = false;
    let cooldownBypassReason = null;
    let usedRange = activeRanges[activeRanges.length - 1]; // pour les logs

    for (const range of activeRanges) {
      const { conditions: hskConds, params: hskParams, nextIdx } = buildHskClause(4);

      // Requête principale : on filtre score + HSK + cooldown en SQL
      let q = `
        SELECT
          m.*,
          COALESCE(um.score, 0)            AS score,
          COALESCE(um.nb_quiz, 0)          AS nb_quiz,
          um.last_seen
        FROM user_mots um
        INNER JOIN mots m ON um.mot_id = m.id
        WHERE um.user_id = $1
          AND COALESCE(um.score, 0) BETWEEN $2 AND $3
          AND (
            um.last_seen IS NULL
            OR um.nb_quiz = 0
            OR EXTRACT(EPOCH FROM (NOW() - um.last_seen)) > ${ COOLDOWN_HOURS } * 3600
          )
      `;
      const qParams = [userId, range.scoreMin, range.scoreMax];

      if (hskConds.length > 0) {
        q += ` AND (` + hskConds.join(' OR ') + `)`;
        qParams.push(...hskParams);
      }

      q += ` ORDER BY RANDOM() LIMIT $${qParams.length + 1}`;
      qParams.push(requestedCount * 5); // large buffer pour avoir de la variété

      const { rows: freshWords } = await pool.query(q, qParams);
      console.log(`🔍 Range score [${range.scoreMin}-${range.scoreMax}] → ${freshWords.length} mots frais`);

      if (freshWords.length >= requestedCount) {
        finalPool = freshWords;
        usedRange = range;
        break;
      }

      // Pas assez de mots frais : on essaie sans le filtre cooldown pour ce range
      if (freshWords.length > 0 || range === activeRanges[activeRanges.length - 1]) {
        // Compléter avec des mots en cooldown si nécessaire
        const needed = requestedCount - freshWords.length;
        const { conditions: hskConds2, params: hskParams2 } = buildHskClause(3);

        let q2 = `
          SELECT
            m.*,
            COALESCE(um.score, 0)   AS score,
            COALESCE(um.nb_quiz, 0) AS nb_quiz,
            um.last_seen
          FROM user_mots um
          INNER JOIN mots m ON um.mot_id = m.id
          WHERE um.user_id = $1
            AND COALESCE(um.score, 0) BETWEEN ${ range.scoreMin } AND ${ range.scoreMax }
            AND (um.last_seen IS NOT NULL AND um.nb_quiz > 0
                 AND EXTRACT(EPOCH FROM (NOW() - um.last_seen)) <= ${ COOLDOWN_HOURS } * 3600)
            AND m.id <> ALL($2::int[])
        `;
        const q2Params = [userId, freshWords.map(w => w.id)];

        if (hskConds2.length > 0) {
          q2 += ` AND (` + hskConds2.join(' OR ') + `)`;
          q2Params.push(...hskParams2);
        }

        q2 += ` ORDER BY um.last_seen ASC LIMIT $${q2Params.length + 1}`;
        q2Params.push(needed);

        const { rows: cooldownWords } = await pool.query(q2, q2Params);

        const combined = [...freshWords, ...cooldownWords];
        if (combined.length >= requestedCount) {
          finalPool = combined;
          usedRange = range;
          bypassedCooldown = cooldownWords.length > 0;
          cooldownBypassReason = 'insufficient_fresh_words';
          console.log(`⚠️ Complété avec ${cooldownWords.length} mots en cooldown`);
          break;
        }

        // Même en ajoutant les cooldown on n'a pas assez : on garde quand même et continue l'élargissement
        if (combined.length > finalPool.length) {
          finalPool = combined;
          usedRange = range;
          bypassedCooldown = cooldownWords.length > 0;
          cooldownBypassReason = 'insufficient_fresh_words';
        }
      }
    }

    console.log(`📦 Pool final: ${finalPool.length} mots (range score [${usedRange.scoreMin}-${usedRange.scoreMax}]${bypassedCooldown ? `, cooldown ignoré: ${cooldownBypassReason}` : ''})`);

    // =============================
    // 4. COMPTAGE RÉEL DISPONIBLE (pour message d'erreur précis)
    // =============================
    if (finalPool.length < requestedCount) {
      // Compter combien de mots sont réellement dispo dans cette catégorie (sans filtre score)
      const { conditions: hskConds3, params: hskParams3 } = buildHskClause(2);
      let totalQ = `SELECT COUNT(*) AS total FROM user_mots um INNER JOIN mots m ON um.mot_id = m.id WHERE um.user_id = $1`;
      const totalParams = [userId];
      if (hskConds3.length > 0) {
        totalQ += ` AND (` + hskConds3.join(' OR ') + `)`;
        totalParams.push(...hskParams3);
      }
      const { rows: totalRows } = await pool.query(totalQ, totalParams);
      const totalInCollection = parseInt(totalRows[0].total);

      if (finalPool.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'not_enough_words_in_collection',
          message: `Vous avez ${totalInCollection} mots HSK ${hskParam} mais aucun ne correspond à la difficulté "${difficulty}".`,
          requested: requestedCount,
          available: 0,
          hskLevel: hskParam,
        });
      }

      // On retourne ce qu'on a avec un warning
      const actualCount = finalPool.length;
      return res.json({
        success: true,
        words: finalPool.slice(0, actualCount).sort(() => Math.random() - 0.5),
        warning: `Quiz limité à ${actualCount} mots (difficulté "${difficulty}" — seuls ${actualCount} mots correspondent sur ${totalInCollection} dans HSK ${hskParam})`,
        bypassedCooldown,
        count: actualCount,
        requestedCount,
        hskLevel: hskParam,
        difficulty,
        stats: {
          totalInCollection,
          freshWords: finalPool.filter(w => !w.last_seen || w.nb_quiz === 0).length,
          delivered: actualCount,
        }
      });
    }

    // =============================
    // 5. SÉLECTION FINALE
    // =============================
    const pickRandom = (arr, n) => {
      const shuffled = [...arr];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, n);
    };

    const selected = pickRandom(finalPool, requestedCount);
    console.log(`✅ Sélection finale: ${selected.length} mots (difficulté: ${difficulty}, HSK: ${hskParam})`);

    // Mise à jour last_seen
    if (selected.length > 0) {
      await pool.query(
        `UPDATE user_mots
         SET last_seen = NOW()
         WHERE user_id = $1 AND mot_id = ANY($2)`,
        [userId, selected.map(w => w.id)]
      );
    }

    // Réponse
    const response = {
      success: true,
      words: selected,
      count: selected.length,
      requestedCount,
      hskLevel: hskParam,
      difficulty,
      bypassedCooldown,
      stats: {
        scoreRange: `${usedRange.scoreMin}-${usedRange.scoreMax}`,
        freshWords: finalPool.filter(w => !w.last_seen || w.nb_quiz === 0).length,
        distribution: {
          weak:   selected.filter(w => w.score < 40).length,
          medium: selected.filter(w => w.score >= 40 && w.score < 75).length,
          strong: selected.filter(w => w.score >= 75).length
        }
      }
    };

    if (bypassedCooldown) {
      response.warning = "Certains mots ont été réutilisés avant la fin du délai de repos";
    }

    res.json(response);

  } catch (err) {
    console.error('💥 ERREUR /quiz-mots:', err);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Erreur serveur lors de la préparation du quiz'
    });
  }
});

// 🔍 DEBUG — état session courant
router.get('/api/user/me', ensureAuth, async (req, res) => {
  const dbUser = await pool.query(
    'SELECT id, name, email, quiz_direction, onboarding_done, ghost_mode FROM users WHERE id = $1',
    [req.user.id]
  );
  res.json({
    session: {
      id: req.user.id,
      name: req.user.name,
      quiz_direction: req.user.quiz_direction,
      ghost_mode: req.user.ghost_mode,
    },
    database: dbUser.rows[0] || null
  });
});

// ── Toggle ghost mode ─────────────────────────────────────────────────────────
router.post('/api/user/ghost-mode', ensureAuth, async (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'enabled must be boolean' });
    }
    await pool.query('UPDATE users SET ghost_mode = $1 WHERE id = $2', [enabled, req.user.id]);
    req.user.ghost_mode = enabled;
    res.json({ success: true, ghost_mode: enabled });
  } catch (err) {
    console.error('Ghost mode error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── Toggle learning direction (settings page) ────────────────────────────────
router.post('/api/user/learning-direction', ensureAuth, async (req, res) => {
  try {
    const VALID = ['en→zh', 'zh→en'];
    const { quiz_direction } = req.body;
    if (!VALID.includes(quiz_direction)) {
      return res.status(400).json({ success: false, message: 'Invalid direction' });
    }
    await pool.query('UPDATE users SET quiz_direction = $1 WHERE id = $2', [quiz_direction, req.user.id]);
    req.user.quiz_direction = quiz_direction;
    res.json({ success: true, quiz_direction });
  } catch (err) {
    console.error('Learning direction error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Définit le rôle (choisi à l'onboarding : élève ou professeur)
router.post('/api/user/role', ensureAuth, async (req, res) => {
  try {
    const VALID = ['student', 'teacher'];
    const { role } = req.body;
    if (!VALID.includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.user.id]);
    req.user.role = role;
    res.json({ success: true, role });
  } catch (err) {
    console.error('Set role error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/api/user/update-profile', ensureAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { name, tagline, country, quiz_direction } = req.body;

    const VALID_DIRECTIONS = ['zh→en', 'en→zh'];

    if (!name || name.length > 50) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Name is required and must be less than 50 characters'
      });
    }

    if (tagline && tagline.length > 100) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Tagline must be less than 100 characters'
      });
    }

    if (quiz_direction && !VALID_DIRECTIONS.includes(quiz_direction)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Invalid quiz direction'
      });
    }

    // Mettre à jour le profil
    await client.query(
      `UPDATE users
       SET name = $1, tagline = $2, country = $3, quiz_direction = $4
       WHERE id = $5`,
      [name, tagline, country, quiz_direction || 'en→zh', req.user.id]
    );

    await client.query('COMMIT');

    // Mettre à jour req.user en mémoire
    req.user.quiz_direction = quiz_direction || req.user.quiz_direction;

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating profile:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile'
    });
  } finally {
    client.release();
  }
});

router.post('/api/user/complete-onboarding', ensureAuth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE users SET onboarding_done = TRUE WHERE id = $1',
      [req.user.id]
    );
    req.user.onboarding_done = true;
    res.json({ success: true });
  } catch (error) {
    console.error('Error completing onboarding:', error);
    res.status(500).json({ success: false, message: 'Error completing onboarding' });
  }
});

router.get('/api/difficult-words', ensureAuth, async (req, res) => {
  const userId = req.user.id;
  const DISPLAY_COUNT = 10;
  const POOL_SIZE = 24;
  const CACHE_TTL_MS = 15 * 60 * 1000;

  // Cache court (15 min) pour éviter de re-tirer à chaque navigation,
  // mais assez court pour que les mots tournent plusieurs fois par jour.
  const cached = dailyCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json(cached.words);
  }

  // 1) Récupérer un pool plus large des mots "à problème", classés par taux d'erreur
  //    (le mot le plus raté en premier), puis score bas, puis ancienneté.
  const query = `
    SELECT
      m.id, m.chinese, m.pinyin, m.english,
      um.score, um.nb_quiz, um.nb_correct, um.last_seen,
      CASE
        WHEN COALESCE(um.nb_quiz, 0) >= 2
          THEN (1.0 - (COALESCE(um.nb_correct, 0)::float / NULLIF(um.nb_quiz, 0)))
        ELSE 0.5
      END AS error_rate
    FROM user_mots um
    JOIN mots m ON um.mot_id = m.id
    WHERE um.user_id = $1
      AND um.nb_quiz > 0
      AND (
        (um.nb_quiz >= 2 AND (um.nb_correct::float / um.nb_quiz) < 0.6)
        OR um.score < 50
      )
    ORDER BY
      error_rate DESC,
      um.score ASC,
      um.last_seen ASC NULLS FIRST
    LIMIT $2
  `;

  try {
    const { rows } = await pool.query(query, [userId, POOL_SIZE]);

    // 2) Échantillonner DISPLAY_COUNT mots dans le pool avec un biais "erreur élevée"
    //    → les mots les plus ratés sortent souvent, mais la liste tourne d'une session à l'autre.
    const pool_ = rows.map(r => ({
      ...r,
      // poids = taux d'erreur + bonus si score bas + plancher pour garder de la variété
      weight: 0.1 + (Number(r.error_rate) || 0) * 0.7 + (1 - Math.min(100, r.score || 0) / 100) * 0.2
    }));

    const picked = [];
    const remaining = [...pool_];
    const target = Math.min(DISPLAY_COUNT, remaining.length);
    for (let k = 0; k < target; k++) {
      const total = remaining.reduce((s, x) => s + x.weight, 0);
      if (total <= 0) {
        picked.push(...remaining.splice(0, target - k));
        break;
      }
      let r = Math.random() * total;
      let idx = 0;
      for (; idx < remaining.length; idx++) {
        r -= remaining[idx].weight;
        if (r <= 0) break;
      }
      if (idx >= remaining.length) idx = remaining.length - 1;
      picked.push(remaining[idx]);
      remaining.splice(idx, 1);
    }

    const result = picked.map(row => ({
      id: row.id,
      chinese: row.chinese,
      pinyin: row.pinyin || '',
      english: row.english || '',
      score: row.score
    }));

    dailyCache.set(userId, { expiresAt: Date.now() + CACHE_TTL_MS, words: result });
    res.json(result);
  } catch (err) {
    console.error('❌ Erreur difficult words:', err);
    res.status(500).json({ error: 'Database error' });
  }
});


// Prix par niveau HSK
const PACK_PRICES = { 1: 200, 2: 400 };

// Packs et gestion d'achat
router.post('/api/purchase-pack', ensureAuth, async (req, res) => {
  const userId = req.user.id;
  const hskLevel = parseInt(req.body.level);

  if (!PACK_PRICES[hskLevel]) {
    return res.status(400).json({ error: 'Invalid pack level' });
  }

  const packPrice = PACK_PRICES[hskLevel];

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Verrouiller l'utilisateur pour éviter les concurrences
    const { rows: userRows } = await client.query(
      'SELECT balance FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (userRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const currentBalance = userRows[0].balance;

    if (currentBalance < packPrice) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Not enough coins' });
    }

    // 2. Insérer les mots HSK1 manquants (sans débit pour l'instant)
    const insertResult = await client.query(`
      INSERT INTO user_mots (user_id, mot_id, score, nb_quiz, nb_correct, last_seen)
      SELECT 
        $1,
        m.id,
        0, 0, 0, NULL
      FROM mots m
      WHERE m.hsk = $2
        AND NOT EXISTS (
          SELECT 1 FROM user_mots um
          WHERE um.user_id = $1 AND um.mot_id = m.id
        )
      RETURNING mot_id
    `, [userId, hskLevel]);

    const wordsAdded = insertResult.rowCount;

    if (wordsAdded === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You already own all words...' });
    }

    // 3. Débiter les coins (une seule fois)
    await client.query(
      'UPDATE users SET balance = balance - $1 WHERE id = $2',
      [packPrice, userId]
    );

    // 4. Enregistrer la transaction (optionnel)
    await client.query(
      `INSERT INTO transactions (user_id, amount, type, description) 
       VALUES ($1, $2, 'purchase', $3)`,
      [userId, -packPrice, `Achat du pack HSK${hskLevel} (${wordsAdded} mots ajoutés)`]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      wordsAdded,
      newBalance: currentBalance - packPrice,
      message: `Pack HSK1 : ${wordsAdded} word(s) added. New balance: ${currentBalance - packPrice} ₵`
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur achat pack:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

router.get('/api/pack-info/:level', ensureAuth, async (req, res) => {
  const level = parseInt(req.params.level);
  const userId = req.user.id;

  try {
    const total = await pool.query('SELECT COUNT(*) FROM mots WHERE hsk = $1', [level]);
    const owned = await pool.query(
      `SELECT COUNT(*) FROM user_mots um 
       JOIN mots m ON um.mot_id = m.id 
       WHERE um.user_id = $1 AND m.hsk = $2`,
      [userId, level]
    );

    const totalCount = parseInt(total.rows[0].count);
    const ownedCount = parseInt(owned.rows[0].count);
    const missing = Math.max(0, totalCount - ownedCount);

    res.json({ total: totalCount, owned: ownedCount, missing });
  } catch (err) {
    console.error('Erreur pack-info:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/api/acheter-booster', ensureAuth, async (req, res) => {
  // Déclaration des constantes directement dans la route
  const BOOSTER_COST = 20;
  const BOOSTER_CARD_COUNT = 5;

  const userId = req.user.id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Vérifier le solde avec verrou
    const { rows: userRows } = await client.query(
      'SELECT balance FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (userRows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'Utilisateur introuvable' });
    }

    const currentBalance = userRows[0].balance;

    if (currentBalance < BOOSTER_COST) {
      await client.query('ROLLBACK');
      return res.json({
        success: false,
        message: `Solde insuffisant. Il vous faut ${BOOSTER_COST} pièces.`
      });
    }

    // Sélectionner 5 mots aléatoires
    const { rows: randomWords } = await client.query(
      `SELECT id, chinese, pinyin, english, description, hsk 
       FROM mots 
       WHERE id NOT IN (
         SELECT mot_id FROM user_mots WHERE user_id = $1
       )
       ORDER BY RANDOM() 
       LIMIT $2`,
      [userId, BOOSTER_CARD_COUNT]
    );

    // Si pas assez de nouveaux mots disponibles
    if (randomWords.length < BOOSTER_CARD_COUNT) {
      await client.query('ROLLBACK');
      return res.json({
        success: false,
        message: 'Pas assez de nouveaux mots disponibles à découvrir.'
      });
    }

    // Débiter l'utilisateur (en utilisant votre fonction addTransaction existante)
    const transactionResult = await addTransaction(
      client,
      userId,
      -BOOSTER_COST,
      'booster_purchase',
      `Achat booster de ${BOOSTER_CARD_COUNT} mots`
    );

    if (!transactionResult.success) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: transactionResult.message });
    }

    // Ajouter les mots à la collection de l'utilisateur
    for (const word of randomWords) {
      await client.query(
        'INSERT INTO user_mots (user_id, mot_id) VALUES ($1, $2)',
        [userId, word.id]
      );
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      words: randomWords,
      newBalance: currentBalance - BOOSTER_COST,
      message: `Booster acheté ! Vous avez obtenu ${BOOSTER_CARD_COUNT} nouveaux mots.`
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur achat booster:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  } finally {
    client.release();
  }
});


// DELETE /api/user/delete-account
router.delete('/api/user/delete-account', ensureAuth, async (req, res) => {
  const userId = req.user.id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Vérifier si l'utilisateur a un abonnement premium actif ET non résilié en fin de période
    const subResult = await client.query(
      `SELECT status, cancel_at_period_end FROM user_subscriptions WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );

    const hasActiveNotCancelled = subResult.rows.some(row => row.cancel_at_period_end !== true);
    if (hasActiveNotCancelled) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'active_subscription',
        message: 'Vous devez d’abord résilier votre abonnement premium avant de supprimer votre compte.'
      });
    }

    // 2. Supprimer tous les mots de l'utilisateur
    await client.query('DELETE FROM user_mots WHERE user_id = $1', [userId]);

    // 3. Supprimer la ligne dans user_subscriptions
    await client.query('DELETE FROM user_subscriptions WHERE user_id = $1', [userId]);

    // 4. Supprimer l'utilisateur
    const deleteUserResult = await client.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);

    if (deleteUserResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'user_not_found',
        message: 'Utilisateur introuvable.'
      });
    }

    await client.query('COMMIT');

    // 5. Déconnecter l'utilisateur (sans appeler session.destroy)
    req.logout((err) => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({ success: false, error: 'logout_error' });
      }
      // Réponse unique après déconnexion réussie
      res.json({ success: true, message: 'Votre compte a été supprimé définitivement.' });
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur suppression compte:', err);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Une erreur est survenue lors de la suppression du compte.'
    });
  } finally {
    client.release();
  }
});

// Duels API
// 📍 CLASSEMENT
router.get('/api/duels/leaderboard', ensureAuth, async (req, res) => {
  try {
    console.log('🏆 Chargement classement...');

    const result = await pool.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        COUNT(CASE WHEN d.status = 'completed' AND (
          (d.challenger_id = u.id AND d.challenger_score > d.opponent_score) OR
          (d.opponent_id = u.id AND d.opponent_score > d.challenger_score)
        ) THEN 1 END) as wins,
        COUNT(CASE WHEN d.status = 'completed' AND (
          (d.challenger_id = u.id AND d.challenger_score < d.opponent_score) OR
          (d.opponent_id = u.id AND d.opponent_score < d.challenger_score)
        ) THEN 1 END) as losses,
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
        END as ratio
      FROM users u
      LEFT JOIN duels d ON (d.challenger_id = u.id OR d.opponent_id = u.id) AND d.status = 'completed'
      WHERE u.quiz_direction = $1
        AND u.ghost_mode = FALSE
      GROUP BY u.id, u.name, u.email
      HAVING COUNT(CASE WHEN d.status = 'completed' THEN 1 END) > 0
      ORDER BY wins DESC, ratio DESC
      LIMIT 50
    `, [req.user.quiz_direction || 'en→zh']);

    console.log(`✅ Classement chargé: ${result.rows.length} joueurs`);
    res.json(result.rows);

  } catch (err) {
    console.error('❌ Erreur classement:', err);
    res.status(500).json({ error: 'Erreur chargement classement' });
  }
});

// 📍 RECHERCHE UTILISATEURS
router.get('/api/duels/search', ensureAuth, async (req, res) => {
  try {
    const searchQuery = `%${req.query.q}%`;
    console.log('🔍 Recherche utilisateur:', searchQuery, '| direction:', req.user.quiz_direction);

    // Sécurité : on ne cherche QUE par nom (pas par email → évite l'énumération
    // d'emails) et on ne renvoie JAMAIS l'email (fuite de PII).
    const result = await pool.query(`
      SELECT id, name
      FROM users
      WHERE name ILIKE $1
        AND id != $2
        AND quiz_direction = $3
        AND ghost_mode = FALSE
      LIMIT 5
    `, [searchQuery, req.user.id, req.user.quiz_direction || 'en→zh']);

    console.log(`✅ Résultats recherche: ${result.rows.length} utilisateurs`);
    res.json(result.rows);

  } catch (err) {
    console.error('❌ Erreur recherche:', err);
    res.status(500).json({ error: 'Erreur recherche' });
  }
});

// 📊 STATISTIQUES DE TOUS LES JOUEURS - AVEC TAGLINE ET COUNTRY
router.get('/api/players/stats', ensureAuth, async (req, res) => {
  try {
    console.log('📊 Chargement stats tous les joueurs');

    // TEST : Vérifie d'abord la connexion à la DB
    const testQuery = await pool.query('SELECT NOW() as time');
    console.log('✅ Connexion DB OK:', testQuery.rows[0].time);

    const result = await pool.query(`
      SELECT
        u.id,
        u.name,
        u.tagline,
        u.country,
        COUNT(DISTINCT uw.mot_id) as total_words,
        COUNT(DISTINCT CASE
          WHEN d.status = 'completed'
            AND EXTRACT(YEAR FROM d.completed_at) = EXTRACT(YEAR FROM NOW())
            AND (
              (d.challenger_id = u.id AND d.challenger_score > d.opponent_score) OR
              (d.opponent_id = u.id AND d.opponent_score > d.challenger_score)
            ) THEN d.id
        END) as wins,
        COUNT(DISTINCT CASE
          WHEN d.status = 'completed'
            AND EXTRACT(YEAR FROM d.completed_at) = EXTRACT(YEAR FROM NOW())
            AND (
              (d.challenger_id = u.id AND d.challenger_score < d.opponent_score) OR
              (d.opponent_id = u.id AND d.opponent_score < d.challenger_score)
            ) THEN d.id
        END) as losses,
        CASE
          WHEN COUNT(DISTINCT CASE
            WHEN d.status = 'completed'
              AND EXTRACT(YEAR FROM d.completed_at) = EXTRACT(YEAR FROM NOW())
              AND (d.challenger_id = u.id OR d.opponent_id = u.id) THEN d.id
          END) > 0 THEN
            ROUND(
              (COUNT(DISTINCT CASE
                WHEN d.status = 'completed'
                  AND EXTRACT(YEAR FROM d.completed_at) = EXTRACT(YEAR FROM NOW())
                  AND (
                    (d.challenger_id = u.id AND d.challenger_score > d.opponent_score) OR
                    (d.opponent_id = u.id AND d.opponent_score > d.challenger_score)
                  ) THEN d.id
              END) * 100.0) /
              COUNT(DISTINCT CASE
                WHEN d.status = 'completed'
                  AND EXTRACT(YEAR FROM d.completed_at) = EXTRACT(YEAR FROM NOW())
                  AND (d.challenger_id = u.id OR d.opponent_id = u.id) THEN d.id
              END)
            , 1)
          ELSE 0
        END as win_ratio
      FROM users u
      LEFT JOIN user_mots uw ON u.id = uw.user_id
      LEFT JOIN duels d ON (d.challenger_id = u.id OR d.opponent_id = u.id)
      WHERE u.id IN (SELECT DISTINCT user_id FROM user_mots)
        AND u.quiz_direction = $1
        AND u.ghost_mode = FALSE
      GROUP BY u.id, u.name, u.tagline, u.country
      ORDER BY wins DESC, total_words DESC, losses ASC
    `, [req.user.quiz_direction || 'en→zh']);

    console.log(`✅ ${result.rows.length} joueurs trouvés`);
    if (result.rows.length > 0) {
      console.log('📊 Exemple joueur:', {
        name: result.rows[0].name,
        tagline: result.rows[0].tagline,
        country: result.rows[0].country,
        total_words: result.rows[0].total_words,
        wins: result.rows[0].wins
      });
    }

    res.json(result.rows);

  } catch (err) {
    console.error('❌ Erreur détaillée stats joueurs:', err);

    res.status(500).json({
      error: 'Erreur chargement des statistiques joueurs',
      details: err.message
    });
  }
});

router.get('/api/duels/stats', ensureAuth, async (req, res) => {
  const userId = req.user.id;
  const quizDirection = req.user.quiz_direction || 'en→zh';
  try {

    // 1️⃣ Statistiques personnelles (wins, losses, ratio)
    const statsResult = await pool.query(`
      SELECT
        COUNT(CASE WHEN status = 'completed' AND (
          (challenger_id = $1 AND challenger_score > opponent_score) OR
          (opponent_id = $1 AND opponent_score > challenger_score)
        ) THEN 1 END) as wins,
        COUNT(CASE WHEN status = 'completed' AND (
          (challenger_id = $1 AND challenger_score < opponent_score) OR
          (opponent_id = $1 AND opponent_score < challenger_score)
        ) THEN 1 END) as losses,
        CASE
          WHEN COUNT(CASE WHEN status = 'completed' AND (challenger_id = $1 OR opponent_id = $1) THEN 1 END) > 0 THEN
            ROUND(
              COUNT(CASE WHEN status = 'completed' AND (
                (challenger_id = $1 AND challenger_score > opponent_score) OR
                (opponent_id = $1 AND opponent_score > challenger_score)
              ) THEN 1 END) * 100.0 /
              COUNT(CASE WHEN status = 'completed' AND (challenger_id = $1 OR opponent_id = $1) THEN 1 END)
            , 1)
          ELSE 0
        END as ratio
      FROM duels
      WHERE (challenger_id = $1 OR opponent_id = $1)
    `, [userId]);

    // 2️⃣ Rang parmi les joueurs de même direction — logique : wins > total_words > moins de défaites
    const rankResult = await pool.query(`
      SELECT position FROM (
        SELECT
          id,
          RANK() OVER (
            ORDER BY wins DESC, total_words DESC, losses ASC
          ) as position
        FROM (
          SELECT
            u.id,
            COUNT(DISTINCT uw.mot_id) as total_words,
            COUNT(DISTINCT CASE
              WHEN d.status = 'completed' AND (
                (d.challenger_id = u.id AND d.challenger_score > d.opponent_score) OR
                (d.opponent_id = u.id AND d.opponent_score > d.challenger_score)
              ) THEN d.id
            END) as wins,
            COUNT(DISTINCT CASE
              WHEN d.status = 'completed' AND (
                (d.challenger_id = u.id AND d.challenger_score < d.opponent_score) OR
                (d.opponent_id = u.id AND d.opponent_score < d.challenger_score)
              ) THEN d.id
            END) as losses
          FROM users u
          LEFT JOIN user_mots uw ON u.id = uw.user_id
          LEFT JOIN duels d ON (d.challenger_id = u.id OR d.opponent_id = u.id)
          WHERE u.quiz_direction = $2
          GROUP BY u.id
        ) sub
      ) ranked
      WHERE id = $1
    `, [userId, quizDirection]);

    const stats = statsResult.rows[0] || { wins: 0, losses: 0, ratio: 0 };
    const rank = rankResult.rows.length > 0 ? parseInt(rankResult.rows[0].position) : null;

    res.json({ ...stats, rank });

  } catch (err) {
    console.error('Erreur stats perso:', err);
    res.status(500).json({ error: 'Erreur chargement stats' });
  }
});

router.get('/api/duels/bullies', ensureAuth, async (req, res) => {
  const userId = req.user.id;
  const quizDirection = req.user.quiz_direction || 'en→zh';

  try {
    const result = await pool.query(`
      SELECT
        opponent.id,
        opponent.name,
        SUM(CASE
          WHEN (d.challenger_id = $1 AND d.challenger_score > d.opponent_score)
            OR (d.opponent_id = $1 AND d.opponent_score > d.challenger_score)
          THEN d.bet_amount
          WHEN d.challenger_score = d.opponent_score
          THEN 0
          ELSE -d.bet_amount
        END) AS balance
      FROM duels d
      JOIN users opponent ON (
        (d.challenger_id = $1 AND d.opponent_id = opponent.id) OR
        (d.opponent_id = $1 AND d.challenger_id = opponent.id)
      )
      WHERE d.challenger_score IS NOT NULL
        AND d.opponent_score IS NOT NULL
        AND d.bet_amount > 0
        AND opponent.id != $1
        AND opponent.last_login >= NOW() - INTERVAL '1 month'
        AND opponent.quiz_direction = $2
        AND opponent.ghost_mode = FALSE
      GROUP BY opponent.id, opponent.name
      ORDER BY balance DESC
    `, [userId, quizDirection]);

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur bullies:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 📍 CRÉATION D'UN DUEL AVEC PARI
router.post('/api/duels/create', ensureAuth, withSubscription, canPlayDuel, async (req, res) => {
  const client = await pool.connect();

  try {
    const { opponent_id, duel_type = 'classic', word_count = 20, quiz_type = 'pinyin', bet_amount = 0 } = req.body;
    const challengerId = req.user.id;

    // Vérif opposant
    const opponentCheck = await client.query('SELECT id, name, balance FROM users WHERE id = $1', [opponent_id]);
    if (opponentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Unfound user' });
    }
    if (opponent_id === challengerId) {
      return res.status(400).json({ error: 'Really ? against yourself ? are you sick or what ?' });
    }

    // ✅ LIMITE DUELS EN COURS
    const activeDuelsCount = await pool.query(`
      SELECT COUNT(*) FROM duels
      WHERE (challenger_id = $1 OR opponent_id = $1)
        AND status IN ('pending', 'active')
        AND created_at > NOW() - INTERVAL '7 days'
    `, [challengerId]);
    if (parseInt(activeDuelsCount.rows[0].count) >= 5) {
      return res.status(400).json({
        error: "You already have 5 duels in progress. Complete or cancel one before creating a new duel."
      });
    }

    // Vérification du solde opposant (hors transaction)
    const opponentBalance = opponentCheck.rows[0].balance;
    if (bet_amount > 0 && opponentBalance < bet_amount) {
      return res.status(400).json({
        error: `${opponentCheck.rows[0].name} doesn't have enough coins to accept the duel.`
      });
    }

    await client.query('BEGIN');
    console.log('[Création Duel] Transaction démarrée');

    // Vérifier solde challenger (avec verrouillage)
    const challengerBalance = await client.query(
      'SELECT balance FROM users WHERE id = $1 FOR UPDATE',
      [challengerId]
    );
    console.log('[Création Duel] Solde challenger:', challengerBalance.rows[0].balance);

    if (challengerBalance.rows[0].balance < bet_amount) {
      console.log('[Création Duel] Solde insuffisant pour pari');
      await client.query('ROLLBACK');
      return res.status(400).json({ error: "insufissant founds to bet" });
    }

    // ✅ VÉRIFICATION DOUBLE du solde opposant (avec verrouillage)
    const opponentBalanceLocked = await client.query(
      'SELECT balance FROM users WHERE id = $1 FOR UPDATE',
      [opponent_id]
    );
    console.log('[Création Duel] Solde opposant (verrouillé):', opponentBalanceLocked.rows[0].balance);

    if (bet_amount > 0 && opponentBalanceLocked.rows[0].balance < bet_amount) {
      console.log('[Création Duel] Opposant n\'a pas assez pour couvrir le pari (après verrouillage)');
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `${opponentCheck.rows[0].name} has no enought coins to bet`
      });
    }

    // Débit challenger (blocage mise)
    console.log('[Création Duel] Débit du challenger');
    const debitChallenger = await addTransaction(client, challengerId, -bet_amount, "bet", "Duel bet");
    console.log('[Création Duel] Résultat débit challenger:', debitChallenger);

    if (!debitChallenger) {
      console.log('[Création Duel] Échec débit challenger');
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Challenger transaction failed' });
    }

    // ✅ DÉBIT OPPOSANT (NOUVEAU) - Blocage de sa mise aussi
    console.log('[Création Duel] Débit de l\'opposant');
    const debitOpponent = await addTransaction(client, opponent_id, -bet_amount, "bet", "Duel bet");
    console.log('[Création Duel] Résultat débit opposant:', debitOpponent);

    if (!debitOpponent) {
      console.log('[Création Duel] Échec débit opposant');
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Opponent transaction failed' });
    }

    // Génération quiz - on passe maintenant word_count
    console.log('[Création Duel] Génération quiz avec word_count =', word_count);
    const quizData = await generateDuelQuiz(client, challengerId, opponent_id, duel_type, quiz_type, word_count);

    if (!quizData) {
      console.log('[Création Duel] Quiz non généré');
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Pas assez de mots pour générer le duel' });
    }

    console.log('[Création Duel] Insertion duel en base');
    // 🆕 Ajout de word_count dans l'INSERT
    const duelResult = await client.query(`
      INSERT INTO duels 
      (challenger_id, opponent_id, duel_type, word_count, quiz_type, quiz_data, bet_amount, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      challengerId,
      opponent_id,
      duel_type,
      word_count,          // ← AJOUT
      quiz_type,
      JSON.stringify(quizData),
      bet_amount,
      'pending'
    ]);

    // ✅ CORRECTION : Incrémenter l'usage AVANT le commit, avec client.query
    if (req.user.subscription?.plan_name !== 'premium') {
      const today = new Date().toISOString().split('T')[0];

      await client.query(`
        INSERT INTO user_usage (user_id, date, duels_played)
        VALUES ($1, $2, 1)
        ON CONFLICT (user_id, date) 
        DO UPDATE SET duels_played = user_usage.duels_played + 1
      `, [req.user.id, today]);

      console.log(`📊 Duel compté pour l'utilisateur ${req.user.id}`);
    }

    await client.query('COMMIT');
    console.log('[Création Duel] Transaction commitée');

    // 🔔 Notification push à l'adversaire (fire-and-forget)
    sendPushToUser(opponent_id, {
      title: '⚔️ New duel challenge!',
      body: `${req.user.name} is challenging you — accept the duel!`,
      url: '/duels',
      tag: 'jiayou-duel-new',
    }).catch(() => {});

    res.json({
      success: true,
      duel: duelResult.rows[0],
      message: `Duel successfully sent for ${bet_amount} coins !`
    });

  } catch (err) {
    console.error('❌ Erreur création duel:', err);
    try {
      await client.query('ROLLBACK');
      console.log('[Création Duel] Transaction rollback effectuée');
    } catch (rollbackErr) {
      console.error('❌ Erreur rollback:', rollbackErr);
    }
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
    console.log('[Création Duel] Connexion client libérée');
  }
});

// 📍 ACCEPTATION DU DUEL (débit de la mise adversaire)
router.post('/api/duels/:id/accept', ensureAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    const duelId = req.params.id;
    const userId = req.user.id;

    await client.query("BEGIN");

    const duelCheck = await client.query(`
      SELECT * FROM duels 
      WHERE id = $1 
      AND opponent_id = $2
      AND status = 'pending'
    `, [duelId, userId]);

    if (duelCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Duel non trouvé ou déjà accepté" });
    }

    const duel = duelCheck.rows[0];

    // Vérifier solde
    const userBalance = await client.query(
      "SELECT balance FROM users WHERE id = $1 FOR UPDATE",
      [userId]
    );

    if (userBalance.rows[0].balance < duel.bet_amount) {
      await client.query("ROLLBACK");

      // Rembourse challenger
      await addTransaction(duel.challenger_id, duel.bet_amount, "bet_refund", "Mise remboursée");

      return res.status(400).json({ error: "Solde insuffisant pour accepter le pari" });
    }

    // Débit adversaire
    const debit = await addTransaction(userId, -duel.bet_amount, "bet", "Mise duel");
    if (!debit.success) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: debit.message });
    }

    await client.query("COMMIT");
    res.json({ success: true, message: "Duel accepté !" });

  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Erreur serveur" });
  } finally {
    client.release();
  }
});

// 📍 DUELS EN ATTENTE (pour /account et /quiz)
router.get('/api/duels/pending', ensureAuth, async (req, res) => {
  try {
    console.log('⏳ Chargement duels en attente pour:', req.user.id);

    const result = await pool.query(`
      SELECT 
        d.*,
        u1.name as challenger_name,
        u2.name as opponent_name,
        CASE 
          WHEN d.challenger_id = $1 THEN 'challenger'
          ELSE 'opponent'
        END as user_role
      FROM duels d
      JOIN users u1 ON d.challenger_id = u1.id
      JOIN users u2 ON d.opponent_id = u2.id
      WHERE (d.challenger_id = $1 OR d.opponent_id = $1)
        AND d.status = 'pending'
        AND d.expires_at > NOW()
      ORDER BY d.created_at DESC
    `, [req.user.id]);

    console.log(`✅ ${result.rows.length} duels en attente`);
    res.json(result.rows);

  } catch (err) {
    console.error('❌ Erreur duels en attente:', err);
    res.status(500).json({ error: 'Erreur chargement duels' });
  }
});

// 📍 HISTORIQUE DES DUELS
router.get('/api/duels/history', ensureAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    console.log('📜 Chargement historique duels, limit:', limit);

    const result = await pool.query(`
      SELECT 
        d.*,
        u1.name as challenger_name,
        u2.name as opponent_name,
        CASE 
          WHEN d.challenger_score > d.opponent_score THEN d.challenger_id
          WHEN d.opponent_score > d.challenger_score THEN d.opponent_id
          ELSE NULL
        END as winner_id
      FROM duels d
      JOIN users u1 ON d.challenger_id = u1.id
      JOIN users u2 ON d.opponent_id = u2.id
      WHERE (d.challenger_id = $1 OR d.opponent_id = $1)
        AND d.status = 'completed'
      ORDER BY d.completed_at DESC
      LIMIT $2
    `, [req.user.id, limit]);

    console.log(`✅ ${result.rows.length} duels dans l'historique`);
    res.json(result.rows);

  } catch (err) {
    console.error('❌ Erreur historique:', err);
    res.status(500).json({ error: 'Erreur chargement historique' });
  }
});

// 📍 DÉTAIL D'UN DUEL
router.get('/api/duels/:id', ensureAuth, async (req, res) => {
  try {
    const duelId = req.params.id;
    console.log('🔍 Détail duel:', duelId);

    const result = await pool.query(`
      SELECT 
        d.*,
        u1.name as challenger_name,
        u2.name as opponent_name
      FROM duels d
      JOIN users u1 ON d.challenger_id = u1.id
      JOIN users u2 ON d.opponent_id = u2.id
      WHERE d.id = $1 AND (d.challenger_id = $2 OR d.opponent_id = $2)
    `, [duelId, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Duel non trouvé' });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error('❌ Erreur détail duel:', err);
    res.status(500).json({ error: 'Erreur chargement duel' });
  }
});

// 📍 SOUMETTRE SCORE (CORRIGÉ)
router.post('/api/duels/:id/submit', ensureAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    const duelId = req.params.id;
    const { score } = req.body;

    console.log('🎯 Soumission score duel:', { duelId, userId: req.user.id, score });

    await client.query('BEGIN');

    // Vérifier le duel
    const duelCheck = await client.query(`
      SELECT * FROM duels 
      WHERE id = $1 
      AND (challenger_id = $2 OR opponent_id = $2)
      AND status = 'pending'
    `, [duelId, req.user.id]);

    if (duelCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      console.log('❌ Duel non trouvé:', { duelId, userId: req.user.id });
      return res.status(404).json({ error: 'Duel non trouvé ou déjà terminé' });
    }

    const duel = duelCheck.rows[0];
    const isChallenger = duel.challenger_id === req.user.id;

    console.log('📊 Duel trouvé:', {
      duelId: duel.id,
      challenger: duel.challenger_id,
      opponent: duel.opponent_id,
      isChallenger
    });

    // Mettre à jour le score du joueur
    await client.query(`
      UPDATE duels SET ${isChallenger ? 'challenger_score' : 'opponent_score'} = $1 
      WHERE id = $2
    `, [score, duelId]);

    // Récupérer l'état du duel après MAJ
    const updatedDuel = await client.query(`
      SELECT * FROM duels WHERE id = $1
    `, [duelId]);

    const currentDuel = updatedDuel.rows[0];

    const bothPlayed =
      currentDuel.challenger_score !== null &&
      currentDuel.opponent_score !== null;

    // ✅ CORRECTION : Déclarer winnerId en dehors du bloc
    let winnerId = null;

    if (bothPlayed) {
      console.log('🎯 Duel terminé, détermination du gagnant...');

      // 📌 Déterminer gagnant
      if (currentDuel.challenger_score > currentDuel.opponent_score) {
        winnerId = currentDuel.challenger_id;
      } else if (currentDuel.opponent_score > currentDuel.challenger_score) {
        winnerId = currentDuel.opponent_id;
      }

      console.log('🏆 Gagnant:', winnerId, 'Pari:', currentDuel.bet_amount);

      // 📌 Crédit du gagnant si pari
      if (winnerId && currentDuel.bet_amount > 0) {
        console.log('💰 Crédit du gagnant:', winnerId, 'Montant:', currentDuel.bet_amount * 2);

        await addTransaction(
          client,
          winnerId,
          currentDuel.bet_amount * 2, // 2 mises
          "bet_reward",
          "Gain duel"
        );

        console.log('✅ Pari honoré pour le gagnant');
      } else if (currentDuel.bet_amount > 0) {
        console.log('🤝 Match nul - remboursement des paris');

        // En cas de match nul, rembourser les deux joueurs
        await addTransaction(
          client,
          currentDuel.challenger_id,
          currentDuel.bet_amount,
          "bet_refund",
          "Remboursement duel (match nul)"
        );

        await addTransaction(
          client,
          currentDuel.opponent_id,
          currentDuel.bet_amount,
          "bet_refund",
          "Remboursement duel (match nul)"
        );
      }

      // 📌 Mise à jour du duel (gagnant + completion)
      await client.query(`
        UPDATE duels SET
          winner_id = $1,
          status = 'completed',
          completed_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [winnerId, duelId]);

      console.log('✅ Duel marqué comme terminé');
    }

    await client.query('COMMIT');
    console.log('✅ Transaction commitée');

    // 🔔 Notification push quand le duel est terminé (les deux ont joué)
    if (bothPlayed) {
      // Notifier le joueur adverse (celui qui avait soumis en premier)
      const otherPlayerId = isChallenger ? currentDuel.opponent_id : currentDuel.challenger_id;
      const myScore = isChallenger ? currentDuel.challenger_score : currentDuel.opponent_score;
      const otherScore = isChallenger ? currentDuel.opponent_score : currentDuel.challenger_score;
      const resultText = winnerId === req.user.id
        ? `You lost ${myScore} vs ${otherScore} — play again!`
        : winnerId === otherPlayerId
          ? `You won ${otherScore} vs ${myScore}! 🎉`
          : `It's a tie — ${myScore} vs ${otherScore}!`;
      sendPushToUser(otherPlayerId, {
        title: '🏆 Duel result!',
        body: resultText,
        url: `/duel/${duelId}`,
        tag: `jiayou-duel-result-${duelId}`,
      }).catch(() => {});
    }

    res.json({
      success: true,
      duel_completed: bothPlayed,
      winner_id: winnerId // ✅ Maintenant winnerId est toujours défini
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur soumission score:', err);
    res.status(500).json({ error: 'Erreur enregistrement score' });
  } finally {
    client.release();
  }
});

// MONEY
router.get('/api/balance', ensureAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows } = await pool.query(`
      SELECT balance FROM users WHERE id = $1
    `, [userId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const balance = rows[0].balance;

    console.log(`📊 Solde récupéré pour user ${userId} : ${balance}`);

    res.json({ balance });
    console.log('balance is', { balance })

  } catch (err) {
    console.error('❌ Erreur /api/balance:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 📍 HISTORIQUE DES TRANSACTIONS (EXCLUT LES TRANSACTIONS À 0)
router.get('/api/transactions', ensureAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    console.log('📊 Chargement transactions pour user:', userId);

    const result = await pool.query(`
      SELECT 
        id,
        user_id,
        amount,
        type,
        description,
        created_at
      FROM transactions 
      WHERE user_id = $1 
      AND amount != 0
      ORDER BY created_at DESC
      LIMIT 100
    `, [userId]);

    console.log(`✅ ${result.rows.length} transactions récupérées pour l'utilisateur ${userId}`);

    res.json(result.rows);

  } catch (err) {
    console.error('❌ Erreur chargement transactions:', err);
    res.status(500).json({ error: 'Erreur lors du chargement des transactions' });
  }
});


// ── Statut d'abonnement (polling post-paiement) ─────────────────────────────
// Utilisé par la page welcome-jiayou-premium pour confirmer l'activation
router.get('/api/subscription-status', ensureAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        us.plan_name,
        us.status,
        us.stripe_status,
        us.cancel_at_period_end,
        us.current_period_end,
        u.special_guest
      FROM users u
      LEFT JOIN user_subscriptions us ON us.user_id = u.id
      WHERE u.id = $1
    `, [req.user.id]);

    const row = rows[0] || {};
    const isSpecialGuest = row.special_guest === true;
    const now = new Date();
    const periodEnd = row.current_period_end ? new Date(row.current_period_end) : null;

    const allActive = row.plan_name === 'premium'
                   && row.status        === 'active'
                   && row.stripe_status === 'active';
    const periodOk  = !periodEnd || periodEnd > now;
    const isPremium = isSpecialGuest || (allActive && periodOk);

    res.json({
      isPremium,
      isSpecialGuest,
      planName: isSpecialGuest ? 'special_guest' : (isPremium ? 'premium' : 'free'),
      stripeStatus: row.stripe_status || 'none',
      status: row.status || 'none'
    });
  } catch (err) {
    console.error('❌ subscription-status:', err);
    res.status(500).json({ isPremium: false, error: 'server_error' });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// 🔔 NOTIFICATIONS PUSH
// ─────────────────────────────────────────────────────────────────────────────

// Enregistrer une subscription push
router.post('/api/notifications/subscribe', ensureAuth, async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Subscription invalide' });
  }
  try {
    await pool.query(`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, enabled)
      VALUES ($1, $2, $3, $4, true)
      ON CONFLICT (endpoint) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            enabled = true
    `, [req.user.id, endpoint, keys.p256dh, keys.auth]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Push] Erreur subscribe:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Supprimer une subscription push
router.post('/api/notifications/unsubscribe', ensureAuth, async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Endpoint manquant' });
  try {
    await pool.query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [req.user.id, endpoint]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[Push] Erreur unsubscribe:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Statut des notifications pour l'utilisateur courant
router.get('/api/notifications/status', ensureAuth, async (req, res) => {
  try {
    const userRes = await pool.query(
      'SELECT notifications_enabled FROM users WHERE id = $1',
      [req.user.id]
    );
    console.log('[Status] user row:', userRes.rows[0], '| rowCount:', userRes.rowCount);
    const enabled = userRes.rows[0]?.notifications_enabled || false;

    const subRes = await pool.query(
      'SELECT endpoint FROM push_subscriptions WHERE user_id = $1 LIMIT 1',
      [req.user.id]
    );
    const subscribed = subRes.rows.length > 0;

    console.log('[Status] → enabled:', enabled, 'subscribed:', subscribed);
    res.json({ subscribed, enabled });
  } catch (err) {
    console.error('[Status] ERROR:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Sauvegarder la préférence notifications (indépendamment du push SW)
router.post('/api/notifications/preference', ensureAuth, async (req, res) => {
  console.log('[Pref] body:', req.body, '| user_id:', req.user?.id);
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    console.log('[Pref] 400 — enabled not boolean:', typeof enabled, enabled);
    return res.status(400).json({ error: 'enabled (boolean) requis' });
  }
  try {
    const result = await pool.query(
      'UPDATE users SET notifications_enabled = $1 WHERE id = $2',
      [enabled, req.user.id]
    );
    console.log('[Pref] UPDATE rowCount:', result.rowCount, '| enabled →', enabled);
    req.user.notifications_enabled = enabled;
    res.json({ ok: true, enabled });
  } catch (err) {
    console.error('[Pref] ERROR:', err.message);
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
});

// Activer / désactiver toutes les subscriptions de l'utilisateur
router.patch('/api/notifications/toggle', ensureAuth, async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) requis' });
  try {
    await pool.query(
      'UPDATE push_subscriptions SET enabled = $1 WHERE user_id = $2',
      [enabled, req.user.id]
    );
    res.json({ ok: true, enabled });
  } catch (err) {
    console.error('[Push] Erreur toggle:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});


// Toggle word review notifications
router.post('/api/notifications/word-review', ensureAuth, async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) requis' });
  try {
    await pool.query(
      'UPDATE users SET word_review_enabled = $1 WHERE id = $2',
      [enabled, req.user.id]
    );
    req.user.word_review_enabled = enabled;
    if (enabled) {
      // S'assurer que la subscription push existe
      const sub = await pool.query(
        'SELECT id FROM push_subscriptions WHERE user_id = $1 LIMIT 1',
        [req.user.id]
      );
      if (!sub.rows.length) {
        return res.json({ ok: true, needsSubscription: true });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[WordReview] Erreur toggle:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
