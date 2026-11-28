// ════════════════════════════════════════════════════════════════════════════
//  RAIL B — crédits de cours payants (Phase 2). Helpers partagés entre la route
//  d'achat (student) et la gate de réservation (lessons). Mono-devise EUR.
//  Reversement au prof (escrow) = Phase 3 (pas ici).
// ════════════════════════════════════════════════════════════════════════════
const { pool } = require('../config/database');

// Tailles de pack proposées à l'élève + bornes de sécurité serveur.
const PACK_SIZES = [1, 5, 10];
const MAX_CREDITS = 50;
const PACKAGE_VALID_DAYS = 30;

// Un prof est « payant » (réservation gatée sur crédits) ssi payouts Connect
// actifs ET un prix/heure défini. Sinon la réservation reste gratuite (rétro-compat).
async function teacherPaidEnabled(teacherId, client = pool) {
  const { rows } = await client.query(
    'SELECT connect_payouts_enabled, session_price FROM users WHERE id = $1', [teacherId]);
  const u = rows[0];
  return !!u && u.connect_payouts_enabled === true && u.session_price != null && Number(u.session_price) > 0;
}

// Solde de crédits dispo (somme des packages actifs non expirés) pour affichage/gate.
async function creditsBalance(studentId, teacherId, client = pool) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(credits_left), 0)::int AS n
       FROM lesson_packages
      WHERE student_id = $1 AND teacher_id = $2 AND status = 'active'
        AND credits_left > 0 AND expires_at > NOW()`,
    [studentId, teacherId]);
  return rows[0].n;
}

// Consomme 1 crédit (FIFO = expiration la plus proche d'abord), atomique. À appeler
// DANS une transaction. Retourne le package_id consommé, ou null si aucun crédit.
async function consumeCredit(client, studentId, teacherId, slotId) {
  const { rows } = await client.query(
    `UPDATE lesson_packages SET credits_left = credits_left - 1
      WHERE id = (
        SELECT id FROM lesson_packages
         WHERE student_id = $1 AND teacher_id = $2 AND status = 'active'
           AND credits_left > 0 AND expires_at > NOW()
         ORDER BY expires_at ASC
         LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id`,
    [studentId, teacherId]);
  if (!rows.length) return null;
  const pkgId = rows[0].id;
  await client.query(
    `INSERT INTO lesson_credits_ledger (package_id, student_id, delta, reason, slot_id)
     VALUES ($1, $2, -1, 'consume', $3)`,
    [pkgId, studentId, slotId]);
  return pkgId;
}

// Rembourse le crédit d'un slot payant annulé (si le slot était lié à un package).
// `slot` = { package_id, student_id }. No-op si pas de package. À appeler dans une
// transaction (ou avec pool). On ne rend PAS un crédit à un package déjà expiré.
async function refundCreditForSlot(client, slot) {
  if (!slot || !slot.package_id) return false;
  const { rows } = await client.query(
    `UPDATE lesson_packages SET credits_left = credits_left + 1
      WHERE id = $1 AND status = 'active' AND expires_at > NOW()
      RETURNING id`,
    [slot.package_id]);
  if (!rows.length) return false;
  await client.query(
    `INSERT INTO lesson_credits_ledger (package_id, student_id, delta, reason, slot_id)
     VALUES ($1, $2, 1, 'refund', $3)`,
    [slot.package_id, slot.student_id, slot.id || null]);
  return true;
}

module.exports = {
  PACK_SIZES, MAX_CREDITS, PACKAGE_VALID_DAYS,
  teacherPaidEnabled, creditsBalance, consumeCredit, refundCreditForSlot,
};
