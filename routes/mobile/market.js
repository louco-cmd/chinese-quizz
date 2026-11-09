// ════════════════════════════════════════════════════════════════════════════
//  JIASTORE — marketplace de packs (liste/détail/achat/promotion/création),
//  mes packs / achetés, wallet, recherche users, bank (red-envelopes).
//  Extrait de routes/mobile.js. Monté via registerMarketRoutes(router, deps).
// ════════════════════════════════════════════════════════════════════════════
const { pool } = require('../../config/database');
const cedict = require('../../lib/cedict');

module.exports = function registerMarketRoutes(router, deps) {
  const { requireToken, notify, isUserPremium, FREE_LIMITS, getUserLangs, syncConceptSiblings, splitSenses, verifyRequired, isVerified, learnableLangs, PREMIUM_PACK_COVERS } = deps;

// ══ JiaStore : marketplace de packs de mots ═══════════════════════════════════

// ── GET /api/m/market/packs : liste (recherche + filtre prix + tri) ──────────
router.get('/api/m/market/packs', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const q = (req.query.q || '').trim();
    const min = Number.isFinite(+req.query.min) ? Math.max(0, parseInt(req.query.min, 10) || 0) : 0;
    const max = Number.isFinite(+req.query.max) && req.query.max !== '' ? parseInt(req.query.max, 10) : 1000000;
    const sortMap = {
      // Défaut : score = ventes + bonus nouveauté (+3 si < 7 j). Les ventes
      // dominent, mais un pack récent remonte un peu (équivaut à 3 achats).
      featured: "(wp.sales_count + CASE WHEN wp.created_at > NOW() - INTERVAL '7 days' THEN 3 ELSE 0 END) DESC, wp.created_at DESC",
      recent: 'wp.created_at DESC',
      price_asc: 'wp.price ASC, wp.created_at DESC',
      price_desc: 'wp.price DESC, wp.created_at DESC',
      popular: 'wp.sales_count DESC, wp.created_at DESC',
    };
    // Le pack dont la promo est ACTIVE MAINTENANT (fenêtre from→until) remonte en
    // tête, quel que soit le tri. Le front l'isole en carte « mise en avant ».
    const ACTIVE = '(wp.boosted_until > NOW() AND (wp.boosted_from IS NULL OR wp.boosted_from <= NOW()))';
    // COALESCE évite que boosted_until IS NULL produise ACTIVE = NULL → les packs
    // jamais boostés (NULL) ne doivent pas passer avant les packs à boost expiré (false).
    const orderBy = `COALESCE(${ACTIVE}, false) DESC, ` + (sortMap[req.query.sort] || sortMap.featured);

    // Un pack couvre UNE PAIRE de langues (celle de son créateur). On le montre
    // uniquement aux apprenants de CETTE paire, dans un sens OU l'autre (réciprocité
    // zh↔en : montré à zh→en ET en→zh), mais JAMAIS à une autre paire — un pack
    // zh↔en est culturellement chinois et n'a pas de sens pour un apprenant fr↔en.
    // On exige AUSSI que chaque concept soit atteignable dans les deux langues de la
    // paire du viewer (réachabilité) → un pack incomplet reste caché. L'affichage
    // est ensuite orienté selon le viewer (gauche = langue apprise, droite = trad).
    // En onboarding les langues ne sont pas encore persistées → le front peut les
    // passer en query pour prévisualiser la bonne paire.
    const stored = await getUserLangs(uid);
    const qLearn = learnableLangs().includes(req.query.learning) ? req.query.learning : null;
    const qNative = learnableLangs().includes(req.query.native) ? req.query.native : null;
    const langs = { learning: qLearn || stored.learning, native: qNative || stored.native };
    const params = [uid, min, max, langs.learning, langs.native];
    let where = `wp.published = TRUE AND wp.price >= $2 AND wp.price <= $3
      AND (wp.hidden_until IS NULL OR wp.hidden_until <= NOW())
      AND CASE WHEN wp.is_official THEN (wp.lang = $4 AND wp.native_lang = $5)
               ELSE ((wp.lang = $4 AND wp.native_lang = $5) OR (wp.lang = $5 AND wp.native_lang = $4)) END
      AND NOT EXISTS (
        SELECT 1 FROM word_pack_items i2 JOIN mots pm ON pm.id = i2.mot_id
        WHERE i2.pack_id = wp.id
          AND (NOT EXISTS (
                SELECT 1 FROM lexeme_senses a JOIN lexeme_senses b ON b.meaning_id = a.meaning_id
                JOIN mots sib ON sib.id = b.mot_id
                WHERE a.mot_id = pm.id AND sib.lang = $4)
            OR NOT EXISTS (
                SELECT 1 FROM lexeme_senses a JOIN lexeme_senses b ON b.meaning_id = a.meaning_id
                JOIN mots sib ON sib.id = b.mot_id
                WHERE a.mot_id = pm.id AND sib.lang = $5))
      )`;
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (wp.title ILIKE $${params.length} OR wp.description ILIKE $${params.length} OR COALESCE(u.name, wp.creator_name, '') ILIKE $${params.length})`;
    }
    const { rows } = await pool.query(
      `SELECT wp.id, wp.title, wp.description, wp.price, wp.cover_key, wp.cover_color, wp.cover_icon, wp.logo_url, wp.is_official, wp.sales_count,
              wp.boosted_until, ${ACTIVE} AS boosted,
              wp.discount_pct,
              (CASE WHEN ${ACTIVE} AND wp.discount_pct > 0
                    THEN ROUND(wp.price * (100 - wp.discount_pct) / 100.0)::int ELSE wp.price END) AS effective_price,
              COALESCE(u.name, wp.creator_name, 'Anonymous') AS creator,
              (SELECT COUNT(*) FROM word_pack_items i WHERE i.pack_id = wp.id)::int AS word_count,
              -- Mots possédés DANS LA LANGUE APPRISE du viewer ($4) — pas cross-langue.
              -- Sur un parcours miroir, posséder « manger » (fr) ne compte pas le pack
              -- comme possédé côté en (où l'on n'a pas « to eat »).
              (SELECT COUNT(*) FROM word_pack_items i
                 WHERE i.pack_id = wp.id AND EXISTS (
                   SELECT 1 FROM lexeme_senses lp
                   JOIN user_mots um ON um.meaning_id = lp.meaning_id AND um.user_id = $1
                   JOIN mots mo ON mo.id = um.mot_id AND mo.lang = $4
                   WHERE lp.mot_id = i.mot_id))::int AS owned_words,
              (wp.created_at > NOW() - INTERVAL '7 days') AS is_new,
              (wp.creator_id = $1) AS is_mine,
              -- Possédé = ACQUIS : acheté, OU c'est SON pack et on en a tous les mots
              -- dans la langue apprise courante (donc « possédé » sur le parcours de la
              -- langue du pack, pas sur un parcours miroir). Simplement CONNAÎTRE le
              -- vocabulaire (sans l'avoir acheté ni créé) ne compte PAS comme possédé.
              (EXISTS(SELECT 1 FROM pack_purchases pp WHERE pp.pack_id = wp.id AND pp.buyer_id = $1)
                OR (wp.creator_id = $1
                    AND (SELECT COUNT(*) FROM word_pack_items i WHERE i.pack_id = wp.id) > 0
                    AND NOT EXISTS (
                      SELECT 1 FROM word_pack_items i WHERE i.pack_id = wp.id AND NOT EXISTS (
                        SELECT 1 FROM lexeme_senses lp
                        JOIN user_mots um ON um.meaning_id = lp.meaning_id AND um.user_id = $1
                        JOIN mots mo ON mo.id = um.mot_id AND mo.lang = $4
                        WHERE lp.mot_id = i.mot_id)))) AS owned
       FROM word_packs wp
       LEFT JOIN users u ON u.id = wp.creator_id
       WHERE ${where}
       ORDER BY ${orderBy}`, params);
    res.json({ packs: rows });
  } catch (e) {
    console.error('m/market packs error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/market/packs/:id : détail + aperçu des mots ────────────────────
router.get('/api/m/market/packs/:id', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid pack' });
    // Langues du viewer : servent à l'affichage orienté-viewer ET au décompte des
    // mots possédés DANS LA LANGUE APPRISE (parcours-conscient, cohérent avec la liste).
    const vlangs = await getUserLangs(uid);
    const { rows } = await pool.query(
      `SELECT wp.id, wp.title, wp.description, wp.price, wp.cover_key, wp.cover_color, wp.cover_icon, wp.logo_url, wp.is_official, wp.sales_count,
              wp.creator_id, wp.lang, wp.native_lang,
              wp.boosted_until, wp.boosted_from,
              (wp.boosted_until > NOW() AND (wp.boosted_from IS NULL OR wp.boosted_from <= NOW())) AS boosted,
              wp.discount_pct,
              (CASE WHEN wp.boosted_until > NOW() AND (wp.boosted_from IS NULL OR wp.boosted_from <= NOW()) AND wp.discount_pct > 0
                    THEN ROUND(wp.price * (100 - wp.discount_pct) / 100.0)::int ELSE wp.price END) AS effective_price,
              -- Fin de la file d'attente des promos (hors ce pack) → date de départ estimée.
              (SELECT MAX(w2.boosted_until) FROM word_packs w2 WHERE w2.boosted_until > NOW() AND w2.id <> wp.id) AS promo_queue_until,
              COALESCE(u.name, wp.creator_name, 'Anonymous') AS creator,
              (SELECT COUNT(*) FROM word_pack_items i WHERE i.pack_id = wp.id)::int AS word_count,
              -- Mots possédés DANS LA LANGUE APPRISE du viewer ($3) — pas cross-langue.
              (SELECT COUNT(*) FROM word_pack_items i
                 WHERE i.pack_id = wp.id AND EXISTS(
                   SELECT 1 FROM lexeme_senses lp
                   JOIN user_mots um ON um.meaning_id = lp.meaning_id AND um.user_id = $1
                   JOIN mots mo ON mo.id = um.mot_id AND mo.lang = $3
                   WHERE lp.mot_id = i.mot_id))::int AS owned_words,
              EXISTS(SELECT 1 FROM pack_purchases pp WHERE pp.pack_id = wp.id AND pp.buyer_id = $1) AS owned
       FROM word_packs wp
       LEFT JOIN users u ON u.id = wp.creator_id
       WHERE wp.id = $2 AND wp.published = TRUE`, [uid, id, vlangs.learning]);
    if (!rows.length) return res.status(404).json({ error: 'Pack not found' });
    const pack = rows[0];
    pack.isMine = pack.creator_id === uid;
    delete pack.creator_id;
    // Possédé = acheté OU (mon pack ET j'en ai TOUS les mots dans la langue apprise) —
    // même règle que la liste. Un créateur ne « possède » son pack que sur le parcours
    // où il en a les mots ; sur un parcours miroir il devra l'acquérir (gratuitement).
    pack.owned = pack.owned || (pack.isMine && pack.word_count > 0 && pack.owned_words >= pack.word_count);
    // Créateur → toujours la liste complète (c'est son contenu) ; acheteur possédant →
    // complète aussi ; sinon aperçu de 3.
    const full = pack.owned || pack.isMine;
    // Affichage ORIENTÉ VIEWER : pour chaque item, on résout le concept vers le
    // lexème de la langue APPRISE (colonne gauche) et de la langue CONNUE (droite),
    // peu importe la langue du mot stocké. Un pack de concepts s'affiche donc dans
    // le sens de CHAQUE apprenant (zh→en le voit zh|en ; en→zh le voit en|zh).
    const { rows: words } = await pool.query(
      `SELECT i.mot_id AS id,
              (SELECT string_agg(DISTINCT lx.chinese, ' / ' ORDER BY lx.chinese)
                 FROM lexeme_senses a JOIN lexeme_senses b ON b.meaning_id = a.meaning_id
                 JOIN mots lx ON lx.id = b.mot_id
                 WHERE a.mot_id = i.mot_id AND lx.lang = $2) AS chinese,
              (SELECT lx.pinyin
                 FROM lexeme_senses a JOIN lexeme_senses b ON b.meaning_id = a.meaning_id
                 JOIN mots lx ON lx.id = b.mot_id
                 WHERE a.mot_id = i.mot_id AND lx.lang = $2 AND lx.pinyin IS NOT NULL
                 ORDER BY lx.id LIMIT 1) AS pinyin,
              (SELECT string_agg(DISTINCT lx.chinese, ' / ' ORDER BY lx.chinese)
                 FROM lexeme_senses a JOIN lexeme_senses b ON b.meaning_id = a.meaning_id
                 JOIN mots lx ON lx.id = b.mot_id
                 WHERE a.mot_id = i.mot_id AND lx.lang = $3) AS english,
              -- Surface CHINOISE du concept (pour l'édition, non encore câblée hors zh).
              (SELECT string_agg(DISTINCT lx.chinese, ' / ' ORDER BY lx.chinese)
                 FROM lexeme_senses a JOIN lexeme_senses b ON b.meaning_id = a.meaning_id
                 JOIN mots lx ON lx.id = b.mot_id
                 WHERE a.mot_id = i.mot_id AND lx.lang = 'zh') AS zh,
              -- Surface RÉELLE du lexème de l'item (le mot curé, PAS l'agrégat du
              -- concept). Sert au RÉ-REMPLISSAGE à l'édition : réinjecter l'agrégat
              -- « A / B » ferait une ligne non-possédable (planPack ne trouve aucun
              -- lexème « A / B ») → faux « non possédé » + re-demande d'achat/trad.
              (SELECT chinese FROM mots WHERE id = i.mot_id) AS raw
       FROM word_pack_items i WHERE i.pack_id = $1 ORDER BY i.mot_id`,
      [id, vlangs.learning, vlangs.native]);
    if (full) { res.json({ pack, words }); return; }
    // Aperçu : on montre TOUS les mots proposés, mais la traduction n'est visible
    // que pour les 3 premiers. Pour les suivants on NE renvoie PAS la traduction
    // (anti-triche) → le front la floute. `zh` (surface d'édition) aussi masqué.
    const UNLOCKED = 3;
    const preview = words.map((w, i) => (i < UNLOCKED ? w : { id: w.id, chinese: w.chinese, pinyin: w.pinyin, english: null, zh: null, locked: true }));
    res.json({ pack, preview });
  } catch (e) {
    console.error('m/market pack detail error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/market/packs/:id/buy : achat atomique ────────────────────────
router.post('/api/m/market/packs/:id/buy', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid pack' });
  // Langue apprise : ce qu'on ajoute à la collection est le lexème du concept DANS
  // cette langue (un pack zh↔en acheté par un apprenant d'anglais ajoute les mots
  // ANGLAIS des concepts, pas les mots chinois). CTE partagée pour compter/insérer.
  const langs = await getUserLangs(uid);
  // Pour chaque item du pack → son sens primaire → le(s) lexème(s) de la langue
  // apprise reliés à ce sens. C'est ce qui atterrit dans user_mots.
  const targetsCTE = `
    items AS (
      SELECT i.mot_id,
             (SELECT min(meaning_id) FROM lexeme_senses WHERE mot_id = i.mot_id) AS meaning_id,
             (SELECT lang FROM mots WHERE id = i.mot_id) AS item_lang
      FROM word_pack_items i WHERE i.pack_id = $2
    ),
    -- Un target par item du pack : si le mot du pack est DÉJÀ dans la langue apprise
    -- (cas normal), on le garde tel quel (curation du pack préservée) ; sinon (sens
    -- réciproque) on prend un lexème de la langue apprise du même concept.
    targets AS (
      SELECT DISTINCT ON (it.mot_id)
             CASE WHEN it.item_lang = $3 THEN it.mot_id ELSE learn.id END AS mot_id,
             it.meaning_id
      FROM items it
      LEFT JOIN lexeme_senses ls ON ls.meaning_id = it.meaning_id
      LEFT JOIN mots learn ON learn.id = ls.mot_id AND learn.lang = $3
      WHERE it.meaning_id IS NOT NULL
        AND (it.item_lang = $3 OR learn.id IS NOT NULL)
      ORDER BY it.mot_id, learn.id
    )`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: pk } = await client.query(
      `SELECT id, title, price, creator_id, cover_key,
              (CASE WHEN boosted_until > NOW() AND (boosted_from IS NULL OR boosted_from <= NOW()) AND discount_pct > 0
                    THEN ROUND(price * (100 - discount_pct) / 100.0)::int ELSE price END) AS effective_price
       FROM word_packs WHERE id = $1 AND published = TRUE FOR UPDATE`, [id]);
    if (!pk.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pack not found' }); }
    const pack = pk[0];
    // Le CRÉATEUR peut acquérir SON propre pack GRATUITEMENT (ex. récupérer les mots
    // dans la langue d'un parcours miroir) : pas de paiement, pas de crédit à
    // lui-même, pas d'enregistrement d'achat — juste l'ajout des mots. Sinon achat
    // normal (paiement + crédit créateur + purchase).
    const isCreator = pack.creator_id === uid;
    // Prix effectif = remisé si une promo (boost + discount) est active.
    const price = isCreator ? 0 : pack.effective_price;

    if (!isCreator) {
      const { rows: already } = await client.query(
        'SELECT 1 FROM pack_purchases WHERE pack_id = $1 AND buyer_id = $2', [id, uid]);
      if (already.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'You already own this pack.' }); }
    }

    // Limites gratuites : packs HSK avancés réservés au premium + plafond d'achats.
    // Ne s'appliquent pas au créateur récupérant son propre pack.
    if (!isCreator && !(await isUserPremium(uid))) {
      if (PREMIUM_PACK_COVERS.includes(pack.cover_key)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'HSK 4/5/6 packs are Premium.', upgradeRequired: true, feature: 'hsk_pack' });
      }
      const { rows: bought } = await client.query('SELECT COUNT(*)::int AS n FROM pack_purchases WHERE buyer_id = $1', [uid]);
      if (bought[0].n >= FREE_LIMITS.packsMax) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: `Free users can buy up to ${FREE_LIMITS.packsMax} packs.`, upgradeRequired: true, feature: 'pack_limit' });
      }
      // Plafond de mots : un pack ne doit pas faire dépasser les 600 mots du free.
      // On compte les mots du pack pas encore possédés (ceux qui seraient ajoutés).
      const { rows: wc } = await client.query('SELECT COUNT(*)::int AS n FROM user_mots WHERE user_id = $1', [uid]);
      const { rows: newW } = await client.query(
        `WITH ${targetsCTE}
         SELECT COUNT(*)::int AS n FROM targets t
         WHERE NOT EXISTS (SELECT 1 FROM user_mots um
                           WHERE um.user_id = $1 AND um.mot_id = t.mot_id AND um.meaning_id = t.meaning_id)`,
        [uid, id, langs.learning]);
      if (wc[0].n + newW[0].n > 600) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Free limit reached (600 words). This pack would exceed it. Go Premium for unlimited.', upgradeRequired: true, feature: 'words', max: 600 });
      }
    }

    const { rows: cnt } = await client.query('SELECT COUNT(*)::int AS n FROM word_pack_items WHERE pack_id = $1', [id]);
    if (cnt[0].n === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'This pack is not available yet.' }); }

    const { rows: bal } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [uid]);
    if (!bal.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }
    if (bal[0].balance < price) { await client.query('ROLLBACK'); return res.status(402).json({ error: 'Not enough coins', insufficient: true, cost: price, balance: bal[0].balance }); }

    // Ajoute à la collection le lexème de la langue APPRISE de chaque concept du
    // pack (pas forcément le lexème stocké dans le pack — cf. sens zh↔en réciproque).
    const ins = await client.query(
      `WITH ${targetsCTE}
       INSERT INTO user_mots (user_id, mot_id, meaning_id, score, nb_quiz, nb_correct, last_seen)
       SELECT $1, t.mot_id, t.meaning_id, 0, 0, 0, NULL FROM targets t
       WHERE NOT EXISTS (SELECT 1 FROM user_mots um
                         WHERE um.user_id = $1 AND um.mot_id = t.mot_id AND um.meaning_id = t.meaning_id)
       ON CONFLICT DO NOTHING
       RETURNING mot_id`, [uid, id, langs.learning]);
    const added = ins.rowCount;

    // Paiement + enregistrement : UNIQUEMENT pour un achat réel (pas le créateur).
    if (!isCreator) {
      // Débit acheteur (prix EFFECTIF = remisé si promo active)
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [price, uid]);
      await client.query(
        `INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, 'pack_purchase', $3)`,
        [uid, -price, `Pack: ${pack.title}`]);

      // Crédit créateur (packs communautaires uniquement ; officiels = puits de coins)
      if (pack.creator_id && price > 0) {
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [price, pack.creator_id]);
        await client.query(
          `INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, 'pack_sale', $3)`,
          [pack.creator_id, price, `Sold: ${pack.title}`]);
      }

      await client.query(
        'INSERT INTO pack_purchases (pack_id, buyer_id, price_paid) VALUES ($1, $2, $3)', [id, uid, price]);
      await client.query('UPDATE word_packs SET sales_count = sales_count + 1 WHERE id = $1', [id]);
    }

    await client.query('COMMIT');
    // Notif "vente de pack" pour le créateur (achats réels uniquement).
    if (!isCreator && pack.creator_id && pack.creator_id !== uid) {
      pool.query('SELECT name FROM users WHERE id = $1', [uid])
        .then((r) => notify(pack.creator_id, 'pack_sold', 'Pack sold! 🎉', `${r.rows[0]?.name || 'Someone'} bought "${pack.title}" — +${price} ₵.`, { packId: id }))
        .catch(() => {});
    }
    res.json({ success: true, wordsAdded: added, newBalance: bal[0].balance - price });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/market buy error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

// ── Promotion de pack (puits de coins) : mettre son pack en avant dans le store.
// Tarif 15 ₵/h, DÉGRESSIF selon la durée réservée (incite aux longues promos).
const PROMOTE_BASE_PER_HOUR = 10;
function promoteDiscount(hours) {
  if (hours >= 72) return 0.30;
  if (hours >= 24) return 0.20;
  if (hours >= 6) return 0.10;
  return 0;
}
function promoteCost(hours) {
  return Math.max(1, Math.round(PROMOTE_BASE_PER_HOUR * hours * (1 - promoteDiscount(hours))));
}

// POST /api/m/market/packs/:id/promote { hours } — booste SON propre pack. Débite
// les coins et empile sur un boost en cours (prolonge). Recalcule le coût côté
// serveur (le front n'est qu'un affichage).
router.post('/api/m/market/packs/:id/promote', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  const id = parseInt(req.params.id, 10);
  const hours = parseInt(req.body?.hours, 10);
  if (!id) return res.status(400).json({ error: 'Invalid pack' });
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) return res.status(400).json({ error: 'Invalid duration (1–720h).' });
  // Remise TEMPORAIRE optionnelle sur le prix du pack (0 = aucune), appliquée tant
  // que le boost est actif. Bornée à un jeu de valeurs.
  const ALLOWED_DISCOUNTS = [0, 10, 20, 30, 50];
  const discountPct = ALLOWED_DISCOUNTS.includes(parseInt(req.body?.discountPct, 10)) ? parseInt(req.body.discountPct, 10) : 0;
  const cost = promoteCost(hours);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: pk } = await client.query('SELECT creator_id, boosted_until FROM word_packs WHERE id = $1 FOR UPDATE', [id]);
    if (!pk.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pack not found.' }); }
    if (pk[0].creator_id !== uid) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Not your pack.' }); }
    const { rows: bal } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [uid]);
    const balance = bal[0]?.balance ?? 0;
    if (balance < cost) {
      await client.query('ROLLBACK');
      return res.status(402).json({ error: `Not enough coins (need ${cost} ₵).`, insufficient: true, cost, balance });
    }
    // File d'attente : UNE seule promo active à la fois sur tout le store. La
    // nouvelle démarre à la fin de la dernière programmée (hors ce pack), sinon
    // maintenant. Fenêtre = [boosted_from, boosted_until]. Pas de chevauchement.
    const { rows: q } = await client.query(
      `SELECT MAX(boosted_until) AS queue_end FROM word_packs WHERE boosted_until > NOW() AND id <> $1`, [id]);
    const queueEnd = q[0].queue_end; // null si le store est libre
    const { rows: upd } = await client.query(
      `UPDATE word_packs
         SET boosted_from  = GREATEST(NOW(), COALESCE($3::timestamptz, NOW())),
             boosted_until = GREATEST(NOW(), COALESCE($3::timestamptz, NOW())) + ($2 || ' hours')::interval,
             discount_pct  = $4
       WHERE id = $1 RETURNING boosted_from, boosted_until, discount_pct`,
      [id, String(hours), queueEnd, discountPct]);
    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [cost, uid]);
    await client.query(
      `INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, 'pack_promote', $3)`,
      [uid, -cost, `Promote pack #${id} (${hours}h)`]);
    await client.query('COMMIT');
    const startsAt = upd[0].boosted_from;
    res.json({
      success: true,
      boosted_from: startsAt,
      boosted_until: upd[0].boosted_until,
      discount_pct: upd[0].discount_pct,
      scheduled: new Date(startsAt).getTime() > Date.now() + 1000, // programmée (file d'attente)
      cost,
      balance: balance - cost,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/market promote error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

// Extrait la liste de mots chinois (texte collé OU tableau), dédoublonnée.
function extractWordList(body) {
  // Création de pack = « un mot par ligne », TOUTES langues. On ne passe PLUS par le
  // parser Han-centré (parseImportText) : celui-ci ne gardait que `r.chinese` et
  // jetait donc silencieusement toute ligne sans hanzi (mots occidentaux) → popup
  // vide sur un parcours chinois. Découpe verbatim par ligne = prévisible et
  // multilingue. (parseImportText reste utilisé pour l'import en masse.)
  let words;
  if (typeof body?.text === 'string') words = String(body.text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  else if (Array.isArray(body?.words)) words = body.words.map((w) => String(w || '').trim()).filter(Boolean);
  else words = [];
  const seen = new Set();
  return words.filter((w) => (seen.has(w) ? false : seen.add(w)));
}

const ACQUIRE_COST = 3; // coût pour ajouter à sa collection un mot manquant

// ── POST /api/m/market/packs/plan : classe les mots avant publication ────────
// possédés / à acheter (dans le dico) / à traduire (hors dico) + coût (3 ₵/mot
// manquant) + solde. Le client s'en sert pour le checkout.
router.post('/api/m/market/packs/plan', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const langs = await getUserLangs(uid);
    // Langue du CONTENU du pack : DÉCLARÉE par l'utilisateur (sélecteur), validée
    // contre les langues apprenables ; repli sur la langue apprise active.
    const declared = req.body?.lang;
    const learn = (declared && learnableLangs().includes(declared)) ? declared : langs.learning;
    // Trad = l'AUTRE langue de la paire relatif au contenu (réciprocité correcte
    // même si l'utilisateur choisit sa langue native comme contenu du pack).
    const nat = (learn === langs.native) ? langs.learning : langs.native;
    const isZh = learn === 'zh';
    const words = extractWordList(req.body);
    const { rows: bal } = await pool.query('SELECT balance FROM users WHERE id = $1', [uid]);
    const balance = bal[0]?.balance ?? 0;
    if (!words.length) return res.json({ owned: [], toBuy: [], needsTranslation: [], cost: 0, balance });

    // Rapprochement des surfaces insensible à la casse/espaces (no-op en zh), DANS
    // LA LANGUE APPRISE (surface + lang), pour ne pas confondre un homographe d'une
    // autre langue. Les résultats sont RENVOYÉS avec la surface TAPÉE (le front les
    // ré-associe aux lignes saisies).
    const normKey = (s) => String(s || '').trim().toLowerCase();
    const wnorm = words.map(normKey);
    const { rows: ownedRows } = await pool.query(
      `SELECT DISTINCT ON (lower(btrim(m.chinese))) lower(btrim(m.chinese)) AS k, m.pinyin, mot_tr(m.id, $3) AS english
       FROM mots m JOIN user_mots um ON um.mot_id = m.id AND um.user_id = $1
       WHERE lower(btrim(m.chinese)) = ANY($2::text[]) AND m.lang = $4 ORDER BY lower(btrim(m.chinese)), m.id`, [uid, wnorm, nat, learn]);
    const ownedByKey = new Map(ownedRows.map((r) => [r.k, r]));
    const owned = words.filter((w) => ownedByKey.has(normKey(w)))
      .map((w) => ({ chinese: w, pinyin: ownedByKey.get(normKey(w)).pinyin || '', english: ownedByKey.get(normKey(w)).english || '' }));

    const notOwned = words.filter((w) => !ownedByKey.has(normKey(w)));
    let dictByKey = new Map();
    if (notOwned.length) {
      const { rows: dictRows } = await pool.query(
        `SELECT DISTINCT ON (lower(btrim(m.chinese))) lower(btrim(m.chinese)) AS k, m.pinyin, mot_tr(m.id, $2) AS english
         FROM mots m WHERE lower(btrim(m.chinese)) = ANY($1::text[]) AND m.lang = $3 ORDER BY lower(btrim(m.chinese)), m.id`, [notOwned.map(normKey), nat, learn]);
      dictByKey = new Map(dictRows.map((d) => [d.k, d]));
    }
    const toBuy = notOwned.filter((w) => dictByKey.has(normKey(w)))
      .map((w) => ({ chinese: w, pinyin: dictByKey.get(normKey(w)).pinyin || '', english: dictByKey.get(normKey(w)).english || '' }));
    // Mots hors dico → aides à la saisie SPÉCIFIQUES au chinois : pinyin (pinyin-pro)
    // + suggestion CC-CEDICT. Sans objet pour les autres langues (champ vide).
    let toPinyin = null;
    if (isZh) { try { toPinyin = require('pinyin-pro').pinyin; } catch { /* lib absente → pinyin vide */ } }
    const needsTranslation = notOwned.filter((w) => !dictByKey.has(normKey(w))).map((w) => ({
      chinese: w,
      pinyin: toPinyin ? toPinyin(w, { toneType: 'symbol' }) : '',
      // Suggestion de traduction (CC-CEDICT, zh→en uniquement) pour pré-remplir — éditable.
      suggested: isZh ? (cedict.translate(w) || '') : '',
    }));
    const cost = ACQUIRE_COST * (toBuy.length + needsTranslation.length);
    res.json({ owned, toBuy, needsTranslation, cost, balance });
  } catch (e) {
    console.error('m/market plan error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/market/packs : créer un pack (acquiert les mots manquants) ────
// body: title, description, price, text|words, translations {cn:en}, acquire.
// Si des mots ne sont pas possédés : refus (400) sauf `acquire=true`, auquel cas
// on les ajoute à la collection (3 ₵/mot ; création + traduction si hors dico).
router.post('/api/m/market/packs', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  // Gate anti-faux-comptes : publier/vendre un pack exige un email vérifié.
  if (!(await isVerified(uid))) return verifyRequired(res);
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();
  const price = parseInt(req.body?.price, 10);
  const coverColor = req.body?.cover_color ? String(req.body.cover_color).trim().slice(0, 20) : null;
  const coverIcon  = req.body?.cover_icon  ? String(req.body.cover_icon).trim().slice(0, 60)  : null;
  // Langue apprise = langue du CONTENU du pack ; langue connue = la TRADUCTION.
  // (Ex. apprenant le français depuis l'anglais → pack français, trad anglaise.)
  const langs = await getUserLangs(uid);
  let words = extractWordList(req.body);
  let translations = (req.body?.translations && typeof req.body.translations === 'object') ? req.body.translations : {};
  const acquire = req.body?.acquire === true;
  // Garde-fou UX : l'utilisateur a saisi les colonnes à l'envers (mots tapés = sa
  // langue CONNUE, langue apprise mise dans les champs de trad). Le front envoie
  // `swap` → on inverse : les valeurs des champs deviennent les mots (langue
  // apprise = contenu du pack), les mots tapés deviennent leurs traductions.
  // La valeur d'un champ pouvait contenir PLUSIEURS mots séparés (« a,b,c ») — elle
  // servait de traduction (donc découpée). Une fois promue en CONTENU, on la découpe
  // pareil (splitSenses) → chaque valeur devient un mot distinct, plutôt qu'un seul
  // lexème « a,b,c ». Le mot tapé sert de traduction à chacun.
  if (req.body?.swap === true) {
    const nw = []; const nt = {};
    for (const w of words) {
      for (const sense of splitSenses(translations[w])) {
        if (nt[sense] === undefined) { nw.push(sense); nt[sense] = w; }
      }
    }
    words = nw; translations = nt;
  }
  // Mode édition : packId d'un pack existant appartenant à l'utilisateur.
  const editId = Number.isInteger(parseInt(req.body?.packId, 10)) ? parseInt(req.body.packId, 10) : null;

  if (!title || title.length > 80) return res.status(400).json({ error: 'Title is required (max 80 characters).' });
  if (description.length > 300) return res.status(400).json({ error: 'Description is too long (max 300 characters).' });
  if (!Number.isInteger(price) || price < 0 || price > 100000) return res.status(400).json({ error: 'Enter a valid price.' });
  if (words.length < 1) return res.status(400).json({ error: 'Add at least one word.' });
  if (words.length > 500) return res.status(400).json({ error: 'Too many words (max 500).' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Édition : le pack doit exister et appartenir à l'utilisateur.
    let existingLang = null, existingNative = null;
    if (editId) {
      const { rows: own } = await client.query('SELECT creator_id, lang, native_lang FROM word_packs WHERE id = $1 FOR UPDATE', [editId]);
      if (!own.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pack not found.' }); }
      if (own[0].creator_id !== uid) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Not your pack.' }); }
      existingLang = own[0].lang;
      existingNative = own[0].native_lang;
    }
    // Le mot tapé est dans la langue du CONTENU (`content`) ; la traduction va vers
    // l'AUTRE langue de la paire de session (`other`). Langue du contenu : DÉCLARÉE
    // par l'utilisateur (sélecteur, validée) en création ; en édition on garde la
    // langue réelle du pack. `other` = l'autre membre de la paire {apprise, native}
    // relatif au contenu → réciproque correcte quelle que soit la langue choisie
    // (ex. contenu = ma langue native → trad vers ma langue apprise, PAS native→native).
    const declared = req.body?.lang;
    const content = editId
      ? (existingLang || langs.learning)
      : ((declared && learnableLangs().includes(declared)) ? declared : langs.learning);
    const other = editId
      ? (existingNative || (content === langs.native ? langs.learning : langs.native))
      : (content === langs.native ? langs.learning : langs.native);
    const isZh = content === 'zh';
    // Rapprochement des surfaces insensible à la casse/espaces (no-op en zh) : un
    // mot déjà possédé ("Bonjour") doit être reconnu quand l'utilisateur tape
    // "bonjour" — sinon il serait refacturé et re-traduit à tort.
    const normKey = (s) => String(s || '').trim().toLowerCase();
    const wnorm = words.map(normKey);
    const { rows: owned } = await client.query(
      `SELECT DISTINCT ON (lower(btrim(m.chinese))) lower(btrim(m.chinese)) AS k, m.id
       FROM mots m JOIN user_mots um ON um.mot_id = m.id AND um.user_id = $1
       WHERE lower(btrim(m.chinese)) = ANY($2::text[]) AND m.lang = $3
       ORDER BY lower(btrim(m.chinese)), m.id`, [uid, wnorm, content]);
    const ownedByKey = new Map(owned.map((r) => [r.k, r.id]));
    const ownedMap = new Map();
    for (const w of words) { const id = ownedByKey.get(normKey(w)); if (id) ownedMap.set(w, id); }
    const notOwned = words.filter((w) => !ownedMap.has(w));

    if (notOwned.length) {
      if (!acquire) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: "You cannot sell words you don't own yourself.", missing: notOwned });
      }
      const cost = ACQUIRE_COST * notOwned.length;
      const { rows: balRows } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [uid]);
      if ((balRows[0]?.balance ?? 0) < cost) {
        await client.query('ROLLBACK');
        return res.status(402).json({ error: `Not enough coins (need ${cost} ₵).`, insufficient: true, cost, balance: balRows[0]?.balance ?? 0 });
      }
      let toPinyin = null;
      if (isZh) { try { toPinyin = require('pinyin-pro').pinyin; } catch { /* lib absente */ } }
      for (const w of notOwned) {
        // On cible le lexème de la langue APPRISE du concept (le contenu du pack) :
        // c'est lui que le créateur possédera et que verront les apprenants de la
        // même langue. (En zh c'est le hanzi ; en fr/en c'est le mot latin.)
        // Rapprochement insensible à la casse/espaces (comme syncConceptSiblings)
        // pour RÉUTILISER un lexème existant ("Bonjour") plutôt que d'en dupliquer
        // un ("bonjour"). Sans effet en zh (les hanzi n'ont pas de casse).
        const found = await client.query(
          'SELECT id FROM mots WHERE lower(btrim(chinese)) = lower(btrim($1)) AND lang = $2 ORDER BY id LIMIT 1',
          [w, content]);
        let motId;
        if (found.rows.length) {
          motId = found.rows[0].id;
        } else {
          const english = String(translations[w] || '').trim();
          if (!english) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Add a translation for ${w}.`, needsTranslation: [w] });
          }
          const pinyin = toPinyin ? toPinyin(w, { toneType: 'symbol' }) : null;
          const ins = await client.query('INSERT INTO mots (chinese, pinyin, lang) VALUES ($1, $2, $3) RETURNING id', [w, pinyin, content]);
          motId = ins.rows[0].id;
          // Mot NEUF → boîte de sens PROPRE (pas de merge-on-save) : ne pas absorber
          // un concept existant qui partagerait une glose ni contaminer des mots corrects.
          await syncConceptSiblings(client, motId, english, other, { freshBox: true, userId: req.tokenUser.id });
        }
        ownedMap.set(w, motId);
      }
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [cost, uid]);
      await client.query(
        `INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, 'capture_word', $3)`,
        [uid, -cost, `Acquired ${notOwned.length} word(s) for a pack`]);
    }

    // Applique les traductions saisies dans la popup à TOUS les mots du pack
    // (mots déjà en base compris) : remplit celles qui manquaient et enregistre
    // les corrections de l'utilisateur. On ne touche qu'aux mots dont la glose
    // fournie diffère de la traduction actuelle (évite de churner le graphe).
    if (other && other !== content) {
      const uniqIds = [...new Set(words.map((w) => ownedMap.get(w)).filter(Boolean))];
      const curTr = new Map();
      const meaningOf = new Map();
      if (uniqIds.length) {
        const { rows: cur } = await client.query(
          `SELECT m.id,
                  COALESCE(m.meaning_id, (SELECT min(meaning_id) FROM lexeme_senses ls WHERE ls.mot_id = m.id)) AS meaning_id,
                  mot_tr(m.id, $2) AS english
           FROM mots m WHERE m.id = ANY($1::int[])`,
          [uniqIds, other]);
        cur.forEach((r) => { curTr.set(r.id, r.english || ''); meaningOf.set(r.id, r.meaning_id); });
      }
      // Même découpe que syncConceptSiblings → « a; b » et « a / b » sont vus égaux
      // (pas de re-churn du graphe si seule la ponctuation de séparation diffère).
      const norm = (s) => splitSenses(s).map((x) => x.toLowerCase()).sort().join('/');
      for (const w of words) {
        const motId = ownedMap.get(w);
        const gloss = String(translations[w] || '').trim();
        if (!motId || !gloss) continue;
        if (norm(gloss) === norm(curTr.get(motId))) continue; // inchangé → on n'y touche pas
        // Cible le SENS primaire du mot : remplir/corriger sa traduction (dans la
        // langue non-zh de la paire) sans fabriquer de sens orphelin.
        const meaningId = meaningOf.get(motId) || null;
        await syncConceptSiblings(client, motId, gloss, other, { replace: true, meaningId, userId: req.tokenUser.id });
      }
    }

    // Le CRÉATEUR possède chaque concept du pack DANS SA LANGUE APPRISE (visible
    // dans sa collection), pour TOUS les mots — y compris ceux qu'il "possédait"
    // déjà en zh. Sinon un apprenant occidental ne voit pas son propre pack
    // (collection filtrée sur learning_lang) car aucun lexème de sa langue apprise
    // n'aurait été capturé. Idempotent (ON CONFLICT DO NOTHING).
    for (const w of words) {
      const motId = ownedMap.get(w);
      if (!motId) continue;
      const lr = await client.query(
        `SELECT learn.id, ls.meaning_id
           FROM lexeme_senses a
           JOIN lexeme_senses ls ON ls.meaning_id = a.meaning_id
           JOIN mots learn ON learn.id = ls.mot_id AND learn.lang = $2
         WHERE a.mot_id = $1 ORDER BY learn.id LIMIT 1`, [motId, langs.learning]);
      if (!lr.rows.length) continue; // pas de lexème dans la langue apprise → rien à capturer
      await client.query(
        `INSERT INTO user_mots (user_id, mot_id, meaning_id, score)
         VALUES ($1, $2, $3, 0) ON CONFLICT DO NOTHING`,
        [uid, lr.rows[0].id, lr.rows[0].meaning_id]);
    }

    let packId;
    if (editId) {
      // Édition : met à jour les métadonnées et remplace la liste de mots.
      await client.query(
        `UPDATE word_packs SET title = $1, description = $2, price = $3,
          cover_color = COALESCE($5, cover_color), cover_icon = COALESCE($6, cover_icon)
         WHERE id = $4`,
        [title, description || null, price, editId, coverColor, coverIcon]);
      await client.query('DELETE FROM word_pack_items WHERE pack_id = $1', [editId]);
      packId = editId;
    } else {
      // Paire du pack = content (langue apprise) ↔ other (langue connue). Le store
      // filtre sur cette paire dans les DEUX sens (réciprocité) et l'affichage est
      // orienté viewer. Ex. pack fr↔en visible par les apprenants fr-depuis-en ET
      // en-depuis-fr, chacun voyant sa langue apprise à gauche.
      const { rows: pk } = await client.query(
        `INSERT INTO word_packs (creator_id, title, description, price, cover_key, cover_color, cover_icon, is_official, published, lang, native_lang)
         VALUES ($1, $2, $3, $4, 'user', $5, $6, FALSE, TRUE, $7, $8) RETURNING id`,
        [uid, title, description || null, price, coverColor, coverIcon, content, other]);
      packId = pk[0].id;
    }
    const motIds = words.map((w) => ownedMap.get(w));
    await client.query(
      `INSERT INTO word_pack_items (pack_id, mot_id) SELECT $1, UNNEST($2::int[]) ON CONFLICT DO NOTHING`,
      [packId, motIds]);

    // Propagation des mises à jour aux acheteurs : l'achat d'un pack donne droit
    // à ses évolutions. On ajoute à la collection de chaque acheteur les mots du
    // pack qu'il ne possède pas encore (les mots retirés du pack lui restent : on
    // n'enlève jamais un mot déjà étudié). Sur édition uniquement (à la création
    // il n'y a pas encore d'acheteurs).
    let propagated = 0;
    if (editId) {
      const prop = await client.query(
        `INSERT INTO user_mots (user_id, mot_id, meaning_id, score, nb_quiz, nb_correct, last_seen)
         SELECT pp.buyer_id, wpi.mot_id, (SELECT min(meaning_id) FROM lexeme_senses WHERE mot_id = wpi.mot_id), 0, 0, 0, NULL
         FROM pack_purchases pp
         JOIN word_pack_items wpi ON wpi.pack_id = pp.pack_id
         WHERE pp.pack_id = $1
           AND EXISTS (SELECT 1 FROM lexeme_senses WHERE mot_id = wpi.mot_id)
           AND NOT EXISTS (SELECT 1 FROM user_mots um WHERE um.user_id = pp.buyer_id AND um.mot_id = wpi.mot_id)
         ON CONFLICT DO NOTHING`,
        [editId]);
      propagated = prop.rowCount;
    }

    await client.query('COMMIT');

    // Nouveau pack publié → notifie les apprenants de la langue du pack (hors
    // créateur), message localisé par interface_lang. Fire-and-forget : ne bloque
    // jamais la réponse. (Édition = pas de broadcast : le pack n'est pas « nouveau ».)
    if (!editId) {
      const PACK_NEW = {
        en: { title: 'New pack on the store 📦', body: (t) => `“${t}” just landed — add it to your collection!` },
        fr: { title: 'Nouveau pack sur le store 📦', body: (t) => `« ${t} » vient d'arriver — ajoute-le à ta collection !` },
        zh: { title: '商店上新啦 📦', body: (t) => `《${t}》已上架，快来添加到你的词库吧！` },
      };
      // Throttle : 1 broadcast « nouveau pack » par créateur / 24 h. L'UPDATE
      // conditionnel est atomique → pas de course même si 2 packs publiés d'affilée.
      pool.query(
        `UPDATE users SET pack_broadcast_at = NOW()
         WHERE id = $1 AND (pack_broadcast_at IS NULL OR pack_broadcast_at < NOW() - INTERVAL '1 day')
         RETURNING id`, [uid])
        .then(({ rows: won }) => {
          if (!won.length) return; // déjà notifié pour ce créateur aujourd'hui
          return pool.query(
            `SELECT COALESCE(interface_lang, 'en') AS lang, expo_push_token
             FROM users
             WHERE learning_lang = $1 AND id <> $2
               AND expo_push_token IS NOT NULL
               AND notifications_enabled IS NOT FALSE AND notif_packs IS NOT FALSE`,
            [content, uid])
            .then(({ rows }) => {
              const byLang = {};
              for (const r of rows) (byLang[r.lang] = byLang[r.lang] || []).push(r.expo_push_token);
              for (const [lang, tokens] of Object.entries(byLang)) {
                const copy = PACK_NEW[lang] || PACK_NEW.en;
                sendExpoPushBulk(tokens, { title: copy.title, body: copy.body(title), data: { type: 'pack_new', packId } })
                  .catch(() => {});
              }
            });
        })
        .catch((e) => console.error('pack_new broadcast:', e.message));
    }

    res.json({ success: true, id: packId, wordCount: motIds.length, acquired: notOwned.length, edited: !!editId, propagated });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/market create error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

// ── GET /api/m/market/my-packs : packs créés par l'utilisateur ───────────────
router.get('/api/m/market/my-packs', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT wp.id, wp.title, wp.description, wp.price, wp.published, wp.sales_count,
              (SELECT COUNT(*) FROM word_pack_items i WHERE i.pack_id = wp.id)::int AS word_count
       FROM word_packs wp
       WHERE wp.creator_id = $1
       ORDER BY wp.created_at DESC`, [req.tokenUser.id]);
    res.json({ packs: rows });
  } catch (e) {
    console.error('m/market my-packs error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/m/market/purchased-packs : packs achetés par l'utilisateur ──────
router.get('/api/m/market/purchased-packs', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT wp.id, wp.title, wp.price, wp.cover_key, wp.cover_color, wp.cover_icon, wp.logo_url,
              COALESCE(u.name, wp.creator_name, 'Anonymous') AS creator,
              (SELECT COUNT(*) FROM word_pack_items i WHERE i.pack_id = wp.id)::int AS word_count
       FROM pack_purchases pp
       JOIN word_packs wp ON wp.id = pp.pack_id
       LEFT JOIN users u ON u.id = wp.creator_id
       WHERE pp.buyer_id = $1
       ORDER BY pp.created_at DESC`, [req.tokenUser.id]);
    res.json({ packs: rows });
  } catch (e) {
    console.error('m/market purchased-packs error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /api/m/market/packs/:id : éditer un pack (titre/description/prix) ─────
router.put('/api/m/market/packs/:id', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid pack' });
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const price = parseInt(req.body?.price, 10);
    if (!title || title.length > 80) return res.status(400).json({ error: 'Title is required (max 80 characters).' });
    if (description.length > 300) return res.status(400).json({ error: 'Description is too long (max 300 characters).' });
    if (!Number.isInteger(price) || price < 0 || price > 100000) return res.status(400).json({ error: 'Enter a valid price.' });

    const { rowCount } = await pool.query(
      `UPDATE word_packs SET title = $1, description = $2, price = $3
       WHERE id = $4 AND creator_id = $5`,
      [title, description || null, price, id, uid]);
    if (!rowCount) return res.status(404).json({ error: 'Pack not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('m/market update error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/m/market/packs/:id : supprimer un pack (créateur) ─────────────
router.delete('/api/m/market/packs/:id', requireToken, async (req, res) => {
  try {
    const uid = req.tokenUser.id;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid pack' });
    // items + purchases suivent via ON DELETE CASCADE ; les mots déjà achetés
    // restent dans les collections (user_mots n'est pas lié au pack).
    const { rowCount } = await pool.query(
      'DELETE FROM word_packs WHERE id = $1 AND creator_id = $2', [id, uid]);
    if (!rowCount) return res.status(404).json({ error: 'Pack not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('m/market delete error:', e);
    res.status(500).json({ error: 'Server error' });
  }
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

// ══ Red envelopes (虹包) : virements de coins ═════════════════════════════════

// ── GET /api/m/users/search?q= : trouver un destinataire (par nom) ───────────
router.get('/api/m/users/search', requireToken, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 1) return res.json({ users: [] });
    const { rows } = await pool.query(
      `SELECT id, name FROM users
       WHERE name ILIKE $1 AND id <> $2 AND ghost_mode = FALSE
       ORDER BY name ASC LIMIT 8`,
      [`%${q}%`, req.tokenUser.id]);
    res.json({ users: rows });
  } catch (e) {
    console.error('m/users search error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/bank/red-envelope : envoyer un virement ──────────────────────
router.post('/api/m/bank/red-envelope', requireToken, async (req, res) => {
  const uid = req.tokenUser.id;
  // Gate anti-faux-comptes : envoyer des coins exige un email vérifié.
  if (!(await isVerified(uid))) return verifyRequired(res);
  const recipientId = parseInt(req.body?.recipientId, 10);
  const amount = parseInt(req.body?.amount, 10);
  const message = String(req.body?.message || '').trim().slice(0, 140) || null;

  if (!recipientId || recipientId === uid) return res.status(400).json({ error: 'Pick a friend to send to.' });
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100000) return res.status(400).json({ error: 'Enter a valid amount.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: rcpt } = await client.query('SELECT id, name FROM users WHERE id = $1', [recipientId]);
    if (!rcpt.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Recipient not found.' }); }

    const { rows: me } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [uid]);
    if ((me[0]?.balance ?? 0) < amount) { await client.query('ROLLBACK'); return res.status(402).json({ error: 'Not enough coins.', insufficient: true, cost: amount, balance: me[0]?.balance ?? 0 }); }

    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amount, uid]);
    await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, recipientId]);
    await client.query(
      `INSERT INTO red_envelopes (sender_id, recipient_id, amount, message) VALUES ($1, $2, $3, $4)`,
      [uid, recipientId, amount, message]);
    const { rows: sender } = await client.query('SELECT name FROM users WHERE id = $1', [uid]);
    await client.query(
      `INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, 'red_envelope_sent', $3)`,
      [uid, -amount, `Red envelope to ${rcpt[0].name || 'a friend'}`]);
    await client.query(
      `INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, 'red_envelope_received', $3)`,
      [recipientId, amount, `Red envelope from ${sender[0]?.name || 'a friend'}`]);
    await client.query('COMMIT');
    notify(recipientId, 'red_envelope', 'Red envelope received 🧧', `${sender[0]?.name || 'A friend'} sent you ${amount} ₵.`, {});
    res.json({ success: true, newBalance: (me[0].balance - amount) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('m/red-envelope send error:', e);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

// ── GET /api/m/red-envelopes/unseen : à révéler à la prochaine connexion ─────
router.get('/api/m/red-envelopes/unseen', requireToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT re.id, re.amount, re.message, re.created_at, COALESCE(s.name, 'A friend') AS sender_name
       FROM red_envelopes re
       LEFT JOIN users s ON s.id = re.sender_id
       WHERE re.recipient_id = $1 AND re.seen = FALSE
       ORDER BY re.created_at ASC`, [req.tokenUser.id]);
    res.json({ envelopes: rows });
  } catch (e) {
    console.error('m/red-envelopes unseen error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/m/red-envelopes/seen : marquer comme vues ──────────────────────
router.post('/api/m/red-envelopes/seen', requireToken, async (req, res) => {
  try {
    await pool.query('UPDATE red_envelopes SET seen = TRUE WHERE recipient_id = $1 AND seen = FALSE', [req.tokenUser.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('m/red-envelopes seen error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

};
