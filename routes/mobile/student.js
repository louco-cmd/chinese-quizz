// ════════════════════════════════════════════════════════════════════════════
//  CÔTÉ ÉLÈVE — annuaire mentors, réservation d'essai, mes classes/historique,
//  leçons reçues, notation/quitter un mentor, tâches, rejoindre une classe.
//  Extrait de routes/mobile.js. Monté via registerStudentRoutes(router, deps).
// ════════════════════════════════════════════════════════════════════════════
const { pool } = require('../../config/database');
const { SLOT_MIN, BOOKING_HORIZON_DAYS, validTz, deriveTeacherSlots } = require('../../lib/teacher-schedule');
const { slotOpenForTeacher } = require('../../lib/teacher-slots');

module.exports = function registerStudentRoutes(router, deps) {
  const { requireToken, notify, getUserLangs } = deps;

// ── GET /api/m/mentors : annuaire des mentors ────────────────────────────────
router.get('/api/m/mentors', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.languages_spoken, u.teaching_languages, u.session_price, u.session_currency,
              u.years_experience, u.mentor_bio, u.mentor_links,
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
    const mentors = rows.map((m) => {
      const links = Array.isArray(m.mentor_links) ? m.mentor_links : [];
      return {
        id: m.id, name: m.name, languages_spoken: m.languages_spoken,
        teaching_languages: (m.teaching_languages || '').split(',').map((s) => s.trim()).filter(Boolean),
        session_price: m.session_price != null ? Number(m.session_price) : null,
        session_currency: m.session_currency || 'EUR',
        years_experience: m.years_experience, mentor_bio: m.mentor_bio,
        student_count: m.student_count, task_count: m.task_count,
        link: links[0] || null,
      };
    });
    res.json({ mentors });
  } catch (e) {
    console.error('m/mentors error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/mentors/:id : profil complet d'un mentor + stats ──────────────
router.get('/api/m/mentors/:id', requireToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid teacher' });
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.languages_spoken, u.teaching_languages, u.session_price, u.session_currency,
              u.years_experience, u.mentor_bio, u.mentor_links, u.presentation_video,
              (SELECT COUNT(DISTINCT cs.student_id) FROM classrooms c JOIN classroom_students cs ON cs.classroom_id = c.id
                 WHERE c.teacher_id = u.id AND cs.status = 'active')::int AS student_count,
              (SELECT COUNT(l.id) FROM lessons l JOIN classrooms c ON c.id = l.classroom_id WHERE c.teacher_id = u.id)::int AS task_count,
              (SELECT COUNT(*) FROM teacher_slots ts WHERE ts.teacher_id = u.id AND ts.status = 'booked' AND ts.ends_at < NOW())::int AS courses_given,
              (SELECT ROUND(AVG(rating)::numeric, 1) FROM teacher_ratings WHERE teacher_id = u.id) AS rating,
              (SELECT COUNT(*) FROM teacher_ratings WHERE teacher_id = u.id)::int AS rating_count
       FROM users u
       WHERE u.id = $1 AND u.role = 'teacher' AND u.mentor_listed = TRUE`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Teacher not found' });
    const m = rows[0];
    const links = Array.isArray(m.mentor_links) ? m.mentor_links : [];
    res.json({
      mentor: {
        id: m.id, name: m.name, languages_spoken: m.languages_spoken,
        teaching_languages: (m.teaching_languages || '').split(',').map((s) => s.trim()).filter(Boolean),
        session_price: m.session_price != null ? Number(m.session_price) : null,
        session_currency: m.session_currency || 'EUR',
        years_experience: m.years_experience, mentor_bio: m.mentor_bio,
        student_count: m.student_count, task_count: m.task_count, courses_given: m.courses_given,
        rating: m.rating != null ? Number(m.rating) : null, rating_count: m.rating_count,
        presentation_video: m.presentation_video || null,
        links, link: links[0] || null,
      },
    });
  } catch (e) { console.error('m/mentor detail error:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── GET /api/m/mentors/:id/slots : créneaux réservables d'un mentor (ESSAI) ───
// Pas besoin d'être déjà élève du prof. Dérivé de sa semaine type dans SON fuseau ;
// l'élève affiche les instants UTC dans le sien. Renvoie aussi le fuseau du prof.
router.get('/api/m/mentors/:id/slots', requireToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid teacher' });
    const t = await pool.query(`SELECT name, timezone FROM users WHERE id = $1 AND role = 'teacher' AND mentor_listed = TRUE`, [id]);
    if (!t.rows.length) return res.status(404).json({ error: 'Teacher not found' });
    const tz = validTz(t.rows[0].timezone) || 'UTC';
    const [av, dav, booked] = await Promise.all([
      pool.query(`SELECT weekday, hour FROM teacher_availability WHERE teacher_id = $1`, [id]),
      pool.query(`SELECT to_char(day,'YYYY-MM-DD') AS day, hour FROM teacher_date_slots WHERE teacher_id = $1 AND day >= CURRENT_DATE`, [id]),
      pool.query(`SELECT starts_at FROM teacher_slots WHERE teacher_id = $1 AND status = 'booked' AND starts_at > NOW()`, [id]),
    ]);
    const dateMap = new Map();
    dav.rows.forEach((r) => { if (!dateMap.has(r.day)) dateMap.set(r.day, new Set()); dateMap.get(r.day).add(r.hour); });
    const bookedSet = new Set(booked.rows.map((r) => new Date(r.starts_at).toISOString()));
    const slots = deriveTeacherSlots({ tz, blocks: av.rows, dateMap, bookedSet, horizonDays: BOOKING_HORIZON_DAYS });
    res.json({ teacher_name: t.rows[0].name, timezone: tz, slots: slots.slice(0, 200) });
  } catch (e) { console.error('m/mentor slots:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── POST /api/m/mentors/:id/book-trial : réserver une séance d'essai ─────────
// Ne nécessite PAS d'adhésion. Un seul cours d'essai à venir par (élève, prof).
router.post('/api/m/mentors/:id/book-trial', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const id = parseInt(req.params.id, 10);
    const start = new Date(req.body?.starts_at);
    if (!id || isNaN(start)) return res.status(400).json({ error: 'Invalid request' });
    if (id === uid) return res.status(400).json({ error: 'Cannot book yourself' });
    if (start.getTime() <= Date.now()) return res.status(400).json({ error: 'Slot is in the past' });
    if (start.getUTCMinutes() !== 0 || start.getUTCSeconds() !== 0) return res.status(400).json({ error: 'Invalid slot time' });
    const t = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'teacher' AND mentor_listed = TRUE`, [id]);
    if (!t.rows.length) return res.status(404).json({ error: 'Teacher not found' });
    if (!(await slotOpenForTeacher(id, start))) return res.status(409).json({ error: 'Slot not available', taken: true });
    // Déjà un cours à venir avec ce prof ? (évite le spam de réservations d'essai)
    const dup = await pool.query(
      `SELECT 1 FROM teacher_slots WHERE teacher_id = $1 AND student_id = $2 AND status = 'booked' AND starts_at > NOW() LIMIT 1`, [id, uid]);
    if (dup.rows.length) return res.status(409).json({ error: 'You already have an upcoming lesson with this teacher.', already: true });
    const end = new Date(start.getTime() + SLOT_MIN * 60000);
    const ins = await pool.query(
      `INSERT INTO teacher_slots (teacher_id, starts_at, ends_at, student_id, status, booked_at, note)
       VALUES ($1, $2, $3, $4, 'booked', NOW(), 'trial')
       ON CONFLICT (teacher_id, starts_at) WHERE status = 'booked' DO NOTHING RETURNING id`,
      [id, start.toISOString(), end.toISOString(), uid]);
    if (!ins.rows.length) return res.status(409).json({ error: 'Slot no longer available', taken: true });
    res.json({ ok: true, id: ins.rows[0].id });
  } catch (e) { console.error('m/mentor book-trial:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── GET /api/m/student/classes : mentors rejoints + tasks en cours ───────────
// Miroir de /api/student/my-classes : sert à la page account ET au quiz.
router.get('/api/m/student/classes', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const { rows: mentors } = await pool.query(
      `SELECT t.id, COALESCE(NULLIF(TRIM(t.name), ''), 'Your teacher') AS name, MIN(cs.joined_at) AS since
       FROM classroom_students cs
       JOIN classrooms c ON c.id = cs.classroom_id
       JOIN users t ON t.id = c.teacher_id
       WHERE cs.student_id = $1 AND cs.status = 'active'
       GROUP BY t.id, t.name
       ORDER BY since ASC`, [uid]);

    const { rows: taskRows } = await pool.query(
      `SELECT l.id, l.title, c.name AS class_name,
              (SELECT COUNT(*) FROM lesson_words lw WHERE lw.lesson_id = l.id)::int AS word_count,
              (SELECT COALESCE(ROUND(AVG(COALESCE(um.score, 0))), 0)
                 FROM lesson_words lw
                 LEFT JOIN user_mots um ON um.mot_id = lw.mot_id AND um.user_id = $1
                 WHERE lw.lesson_id = l.id)::int AS knowledge
       FROM lessons l
       JOIN classrooms c ON c.id = l.classroom_id
       JOIN classroom_students cs ON cs.classroom_id = c.id AND cs.student_id = $1 AND cs.status = 'active'
       WHERE l.created_at >= COALESCE(cs.joined_at, 'epoch')
       ORDER BY l.created_at DESC`, [uid]);

    const tasks = taskRows
      .filter((t) => t.word_count > 0 && t.knowledge < 100)
      .map((t) => ({ id: t.id, title: t.title, class_name: t.class_name, word_count: t.word_count, knowledge: t.knowledge }));

    res.json({ mentors, tasks });
  } catch (e) {
    console.error('m/student classes error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/student/history : TOUS les cours reçus (terminés inclus, profs
// quittés inclus) → la page « Mes cours » (Settings). Contrairement à
// /student/classes (profs actifs + tasks en cours), ne filtre NI sur la complétion
// NI sur le statut d'adhésion. `completed` = connaissance ≥ 100 ; `membership` =
// 'active' | 'removed' (un prof quitté/retiré → cours en lecture seule côté app).
router.get('/api/m/student/history', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const { rows } = await pool.query(
      `SELECT l.id, l.title, l.created_at,
              c.name AS class_name, t.id AS teacher_id,
              COALESCE(NULLIF(TRIM(t.name), ''), 'Your teacher') AS teacher_name,
              cs.status AS membership,
              (SELECT COUNT(*) FROM lesson_words lw WHERE lw.lesson_id = l.id)::int AS word_count,
              (SELECT COALESCE(ROUND(AVG(COALESCE(um.score, 0))), 0)
                 FROM lesson_words lw
                 LEFT JOIN user_mots um ON um.mot_id = lw.mot_id AND um.user_id = $1
                 WHERE lw.lesson_id = l.id)::int AS knowledge
       FROM lessons l
       JOIN classrooms c ON c.id = l.classroom_id
       JOIN users t ON t.id = c.teacher_id
       JOIN classroom_students cs ON cs.classroom_id = c.id AND cs.student_id = $1
       WHERE l.created_at >= COALESCE(cs.joined_at, 'epoch')
       ORDER BY (cs.status = 'active') DESC, t.name ASC, l.created_at DESC`, [uid]);
    const lessons = rows
      .filter((r) => r.word_count > 0)
      .map((r) => ({
        id: r.id, title: r.title, class_name: r.class_name,
        teacher_id: r.teacher_id, teacher_name: r.teacher_name, membership: r.membership,
        word_count: r.word_count, knowledge: r.knowledge, completed: r.knowledge >= 100,
      }));
    res.json({ lessons });
  } catch (e) {
    console.error('m/student history error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/student/lessons/:id : détail d'un cours (notes + mots) ─────────
router.get('/api/m/student/lessons/:id', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const lessonId = parseInt(req.params.id, 10);
    // Lecture autorisée à tout membre (même adhésion 'removed') → consultation de
    // l'historique des cours ; la PRATIQUE (start/result) reste réservée aux profs actifs.
    const access = await pool.query(
      `SELECT l.id FROM lessons l
       JOIN classroom_students cs ON cs.classroom_id = l.classroom_id
       WHERE l.id = $1 AND cs.student_id = $2`, [lessonId, uid]);
    if (!access.rows.length) return res.status(404).json({ error: 'Course not found' });
    const nat = (await getUserLangs(uid)).native;

    const [lrows, words] = await Promise.all([
      pool.query(
        `SELECT l.id, l.title, l.summary, l.created_at, c.name AS class_name
         FROM lessons l JOIN classrooms c ON c.id = l.classroom_id WHERE l.id = $1`, [lessonId]),
      pool.query(
        `SELECT m.id, m.chinese, m.pinyin, mot_tr(m.id, $2) AS english
         FROM lesson_words lw JOIN mots m ON m.id = lw.mot_id
         WHERE lw.lesson_id = $1 ORDER BY lw.id ASC`, [lessonId, nat]),
    ]);
    res.json({ lesson: lrows.rows[0], words: words.rows });
  } catch (e) {
    console.error('m/student lesson error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/student/mentors/:teacherId/overview : page « mon prof » ────────
// Vue côté élève d'un prof qu'il a rejoint : identité + stats, ses classes avec
// ce prof, ses cours à venir, et sa propre note. Pas de filtre mentor_listed —
// on autorise dès qu'un lien élève↔prof existe (classe ou cours réservé).
router.get('/api/m/student/mentors/:teacherId/overview', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const teacherId = parseInt(req.params.teacherId, 10);
    if (!teacherId) return res.status(400).json({ error: 'Invalid mentor' });

    const [enroll, slotLink] = await Promise.all([
      pool.query(
        `SELECT 1 FROM classroom_students cs JOIN classrooms c ON c.id = cs.classroom_id
         WHERE c.teacher_id = $1 AND cs.student_id = $2 LIMIT 1`, [teacherId, uid]),
      pool.query(`SELECT 1 FROM teacher_slots WHERE teacher_id = $1 AND student_id = $2 LIMIT 1`, [teacherId, uid]),
    ]);
    if (!enroll.rows.length && !slotLink.rows.length) return res.status(404).json({ error: 'Teacher not found' });

    const tq = await pool.query(
      `SELECT u.id, COALESCE(NULLIF(TRIM(u.name), ''), 'Your teacher') AS name,
              u.teaching_languages, u.session_price, u.session_currency,
              (SELECT COUNT(DISTINCT cs.student_id) FROM classrooms c JOIN classroom_students cs ON cs.classroom_id = c.id
                 WHERE c.teacher_id = u.id AND cs.status = 'active')::int AS student_count,
              (SELECT COUNT(*) FROM teacher_slots ts WHERE ts.teacher_id = u.id AND ts.status = 'booked' AND ts.ends_at < NOW())::int AS courses_given,
              (SELECT ROUND(AVG(rating)::numeric, 1) FROM teacher_ratings WHERE teacher_id = u.id) AS rating,
              (SELECT COUNT(*) FROM teacher_ratings WHERE teacher_id = u.id)::int AS rating_count
       FROM users u WHERE u.id = $1 AND u.role = 'teacher'`, [teacherId]);
    if (!tq.rows.length) return res.status(404).json({ error: 'Teacher not found' });
    const t = tq.rows[0];

    const [classes, lessons, upcoming, mine] = await Promise.all([
      pool.query(
        `SELECT c.id, c.name, cs.status, MIN(cs.joined_at) AS since,
                (SELECT COUNT(*) FROM lessons l WHERE l.classroom_id = c.id)::int AS task_count
         FROM classroom_students cs JOIN classrooms c ON c.id = cs.classroom_id
         WHERE c.teacher_id = $1 AND cs.student_id = $2
         GROUP BY c.id, c.name, cs.status ORDER BY since ASC`, [teacherId, uid]),
      // Cours reçus de ce prof (même forme que /student/history → composant partagé).
      pool.query(
        `SELECT l.id, l.title, l.created_at, c.name AS class_name, cs.status AS membership,
                (SELECT COUNT(*) FROM lesson_words lw WHERE lw.lesson_id = l.id)::int AS word_count,
                (SELECT COALESCE(ROUND(AVG(COALESCE(um.score, 0))), 0)
                   FROM lesson_words lw
                   LEFT JOIN user_mots um ON um.mot_id = lw.mot_id AND um.user_id = $2
                   WHERE lw.lesson_id = l.id)::int AS knowledge
         FROM lessons l
         JOIN classrooms c ON c.id = l.classroom_id
         JOIN classroom_students cs ON cs.classroom_id = c.id AND cs.student_id = $2
         WHERE c.teacher_id = $1 AND l.created_at >= COALESCE(cs.joined_at, 'epoch')
         ORDER BY l.created_at DESC`, [teacherId, uid]),
      pool.query(
        `SELECT ts.id, ts.starts_at, ts.ends_at, ts.note
         FROM teacher_slots ts
         WHERE ts.teacher_id = $1 AND ts.student_id = $2 AND ts.status = 'booked' AND ts.ends_at > NOW()
         ORDER BY ts.starts_at ASC`, [teacherId, uid]),
      pool.query(`SELECT rating, comment FROM teacher_ratings WHERE teacher_id = $1 AND student_id = $2`, [teacherId, uid]),
    ]);

    const isActive = classes.rows.some((c) => c.status === 'active');
    res.json({
      teacher: {
        id: t.id, name: t.name,
        teaching_languages: (t.teaching_languages || '').split(',').map((s) => s.trim()).filter(Boolean),
        session_price: t.session_price != null ? Number(t.session_price) : null,
        session_currency: t.session_currency || 'EUR',
        student_count: t.student_count, courses_given: t.courses_given,
        rating: t.rating != null ? Number(t.rating) : null, rating_count: t.rating_count,
      },
      is_active: isActive,
      classes: classes.rows.map((c) => ({ id: c.id, name: c.name, status: c.status, since: c.since, task_count: c.task_count })),
      lessons: lessons.rows
        .filter((r) => r.word_count > 0)
        .map((r) => ({
          id: r.id, title: r.title, class_name: r.class_name, membership: r.membership,
          word_count: r.word_count, knowledge: r.knowledge, completed: r.knowledge >= 100,
        })),
      upcoming_lessons: upcoming.rows,
      my_rating: mine.rows[0] || null,
    });
  } catch (e) { console.error('m/student mentor overview error:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── POST /api/m/student/mentors/:teacherId/rate : noter un prof (1 note/élève) ─
router.post('/api/m/student/mentors/:teacherId/rate', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const teacherId = parseInt(req.params.teacherId, 10);
    const rating = parseInt(req.body?.rating, 10);
    const comment = (req.body?.comment || '').trim().slice(0, 500) || null;
    if (!teacherId) return res.status(400).json({ error: 'Invalid mentor' });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    const link = await pool.query(
      `SELECT 1 FROM classroom_students cs JOIN classrooms c ON c.id = cs.classroom_id
       WHERE c.teacher_id = $1 AND cs.student_id = $2 LIMIT 1`, [teacherId, uid]);
    if (!link.rows.length) return res.status(403).json({ error: 'You are not enrolled with this teacher' });
    await pool.query(
      `INSERT INTO teacher_ratings (teacher_id, student_id, rating, comment) VALUES ($1, $2, $3, $4)
       ON CONFLICT (teacher_id, student_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = CURRENT_TIMESTAMP`,
      [teacherId, uid, rating, comment]);
    res.json({ success: true });
  } catch (e) { console.error('m/student rate mentor error:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── POST /api/m/student/mentors/:teacherId/leave : quitter un prof ───────────
router.post('/api/m/student/mentors/:teacherId/leave', requireToken, async (req, res) => {
  try {
    const teacherId = parseInt(req.params.teacherId, 10);
    if (!teacherId) return res.status(400).json({ error: 'Invalid mentor' });
    await pool.query(
      `UPDATE classroom_students cs SET status = 'removed'
       FROM classrooms c
       WHERE cs.classroom_id = c.id AND c.teacher_id = $1 AND cs.student_id = $2 AND cs.status = 'active'`,
      [teacherId, req.tokenUser.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('m/student leave mentor error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/student/tasks/:id/start : démarre une task (retourne les ids) ─
router.post('/api/m/student/tasks/:id/start', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const lessonId = parseInt(req.params.id, 10);
    const access = await pool.query(
      `SELECT l.id FROM lessons l
       JOIN classroom_students cs ON cs.classroom_id = l.classroom_id
       WHERE l.id = $1 AND cs.student_id = $2 AND cs.status = 'active'`, [lessonId, uid]);
    if (!access.rows.length) return res.status(404).json({ error: 'Task not found' });

    const { rows } = await pool.query('SELECT mot_id FROM lesson_words WHERE lesson_id = $1', [lessonId]);
    const ids = rows.map((r) => r.mot_id);
    if (!ids.length) return res.status(400).json({ error: 'Task has no words' });

    // Ajoute les mots manquants à la collection de l'élève
    await pool.query(
      `INSERT INTO user_mots (user_id, mot_id, meaning_id)
       SELECT $1, m, (SELECT min(meaning_id) FROM lexeme_senses WHERE mot_id = m)
       FROM unnest($2::int[]) AS m
       WHERE EXISTS (SELECT 1 FROM lexeme_senses WHERE mot_id = m)
         AND NOT EXISTS (SELECT 1 FROM user_mots WHERE user_id = $1 AND mot_id = m)
       ON CONFLICT DO NOTHING`,
      [uid, ids]);

    res.json({ success: true, ids, type: 'pinyin' });
  } catch (e) {
    console.error('m/student task start error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/student/tasks/:id/result : enregistre le résultat (côté prof) ─
router.post('/api/m/student/tasks/:id/result', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const lessonId = parseInt(req.params.id, 10);
    const access = await pool.query(
      `SELECT l.id FROM lessons l
       JOIN classroom_students cs ON cs.classroom_id = l.classroom_id
       WHERE l.id = $1 AND cs.student_id = $2 AND cs.status = 'active'`, [lessonId, uid]);
    if (!access.rows.length) return res.status(404).json({ error: 'Task not found' });
    const score = parseInt(req.body?.score, 10);
    const total = parseInt(req.body?.total, 10);
    await pool.query(
      `INSERT INTO lesson_quiz_results (lesson_id, student_id, score, total) VALUES ($1, $2, $3, $4)`,
      [lessonId, uid, Number.isInteger(score) ? score : null, Number.isInteger(total) ? total : null]);
    res.json({ success: true });
  } catch (e) {
    console.error('m/student task result error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/classes/join : rejoindre une classe avec un code ─────────────
router.post('/api/m/classes/join', requireToken, async (req, res) => {
  try {
    const code = (req.body?.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Code required' });
    const { rows } = await pool.query(
      'SELECT id, teacher_id, name FROM classrooms WHERE join_code = $1 AND archived = FALSE', [code]
    );
    if (!rows.length) return res.status(404).json({ error: 'Class not found' });
    const classroom = rows[0];
    if (classroom.teacher_id === req.tokenUser.id) {
      return res.status(400).json({ error: "You're the teacher of this class" });
    }
    await pool.query(
      `INSERT INTO classroom_students (classroom_id, student_id)
       VALUES ($1, $2)
       ON CONFLICT (classroom_id, student_id) DO UPDATE SET status = 'active'`,
      [classroom.id, req.tokenUser.id]
    );
    res.json({ success: true, classroom: { id: classroom.id, name: classroom.name } });
  } catch (e) {
    console.error('m/classes join error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

};
