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

module.exports = { initVapid, sendPushToUser };
