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

    // ── Migration: has_seen_tutorial (aiguillage du tutoriel) ─────────────────
    // Utilisée par le web (server.js) et l'app mobile (routes/mobile.js) ;
    // ajoutée ici pour garantir sa présence sur toute base (dev incluse).
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS has_seen_tutorial BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log("✅ Colonne 'has_seen_tutorial' vérifiée ou créée sur 'users'.");

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

    // ── Migration: interface_lang (langue de l'UI, DÉCOUPLÉE de la direction) ──
    // 'en' | 'zh'. Découple la langue de l'interface de ce qu'on apprend.
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS interface_lang VARCHAR(5)
    `);
    // Backfill : dérive la langue UI de la direction pour les comptes existants
    // (préserve le comportement actuel). Ne touche que les NULL → n'écrase jamais
    // un choix explicite fait ensuite dans l'onboarding/les réglages.
    await pool.query(`
      UPDATE users
      SET interface_lang = CASE WHEN quiz_direction = 'zh→en' THEN 'zh' ELSE 'en' END
      WHERE interface_lang IS NULL
    `);
    console.log("✅ Colonne 'interface_lang' vérifiée + backfill.");

    // ⚠️ SUPPRIMÉ : ancienne migration "resync stripe_status = status" au démarrage.
    // Elle écrasait stripe_status (la source de vérité, alimentée par les webhooks
    // Stripe) avec la colonne `status`, ce qui annulait de vrais abonnements actifs
    // quand une seule colonne était temporairement désalignée. Ne pas réintroduire :
    // la cohérence est garantie à l'écriture (webhook + welcome_page).

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

    // ── Table lesson_quiz_results : quiz passés par les élèves sur une task ────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_quiz_results (
        id SERIAL PRIMARY KEY,
        lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        score INTEGER,
        total INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_lqr_lesson ON lesson_quiz_results(lesson_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_lqr_student ON lesson_quiz_results(student_id)`);
    console.log("✅ Table 'lesson_quiz_results' vérifiée ou créée.");

    // ── Migration: profil professeur (annuaire mentor) ────────────────────────
    // (mentor_listed / mentor_bio / mentor_link existent déjà)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS years_experience INT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS languages_spoken TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mentor_links JSONB NOT NULL DEFAULT '[]'::jsonb`);
    // Langues enseignées (liste, ex "Chinese, English") + prix d'une séance
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS teaching_languages TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS session_price NUMERIC(8,2)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS session_currency VARCHAR(3) DEFAULT 'EUR'`);
    console.log("✅ Colonnes profil prof (years_experience/languages_spoken/mentor_links/teaching_languages/session_price) vérifiées.");

    // ── Migration: parrainage (referral) ──────────────────────────────────────
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(12)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_key ON users(referral_code) WHERE referral_code IS NOT NULL`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_rewarded BOOLEAN NOT NULL DEFAULT FALSE`);
    console.log("✅ Colonnes parrainage (referral_code/referred_by/referral_rewarded) vérifiées.");

    // ── JiaStore : marketplace de packs de mots ───────────────────────────────
    // word_packs = packs vendables ; word_pack_items = mots du pack ;
    // pack_purchases = achats (empêche le rachat, trace les ventes).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS word_packs (
        id SERIAL PRIMARY KEY,
        creator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        creator_name TEXT,
        title TEXT NOT NULL,
        description TEXT,
        price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
        cover_key TEXT,
        is_official BOOLEAN NOT NULL DEFAULT FALSE,
        published BOOLEAN NOT NULL DEFAULT TRUE,
        sales_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS word_pack_items (
        pack_id INTEGER NOT NULL REFERENCES word_packs(id) ON DELETE CASCADE,
        mot_id INTEGER NOT NULL REFERENCES mots(id) ON DELETE CASCADE,
        PRIMARY KEY (pack_id, mot_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pack_purchases (
        id SERIAL PRIMARY KEY,
        pack_id INTEGER NOT NULL REFERENCES word_packs(id) ON DELETE CASCADE,
        buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        price_paid INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (pack_id, buyer_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_word_packs_published ON word_packs(published)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pack_items_pack ON word_pack_items(pack_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pack_purchases_buyer ON pack_purchases(buyer_id)`);
    console.log("✅ Tables JiaStore (word_packs/word_pack_items/pack_purchases) vérifiées.");

    // ── Red envelopes (虹包) : virements de coins entre utilisateurs ───────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS red_envelopes (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount INTEGER NOT NULL CHECK (amount > 0),
        message TEXT,
        seen BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_red_env_recipient_unseen ON red_envelopes(recipient_id) WHERE seen = FALSE`);
    console.log("✅ Table 'red_envelopes' vérifiée.");

    // ── Notifications in-app (centre 🔔) ──────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        data JSONB,
        read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC)`);
    // Relance email "long time no see" : dernière relance envoyée (anti-spam).
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reengage_emailed_at TIMESTAMP`);
    // Abonnement premium via RevenueCat (Play Billing / StoreKit) — piloté par webhook.
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS rc_expires_at TIMESTAMP`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS rc_will_renew BOOLEAN`);
    // Token Expo Push (notifications natives Android/iOS).
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS expo_push_token TEXT`);
    console.log("✅ Table 'notifications' + reengage_emailed_at vérifiées.");

    // Index de perf sur les tables chaudes filtrées par user (page account, profil,
    // stats, contributions). Sans eux ces requêtes font des scans séquentiels qui
    // ralentissent à mesure que les données de tous les users grossissent.
    // try/catch : ces tables legacy peuvent être absentes sur une base de dev neuve.
    try {
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_mots_user ON user_mots(user_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_quiz_history_user_date ON quiz_history(user_id, date_completed DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_duels_challenger ON duels(challenger_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_duels_opponent ON duels(opponent_id)`);
      console.log('✅ Index de perf (user_mots/quiz_history/duels) vérifiés.');
    } catch (e) {
      console.warn('⚠️ Index de perf non créés (table absente ?) :', e.message);
    }

    // Réconciliation des packs officiels HSK (idempotente, à chaque démarrage).
    // 1) Retire les anciens packs de démo seedés (is_official=false ET créateur
    //    NULL) — préserve les packs créés par de vrais users (creator_id non NULL).
    // 2) Garantit les 6 packs HSK 1→6 ; les niveaux sans mots en base restent
    //    "Soon available" (word_count 0) et se remplissent automatiquement dès
    //    que des mots de ce niveau existent (au prochain boot).
    try {
      await pool.query(`DELETE FROM word_packs WHERE is_official = FALSE AND creator_id IS NULL`);
      const HSK_PRICE = { 1: 180, 2: 380, 3: 600, 4: 800, 5: 1000, 6: 1200 };
      for (let lvl = 1; lvl <= 6; lvl++) {
        const cover = `hsk${lvl}`;
        const ex = await pool.query(`SELECT id FROM word_packs WHERE cover_key = $1 AND is_official = TRUE LIMIT 1`, [cover]);
        let packId;
        if (ex.rows.length) {
          packId = ex.rows[0].id;
        } else {
          const ins = await pool.query(
            `INSERT INTO word_packs (creator_name, title, description, price, cover_key, is_official)
             VALUES ('JiaStore', $1, $2, $3, $4, TRUE) RETURNING id`,
            [`HSK ${lvl} Pack`, `Essential vocabulary from HSK level ${lvl}.`, HSK_PRICE[lvl], cover]);
          packId = ins.rows[0].id;
        }
        // HSK_PRICE fait autorité : synchronise le prix des packs existants.
        await pool.query(`UPDATE word_packs SET price = $1 WHERE id = $2`, [HSK_PRICE[lvl], packId]);
        await pool.query(
          `INSERT INTO word_pack_items (pack_id, mot_id)
           SELECT $1, id FROM mots WHERE hsk = $2 ON CONFLICT DO NOTHING`, [packId, String(lvl)]);
      }
      console.log("✅ JiaStore réconcilié (packs HSK 1→6, démos retirées).");
    } catch (e) { console.error('JiaStore reconcile failed:', e.message); }

  } catch (err) {
    console.error("❌ Erreur lors de l'initialisation :", err);
  }
})();

module.exports = { pool };
