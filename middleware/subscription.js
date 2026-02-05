// middleware/subscription.js
const { pool } = require('../config/database');

// Middleware principal qui enrichit req.user avec subscription info
exports.withSubscription = async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return next();
  }
  
  try {
    const userId = req.user.id;
    
    // Récupérer l'abonnement actif
    const subResult = await pool.query(`
      SELECT us.*, sp.features, sp.limits
      FROM user_subscriptions us
      LEFT JOIN subscription_plans sp ON us.plan_name = sp.name
      WHERE us.user_id = $1 
        AND us.status = 'active'
        AND (us.current_period_end IS NULL OR us.current_period_end > NOW())
      LIMIT 1
    `, [userId]);
    
    let subscription;
    
    if (subResult.rows.length > 0) {
      subscription = {
        ...subResult.rows[0],
        features: subResult.rows[0].features || {},
        limits: subResult.rows[0].limits || {}
      };
    } else {
      // Plan gratuit par défaut
      const freePlan = await pool.query(
        'SELECT features, limits FROM subscription_plans WHERE name = $1',
        ['free']
      );
      
      subscription = {
        plan_name: 'free',
        status: 'active',
        features: freePlan.rows[0]?.features || {},
        limits: freePlan.rows[0]?.limits || {}
      };
    }
    
    req.user.subscription = subscription;
    next();
  } catch (err) {
    console.error('Subscription middleware error:', err);
    req.user.subscription = { plan_name: 'free', status: 'active' };
    next();
  }
};

// Middleware pour vérifier une feature
exports.requireFeature = (feature) => {
  return (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const hasFeature = req.user.subscription?.features?.[feature];
    
    if (!hasFeature) {
      return res.status(403).json({
        error: `This feature requires Premium subscription`,
        requiredPlan: 'premium',
        upgradeUrl: '/pricing'
      });
    }
    
    next();
  };
};

// Middleware pour vérifier une limite
exports.checkLimit = async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return next();
  }
  
  try {
    const userId = req.user.id;
    const plan = req.user.subscription?.plan_name || 'free';
    const today = new Date().toISOString().split('T')[0];
    
    // Récupérer l'utilisation d'aujourd'hui
    const usageResult = await pool.query(
      'SELECT * FROM user_usage WHERE user_id = $1 AND date = $2',
      [userId, today]
    );
    
    let usage = usageResult.rows[0];
    
    if (!usage) {
      // Créer une entrée pour aujourd'hui
      await pool.query(
        'INSERT INTO user_usage (user_id, date) VALUES ($1, $2)',
        [userId, today]
      );
      usage = { words_added: 0, duels_played: 0, quizzes_taken: 0 };
    }
    
    // CORRECTION ICI : S'assurer que subscription existe
    if (!req.user.subscription) {
      // Charger l'abonnement si manquant
      const subResult = await pool.query(
        'SELECT * FROM subscription_plans WHERE name = $1',
        ['free']
      );
      
      req.user.subscription = {
        plan_name: 'free',
        status: 'active',
        features: subResult.rows[0]?.features || {},
        limits: subResult.rows[0]?.limits || {}
      };
    }
    
    // CORRECTION : Utiliser l'opérateur de chaînage optionnel
    req.user.usage = usage;
    req.user.usageLimits = req.user.subscription?.limits || {
      // Valeurs par défaut
      daily_words: 100,
      daily_duels: 1,
      daily_quizzes: 100,
      max_words: 10000
    };
    
    next();
  } catch (err) {
    console.error('Usage limit error:', err);
    // Fournir des valeurs par défaut en cas d'erreur
    req.user.usageLimits = {
      daily_words: 100,
      daily_duels: 1,
      daily_quizzes: 100,
      max_words: 10000
    };
    next();
  }
};

exports.canAddWord = async (req, res, next) => {
  try {
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: "Not authenticated" 
      });
    }
    
    const { rows } = await pool.query(
      "SELECT COUNT(*) as count FROM user_mots WHERE user_id = $1",
      [user.id]
    );
    
    const currentCount = parseInt(rows[0].count);
    const maxWords = user.is_premium ? 10000 : 10000;
    
    req.user.currentWordCount = currentCount;
    
    if (currentCount >= maxWords) {
      // ⚠️ Utilisez un statut d'erreur (400, 403, 429...)
      return res.status(403).json({  // <-- CHANGEMENT ICI
        success: false,
        limitReached: true,
        current: currentCount,
        max: maxWords,
        message: `Word limit reached (${currentCount}/${maxWords})`
      });
    }
    
    next();
  } catch (error) {
    console.error('Error in canAddWord middleware:', error);
    next(error);
  }
}; 

// Vérification pour les duels
exports.canPlayDuel = (req, res, next) => {
  const plan = req.user.subscription?.plan_name || 'free';
  
  if (plan === 'premium') {
    return next();
  }
  
  const current = req.user.usage?.duels_played || 0;
  const max = req.user.usageLimits?.daily_duels || 1;
  
  if (current >= max) {
    return res.status(403).json({
      error: 'Daily duel limit reached! Upgrade to Premium for unlimited duels.',
      current,
      max,
      upgradeRequired: true
    });
  }
  
  next();
};

// Vérification pour les quiz
exports.canTakeQuiz = async (req, res, next) => {
  const plan = req.user.subscription?.plan_name || 'free';
  
  if (plan === 'premium') {
    return next();
  }
  
  try {
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];
    
    // Récupérer l'usage d'aujourd'hui
    const usageResult = await pool.query(
      'SELECT quizzes_taken FROM user_usage WHERE user_id = $1 AND date = $2',
      [userId, today]
    );
    
    let quizzesTakenToday = 0;
    
    if (usageResult.rows.length > 0) {
      quizzesTakenToday = usageResult.rows[0].quizzes_taken || 0;
    }
    
    const maxQuizzes = req.user.usageLimits?.daily_quizzes || 100; // Par défaut 5 quiz/jour
    
    if (quizzesTakenToday >= maxQuizzes) {
      return res.status(403).json({
        success: false,
        limitReached: true,
        type: 'quiz',
        current: quizzesTakenToday,
        max: maxQuizzes,
        message: `Daily quiz limit reached! You've taken ${quizzesTakenToday}/${maxQuizzes} quizzes today. Upgrade to Premium for unlimited quizzes.`
      });
    }
    
    next();
  } catch (error) {
    console.error('Error checking quiz limit:', error);
    // En cas d'erreur, permettre de continuer (meilleure UX)
    next();
  }
};