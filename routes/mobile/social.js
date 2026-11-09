// ════════════════════════════════════════════════════════════════════════════
//  SOCIAL / COMPÉTITION (JWT) — duels, leaderboard, parrainage (referral).
//  Extrait de routes/mobile.js. Monté via registerSocialRoutes(router, deps).
//  Routes entrelacées à l'origine ; regroupées ici car thématiquement liées et
//  partageant les helpers de parrainage (genReferralCode/ensureReferralCode).
// ════════════════════════════════════════════════════════════════════════════
const crypto = require('crypto');
const { pool } = require('../../config/database');
const { generateDuelQuiz, addTransaction } = require('../../middleware/index');

module.exports = function registerSocialRoutes(router, deps) {
  const { requireToken, notify, getUserLangs, isUserPremium, FREE_LIMITS, countToday, creditReferralByCode } = deps;

// ── GET /api/m/duels : duels en attente + bilan ──────────────────────────────
router.get('/api/m/duels', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const langs = await getUserLangs(uid);
    const [pending, stats, recent, bullies, wordsRow] = await Promise.all([
      pool.query(
        `SELECT d.id, d.bet_amount, d.status, d.created_at,
                u1.name AS challenger_name, u2.name AS opponent_name,
                CASE WHEN d.challenger_id = $1 THEN u2.avatar_icon ELSE u1.avatar_icon END AS opponent_avatar_icon,
                CASE WHEN d.challenger_id = $1 THEN u2.avatar_color ELSE u1.avatar_color END AS opponent_avatar_color,
                CASE WHEN d.challenger_id = $1 THEN 'challenger' ELSE 'opponent' END AS user_role,
                CASE WHEN d.challenger_id = $1 THEN d.challenger_score ELSE d.opponent_score END AS my_score
         FROM duels d
         JOIN users u1 ON d.challenger_id = u1.id
         JOIN users u2 ON d.opponent_id = u2.id
         WHERE (d.challenger_id = $1 OR d.opponent_id = $1) AND d.status = 'pending'
           -- Un duel en attente > 7 jours est considéré périmé : on ne l'affiche pas.
           AND d.created_at > NOW() - INTERVAL '7 days'
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
                CASE WHEN d.challenger_id = $1 THEN u2.avatar_icon ELSE u1.avatar_icon END AS opponent_avatar_icon,
                CASE WHEN d.challenger_id = $1 THEN u2.avatar_color ELSE u1.avatar_color END AS opponent_avatar_color,
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
           AND opponent.quiz_direction = (SELECT quiz_direction FROM users WHERE id = $1)
           AND opponent.ghost_mode = FALSE
           -- Seulement les rivaux connectés au moins une fois ces 30 derniers jours.
           AND opponent.last_login >= NOW() - INTERVAL '30 days'
         GROUP BY opponent.id, opponent.name
         ORDER BY balance DESC LIMIT 8`, [uid]),
      // Taille de la collection (langue apprise) → gate "trop peu de mots" côté client.
      pool.query(
        `SELECT COUNT(*)::int AS words FROM user_mots um JOIN mots m ON m.id = um.mot_id
         WHERE um.user_id = $1 AND m.lang = $2`, [uid, langs.learning]),
    ]);
    res.json({
      pending: pending.rows,
      wins: stats.rows[0]?.wins || 0,
      losses: stats.rows[0]?.losses || 0,
      recent: recent.rows,
      bullies: bullies.rows,
      words: wordsRow.rows[0]?.words || 0,
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
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.tagline, u.country, u.avatar_icon, u.avatar_color,
         COUNT(*) FILTER (WHERE d.winner_id = u.id)::int AS wins,
         COUNT(*) FILTER (WHERE d.status = 'completed' AND d.winner_id IS NOT NULL
           AND d.winner_id <> u.id)::int AS losses,
         (SELECT COUNT(*)::int FROM user_mots um WHERE um.user_id = u.id) AS total_words,
         (u.last_login IS NOT NULL AND u.last_login >= NOW() - INTERVAL '14 days') AS active
       FROM users u
       LEFT JOIN duels d ON (d.challenger_id = u.id OR d.opponent_id = u.id) AND d.status = 'completed'
       WHERE u.learning_lang = (SELECT learning_lang FROM users WHERE id = $1)
         AND u.ghost_mode = FALSE AND u.role <> 'teacher'
         AND u.name IS NOT NULL AND TRIM(u.name) <> ''
       GROUP BY u.id, u.name, u.tagline, u.country, u.avatar_icon, u.avatar_color, u.last_login
       ORDER BY active DESC, wins DESC, losses ASC, total_words DESC, u.id
       LIMIT 100`, [uid]);
    const leaderboard = rows.map((r) => {
      const played = r.wins + r.losses;
      const { active, ...rest } = r;
      return { ...rest, ratio: played > 0 ? Math.round((r.wins / played) * 100) : 0, sleeping: !active, isMe: r.id === uid };
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
    // Lien vers l'app web RN (app.jiayou.fr) qui capte ?ref= ; jiayou.fr est le
    // site vitrine et n'embarque pas la logique de parrainage.
    const base = process.env.APP_WEB_URL || 'https://app.jiayou.fr';
    res.json({ code, link: `${base}/?ref=${encodeURIComponent(code)}` });
  } catch (e) {
    console.error('m/referral error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/referral/check?code= : valide un code saisi à l'inscription ────
// PUBLIC (pas de requireToken) : le champ « code » vit sur l'écran de connexion,
// AVANT que le compte (donc le token) n'existe. Renvoie { valid, name } pour un
// feedback live. L'auto-parrainage est de toute façon bloqué côté serveur au
// moment du crédit (creditReferralByCode, id !== userId).
router.get('/api/m/referral/check', async (req, res) => {
  try {
    const norm = String(req.query.code || '').trim().toUpperCase();
    if (!norm) return res.json({ valid: false });
    const r = await pool.query(
      'SELECT name FROM users WHERE upper(referral_code) = $1', [norm]);
    if (!r.rows.length) return res.json({ valid: false });
    const first = (r.rows[0].name || '').trim().split(' ')[0] || null;
    res.json({ valid: true, name: first });
  } catch (e) {
    console.error('m/referral/check error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/duels/players?q= : recherche d'adversaires (même direction) ───
router.get('/api/m/duels/players', requireToken, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ players: [] });
    const { rows } = await pool.query(
      `SELECT id, name FROM users
       WHERE name ILIKE $1 AND id <> $2 AND ghost_mode = FALSE
         AND learning_lang = (SELECT learning_lang FROM users WHERE id = $2)
       ORDER BY name ASC LIMIT 8`,
      [`%${q}%`, req.tokenUser.id]
    );
    res.json({ players: rows });
  } catch (e) {
    console.error('m/duels players error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/duels/recent-opponents : adversaires déjà affrontés ────────────
// Suggestions sous le champ "opponent" du popup. Distinct, plus récents d'abord,
// même direction, non fantômes. (Enregistrée AVANT /:id pour ne pas être masquée.)
router.get('/api/m/duels/recent-opponents', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const { rows } = await pool.query(
      `SELECT o.id, o.name, MAX(d.created_at) AS last_at
       FROM duels d
       JOIN users o ON o.id = CASE WHEN d.challenger_id = $1 THEN d.opponent_id ELSE d.challenger_id END
       WHERE (d.challenger_id = $1 OR d.opponent_id = $1)
         AND o.id <> $1 AND o.ghost_mode = FALSE
         AND o.learning_lang = (SELECT learning_lang FROM users WHERE id = $1)
       GROUP BY o.id, o.name
       ORDER BY last_at DESC
       LIMIT 5`,
      [uid]
    );
    res.json({ players: rows.map((r) => ({ id: r.id, name: r.name })) });
  } catch (e) {
    console.error('m/duels recent-opponents error:', e);
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

  // Limite gratuite : N duel lancé par jour (le premium lève la limite).
  if (!(await isUserPremium(challengerId))) {
    const today = await countToday('duels', 'challenger_id', 'created_at', challengerId);
    if (today >= FREE_LIMITS.duelPerDay) {
      return res.status(403).json({
        error: `Daily duel limit reached (${FREE_LIMITS.duelPerDay}/day on Free).`,
        limitReached: true, upgradeRequired: true, feature: 'duel',
      });
    }
  }

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

    const duelLang = (await getUserLangs(challengerId)).learning; // cours du défi (2 joueurs même langue)
    const ins = await client.query(
      `INSERT INTO duels
        (challenger_id, opponent_id, duel_type, word_count, quiz_type, quiz_data, bet_amount, status, lang)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8) RETURNING id`,
      [challengerId, opponent_id, duel_type, word_count, quiz_type, JSON.stringify(quizData), bet, duelLang]
    );
    await client.query('COMMIT');
    const newDuelId = ins.rows[0].id;
    // Notif "nouveau duel" pour l'adversaire (best-effort).
    if (opponent_id && opponent_id !== challengerId) {
      pool.query('SELECT name FROM users WHERE id = $1', [challengerId])
        .then((r) => notify(opponent_id, 'duel_new', 'New duel ⚔️', `${r.rows[0]?.name || 'Someone'} challenged you to a duel.`, { duelId: newDuelId }))
        .catch(() => {});
    }
    res.json({ success: true, duelId: newDuelId });
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
      `SELECT d.*, u1.name AS challenger_name, u2.name AS opponent_name,
              u1.avatar_icon AS challenger_avatar_icon, u1.avatar_color AS challenger_avatar_color,
              u2.avatar_icon AS opponent_avatar_icon, u2.avatar_color AS opponent_avatar_color
       FROM duels d JOIN users u1 ON d.challenger_id = u1.id JOIN users u2 ON d.opponent_id = u2.id
       WHERE d.id = $1 AND (d.challenger_id = $2 OR d.opponent_id = $2)`, [id, uid]);
    if (!rows.length) return res.status(404).json({ error: 'Duel not found' });
    const d = rows[0];
    const isChallenger = d.challenger_id === uid;
    const qd = typeof d.quiz_data === 'string' ? JSON.parse(d.quiz_data || '{}') : (d.quiz_data || {});
    const myScore = isChallenger ? d.challenger_score : d.opponent_score;
    const oppScore = isChallenger ? d.opponent_score : d.challenger_score;
    // Un joueur qui n'a pas encore joué ouvre ce duel en attente → on note l'ouverture.
    // Le cron de forfait épargne les duels ouverts récemment (anti « expiré en pleine
    // partie »). Fire-and-forget, ne bloque pas la réponse.
    if (d.status === 'pending' && myScore === null) {
      pool.query('UPDATE duels SET opened_at = NOW() WHERE id = $1', [id]).catch(() => {});
    }
    // Enrichit les mots (snapshot) avec, POUR CE JOUEUR : meaning_id (sens primaire)
    // + owned → permet de capturer depuis l'écran de résultat un mot rencontré non
    // possédé (duels aléatoires). Le snapshot ne stocke que l'id du mot.
    const wordsSnap = Array.isArray(qd.words) ? qd.words : [];
    const wIds = wordsSnap.map((w) => w.id).filter(Boolean);
    if (wIds.length) {
      // Le snapshot fige la traduction dans la langue de l'INITIATEUR uniquement.
      // On la ré-résout POUR CE JOUEUR dans sa langue native ; à défaut on retombe
      // sur l'anglais (fallback universel garanti par la génération) et on signale
      // `tr_missing` pour que le front affiche « traduction indispo dans ta langue ».
      const { rows: meta } = await pool.query(
        `SELECT m.id,
                (SELECT min(meaning_id) FROM lexeme_senses ls WHERE ls.mot_id = m.id) AS meaning_id,
                EXISTS(SELECT 1 FROM user_mots um WHERE um.user_id = $2 AND um.mot_id = m.id) AS owned,
                mot_tr(m.id, (SELECT COALESCE(native_lang, 'en') FROM users WHERE id = $2)) AS tr_native,
                mot_tr(m.id, 'en') AS tr_en
         FROM mots m WHERE m.id = ANY($1)`, [wIds, uid]);
      const byId = new Map(meta.map((r) => [r.id, r]));
      wordsSnap.forEach((w) => {
        const mm = byId.get(w.id);
        if (!mm) return;
        w.meaning_id = mm.meaning_id;
        w.owned = mm.owned;
        const nat = (mm.tr_native || '').trim();
        const en = (mm.tr_en || '').trim();
        if (nat) { w.english = nat; w.tr_missing = false; }
        else if (en) { w.english = en; w.tr_missing = true; }
        // Sinon (ni native ni anglais) : on garde la valeur du snapshot.
      });
    }
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
      opponent_avatar_icon: isChallenger ? d.opponent_avatar_icon : d.challenger_avatar_icon,
      opponent_avatar_color: isChallenger ? d.opponent_avatar_color : d.challenger_avatar_color,
      my_name: isChallenger ? d.challenger_name : d.opponent_name,
      my_avatar_icon: isChallenger ? d.challenger_avatar_icon : d.opponent_avatar_icon,
      my_avatar_color: isChallenger ? d.challenger_avatar_color : d.opponent_avatar_color,
      words: wordsSnap,
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
    // Notifs de résultat pour les deux joueurs (best-effort).
    if (bothPlayed) {
      (async () => {
        const { rows: u } = await pool.query('SELECT id, name FROM users WHERE id = ANY($1::int[])', [[cur.challenger_id, cur.opponent_id]]);
        const nameOf = (pid) => u.find((x) => x.id === pid)?.name || 'your opponent';
        for (const pid of [cur.challenger_id, cur.opponent_id]) {
          const opp = pid === cur.challenger_id ? cur.opponent_id : cur.challenger_id;
          let title, body;
          if (winnerId === null) { title = 'Duel draw 🤝'; body = `Your duel with ${nameOf(opp)} ended in a draw.`; }
          else if (winnerId === pid) { title = 'You won your duel! 🏆'; body = `You beat ${nameOf(opp)}${cur.bet_amount > 0 ? ` — +${cur.bet_amount * 2} ₵` : ''}.`; }
          else { title = 'Duel lost 😔'; body = `${nameOf(opp)} beat you this time.`; }
          await notify(pid, 'duel_result', title, body, { duelId: id });
        }
      })().catch(() => {});
    }
    res.json({ success: true, duel_completed: bothPlayed, winner_id: winnerId, you_won: winnerId === uid });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/duel submit error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

};
