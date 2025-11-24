const express = require('express');
const { pool } = require('../config/database');
const router = express.Router();
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
} = require('../middleware/index');

// ---------------------API

// 🎯 ROUTE AVEC LA BONNE TABLE user_mots
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

    // 3. Créditer la récompense de 5 coins au joueur

    // Récupérer le solde actuel avec verrou (FOR UPDATE)
    const { rows: userRows } = await client.query(
      "SELECT balance FROM users WHERE id = $1 FOR UPDATE",
      [req.user.id]
    );

    if (userRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Utilisateur introuvable" });
    }

    // Insérer la transaction + mise à jour du solde
    const REWARD_AMOUNT = 5;

    await client.query(
      "INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, $3, $4)",
      [req.user.id, REWARD_AMOUNT, 'quiz_reward', 'Récompense fin de quiz']
    );

    await client.query(
      "UPDATE users SET balance = balance + $1 WHERE id = $2",
      [REWARD_AMOUNT, req.user.id]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      quiz: quizResult.rows[0],
      message: `Quiz sauvegardé avec ${results ? results.length : 0} scores mis à jour, et ${REWARD_AMOUNT} coins crédités.`
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

router.post("/ajouter", ensureAuth, async (req, res) => {
  const { chinese, pinyin, english, description, hsk } = req.body;
  const userId = req.user.id;

  const COST = 3; // coût de l'action

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 0. Récupérer et verrouiller le solde utilisateur
    const { rows: userRows } = await client.query(
      "SELECT balance FROM users WHERE id=$1 FOR UPDATE",
      [userId]
    );

    if (userRows.length === 0) {
      await client.query("ROLLBACK");
      return res.json({ success: false, message: "Utilisateur introuvable." });
    }

    const currentBalance = userRows[0].balance;

    if (currentBalance < COST) {
      await client.query("ROLLBACK");
      return res.json({
        success: false,
        message: "unsufiscient balance (3 coins requierd)"
      });
    }

    // 1. Vérifier si le mot existe dans la table globale
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

    // 2. Vérifier si l’utilisateur possède déjà le mot
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

    // 3. Débiter l'utilisateur
    await client.query(
      "UPDATE users SET balance = balance - $1 WHERE id = $2",
      [COST, userId]
    );

    // 4. Enregistrer la transaction
    await client.query(
      `INSERT INTO transactions (user_id, amount, type, description)
       VALUES ($1, $2, $3, $4)`,
      [userId, -COST, "capture_word", `Captured word ${chinese}`]
    );

    // 5. Associer le mot à l'utilisateur
    await client.query(
      "INSERT INTO user_mots (user_id, mot_id) VALUES ($1,$2)",
      [userId, motId]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      motId,
      newBalance: currentBalance - COST,
      message: "Word added successfully. 3 coins deducted."
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erreur ajout:", err);
    res.status(500).json({ success: false, message: "Internal server error." });
  } finally {
    client.release();
  }
});

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
      [chinese,pinyin,english,description,hsk,id]
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

router.get('/quiz-mots', ensureAuth, async (req, res) => {
  const userId = req.user.id;
  const requestedCount = req.query.count === 'all' ? null : parseInt(req.query.count) || 10;
  const hskLevel = req.query.hsk || 'all';

  console.log('🎯 API /quiz-mots routerelée avec:', { 
    userId, 
    requestedCount, 
    hskLevel 
  });

  try {
    let query = `
      SELECT mots.*, 
             COALESCE(user_mots.score, 0) as score,
             COALESCE(user_mots.nb_quiz, 0) as nb_quiz
      FROM user_mots 
      JOIN mots ON user_mots.mot_id = mots.id
      WHERE user_mots.user_id = $1
      AND user_mots.score < 100
    `;
    
    let params = [userId];
    let paramCount = 1;

    // Filtre HSK corrigé
    if (hskLevel !== 'all') {
      if (hskLevel === 'street') {
        query += ` AND mots.hsk IS NULL`;  // Street Chinese = hsk IS NULL
      } else {
        paramCount++;
        query += ` AND mots.hsk = $${paramCount}`;  // HSK normal = hsk = valeur
        params.push(parseInt(hskLevel));
      }
    }

    console.log('📝 Query:', query);
    console.log('🔧 Paramètres:', params);

    const { rows } = await pool.query(query, params);
    console.log('✅ Résultats DB:', rows.length, 'lignes');

    if (rows.length === 0) {
      console.log('ℹ️ Aucun mot trouvé avec ces critères');
      return res.json([]);
    }

    // Le reste de ta logique de sélection intelligente...
    const motsFaibles = rows.filter(mot => mot.score < 50)
      .sort((a, b) => a.nb_quiz - b.nb_quiz);
    const motsMoyens = rows.filter(mot => mot.score >= 50 && mot.score < 80)
      .sort((a, b) => a.nb_quiz - b.nb_quiz);
    const motsForts = rows.filter(mot => mot.score >= 80)
      .sort((a, b) => a.nb_quiz - b.nb_quiz);

    const totalMots = requestedCount || rows.length;
    
    let nbFaibles = Math.ceil(totalMots * 0.7);
    let nbMoyens = Math.ceil(totalMots * 0.2);
    let nbForts = Math.ceil(totalMots * 0.1);

    // Ajustements des proportions...
    if (motsFaibles.length < nbFaibles) {
      const deficit = nbFaibles - motsFaibles.length;
      nbFaibles = motsFaibles.length;
      const ratio = nbMoyens / (nbMoyens + nbForts);
      nbMoyens += Math.ceil(deficit * ratio);
      nbForts += Math.floor(deficit * (1 - ratio));
    }

    if (motsMoyens.length < nbMoyens) {
      const deficit = nbMoyens - motsMoyens.length;
      nbMoyens = motsMoyens.length;
      nbFaibles = Math.min(motsFaibles.length, nbFaibles + deficit);
    }

    if (motsForts.length < nbForts) {
      const deficit = nbForts - motsForts.length;
      nbForts = motsForts.length;
      nbFaibles = Math.min(motsFaibles.length, nbFaibles + deficit);
    }

    const selectionFaibles = motsFaibles.slice(0, nbFaibles);
    const selectionMoyens = motsMoyens.slice(0, nbMoyens);
    const selectionForts = motsForts.slice(0, nbForts);

    let motsSelectionnes = [...selectionFaibles, ...selectionMoyens, ...selectionForts];
    motsSelectionnes = shuffleArray(motsSelectionnes);

    console.log('📈 Distribution finale:', {
      faibles: selectionFaibles.length,
      moyens: selectionMoyens.length,
      forts: selectionForts.length,
      total: motsSelectionnes.length,
      hsk: hskLevel
    });

    res.json(motsSelectionnes);

  } catch (err) {
    console.error('💥 ERREUR /quiz-mots:');
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
    
    res.status(500).json({ 
      error: 'Erreur serveur',
      details: err.message
    });
  }
});

router.post('/api/user/update-name', ensureAuth, async (req, res) => {
  try {
    console.log('🔵 Route update-name routerelée');
    console.log('Body reçu:', req.body);

    // METHODE 1: Récupérer l'userId depuis le body (plus simple)
    const { name, userId } = req.body;
    
    // METHODE 2: Si userId n'est pas dans le body, essayez la session
    const finalUserId = userId || req.session.userId || req.session.user?.id;
    
    console.log('UserId utilisé:', finalUserId);

    if (!finalUserId) {
      return res.status(401).json({ 
        success: false, 
        message: 'ID utilisateur manquant' 
      });
    }

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Le prénom est requis' 
      });
    }

    // Mise à jour dans la base de données
    const result = await pool.query(
      'UPDATE users SET name = $1 WHERE id = $2 RETURNING id, name',
      [name.trim(), finalUserId]
    );

    console.log('Résultat DB:', result.rows);

    if (result.rows.length > 0) {
      res.json({ 
        success: true,
        message: 'Prénom mis à jour avec succès !',
        newName: result.rows[0].name
      });
    } else {
      res.status(404).json({ 
        success: false, 
        message: 'Utilisateur non trouvé' 
      });
    }
    
  } catch (error) {
    console.error('❌ Erreur:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur: ' + error.message 
    });
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

// 📊 STATISTIQUES DE TOUS LES JOUEURS - CORRIGÉE
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
        COUNT(DISTINCT uw.mot_id) as total_words,           -- ⬅️ CORRIGÉ : mot_id au lieu de word_id
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
      LEFT JOIN user_mots uw ON u.id = uw.user_id           -- ⬅️ CORRIGÉ : user_mots au lieu de user_words
      LEFT JOIN duels d ON (d.challenger_id = u.id OR d.opponent_id = u.id)
      WHERE u.id IN (SELECT DISTINCT user_id FROM user_mots) -- ⬅️ CORRIGÉ : user_mots
      GROUP BY u.id, u.name, u.email
      ORDER BY wins DESC, total_words DESC
    `);

    console.log(`✅ ${result.rows.length} joueurs trouvés`);
    if (result.rows.length > 0) {
      console.log('📊 Exemple joueur:', result.rows[0]);
    }
    
    // ✅ RETOURNE BIEN LE TABLEAU
    res.json(result.rows);
    
  } catch (err) {
    console.error('❌ Erreur détaillée stats joueurs:', err);
    
    // ✅ RETOURNE UNE ERREUR PROPRE
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

// 📍 CRÉATION D'UN DUEL
// 📍 CRÉATION D'UN DUEL AVEC PARI
router.post('/api/duels/create', ensureAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    const { opponent_id, duel_type = 'classic', quiz_type = 'pinyin', bet_amount = 0 } = req.body;
    const challengerId = req.user.id;

    console.log('🎯 Création duel avec pari:', { challengerId, opponent_id, duel_type, bet_amount });

    // Vérif opposant AVANT la transaction
    const opponentCheck = await client.query(
      'SELECT id, name, balance FROM users WHERE id = $1',
      [opponent_id]
    );
    
    console.log('[Création Duel] Opposant vérifié:', opponentCheck.rows[0]);

    if (opponentCheck.rows.length === 0) {
      console.log('[Création Duel] Opposant non trouvé');
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    if (opponent_id === challengerId) {
      console.log('[Création Duel] Tentative de duel contre soi-même');
      return res.status(400).json({ error: 'Vous ne pouvez pas vous défier vous-même' });
    }

    // ✅ VÉRIFICATION DU SOLDE OPPOSANT AVANT TRANSACTION
    const opponentBalance = opponentCheck.rows[0].balance;
    console.log('[Création Duel] Solde opposant (avant verrouillage):', opponentBalance);

    if (bet_amount > 0 && opponentBalance < bet_amount) {
      console.log('[Création Duel] Opposant n\'a pas assez pour couvrir le pari');
      return res.status(400).json({ 
        error: `${opponentCheck.rows[0].name} n'a pas assez de coins (${opponentBalance}) pour accepter ce pari de ${bet_amount} coins` 
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
      return res.status(400).json({ error: "Solde insuffisant pour parier" });
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
        error: `${opponentCheck.rows[0].name} n'a pas assez de coins pour accepter ce pari` 
      });
    }

    // Débit challenger (blocage mise)
    console.log('[Création Duel] Débit du challenger');
    const debitChallenger = await addTransaction(client, challengerId, -bet_amount, "bet", "Mise duel");
    console.log('[Création Duel] Résultat débit challenger:', debitChallenger);

    if (!debitChallenger) {
      console.log('[Création Duel] Échec débit challenger');
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Échec de la transaction challenger' });
    }

    // ✅ DÉBIT OPPOSANT (NOUVEAU) - Blocage de sa mise aussi
    console.log('[Création Duel] Débit de l\'opposant');
    const debitOpponent = await addTransaction(client, opponent_id, -bet_amount, "bet", "Mise duel");
    console.log('[Création Duel] Résultat débit opposant:', debitOpponent);

    if (!debitOpponent) {
      console.log('[Création Duel] Échec débit opposant');
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Échec de la transaction opposant' });
    }

    // Génération quiz
    console.log('[Création Duel] Génération quiz');
    const quizData = await generateDuelQuiz(client, challengerId, opponent_id, duel_type, quiz_type);

    if (!quizData) {
      console.log('[Création Duel] Quiz non généré');
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Pas assez de mots pour générer le duel' });
    }

    console.log('[Création Duel] Insertion duel en base');
    const duelResult = await client.query(`
      INSERT INTO duels 
      (challenger_id, opponent_id, duel_type, quiz_type, quiz_data, bet_amount, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending')
      RETURNING *
    `, [
      challengerId,
      opponent_id,
      duel_type,
      quiz_type,
      JSON.stringify(quizData),
      bet_amount
    ]);

    await client.query('COMMIT');
    console.log('[Création Duel] Transaction commitée');

    res.json({
      success: true,
      duel: duelResult.rows[0],
      message: `Défi lancé avec un pari de ${bet_amount} coins !`
    });

  } catch (err) {
    console.error('❌ Erreur création duel:', err);
    try {
      await client.query('ROLLBACK');
      console.log('[Création Duel] Transaction rollback effectuée');
    } catch (rollbackErr) {
      console.error('❌ Erreur rollback:', rollbackErr);
    }
    res.status(500).json({ error: 'Erreur serveur' });
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
    console.log('balance is', {balance})

  } catch (err) {
    console.error('❌ Erreur /api/balance:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});





module.exports = router;
