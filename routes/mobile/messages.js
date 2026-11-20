// ════════════════════════════════════════════════════════════════════════════
//  MESSAGERIE prof ↔ élève (1:1, texte seul) — Phase 1, polling, zéro temps réel.
//  Règle d'autorisation : un élève et un prof peuvent se parler si
//    • l'élève est lié au prof via une classe active (classroom_students), OU
//    • il existe un cours d'essai BOOKÉ entre eux (teacher_slots note ILIKE 'trial',
//      quel que soit l'horaire : passé, en cours ou à venir).
//  Monté via require('./mobile/messages')(router, { requireToken, notify }).
// ════════════════════════════════════════════════════════════════════════════
const { pool } = require('../../config/database');

const BODY_MAX = 2000;

module.exports = function registerMessageRoutes(router, deps) {
  const { requireToken, notify } = deps;

  async function roleOf(userId) {
    const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    return rows.length ? (rows[0].role || 'student') : null;
  }

  // La paire (prof, élève) est-elle autorisée à discuter ?
  async function pairAllowed(teacherId, studentId) {
    const { rows } = await pool.query(
      `SELECT (
         EXISTS (SELECT 1 FROM classroom_students cs JOIN classrooms c ON c.id = cs.classroom_id
                  WHERE c.teacher_id = $1 AND cs.student_id = $2 AND cs.status = 'active')
         OR EXISTS (SELECT 1 FROM teacher_slots ts
                     WHERE ts.teacher_id = $1 AND ts.student_id = $2
                       AND ts.status = 'booked' AND ts.note ILIKE 'trial')
       ) AS ok`,
      [teacherId, studentId]);
    return !!rows[0]?.ok;
  }

  // À partir de « moi » + « peer », déduit qui est le prof et qui est l'élève.
  // Renvoie { teacherId, studentId } ou null si ce n'est pas une paire prof/élève.
  async function resolvePair(meId, peerId) {
    if (!peerId || peerId === meId) return null;
    const [mine, theirs] = await Promise.all([roleOf(meId), roleOf(peerId)]);
    if (!mine || !theirs) return null;
    if (mine === 'teacher' && theirs !== 'teacher') return { teacherId: meId, studentId: peerId };
    if (mine !== 'teacher' && theirs === 'teacher') return { teacherId: peerId, studentId: meId };
    return null; // deux profs ou deux élèves : interdit
  }

  // ── GET /api/m/messages : conversations (avec dernier message + non-lus) +
  //    contacts autorisés sans conversation encore entamée. ────────────────────
  router.get('/api/m/messages', requireToken, async (req, res) => {
    try {
      const uid = req.tokenUser.id;
      const myRole = await roleOf(uid);

      const convs = await pool.query(
        `SELECT c.id,
                CASE WHEN c.teacher_id = $1 THEN c.student_id ELSE c.teacher_id END AS peer_id,
                u.name AS peer_name, u.avatar_icon AS peer_avatar, u.avatar_color AS peer_color,
                c.last_message_at,
                (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
                (SELECT m.sender_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_sender_id,
                (SELECT COUNT(*) FROM messages m
                   WHERE m.conversation_id = c.id AND m.sender_id <> $1
                     AND m.created_at > COALESCE(CASE WHEN c.teacher_id = $1 THEN c.teacher_read_at ELSE c.student_read_at END, '1970-01-01'::timestamp)
                )::int AS unread
           FROM conversations c
           JOIN users u ON u.id = CASE WHEN c.teacher_id = $1 THEN c.student_id ELSE c.teacher_id END
          WHERE (c.teacher_id = $1 OR c.student_id = $1) AND c.last_message_at IS NOT NULL
          ORDER BY c.last_message_at DESC`,
        [uid]);

      // Contacts autorisés (selon mon rôle) : élèves de mes classes/essais (prof)
      // ou profs de mes classes/essais (élève).
      const contactsSql = myRole === 'teacher'
        ? `SELECT u.id, u.name, u.avatar_icon, u.avatar_color FROM users u WHERE u.id IN (
             SELECT cs.student_id FROM classroom_students cs JOIN classrooms c ON c.id = cs.classroom_id
               WHERE c.teacher_id = $1 AND cs.status = 'active'
             UNION
             SELECT ts.student_id FROM teacher_slots ts
               WHERE ts.teacher_id = $1 AND ts.status = 'booked' AND ts.note ILIKE 'trial' AND ts.student_id IS NOT NULL
           )`
        : `SELECT u.id, u.name, u.avatar_icon, u.avatar_color FROM users u WHERE u.id IN (
             SELECT c.teacher_id FROM classroom_students cs JOIN classrooms c ON c.id = cs.classroom_id
               WHERE cs.student_id = $1 AND cs.status = 'active'
             UNION
             SELECT ts.teacher_id FROM teacher_slots ts
               WHERE ts.student_id = $1 AND ts.status = 'booked' AND ts.note ILIKE 'trial'
           )`;
      const contactsRows = (await pool.query(contactsSql, [uid])).rows;
      const withConv = new Set(convs.rows.map((c) => c.peer_id));
      const contacts = contactsRows.filter((c) => !withConv.has(c.id));

      const unread_total = convs.rows.reduce((n, c) => n + (c.unread || 0), 0);
      res.json({ conversations: convs.rows, contacts, unread_total, role: myRole });
    } catch (e) { console.error('m/messages list:', e); res.status(500).json({ error: 'Server error' }); }
  });

  // ── POST /api/m/messages/open { peer_id } : ouvre (ou crée) la conversation ──
  router.post('/api/m/messages/open', requireToken, async (req, res) => {
    try {
      const uid = req.tokenUser.id;
      const peerId = Number(req.body?.peer_id);
      if (!Number.isInteger(peerId)) return res.status(400).json({ error: 'Missing peer_id' });
      const pair = await resolvePair(uid, peerId);
      if (!pair) return res.status(403).json({ error: 'Not allowed' });
      if (!(await pairAllowed(pair.teacherId, pair.studentId))) return res.status(403).json({ error: 'Not allowed' });
      const { rows } = await pool.query(
        `INSERT INTO conversations (teacher_id, student_id) VALUES ($1, $2)
         ON CONFLICT (teacher_id, student_id) DO UPDATE SET student_id = EXCLUDED.student_id
         RETURNING id`,
        [pair.teacherId, pair.studentId]);
      res.json({ id: rows[0].id });
    } catch (e) { console.error('m/messages open:', e); res.status(500).json({ error: 'Server error' }); }
  });

  // Vérifie que je participe à la conversation ; renvoie la ligne ou null.
  async function myConversation(convId, uid) {
    const { rows } = await pool.query(
      `SELECT c.id, c.teacher_id, c.student_id,
              CASE WHEN c.teacher_id = $2 THEN c.student_id ELSE c.teacher_id END AS peer_id,
              u.name AS peer_name, u.avatar_icon AS peer_avatar, u.avatar_color AS peer_color
         FROM conversations c
         JOIN users u ON u.id = CASE WHEN c.teacher_id = $2 THEN c.student_id ELSE c.teacher_id END
        WHERE c.id = $1 AND (c.teacher_id = $2 OR c.student_id = $2)`,
      [convId, uid]);
    return rows[0] || null;
  }

  // ── GET /api/m/messages/:id?after=<msgId> : messages + marque lu ────────────
  router.get('/api/m/messages/:id', requireToken, async (req, res) => {
    try {
      const uid = req.tokenUser.id;
      const convId = Number(req.params.id);
      if (!Number.isInteger(convId)) return res.status(400).json({ error: 'Bad id' });
      const conv = await myConversation(convId, uid);
      if (!conv) return res.status(404).json({ error: 'Not found' });
      const after = Number(req.query.after) || 0;
      const { rows } = await pool.query(
        `SELECT id, sender_id, body, created_at FROM messages
          WHERE conversation_id = $1 AND id > $2 ORDER BY id ASC LIMIT 200`,
        [convId, after]);
      // Marque ma lecture (compteur de non-lus).
      const col = conv.teacher_id === uid ? 'teacher_read_at' : 'student_read_at';
      await pool.query(`UPDATE conversations SET ${col} = NOW() WHERE id = $1`, [convId]);
      res.json({ messages: rows, peer: { id: conv.peer_id, name: conv.peer_name, avatar_icon: conv.peer_avatar, avatar_color: conv.peer_color }, me: uid });
    } catch (e) { console.error('m/messages thread:', e); res.status(500).json({ error: 'Server error' }); }
  });

  // ── POST /api/m/messages/:id { body } : envoie un message ──────────────────
  router.post('/api/m/messages/:id', requireToken, async (req, res) => {
    try {
      const uid = req.tokenUser.id;
      const convId = Number(req.params.id);
      if (!Number.isInteger(convId)) return res.status(400).json({ error: 'Bad id' });
      const body = String(req.body?.body || '').trim().slice(0, BODY_MAX);
      if (!body) return res.status(400).json({ error: 'Empty message' });
      const conv = await myConversation(convId, uid);
      if (!conv) return res.status(404).json({ error: 'Not found' });

      const ins = await pool.query(
        `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)
         RETURNING id, sender_id, body, created_at`,
        [convId, uid, body]);
      const msg = ins.rows[0];
      // Touch conversation + marque l'expéditeur comme à jour.
      const col = conv.teacher_id === uid ? 'teacher_read_at' : 'student_read_at';
      await pool.query(`UPDATE conversations SET last_message_at = NOW(), ${col} = NOW() WHERE id = $1`, [convId]);

      // Notif au destinataire — débounce : pas de push si j'ai déjà écrit le
      // message précédent il y a moins de 2 min (évite le spam sur une rafale).
      const prev = await pool.query(
        `SELECT sender_id, created_at FROM messages WHERE conversation_id = $1 AND id < $2 ORDER BY id DESC LIMIT 1`,
        [convId, msg.id]);
      const p = prev.rows[0];
      const debounced = p && p.sender_id === uid && (Date.now() - new Date(p.created_at).getTime() < 2 * 60000);
      if (!debounced) {
        const nameRow = await pool.query('SELECT name FROM users WHERE id = $1', [uid]);
        const myName = nameRow.rows[0]?.name || 'New message';
        const preview = body.length > 120 ? body.slice(0, 117) + '…' : body;
        notify(conv.peer_id, 'message', myName, preview, { conversationId: convId, peerId: uid });
      }
      res.json({ message: msg });
    } catch (e) { console.error('m/messages send:', e); res.status(500).json({ error: 'Server error' }); }
  });
};
