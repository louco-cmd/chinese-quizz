// middleware/push.service.js
// Service centralisé pour l'envoi de notifications Web Push

const webpush = require('web-push');
const { pool } = require('../config/database');

// Initialisation VAPID (appelée une seule fois au démarrage)
function initVapid() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('⚠️  VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY manquants — notifications push désactivées.');
    return;
  }
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:info@jiayou.fr',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  console.log('✅ VAPID initialisé pour les notifications push.');
}

/**
 * Envoie une notification push à tous les appareils actifs d'un utilisateur.
 * @param {number} userId  - id de l'utilisateur destinataire
 * @param {object} payload - { title, body, url, tag }
 */
async function sendPushToUser(userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY) return; // pas configuré → skip silencieux

  let rows;
  try {
    const result = await pool.query(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1 AND enabled = true',
      [userId]
    );
    rows = result.rows;
  } catch (err) {
    console.error('[Push] Erreur lecture push_subscriptions :', err.message);
    return;
  }

  if (!rows.length) return;

  const data = JSON.stringify({
    title: payload.title ?? 'Jiayou',
    body:  payload.body  ?? '',
    url:   payload.url   ?? '/duels',
    tag:   payload.tag   ?? 'jiayou-duel',
  });

  const expiredIds = [];

  await Promise.allSettled(
    rows.map(async (row) => {
      const subscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      };
      try {
        await webpush.sendNotification(subscription, data);
      } catch (err) {
        // 410 Gone ou 404 Not Found = subscription expirée, on la supprime
        if (err.statusCode === 410 || err.statusCode === 404) {
          expiredIds.push(row.id);
        } else {
          console.error(`[Push] Erreur envoi userId=${userId} :`, err.message);
        }
      }
    })
  );

  // Nettoyage des subscriptions expirées
  if (expiredIds.length) {
    await pool.query('DELETE FROM push_subscriptions WHERE id = ANY($1)', [expiredIds])
      .catch(e => console.error('[Push] Erreur suppression subscriptions expirées :', e.message));
  }
}

/**
 * Envoie une notification push NATIVE (app Expo) via l'API Expo Push.
 * Lit le token Expo + le réglage notifications de l'utilisateur.
 * @param {number} userId
 * @param {object} payload - { title, body, data }
 */
async function sendExpoPush(userId, payload) {
  let u;
  try {
    const { rows } = await pool.query(
      'SELECT expo_push_token, notifications_enabled FROM users WHERE id = $1', [userId]);
    u = rows[0];
  } catch (e) {
    console.error('[ExpoPush] lecture user :', e.message);
    return;
  }
  if (!u || !u.expo_push_token) return;                 // pas d'appareil natif enregistré
  if (u.notifications_enabled === false) return;        // désactivé par l'utilisateur
  if (typeof fetch !== 'function') return;              // Node < 18 : pas de fetch global

  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: u.expo_push_token,
        title: payload.title || 'Jiayou',
        body: payload.body || '',
        data: payload.data || {},
        sound: 'default',
        channelId: 'default',
        priority: 'high',
      }),
    });
  } catch (e) {
    console.error('[ExpoPush] envoi :', e.message);
  }
}

module.exports = { initVapid, sendPushToUser, sendExpoPush };
