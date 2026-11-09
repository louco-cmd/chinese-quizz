// ─────────────────────────────────────────────────────────────────────────────
// Helpers créneaux prof liés à la DB (pool). Partagés par routes/mobile/lessons.js
// (côté prof) et routes/mobile/student.js (côté élève : book-trial, slots).
// La math pure de fuseaux vit dans ./teacher-schedule.js.
// ─────────────────────────────────────────────────────────────────────────────
const { pool } = require('../config/database');
const { validTz, pad2, utcToWall } = require('./teacher-schedule');

// Fuseau d'un prof (fallback UTC).
async function teacherTz(teacherId) {
  const r = await pool.query('SELECT timezone FROM users WHERE id = $1', [teacherId]);
  return validTz(r.rows[0]?.timezone) || 'UTC';
}

// Un instant UTC correspond-il à un créneau OUVERT du prof (override ponctuel sinon
// semaine type), évalué dans le fuseau du prof ?
async function slotOpenForTeacher(teacherId, startUtc) {
  const tz = await teacherTz(teacherId);
  const w = utcToWall(startUtc, tz);
  const dayKey = `${w.year}-${pad2(w.month)}-${pad2(w.day)}`;
  const ov = await pool.query('SELECT 1 FROM teacher_date_slots WHERE teacher_id = $1 AND day = $2 LIMIT 1', [teacherId, dayKey]);
  const ok = ov.rows.length
    ? await pool.query('SELECT 1 FROM teacher_date_slots WHERE teacher_id = $1 AND day = $2 AND hour = $3', [teacherId, dayKey, w.hour])
    : await pool.query('SELECT 1 FROM teacher_availability WHERE teacher_id = $1 AND weekday = $2 AND hour = $3', [teacherId, w.weekday, w.hour]);
  return ok.rows.length > 0;
}

// Un élève est-il ACTIVEMENT rattaché à ce prof ? (membre actif d'une de ses classes)
async function studentLinkedToTeacher(studentId, teacherId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM classroom_students cs JOIN classrooms c ON c.id = cs.classroom_id
     WHERE cs.student_id = $1 AND c.teacher_id = $2 AND cs.status = 'active' LIMIT 1`,
    [studentId, teacherId]);
  return rows.length > 0;
}

module.exports = { teacherTz, slotOpenForTeacher, studentLinkedToTeacher };
