// ════════════════════════════════════════════════════════════════════════════
//  PLATEFORME PROFESSEUR + LEÇONS / CRÉNEAUX (JWT)
//  Extrait de routes/mobile.js. Monté via registerLessonRoutes(router, deps).
//  deps = { requireToken, notify, getUserLangs, syncConceptSiblings } (helpers
//  partagés restés dans mobile.js). pool + math fuseaux importés directement.
// ════════════════════════════════════════════════════════════════════════════
const crypto = require('crypto');
const { pool } = require('../../config/database');
const { SLOT_MIN, BOOKING_HORIZON_DAYS, validTz, pad2, wallToUtc, utcToWall, deriveTeacherSlots } = require('../../lib/teacher-schedule');
const { teacherTz, slotOpenForTeacher, studentLinkedToTeacher } = require('../../lib/teacher-slots');

module.exports = function registerLessonRoutes(router, deps) {
  const { requireToken, notify, getUserLangs, syncConceptSiblings } = deps;

const TEACH_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CNY', 'JPY', 'CAD', 'AUD', 'SGD', 'HKD'];
const MENTOR_LINK_ALLOWLIST = [
  'preply.com', 'italki.com', 'superprof.', 'verbling.com', 'lingoda.com',
  'amazingtalker.com', 'wyzant.com', 'tutoroo.co', 'calendly.com', 'cal.com',
  'linktr.ee', 'youtube.com', 'instagram.com',
];
function isAllowedMentorUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return MENTOR_LINK_ALLOWLIST.some((d) =>
      d.endsWith('.') ? host.includes(d) : (host === d || host.endsWith('.' + d)));
  } catch { return false; }
}

// Hôtes vidéo acceptés pour la « présentation » (embeddables en iframe).
const VIDEO_HOST_ALLOWLIST = ['youtube.com', 'youtu.be', 'bilibili.com', 'b23.tv', 'vimeo.com'];
function isAllowedVideoUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return VIDEO_HOST_ALLOWLIST.some((d) => host === d || host.endsWith('.' + d));
  } catch { return false; }
}

// Middleware : exige que l'utilisateur du token soit professeur.
async function requireTeacher(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT role, quiz_direction FROM users WHERE id = $1', [req.tokenUser.id]);
    if (!rows.length || rows[0].role !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
    req.teacher = { id: req.tokenUser.id, quiz_direction: rows[0].quiz_direction || 'en→zh' };
    next();
  } catch (e) {
    console.error('requireTeacher error:', e);
    res.status(500).json({ error: 'Server error' });
  }
}

async function teacherOwnsClass(teacherId, classId) {
  const { rows } = await pool.query('SELECT 1 FROM classrooms WHERE id = $1 AND teacher_id = $2', [classId, teacherId]);
  return rows.length > 0;
}
async function genClassCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 8; attempt++) {
    const bytes = crypto.randomBytes(6);
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[bytes[i] % chars.length];
    const { rows } = await pool.query('SELECT 1 FROM classrooms WHERE join_code = $1', [code]);
    if (!rows.length) return code;
  }
  throw new Error('code generation failed');
}

// ── Stats globales du prof ───────────────────────────────────────────────────
router.get('/api/m/teacher/overview', requireToken, requireTeacher, async (req, res) => {
  try {
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
      [req.teacher.id]
    );
    res.json(rows[0]);
  } catch (e) { console.error('m/teacher overview:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── Classes du prof ──────────────────────────────────────────────────────────
router.get('/api/m/teacher/classes', requireToken, requireTeacher, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.type, c.join_code, c.archived, c.created_at,
              COUNT(DISTINCT cs.student_id) FILTER (WHERE cs.status = 'active')::int AS student_count,
              COUNT(DISTINCT l.id)::int AS lesson_count
       FROM classrooms c
       LEFT JOIN classroom_students cs ON cs.classroom_id = c.id
       LEFT JOIN lessons l ON l.classroom_id = c.id
       WHERE c.teacher_id = $1
       GROUP BY c.id
       ORDER BY c.archived ASC, c.created_at DESC`,
      [req.teacher.id]
    );
    res.json({ classrooms: rows });
  } catch (e) { console.error('m/teacher classes:', e); res.status(500).json({ error: 'Server error' }); }
});

router.post('/api/m/teacher/classes', requireToken, requireTeacher, async (req, res) => {
  try {
    const name = (req.body?.name || '').trim();
    const type = req.body?.type === 'private' ? 'private' : 'group';
    if (!name || name.length > 80) return res.status(400).json({ error: 'Class name required (max 80 characters)' });
    const join_code = await genClassCode();
    const { rows } = await pool.query(
      `INSERT INTO classrooms (teacher_id, name, type, join_code)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, type, join_code, archived, created_at`,
      [req.teacher.id, name, type, join_code]
    );
    res.json({ success: true, classroom: rows[0] });
  } catch (e) { console.error('m/teacher create class:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── Détail d'une classe : élèves ─────────────────────────────────────────────
router.get('/api/m/teacher/classes/:id', requireToken, requireTeacher, async (req, res) => {
  try {
    const { rows: classRows } = await pool.query(
      `SELECT id, name, type, join_code, archived, created_at
       FROM classrooms WHERE id = $1 AND teacher_id = $2`,
      [req.params.id, req.teacher.id]
    );
    if (!classRows.length) return res.status(404).json({ error: 'Class not found' });
    const { rows: students } = await pool.query(
      `SELECT u.id, u.name, cs.joined_at,
              COUNT(um.mot_id)::int AS word_count,
              COALESCE(ROUND(AVG(um.score)), 0)::int AS avg_score
       FROM classroom_students cs
       JOIN users u ON u.id = cs.student_id
       LEFT JOIN user_mots um ON um.user_id = u.id
       WHERE cs.classroom_id = $1 AND cs.status = 'active'
       GROUP BY u.id, u.name, cs.joined_at
       ORDER BY u.name ASC`,
      [req.params.id]
    );
    res.json({ classroom: classRows[0], students });
  } catch (e) { console.error('m/teacher class detail:', e); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/api/m/teacher/classes/:id', requireToken, requireTeacher, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM classrooms WHERE id = $1 AND teacher_id = $2', [req.params.id, req.teacher.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Class not found' });
    res.json({ success: true });
  } catch (e) { console.error('m/teacher delete class:', e); res.status(500).json({ error: 'Server error' }); }
});

router.post('/api/m/teacher/classes/:id/students/:studentId/revoke', requireToken, requireTeacher, async (req, res) => {
  try {
    if (!(await teacherOwnsClass(req.teacher.id, req.params.id))) return res.status(404).json({ error: 'Class not found' });
    await pool.query(
      `UPDATE classroom_students SET status = 'removed' WHERE classroom_id = $1 AND student_id = $2`,
      [req.params.id, req.params.studentId]
    );
    res.json({ success: true });
  } catch (e) { console.error('m/teacher revoke:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── Tasks d'une classe ───────────────────────────────────────────────────────
router.get('/api/m/teacher/classes/:id/lessons', requireToken, requireTeacher, async (req, res) => {
  try {
    if (!(await teacherOwnsClass(req.teacher.id, req.params.id))) return res.status(404).json({ error: 'Class not found' });
    const { rows } = await pool.query(
      `SELECT l.id, l.title, l.summary, l.created_at,
              (SELECT COUNT(*) FROM lesson_words lw WHERE lw.lesson_id = l.id)::int AS word_count,
              (SELECT COALESCE(ROUND(AVG(COALESCE(um.score, 0))), 0)
                 FROM lesson_words lw
                 JOIN classroom_students cs ON cs.classroom_id = l.classroom_id AND cs.status = 'active'
                 LEFT JOIN user_mots um ON um.mot_id = lw.mot_id AND um.user_id = cs.student_id
                 WHERE lw.lesson_id = l.id)::int AS avg_knowledge
       FROM lessons l WHERE l.classroom_id = $1 ORDER BY l.created_at DESC`,
      [req.params.id]
    );
    res.json({ lessons: rows });
  } catch (e) { console.error('m/teacher lessons:', e); res.status(500).json({ error: 'Server error' }); }
});

router.post('/api/m/teacher/classes/:id/lessons', requireToken, requireTeacher, async (req, res) => {
  const client = await pool.connect();
  try {
    const classId = req.params.id;
    const title = (req.body?.title || '').trim();
    const summary = (req.body?.summary || '').trim();
    const words = Array.isArray(req.body?.words) ? req.body.words.slice(0, 50) : [];
    if (!title || title.length > 120) return res.status(400).json({ error: 'Title required (max 120)' });
    if (summary.length > 2000) return res.status(400).json({ error: 'Summary too long (max 2000)' });
    if (!(await teacherOwnsClass(req.teacher.id, classId))) return res.status(404).json({ error: 'Class not found' });

    await client.query('BEGIN');
    const { rows: lrows } = await client.query(
      `INSERT INTO lessons (classroom_id, title, summary) VALUES ($1, $2, $3) RETURNING id`,
      [classId, title, summary]
    );
    const lessonId = lrows[0].id;
    const langs = await getUserLangs(req.tokenUser.id);
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
        if (existing.rows[0].hsk == null && english) {
          await client.query('UPDATE mots SET pinyin = $1 WHERE id = $2', [pinyin, motId]);
          await syncConceptSiblings(client, motId, english, langs.native, { replace: true, userId: req.tokenUser.id });
        }
      } else {
        if (!english) continue;
        const ins = await client.query(
          `INSERT INTO mots (chinese, pinyin, lang) VALUES ($1, $2, $3) RETURNING id`,
          [chinese.slice(0, 50), pinyin, langs.learning]
        );
        motId = ins.rows[0].id;
        await syncConceptSiblings(client, motId, english, langs.native, { userId: req.tokenUser.id });
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
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/teacher create lesson:', e);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

// ── POST /api/m/teacher/send-task : page « fin de cours » ─────────────────────
// Envoie une task à un élève à la fin d'un cours. Le prof choisit une classe
// existante OU en crée une nouvelle ; l'élève y est inscrit automatiquement puis
// notifié. Garde-fou : l'élève doit déjà être lié au prof (un créneau réservé,
// quel que soit son statut, OU une adhésion active à l'une de ses classes) —
// sinon un prof pourrait pousser une task à n'importe quel utilisateur.
router.post('/api/m/teacher/send-task', requireToken, requireTeacher, async (req, res) => {
  const client = await pool.connect();
  try {
    const studentId = parseInt(req.body?.student_id, 10);
    const title = (req.body?.title || '').trim();
    const summary = (req.body?.summary || '').trim();
    const words = Array.isArray(req.body?.words) ? req.body.words.slice(0, 50) : [];
    let classId = req.body?.class_id ? parseInt(req.body.class_id, 10) : null;
    const newClassName = (req.body?.class_name || '').trim();

    if (!studentId) return res.status(400).json({ error: 'Student required' });
    if (studentId === req.teacher.id) return res.status(400).json({ error: 'Invalid student' });
    if (!title || title.length > 120) return res.status(400).json({ error: 'Title required (max 120)' });
    if (summary.length > 2000) return res.status(400).json({ error: 'Summary too long (max 2000)' });
    if (!classId && !newClassName) return res.status(400).json({ error: 'Pick or create a class' });
    if (newClassName.length > 80) return res.status(400).json({ error: 'Class name too long (max 80)' });

    // Lien prof↔élève (anti-abus).
    const link = await pool.query(
      `SELECT 1 FROM teacher_slots WHERE teacher_id = $1 AND student_id = $2
       UNION
       SELECT 1 FROM classroom_students cs JOIN classrooms c ON c.id = cs.classroom_id
         WHERE c.teacher_id = $1 AND cs.student_id = $2 AND cs.status = 'active'
       LIMIT 1`,
      [req.teacher.id, studentId]);
    if (!link.rows.length) return res.status(403).json({ error: 'Not your student' });

    await client.query('BEGIN');

    // Résolution de la classe : existante (possédée) ou nouvelle.
    let classroom;
    if (classId) {
      const own = await client.query('SELECT id, name FROM classrooms WHERE id = $1 AND teacher_id = $2', [classId, req.teacher.id]);
      if (!own.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Class not found' }); }
      classroom = own.rows[0];
    } else {
      const code = await genClassCode();
      const ins = await client.query(
        `INSERT INTO classrooms (teacher_id, name, type, join_code) VALUES ($1, $2, 'group', $3) RETURNING id, name`,
        [req.teacher.id, newClassName, code]);
      classroom = ins.rows[0];
      classId = classroom.id;
    }

    // Inscription auto de l'élève (réactive une adhésion quittée).
    await client.query(
      `INSERT INTO classroom_students (classroom_id, student_id) VALUES ($1, $2)
       ON CONFLICT (classroom_id, student_id) DO UPDATE SET status = 'active'`,
      [classId, studentId]);

    // Task + mots (même logique que POST /classes/:id/lessons).
    const { rows: lrows } = await client.query(
      `INSERT INTO lessons (classroom_id, title, summary) VALUES ($1, $2, $3) RETURNING id`,
      [classId, title, summary]);
    const lessonId = lrows[0].id;
    const langs = await getUserLangs(req.tokenUser.id);
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
        if (existing.rows[0].hsk == null && english) {
          await client.query('UPDATE mots SET pinyin = $1 WHERE id = $2', [pinyin, motId]);
          await syncConceptSiblings(client, motId, english, langs.native, { replace: true, userId: req.tokenUser.id });
        }
      } else {
        if (!english) continue;
        const insM = await client.query(
          `INSERT INTO mots (chinese, pinyin, lang) VALUES ($1, $2, $3) RETURNING id`,
          [chinese.slice(0, 50), pinyin, langs.learning]);
        motId = insM.rows[0].id;
        await syncConceptSiblings(client, motId, english, langs.native, { userId: req.tokenUser.id });
      }
      motIds.push(motId);
    }
    const uniqueMots = [...new Set(motIds)];
    for (const motId of uniqueMots) {
      await client.query(`INSERT INTO lesson_words (lesson_id, mot_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [lessonId, motId]);
    }

    await client.query('COMMIT');

    const teacherName = (await pool.query('SELECT name FROM users WHERE id = $1', [req.teacher.id])).rows[0]?.name || 'Your teacher';
    const wc = uniqueMots.length;
    notify(studentId, 'new_task', `${teacherName} sent you homework 📘`,
      wc ? `${title} · ${wc} word${wc > 1 ? 's' : ''}` : title, { lessonId, classId });

    res.json({ success: true, lesson_id: lessonId, classroom });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/teacher send-task:', e);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

// ── GET /api/m/teacher/students/:studentId/class-context : contexte « fin de cours » ─
// Pour la page fin de cours : les classes (non archivées) du prof où l'élève est
// déjà actif (→ on y range la task directement), + toutes ses classes (→ pour le
// toggle « add to an existing class » quand l'élève n'en a aucune).
router.get('/api/m/teacher/students/:studentId/class-context', requireToken, requireTeacher, async (req, res) => {
  try {
    const studentId = parseInt(req.params.studentId, 10);
    if (!studentId) return res.status(400).json({ error: 'Invalid student' });
    const [all, mine] = await Promise.all([
      pool.query(
        `SELECT c.id, c.name,
                COUNT(DISTINCT cs.student_id) FILTER (WHERE cs.status = 'active')::int AS student_count,
                COUNT(DISTINCT l.id)::int AS lesson_count
         FROM classrooms c
         LEFT JOIN classroom_students cs ON cs.classroom_id = c.id
         LEFT JOIN lessons l ON l.classroom_id = c.id
         WHERE c.teacher_id = $1 AND c.archived = FALSE
         GROUP BY c.id ORDER BY c.created_at DESC`,
        [req.teacher.id]),
      pool.query(
        `SELECT c.id, c.name
         FROM classrooms c JOIN classroom_students cs ON cs.classroom_id = c.id
         WHERE c.teacher_id = $1 AND c.archived = FALSE AND cs.student_id = $2 AND cs.status = 'active'
         ORDER BY c.created_at DESC`,
        [req.teacher.id, studentId]),
    ]);
    res.json({ classes: all.rows, student_classes: mine.rows });
  } catch (e) { console.error('m/teacher class-context:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── Progression d'une task ───────────────────────────────────────────────────
router.get('/api/m/teacher/lessons/:lessonId/progress', requireToken, requireTeacher, async (req, res) => {
  try {
    const { rows: lrows } = await pool.query(
      `SELECT l.id, l.title, l.summary, l.classroom_id, l.created_at
       FROM lessons l JOIN classrooms c ON c.id = l.classroom_id
       WHERE l.id = $1 AND c.teacher_id = $2`,
      [req.params.lessonId, req.teacher.id]
    );
    if (!lrows.length) return res.status(404).json({ error: 'Task not found' });
    const lesson = lrows[0];
    const nat = (await getUserLangs(req.tokenUser.id)).native;
    const { rows: words } = await pool.query(
      `SELECT m.id, m.chinese, m.pinyin, mot_tr(m.id, $2) AS english
       FROM lesson_words lw JOIN mots m ON m.id = lw.mot_id
       WHERE lw.lesson_id = $1 ORDER BY lw.id ASC`, [lesson.id, nat]);
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
  } catch (e) { console.error('m/teacher progress:', e); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/api/m/teacher/lessons/:lessonId', requireToken, requireTeacher, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM lessons l USING classrooms c
       WHERE l.id = $1 AND l.classroom_id = c.id AND c.teacher_id = $2`,
      [req.params.lessonId, req.teacher.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true });
  } catch (e) { console.error('m/teacher delete lesson:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── Résolution des mots (find dans le dico partagé, direction-aware) ──────────
router.post('/api/m/teacher/mots/lookup', requireToken, requireTeacher, async (req, res) => {
  try {
    const words = Array.isArray(req.body?.words) ? req.body.words : [];
    const cleaned = [...new Set(words.map((w) => String(w || '').trim()).filter(Boolean))].slice(0, 50);
    if (!cleaned.length) return res.json({ results: [] });
    const isZhEn = req.teacher.quiz_direction === 'zh→en';
    const nat = (await getUserLangs(req.tokenUser.id)).native;
    const byKey = {};
    if (isZhEn) {
      // Le prof colle des termes anglais → on retrouve le mot zh via son lexème
      // frère 'en' partageant le concept (drop-safe, plus de colonne english).
      const { rows } = await pool.query(
        `SELECT z.id, z.chinese, z.pinyin, mot_tr(z.id, 'en') AS english, lower(e.chinese) AS matchkey
         FROM mots z
         JOIN lexeme_senses zs ON zs.mot_id = z.id
         JOIN lexeme_senses es ON es.meaning_id = zs.meaning_id
         JOIN mots e ON e.id = es.mot_id AND e.lang = 'en'
         WHERE z.lang = 'zh' AND lower(e.chinese) = ANY($1::text[])`,
        [cleaned.map((w) => w.toLowerCase())]
      );
      rows.forEach((r) => { byKey[r.matchkey] = r; });
      return res.json({ results: cleaned.map((w) => ({ input: w, mot: byKey[w.toLowerCase()] || null })) });
    }
    const { rows } = await pool.query(
      `SELECT id, chinese, pinyin, mot_tr(id, $2) AS english FROM mots WHERE chinese = ANY($1::text[])`, [cleaned, nat]
    );
    rows.forEach((r) => { byKey[r.chinese] = r; });
    // Mot introuvable dans le dico → on génère le pinyin (pinyin-pro), comme le web.
    let toPinyin = null;
    try { toPinyin = require('pinyin-pro').pinyin; } catch { /* lib absente → pinyin vide */ }
    const genPinyin = (cn) => {
      if (!toPinyin) return '';
      try { return toPinyin(cn, { toneType: 'symbol' }) || ''; } catch { return ''; }
    };
    res.json({
      results: cleaned.map((w) => ({
        input: w,
        mot: byKey[w] || null,
        pinyin: byKey[w] ? undefined : genPinyin(w),
      })),
    });
  } catch (e) { console.error('m/teacher lookup:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── Tous les élèves du prof ──────────────────────────────────────────────────
router.get('/api/m/teacher/students', requireToken, requireTeacher, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name,
              COUNT(DISTINCT um.mot_id)::int AS word_count,
              COALESCE(ROUND(AVG(um.score)), 0)::int AS avg_score,
              COUNT(DISTINCT cs.classroom_id)::int AS class_count
       FROM classroom_students cs
       JOIN classrooms c ON c.id = cs.classroom_id AND c.teacher_id = $1
       JOIN users u ON u.id = cs.student_id
       LEFT JOIN user_mots um ON um.user_id = u.id
       WHERE cs.status = 'active'
       GROUP BY u.id, u.name
       ORDER BY word_count DESC, u.name ASC`,
      [req.teacher.id]
    );
    res.json({ students: rows });
  } catch (e) { console.error('m/teacher students:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── Profil mentor ────────────────────────────────────────────────────────────
router.get('/api/m/teacher/profile', requireToken, requireTeacher, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT name, mentor_bio, mentor_links, years_experience, languages_spoken,
              teaching_languages, session_price, session_currency, mentor_listed, presentation_video
       FROM users WHERE id = $1`, [req.teacher.id]
    );
    res.json({ profile: rows[0] || {} });
  } catch (e) { console.error('m/teacher get profile:', e); res.status(500).json({ error: 'Server error' }); }
});

router.post('/api/m/teacher/profile', requireToken, requireTeacher, async (req, res) => {
  try {
    const name = (req.body?.name || '').trim();
    const bio = (req.body?.bio || '').trim();
    const languages = (req.body?.languages || '').trim();
    let years = parseInt(req.body?.years_experience, 10);
    const listed = req.body?.mentor_listed === true;
    let links = Array.isArray(req.body?.links) ? req.body.links : [];

    const teachingArr = Array.isArray(req.body?.teaching_languages)
      ? req.body.teaching_languages
      : String(req.body?.teaching_languages || '').split(',');
    const teaching = teachingArr.map((s) => String(s).trim()).filter(Boolean).slice(0, 12).join(', ').slice(0, 200);

    let price = null;
    const rawPrice = req.body?.session_price;
    if (rawPrice !== '' && rawPrice != null) {
      const p = parseFloat(rawPrice);
      if (!isNaN(p) && p >= 0) price = Math.min(Math.round(p * 100) / 100, 100000);
    }
    const currency = TEACH_CURRENCIES.includes(req.body?.session_currency) ? req.body.session_currency : 'EUR';

    if (!name || name.length > 50) return res.status(400).json({ error: 'Name required (max 50)' });
    if (bio.length > 500) return res.status(400).json({ error: 'Intro too long (max 500)' });
    if (languages.length > 200) return res.status(400).json({ error: 'Languages: max 200 characters' });
    if (isNaN(years) || years < 0) years = null; else if (years > 80) years = 80;

    links = links
      .filter((l) => l && typeof l.url === 'string')
      .slice(0, 5)
      .map((l) => ({ label: String(l.label || '').trim().slice(0, 30), url: l.url.trim() }));
    const bad = links.find((l) => !isAllowedMentorUrl(l.url));
    if (bad) return res.status(400).json({ error: `Link not allowed: ${bad.url}. Accepted: Preply, iTalki, Superprof, Calendly, etc.` });

    // Vidéo de présentation (optionnelle) : hôtes vidéo connus uniquement.
    let video = (req.body?.presentation_video || '').toString().trim().slice(0, 300) || null;
    if (video && !isAllowedVideoUrl(video)) {
      return res.status(400).json({ error: 'Video link not allowed. Accepted: YouTube, Bilibili, Vimeo (https).' });
    }

    await pool.query(
      `UPDATE users SET name = $1, mentor_bio = $2, languages_spoken = $3,
              years_experience = $4, mentor_links = $5::jsonb, mentor_listed = $6,
              teaching_languages = $7, session_price = $8, session_currency = $9, presentation_video = $11
       WHERE id = $10`,
      [name, bio, languages, years, JSON.stringify(links), listed, teaching, price, currency, req.teacher.id, video]
    );
    res.json({ success: true });
  } catch (e) { console.error('m/teacher save profile:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── GET /api/m/teacher/stats : stats affichées sur la page Profil ─────────────
// Nb d'élèves (actifs, distincts), cours DONNÉS (sessions réservées passées), note
// moyenne (teacher_ratings) + nombre de notes.
router.get('/api/m/teacher/stats', requireToken, requireTeacher, async (req, res) => {
  try {
    const tid = req.teacher.id;
    const [students, given, rating] = await Promise.all([
      pool.query(
        `SELECT COUNT(DISTINCT cs.student_id)::int AS n
         FROM classroom_students cs JOIN classrooms c ON c.id = cs.classroom_id
         WHERE c.teacher_id = $1 AND cs.status = 'active'`, [tid]),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM teacher_slots
         WHERE teacher_id = $1 AND status = 'booked' AND ends_at < NOW()`, [tid]),
      pool.query(
        `SELECT ROUND(AVG(rating)::numeric, 1) AS avg, COUNT(*)::int AS n
         FROM teacher_ratings WHERE teacher_id = $1`, [tid]),
    ]);
    res.json({
      students: students.rows[0].n,
      courses_given: given.rows[0].n,
      rating: rating.rows[0].avg != null ? Number(rating.rows[0].avg) : null,
      rating_count: rating.rows[0].n,
    });
  } catch (e) { console.error('m/teacher stats:', e); res.status(500).json({ error: 'Server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// AGENDA PROF — modèle « SEMAINE TYPE » :
//  • teacher_availability = modèle hebdo récurrent (weekday 0=lun…6=dim, hour 0..23,
//    créneaux d'1h). C'est ce que le prof édite dans sa popup « disponibilités ».
//  • teacher_slots = COURS RÉSERVÉS uniquement (une ligne = un cours pris par un élève).
//  • Les créneaux réservables de l'élève se DÉRIVENT du modèle (horizon glissant),
//    moins les cours déjà réservés. Le calendrier du prof affiche les cours À VENIR.
// ═══════════════════════════════════════════════════════════════════════════



// ── GET /api/m/teacher/availability : semaine type + dispos ponctuelles futures ─
router.get('/api/m/teacher/availability', requireToken, requireTeacher, async (req, res) => {
  try {
    const [weekly, dates] = await Promise.all([
      pool.query(`SELECT weekday, hour FROM teacher_availability WHERE teacher_id = $1 ORDER BY weekday, hour`, [req.teacher.id]),
      pool.query(`SELECT to_char(day,'YYYY-MM-DD') AS day, hour FROM teacher_date_slots WHERE teacher_id = $1 AND day >= CURRENT_DATE ORDER BY day, hour`, [req.teacher.id]),
    ]);
    res.json({ blocks: weekly.rows, dates: dates.rows });
  } catch (e) { console.error('m/teacher availability get:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── GET /api/m/teacher/date-slots?date= : dispos d'une date + heures récurrentes ─
router.get('/api/m/teacher/date-slots', requireToken, requireTeacher, async (req, res) => {
  try {
    const day = String(req.query.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: 'Invalid date' });
    const weekday = ((new Date(day + 'T00:00:00').getDay()) + 6) % 7;
    const [ds, rec] = await Promise.all([
      pool.query(`SELECT hour FROM teacher_date_slots WHERE teacher_id = $1 AND day = $2 ORDER BY hour`, [req.teacher.id, day]),
      pool.query(`SELECT hour FROM teacher_availability WHERE teacher_id = $1 AND weekday = $2 ORDER BY hour`, [req.teacher.id, weekday]),
    ]);
    // Heures EFFECTIVES : override ponctuel s'il existe, sinon la semaine type.
    const overridden = ds.rows.length > 0;
    res.json({
      date: day, overridden,
      hours: overridden ? ds.rows.map((r) => r.hour) : rec.rows.map((r) => r.hour),
      recurring: rec.rows.map((r) => r.hour),
    });
  } catch (e) { console.error('m/teacher date-slots get:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── PUT /api/m/teacher/date-slots : remplace les dispos ponctuelles d'une date ─
router.put('/api/m/teacher/date-slots', requireToken, requireTeacher, async (req, res) => {
  const client = await pool.connect();
  try {
    const day = String(req.body?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: 'Invalid date' });
    const raw = Array.isArray(req.body?.hours) ? req.body.hours : [];
    const hours = [...new Set(raw.map((h) => parseInt(h, 10)).filter((h) => h >= 0 && h <= 23))].slice(0, 24);
    await client.query('BEGIN');
    await client.query('DELETE FROM teacher_date_slots WHERE teacher_id = $1 AND day = $2', [req.teacher.id, day]);
    for (const h of hours) {
      await client.query('INSERT INTO teacher_date_slots (teacher_id, day, hour) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [req.teacher.id, day, h]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, date: day, hours });
  } catch (e) { await client.query('ROLLBACK'); console.error('m/teacher date-slots put:', e); res.status(500).json({ error: 'Server error' }); }
  finally { client.release(); }
});

// ── PUT /api/m/teacher/availability : remplace toute la semaine type ──────────
router.put('/api/m/teacher/availability', requireToken, requireTeacher, async (req, res) => {
  const client = await pool.connect();
  try {
    const raw = Array.isArray(req.body?.blocks) ? req.body.blocks : [];
    // Normalise + valide (weekday 0..6, hour 0..23), dédup, cap.
    const seen = new Set();
    const blocks = [];
    for (const b of raw) {
      const w = parseInt(b?.weekday, 10), h = parseInt(b?.hour, 10);
      if (!(w >= 0 && w <= 6 && h >= 0 && h <= 23)) continue;
      const k = `${w}:${h}`;
      if (seen.has(k)) continue;
      seen.add(k); blocks.push({ weekday: w, hour: h });
      if (blocks.length > 7 * 24) break;
    }
    // Fuseau du prof (envoyé par le client) → les heures de dispo sont LOCALES à ce
    // fuseau. On le mémorise pour convertir correctement en UTC à la dérivation.
    const tz = validTz(req.body?.timezone);
    await client.query('BEGIN');
    if (tz) await client.query('UPDATE users SET timezone = $1 WHERE id = $2', [tz, req.teacher.id]);
    await client.query('DELETE FROM teacher_availability WHERE teacher_id = $1', [req.teacher.id]);
    for (const b of blocks) {
      await client.query(
        'INSERT INTO teacher_availability (teacher_id, weekday, hour) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [req.teacher.id, b.weekday, b.hour]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, blocks });
  } catch (e) { await client.query('ROLLBACK'); console.error('m/teacher availability put:', e); res.status(500).json({ error: 'Server error' }); }
  finally { client.release(); }
});

// ── GET /api/m/teacher/lessons : cours À VENIR réservés par mes élèves ────────
router.get('/api/m/teacher/lessons', requireToken, requireTeacher, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ts.id, ts.starts_at, ts.ends_at, ts.note, ts.student_id, ts.booked_at,
              u.name AS student_name, u.avatar_icon AS student_avatar, u.avatar_color AS student_color
       FROM teacher_slots ts LEFT JOIN users u ON u.id = ts.student_id
       WHERE ts.teacher_id = $1 AND ts.status = 'booked' AND ts.ends_at > NOW() - INTERVAL '120 days'
       ORDER BY ts.starts_at ASC`,
      [req.teacher.id]);
    res.json({ lessons: rows });
  } catch (e) { console.error('m/teacher lessons:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── PUT /api/m/teacher/slots/:id : le prof modifie un cours réservé ──────────
// Chemin distinct de /teacher/lessons/:id (= suppression de TASK) pour éviter la
// collision de routes : ici on agit sur un créneau réservé (teacher_slots).
router.put('/api/m/teacher/slots/:id', requireToken, requireTeacher, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid lesson' });
    const { starts_at, note } = req.body || {};
    if (!starts_at) return res.status(400).json({ error: 'starts_at required' });
    const newStart = new Date(starts_at);
    if (isNaN(newStart.getTime()) || newStart <= new Date()) return res.status(400).json({ error: 'Invalid or past date' });
    const newEnd = new Date(newStart.getTime() + 60 * 60 * 1000);
    const { rows } = await pool.query(
      `UPDATE teacher_slots SET starts_at = $3, ends_at = $4, note = $5
       WHERE id = $1 AND teacher_id = $2 AND status = 'booked' RETURNING student_id, starts_at`,
      [id, req.teacher.id, newStart, newEnd, (note ?? '').slice(0, 200) || null]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const teacherName = (await pool.query('SELECT name FROM users WHERE id = $1', [req.teacher.id])).rows[0]?.name || 'Your teacher';
    const fmtDate = newStart.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const fmtTime = newStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    notify(rows[0].student_id, 'lesson_modified', `${teacherName} rescheduled your lesson`,
      `New time: ${fmtDate} at ${fmtTime}`, { slotId: id });
    res.json({ ok: true });
  } catch (e) { console.error('m/teacher lessons put:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── DELETE /api/m/teacher/slots/:id : le prof annule un cours réservé ─────────
router.delete('/api/m/teacher/slots/:id', requireToken, requireTeacher, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid lesson' });
    const { rows } = await pool.query(
      `DELETE FROM teacher_slots WHERE id = $1 AND teacher_id = $2 AND status = 'booked' RETURNING student_id, starts_at`,
      [id, req.teacher.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const teacherName = (await pool.query('SELECT name FROM users WHERE id = $1', [req.teacher.id])).rows[0]?.name || 'Your teacher';
    const oldStart = new Date(rows[0].starts_at);
    const fmtDate = oldStart.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const fmtTime = oldStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    notify(rows[0].student_id, 'lesson_cancelled', `${teacherName} cancelled your lesson`,
      `${fmtDate} at ${fmtTime} has been cancelled`, { slotId: id });
    res.json({ ok: true });
  } catch (e) { console.error('m/teacher lessons delete:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── GET /api/m/student/slots : créneaux réservables (dérivés des semaines types) ─
router.get('/api/m/student/slots', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const teacherId = parseInt(req.query.teacherId, 10) || null;
    // Profs actifs de l'élève + leur semaine type.
    const tq = await pool.query(
      `SELECT DISTINCT c.teacher_id, u.name, u.timezone
       FROM classroom_students cs JOIN classrooms c ON c.id = cs.classroom_id
       JOIN users u ON u.id = c.teacher_id
       WHERE cs.student_id = $1 AND cs.status = 'active' AND ($2::int IS NULL OR c.teacher_id = $2)`,
      [uid, teacherId]);
    const teachers = tq.rows;
    if (!teachers.length) return res.json({ slots: [] });
    const ids = teachers.map((t) => t.teacher_id);
    const [av, dav, booked] = await Promise.all([
      pool.query(`SELECT teacher_id, weekday, hour FROM teacher_availability WHERE teacher_id = ANY($1)`, [ids]),
      pool.query(`SELECT teacher_id, to_char(day,'YYYY-MM-DD') AS day, hour FROM teacher_date_slots WHERE teacher_id = ANY($1) AND day >= CURRENT_DATE`, [ids]),
      pool.query(`SELECT teacher_id, starts_at FROM teacher_slots WHERE status = 'booked' AND teacher_id = ANY($1) AND starts_at > NOW()`, [ids]),
    ]);
    // Regroupe par prof (semaine type + overrides + cours réservés), avec son fuseau.
    const perTeacher = new Map();
    teachers.forEach((t) => perTeacher.set(t.teacher_id, { tz: validTz(t.timezone) || 'UTC', name: t.name, blocks: [], dateMap: new Map(), bookedSet: new Set() }));
    av.rows.forEach((r) => perTeacher.get(r.teacher_id)?.blocks.push({ weekday: r.weekday, hour: r.hour }));
    dav.rows.forEach((r) => { const o = perTeacher.get(r.teacher_id); if (!o) return; if (!o.dateMap.has(r.day)) o.dateMap.set(r.day, new Set()); o.dateMap.get(r.day).add(r.hour); });
    booked.rows.forEach((r) => perTeacher.get(r.teacher_id)?.bookedSet.add(new Date(r.starts_at).toISOString()));

    const out = [];
    for (const t of teachers) {
      const o = perTeacher.get(t.teacher_id);
      deriveTeacherSlots({ tz: o.tz, blocks: o.blocks, dateMap: o.dateMap, bookedSet: o.bookedSet, horizonDays: BOOKING_HORIZON_DAYS })
        .forEach((s) => out.push({ teacher_id: t.teacher_id, teacher_name: t.name, starts_at: s.starts_at, ends_at: s.ends_at }));
    }
    out.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    res.json({ slots: out.slice(0, 200) });
  } catch (e) { console.error('m/student slots list:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── GET /api/m/student/slots/recurring : créneaux HEBDO libres sur toute la durée ─
// {teacherId, weeks}. On ne renvoie qu'un créneau (jour+heure) si ses `weeks`
// occurrences consécutives (à partir de la prochaine) sont TOUTES ouvertes et
// libres. Renvoie la 1re occurrence de chaque série → bookRecurringSlots ensuite.
router.get('/api/m/student/slots/recurring', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const teacherId = parseInt(req.query.teacherId, 10);
    let weeks = parseInt(req.query.weeks, 10);
    weeks = Math.max(2, Math.min(12, Number.isFinite(weeks) ? weeks : 8));
    if (!teacherId) return res.status(400).json({ error: 'Invalid request' });
    if (!(await studentLinkedToTeacher(uid, teacherId))) {
      return res.status(403).json({ error: 'You are not an active student of this teacher' });
    }
    const horizonDays = weeks * 7 + 1;
    const tz = await teacherTz(teacherId);
    const [av, dav, booked] = await Promise.all([
      pool.query(`SELECT weekday, hour FROM teacher_availability WHERE teacher_id = $1`, [teacherId]),
      pool.query(`SELECT to_char(day,'YYYY-MM-DD') AS day, hour FROM teacher_date_slots WHERE teacher_id = $1 AND day >= CURRENT_DATE AND day <= CURRENT_DATE + make_interval(days => $2)`, [teacherId, horizonDays]),
      pool.query(`SELECT starts_at FROM teacher_slots WHERE status = 'booked' AND teacher_id = $1 AND starts_at > NOW()`, [teacherId]),
    ]);
    const dateMap = new Map();
    dav.rows.forEach((r) => { if (!dateMap.has(r.day)) dateMap.set(r.day, new Set()); dateMap.get(r.day).add(r.hour); });
    const bookedSet = new Set(booked.rows.map((r) => new Date(r.starts_at).toISOString()));
    const open = deriveTeacherSlots({ tz, blocks: av.rows, dateMap, bookedSet, horizonDays });
    const openSet = new Set(open.map((s) => s.starts_at));
    // Première occurrence par (weekday, heure) en heure murale du prof.
    const firstByKey = new Map();
    for (const s of open) {
      const w = utcToWall(new Date(s.starts_at), tz);
      const key = `${w.weekday}:${w.hour}`;
      if (!firstByKey.has(key)) firstByKey.set(key, { iso: s.starts_at, wall: w });
    }
    // Ne garde que les séries dont les `weeks` occurrences sont toutes ouvertes.
    const out = [];
    for (const { iso, wall } of firstByKey.values()) {
      let ok = true;
      for (let i = 0; i < weeks; i++) {
        const base = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
        base.setUTCDate(base.getUTCDate() + i * 7);
        const exp = wallToUtc(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), wall.hour, tz).toISOString();
        if (!openSet.has(exp)) { ok = false; break; }
      }
      if (ok) out.push({ first_starts_at: iso });
    }
    out.sort((a, b) => new Date(a.first_starts_at) - new Date(b.first_starts_at));
    res.json({ weeks, slots: out });
  } catch (e) { console.error('m/student slots recurring:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── POST /api/m/student/slots/book : réserver un créneau dérivé {teacher_id, starts_at} ─
router.post('/api/m/student/slots/book', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const teacherId = parseInt(req.body?.teacher_id, 10);
    const start = new Date(req.body?.starts_at);
    if (!teacherId || isNaN(start)) return res.status(400).json({ error: 'Invalid request' });
    if (start.getTime() <= Date.now()) return res.status(400).json({ error: 'Slot is in the past' });
    if (start.getMinutes() !== 0 || start.getSeconds() !== 0) return res.status(400).json({ error: 'Invalid slot time' });
    if (!(await studentLinkedToTeacher(uid, teacherId))) {
      return res.status(403).json({ error: 'You are not an active student of this teacher' });
    }
    // Le créneau doit être ouvert (évalué dans le fuseau du prof).
    if (!(await slotOpenForTeacher(teacherId, start))) return res.status(409).json({ error: 'Slot not available', taken: true });
    const end = new Date(start.getTime() + SLOT_MIN * 60000);
    // Insert atomique : l'index unique partiel (teacher_id, starts_at) WHERE booked
    // empêche le double-booking → ON CONFLICT = créneau déjà pris.
    const ins = await pool.query(
      `INSERT INTO teacher_slots (teacher_id, starts_at, ends_at, student_id, status, booked_at)
       VALUES ($1, $2, $3, $4, 'booked', NOW())
       ON CONFLICT (teacher_id, starts_at) WHERE status = 'booked' DO NOTHING
       RETURNING id`,
      [teacherId, start.toISOString(), end.toISOString(), uid]);
    if (!ins.rows.length) return res.status(409).json({ error: 'Slot no longer available', taken: true });
    res.json({ ok: true, id: ins.rows[0].id });
  } catch (e) { console.error('m/student slots book:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── POST /api/m/student/slots/book-recurring : réserver une série hebdomadaire ─
// {teacher_id, starts_at (1re occurrence), weeks}. Chaque occurrence = même
// jour/heure murale dans le fuseau du prof, +7 jours (DST-safe via wallToUtc).
// Les occurrences fermées / passées / déjà prises sont sautées et reportées ;
// pas d'horizon de 28 j ici car on s'appuie sur la dispo hebdo récurrente du prof.
router.post('/api/m/student/slots/book-recurring', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const teacherId = parseInt(req.body?.teacher_id, 10);
    const first = new Date(req.body?.starts_at);
    let weeks = parseInt(req.body?.weeks, 10);
    if (!teacherId || isNaN(first)) return res.status(400).json({ error: 'Invalid request' });
    if (first.getMinutes() !== 0 || first.getSeconds() !== 0) return res.status(400).json({ error: 'Invalid slot time' });
    weeks = Math.max(2, Math.min(12, Number.isFinite(weeks) ? weeks : 0));
    if (!(await studentLinkedToTeacher(uid, teacherId))) {
      return res.status(403).json({ error: 'You are not an active student of this teacher' });
    }
    const tz = await teacherTz(teacherId);
    const w0 = utcToWall(first, tz);
    const booked = [], unavailable = [];
    for (let i = 0; i < weeks; i++) {
      const base = new Date(Date.UTC(w0.year, w0.month - 1, w0.day));
      base.setUTCDate(base.getUTCDate() + i * 7);
      const startUtc = wallToUtc(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), w0.hour, tz);
      const iso = startUtc.toISOString();
      if (startUtc.getTime() <= Date.now()) { unavailable.push({ starts_at: iso, reason: 'past' }); continue; }
      if (!(await slotOpenForTeacher(teacherId, startUtc))) { unavailable.push({ starts_at: iso, reason: 'closed' }); continue; }
      const end = new Date(startUtc.getTime() + SLOT_MIN * 60000);
      const ins = await pool.query(
        `INSERT INTO teacher_slots (teacher_id, starts_at, ends_at, student_id, status, booked_at)
         VALUES ($1, $2, $3, $4, 'booked', NOW())
         ON CONFLICT (teacher_id, starts_at) WHERE status = 'booked' DO NOTHING
         RETURNING id`,
        [teacherId, iso, end.toISOString(), uid]);
      if (ins.rows.length) booked.push({ id: ins.rows[0].id, starts_at: iso });
      else unavailable.push({ starts_at: iso, reason: 'taken' });
    }
    res.json({ ok: true, booked, unavailable, booked_count: booked.length, requested: weeks });
  } catch (e) { console.error('m/student slots book-recurring:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── POST /api/m/student/slots/:id/cancel : annuler MA réservation (libère le créneau) ─
router.post('/api/m/student/slots/:id/cancel', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid slot' });
    const { rowCount } = await pool.query(
      `DELETE FROM teacher_slots WHERE id = $1 AND student_id = $2 AND status = 'booked' AND starts_at > NOW()`,
      [id, uid]);
    if (!rowCount) return res.status(409).json({ error: 'Cannot cancel this booking' });
    res.json({ ok: true });
  } catch (e) { console.error('m/student slots cancel:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── GET /api/m/agenda/upcoming : mes sessions réservées à venir (prof OU élève) ─
router.get('/api/m/agenda/upcoming', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const { rows } = await pool.query(
      `SELECT ts.id, ts.starts_at, ts.ends_at, ts.note, ts.teacher_id, ts.student_id,
              (ts.teacher_id = $1) AS i_am_teacher,
              CASE WHEN ts.teacher_id = $1 THEN su.name END AS student_name,
              CASE WHEN ts.teacher_id = $1 THEN su.name ELSE tu.name END AS other_name,
              CASE WHEN ts.teacher_id = $1 THEN su.avatar_icon ELSE tu.avatar_icon END AS other_avatar,
              CASE WHEN ts.teacher_id = $1 THEN su.avatar_color ELSE tu.avatar_color END AS other_color
       FROM teacher_slots ts
       JOIN users tu ON tu.id = ts.teacher_id
       LEFT JOIN users su ON su.id = ts.student_id
       WHERE ts.status = 'booked' AND ts.ends_at > NOW() - INTERVAL '10 minutes'
         AND (ts.teacher_id = $1 OR ts.student_id = $1)
       ORDER BY ts.starts_at ASC LIMIT 50`,
      [uid]);
    res.json({ sessions: rows });
  } catch (e) { console.error('m/agenda upcoming:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── Visio (Daily.co) : room par cours ────────────────────────────────────────
// Pricing: $0.004/participant/minute — ~$0.48 per 1h 1:1 session (vs $1000/mo JaaS).
// Nécessite DAILY_API_KEY dans les env vars (dashboard.daily.co → Developers).
// Fallback : meet.jit.si (lobby bloque sans JWT — à éviter en prod).
const DAILY_API_KEY = process.env.DAILY_API_KEY;
console.log('[daily] API key', DAILY_API_KEY ? `set (${DAILY_API_KEY.slice(0, 8)}…)` : 'NOT SET — falling back to Jitsi');

// Nom de room déterministe et NON-DEVINABLE (HMAC de l'id du créneau).
function lessonRoom(slotId) {
  const mac = crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev-only-insecure-secret')
    .update(`lesson:${slotId}`).digest('hex').slice(0, 24);
  return `jiayou-${slotId}-${mac}`;
}

// Crée (ou récupère) une room Daily.co et génère un meeting token.
// rooms sont "private" (pas d'accès sans token) + expiry auto après le cours.
async function dailyRoom(roomName, endsAt) {
  const base = 'https://api.daily.co/v1';
  const headers = { Authorization: `Bearer ${DAILY_API_KEY}`, 'Content-Type': 'application/json' };
  const expTs = Math.floor(new Date(endsAt).getTime() / 1000) + JOIN_LATE_MS / 1000;

  // Crée la room si elle n'existe pas encore (idempotent : 409 = déjà là).
  let domainRes = await fetch(`${base}/rooms/${roomName}`, { headers });
  if (domainRes.status === 404) {
    const r = await fetch(`${base}/rooms`, {
      method: 'POST', headers,
      body: JSON.stringify({ name: roomName, privacy: 'private', properties: { exp: expTs, enable_prejoin_ui: false } }),
    });
    if (!r.ok) throw new Error(`Daily create room: ${r.status}`);
    domainRes = r;
  }
  const roomData = await domainRes.json();
  return roomData.url; // https://{subdomain}.daily.co/{roomName}
}

async function dailyToken(roomName, { isOwner, userId, userName, expiresAt }) {
  const headers = { Authorization: `Bearer ${DAILY_API_KEY}`, 'Content-Type': 'application/json' };
  const exp = Math.floor(new Date(expiresAt).getTime() / 1000) + JOIN_LATE_MS / 1000;
  const r = await fetch('https://api.daily.co/v1/meeting-tokens', {
    method: 'POST', headers,
    body: JSON.stringify({ properties: { room_name: roomName, is_owner: isOwner, user_id: String(userId), user_name: userName, exp } }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Daily token: ${r.status} — ${body}`);
  }
  const { token } = await r.json();
  return token;
}

const JOIN_EARLY_MS = 15 * 60 * 1000;
const JOIN_LATE_MS  = 10 * 60 * 1000; // rejoignable jusqu'à 10 min après la fin du cours

// ── GET /api/m/lesson/:id/room : URL de visio du cours (participants only) ────
router.get('/api/m/lesson/:id/room', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const id = parseInt(req.params.id, 10);
    console.log(`[lesson-room] hit — slotId=${id} uid=${uid} daily=${!!DAILY_API_KEY}`);
    if (!id) return res.status(400).json({ error: 'Invalid lesson' });
    const { rows } = await pool.query(
      `SELECT ts.teacher_id, ts.student_id, ts.starts_at, ts.ends_at,
              u.name AS user_name
       FROM teacher_slots ts
       JOIN users u ON u.id = $2
       WHERE ts.id = $1 AND ts.status = 'booked'`, [id, uid]);
    if (!rows.length) return res.status(404).json({ error: 'Lesson not found' });
    const s = rows[0];
    if (uid !== s.teacher_id && uid !== s.student_id) return res.status(403).json({ error: 'Not your lesson' });

    const now = Date.now();
    const start = new Date(s.starts_at).getTime(), end = new Date(s.ends_at).getTime();
    if (now < start - JOIN_EARLY_MS) return res.json({ available: false, reason: 'too_early', starts_at: s.starts_at });
    if (now > end + JOIN_LATE_MS) return res.json({ available: false, reason: 'ended' });

    const room = lessonRoom(id);
    const isHost = uid === s.teacher_id;

    // Daily.co (activé si DAILY_API_KEY est défini)
    if (DAILY_API_KEY) {
      try {
        const roomUrl = await dailyRoom(room, s.ends_at);
        const token = await dailyToken(room, { isOwner: isHost, userId: uid, userName: s.user_name, expiresAt: s.ends_at });
        return res.json({ available: true, room, domain: 'daily.co', isHost, url: `${roomUrl}?t=${token}` });
      } catch (dailyErr) {
        console.error('[daily] room/token error — falling back to Jitsi:', dailyErr.message);
      }
    }

    // Fallback meet.jit.si (sans JWT → lobby peut bloquer)
    const JITSI_DOMAIN = process.env.JITSI_DOMAIN || 'meet.jit.si';
    res.json({ available: true, room, domain: JITSI_DOMAIN, isHost, url: `https://${JITSI_DOMAIN}/${room}` });
  } catch (e) { console.error('m/lesson room:', e); res.status(500).json({ error: 'Server error' }); }
});

};
