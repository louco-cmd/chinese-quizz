// middleware/subscription.js
const { pool } = require('../config/database');

exports.withSubscription = async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return next();
  }

  try {
    const userId = req.user.id;

    console.log(`🔍 [SUBSCRIPTION] Vérification abonnement pour user: ${userId}`);

    // Récupérer l'abonnement
    const subscriptionResult = await pool.query(`
      SELECT 
        status,
        cancel_at_period_end,
        current_period_end,
        stripe_subscription_id,
        updated_at
      FROM user_subscriptions 
      WHERE user_id = $1
    `, [userId]);

    let currentSubscription = subscriptionResult.rows[0];

    if (!currentSubscription) {
      console.log(`🔍 [SUBSCRIPTION] Aucun abonnement - user ${userId} = FREE`);
      req.user.isPremium = false;
      req.user.planName = 'free';
      req.user.subscription = {
        plan_name: 'free',
        status: 'free',
        isValid: true
      };
    } else {
      const now = new Date();
      const periodEnd = currentSubscription.current_period_end ?
        new Date(currentSubscription.current_period_end) : null;

      let isPremium = false;
      let isValid = true;

      if (currentSubscription.status === 'active') {
        // Logique SIMPLIFIÉE: Si stripe_status est 'active', c'est premium
        isPremium = true;
        isValid = true;

        console.log(`✅ [SUBSCRIPTION] Statut 'active' - User ${userId} est Premium`);
      } else {
        // Statut non actif (canceled, past_due, etc.)
        isValid = false;
        isPremium = false;
      }

      console.log(`🔍 [SUBSCRIPTION] User ${userId}:`, {
        stripe_status: currentSubscription.status,
        cancel_at_period_end: currentSubscription.cancel_at_period_end,
        periodEnd: periodEnd?.toISOString(),
        isPremium: isPremium,
        isValid: isValid
      });

      req.user.isPremium = isPremium;
      req.user.planName = isPremium ? 'premium' : 'free';
      req.user.subscription = {
        plan_name: isPremium ? 'premium' : 'free',
        status: currentSubscription.status,
        stripe_status: currentSubscription.status,
        cancel_at_period_end: currentSubscription.cancel_at_period_end,
        current_period_end: currentSubscription.current_period_end,
        isValid: isValid
      };

      // ⚠️ SUPPRIMEZ CE BLOC - Ne marquez pas automatiquement comme expiré
      // C'est Stripe qui doit gérer ça via les webhooks
      /*
      if (currentSubscription.stripe_status === 'active' && periodEnd && periodEnd < now) {
        console.log(`🧹 [SUBSCRIPTION] Nettoyage abonnement expiré pour user ${userId}`);
        await pool.query(`
          UPDATE user_subscriptions 
          SET stripe_status = 'expired', updated_at = NOW()
          WHERE user_id = $1
        `, [userId]);
      }
      */
    }

    console.log(`✅ [SUBSCRIPTION] Résultat pour ${userId}: Premium=${req.user.isPremium}, Plan=${req.user.planName}`);
    next();

  } catch (err) {
    console.error('❌ [SUBSCRIPTION] Erreur:', err);
    // Fallback sûr
    req.user.isPremium = false;
    req.user.planName = 'free';
    req.user.subscription = {
      plan_name: 'free',
      status: 'active',
      isValid: true
    };
    next();
  }
};

// Supprime la fonction checkIfSubscriptionIsValid (plus utilisée)

// MIDDLEWARE canAddWord - VERSION SIMPLIFIÉE
exports.canAddWord = async (req, res, next) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Non authentifié"
      });
    }

    // DEBUG CRITIQUE
    console.log('🔍 [canAddWord] DEBUG:', {
      userId: user.id,
      email: user.email,
      isPremium: user.isPremium, // ← Utilise isPremium directement
      planName: user.planName,
      subscription: user.subscription
    });

    // Vérifier les limites
    const { rows } = await pool.query(
      "SELECT COUNT(*) as count FROM user_mots WHERE user_id = $1",
      [user.id]
    );

    const currentCount = parseInt(rows[0].count);
    const maxWords = user.isPremium ? 100000 : 350; // ← Limites simples

    console.log(`🔍 [canAddWord] Limite: ${currentCount}/${maxWords} (Premium: ${user.isPremium})`);

    if (currentCount >= maxWords) {
      return res.status(403).json({
        success: false,
        limitReached: true,
        current: currentCount,
        max: maxWords,
        message: `Limite de mots atteinte (${currentCount}/${maxWords})`,
        upgradeRequired: !user.isPremium
      });
    }

    req.user.currentWordCount = currentCount;
    next();

  } catch (error) {
    console.error('❌ Erreur canAddWord:', error);
    next(error);
  }
};

// Vérification pour les duels - VERSION SIMPLIFIÉE
exports.canPlayDuel = async (req, res, next) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Si premium, pas de limite
    if (user.isPremium) {
      return next();
    }

    // Pour les free users, limite simple
    const today = new Date().toISOString().split('T')[0];
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM duels 
       WHERE (challenger_id = $1 OR opponent_id = $1) 
       AND created_at::date = $2`,
      [user.id, today]
    );

    const duelsToday = parseInt(result.rows[0].count);
    const maxDuels = 1; // 1 duel par jour pour free

    if (duelsToday >= maxDuels) {
      return res.status(403).json({
        error: 'Daily duel limit reached!',
        message: `Free users can play only ${maxDuels} duel per day. Upgrade to Premium for unlimited duels.`,
        current: duelsToday,
        max: maxDuels,
        upgradeRequired: true
      });
    }

    next();
  } catch (error) {
    console.error('Error checking duel limit:', error);
    next(error);
  }
};

exports.canTakeQuiz = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    if (user.isPremium) return next();

    const today = new Date().toISOString().split('T')[0];
    const result = await pool.query(
      `SELECT COUNT(*) as count 
       FROM quiz_history 
       WHERE user_id = $1 AND date_completed::date = $2`,
      [user.id, today]
    );

    const quizzesToday = parseInt(result.rows[0].count);
    const maxQuizzes = 2;

    if (quizzesToday >= maxQuizzes) {
      return res.status(403).json({
        success: false,
        limitReached: true,
        type: 'quiz',
        current: quizzesToday,
        max: maxQuizzes,
        message: `Daily quiz limit reached! Free users can take only ${maxQuizzes} quizzes per day.`,
        upgradeRequired: true
      });
    }

    next();
  } catch (error) {
    console.error('❌ Erreur canTakeQuiz:', error);
    next(error);
  }
};

// Middleware pour vérifier une fonctionnalité spécifique
exports.requireFeature = (feature) => {
  return async (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Logique simple: si premium, toutes les fonctionnalités sont disponibles
    if (req.user.isPremium) {
      return next();
    }

    // Liste des fonctionnalités premium
    const premiumFeatures = {
      'unlimited_words': true,
      'unlimited_duels': true,
      'unlimited_quizzes': true,
      'offline_mode': true,
      'no_ads': true,
      'advanced_analytics': true
    };

    if (premiumFeatures[feature]) {
      return res.status(403).json({
        error: `This feature requires Premium subscription`,
        requiredPlan: 'premium',
        feature: feature,
        upgradeUrl: '/pricing'
      });
    }

    next();
  };
};