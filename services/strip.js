// services/stripe.js
const Stripe = require('stripe');
const pool = require('../config/database');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

class StripeService {
  // Créer ou récupérer un client Stripe
  async getOrCreateCustomer(userId, email) {
    try {
      // Vérifier si déjà existant
      const existing = await pool.query(
        'SELECT stripe_customer_id FROM users WHERE id = $1',
        [userId]
      );
      
      if (existing.rows[0]?.stripe_customer_id) {
        return existing.rows[0].stripe_customer_id;
      }
      
      // Créer un nouveau client
      const customer = await stripe.customers.create({
        email,
        metadata: { userId: userId.toString() }
      });
      
      // Sauvegarder dans users
      await pool.query(
        'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
        [customer.id, userId]
      );
      
      return customer.id;
    } catch (err) {
      console.error('Error creating Stripe customer:', err);
      throw err;
    }
  }
  
  // Créer une session de paiement
  async createCheckoutSession(userId, priceId) {
    try {
      const userResult = await pool.query(
        'SELECT email FROM users WHERE id = $1',
        [userId]
      );
      
      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }
      
      const customerId = await this.getOrCreateCustomer(userId, userResult.rows[0].email);
      
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        line_items: [{
          price: priceId,
          quantity: 1,
        }],
        mode: 'subscription',
        success_url: `${process.env.APP_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.APP_URL}/pricing`,
        subscription_data: {
          metadata: { userId: userId.toString() }
        },
        metadata: { userId: userId.toString() }
      });
      
      return session;
    } catch (err) {
      console.error('Error creating checkout session:', err);
      throw err;
    }
  }
  
  // Gérer les webhooks
  async handleWebhook(event) {
    try {
      const data = event.data.object;
      
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutComplete(data);
          break;
          
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdate(data);
          break;
          
        case 'customer.subscription.deleted':
          await this.handleSubscriptionCancel(data);
          break;
          
        case 'invoice.payment_succeeded':
          await this.handlePaymentSuccess(data);
          break;
      }
    } catch (err) {
      console.error('Webhook handling error:', err);
      throw err;
    }
  }
  
  async handleCheckoutComplete(session) {
    const userId = session.metadata.userId;
    const subscriptionId = session.subscription;
    
    if (!subscriptionId) return;
    
    // Récupérer les détails de l'abonnement
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    
    // Mettre à jour la base
    await pool.query(`
      INSERT INTO user_subscriptions 
      (user_id, plan_name, status, current_period_start, current_period_end, stripe_subscription_id)
      VALUES ($1, 'premium', 'active', TO_TIMESTAMP($2), TO_TIMESTAMP($3), $4)
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        plan_name = 'premium',
        status = 'active',
        current_period_start = TO_TIMESTAMP($2),
        current_period_end = TO_TIMESTAMP($3),
        stripe_subscription_id = $4,
        updated_at = NOW()
    `, [userId, subscription.current_period_start, subscription.current_period_end, subscriptionId]);
  }
  
  async handleSubscriptionUpdate(subscription) {
    const userId = subscription.metadata?.userId;
    
    if (!userId) return;
    
    await pool.query(`
      UPDATE user_subscriptions 
      SET current_period_end = TO_TIMESTAMP($1),
          status = 'active',
          updated_at = NOW()
      WHERE user_id = $2
    `, [subscription.current_period_end, userId]);
  }
  
  async handleSubscriptionCancel(subscription) {
    const userId = subscription.metadata?.userId;
    
    if (!userId) return;
    
    await pool.query(`
      UPDATE user_subscriptions 
      SET status = 'canceled',
          updated_at = NOW()
      WHERE user_id = $1 AND stripe_subscription_id = $2
    `, [userId, subscription.id]);
  }
  
  async handlePaymentSuccess(invoice) {
    const subscriptionId = invoice.subscription;
    
    if (!subscriptionId) return;
    
    // Récupérer l'utilisateur
    const subResult = await pool.query(
      'SELECT user_id FROM user_subscriptions WHERE stripe_subscription_id = $1',
      [subscriptionId]
    );
    
    if (subResult.rows.length === 0) return;
    
    const userId = subResult.rows[0].user_id;
    
    // Enregistrer le paiement
    await pool.query(`
      INSERT INTO payments (user_id, amount, status, stripe_payment_intent_id, plan_name, period_days)
      VALUES ($1, $2, 'succeeded', $3, 'premium', 30)
    `, [userId, invoice.amount_paid / 100, invoice.payment_intent]);
  }
  
  // Créer un lien de gestion pour le client
  async createCustomerPortal(userId) {
    try {
      const userResult = await pool.query(
        'SELECT stripe_customer_id FROM users WHERE id = $1',
        [userId]
      );
      
      const customerId = userResult.rows[0]?.stripe_customer_id;
      
      if (!customerId) {
        throw new Error('No Stripe customer found');
      }
      
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${process.env.APP_URL}/account`,
      });
      
      return session.url;
    } catch (err) {
      console.error('Error creating portal session:', err);
      throw err;
    }
  }
}

module.exports = new StripeService();