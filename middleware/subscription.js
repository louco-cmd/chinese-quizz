// middleware/subscription.js
const { pool } = require('../config/database');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Retourne true si la ligne user_subscriptions correspond à un abonnement actif */
function isActiveSubscription(sub) {
  if (!sub) return false;
  // stripe_status est la source de vérité ; on accepte aussi status pour compatibilité
  const stripeStatus = sub.stripe_status || sub.status;
  return stripeStatus === 'active';
}

// ─── withSubscription ─────────────────────────────────────────────────────────
exports.withSubscription = async (req, res, next) => {
  if (!req.isAuthenticated()) return next();

  try {
    const userId = req.user.id;
    console.log(`🔍 [SUBSCRIPTION] Vérification pour user: ${userId}`);

    // Récupérer l'abonnement ET le flag special_guest en une seule requête
    const { rows } = await pool.query(`
      SELECT
        us.status,
        us.stripe_status,
        us.cancel_at_period_end,
        us.current_period_end,
        us.stripe_subscription_id,
        us.updated_at,
        u.special_guest
      FROM users u
      LEFT JOIN user_subscriptions us ON us.user_id = u.id
      WHERE u.id = $1
    `, [userId]);

    const row = rows[0] || {};
    const isSpecialGuest = row.special_guest === true;
    const now = new Date();
    const periodEnd = row.current_period_end ? new Date(row.current_period_end) : null;

    // ── Calcul isPremium ────────────────────────────────────────────────────
    // Ordre de priorité :
    //   1. special_guest → toujours premium
    //   2. stripe_status = 'active' → premium si période non expirée
    //   3. sinon free

    let isPremium = false;

    if (isSpecialGuest) {
      isPremium = true;
      console.log(`⭐ [SUBSCRIPTION] User ${userId} est SPECIAL GUEST`);
    } else if (!row.stripe_status && !row.status) {
      // Aucun abonnement en base
      isPremium = false;
      console.log(`🔍 [SUBSCRIPTION] Aucun abonnement — user ${userId} = FREE`);
    } else {
      const stripeStatus = row.stripe_status || row.status;
      if (stripeStatus === 'active') {
        // Vérification de sécurité : si la période est expirée côté DB
        // et que le webhook n'a pas encore mis à jour, on passe en free
        if (periodEnd && periodEnd < now) {
          console.log(`⚠️ [SUBSCRIPTION] Période expirée pour user ${userId}, passage en free`);
          // Mise à jour silencieuse (le webhook aurait dû le faire)
          await pool.query(`
            UPDATE user_subscriptions
            SET stripe_status = 'expired', status = 'expired', updated_at = NOW()
            WHERE user_id = $1 AND (stripe_status = 'active' OR status = 'active')
          `, [userId]);
          isPremium = false;
        } else {
          isPremium = true;
        }
      } else {
        isPremium = false;
      }
      console.log(`🔍 [SUBSCRIPTION] stripe_status=${stripeStatus} → isPremium=${isPremium}`);
    }

    // ── Peupler req.user ────────────────────────────────────────────────────
    req.user.isPremium    = isPremium;
    req.user.isSpecialGuest = isSpecialGuest;
    req.user.planName     = isSpecialGuest ? 'special_guest' : (isPremium ? 'premium' : 'free');
    req.user.subscription = {
      plan_name:            req.user.planName,
      status:               row.stripe_status || row.status || 'none',
      stripe_status:        row.stripe_status || row.status || 'none',
      cancel_at_period_end: row.cancel_at_period_end || false,
      current_period_end:   row.current_period_end || null,
      isValid:              isPremium,
      isSpecialGuest,
    };

    console.log(`✅ [SUBSCRIPTION] User ${userId}: isPremium=${isPremium}, plan=${req.user.planName}`);
    next();

  } catch (err) {
    console.error('❌ [SUBSCRIPTION] Erreur:', err);
    req.user.isPremium     = false;
    req.user.isSpecialGuest = false;
    req.user.planName      = 'free';
    req.user.subscription  = { plan_name: 'free', status: 'free', isValid: true };
    next();
  }
};

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