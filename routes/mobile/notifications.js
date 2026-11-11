// ════════════════════════════════════════════════════════════════════════════
//  NOTIFICATIONS / PUSH — enregistrement du token Expo, centre de notifs in-app,
//  marquer comme lues. (Le helper notify() d'insertion reste dans mobile.js.)
//  Extrait de routes/mobile.js. Monté via registerNotificationRoutes(router, deps).
// ════════════════════════════════════════════════════════════════════════════
const { pool } = require('../../config/database');

module.exports = function registerNotificationRoutes(router, deps) {
  const { requireToken } = deps;

// ── POST /api/m/push-token : enregistre le token Expo Push de l'appareil ─────
router.post('/api/m/push-token', requireToken, async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Missing token' });
    // Fuseau de l'appareil : sert au push quotidien (trigger « après 20h local »).
    // On ne l'écrase que si fourni et valide (sinon on garde l'existant).
    let tz = String(req.body?.timezone || '').trim();
    try { if (tz) new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = ''; }
    // Accorder la permission OS = consentement : on active les notifs à la 1re
    // inscription du token (ou à sa rotation). Le CASE évalue l'ANCIENNE valeur de
    // expo_push_token, donc un token INCHANGÉ n'écrase jamais un opt-out fait dans
    // les réglages (l'utilisateur peut couper via le toggle, ça reste sticky).
    await pool.query(
      `UPDATE users
         SET notifications_enabled = CASE WHEN expo_push_token IS DISTINCT FROM $1 THEN TRUE ELSE notifications_enabled END,
             expo_push_token = $1,
             timezone = COALESCE(NULLIF($3, ''), timezone)
       WHERE id = $2`,
      [token, req.tokenUser.id, tz]);
    res.json({ ok: true });
  } catch (e) {
    console.error('m/push-token error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/notifications : liste récente + nombre de non-lues ─────────────
router.get('/api/m/notifications', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const [list, unread] = await Promise.all([
      pool.query(
        `SELECT id, type, title, body, data, read, created_at
         FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 40`, [uid]),
      pool.query('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read = FALSE', [uid]),
    ]);
    res.json({ notifications: list.rows, unread: unread.rows[0].n });
  } catch (e) {
    console.error('m/notifications error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/notifications/read : marque tout comme lu ─────────────────────
router.post('/api/m/notifications/read', requireToken, async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE', [req.tokenUser.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('m/notifications read error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

};
