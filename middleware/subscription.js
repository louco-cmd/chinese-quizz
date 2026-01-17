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
    
    // Stocker dans la requête pour usage ultérieur
    req.user.usage = usage;
    req.user.usageLimits = req.user.subscription.limits || {};
    
    next();
  } catch (err) {
    console.error('Usage limit error:', err);
    next();
  }
};

// Vérification spécifique pour l'ajout de mots
exports.canAddWord = (req, res, next) => {
  const plan = req.user.subscription?.plan_name || 'free';
  
  if (plan === 'premium') {
    return next(); // Illimité pour premium
  }
  
  const current = req.user.usage?.words_added || 0;
  const max = req.user.usageLimits?.max_words || 100;
  
  if (current >= max) {
    return res.status(403).json({
      error: 'Word limit reached! Upgrade to Premium for unlimited words.',
      current,
      max,
      upgradeRequired: true
    });
  }
  
  next();
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