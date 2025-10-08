const { Pool } = require("pg");
const path = require("path");
const express = require("express");
const passport = require("passport");
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const app = express();

// -------------------- Connexion PostgreSQL --------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// -------------------- Configuration Express --------------------
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// -------------------- Session PostgreSQL --------------------
app.use(session({
  store: new pgSession({ pool }),
  secret: "keyboard cat",
  resave: false,
  saveUninitialized: false,
}));
app.use(passport.initialize());
app.use(passport.session());

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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("✅ Tables 'mots' et 'users' vérifiées ou créées.");
  } catch (err) {
    console.error("❌ Erreur lors de l'initialisation :", err);
  }
})();

// -------------------- Passport Google --------------------
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "https://chinese-quizz.onrender.com/auth/google/callback"
  },
  async function(accessToken, refreshToken, profile, done) {
    try {
      const { id, displayName, emails } = profile;
      const email = emails[0].value;

      const userRes = await pool.query("SELECT * FROM users WHERE provider_id=$1", [id]);
      if (userRes.rows.length === 0) {
        await pool.query(
          "INSERT INTO users (email, name, provider, provider_id) VALUES ($1,$2,'google',$3)",
          [email, displayName, id]
        );
      }

      done(null, { id, email, displayName });
    } catch (err) {
      done(err, null);
    }
  }
));

// -------------------- Serialize / Deserialize --------------------
passport.serializeUser((user, done) => done(null, user));

passport.deserializeUser(async (user, done) => {
  try {
    const res = await pool.query("SELECT * FROM users WHERE provider_id=$1", [user.id]);
    if (res.rows.length === 0) return done(null, false); // utilisateur supprimé
    done(null, res.rows[0]);
  } catch (err) {
    done(err, null);
  }
});

// -------------------- Routes --------------------
app.get("/", (req, res) => res.render("index", { user: req.user }));

// Auth Google
app.get("/auth/google", passport.authenticate("google", { scope: ["profile","email"] }));
app.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => res.redirect("/")
);

// API mots
app.get("/mot", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM mots ORDER BY RANDOM() LIMIT 1");
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/verifier", async (req, res) => {
  const { chinese, answer } = req.body;
  try {
    const { rows } = await pool.query("SELECT * FROM mots WHERE chinese=$1", [chinese]);
    const row = rows[0];
    const correct = row && row.english.toLowerCase() === answer.toLowerCase();
    res.json({ correct, correctAnswer: row ? row.english : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/ajouter", async (req, res) => {
  const { chinese, pinyin, english, description, hsk } = req.body;
  try {
    const { rows } = await pool.query("SELECT * FROM mots WHERE chinese=$1", [chinese]);
    if (rows.length > 0) return res.json({ success: false, message: "Mot déjà existant" });

    await pool.query(
      "INSERT INTO mots (chinese,pinyin,english,description,hsk) VALUES ($1,$2,$3,$4,$5)",
      [chinese,pinyin,english,description,hsk]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/liste", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM mots ORDER BY id ASC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/update/:id", async (req, res) => {
  const { id } = req.params;
  const { chinese, pinyin, english, description, hsk } = req.body;
  try {
    await pool.query(
      "UPDATE mots SET chinese=$1,pinyin=$2,english=$3,description=$4,hsk=$5 WHERE id=$6",
      [chinese,pinyin,english,description,hsk,id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "update failed" });
  }
});

// -------------------- Lancer serveur --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
