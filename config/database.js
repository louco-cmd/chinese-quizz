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
    
    console.log("✅ Table 'session' vérifiée ou créée.");

    
    console.log("✅ Tables 'mots' et 'users' vérifiées ou créées.");
  } catch (err) {
    console.error("❌ Erreur lors de l'initialisation :", err);
  }
})();

module.exports = { pool };
