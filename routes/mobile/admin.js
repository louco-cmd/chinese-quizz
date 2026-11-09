// ════════════════════════════════════════════════════════════════════════════
//  ADMIN (réservé ADMIN_EMAIL) — réconciliation packs HSK, masquer/afficher des
//  packs, monitor d'intégrité du graphe de concepts, activité d'édition P2P.
//  Extrait de routes/mobile.js. Monté via registerAdminRoutes(router, deps).
// ════════════════════════════════════════════════════════════════════════════
const { pool, reconcileHskPacks } = require('../../config/database');

module.exports = function registerAdminRoutes(router, deps) {
  const { requireToken } = deps;

router.post('/api/m/admin/reconcile-packs', requireToken, async (req, res) => {
  const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'locochet.08@gmail.com').toLowerCase();
  if ((req.tokenUser.email || '').toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const r = await reconcileHskPacks();
    res.json({ ok: true, counts: r.counts });
  } catch (e) {
    console.error('m/admin reconcile-packs error:', e);
    res.status(500).json({ error: 'Reconcile failed' });
  }
});

// ── Masquer/afficher un pack du JiaStore (admin) — utile pour une démo/présentation ─
// Masqué = exclu du listing du store (les propriétaires gardent l'accès). Réapparaît
// automatiquement une fois `hidden_until` dépassé, ou via unhide.
function isAdminReq(req) {
  const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'locochet.08@gmail.com').toLowerCase();
  return (req.tokenUser.email || '').toLowerCase() === ADMIN_EMAIL;
}
// POST /api/m/admin/packs/:id/hide  body { hours? | until? }  → masque le pack.
router.post('/api/m/admin/packs/:id/hide', requireToken, async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid pack' });
    let until;
    if (req.body?.until) { until = new Date(req.body.until); if (isNaN(until)) return res.status(400).json({ error: 'Invalid until' }); }
    else { const hours = Math.min(24 * 365, Math.max(1, parseInt(req.body?.hours, 10) || 24)); until = new Date(Date.now() + hours * 3600 * 1000); }
    const { rowCount } = await pool.query('UPDATE word_packs SET hidden_until = $1 WHERE id = $2', [until.toISOString(), id]);
    if (!rowCount) return res.status(404).json({ error: 'Pack not found' });
    res.json({ ok: true, id, hidden_until: until.toISOString() });
  } catch (e) { console.error('m/admin hide pack:', e); res.status(500).json({ error: 'Server error' }); }
});
// POST /api/m/admin/packs/:id/unhide → ré-affiche immédiatement.
router.post('/api/m/admin/packs/:id/unhide', requireToken, async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid pack' });
    await pool.query('UPDATE word_packs SET hidden_until = NULL WHERE id = $1', [id]);
    res.json({ ok: true, id });
  } catch (e) { console.error('m/admin unhide pack:', e); res.status(500).json({ error: 'Server error' }); }
});
// GET /api/m/admin/packs/hidden → packs actuellement masqués (pour vérifier).
router.get('/api/m/admin/packs/hidden', requireToken, async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const { rows } = await pool.query(
      `SELECT id, title, to_char(hidden_until,'YYYY-MM-DD HH24:MI') AS hidden_until FROM word_packs WHERE hidden_until > NOW() ORDER BY hidden_until`);
    res.json({ packs: rows });
  } catch (e) { console.error('m/admin hidden packs:', e); res.status(500).json({ error: 'Server error' }); }
});

// ── GET /api/m/admin/integrity : audit d'intégrité du graphe concept/lexème ──
// Garde-fou de MONITORING (admin). Mesure la corruption : références pendantes
// (normalement 0, protégées par FK), pointeurs de sens « fantômes » (risque de
// résurrection), sens de possession cassés, DOUBLONS de lexèmes, et SUR-FUSION
// (concepts avec trop de lexèmes d'une même langue — cause de fuite inter-packs).
// La corruption DURE (dangling/résurrection/ownership) est loggée en WARN (visible
// dans les logs Render) pour repérage précoce. À appeler à la main ou via un cron.
async function computeIntegrity() {
  const scalar = async (s) => (await pool.query(s)).rows[0].n;
  const [
    danglingLsMot, danglingLsMeaning, danglingMotMeaning, resurrection,
    brokenOwnership, danglingUmMot, danglingPackMot, dupMotGroups, overmerge, biggest,
  ] = await Promise.all([
    scalar(`SELECT COUNT(*)::int n FROM lexeme_senses ls LEFT JOIN mots m ON m.id=ls.mot_id WHERE m.id IS NULL`),
    scalar(`SELECT COUNT(*)::int n FROM lexeme_senses ls LEFT JOIN meanings mn ON mn.id=ls.meaning_id WHERE mn.id IS NULL`),
    scalar(`SELECT COUNT(*)::int n FROM mots m WHERE m.meaning_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM meanings mn WHERE mn.id=m.meaning_id)`),
    scalar(`SELECT COUNT(*)::int n FROM mots m WHERE m.meaning_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lexeme_senses ls WHERE ls.mot_id=m.id AND ls.meaning_id=m.meaning_id)`),
    scalar(`SELECT COUNT(*)::int n FROM user_mots um WHERE um.meaning_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lexeme_senses ls WHERE ls.mot_id=um.mot_id AND ls.meaning_id=um.meaning_id)`),
    scalar(`SELECT COUNT(*)::int n FROM user_mots um LEFT JOIN mots m ON m.id=um.mot_id WHERE m.id IS NULL`),
    scalar(`SELECT COUNT(*)::int n FROM word_pack_items i LEFT JOIN mots m ON m.id=i.mot_id WHERE m.id IS NULL`),
    scalar(`SELECT COUNT(*)::int n FROM (SELECT 1 FROM mots GROUP BY lower(chinese), lang HAVING COUNT(*)>1) t`),
    pool.query(`SELECT m.lang, COUNT(*)::int n FROM (
        SELECT ls.meaning_id, mo.lang FROM lexeme_senses ls JOIN mots mo ON mo.id=ls.mot_id
        GROUP BY ls.meaning_id, mo.lang HAVING COUNT(DISTINCT ls.mot_id) >= 3
      ) m GROUP BY m.lang ORDER BY n DESC`).then((r) => r.rows),
    pool.query(`SELECT COUNT(DISTINCT ls.mot_id)::int lexemes FROM lexeme_senses ls GROUP BY ls.meaning_id ORDER BY lexemes DESC LIMIT 1`).then((r) => r.rows[0]?.lexemes || 0),
  ]);
  const hardCorruption = danglingLsMot + danglingLsMeaning + danglingMotMeaning + resurrection + brokenOwnership + danglingUmMot + danglingPackMot;
  return {
    dangling: { lexeme_senses_mot: danglingLsMot, lexeme_senses_meaning: danglingLsMeaning, mots_meaning: danglingMotMeaning, user_mots_mot: danglingUmMot, pack_items_mot: danglingPackMot },
    resurrection_risk: resurrection,
    broken_ownership_sense: brokenOwnership,
    duplicate_mot_groups: dupMotGroups,
    overmerge_concepts_ge3_samelang: overmerge,
    biggest_concept_lexemes: biggest,
    hard_corruption_total: hardCorruption,
  };
}
router.get('/api/m/admin/integrity', requireToken, async (req, res) => {
  const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'locochet.08@gmail.com').toLowerCase();
  if ((req.tokenUser.email || '').toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const report = await computeIntegrity();
    // Alerte précoce : toute corruption DURE est anormale (les FK l'empêchent déjà
    // en théorie) → on la remonte dans les logs pour investigation immédiate.
    if (report.hard_corruption_total > 0) {
      console.warn('[integrity] HARD CORRUPTION DETECTED:', JSON.stringify(report));
    }
    res.json({ ok: true, at: new Date().toISOString(), report });
  } catch (e) {
    console.error('m/admin integrity error:', e);
    res.status(500).json({ error: 'Integrity check failed' });
  }
});

// ── GET /api/m/admin/edit-activity : détection d'anomalies d'édition (admin) ──
// Garde-fou DÉTECTIF contre le vandalisme : qui édite la base partagée, à quel
// rythme, et quoi. Remonte les top éditeurs (24h/7j), les éditions de SURFACE
// récentes (chinese/pinyin — les plus sensibles) avec before/after, et logue une
// alerte WARN si un user a atteint/dépassé le plafond quotidien (signal d'abus).
router.get('/api/m/admin/edit-activity', requireToken, async (req, res) => {
  const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'locochet.08@gmail.com').toLowerCase();
  if ((req.tokenUser.email || '').toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const [top24, top7, recentSurface, totals] = await Promise.all([
      pool.query(
        `SELECT el.user_id, u.email, u.name, COUNT(*)::int AS edits,
                COUNT(*) FILTER (WHERE el.action='edit_surface')::int AS surface,
                COUNT(*) FILTER (WHERE el.action='edit_meaning')::int AS meaning
         FROM edit_log el LEFT JOIN users u ON u.id = el.user_id
         WHERE el.action IN ('edit_surface','edit_meaning') AND el.created_at >= NOW() - INTERVAL '24 hours'
         GROUP BY el.user_id, u.email, u.name ORDER BY edits DESC LIMIT 20`).then((r) => r.rows),
      pool.query(
        `SELECT el.user_id, u.email, COUNT(*)::int AS edits
         FROM edit_log el LEFT JOIN users u ON u.id = el.user_id
         WHERE el.action IN ('edit_surface','edit_meaning') AND el.created_at >= NOW() - INTERVAL '7 days'
         GROUP BY el.user_id, u.email ORDER BY edits DESC LIMIT 20`).then((r) => r.rows),
      pool.query(
        `SELECT el.id, el.user_id, el.mot_id, el.surface, el.before, el.after, el.created_at
         FROM edit_log el WHERE el.action='edit_surface'
         ORDER BY el.created_at DESC LIMIT 30`).then((r) => r.rows),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS d1,
                COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS d7
         FROM edit_log WHERE action IN ('edit_surface','edit_meaning')`).then((r) => r.rows[0]),
    ]);
    // Alerte précoce : un user qui a atteint le plafond quotidien est suspect.
    const flagged = top24.filter((u) => u.edits >= DAILY_EDIT_LIMIT);
    if (flagged.length) {
      console.warn('[edit-activity] users at/over daily edit cap:', JSON.stringify(flagged.map((u) => ({ user_id: u.user_id, email: u.email, edits: u.edits }))));
    }
    res.json({
      ok: true, at: new Date().toISOString(), daily_edit_limit: DAILY_EDIT_LIMIT,
      totals, flagged, top_editors_24h: top24, top_editors_7d: top7, recent_surface_edits: recentSurface,
    });
  } catch (e) {
    console.error('m/admin edit-activity error:', e);
    res.status(500).json({ error: 'Edit activity check failed' });
  }
});

};
