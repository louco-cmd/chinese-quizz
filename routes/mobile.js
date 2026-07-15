// ─────────────────────────────────────────────────────────────────────────────
// API MOBILE (React Native / Expo)
// Auth par token (JWT) au lieu des sessions cookie — une app native ne gère pas
// les cookies de session comme un navigateur. Réutilise le même bcrypt/password_hash
// que le login web. Toutes les routes sont préfixées /api (rate-limitées par apiLimiter).
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool } = require('../config/database');
const { generateDuelQuiz, addTransaction, updateWordScore } = require('../middleware/index');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const TOKEN_TTL = '30d';

// CORS léger pour les routes mobiles (utile si tu testes via Expo Web ;
// en natif ce n'est pas nécessaire, mais inoffensif).
router.use(['/api/auth', '/api/m'], (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Middleware : vérifie le Bearer token ─────────────────────────────────────
function requireToken(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(match[1], JWT_SECRET);
    req.tokenUser = { id: payload.id, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ── POST /api/auth/token : login email/mot de passe → JWT ────────────────────
router.post('/api/auth/token', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const { rows } = await pool.query(
      `SELECT id, email, name, password_hash, role, onboarding_done,
              quiz_direction, interface_lang
       FROM users WHERE email = $1`,
      [String(email).toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
    res.json({
      token,
      user: {
        id: user.id, email: user.email, name: user.name, role: user.role,
        onboarding_done: user.onboarding_done,
        quiz_direction: user.quiz_direction, interface_lang: user.interface_lang,
      },
    });
  } catch (e) {
    console.error('Token login error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/auth/google-token : ID token Google → JWT ──────────────────────
// L'app obtient un id_token Google (via expo-auth-session) et l'échange ici.
// Réutilise la même vérification que le One-Tap web (google-auth-library).
router.post('/api/auth/google-token', async (req, res) => {
  try {
    const { id_token } = req.body || {};
    if (!id_token) return res.status(400).json({ error: 'Missing id_token' });

    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = (payload.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'No email in Google token' });

    let { rows } = await pool.query(
      'SELECT id, email, name, role, onboarding_done FROM users WHERE email = $1',
      [email]
    );
    let user = rows[0];
    if (!user) {
      const ins = await pool.query(
        `INSERT INTO users (email, name, provider, email_verified, balance)
         VALUES ($1, $2, 'google', true, 200)
         RETURNING id, email, name, role, onboarding_done`,
        [email, payload.name || null]
      );
      user = ins.rows[0];
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
    res.json({
      token,
      user: {
        id: user.id, email: user.email, name: user.name,
        role: user.role, onboarding_done: user.onboarding_done,
      },
    });
  } catch (e) {
    console.error('google-token error:', e);
    res.status(401).json({ error: 'Invalid Google token' });
  }
});

// ── GET /api/m/me : profil courant ───────────────────────────────────────────
router.get('/api/m/me', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, name, balance, role, quiz_direction, interface_lang
       FROM users WHERE id = $1`,
      [req.tokenUser.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('me error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/collection : les mots de l'utilisateur (tranche verticale) ─────
router.get('/api/m/collection', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT mots.id, mots.chinese, mots.pinyin, mots.english, mots.hsk,
              user_mots.score
       FROM mots
       JOIN user_mots ON mots.id = user_mots.mot_id
       WHERE user_mots.user_id = $1
       ORDER BY user_mots.score ASC, mots.id ASC`,
      [req.tokenUser.id]
    );
    res.json({ words: rows });
  } catch (e) {
    console.error('collection error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/search?q= : recherche permissive (chinois/anglais/pinyin) ──────
router.get('/api/m/search', requireToken, async (req, res) => {
  try {
    const raw = (req.query.q || '').trim();
    if (!raw) return res.json({ results: [] });

    const escaped = raw.replace(/[\\%_]/g, (c) => '\\' + c);
    const like = `%${escaped}%`;
    const pinyinNorm = raw.normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z]/g, '');

    const clauses = [`m.chinese ILIKE $1 ESCAPE '\\'`, `m.english ILIKE $1 ESCAPE '\\'`];
    const params = [like, req.tokenUser.id, raw];
    const pinyinColNorm =
      `regexp_replace(translate(lower(m.pinyin),'üāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ','uaaaaeeeeiiiioooouuuuuuuu'),'[^a-z]','','g')`;
    if (pinyinNorm) {
      params.push(`%${pinyinNorm}%`);
      clauses.push(`${pinyinColNorm} LIKE $${params.length}`);
    }

    const { rows } = await pool.query(
      `SELECT m.id, m.chinese, m.pinyin, m.english, m.hsk,
              BOOL_OR(um.user_id = $2) AS owned
       FROM mots m
       LEFT JOIN user_mots um ON um.mot_id = m.id
       WHERE ${clauses.join(' OR ')}
       GROUP BY m.id
       ORDER BY (m.chinese = $3 OR LOWER(m.english) = LOWER($3)) DESC, m.id ASC
       LIMIT 8`,
      params
    );
    res.json({ results: rows });
  } catch (e) {
    console.error('m/search error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/words/:motId/capture : ajoute un mot existant à sa collection ──
router.post('/api/m/words/:motId/capture', requireToken, async (req, res) => {
  try {
    const motId = parseInt(req.params.motId, 10);
    if (!motId) return res.status(400).json({ error: 'Invalid word' });
    await pool.query(
      `INSERT INTO user_mots (user_id, mot_id, score)
       SELECT $1, $2, 0
       WHERE NOT EXISTS (
         SELECT 1 FROM user_mots WHERE user_id = $1 AND mot_id = $2
       )`,
      [req.tokenUser.id, motId]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('m/capture error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/words : créer un nouveau mot + le capturer ───────────────────
// Miroir de /ajouter : coûte 3 coins, upsert du mot par `chinese`, association
// à la collection, débit + transaction. Utilisé par la popup "New word".
router.post('/api/m/words', requireToken, async (req, res) => {
  const { chinese, pinyin, english, description } = req.body || {};
  if (!chinese || !english) {
    return res.status(400).json({ error: 'Chinese and English are required' });
  }
  const userId = req.tokenUser.id;
  const COST = 3;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      'SELECT balance FROM users WHERE id = $1 FOR UPDATE', [userId]
    );
    if (!userRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    const balance = userRows[0].balance;
    if (balance < COST) {
      await client.query('ROLLBACK');
      return res.status(402).json({ error: 'Insufficient balance (3 coins required)' });
    }

    // Upsert du mot par `chinese`
    let { rows } = await client.query('SELECT id FROM mots WHERE chinese = $1', [chinese]);
    let motId;
    if (rows.length) {
      motId = rows[0].id;
    } else {
      const ins = await client.query(
        `INSERT INTO mots (chinese, pinyin, english, description)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [chinese, pinyin || null, english, description || null]
      );
      motId = ins.rows[0].id;
    }

    // Déjà possédé ?
    const { rows: owned } = await client.query(
      'SELECT 1 FROM user_mots WHERE user_id = $1 AND mot_id = $2', [userId, motId]
    );
    if (owned.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'You already captured this word' });
    }

    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [COST, userId]);
    await client.query(
      `INSERT INTO transactions (user_id, amount, type, description)
       VALUES ($1, $2, $3, $4)`,
      [userId, -COST, 'capture_word', `Captured word ${chinese}`]
    );
    await client.query('INSERT INTO user_mots (user_id, mot_id, score) VALUES ($1, $2, 0)', [userId, motId]);

    await client.query('COMMIT');
    const word = await pool.query(
      'SELECT id, chinese, pinyin, english, hsk FROM mots WHERE id = $1', [motId]
    );
    res.json({ success: true, word: word.rows[0], newBalance: balance - COST });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/words create error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── PUT /api/m/words/:motId : éditer un mot (chinois/pinyin/anglais) ──────────
router.put('/api/m/words/:motId', requireToken, async (req, res) => {
  try {
    const motId = parseInt(req.params.motId, 10);
    if (!motId) return res.status(400).json({ error: 'Invalid word' });
    const { chinese, pinyin, english, description } = req.body || {};

    // On n'édite que si l'utilisateur possède le mot dans sa collection
    const owns = await pool.query(
      'SELECT 1 FROM user_mots WHERE user_id = $1 AND mot_id = $2',
      [req.tokenUser.id, motId]
    );
    if (!owns.rows.length) return res.status(403).json({ error: 'Not your word' });

    const { rows } = await pool.query(
      `UPDATE mots
       SET chinese     = COALESCE($2, chinese),
           pinyin      = COALESCE($3, pinyin),
           english     = COALESCE($4, english),
           description = COALESCE($5, description)
       WHERE id = $1
       RETURNING id, chinese, pinyin, english, description, hsk`,
      [motId, chinese ?? null, pinyin ?? null, english ?? null, description ?? null]
    );
    res.json({ word: rows[0] });
  } catch (e) {
    console.error('m/word update error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/m/words/:motId : retirer un mot de sa collection ──────────────
router.delete('/api/m/words/:motId', requireToken, async (req, res) => {
  try {
    const motId = parseInt(req.params.motId, 10);
    if (!motId) return res.status(400).json({ error: 'Invalid word' });
    await pool.query(
      'DELETE FROM user_mots WHERE user_id = $1 AND mot_id = $2',
      [req.tokenUser.id, motId]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('m/word delete error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/character/:char : sens d'un caractère seul (tap sur la carte) ──
router.get('/api/m/character/:char', requireToken, async (req, res) => {
  try {
    const ch = decodeURIComponent(req.params.char || '').trim();
    if (!ch) return res.status(400).json({ error: 'Missing character' });
    // Correspondance exacte d'un mot d'un seul caractère dans le dictionnaire
    const { rows } = await pool.query(
      'SELECT chinese, pinyin, english, hsk FROM mots WHERE chinese = $1 ORDER BY id ASC LIMIT 1',
      [ch]
    );
    res.json({ character: rows[0] || null });
  } catch (e) {
    console.error('m/character error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/store/pack : acheter un pack HSK (miroir /api/purchase-pack) ──
const PACK_PRICES = { 1: 200, 2: 400 };
router.post('/api/m/store/pack', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  const level = parseInt(req.body?.level, 10);
  const price = PACK_PRICES[level];
  if (!price) return res.status(400).json({ error: 'Invalid pack' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [uid]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }
    if (rows[0].balance < price) { await client.query('ROLLBACK'); return res.status(402).json({ error: 'Not enough coins' }); }

    const ins = await client.query(
      `INSERT INTO user_mots (user_id, mot_id, score, nb_quiz, nb_correct, last_seen)
       SELECT $1, m.id, 0, 0, 0, NULL FROM mots m
       WHERE m.hsk = $2 AND NOT EXISTS (SELECT 1 FROM user_mots um WHERE um.user_id = $1 AND um.mot_id = m.id)
       RETURNING mot_id`, [uid, level]);
    const added = ins.rowCount;
    if (added === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'You already own every word in this pack.' }); }

    await client.query(
      `INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, 'pack_purchase', $3)`,
      [uid, -price, `HSK${level} pack (${added} words)`]);
    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [price, uid]);
    await client.query('COMMIT');
    res.json({ success: true, wordsAdded: added, newBalance: rows[0].balance - price });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/store pack error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

// ── POST /api/m/store/booster : 5 mots aléatoires (miroir /api/acheter-booster) ─
router.post('/api/m/store/booster', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  const COST = 20, COUNT = 5;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [uid]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }
    if (rows[0].balance < COST) { await client.query('ROLLBACK'); return res.status(402).json({ error: `Not enough coins (${COST} needed).` }); }

    const { rows: words } = await client.query(
      `SELECT id, chinese, pinyin, english, hsk FROM mots
       WHERE id NOT IN (SELECT mot_id FROM user_mots WHERE user_id = $1)
       ORDER BY RANDOM() LIMIT $2`, [uid, COUNT]);
    if (words.length < COUNT) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Not enough new words to discover.' }); }

    await client.query(
      `INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, 'pack_purchase', $3)`,
      [uid, -COST, `Word Booster (${COUNT} words)`]);
    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [COST, uid]);
    for (const w of words) {
      await client.query('INSERT INTO user_mots (user_id, mot_id) VALUES ($1, $2)', [uid, w.id]);
    }
    await client.query('COMMIT');
    res.json({ success: true, words, newBalance: rows[0].balance - COST });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/store booster error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

// ── GET /api/m/wallet : solde + transactions (page bank) ─────────────────────
router.get('/api/m/wallet', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const [me, tx] = await Promise.all([
      pool.query('SELECT balance FROM users WHERE id = $1', [uid]),
      pool.query(
        `SELECT id, amount, type, description, created_at
         FROM transactions WHERE user_id = $1 AND amount != 0
         ORDER BY created_at DESC LIMIT 100`, [uid]),
    ]);
    res.json({ balance: me.rows[0]?.balance || 0, transactions: tx.rows });
  } catch (e) {
    console.error('m/wallet error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/mentors : annuaire des mentors ────────────────────────────────
router.get('/api/m/mentors', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.languages_spoken, u.teaching_languages, u.session_price, u.session_currency,
              u.years_experience, u.mentor_bio, u.mentor_links,
              (SELECT COUNT(DISTINCT cs.student_id)
                 FROM classrooms c JOIN classroom_students cs ON cs.classroom_id = c.id
                 WHERE c.teacher_id = u.id AND cs.status = 'active')::int AS student_count,
              (SELECT COUNT(l.id)
                 FROM lessons l JOIN classrooms c ON c.id = l.classroom_id
                 WHERE c.teacher_id = u.id)::int AS task_count
       FROM users u
       WHERE u.role = 'teacher' AND u.mentor_listed = TRUE
       ORDER BY student_count DESC, u.name ASC`
    );
    const mentors = rows.map((m) => {
      const links = Array.isArray(m.mentor_links) ? m.mentor_links : [];
      return {
        id: m.id, name: m.name, languages_spoken: m.languages_spoken,
        teaching_languages: (m.teaching_languages || '').split(',').map((s) => s.trim()).filter(Boolean),
        session_price: m.session_price != null ? Number(m.session_price) : null,
        session_currency: m.session_currency || 'EUR',
        years_experience: m.years_experience, mentor_bio: m.mentor_bio,
        student_count: m.student_count, task_count: m.task_count,
        link: links[0] || null,
      };
    });
    res.json({ mentors });
  } catch (e) {
    console.error('m/mentors error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/student/classes : mentors rejoints + tasks en cours ───────────
// Miroir de /api/student/my-classes : sert à la page account ET au quiz.
router.get('/api/m/student/classes', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const { rows: mentors } = await pool.query(
      `SELECT t.id, COALESCE(NULLIF(TRIM(t.name), ''), 'Your teacher') AS name, MIN(cs.joined_at) AS since
       FROM classroom_students cs
       JOIN classrooms c ON c.id = cs.classroom_id
       JOIN users t ON t.id = c.teacher_id
       WHERE cs.student_id = $1 AND cs.status = 'active'
       GROUP BY t.id, t.name
       ORDER BY since ASC`, [uid]);

    const { rows: taskRows } = await pool.query(
      `SELECT l.id, l.title, c.name AS class_name,
              (SELECT COUNT(*) FROM lesson_words lw WHERE lw.lesson_id = l.id)::int AS word_count,
              (SELECT COALESCE(ROUND(AVG(COALESCE(um.score, 0))), 0)
                 FROM lesson_words lw
                 LEFT JOIN user_mots um ON um.mot_id = lw.mot_id AND um.user_id = $1
                 WHERE lw.lesson_id = l.id)::int AS knowledge
       FROM lessons l
       JOIN classrooms c ON c.id = l.classroom_id
       JOIN classroom_students cs ON cs.classroom_id = c.id AND cs.student_id = $1 AND cs.status = 'active'
       WHERE l.created_at >= COALESCE(cs.joined_at, 'epoch')
       ORDER BY l.created_at DESC`, [uid]);

    const tasks = taskRows
      .filter((t) => t.word_count > 0 && t.knowledge < 100)
      .map((t) => ({ id: t.id, title: t.title, class_name: t.class_name, word_count: t.word_count, knowledge: t.knowledge }));

    res.json({ mentors, tasks });
  } catch (e) {
    console.error('m/student classes error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/student/lessons/:id : détail d'un cours (notes + mots) ─────────
router.get('/api/m/student/lessons/:id', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const lessonId = parseInt(req.params.id, 10);
    const access = await pool.query(
      `SELECT l.id FROM lessons l
       JOIN classroom_students cs ON cs.classroom_id = l.classroom_id
       WHERE l.id = $1 AND cs.student_id = $2 AND cs.status = 'active'`, [lessonId, uid]);
    if (!access.rows.length) return res.status(404).json({ error: 'Course not found' });

    const [lrows, words] = await Promise.all([
      pool.query(
        `SELECT l.id, l.title, l.summary, l.created_at, c.name AS class_name
         FROM lessons l JOIN classrooms c ON c.id = l.classroom_id WHERE l.id = $1`, [lessonId]),
      pool.query(
        `SELECT m.id, m.chinese, m.pinyin, m.english
         FROM lesson_words lw JOIN mots m ON m.id = lw.mot_id
         WHERE lw.lesson_id = $1 ORDER BY lw.id ASC`, [lessonId]),
    ]);
    res.json({ lesson: lrows.rows[0], words: words.rows });
  } catch (e) {
    console.error('m/student lesson error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/student/mentors/:teacherId/leave : quitter un prof ───────────
router.post('/api/m/student/mentors/:teacherId/leave', requireToken, async (req, res) => {
  try {
    const teacherId = parseInt(req.params.teacherId, 10);
    if (!teacherId) return res.status(400).json({ error: 'Invalid mentor' });
    await pool.query(
      `UPDATE classroom_students cs SET status = 'removed'
       FROM classrooms c
       WHERE cs.classroom_id = c.id AND c.teacher_id = $1 AND cs.student_id = $2 AND cs.status = 'active'`,
      [teacherId, req.tokenUser.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('m/student leave mentor error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/student/tasks/:id/start : démarre une task (retourne les ids) ─
router.post('/api/m/student/tasks/:id/start', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const lessonId = parseInt(req.params.id, 10);
    const access = await pool.query(
      `SELECT l.id FROM lessons l
       JOIN classroom_students cs ON cs.classroom_id = l.classroom_id
       WHERE l.id = $1 AND cs.student_id = $2 AND cs.status = 'active'`, [lessonId, uid]);
    if (!access.rows.length) return res.status(404).json({ error: 'Task not found' });

    const { rows } = await pool.query('SELECT mot_id FROM lesson_words WHERE lesson_id = $1', [lessonId]);
    const ids = rows.map((r) => r.mot_id);
    if (!ids.length) return res.status(400).json({ error: 'Task has no words' });

    // Ajoute les mots manquants à la collection de l'élève
    await pool.query(
      `INSERT INTO user_mots (user_id, mot_id)
       SELECT $1, m FROM unnest($2::int[]) AS m
       WHERE NOT EXISTS (SELECT 1 FROM user_mots WHERE user_id = $1 AND mot_id = m)`,
      [uid, ids]);

    res.json({ success: true, ids, type: 'pinyin' });
  } catch (e) {
    console.error('m/student task start error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/student/tasks/:id/result : enregistre le résultat (côté prof) ─
router.post('/api/m/student/tasks/:id/result', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const lessonId = parseInt(req.params.id, 10);
    const access = await pool.query(
      `SELECT l.id FROM lessons l
       JOIN classroom_students cs ON cs.classroom_id = l.classroom_id
       WHERE l.id = $1 AND cs.student_id = $2 AND cs.status = 'active'`, [lessonId, uid]);
    if (!access.rows.length) return res.status(404).json({ error: 'Task not found' });
    const score = parseInt(req.body?.score, 10);
    const total = parseInt(req.body?.total, 10);
    await pool.query(
      `INSERT INTO lesson_quiz_results (lesson_id, student_id, score, total) VALUES ($1, $2, $3, $4)`,
      [lessonId, uid, Number.isInteger(score) ? score : null, Number.isInteger(total) ? total : null]);
    res.json({ success: true });
  } catch (e) {
    console.error('m/student task result error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/classes/join : rejoindre une classe avec un code ─────────────
router.post('/api/m/classes/join', requireToken, async (req, res) => {
  try {
    const code = (req.body?.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Code required' });
    const { rows } = await pool.query(
      'SELECT id, teacher_id, name FROM classrooms WHERE join_code = $1 AND archived = FALSE', [code]
    );
    if (!rows.length) return res.status(404).json({ error: 'Class not found' });
    const classroom = rows[0];
    if (classroom.teacher_id === req.tokenUser.id) {
      return res.status(400).json({ error: "You're the teacher of this class" });
    }
    await pool.query(
      `INSERT INTO classroom_students (classroom_id, student_id)
       VALUES ($1, $2)
       ON CONFLICT (classroom_id, student_id) DO UPDATE SET status = 'active'`,
      [classroom.id, req.tokenUser.id]
    );
    res.json({ success: true, classroom: { id: classroom.id, name: classroom.name } });
  } catch (e) {
    console.error('m/classes join error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/account : profil complet (façon page account EJS) ─────────────
// Renvoie : identité (nom/tagline/pays/direction), solde, stats globales,
// distribution de maîtrise (pinyin + caractères), stats HSK, heatmap de quiz
// et les 5 derniers quiz. Assez pour reconstruire toute la page côté mobile.
router.get('/api/m/account', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const year = new Date().getFullYear();
    const [me, wordRows, quizzes, duels, contrib, recent] = await Promise.all([
      pool.query('SELECT name, balance, tagline, country, quiz_direction FROM users WHERE id = $1', [uid]),
      pool.query(
        `SELECT um.score, um.score_character, m.hsk
         FROM user_mots um JOIN mots m ON m.id = um.mot_id
         WHERE um.user_id = $1`, [uid]),
      pool.query('SELECT COUNT(*)::int AS n FROM quiz_history WHERE user_id = $1', [uid]),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM duels
         WHERE (challenger_id = $1 OR opponent_id = $1) AND status = 'completed'`, [uid]),
      pool.query(
        `SELECT DATE(date_completed) AS date, COUNT(*) AS count
         FROM quiz_history
         WHERE user_id = $1 AND EXTRACT(YEAR FROM date_completed) = $2
         GROUP BY DATE(date_completed) ORDER BY date ASC`, [uid, year]),
      pool.query(
        `SELECT score, total_questions, ratio, quiz_type, date_completed
         FROM quiz_history WHERE user_id = $1
         ORDER BY date_completed DESC LIMIT 5`, [uid]),
    ]);

    const words = wordRows.rows;

    // Distribution de maîtrise (mêmes seuils que l'EJS)
    const bucket = (scores) => ({
      mastered: scores.filter((s) => s >= 90).length,
      learning: scores.filter((s) => s >= 60 && s < 90).length,
      medium:   scores.filter((s) => s >= 30 && s < 60).length,
      novice:   scores.filter((s) => s < 30).length,
    });
    const pinyinDist = bucket(words.map((w) => w.score || 0));
    const charDist   = bucket(words.map((w) => w.score_character || 0));

    // Stats HSK : nombre + % maîtrisé par niveau
    const HSK_ORDER = ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6', 'Street'];
    const groups = {};
    words.forEach((w) => {
      const lvl = w.hsk ? `HSK${w.hsk}` : 'Street';
      (groups[lvl] = groups[lvl] || []).push(w.score || 0);
    });
    const hsk = HSK_ORDER.map((key) => {
      const scores = groups[key] || [];
      if (!scores.length) return null;
      const mastered = scores.filter((s) => s >= 90).length;
      return {
        key,
        label: key === 'Street' ? 'HSK Street' : key.replace('HSK', 'HSK '),
        count: scores.length,
        masteredPct: Math.round((mastered / scores.length) * 100),
      };
    }).filter(Boolean);

    res.json({
      name: me.rows[0]?.name || '',
      tagline: me.rows[0]?.tagline || 'Learning Chinese!',
      country: me.rows[0]?.country || null,
      quizDirection: me.rows[0]?.quiz_direction || 'en→zh',
      balance: me.rows[0]?.balance || 0,
      words: words.length,
      quizzes: quizzes.rows[0].n,
      duels: duels.rows[0].n,
      mastery: { pinyin: pinyinDist, character: charDist, total: words.length },
      hsk,
      recentQuizzes: recent.rows.map((r) => ({
        score: r.score, total: r.total_questions,
        ratio: r.ratio != null ? Number(r.ratio) : null,
        type: r.quiz_type || 'quiz',
        date: r.date_completed instanceof Date ? r.date_completed.toISOString() : String(r.date_completed),
      })),
      year,
      contributions: contrib.rows.map((r) => ({
        date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
        count: parseInt(r.count, 10) || 0,
      })),
    });
  } catch (e) {
    console.error('m/account error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /api/m/account : éditer nom / tagline / pays (popup "Edit info") ──────
router.put('/api/m/account', requireToken, async (req, res) => {
  try {
    const { name, tagline, country } = req.body || {};
    if (!name || String(name).length > 50) {
      return res.status(400).json({ error: 'Name is required (max 50 characters)' });
    }
    if (tagline && String(tagline).length > 100) {
      return res.status(400).json({ error: 'Tagline must be under 100 characters' });
    }
    const code = country ? String(country).toUpperCase().slice(0, 2) : null;
    await pool.query(
      `UPDATE users SET name = $1, tagline = $2, country = $3 WHERE id = $4`,
      [String(name).trim(), tagline ? String(tagline).trim() : null, code, req.tokenUser.id]
    );
    res.json({ success: true, name: String(name).trim(), tagline: tagline || null, country: code });
  } catch (e) {
    console.error('m/account update error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/settings : préférences (direction, langue, toggles) ───────────
router.get('/api/m/settings', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT quiz_direction, interface_lang, ghost_mode,
              notifications_enabled, word_review_enabled
       FROM users WHERE id = $1`, [req.tokenUser.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const u = rows[0];
    res.json({
      quiz_direction: u.quiz_direction || 'en→zh',
      interface_lang: u.interface_lang || 'en',
      ghost_mode: !!u.ghost_mode,
      notifications_enabled: !!u.notifications_enabled,
      word_review_enabled: !!u.word_review_enabled,
    });
  } catch (e) {
    console.error('m/settings get error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /api/m/settings : met à jour un sous-ensemble de préférences ────────
router.patch('/api/m/settings', requireToken, async (req, res) => {
  try {
    const body = req.body || {};
    const sets = [];
    const params = [];
    const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (body.quiz_direction !== undefined) {
      if (!['en→zh', 'zh→en'].includes(body.quiz_direction)) {
        return res.status(400).json({ error: 'Invalid direction' });
      }
      push('quiz_direction', body.quiz_direction);
    }
    if (body.interface_lang !== undefined) {
      if (!['en', 'zh'].includes(body.interface_lang)) {
        return res.status(400).json({ error: 'Invalid language' });
      }
      push('interface_lang', body.interface_lang);
    }
    if (typeof body.ghost_mode === 'boolean') push('ghost_mode', body.ghost_mode);
    if (typeof body.notifications_enabled === 'boolean') push('notifications_enabled', body.notifications_enabled);
    if (typeof body.word_review_enabled === 'boolean') push('word_review_enabled', body.word_review_enabled);

    if (!sets.length) return res.status(400).json({ error: 'No valid fields' });

    params.push(req.tokenUser.id);
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    res.json({ success: true });
  } catch (e) {
    console.error('m/settings patch error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/m/account/delete : supprimer le compte (danger zone) ─────────
router.delete('/api/m/account/delete', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Bloque si abonnement premium actif non résilié (même règle que le web)
    const sub = await client.query(
      `SELECT cancel_at_period_end FROM user_subscriptions WHERE user_id = $1 AND status = 'active'`, [uid]
    );
    if (sub.rows.some((r) => r.cancel_at_period_end !== true)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cancel your premium subscription before deleting your account.' });
    }
    await client.query('DELETE FROM user_mots WHERE user_id = $1', [uid]);
    await client.query('DELETE FROM user_subscriptions WHERE user_id = $1', [uid]);
    const del = await client.query('DELETE FROM users WHERE id = $1 RETURNING id', [uid]);
    if (!del.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/account delete error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── GET /api/m/duels : duels en attente + bilan ──────────────────────────────
router.get('/api/m/duels', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const dirRow = await pool.query('SELECT quiz_direction FROM users WHERE id = $1', [uid]);
    const dir = dirRow.rows[0]?.quiz_direction || 'en→zh';
    const [pending, stats, recent, bullies] = await Promise.all([
      pool.query(
        `SELECT d.id, d.bet_amount, d.status, d.created_at,
                u1.name AS challenger_name, u2.name AS opponent_name,
                CASE WHEN d.challenger_id = $1 THEN 'challenger' ELSE 'opponent' END AS user_role,
                CASE WHEN d.challenger_id = $1 THEN d.challenger_score ELSE d.opponent_score END AS my_score
         FROM duels d
         JOIN users u1 ON d.challenger_id = u1.id
         JOIN users u2 ON d.opponent_id = u2.id
         WHERE (d.challenger_id = $1 OR d.opponent_id = $1) AND d.status = 'pending'
         ORDER BY d.created_at DESC`, [uid]),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE winner_id = $1)::int AS wins,
           COUNT(*) FILTER (WHERE winner_id IS NOT NULL AND winner_id <> $1
             AND (challenger_id = $1 OR opponent_id = $1))::int AS losses
         FROM duels
         WHERE (challenger_id = $1 OR opponent_id = $1) AND status = 'completed'`, [uid]),
      // Duels récents terminés (avec scores + issue vue par l'utilisateur)
      pool.query(
        `SELECT d.id, d.bet_amount, d.created_at,
                CASE WHEN d.challenger_id = $1 THEN u2.name ELSE u1.name END AS opponent_name,
                CASE WHEN d.challenger_id = $1 THEN d.challenger_score ELSE d.opponent_score END AS my_score,
                CASE WHEN d.challenger_id = $1 THEN d.opponent_score ELSE d.challenger_score END AS opp_score,
                CASE WHEN d.winner_id = $1 THEN 'won'
                     WHEN d.winner_id IS NULL THEN 'draw'
                     ELSE 'lost' END AS result
         FROM duels d
         JOIN users u1 ON d.challenger_id = u1.id
         JOIN users u2 ON d.opponent_id = u2.id
         WHERE (d.challenger_id = $1 OR d.opponent_id = $1) AND d.status = 'completed'
         ORDER BY d.created_at DESC LIMIT 5`, [uid]),
      // Rivaux : bilan net des paris face à chaque adversaire (comme /api/duels/bullies)
      pool.query(
        `SELECT opponent.id, opponent.name,
           SUM(CASE
             WHEN (d.challenger_id = $1 AND d.challenger_score > d.opponent_score)
               OR (d.opponent_id = $1 AND d.opponent_score > d.challenger_score) THEN d.bet_amount
             WHEN d.challenger_score = d.opponent_score THEN 0
             ELSE -d.bet_amount END)::int AS balance
         FROM duels d
         JOIN users opponent ON (
           (d.challenger_id = $1 AND d.opponent_id = opponent.id) OR
           (d.opponent_id = $1 AND d.challenger_id = opponent.id))
         WHERE d.challenger_score IS NOT NULL AND d.opponent_score IS NOT NULL
           AND d.bet_amount > 0 AND opponent.id <> $1
           AND opponent.quiz_direction = $2 AND opponent.ghost_mode = FALSE
         GROUP BY opponent.id, opponent.name
         ORDER BY balance DESC LIMIT 8`, [uid, dir]),
    ]);
    res.json({
      pending: pending.rows,
      wins: stats.rows[0]?.wins || 0,
      losses: stats.rows[0]?.losses || 0,
      recent: recent.rows,
      bullies: bullies.rows,
    });
  } catch (e) {
    console.error('m/duels error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/leaderboard : classement (profs exclus) ───────────────────────
router.get('/api/m/leaderboard', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const dir = await pool.query('SELECT quiz_direction FROM users WHERE id = $1', [uid]);
    const quizDirection = dir.rows[0]?.quiz_direction || 'en→zh';
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.tagline, u.country,
         COUNT(*) FILTER (WHERE d.winner_id = u.id)::int AS wins,
         COUNT(*) FILTER (WHERE d.status = 'completed' AND d.winner_id IS NOT NULL
           AND d.winner_id <> u.id)::int AS losses,
         (SELECT COUNT(*)::int FROM user_mots um WHERE um.user_id = u.id) AS total_words
       FROM users u
       LEFT JOIN duels d ON (d.challenger_id = u.id OR d.opponent_id = u.id) AND d.status = 'completed'
       WHERE u.quiz_direction = $1 AND u.ghost_mode = FALSE AND u.role <> 'teacher'
       GROUP BY u.id, u.name, u.tagline, u.country
       HAVING COUNT(*) FILTER (WHERE d.status = 'completed') > 0
       ORDER BY wins DESC, losses ASC
       LIMIT 50`, [quizDirection]);
    const leaderboard = rows.map((r) => {
      const played = r.wins + r.losses;
      return { ...r, ratio: played > 0 ? Math.round((r.wins / played) * 100) : 0, isMe: r.id === uid };
    });
    res.json({ leaderboard });
  } catch (e) {
    console.error('m/leaderboard error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/referral : code de parrainage + lien partageable ──────────────
function genReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(7);
  let s = '';
  for (let i = 0; i < 7; i++) s += chars[bytes[i] % chars.length];
  return s;
}
async function ensureReferralCode(userId) {
  const cur = await pool.query('SELECT referral_code FROM users WHERE id = $1', [userId]);
  if (cur.rows[0] && cur.rows[0].referral_code) return cur.rows[0].referral_code;
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = genReferralCode();
    try {
      await pool.query(
        'UPDATE users SET referral_code = $1 WHERE id = $2 AND referral_code IS NULL',
        [code, userId]
      );
    } catch (e) { /* collision → réessai */ }
    const chk = await pool.query('SELECT referral_code FROM users WHERE id = $1', [userId]);
    if (chk.rows[0] && chk.rows[0].referral_code) return chk.rows[0].referral_code;
  }
  throw new Error('referral code generation failed');
}
router.get('/api/m/referral', requireToken, async (req, res) => {
  try {
    const code = await ensureReferralCode(req.tokenUser.id);
    res.json({ code, link: `https://jiayou.fr/?ref=${encodeURIComponent(code)}` });
  } catch (e) {
    console.error('m/referral error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/duels/players?q= : recherche d'adversaires (même direction) ───
router.get('/api/m/duels/players', requireToken, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ players: [] });
    const me = await pool.query('SELECT quiz_direction FROM users WHERE id = $1', [req.tokenUser.id]);
    const dir = me.rows[0]?.quiz_direction || 'en→zh';
    const { rows } = await pool.query(
      `SELECT id, name FROM users
       WHERE name ILIKE $1 AND id <> $2 AND quiz_direction = $3 AND ghost_mode = FALSE
       ORDER BY name ASC LIMIT 8`,
      [`%${q}%`, req.tokenUser.id, dir]
    );
    res.json({ players: rows });
  } catch (e) {
    console.error('m/duels players error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/duels/create : créer un duel (avec pari optionnel) ────────────
// Reprend la logique de /api/duels/create (génération du quiz + blocage des mises)
// mais en auth token. Limite : 5 duels en cours max, mêmes règles de solde.
router.post('/api/m/duels/create', requireToken, async (req, res) => {
  const challengerId = req.tokenUser.id;
  const {
    opponent_id, duel_type = 'classic', word_count = 20,
    quiz_type = 'pinyin', bet_amount = 0,
  } = req.body || {};
  const bet = Math.max(0, parseInt(bet_amount, 10) || 0);

  if (!opponent_id) return res.status(400).json({ error: 'Opponent required' });
  if (opponent_id === challengerId) return res.status(400).json({ error: "You can't duel yourself." });

  const client = await pool.connect();
  try {
    const opp = await client.query('SELECT id, name, balance FROM users WHERE id = $1', [opponent_id]);
    if (!opp.rows.length) return res.status(404).json({ error: 'Opponent not found' });

    const active = await client.query(
      `SELECT COUNT(*) FROM duels
       WHERE (challenger_id = $1 OR opponent_id = $1)
         AND status IN ('pending','active') AND created_at > NOW() - INTERVAL '7 days'`,
      [challengerId]
    );
    if (parseInt(active.rows[0].count, 10) >= 5) {
      return res.status(400).json({ error: 'You already have 5 duels in progress.' });
    }
    if (bet > 0 && opp.rows[0].balance < bet) {
      return res.status(400).json({ error: `${opp.rows[0].name} doesn't have enough coins to accept.` });
    }

    await client.query('BEGIN');
    const chal = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [challengerId]);
    if (chal.rows[0].balance < bet) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient coins to bet.' });
    }
    const oppLock = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [opponent_id]);
    if (bet > 0 && oppLock.rows[0].balance < bet) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `${opp.rows[0].name} doesn't have enough coins.` });
    }

    if (bet > 0) {
      const dChal = await addTransaction(client, challengerId, -bet, 'bet', 'Duel bet');
      const dOpp = await addTransaction(client, opponent_id, -bet, 'bet', 'Duel bet');
      if (!dChal || !dOpp) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Transaction failed' }); }
    }

    const quizData = await generateDuelQuiz(client, challengerId, opponent_id, duel_type, quiz_type, word_count);
    if (!quizData) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Not enough shared words to generate the duel.' });
    }

    const ins = await client.query(
      `INSERT INTO duels
        (challenger_id, opponent_id, duel_type, word_count, quiz_type, quiz_data, bet_amount, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING id`,
      [challengerId, opponent_id, duel_type, word_count, quiz_type, JSON.stringify(quizData), bet]
    );
    await client.query('COMMIT');
    res.json({ success: true, duelId: ins.rows[0].id });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/duels create error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── GET /api/m/duels/:id : détail d'un duel + mots à jouer ────────────────────
router.get('/api/m/duels/:id', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid duel' });
    const { rows } = await pool.query(
      `SELECT d.*, u1.name AS challenger_name, u2.name AS opponent_name
       FROM duels d JOIN users u1 ON d.challenger_id = u1.id JOIN users u2 ON d.opponent_id = u2.id
       WHERE d.id = $1 AND (d.challenger_id = $2 OR d.opponent_id = $2)`, [id, uid]);
    if (!rows.length) return res.status(404).json({ error: 'Duel not found' });
    const d = rows[0];
    const isChallenger = d.challenger_id === uid;
    const qd = typeof d.quiz_data === 'string' ? JSON.parse(d.quiz_data || '{}') : (d.quiz_data || {});
    const myScore = isChallenger ? d.challenger_score : d.opponent_score;
    const oppScore = isChallenger ? d.opponent_score : d.challenger_score;
    // Issue vue par l'utilisateur (uniquement quand le duel est terminé).
    let result = null;
    if (d.status === 'completed') {
      if (d.winner_id === uid) result = 'won';
      else if (d.winner_id === null) result = 'draw';
      else result = 'lost';
    }
    res.json({
      id: d.id,
      quiz_type: d.quiz_type || 'pinyin',
      duel_type: d.duel_type,
      status: d.status,
      bet_amount: d.bet_amount,
      opponent_name: isChallenger ? d.opponent_name : d.challenger_name,
      opponent_id: isChallenger ? d.opponent_id : d.challenger_id,
      my_name: isChallenger ? d.challenger_name : d.opponent_name,
      words: qd.words || [],
      my_score: myScore,
      opp_score: oppScore,
      result,
      created_at: d.created_at,
      already_played: myScore !== null,
    });
  } catch (e) {
    console.error('m/duel detail error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/duels/:id/submit : soumettre le score (miroir web) ────────────
router.post('/api/m/duels/:id/submit', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  const id = parseInt(req.params.id, 10);
  const score = parseInt(req.body?.score, 10) || 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const check = await client.query(
      `SELECT * FROM duels WHERE id = $1 AND (challenger_id = $2 OR opponent_id = $2) AND status = 'pending'`,
      [id, uid]
    );
    if (!check.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Duel not found or already completed' });
    }
    const duel = check.rows[0];
    const isChallenger = duel.challenger_id === uid;
    await client.query(
      `UPDATE duels SET ${isChallenger ? 'challenger_score' : 'opponent_score'} = $1 WHERE id = $2`,
      [score, id]
    );

    const upd = await client.query('SELECT * FROM duels WHERE id = $1', [id]);
    const cur = upd.rows[0];
    const bothPlayed = cur.challenger_score !== null && cur.opponent_score !== null;
    let winnerId = null;

    if (bothPlayed) {
      if (cur.challenger_score > cur.opponent_score) winnerId = cur.challenger_id;
      else if (cur.opponent_score > cur.challenger_score) winnerId = cur.opponent_id;

      if (winnerId && cur.bet_amount > 0) {
        await addTransaction(client, winnerId, cur.bet_amount * 2, 'bet_reward', 'Duel win');
      } else if (cur.bet_amount > 0) {
        // Match nul : remboursement des deux mises
        await addTransaction(client, cur.challenger_id, cur.bet_amount, 'bet_refund', 'Duel draw refund');
        await addTransaction(client, cur.opponent_id, cur.bet_amount, 'bet_refund', 'Duel draw refund');
      }
      await client.query(
        `UPDATE duels SET winner_id = $1, status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [winnerId, id]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, duel_completed: bothPlayed, winner_id: winnerId, you_won: winnerId === uid });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/duel submit error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── GET /api/m/quiz/words : mots pour un quiz scoré (type/count/hsk/difficulty) ─
// Reprend la logique de /quiz-mots : filtre HSK + plage de score selon la
// difficulté, avec élargissement progressif si pas assez de mots.
router.get('/api/m/quiz/words', requireToken, async (req, res) => {
  const userId = req.tokenUser.id;
  const requestedCount = parseInt(req.query.count, 10) || 10;
  const hskParam = req.query.hsk || 'all';
  const difficulty = req.query.difficulty || 'balanced';
  const idsParam = req.query.ids; // liste explicite (quick quiz sur "Your difficulties")

  try {
    // Mode liste explicite : on renvoie exactement ces mots de la collection.
    if (idsParam) {
      const ids = String(idsParam).split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
      if (!ids.length) return res.status(400).json({ error: 'invalid_ids' });
      const { rows } = await pool.query(
        `SELECT m.id, m.chinese, m.pinyin, m.english, m.hsk, COALESCE(um.score, 0) AS score
         FROM user_mots um INNER JOIN mots m ON um.mot_id = m.id
         WHERE um.user_id = $1 AND m.id = ANY($2)`, [userId, ids]);
      if (!rows.length) return res.status(400).json({ error: 'not_enough_words' });
      rows.sort(() => Math.random() - 0.5);
      await pool.query('UPDATE user_mots SET last_seen = NOW() WHERE user_id = $1 AND mot_id = ANY($2)', [userId, rows.map((r) => r.id)]);
      return res.json({ words: rows, count: rows.length });
    }

    // 1. Parse HSK (all | min-max ; max 7 → inclut "street" = hsk NULL)
    let hskMin = null, hskMax = null, includeStreet = false;
    if (hskParam === 'all') { /* pas de filtre */ }
    else if (hskParam === 'street') { includeStreet = true; }
    else {
      const parts = String(hskParam).split('-');
      if (parts.length === 2) {
        hskMin = parseInt(parts[0], 10); hskMax = parseInt(parts[1], 10);
        if (hskMax === 7) { includeStreet = true; hskMax = 6; }
      } else {
        const lvl = parseInt(hskParam, 10);
        if (lvl >= 1 && lvl <= 6) hskMin = hskMax = lvl;
      }
    }
    const buildHsk = (startIdx) => {
      const conds = [], params = []; let idx = startIdx;
      if (hskMin !== null && hskMax !== null) { conds.push(`m.hsk BETWEEN $${idx} AND $${idx + 1}`); params.push(hskMin, hskMax); idx += 2; }
      if (includeStreet) conds.push('m.hsk IS NULL');
      return { conds, params };
    };

    // 2. Plages de score par difficulté (essai du plus strict au plus large)
    const ranges = {
      discovery: [[0, 29], [0, 49], [0, 69], [0, 100]],
      balanced: [[30, 80], [15, 90], [5, 95], [0, 100]],
      revision: [[80, 100], [60, 100], [40, 100], [0, 100]],
    }[difficulty] || [[0, 100]];

    // 3. Élargissement progressif : on garde le plus grand pool trouvé
    let words = [];
    for (const [sMin, sMax] of ranges) {
      const { conds, params } = buildHsk(4);
      let q = `
        SELECT m.id, m.chinese, m.pinyin, m.english, m.hsk, COALESCE(um.score, 0) AS score
        FROM user_mots um INNER JOIN mots m ON um.mot_id = m.id
        WHERE um.user_id = $1 AND COALESCE(um.score, 0) BETWEEN $2 AND $3`;
      const qp = [userId, sMin, sMax];
      if (conds.length) { q += ` AND (${conds.join(' OR ')})`; qp.push(...params); }
      q += ` ORDER BY RANDOM() LIMIT $${qp.length + 1}`;
      qp.push(requestedCount);
      const { rows } = await pool.query(q, qp);
      if (rows.length > words.length) words = rows;
      if (words.length >= requestedCount) break;
    }

    if (!words.length) {
      return res.status(400).json({ error: 'not_enough_words', message: 'Not enough words in your collection for these settings.' });
    }
    // Marque comme vus
    await pool.query('UPDATE user_mots SET last_seen = NOW() WHERE user_id = $1 AND mot_id = ANY($2)',
      [userId, words.map((r) => r.id)]);
    res.json({ words: words.slice(0, requestedCount), count: Math.min(words.length, requestedCount) });
  } catch (e) {
    console.error('m/quiz/words error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/difficult-words : mots à retravailler (section "Your difficulties") ─
// Version allégée de /api/difficult-words : mots les plus ratés / score bas.
router.get('/api/m/difficult-words', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.chinese, m.pinyin, m.english,
         CASE WHEN COALESCE(um.nb_quiz, 0) >= 2
              THEN (1.0 - (COALESCE(um.nb_correct, 0)::float / NULLIF(um.nb_quiz, 0)))
              ELSE 0.5 END AS error_rate
       FROM user_mots um JOIN mots m ON um.mot_id = m.id
       WHERE um.user_id = $1 AND um.nb_quiz > 0
         AND ((um.nb_quiz >= 2 AND (um.nb_correct::float / um.nb_quiz) < 0.6) OR COALESCE(um.score,0) < 50)
       ORDER BY error_rate DESC, COALESCE(um.score,0) ASC, um.last_seen ASC NULLS FIRST
       LIMIT 10`,
      [req.tokenUser.id]
    );
    res.json({ words: rows.map((r) => ({ id: r.id, chinese: r.chinese, pinyin: r.pinyin, english: r.english })) });
  } catch (e) {
    console.error('m/difficult-words error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/quiz/save : enregistre le quiz + met à jour scores + coins ────
router.post('/api/m/quiz/save', requireToken, async (req, res) => {
  const userId = req.tokenUser.id;
  const { score, total_questions, quiz_type = 'pinyin', results } = req.body || {};
  if (score === undefined || total_questions === undefined) {
    return res.status(400).json({ error: 'Missing score data' });
  }
  const scoreNum = parseInt(score, 10);
  const totalNum = parseInt(total_questions, 10);
  const ratio = totalNum > 0 ? ((scoreNum / totalNum) * 100).toFixed(2) : '0';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Coins = somme par mot réussi selon la maîtrise AVANT le quiz (autorité serveur)
    let coinsEarned = 0;
    if (Array.isArray(results)) {
      const correctIds = results.filter((r) => r.correct === true && r.mot_id)
        .map((r) => parseInt(r.mot_id, 10)).filter(Number.isInteger);
      if (correctIds.length) {
        const { rows: pre } = await client.query(
          `SELECT mot_id, COALESCE(score, 0) AS score FROM user_mots WHERE user_id = $1 AND mot_id = ANY($2)`,
          [userId, correctIds]
        );
        const byMot = {};
        pre.forEach((r) => { byMot[r.mot_id] = Number(r.score) || 0; });
        let raw = 0;
        for (const id of correctIds) {
          const s = byMot[id] ?? 0;
          if (s < 50) raw += 0.5; else if (s < 80) raw += 0.3; else raw += 0.1;
        }
        coinsEarned = Math.round(raw);
      }
    }

    const wordsForHistory = Array.isArray(results) ? results.map((r) => r.pinyin) : [];
    await client.query(
      `INSERT INTO quiz_history (user_id, score, total_questions, ratio, quiz_type, words_used)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, scoreNum, totalNum, ratio, quiz_type, JSON.stringify(wordsForHistory)]
    );

    if (Array.isArray(results)) {
      for (const r of results) {
        if (r.mot_id && r.correct !== null && r.correct !== undefined) {
          await updateWordScore(userId, r.mot_id, r.correct, quiz_type);
        }
      }
    }

    if (coinsEarned > 0) {
      await client.query(
        `INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, 'quiz_reward', $3)`,
        [userId, coinsEarned, `Quiz ${quiz_type}: ${scoreNum}/${totalNum} (${ratio}%)`]
      );
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [coinsEarned, userId]);
    }

    await client.query('COMMIT');
    res.json({ success: true, coins_earned: coinsEarned });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/quiz/save error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── GET /api/m/quiz?count= : mots à réviser (flashcards) ─────────────────────
router.get('/api/m/quiz', requireToken, async (req, res) => {
  try {
    const count = Math.min(parseInt(req.query.count, 10) || 10, 30);
    const { rows } = await pool.query(
      `SELECT mots.id, mots.chinese, mots.pinyin, mots.english, user_mots.score
       FROM mots JOIN user_mots ON mots.id = user_mots.mot_id
       WHERE user_mots.user_id = $1
       ORDER BY user_mots.score ASC, RANDOM()
       LIMIT $2`, [req.tokenUser.id, count]);
    res.json({ words: rows });
  } catch (e) {
    console.error('m/quiz error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = { router, requireToken };
