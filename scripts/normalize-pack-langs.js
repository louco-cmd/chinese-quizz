// One-time : normalise les langues des packs existants.
//   1. Supprime les packs dont le CONTENU n'est PAS du chinois : aucun item ne
//      contient de caractère CJK (ex. « English Starter (FR) », 100 % anglais).
//      On se base sur le CONTENU (présence de hanzi) et NON sur le label lang,
//      car des mots chinois ont pu être mal étiquetés lang='en' (packs de slang) :
//      ces packs-là contiennent des hanzi → ils sont CONSERVÉS. Les mots déjà
//      appris des acheteurs restent dans user_mots (on ne les touche pas).
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
    // Packs SANS aucun contenu chinois (aucun item avec un hanzi) → non-chinois.
    const toDelete = await client.query(
      `SELECT id, title, lang, native_lang,
              (SELECT COUNT(*) FROM word_pack_items i WHERE i.pack_id = wp.id)::int AS items,
              (SELECT COUNT(*) FROM pack_purchases pp WHERE pp.pack_id = wp.id)::int AS buyers
       FROM word_packs wp
       WHERE NOT EXISTS (
         SELECT 1 FROM word_pack_items i JOIN mots m ON m.id = i.mot_id
         WHERE i.pack_id = wp.id AND m.chinese ~ '[一-鿿]'
       )
       ORDER BY id`);
    console.log(`\n=== Packs à SUPPRIMER (aucun contenu chinois) : ${toDelete.rows.length} ===`);
    toDelete.rows.forEach((r) => console.log(`  #${r.id} ${JSON.stringify(r.title)}  lang=${r.lang} native=${r.native_lang}  items=${r.items} buyers=${r.buyers}`));

    const delIds = toDelete.rows.map((r) => r.id);
    const rest = await client.query(
      `SELECT COUNT(*)::int n FROM word_packs WHERE NOT (id = ANY($1::int[]))`, [delIds.length ? delIds : [-1]]);
    console.log(`\n=== Packs à normaliser en zh:en (contenu chinois) : ${rest.rows[0].n} ===`);
    const preview = await client.query(
      `SELECT id, title, lang FROM word_packs WHERE NOT (id = ANY($1::int[])) AND lang <> 'zh' ORDER BY id`,
      [delIds.length ? delIds : [-1]]);
    if (preview.rows.length) {
      console.log('  (mal étiquetés à re-labelliser zh, conservés) :');
      preview.rows.forEach((r) => console.log(`   #${r.id} ${JSON.stringify(r.title)}  lang=${r.lang} → zh`));
    }

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
