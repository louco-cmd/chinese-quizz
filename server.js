const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const express = require("express");

const app = express();

// Servir le dossier "public"
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Base de données persistante
const db = new sqlite3.Database("./mots.db");

// Création de la table si elle n'existe pas
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS mots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chinese TEXT NOT NULL,
      english TEXT NOT NULL,
      pinyin TEXT,
      description TEXT
    )
  `);

  // Ajouter des mots initiaux si table vide
  db.get("SELECT COUNT(*) as count FROM mots", (err, row) => {
    if (err) console.error(err);
    else if (row.count === 0) {
      const motsInitiaux = [
        ["你好","hello","ni hao","greeting"],
        ["谢谢","thank you","xie xie","expression of thanks"]
      ];
      const stmt = db.prepare("INSERT INTO mots (chinese, english, pinyin, description) VALUES (?,?,?,?)");
      motsInitiaux.forEach(m => stmt.run(m));
      stmt.finalize();
    }
  });
});

// Route pour récupérer un mot aléatoire
app.get("/mot", (req,res) => {
  db.get("SELECT * FROM mots ORDER BY RANDOM() LIMIT 1", (err,row)=>{
    if(err) return res.status(500).json({error:err.message});
    res.json(row);
  });
});

// Route pour vérifier une réponse
app.post("/verifier", (req,res)=>{
  const {chinese, answer} = req.body;
  db.get("SELECT * FROM mots WHERE chinese = ?", [chinese], (err,row)=>{
    if(err) return res.status(500).json({error:err.message});
    const correct = row && row.english.toLowerCase() === answer.toLowerCase();
    res.json({correct, correctAnswer: row ? row.english : null});
  });
});

// Route pour ajouter un mot
app.post("/ajouter", (req,res)=>{
  const {chinese,pinyin,english,description} = req.body;

  // Vérifier si le mot existe déjà
  db.get("SELECT * FROM mots WHERE chinese = ?", [chinese], (err,row)=>{
    if(err) return res.status(500).json({error:err.message});
    if(row) return res.json({success:false,message:"Ce caractère chinois existe déjà !"});

    // Sinon, insérer
    db.run(
      "INSERT INTO mots (chinese,pinyin,english,description) VALUES (?,?,?,?)",
      [chinese,pinyin,english,description],
      function(err){
        if(err) return res.status(500).json({error:err.message});
        res.json({success:true});
      }
    );
  });
});

// Route pour lister tous les mots
app.get("/liste", (req,res)=>{
  db.all("SELECT * FROM mots", (err,rows)=>{
    if(err) return res.status(500).json({error:err.message});
    res.json(rows);
  });
});

// Route pour corriger un mot
app.put("/update/:id", (req,res)=>{
  const {id} = req.params;
  const {chinese,pinyin,english,description} = req.body;
  db.run(
    "UPDATE mots SET chinese=?, pinyin=?, english=?, description=? WHERE id=?",
    [chinese,pinyin,english,description,id],
    function(err){
      if(err) return res.status(500).json({error:"update failed"});
      res.json({success:true});
    }
  );
});

// Start server avec port dynamique
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`✅ Server running on port ${PORT}`));

