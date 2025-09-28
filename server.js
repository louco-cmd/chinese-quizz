const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const express = require("express");

const app = express(); // créer l'app avant app.use

// Servir le dossier "public"
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

const db = new sqlite3.Database("./mots.db"); // persistent file

// Create table if it doesn't exist and insert initial words if table is empty
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS mots (
      id INTEGER PRIMARY KEY,
      chinese TEXT,
      english TEXT,
      pinyin TEXT,
      description TEXT
    )
  `);

  // Insert initial words only if table is empty
  db.get("SELECT COUNT(*) as count FROM mots", (err, row) => {
    if (err) console.error(err);
    else if (row.count === 0) {
      db.run(
        "INSERT INTO mots (chinese, english, pinyin, description) VALUES (?, ?, ?, ?)",
        ["你好", "hello", "ni hao", "greeting"]
      );
      db.run(
        "INSERT INTO mots (chinese, english, pinyin, description) VALUES (?, ?, ?, ?)",
        ["谢谢", "thank you", "xie xie", "expression of thanks"]
      );
    }
  });
});

// Route to get a random word
app.get("/mot", (req, res) => {
  db.get("SELECT * FROM mots ORDER BY RANDOM() LIMIT 1", (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row);
  });
});

// Route to verify an answer
app.post("/verifier", (req, res) => {
  const { chinese, answer } = req.body;
  db.get("SELECT * FROM mots WHERE chinese = ?", [chinese], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    const correct = row && row.english.toLowerCase() === answer.toLowerCase();
    res.json({ correct, correctAnswer: row ? row.english : null });
  });
});

// Route to add a new word
app.post('/ajouter', async (req, res) => {
  const { chinese, pinyin, english, description } = req.body;

  // Vérifie si le mot chinois existe déjà
  const existing = await db.get('SELECT * FROM mots WHERE chinese = ?', [chinese]);

  if (existing) {
    return res.json({ success: false, message: 'Ce caractère chinois existe déjà !' });
  }

  // Sinon, insertion
  await db.run(
    'INSERT INTO mots (chinese, pinyin, english, description) VALUES (?, ?, ?, ?)',
    [chinese, pinyin, english, description]
  );

  res.json({ success: true });
});


// Optional: route to list all words
app.get("/liste", (req, res) => {
  db.all("SELECT * FROM mots", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

//corriger un mot
app.put('/update/:id', async (req, res) => {
  const { id } = req.params;
  const { chinese, pinyin, english, description } = req.body;
  try {
    await pool.query(
      'UPDATE mots SET chinese=$1, pinyin=$2, english=$3, description=$4 WHERE id=$5',
      [chinese, pinyin, english, description, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'update failed' });
  }
});


// Start the server
app.listen(3000, () => {
  console.log("✅ Server running on http://localhost:3000");
});
