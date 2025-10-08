const { Pool } = require("pg");
const path = require("path");
const express = require("express");

const app = express();

// Servir le dossier "public"
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// -------------------- Connexion PostgreSQL --------------------
// Render/Neon utilisent DATABASE_URL avec SSL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// -------------------- Initialisation --------------------
(async () => {
  try {
    // Création de la table si elle n'existe pas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mots (
        id SERIAL PRIMARY KEY,
        chinese TEXT NOT NULL,
        english TEXT NOT NULL,
        pinyin TEXT,
        description TEXT
      )
    `);
    console.log("✅ Table 'mots' vérifiée ou créée.");

    // Ajouter quelques mots initiaux si table vide
    const countRes = await pool.query("SELECT COUNT(*) FROM mots");
    if (parseInt(countRes.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO mots (chinese, pinyin, english, description) VALUES
          ('你好', 'ni hao', 'hello', 'greeting'),
          ('谢谢', 'xie xie', 'thank you', 'thanks expression'),
          ('再见', 'zai jian', 'goodbye', 'farewell')
      `);
      console.log("✅ Quelques mots ont été ajoutés à la table.");
    }

    // Test de connexion
    const res = await pool.query('SELECT NOW()');
    console.log('✅ Connection OK ! Current time:', res.rows[0].now);

  } catch (err) {
    console.error("❌ Erreur lors de l'initialisation :", err);
  }
})();

// -------------------- Routes --------------------

// Récupérer un mot aléatoire
app.get("/mot", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM mots ORDER BY RANDOM() LIMIT 1");
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Vérifier la réponse
app.post("/verifier", async (req, res) => {
  const { chinese, answer } = req.body;
  try {
    const { rows } = await pool.query("SELECT * FROM mots WHERE chinese = $1", [chinese]);
    const row = rows[0];
    const correct = row && row.english.toLowerCase() === answer.toLowerCase();
    res.json({ correct, correctAnswer: row ? row.english : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ajouter un mot
app.post("/ajouter", async (req, res) => {
  const { chinese, pinyin, english, description } = req.body;
  try {
    const { rows } = await pool.query("SELECT * FROM mots WHERE chinese = $1", [chinese]);
    if (rows.length > 0)
      return res.json({ success: false, message: "Ce caractère chinois existe déjà !" });

    await pool.query(
      "INSERT INTO mots (chinese, pinyin, english, description) VALUES ($1, $2, $3, $4)",
      [chinese, pinyin, english, description]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lister tous les mots
app.get("/liste", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM mots");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Corriger un mot
app.put("/update/:id", async (req, res) => {
  const { id } = req.params;
  const { chinese, pinyin, english, description } = req.body;
  try {
    await pool.query(
      "UPDATE mots SET chinese=$1, pinyin=$2, english=$3, description=$4 WHERE id=$5",
      [chinese, pinyin, english, description, id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "update failed" });
  }
});

// -------------------- Start server --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
