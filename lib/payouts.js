// ════════════════════════════════════════════════════════════════════════════
//  RAIL B — Phase 3 : reversement escrow au prof (Stripe Connect transfers).
//  Un cours payant terminé (prof présent) déclenche un transfert de sa part
//  (prix × (1 − commission), figés sur le package) vers son compte connecté.
//  Idempotent : lock pending→processing + idempotencyKey Stripe par créneau.
// ════════════════════════════════════════════════════════════════════════════
const { pool } = require('../config/database');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Reverse la part du prof pour UN créneau. Retourne {paid|skipped|error}.
async function payoutSlot(slotId) {
  // Verrou atomique : seul le passage pending→processing gagne (anti double-transfert).
  const lock = await pool.query(
    `UPDATE teacher_slots SET payout_status = 'processing'
       WHERE id = $1 AND payout_status = 'pending' AND package_id IS NOT NULL
       RETURNING package_id, teacher_id`,
    [slotId]);
  if (!lock.rows.length) return { skipped: true, reason: 'not_pending' };
  const { package_id, teacher_id } = lock.rows[0];

  try {
    const pk = await pool.query(
      'SELECT unit_price, commission_rate, currency FROM lesson_packages WHERE id = $1', [package_id]);
    const tk = await pool.query(
      'SELECT stripe_connect_id, connect_payouts_enabled FROM users WHERE id = $1', [teacher_id]);
    const p = pk.rows[0], t = tk.rows[0];

    if (!p || !t || !t.stripe_connect_id || t.connect_payouts_enabled !== true) {
      // Prof pas (ou plus) payable → on repasse en pending pour réessayer plus tard.
      await pool.query("UPDATE teacher_slots SET payout_status = 'pending' WHERE id = $1", [slotId]);
      return { skipped: true, reason: 'teacher_not_payable' };
    }

    const amount = Math.round(Number(p.unit_price) * (1 - Number(p.commission_rate)) * 100);
    if (!(amount > 0)) {
      await pool.query("UPDATE teacher_slots SET payout_status = 'none' WHERE id = $1", [slotId]);
      return { skipped: true, reason: 'zero_amount' };
    }

    const transfer = await stripe.transfers.create({
      amount,
      currency: (p.currency || 'eur').toLowerCase(),
      destination: t.stripe_connect_id,
      metadata: { slotId: String(slotId), packageId: String(package_id), teacherId: String(teacher_id) },
    }, { idempotencyKey: `slot_payout_${slotId}` });

    await pool.query(
      "UPDATE teacher_slots SET payout_status = 'paid', stripe_transfer_id = $2 WHERE id = $1",
      [slotId, transfer.id]);
    return { paid: true, amount, transferId: transfer.id };
  } catch (e) {
    // Échec (solde insuffisant, compte invalide…) → retour en pending pour retry au prochain cron.
    await pool.query("UPDATE teacher_slots SET payout_status = 'pending' WHERE id = $1", [slotId]);
    console.error('[payout] slot', slotId, e.message);
    return { error: e.message };
  }
}

// Traite tous les cours payants terminés (prof présent) en attente de reversement.
async function processDuePayouts(limit = 100) {
  const { rows } = await pool.query(
    `SELECT id FROM teacher_slots
       WHERE package_id IS NOT NULL AND payout_status = 'pending'
         AND status = 'booked' AND reward_given = true AND ends_at < NOW()
       ORDER BY ends_at ASC LIMIT $1`,
    [limit]);
  let paid = 0, failed = 0, skipped = 0;
  for (const s of rows) {
    const r = await payoutSlot(s.id);
    if (r.paid) paid++; else if (r.error) failed++; else skipped++;
  }
  if (rows.length) console.log(`[payouts] ${rows.length} dus → ${paid} payés, ${failed} échoués, ${skipped} ignorés`);
  return { considered: rows.length, paid, failed, skipped };
}

module.exports = { payoutSlot, processDuePayouts };
