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

    // ── Migration: word_review_enabled sur users ──────────────────────────────
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS word_review_enabled BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log("✅ Colonne 'word_review_enabled' vérifiée ou créée sur 'users'.");

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

    // ════════════════════════════════════════════════════════════════════════
    //  PLATEFORME PROFESSEUR (Phase 1 — modèle de données)
    //  Un prof = un user avec role='teacher'. Les élèves restent des users
    //  normaux, reliés à une classe. Le prof lit leurs données existantes
    //  (user_mots, quiz_history). Tout est additif : ne casse rien.
    // ════════════════════════════════════════════════════════════════════════

    // ── Migration: role sur users ('student' par défaut | 'teacher') ──────────
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS role VARCHAR(10) NOT NULL DEFAULT 'student'
    `);
    console.log("✅ Colonne 'role' vérifiée ou créée sur 'users'.");

    // ── Table classrooms (les classes créées par un prof) ─────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS classrooms (
        id SERIAL PRIMARY KEY,
        teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        join_code VARCHAR(12) UNIQUE NOT NULL,
        archived BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_classrooms_teacher ON classrooms(teacher_id)
    `);
    console.log("✅ Table 'classrooms' vérifiée ou créée.");

    // ── Table classroom_students (élèves inscrits dans une classe) ────────────
    // UNIQUE(classroom_id, student_id) : un élève ne peut rejoindre 2x la même classe.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS classroom_students (
        id SERIAL PRIMARY KEY,
        classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(12) NOT NULL DEFAULT 'active',
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (classroom_id, student_id)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_classroom_students_class ON classroom_students(classroom_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_classroom_students_student ON classroom_students(student_id)
    `);
    console.log("✅ Table 'classroom_students' vérifiée ou créée.");

    // ── Migration: type de classe ('group' | 'private') ───────────────────────
    // Fonctionnellement identique ; sert à l'organisation (groupe = mêmes devoirs).
    await pool.query(`
      ALTER TABLE classrooms
      ADD COLUMN IF NOT EXISTS type VARCHAR(10) NOT NULL DEFAULT 'group'
    `);
    console.log("✅ Colonne 'type' vérifiée ou créée sur 'classrooms'.");

    // ── Migration: annuaire mentors (opt-in) + lien externe ───────────────────
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS mentor_listed BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mentor_link TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mentor_bio TEXT`);
    console.log("✅ Colonnes mentor (listed/link/bio) vérifiées ou créées sur 'users'.");

    // ── Table lessons (notes de cours par classe) ─────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lessons (
        id SERIAL PRIMARY KEY,
        classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        summary TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_lessons_classroom ON lessons(classroom_id)
    `);
    console.log("✅ Table 'lessons' vérifiée ou créée.");

    // ── Table lesson_words (mots à apprendre, reliés au dictionnaire 'mots') ───
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_words (
        id SERIAL PRIMARY KEY,
        lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        mot_id INTEGER NOT NULL REFERENCES mots(id) ON DELETE CASCADE,
        UNIQUE (lesson_id, mot_id)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_lesson_words_lesson ON lesson_words(lesson_id)
    `);
    console.log("✅ Table 'lesson_words' vérifiée ou créée.");

  } catch (err) {
    console.error("❌ Erreur lors de l'initialisation :", err);
  }
})();

module.exports = { pool };
