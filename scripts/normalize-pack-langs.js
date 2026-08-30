// One-time : normalise les langues des packs existants.
//   1. Supprime les packs dont le contenu n'est PAS du chinois (lang <> 'zh') :
//      ce sont les paires incomplètes (ex. « English Starter (FR) », base fr) —
//      leurs mots + achats sont retirés (les mots déjà appris des acheteurs, eux,
//      restent dans user_mots, on ne les touche pas).
//   2. Passe tous les packs restants en paire zh↔en (lang='zh', native_lang='en').
//
// Usage :
//   DATABASE_URL=<url> node scripts/normalize-pack-langs.js            # DRY-RUN (n'écrit rien)
//   DATABASE_URL=<url> node scripts/normalize-pack-langs.js --commit   # applique
//
// Idempotent : après application il ne reste que des packs zh/en → re-run = no-op.
const { Pool } = require('pg');

const COMMIT = process.argv.includes('--commit');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL manquant'); process.exit(2); }
const pool = new Pool({ connectionString: url });

(async () => {
  const client = await pool.connect();
  try {
    const toDelete = await client.query(
      `SELECT id, title, lang, native_lang,
              (SELECT COUNT(*) FROM word_pack_items i WHERE i.pack_id = wp.id)::int AS items,
              (SELECT COUNT(*) FROM pack_purchases pp WHERE pp.pack_id = wp.id)::int AS buyers
       FROM word_packs wp WHERE wp.lang <> 'zh' ORDER BY id`);
    console.log(`\n=== Packs à SUPPRIMER (lang <> 'zh') : ${toDelete.rows.length} ===`);
    toDelete.rows.forEach((r) => console.log(`  #${r.id} ${JSON.stringify(r.title)}  lang=${r.lang} native=${r.native_lang}  items=${r.items} buyers=${r.buyers}`));

    const rest = await client.query(`SELECT COUNT(*)::int n FROM word_packs WHERE lang = 'zh'`);
    console.log(`\n=== Packs à normaliser en zh:en : ${rest.rows[0].n} ===`);

    if (!COMMIT) {
      console.log('\n(DRY-RUN — rien écrit. Relance avec --commit pour appliquer.)');
      return;
    }

    await client.query('BEGIN');
    const ids = toDelete.rows.map((r) => r.id);
    if (ids.length) {
      await client.query('DELETE FROM word_pack_items WHERE pack_id = ANY($1::int[])', [ids]);
      await client.query('DELETE FROM pack_purchases  WHERE pack_id = ANY($1::int[])', [ids]);
      await client.query('DELETE FROM word_packs       WHERE id = ANY($1::int[])', [ids]);
    }
    const upd = await client.query(`UPDATE word_packs SET lang = 'zh', native_lang = 'en'`);
    await client.query('COMMIT');
    console.log(`\n✅ Appliqué : ${ids.length} pack(s) supprimé(s), ${upd.rowCount} pack(s) normalisé(s) en zh:en.`);

    const after = await client.query(`SELECT lang, native_lang, COUNT(*)::int n FROM word_packs GROUP BY lang, native_lang ORDER BY n DESC`);
    console.log('=== État final ==='); after.rows.forEach((r) => console.log(`  ${r.lang}:${r.native_lang} → ${r.n}`));
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    console.error('ERREUR:', e.message); process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
