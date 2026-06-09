const { pool } = require('../config/database');

// === MIDDLEWARE D'AUTHENTIFICATION ===
function ensureAuth(req, res, next) {
  console.log('🔐 ensureAuth →', req.method, req.url);

  // 1️⃣ Cas Passport normal
  if (req.isAuthenticated && req.isAuthenticated()) {
    console.log('✅ Auth OK (Passport)');
    return next();
  }

  // 2️⃣ Cas bypass via req.user (dev/login-as l'a mis lui-même)
  if (req.user) {
    console.log('✅ Auth OK (req.user présent)');
    return next();
  }

  // 3️⃣ Cas session.user défini
  if (req.session?.user) {
    console.log('⚠️ Auth OK via req.session.user (compat)');
    req.user = req.session.user;
    return next();
  }

  // 4️⃣ Cas session.passport.user (Passport stocké en session)
  if (req.session?.passport?.user) {
    console.log('⚠️ Auth OK via session.passport.user');
    // Si Passport n'a pas rechargé req.user, on le pose à minima
    req.user = { id: req.session.passport.user };
    return next();
  }

  // ❌ Rien trouvé → non authentifié
  console.log('❌ Auth échouée → redirection / ou 401 API');

  // Si API
  if (req.url.startsWith('/api/')) {
    return res.status(401).json({
      error: 'Non authentifié',
      redirect: '/'
    });
  }

  // Si page
  return res.redirect('/');
}

function ensureAdmin(req, res, next) {
  if (req.user?.is_admin) return next();
  return res.status(403).json({
    error: 'forbidden',
    message: 'Only administrators can modify word translations.'
  });
}

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  
  // Regex email simple mais efficace
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return false;
  
  // Rejeter les emails jetables courants
  const disposableDomains = [
    'tempmail.com', 'mailinator.com', 'guerrillamail.com',
    '10minutemail.com', 'throwawaymail.com', 'yopmail.com',
    'fakeinbox.com', 'temp-mail.org'
  ];
  
  const domain = email.split('@')[1].toLowerCase();
  return !disposableDomains.some(d => domain.includes(d));
}

// === MIDDLEWARE DE SESSIONS ===

// Résilience Cloud - Middleware pour gérer les sessions
const resilience = (req, res, next) => {
  console.log('🌐 Session Check:', {
    id: req.sessionID ? req.sessionID.substring(0, 8) : 'none',
    hasSession: !!req.session,
    hasUser: !!req.user,
    cookies: req.headers.cookie ? 'present' : 'missing'
  });

  const originalEnd = res.end;
  res.end = function(...args) {
    if (req.session && typeof req.session.save === 'function') {
      req.session.save((err) => {
        if (err) {
          console.error('❌ Session save error:', err);
        }
        originalEnd.apply(this, args);
      });
    } else {
      originalEnd.apply(this, args);
    }
  };
  
  next();
};

// Réparateur de sessions
const repair = (req, res, next) => {
  if (req.session && !req.session.initialized) {
    req.session.initialized = true;
    req.session.createdAt = new Date().toISOString();
  }
  
  if (req.session && req.session.passport && !req.user) {
    console.log('🔄 Tentative de réparation session...');
  }
  
  next();
};

// Vérificateur de session
const checker = (req, res, next) => {
  console.log('🔍 Session State:', {
    id: req.sessionID?.substring(0, 8),
    exists: !!req.session,
    user: req.user?.id || 'none',
    cookies: req.headers.cookie ? req.headers.cookie.length + ' chars' : 'none',
    url: req.url
  });
  next();
};

// Sécurité des sessions
const security = (req, res, next) => {
  if (req.session) {
    if (!req.session.lastActivity) {
      req.session.lastActivity = Date.now();
    }
    
    const inactiveTime = Date.now() - req.session.lastActivity;
    const maxInactiveTime = 24 * 60 * 60 * 1000;
    
    if (inactiveTime > maxInactiveTime && req.isAuthenticated()) {
      console.log('🔐 Session expirée par inactivité');
      return req.logout((err) => {
        if (err) console.error('Erreur déconnexion:', err);
        res.redirect('/index?error=session_expired');
      });
    }
    
    if (req.isAuthenticated()) {
      req.session.lastActivity = Date.now();
    }
  }
  next();
};

// Réauthentification automatique
const reauth = async (req, res, next) => {
  if (req.isAuthenticated() && !req.user) {
    try {
      const userRes = await pool.query(
        'SELECT id, email, name FROM users WHERE id = $1',
        [req.session.passport.user]
      );
      
      if (userRes.rows.length > 0) {
        req.user = userRes.rows[0];
        console.log('🔄 Utilisateur récupéré depuis la base');
      } else {
        console.log('❌ Utilisateur non trouvé en base, déconnexion');
        req.logout();
        return res.redirect('/index?error=user_not_found');
      }
    } catch (error) {
      console.error('Erreur récupération utilisateur:', error);
    }
  }
  next();
};

// === MIDDLEWARE DE LOGGING ===
const requestLogger = (req, res, next) => {
  console.log(`📨 ${req.method} ${req.url} - ${new Date().toISOString()}`);
  next();
};

// === MIDDLEWARE DE GESTION D'ERREURS ===
const errorHandler = (err, req, res, next) => {
  console.error('❌ Erreur:', err.message);
  console.error('Stack:', err.stack);
  
  res.status(500).json({
    success: false,
    message: 'Erreur serveur',
    ...(process.env.NODE_ENV === 'development' && { error: err.message })
  });
};


// ==================== FONCTIONS UTILITAIRES ====================
async function generateDuelQuiz(transaction, user1Id, user2Id, duelType, quizType, wordCount) {
  try {
    console.log('🎲 Génération quiz duel:', { duelType, quizType, wordCount });
    
    let wordIds = [];

    if (duelType === 'classic') {
      // Répartition équilibrée : floor(wordCount/2) pour user1, reste pour user2
      const count1 = Math.floor(wordCount / 2);
      const count2 = wordCount - count1;

      const user1Words = await getRandomUserWords(transaction, user1Id, count1);
      const user2Words = await getRandomUserWords(transaction, user2Id, count2);
      
      if (user1Words.length < count1 || user2Words.length < count2) {
        console.warn(`⚠️ Pas assez de mots pour un duel classique: besoin ${count1}/${count2}, dispo ${user1Words.length}/${user2Words.length}`);
        return null;
      }
      
      wordIds = [...user1Words, ...user2Words];
      
    } else if (duelType === 'match_aa') {
      // wordCount mots communs aux deux joueurs
      wordIds = await getCommonWords(transaction, user1Id, user2Id, wordCount);
      
      if (wordIds.length < wordCount) {
        console.warn(`⚠️ Pas assez de mots communs pour un match AA: besoin ${wordCount}, dispo ${wordIds.length}`);
        return null;
      }
    } else {
      // Autres types de duel (non gérés)
      return null;
    }

    // Mélanger les mots pour éviter un ordre prévisible
    wordIds = shuffleArray(wordIds);

    // Récupérer les informations complètes des mots
    const wordsResult = await transaction.query(`
      SELECT id, chinese, pinyin, english, description, hsk
      FROM mots 
      WHERE id = ANY($1)
    `, [wordIds]);

    const quizData = {
      words: wordsResult.rows,
      total_questions: wordCount,
      duel_type: duelType,
      quiz_type: quizType,
      generated_at: new Date().toISOString()
    };

    console.log(`✅ Quiz généré: ${wordCount} mots`);
    return quizData;

  } catch (err) {
    console.error('❌ Erreur génération quiz:', err);
    return null;
  }
}

async function getRandomUserWords(transaction, userId, count) {
  const result = await transaction.query(`
    SELECT mot_id FROM user_mots
    WHERE user_id = $1
    ORDER BY RANDOM()
    LIMIT $2
  `, [userId, count]);
  return result.rows.map(row => row.mot_id);
}

async function getCommonWords(transaction, user1Id, user2Id, count) {
  const result = await transaction.query(`
    SELECT um1.mot_id
    FROM user_mots um1
    JOIN user_mots um2 ON um1.mot_id = um2.mot_id
    WHERE um1.user_id = $1 AND um2.user_id = $2
    ORDER BY RANDOM()
    LIMIT $3
  `, [user1Id, user2Id, count]);
  return result.rows.map(row => row.mot_id);
}

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function updateWordScore(userId, motId, isCorrect, quizType = 'pinyin') {
  try {
    console.log(`🎯 updateWordScore - User:${userId}, Mot:${motId}, Correct:${isCorrect}, Type:${quizType}`);

    // Déterminer la colonne à mettre à jour
    const scoreColumn = quizType === 'character' ? 'score_character' : 'score';

    // Vérifier si le mot existe dans user_mots
    const existing = await pool.query(
      'SELECT * FROM user_mots WHERE user_id = $1 AND mot_id = $2',
      [userId, motId]
    );

    if (existing.rows.length === 0) {
      // Nouveau mot - initialiser les deux scores à 0
      console.log(`➕ Nouveau mot ${motId} - Initialisation`);

      await pool.query(
        `INSERT INTO user_mots (user_id, mot_id, score, score_character, nb_quiz, nb_correct) 
         VALUES ($1, $2, 0, 0, 0, 0)`,
        [userId, motId]
      );

      // Puis faire comme une mise à jour normale (le mot existe maintenant)
      // On rappelle la fonction ou on fait directement la mise à jour
      // Solution simple : on laisse la suite se dérouler en récupérant la ligne nouvellement créée
      return updateWordScore(userId, motId, isCorrect, quizType);
    }

    // Mise à jour du score existant
    const current = existing.rows[0];
    const newNbQuiz = (current.nb_quiz || 0) + 1;
    const newNbCorrect = (current.nb_correct || 0) + (isCorrect ? 1 : 0);

    // Récupérer le score actuel pour la colonne concernée
    const currentScore = current[scoreColumn] || 0;

    // Calcul du nouveau score (+15 / -20)
    let newScore;
    if (isCorrect) {
      newScore = Math.min(100, currentScore + 15);
    } else {
      newScore = Math.max(0, currentScore - 20);
    }

    console.log(`✏️ Mise à jour ${scoreColumn} mot ${motId}: ${currentScore} -> ${newScore} (${isCorrect ? '+15' : '-20'})`);

    // Mettre à jour uniquement la colonne concernée, et nb_quiz/nb_correct
    await pool.query(
      `UPDATE user_mots SET ${scoreColumn} = $1, nb_quiz = $2, nb_correct = $3 
       WHERE user_id = $4 AND mot_id = $5`,
      [newScore, newNbQuiz, newNbCorrect, userId, motId]
    );

    console.log(`✅ Score mis à jour pour mot ${motId}`);
  } catch (error) {
    console.error('❌ Erreur updateWordScore:', error);
  }
}

async function addTransaction(client, userId, amount, type, description = "") {
  try {
    // Vérifier existence et verrouiller la ligne pour éviter concurrence
    const { rows } = await client.query(
      "SELECT balance FROM users WHERE id = $1 FOR UPDATE",
      [userId]
    );

    if (rows.length === 0) {
      return { success: false, message: "Utilisateur introuvable" };
    }

    const balance = rows[0].balance;

    if (amount < 0 && balance + amount < 0) {
      return { success: false, message: "Solde insuffisant" };
    }

    // Mettre à jour le solde
    await client.query(
      "UPDATE users SET balance = balance + $1 WHERE id = $2",
      [amount, userId]
    );

    // Insérer la transaction
    const result = await client.query(
      "INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, $3, $4) RETURNING *",
      [userId, amount, type, description]
    );

    return { 
      success: true, 
      transaction: result.rows[0],
      message: "Transaction effectuée avec succès"
    };

  } catch (error) {
    return { success: false, message: error.message };
  }
}

// === FONCTIONS D'AIDE POUR LE CHOIX DES MOT QUIZ ===

// FONCTION POUR UTILISATEUR AVANCÉ
function selectForAdvancedUser(words, count) {
  const masteredWords = words.filter(w => w.score >= 90);
  const otherWords = words.filter(w => w.score < 90);
  
  // 30% de mots maîtrisés (ceux avec le moins de nb_quiz)
  const reviewCount = Math.min(Math.ceil(count * 0.3), masteredWords.length);
  
  const reviewWords = masteredWords
    .sort((a, b) => (a.nb_quiz || 0) - (b.nb_quiz || 0))
    .slice(0, reviewCount);
  
  // 70% d'autres mots (aléatoire)
  const remainingCount = count - reviewWords.length;
  let otherSelected = [];
  
  if (otherWords.length > 0 && remainingCount > 0) {
    const shuffled = shuffleArray([...otherWords]);
    otherSelected = shuffled.slice(0, remainingCount);
  } else if (remainingCount > 0) {
    // Si pas d'autres mots, prendre plus de mots maîtrisés
    const extraMastered = masteredWords
      .filter(w => !reviewWords.includes(w))
      .slice(0, remainingCount);
    reviewWords.push(...extraMastered);
  }
  
  return [...reviewWords, ...otherSelected];
}

// FONCTION NORMALE (priorité aux mots faibles)
function selectWordsNormal(words, count) {
  // Trie par score (faible d'abord) puis par nb_quiz (moins testé d'abord)
  const sortedWords = words.sort((a, b) => {
    // Priorité aux scores bas
    if (a.score !== b.score) {
      return a.score - b.score;
    }
    // En cas d'égalité, priorité aux moins testés
    return (a.nb_quiz || 0) - (b.nb_quiz || 0);
  });
  
  return sortedWords.slice(0, Math.min(count, words.length));
}


// reinitailisation du mot de passe - envoi email
async function sendPasswordResetEmail(email, token) {
  const resetLink = `${process.env.APP_URL || 'http://localhost:3000'}/auth/reset-password?token=${token}`;
  
  // Utilisez votre système d'email existant
  return await sendEmail({
    to: email,
    subject: 'Réinitialisation de votre mot de passe - Chinese Quiz',
    html: `
      <h2>Réinitialisation du mot de passe</h2>
      <p>Vous avez demandé à réinitialiser votre mot de passe.</p>
      <p>Cliquez sur le lien ci-dessous pour créer un nouveau mot de passe :</p>
      <a href="${resetLink}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
        Réinitialiser mon mot de passe
      </a>
      <p>Ce lien expirera dans 1 heure.</p>
      <p>Si vous n'avez pas demandé cette réinitialisation, ignorez simplement cet email.</p>
    `
  });
}

// === EXPORT DE TOUS LES MIDDLEWARES ===
module.exports = {
  // Authentification
  ensureAuth,
  ensureAdmin,
  isValidEmail,
  //sendPasswordResetEmail,
  
  // Sessions
  resilience,
  repair, 
  checker,
  security,
  reauth,
  
  // Logging
  requestLogger,
  
  // Erreurs
  errorHandler,

  // Utilitaire
  generateDuelQuiz,
  getRandomUserWords,
  getCommonWords,
  shuffleArray,
  updateWordScore,
  addTransaction,

  // Aide choix mots
  selectWordsNormal,
  selectForAdvancedUser,
};