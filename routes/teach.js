// routes/teach.js — Espace professeur (classes, invitations, élèves)
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { ensureAuth, ensureTeacher } = require('../middleware/index');

// ── Génération d'un code de classe unique (sans caractères ambigus) ──────────
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // pas de O/0/I/1/L
function randomCode(len = 5) {
  let c = '';
  for (let i = 0; i < len; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return c;
}
async function generateUniqueCode() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const { rows } = await pool.query('SELECT 1 FROM classrooms WHERE join_code = $1', [code]);
    if (rows.length === 0) return code;
  }
  // Fallback ultra-improbable : code plus long
  return randomCode(7);
}

// ── Créer une classe ─────────────────────────────────────────────────────────
router.post('/api/teach/classes', ensureAuth, ensureTeacher, async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const type = req.body.type === 'private' ? 'private' : 'group';
    if (!name || name.length > 80) {
      return res.status(400).json({ error: 'Nom de classe requis (max 80 caractères)' });
    }
    const join_code = await generateUniqueCode();
    const { rows } = await pool.query(
      `INSERT INTO classrooms (teacher_id, name, type, join_code)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, type, join_code, archived, created_at`,
      [req.user.id, name, type, join_code]
    );
    res.json({ success: true, classroom: rows[0] });
  } catch (err) {
    console.error('❌ create class:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Lister les classes du prof (avec compteurs) ──────────────────────────────
router.get('/api/teach/classes', ensureAuth, ensureTeacher, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.type, c.join_code, c.archived, c.created_at,
              COUNT(DISTINCT cs.student_id) FILTER (WHERE cs.status = 'active') AS student_count,
              COUNT(DISTINCT l.id) AS lesson_count
       FROM classrooms c
       LEFT JOIN classroom_students cs ON cs.classroom_id = c.id
       LEFT JOIN lessons l ON l.classroom_id = c.id
       WHERE c.teacher_id = $1
       GROUP BY c.id
       ORDER BY c.archived ASC, c.created_at DESC`,
      [req.user.id]
    );
    res.json({ classrooms: rows });
  } catch (err) {
    console.error('❌ list classes:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Détail d'une classe : élèves + stats ─────────────────────────────────────
router.get('/api/teach/classes/:id', ensureAuth, ensureTeacher, async (req, res) => {
  try {
    const { rows: classRows } = await pool.query(
      `SELECT id, name, type, join_code, archived, created_at
       FROM classrooms WHERE id = $1 AND teacher_id = $2`,
      [req.params.id, req.user.id]
    );
    if (classRows.length === 0) return res.status(404).json({ error: 'Classe introuvable' });

    const { rows: students } = await pool.query(
      `SELECT u.id, u.name, cs.joined_at,
              COUNT(um.mot_id) AS word_count,
              COALESCE(ROUND(AVG(um.score)), 0) AS avg_score
       FROM classroom_students cs
       JOIN users u ON u.id = cs.student_id
       LEFT JOIN user_mots um ON um.user_id = u.id
       WHERE cs.classroom_id = $1 AND cs.status = 'active'
       GROUP BY u.id, u.name, cs.joined_at
       ORDER BY u.name ASC`,
      [req.params.id]
    );

    res.json({ classroom: classRows[0], students });
  } catch (err) {
    console.error('❌ class detail:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Archiver / désarchiver une classe ────────────────────────────────────────
router.post('/api/teach/classes/:id/archive', ensureAuth, ensureTeacher, async (req, res) => {
  try {
    const archived = req.body.archived === true;
    const { rowCount } = await pool.query(
      'UPDATE classrooms SET archived = $1 WHERE id = $2 AND teacher_id = $3',
      [archived, req.params.id, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Classe introuvable' });
    res.json({ success: true, archived });
  } catch (err) {
    console.error('❌ archive class:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Élève : rejoindre une classe via un code ─────────────────────────────────
router.post('/api/teach/join', ensureAuth, async (req, res) => {
  try {
    const code = (req.body.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Code requis' });

    const { rows } = await pool.query(
      'SELECT id, teacher_id, name FROM classrooms WHERE join_code = $1 AND archived = FALSE',
      [code]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Classe introuvable' });
    const classroom = rows[0];

    if (classroom.teacher_id === req.user.id) {
      return res.status(400).json({ error: 'Vous êtes le professeur de cette classe' });
    }

    await pool.query(
      `INSERT INTO classroom_students (classroom_id, student_id)
       VALUES ($1, $2)
       ON CONFLICT (classroom_id, student_id)
       DO UPDATE SET status = 'active'`,
      [classroom.id, req.user.id]
    );
    res.json({ success: true, classroom: { id: classroom.id, name: classroom.name } });
  } catch (err) {
    console.error('❌ join class:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Page : rejoindre via lien /join/:code ────────────────────────────────────
router.get('/join/:code', ensureAuth, async (req, res) => {
  try {
    const code = (req.params.code || '').trim().toUpperCase();
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.type, u.name AS teacher_name
       FROM classrooms c JOIN users u ON u.id = c.teacher_id
       WHERE c.join_code = $1 AND c.archived = FALSE`,
      [code]
    );
    res.render('join-class', {
      user: req.user,
      balance: res.locals.balance || 0,
      isPremium: res.locals.isPremium || false,
      classroom: rows[0] || null,
      code
    });
  } catch (err) {
    console.error('❌ join page:', err);
    res.redirect('/dashboard');
  }
});

module.exports = router;
