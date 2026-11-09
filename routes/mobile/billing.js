// ════════════════════════════════════════════════════════════════════════════
//  BILLING (Stripe web) — abonnement / portail / checkout. Extrait de mobile.js.
//  Monté via registerBillingRoutes(router, { requireToken }).
//  (Le webhook RevenueCat/Stripe vit dans server.js, pas ici.)
// ════════════════════════════════════════════════════════════════════════════
const { pool } = require('../../config/database');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = function registerBillingRoutes(router, deps) {
  const { requireToken } = deps;

// Resync live d'un abonnement depuis Stripe → user_subscriptions. Fiabilité si
// le webhook n'est pas arrivé (annulation via le portail non répercutée). Lit la
// période au niveau item (API récente) avec fallback top-level. Renvoie l'état,
// ou null si l'utilisateur n'a pas d'abonnement Stripe.
async function syncSubscriptionFromStripe(userId) {
  const { rows } = await pool.query(
    'SELECT stripe_subscription_id FROM user_subscriptions WHERE user_id = $1 LIMIT 1', [userId]);
  const subId = rows[0]?.stripe_subscription_id;
  if (!subId) return null;

  const sub = await stripe.subscriptions.retrieve(subId);
  const item = sub.items?.data?.[0];
  const periodEnd = item?.current_period_end ?? sub.current_period_end;
  const periodStart = item?.current_period_start ?? sub.current_period_start;
  const cancelAtPeriodEnd = sub.cancel_at_period_end === true
    || (typeof sub.cancel_at === 'number' && sub.cancel_at > Math.floor(Date.now() / 1000));
  const canceledAt = sub.canceled_at || sub.ended_at;
  const active = sub.status === 'active';
  const toDate = (s) => (typeof s === 'number' ? new Date(s * 1000) : null);

  await pool.query(
    `UPDATE user_subscriptions SET
       plan_name = $1, status = $2, stripe_status = $2,
       current_period_start = $3, current_period_end = $4,
       cancel_at_period_end = $5, canceled_at = $6, updated_at = NOW()
     WHERE user_id = $7`,
    [active ? 'premium' : 'free', sub.status,
     toDate(periodStart), toDate(periodEnd),
     cancelAtPeriodEnd, toDate(canceledAt), userId]);

  return {
    isPremium: active,
    cancelAtPeriodEnd,
    currentPeriodEnd: toDate(periodEnd)?.toISOString() || null,
  };
}

// ── POST /api/m/subscription/refresh : resync Stripe → renvoie l'état à jour ──
router.post('/api/m/subscription/refresh', requireToken, async (req, res) => {
  try {
    const state = await syncSubscriptionFromStripe(req.tokenUser.id);
    if (!state) return res.json({ isPremium: false, cancelAtPeriodEnd: false, currentPeriodEnd: null });
    res.json(state);
  } catch (e) {
    console.error('m/subscription refresh error:', e);
    res.status(500).json({ error: 'Could not refresh subscription' });
  }
});

// ── POST /api/m/subscription/rc-sync : premium depuis l'API RevenueCat ────────
// Secours quand le webhook n'a pas (encore) écrit rc_expires_at : on interroge
// directement RevenueCat par app_user_id (= id backend, fixé via Purchases.configure)
// et on met à jour la base. Nécessite REVENUECAT_SECRET_KEY (clé secrète v1).
router.post('/api/m/subscription/rc-sync', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  const key = process.env.REVENUECAT_SECRET_KEY || '';
  if (!key) return res.json({ synced: false, reason: 'no_key' });
  if (typeof fetch !== 'function') return res.json({ synced: false, reason: 'no_fetch' });
  try {
    const r = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    if (!r.ok) {
      // 404 = RevenueCat n'a AUCUN abonné pour cet app_user_id → l'achat n'est
      // jamais remonté jusqu'à RevenueCat (validation Google KO côté RC).
      console.log(`🔄 rc-sync user ${uid} → HTTP ${r.status} (RevenueCat ne connaît pas cet utilisateur)`);
      return res.json({ synced: false, reason: `http_${r.status}` });
    }
    const data = await r.json();
    const sub = data?.subscriber || {};
    const entKeys = Object.keys(sub.entitlements || {});
    const subKeys = Object.keys(sub.subscriptions || {});
    const ent = sub.entitlements?.premium;
    const expires = ent?.expires_date ? new Date(ent.expires_date) : null;
    const active = !!(expires && expires > new Date());
    if (active) {
      await pool.query('UPDATE users SET rc_expires_at = $1, rc_will_renew = TRUE WHERE id = $2', [expires, uid]);
    } else if (ent) {
      // Entitlement connu mais expiré → on nettoie (sans toucher à l'état Stripe).
      await pool.query('UPDATE users SET rc_expires_at = $1, rc_will_renew = FALSE WHERE id = $2', [expires, uid]);
    }
    // Diagnostic complet : entitlements et abonnements connus de RevenueCat pour
    // cet utilisateur. Si entitlements=[] mais subscriptions=[...], le produit
    // Play n'est pas rattaché à l'entitlement `premium`. Si les deux sont vides,
    // RevenueCat n'a jamais validé l'achat (droits du compte de service Google).
    console.log(`🔄 rc-sync user ${uid} → active=${active} expires=${expires?.toISOString() || 'n/a'} entitlements=[${entKeys.join(',')}] subscriptions=[${subKeys.join(',')}]`);
    res.json({ synced: true, active, expires: expires ? expires.toISOString() : null, entitlements: entKeys, subscriptions: subKeys });
  } catch (e) {
    console.error('rc-sync error:', e.message);
    res.json({ synced: false, reason: 'error' });
  }
});

// ── POST /api/m/billing-portal : portail de facturation Stripe (annulation) ──
// Équivalent mobile de /create-portal-session (web). Renvoie l'URL du portail
// client Stripe pour gérer/annuler l'abonnement.
router.post('/api/m/billing-portal', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT stripe_customer_id FROM user_subscriptions WHERE user_id = $1 LIMIT 1',
      [req.tokenUser.id]);
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) return res.status(400).json({ error: 'No subscription found' });

    const returnUrl = `${process.env.BASE_URL || 'https://app.jiayou.fr'}/account`;
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    res.json({ url: portalSession.url });
  } catch (e) {
    console.error('m/billing-portal error:', e);
    res.status(500).json({ error: 'Could not open the billing portal' });
  }
});

// ── POST /api/m/create-checkout : session Stripe Checkout (web) → { url } ─────
// Abonnement web SANS détour par le site public : on crée la session Stripe et
// le client ouvre l'URL directement. Retour géré par le SPA via ?session_id=.
router.post('/api/m/create-checkout', requireToken, async (req, res) => {
  try {
    const priceID = process.env.STRIPE_PRICE_PREMIUM;
    if (!priceID) return res.status(500).json({ error: 'Stripe not configured' });
    const uid = req.tokenUser.id;
    const { rows: u } = await pool.query('SELECT email FROM users WHERE id = $1', [uid]);
    const email = u[0]?.email;

    // Origine de retour : allowlist stricte (anti open-redirect).
    const ALLOWED = ['https://app.jiayou.fr', 'https://jiayou.fr', 'http://localhost:8081'];
    const raw = String(req.body?.returnUrl || '').replace(/\/+$/, '');
    const base = ALLOWED.includes(raw) ? raw : 'https://app.jiayou.fr';

    const { rows: sub } = await pool.query(
      'SELECT stripe_customer_id FROM user_subscriptions WHERE user_id = $1 LIMIT 1', [uid]);
    const customerId = sub[0]?.stripe_customer_id || null;

    const params = {
      mode: 'subscription',
      line_items: [{ price: priceID, quantity: 1 }],
      success_url: `${base}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/`,
      metadata: { userId: String(uid), planName: 'premium' },
      // Propage userId à la SUBSCRIPTION → les webhooks customer.subscription.*
      // (renouvellement, annulation) peuvent aussi remonter au bon compte.
      subscription_data: { metadata: { userId: String(uid), planName: 'premium' } },
    };
    if (customerId) params.customer = customerId; else params.customer_email = email;

    let session;
    try {
      session = await stripe.checkout.sessions.create(params);
    } catch (err) {
      // Customer supprimé côté Stripe (test) : retry sans lui.
      if (err.code === 'resource_missing' && customerId) {
        delete params.customer; params.customer_email = email;
        session = await stripe.checkout.sessions.create(params);
      } else throw err;
    }
    res.json({ url: session.url });
  } catch (e) {
    console.error('m/create-checkout error:', e);
    res.status(500).json({ error: 'Could not start checkout' });
  }
});

};
