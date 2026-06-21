const { Pool } = require("pg");

// -------------------- Connexion PostgreSQL --------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// -------------------- Initialisation des tables --------------------
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mots (
        id SERIAL PRIMARY KEY,
        chinese TEXT NOT NULL,
        english TEXT NOT NULL,
        pinyin TEXT,
        description TEXT,
        hsk TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        provider TEXT NOT NULL,
        provider_id TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP

      )
    `);

    // Table quiz_history nécessaire pour les contributions / historique quiz
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiz_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        score INTEGER,
        total_questions INTEGER,
        ratio NUMERIC,
        quiz_type TEXT,
        words_used JSONB,
        date_completed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

       // 🆕 TABLE SESSION OBLIGATOIRE POUR connect-pg-simple
    await pool.query(`
      CREATE TABLE IF NOT EXISTS session (
        sid VARCHAR NOT NULL COLLATE "default",
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL
      )
    `);

      await pool.query(`
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" 
      ON session ("expire")
    `);
    
    // ── Migration: colonne special_guest ──────────────────────────────────────
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS special_guest BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log("✅ Colonne 'special_guest' vérifiée ou créée sur 'users'.");

    // ── Table push_subscriptions (Web Push Notifications) ────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT UNIQUE NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id)
    `);
    console.log("✅ Table 'push_subscriptions' vérifiée ou créée.");

    // ── Migration: quiz_direction + onboarding_done ───────────────────────────
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS quiz_direction VARCHAR(10) NOT NULL DEFAULT 'en→zh'
    `);
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS onboarding_done BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log("✅ Colonnes 'quiz_direction' et 'onboarding_done' vérifiées ou créées.");

    // ── Migration: description_zh sur mots ───────────────────────────────────
    await pool.query(`
      ALTER TABLE mots
      ADD COLUMN IF NOT EXISTS description_zh TEXT
    `);
    console.log("✅ Colonne 'description_zh' vérifiée ou créée sur 'mots'.");

    // ── Migration: ghost_mode sur users ──────────────────────────────────────
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS ghost_mode BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log("✅ Colonne 'ghost_mode' vérifiée ou créée sur 'users'.");

    // ── Migration: notifications_enabled sur users ────────────────────────────
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log("✅ Colonne 'notifications_enabled' vérifiée ou créée sur 'users'.");

    // ── Fix: tous les users sans onboarding = apprennent le chinois (en→zh) ──
    // La colonne a été créée avec DEFAULT 'zh→en' dans une version précédente,
    // ce qui a affecté tous les anciens comptes. On corrige tous sauf ceux
    // qui ont explicitement fait l'onboarding (donc ont choisi leur direction).
    await pool.query(`
      UPDATE users
      SET quiz_direction = 'en→zh'
      WHERE onboarding_done = FALSE
        AND quiz_direction = 'zh→en'
    `);
    console.log("✅ Fix quiz_direction : anciens comptes remis à 'en→zh'.");

    // ── Migration: resync stripe_status depuis plan_name + status ─────────────
    // Corrige les cas où stripe_status est resté 'active' alors que
    // status ou plan_name indiquent que l'abonnement est terminé.
    await pool.query(`
      UPDATE user_subscriptions
      SET stripe_status = status, updated_at = NOW()
      WHERE
        stripe_status = 'active'
        AND (status <> 'active' OR plan_name <> 'premium')
    `);
    console.log("✅ Resync stripe_status / status effectué au démarrage.");

  } catch (err) {
    console.error("❌ Erreur lors de l'initialisation :", err);
  }
})();

module.exports = { pool };
