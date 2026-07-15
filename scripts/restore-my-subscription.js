// One-off : restaure l'abonnement d'UN compte à partir de la vérité Stripe.
//
// Contexte : le filet de sécurité horaire avait pu marquer un abonnement encore
// actif chez Stripe comme 'expired' en base. Or la synchro auto ignore les lignes
// 'expired' (WHERE status NOT IN ('canceled','expired')) → elles ne se réparent
// jamais seules. Ce script reconsulte Stripe et remet la ligne à jour SI Stripe
// confirme que l'abonnement est actif.
//
// Usage :
//   node scripts/restore-my-subscription.js you@example.com
//   RESTORE_EMAIL=you@example.com node scripts/restore-my-subscription.js
//
// Ne modifie la base QUE si Stripe dit active/trialing. Sinon, n'écrit rien.

require('dotenv').config();
const { pool } = require('../config/database');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const email = (process.argv[2] || process.env.RESTORE_EMAIL || '').trim();

function extractStripePeriod(subscription) {
  let periodEnd = null;
  let periodStart = null;
  if (subscription?.items?.data?.length > 0) {
    periodEnd = subscription.items.data[0].current_period_end;
    periodStart = subscription.items.data[0].current_period_start;
  }
  if (!periodEnd && subscription?.current_period_end) periodEnd = subscription.current_period_end;
  if (!periodStart && subscription?.current_period_start) periodStart = subscription.current_period_start;
  return {
    periodEndDate: periodEnd ? new Date(periodEnd * 1000) : null,
    periodStartDate: periodStart ? new Date(periodStart * 1000) : null,
  };
}

(async () => {
  if (!email) {
    console.error('❌ Fournis un email : node scripts/restore-my-subscription.js you@example.com');
    process.exit(1);
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('❌ STRIPE_SECRET_KEY manquant dans l\'environnement.');
    process.exit(1);
  }

  try {
    const userRes = await pool.query('SELECT id, email FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
      console.error(`❌ Aucun utilisateur avec l'email ${email}`);
      process.exit(1);
    }
    const userId = userRes.rows[0].id;
    console.log(`👤 user ${userId} (${email})`);

    const subRes = await pool.query(
      `SELECT plan_name, status, stripe_status, stripe_subscription_id, stripe_customer_id, current_period_end
       FROM user_subscriptions WHERE user_id = $1`,
      [userId]
    );
    if (subRes.rows.length === 0) {
      console.error('❌ Aucune ligne user_subscriptions pour ce compte (jamais abonné ?).');
      process.exit(1);
    }
    const dbSub = subRes.rows[0];
    console.log('🗃️  Base actuelle :', {
      plan_name: dbSub.plan_name, status: dbSub.status, stripe_status: dbSub.stripe_status,
      current_period_end: dbSub.current_period_end,
    });

    // Résoudre l'abonnement Stripe : par id, sinon par customer.
    let stripeSub = null;
    if (dbSub.stripe_subscription_id) {
      stripeSub = await stripe.subscriptions.retrieve(dbSub.stripe_subscription_id);
    } else if (dbSub.stripe_customer_id) {
      const list = await stripe.subscriptions.list({ customer: dbSub.stripe_customer_id, status: 'all', limit: 10 });
      stripeSub = list.data.find((s) => s.status === 'active' || s.status === 'trialing') || list.data[0] || null;
    }
    if (!stripeSub) {
      console.error('❌ Impossible de retrouver l\'abonnement côté Stripe (ni subscription_id ni customer exploitable).');
      process.exit(1);
    }

    console.log(`💳 Stripe : status=${stripeSub.status}, cancel_at_period_end=${stripeSub.cancel_at_period_end}`);

    if (stripeSub.status !== 'active' && stripeSub.status !== 'trialing') {
      console.log(`ℹ️ Stripe ne rapporte PAS un abonnement actif (${stripeSub.status}). Aucune modification en base.`);
      process.exit(0);
    }

    const { periodEndDate, periodStartDate } = extractStripePeriod(stripeSub);
    const cancelAtPeriodEnd =
      stripeSub.cancel_at_period_end === true ||
      (typeof stripeSub.cancel_at === 'number' && stripeSub.cancel_at > Math.floor(Date.now() / 1000));
    const canceledAt = stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null;

    const upd = await pool.query(
      `UPDATE user_subscriptions
       SET plan_name = 'premium',
           status = 'active',
           stripe_status = 'active',
           current_period_start = COALESCE($2, current_period_start),
           current_period_end   = COALESCE($3, current_period_end),
           cancel_at_period_end = $4,
           canceled_at = $5,
           stripe_subscription_id = $6,
           stripe_customer_id = COALESCE($7, stripe_customer_id),
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING plan_name, status, stripe_status, current_period_end`,
      [userId, periodStartDate, periodEndDate, cancelAtPeriodEnd, canceledAt, stripeSub.id, stripeSub.customer]
    );

    console.log('✅ Restauré :', upd.rows[0]);
    console.log('🎉 Compte repassé en premium (source : Stripe).');
    process.exit(0);
  } catch (err) {
    console.error('💥 Erreur :', err.message);
    process.exit(1);
  }
})();
