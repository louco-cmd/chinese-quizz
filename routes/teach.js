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

// ── Stats globales du prof (header de la page classes) ───────────────────────
router.get('/api/teach/overview', ensureAuth, ensureTeacher, async (req, res) => {
  try {
    const t = req.user.id;
    const { rows } = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM classrooms WHERE teacher_id = $1 AND archived = FALSE)::int AS classes,
         (SELECT COUNT(DISTINCT cs.student_id)
            FROM classroom_students cs JOIN classrooms cl ON cl.id = cs.classroom_id
            WHERE cl.teacher_id = $1 AND cs.status = 'active')::int AS students,
         (SELECT COUNT(l.id)
            FROM lessons l JOIN classrooms cl ON cl.id = l.classroom_id
            WHERE cl.teacher_id = $1)::int AS tasks,
         (SELECT COALESCE(ROUND(AVG(um.score)), 0)
            FROM classroom_students cs
            JOIN classrooms cl ON cl.id = cs.classroom_id AND cl.teacher_id = $1
            JOIN user_mots um ON um.user_id = cs.student_id
            WHERE cs.status = 'active')::int AS avg_knowledge`,
      [t]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('❌ overview:', err);
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

// ── Supprimer une classe (CASCADE : élèves inscrits + leçons + mots de leçon) ─
router.delete('/api/teach/classes/:id', ensureAuth, ensureTeacher, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM classrooms WHERE id = $1 AND teacher_id = $2',
      [req.params.id, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Classe introuvable' });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ delete class:', err);
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

// ── Retirer un élève d'une classe ────────────────────────────────────────────
router.post('/api/teach/classes/:id/students/:studentId/revoke', ensureAuth, ensureTeacher, async (req, res) => {
  try {
    if (!(await ownsClass(req.user.id, req.params.id))) return res.status(404).json({ error: 'Classe introuvable' });
    await pool.query(
      `UPDATE classroom_students SET status = 'removed' WHERE classroom_id = $1 AND student_id = $2`,
      [req.params.id, req.params.studentId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('❌ revoke student:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Progression d'une task : % de connaissance + nb de quiz par élève ─────────
router.get('/api/teach/lessons/:lessonId/progress', ensureAuth, ensureTeacher, async (req, res) => {
  try {
    const { rows: lrows } = await pool.query(
      `SELECT l.id, l.title, l.summary, l.classroom_id, l.created_at
       FROM lessons l JOIN classrooms c ON c.id = l.classroom_id
       WHERE l.id = $1 AND c.teacher_id = $2`,
      [req.params.lessonId, req.user.id]
    );
    if (!lrows.length) return res.status(404).json({ error: 'Task introuvable' });
    const lesson = lrows[0];

    const { rows: words } = await pool.query(
      `SELECT m.id, m.chinese, m.pinyin, m.english
       FROM lesson_words lw JOIN mots m ON m.id = lw.mot_id
       WHERE lw.lesson_id = $1 ORDER BY lw.id ASC`,
      [lesson.id]
    );

    // % de connaissance = moyenne du score de l'élève sur les mots de la task
    // (mots non encore travaillés comptés à 0). + nombre de quiz passés sur la task.
    const { rows: students } = await pool.query(
      `SELECT cs.student_id, u.name,
              ROUND(AVG(COALESCE(um.score, 0)))::int AS knowledge,
              COALESCE(qc.cnt, 0)::int AS quiz_count
       FROM classroom_students cs
       JOIN users u ON u.id = cs.student_id
       JOIN lesson_words lw ON lw.lesson_id = $1
       LEFT JOIN user_mots um ON um.mot_id = lw.mot_id AND um.user_id = cs.student_id
       LEFT JOIN (
         SELECT student_id, COUNT(*) AS cnt FROM lesson_quiz_results WHERE lesson_id = $1 GROUP BY student_id
       ) qc ON qc.student_id = cs.student_id
       WHERE cs.classroom_id = $2 AND cs.status = 'active'
       GROUP BY cs.student_id, u.name, qc.cnt
       ORDER BY knowledge DESC, u.name ASC`,
      [lesson.id, lesson.classroom_id]
    );

    res.json({ lesson, words, students });
  } catch (err) {
    console.error('❌ lesson progress:', err);
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

// ══════════════════════════════════════════════════════════════════════════
//  TASKS (leçons) — résumé + liste de mots
// ══════════════════════════════════════════════════════════════════════════

// Vérifie que la classe appartient bien au prof
async function ownsClass(teacherId, classId) {
  const { rows } = await pool.query(
    'SELECT id FROM classrooms WHERE id = $1 AND teacher_id = $2', [classId, teacherId]
  );
  return rows.length > 0;
}

// Fetch groupé dans le dictionnaire : pour une liste de mots chinois, dit
// lesquels existent déjà (avec traduction) et lesquels manquent.
router.post('/api/teach/mots/lookup', ensureAuth, ensureTeacher, async (req, res) => {
  try {
    const words = Array.isArray(req.body.words) ? req.body.words : [];
    const cleaned = [...new Set(words.map(w => String(w || '').trim()).filter(Boolean))].slice(0, 50);
    if (!cleaned.length) return res.json({ results: [] });

    // Direction-aware (comme le dashboard) : cours de chinois → clé = chinois ;
    // cours d'anglais → clé = anglais (insensible à la casse).
    const isZhEn = (req.user.quiz_direction === 'zh→en');
    let byKey = {};
    if (isZhEn) {
      const { rows } = await pool.query(
        `SELECT id, chinese, pinyin, english FROM mots WHERE LOWER(english) = ANY($1::text[])`,
        [cleaned.map(w => w.toLowerCase())]
      );
      rows.forEach(r => { byKey[(r.english || '').toLowerCase()] = r; });
      const results = cleaned.map(w => ({ input: w, mot: byKey[w.toLowerCase()] || null }));
      return res.json({ results });
    } else {
      const { rows } = await pool.query(
        `SELECT id, chinese, pinyin, english FROM mots WHERE chinese = ANY($1::text[])`,
        [cleaned]
      );
      rows.forEach(r => { byKey[r.chinese] = r; });
      const results = cleaned.map(w => ({ input: w, mot: byKey[w] || null }));
      return res.json({ results });
    }
  } catch (err) {
    console.error('❌ mots lookup:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Lister les tasks d'une classe
router.get('/api/teach/classes/:id/lessons', ensureAuth, ensureTeacher, async (req, res) => {
  try {
    if (!(await ownsClass(req.user.id, req.params.id))) return res.status(404).json({ error: 'Classe introuvable' });
    // avg_knowledge = connaissance moyenne des élèves de la classe sur les mots
    // de la task (mots non travaillés comptés à 0). Sous-requête pour ne pas
    // fausser le COUNT des mots par la jointure sur les élèves.
    const { rows } = await pool.query(
      `SELECT l.id, l.title, l.summary, l.created_at,
              (SELECT COUNT(*) FROM lesson_words lw WHERE lw.lesson_id = l.id)::int AS word_count,
              (SELECT COALESCE(ROUND(AVG(COALESCE(um.score, 0))), 0)
                 FROM lesson_words lw
                 JOIN classroom_students cs ON cs.classroom_id = l.classroom_id AND cs.status = 'active'
                 LEFT JOIN user_mots um ON um.mot_id = lw.mot_id AND um.user_id = cs.student_id
                 WHERE lw.lesson_id = l.id)::int AS avg_knowledge
       FROM lessons l
       WHERE l.classroom_id = $1
       ORDER BY l.created_at DESC`,
      [req.params.id]
    );
    res.json({ lessons: rows });
  } catch (err) {
    console.error('❌ list lessons:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Détail d'une task (avec ses mots)
router.get('/api/teach/lessons/:lessonId', ensureAuth, ensureTeacher, async (req, res) => {
  try {
    const { rows: lrows } = await pool.query(
      `SELECT l.id, l.title, l.summary, l.classroom_id
       FROM lessons l JOIN classrooms c ON c.id = l.classroom_id
       WHERE l.id = $1 AND c.teacher_id = $2`,
      [req.params.lessonId, req.user.id]
    );
    if (!lrows.length) return res.status(404).json({ error: 'Task introuvable' });
    const { rows: words } = await pool.query(
      `SELECT m.id, m.chinese, m.pinyin, m.english
       FROM lesson_words lw JOIN mots m ON m.id = lw.mot_id
       WHERE lw.lesson_id = $1 ORDER BY lw.id ASC`,
      [req.params.lessonId]
    );
    res.json({ lesson: lrows[0], words });
  } catch (err) {
    console.error('❌ lesson detail:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Créer une task : titre + résumé + mots (existants via mot_id, ou nouveaux à créer)
router.post('/api/teach/classes/:id/lessons', ensureAuth, ensureTeacher, async (req, res) => {
  const client = await pool.connect();
  try {
    const classId = req.params.id;
    const title = (req.body.title || '').trim();
    const summary = (req.body.summary || '').trim();
    const words = Array.isArray(req.body.words) ? req.body.words.slice(0, 50) : [];

    if (!title || title.length > 120) return res.status(400).json({ error: 'Titre requis (max 120)' });
    if (summary.length > 2000) return res.status(400).json({ error: 'Résumé trop long (max 2000)' });

    if (!(await ownsClass(req.user.id, classId))) return res.status(404).json({ error: 'Classe introuvable' });

    await client.query('BEGIN');
    const { rows: lrows } = await client.query(
      `INSERT INTO lessons (classroom_id, title, summary) VALUES ($1, $2, $3) RETURNING id`,
      [classId, title, summary]
    );
    const lessonId = lrows[0].id;

    // Résoudre chaque mot en mot_id (find-or-create dans le dico partagé, et
    // mise à jour de la traduction si le prof l'a éditée — sauf mots HSK protégés).
    const motIds = [];
    for (const w of words) {
      const chinese = String(w.chinese || '').trim();
      if (!chinese) continue;
      const pinyin = String(w.pinyin || '').trim().slice(0, 100);
      const english = String(w.english || '').trim().slice(0, 300);

      const existing = await client.query('SELECT id, hsk FROM mots WHERE chinese = $1 LIMIT 1', [chinese]);
      let motId;
      if (existing.rows.length) {
        motId = existing.rows[0].id;
        // Édition autorisée seulement sur les mots non-HSK (modèle Wikipedia)
        if (existing.rows[0].hsk == null && english) {
          await client.query('UPDATE mots SET pinyin = $1, english = $2 WHERE id = $3', [pinyin, english, motId]);
        }
      } else {
        if (!english) continue; // mots.english est NOT NULL
        const ins = await client.query(
          `INSERT INTO mots (chinese, pinyin, english) VALUES ($1, $2, $3) RETURNING id`,
          [chinese.slice(0, 50), pinyin, english]
        );
        motId = ins.rows[0].id;
      }
      motIds.push(motId);
    }

    for (const motId of [...new Set(motIds)]) {
      await client.query(
        `INSERT INTO lesson_words (lesson_id, mot_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [lessonId, motId]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, lesson_id: lessonId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ create lesson:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// Supprimer une task
router.delete('/api/teach/lessons/:lessonId', ensureAuth, ensureTeacher, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM lessons l USING classrooms c
       WHERE l.id = $1 AND l.classroom_id = c.id AND c.teacher_id = $2`,
      [req.params.lessonId, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Task introuvable' });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ delete lesson:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Profil professeur (annuaire mentor) ──────────────────────────────────────
// Allowlist de plateformes de tutorat/réservation pour les liens "trouve-moi".
const MENTOR_LINK_ALLOWLIST = [
  'preply.com', 'italki.com', 'superprof.', 'verbling.com', 'lingoda.com',
  'amazingtalker.com', 'wyzant.com', 'tutoroo.co', 'calendly.com', 'cal.com',
  'linktr.ee', 'youtube.com', 'instagram.com'
];
function isAllowedMentorUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return MENTOR_LINK_ALLOWLIST.some(d =>
      d.endsWith('.') ? host.includes(d) : (host === d || host.endsWith('.' + d))
    );
  } catch { return false; }
}

router.get('/api/teach/profile', ensureAuth, ensureTeacher, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT name, mentor_bio, mentor_links, years_experience, languages_spoken, mentor_listed
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    res.json({ profile: rows[0] || {} });
  } catch (err) {
    console.error('❌ get profile:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/api/teach/profile', ensureAuth, ensureTeacher, async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const bio = (req.body.bio || '').trim();
    const languages = (req.body.languages || '').trim();
    let years = parseInt(req.body.years_experience, 10);
    const listed = req.body.mentor_listed === true;
    let links = Array.isArray(req.body.links) ? req.body.links : [];

    if (!name || name.length > 50) return res.status(400).json({ error: 'Nom requis (max 50)' });
    if (bio.length > 500) return res.status(400).json({ error: 'Intro trop longue (max 500)' });
    if (languages.length > 200) return res.status(400).json({ error: 'Langues : max 200 caractères' });
    if (isNaN(years) || years < 0) years = null; else if (years > 80) years = 80;

    // Nettoyage + validation des liens (allowlist)
    links = links
      .filter(l => l && typeof l.url === 'string')
      .slice(0, 5)
      .map(l => ({ label: String(l.label || '').trim().slice(0, 30), url: l.url.trim() }));
    const bad = links.find(l => !isAllowedMentorUrl(l.url));
    if (bad) {
      return res.status(400).json({
        error: `Lien non autorisé : ${bad.url}. Plateformes acceptées : Preply, iTalki, Superprof, Calendly, etc.`
      });
    }

    await pool.query(
      `UPDATE users SET name = $1, mentor_bio = $2, languages_spoken = $3,
              years_experience = $4, mentor_links = $5::jsonb, mentor_listed = $6
       WHERE id = $7`,
      [name, bio, languages, years, JSON.stringify(links), listed, req.user.id]
    );
    req.user.name = name;
    res.json({ success: true });
  } catch (err) {
    console.error('❌ save profile:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Tasks assignées à l'élève (avec % de connaissance) — pour la page quiz ────
// Ne renvoie que les tasks pas encore maîtrisées (< 100%) : elles restent
// visibles tant que l'élève n'a pas atteint 100%.
router.get('/api/student/tasks', ensureAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.title, c.name AS class_name,
              (SELECT COUNT(*) FROM lesson_words lw WHERE lw.lesson_id = l.id)::int AS word_count,
              (SELECT COALESCE(ROUND(AVG(COALESCE(um.score, 0))), 0)
                 FROM lesson_words lw
                 LEFT JOIN user_mots um ON um.mot_id = lw.mot_id AND um.user_id = $1
                 WHERE lw.lesson_id = l.id)::int AS knowledge
       FROM lessons l
       JOIN classrooms c ON c.id = l.classroom_id
       JOIN classroom_students cs ON cs.classroom_id = c.id AND cs.student_id = $1 AND cs.status = 'active'
       ORDER BY l.created_at DESC`,
      [req.user.id]
    );
    const tasks = rows.filter(t => t.word_count > 0 && t.knowledge < 100);
    res.json({ tasks });
  } catch (err) {
    console.error('❌ student tasks:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Vérifie qu'une task appartient à une classe où l'élève est actif
async function studentCanAccessLesson(studentId, lessonId) {
  const { rows } = await pool.query(
    `SELECT l.id, l.classroom_id
     FROM lessons l
     JOIN classroom_students cs ON cs.classroom_id = l.classroom_id
     WHERE l.id = $1 AND cs.student_id = $2 AND cs.status = 'active'`,
    [lessonId, studentId]
  );
  return rows[0] || null;
}

// Liste des cours (tasks) de l'élève — pour la section "My courses"
router.get('/api/student/courses', ensureAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.title, c.name AS class_name, l.created_at,
              (SELECT COUNT(*) FROM lesson_words lw WHERE lw.lesson_id = l.id)::int AS word_count
       FROM lessons l
       JOIN classrooms c ON c.id = l.classroom_id
       JOIN classroom_students cs ON cs.classroom_id = c.id AND cs.student_id = $1 AND cs.status = 'active'
       ORDER BY l.created_at DESC`,
      [req.user.id]
    );
    res.json({ courses: rows });
  } catch (err) {
    console.error('❌ student courses:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Détail d'un cours (titre, notes, mots) — vue élève
router.get('/api/student/lessons/:lessonId', ensureAuth, async (req, res) => {
  try {
    const lesson = await studentCanAccessLesson(req.user.id, req.params.lessonId);
    if (!lesson) return res.status(404).json({ error: 'Cours introuvable' });
    const { rows: lrows } = await pool.query(
      `SELECT l.id, l.title, l.summary, l.created_at, c.name AS class_name
       FROM lessons l JOIN classrooms c ON c.id = l.classroom_id WHERE l.id = $1`,
      [lesson.id]
    );
    const { rows: words } = await pool.query(
      `SELECT m.id, m.chinese, m.pinyin, m.english
       FROM lesson_words lw JOIN mots m ON m.id = lw.mot_id
       WHERE lw.lesson_id = $1 ORDER BY lw.id ASC`,
      [lesson.id]
    );
    res.json({ lesson: lrows[0], words });
  } catch (err) {
    console.error('❌ student lesson:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Lancer le quiz d'une task : ajoute les mots de la task à la collection de
// l'élève (score 0 s'ils manquent) puis renvoie les IDs pour le quiz.
router.post('/api/student/tasks/:lessonId/start', ensureAuth, async (req, res) => {
  try {
    const lesson = await studentCanAccessLesson(req.user.id, req.params.lessonId);
    if (!lesson) return res.status(404).json({ error: 'Task introuvable' });

    const { rows: wordRows } = await pool.query(
      'SELECT mot_id FROM lesson_words WHERE lesson_id = $1', [lesson.id]
    );
    const ids = wordRows.map(r => r.mot_id);
    if (!ids.length) return res.status(400).json({ error: 'Task sans mots' });

    // Ajoute à la collection de l'élève les mots pas encore présents
    await pool.query(
      `INSERT INTO user_mots (user_id, mot_id)
       SELECT $1, m FROM unnest($2::int[]) AS m
       WHERE NOT EXISTS (SELECT 1 FROM user_mots WHERE user_id = $1 AND mot_id = m)`,
      [req.user.id, ids]
    );

    res.json({ success: true, ids, type: 'pinyin' });
  } catch (err) {
    console.error('❌ start task quiz:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Enregistrer le résultat d'un quiz de task (alimente le compteur côté prof)
router.post('/api/student/tasks/:lessonId/result', ensureAuth, async (req, res) => {
  try {
    const lesson = await studentCanAccessLesson(req.user.id, req.params.lessonId);
    if (!lesson) return res.status(404).json({ error: 'Task introuvable' });
    const score = parseInt(req.body.score, 10);
    const total = parseInt(req.body.total, 10);
    await pool.query(
      `INSERT INTO lesson_quiz_results (lesson_id, student_id, score, total) VALUES ($1, $2, $3, $4)`,
      [lesson.id, req.user.id, Number.isInteger(score) ? score : null, Number.isInteger(total) ? total : null]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('❌ task result:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Annuaire des professeurs (côté élève) — profs opt-in uniquement ──────────
router.get('/api/mentors', ensureAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.languages_spoken, u.years_experience, u.mentor_bio, u.mentor_links,
              (SELECT COUNT(DISTINCT cs.student_id)
                 FROM classrooms c JOIN classroom_students cs ON cs.classroom_id = c.id
                 WHERE c.teacher_id = u.id AND cs.status = 'active')::int AS student_count,
              (SELECT COUNT(l.id)
                 FROM lessons l JOIN classrooms c ON c.id = l.classroom_id
                 WHERE c.teacher_id = u.id)::int AS task_count
       FROM users u
       WHERE u.role = 'teacher' AND u.mentor_listed = TRUE
       ORDER BY student_count DESC, u.name ASC`
    );
    // On ne renvoie que le PREMIER lien de contact
    const mentors = rows.map(m => {
      const links = Array.isArray(m.mentor_links) ? m.mentor_links : [];
      return {
        id: m.id, name: m.name, languages_spoken: m.languages_spoken,
        years_experience: m.years_experience, mentor_bio: m.mentor_bio,
        student_count: m.student_count, task_count: m.task_count,
        link: links[0] || null
      };
    });
    res.json({ mentors });
  } catch (err) {
    console.error('❌ mentors:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/mentors', ensureAuth, (req, res) => {
  res.render('mentors', {
    user: req.user, balance: res.locals.balance || 0, isPremium: res.locals.isPremium || false,
    currentPage: 'mentors'
  });
});

// Page de cours (vue élève)
router.get('/course/:lessonId', ensureAuth, (req, res) => {
  res.render('student-course', {
    user: req.user, balance: res.locals.balance || 0, isPremium: res.locals.isPremium || false,
    currentPage: 'mentors', lessonId: req.params.lessonId
  });
});

// ── Tous les élèves du prof (toutes classes confondues), stats agrégées ───────
router.get('/api/teach/students', ensureAuth, ensureTeacher, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name,
              COUNT(DISTINCT um.mot_id) AS word_count,
              COALESCE(ROUND(AVG(um.score)), 0) AS avg_score,
              COUNT(DISTINCT cs.classroom_id) AS class_count
       FROM classroom_students cs
       JOIN classrooms c ON c.id = cs.classroom_id AND c.teacher_id = $1
       JOIN users u ON u.id = cs.student_id
       LEFT JOIN user_mots um ON um.user_id = u.id
       WHERE cs.status = 'active'
       GROUP BY u.id, u.name
       ORDER BY word_count DESC, u.name ASC`,
      [req.user.id]
    );
    res.json({ students: rows });
  } catch (err) {
    console.error('❌ list students:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Pages profil & élèves ────────────────────────────────────────────────────
router.get('/teach/profile', ensureAuth, ensureTeacher, (req, res) => {
  res.render('teach-profile', {
    user: req.user, balance: res.locals.balance || 0, isPremium: res.locals.isPremium || false
  });
});
router.get('/teach/students', ensureAuth, ensureTeacher, (req, res) => {
  res.render('teach-students', {
    user: req.user, balance: res.locals.balance || 0, isPremium: res.locals.isPremium || false
  });
});

// ── Page : détail d'une classe (élèves + stats) ──────────────────────────────
router.get('/teach/class/:id', ensureAuth, ensureTeacher, (req, res) => {
  res.render('teach-class', {
    user: req.user,
    balance: res.locals.balance || 0,
    isPremium: res.locals.isPremium || false,
    classId: req.params.id,
    quizDirection: req.user.quiz_direction || 'en→zh'
  });
});

router.get('/teach/task/:lessonId', ensureAuth, ensureTeacher, (req, res) => {
  res.render('teach-task', {
    user: req.user,
    balance: res.locals.balance || 0,
    isPremium: res.locals.isPremium || false,
    lessonId: req.params.lessonId,
    quizDirection: req.user.quiz_direction || 'en→zh'
  });
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
