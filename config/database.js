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
        pinyin TEXT,
        hsk TEXT
      )
      -- NB : plus de colonne english (modele concept : la traduction est un
      -- lexeme frere, resolue par mot_tr) ni description (note PERSO portee par
      -- user_mots.description). lang/meaning_id ajoutes par la migration
      -- multilingue. Voir scripts/refacto-english-*.sql et refacto-description-*.sql.
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

    // ── Migration: description PAR-USER (user_mots.description) ───────────────
    // La description devient une note PERSO : on l'ajoute à user_mots, on copie
    // l'existant de mots.description (hors marqueurs internes) vers chaque
    // possesseur, puis on retire les colonnes de mots. Idempotent & prod-safe :
    // la copie ne s'exécute que tant que mots.description existe encore.
    await pool.query(`ALTER TABLE user_mots ADD COLUMN IF NOT EXISTS description TEXT`);
    const hasMotsDesc = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name='mots' AND column_name='description' LIMIT 1`);
    if (hasMotsDesc.rows.length) {
      await pool.query(`
        UPDATE user_mots um
        SET description = m.description
        FROM mots m
        WHERE m.id = um.mot_id
          AND COALESCE(m.description,'') NOT IN ('','auto:gloss','user:gloss','auto:gloss-promote')
          AND (um.description IS NULL OR um.description = '')`);
      await pool.query(`ALTER TABLE mots DROP COLUMN IF EXISTS description`);
    }
    await pool.query(`ALTER TABLE mots DROP COLUMN IF EXISTS description_zh`);
    console.log("✅ description PAR-USER (user_mots.description) migrée ; colonnes mots retirées.");

    // ── Migration: retirer toute contrainte/index UNIQUE sur mots(chinese) ────
    // "Éditer avant de capturer" (forceNew) crée une entrée PERSONNALISÉE même si
    // le chinois existe déjà → un unique(chinese) hérité du schéma d'origine faisait
    // échouer l'insert (500). Tout le code tolère déjà les doublons (DISTINCT ON).
    await pool.query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT con.conname
          FROM pg_constraint con
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
          WHERE con.conrelid = 'mots'::regclass AND con.contype = 'u'
            AND a.attname = 'chinese' AND array_length(con.conkey, 1) = 1
        LOOP
          EXECUTE format('ALTER TABLE mots DROP CONSTRAINT %I', r.conname);
        END LOOP;
        FOR r IN
          SELECT c.relname AS iname
          FROM pg_index i
          JOIN pg_class c ON c.oid = i.indexrelid
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = 'mots'::regclass AND i.indisunique
            AND a.attname = 'chinese' AND array_length(i.indkey, 1) = 1
        LOOP
          EXECUTE format('DROP INDEX IF EXISTS %I', r.iname);
        END LOOP;
      END $$;
    `);
    console.log("✅ Contrainte UNIQUE sur mots(chinese) retirée (autorise les copies personnalisées).");

    // ── Migration: score_reading sur user_mots (mode quiz "lecture" char→pinyin) ──
    await pool.query(`ALTER TABLE user_mots ADD COLUMN IF NOT EXISTS score_reading INTEGER DEFAULT 0`);
    console.log("✅ Colonne 'score_reading' vérifiée ou créée sur 'user_mots'.");

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

    // ── Sign in with Apple : `sub` Apple stable (email peut être un relais privé) ──
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id TEXT`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_apple_id_key ON users(apple_id) WHERE apple_id IS NOT NULL`);
    console.log("✅ Colonne Sign in with Apple (apple_id) vérifiée.");

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

    // ── Migration : langue du pack (cours multilingue) ─────────────────────────
    // Un pack enseigne UNE langue. Le store ne montre à l'apprenant que les packs
    // de sa learning_lang. Backfill depuis la langue majoritaire des mots du pack.
    await pool.query(`ALTER TABLE word_packs ADD COLUMN IF NOT EXISTS lang VARCHAR(8) NOT NULL DEFAULT 'zh'`);
    await pool.query(`
      UPDATE word_packs wp SET lang = sub.lang FROM (
        SELECT i.pack_id, mode() WITHIN GROUP (ORDER BY m.lang) AS lang
        FROM word_pack_items i JOIN mots m ON m.id = i.mot_id
        GROUP BY i.pack_id
      ) sub
      WHERE sub.pack_id = wp.id AND sub.lang IS NOT NULL AND wp.lang IS DISTINCT FROM sub.lang
    `);
    console.log("✅ Colonne 'lang' sur word_packs vérifiée + backfill.");

    // ── Migration : langue de BASE du pack (paire de langues) ──────────────────
    // Un pack couvre une PAIRE (lang = langue apprise du créateur, native_lang =
    // sa langue d'interface). Le store ne le montre qu'aux utilisateurs dont la
    // direction correspond à cette paire (dans un sens OU l'autre). Backfill : les
    // packs existants sont la paire zh↔en → native_lang 'en' par défaut.
    await pool.query(`ALTER TABLE word_packs ADD COLUMN IF NOT EXISTS native_lang VARCHAR(8)`);
    await pool.query(`UPDATE word_packs SET native_lang = 'en' WHERE native_lang IS NULL`);
    await pool.query(`ALTER TABLE word_packs ALTER COLUMN native_lang SET DEFAULT 'en'`);
    console.log("✅ Colonne 'native_lang' sur word_packs vérifiée + backfill.");

    // ── Migration : modèle concept many-to-many (lexeme_senses) + mot_tr ───────
    // Un lexème peut appartenir à plusieurs sens → dédup des lexèmes tout en
    // gardant les concepts fidèles. Guardé : ne s'exécute que si `meanings` existe.
    try {
      const hasMeanings = await pool.query("SELECT to_regclass('public.meanings') AS t");
      if (hasMeanings.rows[0].t) {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS lexeme_senses (
            mot_id     integer NOT NULL REFERENCES mots(id)     ON DELETE CASCADE,
            meaning_id integer NOT NULL REFERENCES meanings(id) ON DELETE CASCADE,
            PRIMARY KEY (mot_id, meaning_id)
          )`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_lexeme_senses_meaning ON lexeme_senses(meaning_id)`);
        // Backfill une seule fois (si la table est vide) depuis le lien 1:1.
        await pool.query(`
          INSERT INTO lexeme_senses (mot_id, meaning_id)
          SELECT id, meaning_id FROM mots
          WHERE meaning_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lexeme_senses)
          ON CONFLICT DO NOTHING`);
        // Auto-réparation (à CHAQUE boot) : un mot inséré avec seulement
        // mots.meaning_id (ex. crawler / insert manuel) mais SANS ligne
        // lexeme_senses est invisible partout (search/collection/mot_tr font un
        // JOIN lexeme_senses). On recrée le lien manquant depuis meaning_id.
        // Idempotent : ne touche que les orphelins.
        const relinked = await pool.query(`
          INSERT INTO lexeme_senses (mot_id, meaning_id)
          SELECT id, meaning_id FROM mots m
          WHERE m.meaning_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM lexeme_senses ls WHERE ls.mot_id = m.id)
          ON CONFLICT DO NOTHING`);
        if (relinked.rowCount) console.log(`🔧 lexeme_senses : ${relinked.rowCount} mot(s) orphelin(s) re-liés.`);
        // Trigger réactif : à l'insertion de mots (crawler bulk compris), crée le
        // lien lexeme_senses depuis meaning_id → un mot ajouté est immédiatement
        // visible en recherche/collection SANS redémarrage. Statement-level +
        // REFERENCING NEW TABLE (efficace sur insert de masse), comme le trigger
        // d'enregistrement des langues.
        await pool.query(`
          CREATE OR REPLACE FUNCTION link_mot_senses() RETURNS trigger AS $lm$
          BEGIN
            INSERT INTO lexeme_senses (mot_id, meaning_id)
            SELECT id, meaning_id FROM newrows WHERE meaning_id IS NOT NULL
            ON CONFLICT DO NOTHING;
            RETURN NULL;
          END; $lm$ LANGUAGE plpgsql`);
        await pool.query(`DROP TRIGGER IF EXISTS trg_link_mot_senses ON mots`);
        await pool.query(`
          CREATE TRIGGER trg_link_mot_senses AFTER INSERT ON mots
          REFERENCING NEW TABLE AS newrows FOR EACH STATEMENT
          EXECUTE FUNCTION link_mot_senses()`);
        console.log("✅ Trigger lexeme_senses (auto-lien meaning_id) vérifié.");
        // Invariant : un créateur possède les concepts de SES packs UNIQUEMENT dans
        // la langue du CONTENU du pack (wp.lang = la langue apprise du pack) — jamais
        // dans la langue de traduction (wp.native_lang). Sinon, sur des parcours
        // miroirs (fr←en ET en←fr), les traductions d'un pack fuiteraient dans le
        // parcours de l'autre langue. La réciprocité pour les apprenants de l'autre
        // langue passe par l'ACHAT (qui résout vers la langue de l'acheteur), pas par
        // la possession du créateur. Parcours hermétiques. Idempotent.
        try {
          const heal = await pool.query(`
            INSERT INTO user_mots (user_id, mot_id, meaning_id, score)
            SELECT DISTINCT wp.creator_id, lx.id, lp.meaning_id, 0
            FROM word_packs wp
            JOIN word_pack_items wpi ON wpi.pack_id = wp.id
            JOIN lexeme_senses lp ON lp.mot_id = wpi.mot_id
            JOIN lexeme_senses ll ON ll.meaning_id = lp.meaning_id
            JOIN mots lx ON lx.id = ll.mot_id AND lx.lang = wp.lang
            WHERE wp.creator_id IS NOT NULL
            ON CONFLICT DO NOTHING`);
          if (heal.rowCount) console.log(`🔧 collections créateurs : ${heal.rowCount} possession(s) de pack rétablie(s).`);
        } catch (e) { console.error('creator-pack heal:', e.message); }
        // Anti-fuite : retire les possessions JAMAIS étudiées (score 0, nb_quiz 0)
        // d'un concept présent dans un pack de l'utilisateur, mais dans une langue
        // qui n'est la langue de CONTENU (wp.lang) d'AUCUN de ses packs contenant ce
        // concept — càd les traductions fuitées par l'ancien backfill (qui accordait
        // aussi wp.native_lang). Sûr : ne touche aucun mot travaillé, ni un mot
        // légitimement possédé comme contenu d'un autre pack, ni un mot capturé/appris.
        try {
          const leak = await pool.query(`
            DELETE FROM user_mots um USING mots m
            WHERE um.mot_id = m.id
              AND COALESCE(um.score,0) = 0 AND COALESCE(um.nb_quiz,0) = 0
              AND EXISTS (
                SELECT 1 FROM word_packs wp JOIN word_pack_items wpi ON wpi.pack_id = wp.id
                JOIN lexeme_senses lp ON lp.mot_id = wpi.mot_id
                WHERE wp.creator_id = um.user_id AND lp.meaning_id = um.meaning_id
              )
              AND NOT EXISTS (
                SELECT 1 FROM word_packs wp JOIN word_pack_items wpi ON wpi.pack_id = wp.id
                JOIN lexeme_senses lp ON lp.mot_id = wpi.mot_id
                WHERE wp.creator_id = um.user_id AND lp.meaning_id = um.meaning_id
                  AND m.lang = wp.lang
              )`);
          if (leak.rowCount) console.log(`🔧 anti-fuite sessions : ${leak.rowCount} possession(s) fuitée(s) retirée(s).`);
        } catch (e) { console.error('session-leak cleanup:', e.message); }
        await pool.query(`
          CREATE OR REPLACE FUNCTION mot_tr(p_mot_id int, p_native text) RETURNS text
          LANGUAGE sql STABLE AS $fn$
            SELECT string_agg(DISTINCT tr.chinese, ' / ' ORDER BY tr.chinese)
            FROM lexeme_senses a
            JOIN lexeme_senses b ON b.meaning_id = a.meaning_id
            JOIN mots tr ON tr.id = b.mot_id
            WHERE a.mot_id = p_mot_id AND tr.lang = p_native AND tr.id <> p_mot_id
          $fn$`);
        console.log("✅ lexeme_senses (M2M) + mot_tr vérifiés.");

        // Possession PAR-SENS : user_mots.meaning_id + PK à 3 colonnes + mot_tr_sense.
        await pool.query(`ALTER TABLE user_mots ADD COLUMN IF NOT EXISTS meaning_id integer REFERENCES meanings(id)`);
        await pool.query(`
          UPDATE user_mots um
          SET meaning_id = (SELECT min(ls.meaning_id) FROM lexeme_senses ls WHERE ls.mot_id = um.mot_id)
          WHERE um.meaning_id IS NULL
            AND EXISTS (SELECT 1 FROM lexeme_senses ls WHERE ls.mot_id = um.mot_id)`);
        // Bascule la PK vers (user_id, mot_id, meaning_id) une fois meaning_id peuplé.
        const pk = await pool.query(`
          SELECT string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
          WHERE tc.table_name = 'user_mots' AND tc.constraint_type = 'PRIMARY KEY'`);
        if (pk.rows[0].cols === 'user_id,mot_id'
            && !(await pool.query(`SELECT 1 FROM user_mots WHERE meaning_id IS NULL LIMIT 1`)).rows.length) {
          await pool.query(`ALTER TABLE user_mots ALTER COLUMN meaning_id SET NOT NULL`);
          await pool.query(`ALTER TABLE user_mots DROP CONSTRAINT user_mots_pkey`);
          await pool.query(`ALTER TABLE user_mots ADD PRIMARY KEY (user_id, mot_id, meaning_id)`);
        }
        await pool.query(`
          CREATE OR REPLACE FUNCTION mot_tr_sense(p_mot_id int, p_meaning int, p_native text) RETURNS text
          LANGUAGE sql STABLE AS $fn$
            SELECT string_agg(DISTINCT tr.chinese, ' / ' ORDER BY tr.chinese)
            FROM lexeme_senses b JOIN mots tr ON tr.id = b.mot_id
            WHERE b.meaning_id = p_meaning AND tr.lang = p_native AND tr.id <> p_mot_id
          $fn$`);
        console.log("✅ user_mots.meaning_id (par-sens) + mot_tr_sense vérifiés.");
      }
    } catch (e) { console.error('lexeme_senses migration:', e.message); }

    // ── Learning paths (parcours d'apprentissage multi-langues) ────────────────
    // Un user peut avoir plusieurs parcours (apprendre zh ET fr), chacun sa
    // collection (déjà scindée par mots.lang = learning_lang). Le parcours ACTIF
    // = celui dont learning_lang == users.learning_lang (dérivé, pas de colonne
    // active_path_id). UNIQUE(user_id, learning_lang) : un parcours par langue cible.
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS learning_paths (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          learning_lang VARCHAR(8) NOT NULL,
          native_lang VARCHAR(8) NOT NULL,
          title TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (user_id, learning_lang)
        )
      `);
      // Backfill : un parcours par défaut depuis la paire courante de chaque user.
      await pool.query(`
        INSERT INTO learning_paths (user_id, learning_lang, native_lang)
        SELECT id, COALESCE(learning_lang, 'zh'), COALESCE(native_lang, 'en')
        FROM users
        WHERE learning_lang IS NOT NULL
        ON CONFLICT (user_id, learning_lang) DO NOTHING
      `);
      // Pointeur du parcours ACTIF : learning_paths devient la SOURCE DE VÉRITÉ,
      // users.(learning_lang, native_lang, interface_lang, quiz_direction) = MIROIR.
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS active_path_id INTEGER REFERENCES learning_paths(id)`);
      // Désigne l'actif : le parcours qui matche la paire courante, sinon le plus
      // ancien (couvre les users mono-parcours dont users.* était erroné).
      await pool.query(`
        UPDATE users u SET active_path_id = COALESCE(
          (SELECT lp.id FROM learning_paths lp WHERE lp.user_id = u.id AND lp.learning_lang = u.learning_lang ORDER BY lp.id LIMIT 1),
          (SELECT lp.id FROM learning_paths lp WHERE lp.user_id = u.id ORDER BY lp.id LIMIT 1)
        ) WHERE u.active_path_id IS NULL
      `);
      // Resynchronise le miroir users.* DEPUIS le parcours actif (vérité). Corrige
      // les contradictions (ex. données learning_paths mises à jour à la main).
      await pool.query(`
        UPDATE users u
        SET learning_lang = lp.learning_lang, native_lang = lp.native_lang,
            interface_lang = lp.native_lang,
            quiz_direction = CASE WHEN lp.learning_lang = 'zh' THEN 'en→zh' ELSE 'zh→en' END
        FROM learning_paths lp
        WHERE lp.id = u.active_path_id
          AND (u.learning_lang IS DISTINCT FROM lp.learning_lang
            OR u.native_lang IS DISTINCT FROM lp.native_lang)
      `);
      console.log("✅ Table 'learning_paths' + active_path_id + resync miroir users.* vérifiés.");

      // Stats PAR PARCOURS : quiz_history et duels gagnent une langue (celle du
      // cours au moment de l'activité) pour scoper les compteurs du compte. Tout
      // l'historique d'avant le multi-cours était du chinois → backfill 'zh'.
      await pool.query(`ALTER TABLE quiz_history ADD COLUMN IF NOT EXISTS lang varchar(8)`);
      await pool.query(`ALTER TABLE duels ADD COLUMN IF NOT EXISTS lang varchar(8)`);
      await pool.query(`UPDATE quiz_history SET lang = 'zh' WHERE lang IS NULL`);
      await pool.query(`UPDATE duels SET lang = 'zh' WHERE lang IS NULL`);
      console.log("✅ quiz_history.lang + duels.lang (stats par parcours) vérifiés.");
    } catch (e) { console.error('learning_paths migration:', e.message); }

    // ── Registre des langues + LISTENER d'auto-enregistrement ──────────────────
    // `languages` = source de vérité des langues apprenables (métadonnées + flag).
    // Un TRIGGER sur `mots` y insère automatiquement tout nouveau code langue dès
    // qu'un mot de cette langue est inséré (ex. le crawler ajoute l'espagnol) → le
    // front, qui lit /api/m/languages, devient réactif sans redéploiement.
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS languages (
          code VARCHAR(8) PRIMARY KEY,
          name TEXT,
          endonym TEXT,
          has_pinyin BOOLEAN DEFAULT FALSE,
          tts VARCHAR(16),
          learnable BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      // Métadonnées des langues connues (l'espagnol est prêt : il apparaîtra tout
      // seul dès qu'il aura du contenu). ON CONFLICT DO NOTHING → ne réécrit pas
      // d'éventuelles retouches manuelles.
      await pool.query(`
        INSERT INTO languages (code, name, endonym, has_pinyin, tts) VALUES
          ('zh','Chinese','中文',TRUE,'zh-CN'),
          ('en','English','English',FALSE,'en-US'),
          ('fr','French','Français',FALSE,'fr-FR'),
          ('es','Spanish','Español',FALSE,'es-ES'),
          ('de','German','Deutsch',FALSE,'de-DE'),
          ('it','Italian','Italiano',FALSE,'it-IT'),
          ('pt','Portuguese','Português',FALSE,'pt-PT'),
          ('ja','Japanese','日本語',FALSE,'ja-JP'),
          ('ko','Korean','한국어',FALSE,'ko-KR'),
          ('ru','Russian','Русский',FALSE,'ru-RU')
        ON CONFLICT (code) DO NOTHING
      `);
      // Backfill : tout code déjà présent dans mots et pas encore enregistré.
      await pool.query(`
        INSERT INTO languages (code) SELECT DISTINCT lang FROM mots WHERE lang IS NOT NULL
        ON CONFLICT (code) DO NOTHING
      `);
      // Le listener : trigger AFTER INSERT (niveau STATEMENT, table de transition →
      // efficace même sur les inserts en masse du crawler) qui enregistre les
      // nouveaux codes langue automatiquement.
      await pool.query(`
        CREATE OR REPLACE FUNCTION register_languages() RETURNS trigger AS $rl$
        BEGIN
          INSERT INTO languages (code)
          SELECT DISTINCT lang FROM newrows WHERE lang IS NOT NULL
          ON CONFLICT (code) DO NOTHING;
          RETURN NULL;
        END;
        $rl$ LANGUAGE plpgsql
      `);
      await pool.query(`DROP TRIGGER IF EXISTS trg_register_languages ON mots`);
      await pool.query(`
        CREATE TRIGGER trg_register_languages
          AFTER INSERT ON mots
          REFERENCING NEW TABLE AS newrows
          FOR EACH STATEMENT EXECUTE FUNCTION register_languages()
      `);
      console.log("✅ Table 'languages' + trigger d'auto-enregistrement vérifiés.");
    } catch (e) { console.error('languages registry migration:', e.message); }

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
    // Avatar : picto choisi (nom d'icône Ionicons) + couleur de fond (hex).
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_icon TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_color TEXT`);
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

    // Réconciliation des packs officiels HSK (idempotente).
    try {
      const r = await reconcileHskPacks();
      console.log(`✅ JiaStore réconcilié (packs HSK 1→6) :`, r.counts.join(', '));
    } catch (e) { console.error('JiaStore reconcile failed:', e.message); }

    // Backfill (idempotent) : synchronise les acheteurs avec l'état actuel de
    // chaque pack acheté. Rattrape les packs édités AVANT l'ajout de la
    // propagation à l'édition. Le NOT EXISTS rend les boots suivants sans effet.
    try {
      const bf = await pool.query(
        `INSERT INTO user_mots (user_id, mot_id, score, nb_quiz, nb_correct, last_seen)
         SELECT pp.buyer_id, wpi.mot_id, 0, 0, 0, NULL
         FROM pack_purchases pp
         JOIN word_pack_items wpi ON wpi.pack_id = pp.pack_id
         WHERE NOT EXISTS (SELECT 1 FROM user_mots um WHERE um.user_id = pp.buyer_id AND um.mot_id = wpi.mot_id)`
      );
      console.log(`✅ Backfill mises à jour de packs → acheteurs : ${bf.rowCount} mot(s) synchronisé(s).`);
    } catch (e) { console.error('Pack updates backfill failed:', e.message); }

  } catch (err) {
    console.error("❌ Erreur lors de l'initialisation :", err);
  }
})();

// Réconciliation des packs officiels HSK (idempotente, appelable à la demande).
//  - retire les anciens packs de démo seedés (préserve les packs de vrais users) ;
//  - garantit/renomme les 6 packs HSK 1→6 et synchronise leur prix ;
//  - RE-SYNCHRONISE leurs mots : ajoute les nouveaux mots du niveau ET retire
//    ceux qui n'en font plus partie (résilient aux changements de la table mots).
//    `hsk::text` pour être agnostique au type (int ou text). Renvoie { counts }.
async function reconcileHskPacks() {
  await pool.query(`DELETE FROM word_packs WHERE is_official = FALSE AND creator_id IS NULL`);
  const HSK_PRICE = { 1: 180, 2: 380, 3: 600, 4: 800, 5: 1000, 6: 1200 };
  const counts = [];
  for (let lvl = 1; lvl <= 6; lvl++) {
    const cover = `hsk${lvl}`;
    const ex = await pool.query(`SELECT id FROM word_packs WHERE cover_key = $1 AND is_official = TRUE LIMIT 1`, [cover]);
    let packId;
    if (ex.rows.length) packId = ex.rows[0].id;
    else {
      const ins = await pool.query(
        `INSERT INTO word_packs (creator_name, title, description, price, cover_key, is_official)
         VALUES ('JiaStore', $1, $2, $3, $4, TRUE) RETURNING id`,
        [`HSK ${lvl} Pack`, `Essential vocabulary from HSK level ${lvl}.`, HSK_PRICE[lvl], cover]);
      packId = ins.rows[0].id;
    }
    await pool.query(`UPDATE word_packs SET price = $1 WHERE id = $2`, [HSK_PRICE[lvl], packId]);
    // Ajoute les mots du niveau absents du pack…
    await pool.query(
      `INSERT INTO word_pack_items (pack_id, mot_id)
       SELECT $1, id FROM mots WHERE hsk::text = $2 ON CONFLICT DO NOTHING`, [packId, String(lvl)]);
    // …et retire les items qui ne correspondent plus au niveau (reclassés / hors niveau).
    await pool.query(
      `DELETE FROM word_pack_items wpi USING mots m
       WHERE wpi.pack_id = $1 AND wpi.mot_id = m.id AND m.hsk::text IS DISTINCT FROM $2`, [packId, String(lvl)]);
    // …et nettoie les items dont le mot a disparu.
    await pool.query(
      `DELETE FROM word_pack_items wpi WHERE wpi.pack_id = $1
         AND NOT EXISTS (SELECT 1 FROM mots m WHERE m.id = wpi.mot_id)`, [packId]);
    const c = await pool.query(`SELECT COUNT(*)::int AS n FROM word_pack_items WHERE pack_id = $1`, [packId]);
    counts.push(`HSK${lvl}=${c.rows[0].n}`);
  }
  return { counts };
}

module.exports = { pool, reconcileHskPacks };
