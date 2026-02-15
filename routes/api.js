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


// ---------------------API

router.get('/account-info', ensureAuth, async (req, res) => {
  // Permet de récupérer les données d'un autre utilisateur si user_id est fourni
  const targetUserId = req.query.user_id || req.user.id;
  const currentUserId = req.user.id;

  console.log('🎯 /account-info appelé:', { targetUserId, currentUserId });

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

    console.log('✅ /account-info réponse:', {
      name: response.name,
      tagline: response.tagline,    // ← NOUVEAU
      country: response.country,    // ← NOUVEAU
      wordCount: response.wordCount,
      totalQuizzes: response.stats.total_quizzes,
      totalDuels: response.stats.total_duels
    });

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
        console.log(`🎯 Traitement mot:`, result);

        if (result.mot_id && result.correct !== null && result.correct !== undefined) {
          await updateWordScore(req.user.id, result.mot_id, result.correct);
        } else {
          console.log('❌ Données manquantes pour mot:', result);
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
  const { chinese, pinyin, english, description, hsk } = req.body;
  try {
    await pool.query(
      "UPDATE mots SET chinese=$1,pinyin=$2,english=$3,description=$4,hsk=$5 WHERE id=$6",
      [chinese, pinyin, english, description, hsk, id]
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
  const hskLevel = req.query.hsk || 'all';

  console.log('🎯 API /quiz-mots appelée', { userId, requestedCount, hskLevel });

  try {
    // =============================
    // 1. COMPTAGE TOTAL (sans filtre temporel)
    // =============================
    let countQuery = `
      SELECT COUNT(*) as total_count
      FROM user_mots um
      INNER JOIN mots m ON um.mot_id = m.id
      WHERE um.user_id = $1
    `;

    let countParams = [userId];

    if (hskLevel !== 'all') {
      if (hskLevel === 'street') {
        countQuery += ` AND m.hsk IS NULL`;
      } else {
        countQuery += ` AND m.hsk = $2`;
        countParams.push(parseInt(hskLevel));
      }
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalInCollection = parseInt(countResult.rows[0].total_count);

    console.log(`📊 Total mots dans la collection (HSK ${hskLevel}): ${totalInCollection}`);

    // =============================
    // 2. VÉRIFICATION INITIALE (sur le total)
    // =============================
    if (totalInCollection < requestedCount) {
      console.log(`❌ Pas assez de mots dans la collection: ${totalInCollection} < ${requestedCount}`);
      return res.status(400).json({
        success: false,
        error: 'not_enough_words_in_collection',
        message: `Vous avez ${totalInCollection} mots dans votre collection.`,
        requested: requestedCount,
        available: totalInCollection,
        hskLevel: hskLevel,
        suggestion: `Ajoutez ${requestedCount - totalInCollection} mots supplémentaires.`
      });
    }

    // =============================
    // 3. RÉCUPÉRATION DES MOTS
    // =============================
    const fetchLimit = Math.min(totalInCollection, requestedCount * 3);

    let wordsQuery = `
      SELECT 
        m.*,
        COALESCE(um.score, 0) AS score,
        COALESCE(um.nb_quiz, 0) AS nb_quiz,
        um.last_seen
      FROM user_mots um
      INNER JOIN mots m ON um.mot_id = m.id
      WHERE um.user_id = $1
    `;

    let wordsParams = [userId];
    let paramIndex = 2;

    if (hskLevel !== 'all') {
      if (hskLevel === 'street') {
        wordsQuery += ` AND m.hsk IS NULL`;
      } else {
        wordsQuery += ` AND m.hsk = $${paramIndex}`;
        wordsParams.push(parseInt(hskLevel));
        paramIndex++;
      }
    }

    // IMPORTANT: Ajouter un tri pour prioriser les mots "froids"
    wordsQuery += `
      ORDER BY 
        CASE 
          WHEN um.last_seen IS NULL THEN 1
          WHEN EXTRACT(EPOCH FROM (NOW() - um.last_seen)) > 12 * 3600 THEN 2
          ELSE 3 
        END,
        um.score ASC,  -- Priorité aux mots faibles
        RANDOM()
      LIMIT $${paramIndex}
    `;
    wordsParams.push(fetchLimit);

    console.log('📋 SQL Query (optimisé):', wordsQuery);
    console.log('📋 Query params:', wordsParams);

    const { rows: allWords } = await pool.query(wordsQuery, wordsParams);
    console.log(`📥 Mots récupérés: ${allWords.length}`);

    // =============================
    // 4. FILTRE TEMPOREL INTELLIGENT
    // =============================
    const COOLDOWN_HOURS = 12;
    const now = new Date();

    // Appliquer le filtre normalement
    const availableWords = allWords.filter(w => {
      if (!w.last_seen) return true;
      const diffHours = (now - new Date(w.last_seen)) / (1000 * 60 * 60);
      return diffHours >= COOLDOWN_HOURS;
    });

    console.log(`⏰ Après filtre temporel (${COOLDOWN_HOURS}h): ${availableWords.length}/${allWords.length}`);

    // =============================
    // 5. DÉCISION INTELLIGENTE : BYPASS SI NÉCESSAIRE
    // =============================
    let finalPool;
    let bypassedCooldown = false;

    if (availableWords.length >= requestedCount) {
      // Cas idéal : assez de mots après filtre
      finalPool = availableWords;
      console.log(`✅ Suffisamment de mots frais (${availableWords.length})`);
    } else if (availableWords.length >= requestedCount * 0.5) {
      // Cas acceptable : au moins 50% des mots demandés sont frais
      // On complète avec des mots "chauds" mais en priorisant les plus anciens
      finalPool = availableWords;
      const needed = requestedCount - availableWords.length;

      // Prendre les mots les plus "froids" parmi ceux en cooldown
      const cooldownWords = allWords.filter(w => {
        if (!w.last_seen) return false;
        const diffHours = (now - new Date(w.last_seen)) / (1000 * 60 * 60);
        return diffHours < COOLDOWN_HOURS;
      });

      // Trier par ancienneté (les plus anciens d'abord)
      cooldownWords.sort((a, b) => {
        const aHours = a.last_seen ? (now - new Date(a.last_seen)) / (1000 * 60 * 60) : 0;
        const bHours = b.last_seen ? (now - new Date(b.last_seen)) / (1000 * 60 * 60) : 0;
        return aHours - bHours; // Croissant = plus ancien d'abord
      });

      finalPool.push(...cooldownWords.slice(0, needed));
      bypassedCooldown = true;
      console.log(`⚠️ Complété avec ${needed} mots en cooldown`);
    } else {
      // Cas critique : pas assez de mots frais
      // On ignore complètement le filtre temporel
      finalPool = allWords;
      bypassedCooldown = true;
      console.log(`🔄 BYPASS: Filtrer temporel ignoré (seulement ${availableWords.length} mots frais)`);
    }

    console.log(`📦 Pool final: ${finalPool.length} mots`);

    // =============================
    // 6. VÉRIFICATION FINALE (garantie)
    // =============================
    if (finalPool.length < requestedCount) {
      // Ce cas ne devrait jamais arriver grâce aux vérifications précédentes
      console.log(`💥 ERREUR LOGIQUE: ${finalPool.length} < ${requestedCount} après tous les fallbacks`);

      // On prend ce qu'on a, mais on prévient l'utilisateur
      const actualCount = Math.min(finalPool.length, requestedCount);

      return res.json({
        success: true,
        words: finalPool.slice(0, actualCount),
        warning: `Quiz limité à ${actualCount} mots sur ${requestedCount} demandés`,
        bypassedCooldown: bypassedCooldown,
        stats: {
          requested: requestedCount,
          delivered: actualCount,
          freshWords: availableWords.length,
          totalInPool: finalPool.length
        }
      });
    }

    // =============================
    // 7. SÉLECTION STRATÉGIQUE
    // =============================
    // Classer par niveau de maîtrise
    const weak = finalPool.filter(w => w.score < 40);
    const medium = finalPool.filter(w => w.score >= 40 && w.score < 75);
    const strong = finalPool.filter(w => w.score >= 75);

    console.log(`📈 Répartition: faible=${weak.length}, moyen=${medium.length}, fort=${strong.length}`);

    // Fonction de sélection simple (sans shuffleArray si ça plante)
    const pickRandom = (arr, n) => {
      if (arr.length === 0 || n <= 0) return [];
      // Version simple sans Fisher-Yates
      const shuffled = [...arr].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, Math.min(n, shuffled.length));
    };

    let selected = [];

    // Calculer les quotas en fonction des disponibilités réelles
    const totalInPool = weak.length + medium.length + strong.length;

    if (totalInPool > 0) {
      // Proportion de chaque catégorie
      const weakRatio = weak.length / totalInPool;
      const mediumRatio = medium.length / totalInPool;
      const strongRatio = strong.length / totalInPool;

      // Allouer en fonction des proportions
      let weakCount = Math.floor(requestedCount * weakRatio);
      let mediumCount = Math.floor(requestedCount * mediumRatio);
      let strongCount = Math.floor(requestedCount * strongRatio);

      // Ajuster pour arriver au compte exact
      let totalSelected = weakCount + mediumCount + strongCount;
      let remaining = requestedCount - totalSelected;

      // Distribuer le reste
      while (remaining > 0) {
        if (weakCount < weak.length) weakCount++;
        else if (mediumCount < medium.length) mediumCount++;
        else if (strongCount < strong.length) strongCount++;
        else break;
        remaining--;
        totalSelected++;
      }

      // Prendre les mots
      selected = [
        ...pickRandom(weak, weakCount),
        ...pickRandom(medium, mediumCount),
        ...pickRandom(strong, strongCount),
      ];
    }

    // Compléter si nécessaire
    if (selected.length < requestedCount) {
      const remainingWords = finalPool.filter(w => !selected.find(s => s.id === w.id));
      const needed = requestedCount - selected.length;
      const extra = pickRandom(remainingWords, needed);
      selected.push(...extra);
    }

    // Tronquer au nombre exact
    selected = selected.slice(0, requestedCount);

    console.log(`✅ ${selected.length} mots sélectionnés pour le quiz`);

    // =============================
    // 8. MAJ last_seen
    // =============================
    if (selected.length > 0) {
      await pool.query(
        `UPDATE user_mots 
         SET last_seen = NOW()
         WHERE user_id = $1 AND mot_id = ANY($2)`,
        [userId, selected.map(w => w.id)]
      );
      console.log(`🔄 last_seen mis à jour pour ${selected.length} mots`);
    }

    // =============================
    // 9. RÉPONSE
    // =============================
    const response = {
      success: true,
      words: selected,
      count: selected.length,
      requestedCount: requestedCount,
      hskLevel: hskLevel,
      bypassedCooldown: bypassedCooldown,
      stats: {
        totalInCollection: totalInCollection,
        freshWords: availableWords.length,
        distribution: {
          weak: selected.filter(w => w.score < 40).length,
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

router.post('/api/user/update-profile', ensureAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { name, tagline, country } = req.body;

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

    // Mettre à jour le profil SANS updated_at
    await client.query(
      `UPDATE users 
       SET name = $1, tagline = $2, country = $3
       WHERE id = $4`,
      [name, tagline, country, req.user.id]
    );

    await client.query('COMMIT');

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
      GROUP BY u.id, u.name, u.email
      HAVING COUNT(CASE WHEN d.status = 'completed' THEN 1 END) > 0
      ORDER BY wins DESC, ratio DESC
      LIMIT 50
    `);

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
    console.log('🔍 Recherche utilisateur:', searchQuery);

    const result = await pool.query(`
      SELECT id, name, email 
      FROM users 
      WHERE (email ILIKE $1 OR name ILIKE $1) 
        AND id != $2
      LIMIT 5
    `, [searchQuery, req.user.id]);

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
        u.email,
        u.tagline,           -- ⬅️ NOUVEAU : phrase d'accroche
        u.country,           -- ⬅️ NOUVEAU : pays
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
        END) as losses,
        CASE 
          WHEN COUNT(DISTINCT CASE 
            WHEN d.status = 'completed' AND (d.challenger_id = u.id OR d.opponent_id = u.id) THEN d.id
          END) > 0 THEN
            ROUND(
              (COUNT(DISTINCT CASE 
                WHEN d.status = 'completed' AND (
                  (d.challenger_id = u.id AND d.challenger_score > d.opponent_score) OR
                  (d.opponent_id = u.id AND d.opponent_score > d.challenger_score)
                ) THEN d.id
              END) * 100.0) / 
              COUNT(DISTINCT CASE 
                WHEN d.status = 'completed' AND (d.challenger_id = u.id OR d.opponent_id = u.id) THEN d.id
              END)
            , 1)
          ELSE 0
        END as win_ratio
      FROM users u
      LEFT JOIN user_mots uw ON u.id = uw.user_id
      LEFT JOIN duels d ON (d.challenger_id = u.id OR d.opponent_id = u.id)
      WHERE u.id IN (SELECT DISTINCT user_id FROM user_mots)
      GROUP BY u.id, u.name, u.email, u.tagline, u.country  -- ⬅️ AJOUTER tagline et country
      ORDER BY wins DESC, total_words DESC
    `);

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

// 📍 STATS PERSO
router.get('/api/duels/stats', ensureAuth, async (req, res) => {
  try {
    console.log('📊 Chargement stats perso pour:', req.user.id);

    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_duels,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_duels,
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
              (COUNT(CASE WHEN status = 'completed' AND (
                (challenger_id = $1 AND challenger_score > opponent_score) OR
                (opponent_id = $1 AND opponent_score > challenger_score)
              ) THEN 1 END) * 100.0) / 
              COUNT(CASE WHEN status = 'completed' AND (challenger_id = $1 OR opponent_id = $1) THEN 1 END)
            , 1)
          ELSE 0
        END as ratio
      FROM duels 
      WHERE (challenger_id = $1 OR opponent_id = $1)
    `, [req.user.id]);

    const stats = result.rows[0] || { wins: 0, losses: 0, ratio: 0, total_duels: 0 };
    console.log('✅ Stats perso:', stats);
    res.json(stats);

  } catch (err) {
    console.error('❌ Erreur stats perso:', err);
    res.status(500).json({ error: 'Erreur chargement stats' });
  }
});

// 📍 CRÉATION D'UN DUEL AVEC PARI
router.post('/api/duels/create', ensureAuth, withSubscription, canPlayDuel, async (req, res) => {
  const client = await pool.connect();

  try {
    // 🆕 Récupération de word_count avec valeur par défaut 20
    const {
      opponent_id,
      duel_type = 'classic',
      word_count = 20,          // ← AJOUT
      quiz_type = 'pinyin',
      bet_amount = 0
    } = req.body;
    const challengerId = req.user.id;

    console.log('🎯 Création duel avec pari:', { challengerId, opponent_id, duel_type, word_count, bet_amount });

    // Vérif opposant AVANT la transaction
    const opponentCheck = await client.query(
      'SELECT id, name, balance FROM users WHERE id = $1',
      [opponent_id]
    );

    console.log('[Création Duel] Verified oponnent:', opponentCheck.rows[0]);

    if (opponentCheck.rows.length === 0) {
      console.log('[Création Duel] Opposant non trouvé');
      return res.status(404).json({ error: 'Unfound user' });
    }

    if (opponent_id === challengerId) {
      console.log('[Création Duel] Tentative de duel contre soi-même');
      return res.status(400).json({ error: 'Really ? against yourself ? are you sick or what ?' });
    }

    // ✅ VÉRIFICATION DU SOLDE OPPOSANT AVANT TRANSACTION
    const opponentBalance = opponentCheck.rows[0].balance;
    console.log('[Création Duel] Solde opposant (avant verrouillage):', opponentBalance);

    if (bet_amount > 0 && opponentBalance < bet_amount) {
      console.log('[Création Duel] Opposant n\'a pas assez pour couvrir le pari');
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

// Acheter un booster
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

module.exports = router;
