const { pool } = require('../config/database');
const { addTransaction } = require('../middleware/index');

// Récompense de parrainage, selon le rôle réel de l'invité.
const REFERRAL_REWARD = { student: 80, teacher: 150 };

// Récompense le parrain UNE seule fois, uniquement quand l'invité est éligible
// (email vérifié) — anti-farming : un faux compte non vérifié ne rapporte rien.
// Idempotent : le flag users.referral_rewarded verrouille tout double-crédit.
// Appelé (a) à l'onboarding si l'invité est déjà vérifié (Google/Apple), et
// (b) à la vérification d'email pour les comptes email/mot de passe.
async function rewardPendingReferral(userId) {
  const me = await pool.query(
    'SELECT role, referred_by, referral_rewarded, email_verified FROM users WHERE id = $1',
    [userId]
  );
  if (!me.rows.length) return;
  const u = me.rows[0];
  if (!u.referred_by || u.referral_rewarded || !u.email_verified) return;

  const reward = REFERRAL_REWARD[u.role] || REFERRAL_REWARD.student;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Verrou atomique : seule la 1re transition FALSE→TRUE crédite le parrain.
    const upd = await client.query(
      `UPDATE users SET referral_rewarded = TRUE
       WHERE id = $1 AND referral_rewarded = FALSE AND referred_by IS NOT NULL`,
      [userId]
    );
    if (upd.rowCount === 1) {
      await addTransaction(client, u.referred_by, reward, 'referral', 'Referral bonus');
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { rewardPendingReferral, REFERRAL_REWARD };
