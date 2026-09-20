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
// Type de notif → colonne de préférence (catégorie). Le master reste
// notifications_enabled ; une catégorie à false coupe uniquement ce type.
const TYPE_CATEGORY = {
  duel_new: 'notif_duels', duel_result: 'notif_duels',
  duel_reminder: 'notif_duels', duel_expired: 'notif_duels',
  pack_new: 'notif_packs', pack_sold: 'notif_packs',
  red_envelope: 'notif_social',
  reengage: 'notif_reminders',
};

async function sendExpoPush(userId, payload) {
  let u;
  try {
    const { rows } = await pool.query(
      `SELECT expo_push_token, notifications_enabled,
              notif_duels, notif_packs, notif_social, notif_reminders
       FROM users WHERE id = $1`, [userId]);
    u = rows[0];
  } catch (e) {
    console.error('[ExpoPush] lecture user :', e.message);
    return;
  }
  if (!u || !u.expo_push_token) return;                 // pas d'appareil natif enregistré
  if (u.notifications_enabled === false) return;        // master coupé
  const cat = TYPE_CATEGORY[payload?.data?.type];       // catégorie coupée ?
  if (cat && u[cat] === false) return;
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

/**
 * Envoi push NATIF groupé (broadcast) via l'API Expo Push, par lots de 100.
 * @param {string[]} tokens - tokens Expo déjà filtrés (notifs activées + non nuls)
 * @param {object} payload  - { title, body, data }
 */
async function sendExpoPushBulk(tokens, payload) {
  const list = [...new Set((tokens || []).filter(Boolean))];
  if (!list.length || typeof fetch !== 'function') return;
  const base = {
    title: payload.title || 'Jiayou',
    body: payload.body || '',
    data: payload.data || {},
    sound: 'default',
    channelId: 'default',
    priority: 'high',
  };
  for (let i = 0; i < list.length; i += 100) {
    const messages = list.slice(i, i + 100).map((to) => ({ to, ...base }));
    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
    } catch (e) {
      console.error('[ExpoPushBulk] envoi :', e.message);
    }
  }
}

module.exports = { initVapid, sendPushToUser, sendExpoPush, sendExpoPushBulk };
