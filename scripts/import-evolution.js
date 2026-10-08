// Import one-shot des images d'évolution EVOBC (« time machine ») dans hanzi_evolution.
//
//   node scripts/import-evolution.js <dossier_webp>
//
// Le dossier contient des fichiers `<caractère>_<era>.webp` produits par le pipeline
// d'extraction (voir memory evobc-character-timemachine). era ∈ 0..5 dans l'ordre
// CHRONOLOGIQUE : 0 甲骨 / 1 金文 / 2 春秋 / 3 战国 / 4 篆 / 5 隶.
//
// On RÉGÉNÈRE toute la table (TRUNCATE) : la numérotation des eras a changé vs le POC
// (qui mélangeait篆/春秋), donc on repart propre. Images servies par
// /api/m/evolution/:char/:era (bytea + mime), insérées ici en image/webp.

require('dotenv').config(); // DATABASE_URL depuis .env AVANT de charger le pool
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

const FN_RE = /^(.+)_(\d+)\.webp$/; // <char>_<era>.webp

async function main() {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) {
    console.error('Usage: node scripts/import-evolution.js <dossier_webp>');
    process.exit(1);
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.webp'));
  console.log('fichiers webp:', files.length);

  // Parse char/era + lit le bytea.
  const rows = [];
  for (const f of files) {
    const m = FN_RE.exec(f);
    if (!m) continue;
    const char = m[1];
    const era = parseInt(m[2], 10);
    if (!(era >= 0 && era <= 5)) continue;
    rows.push({ char, era, buf: fs.readFileSync(path.join(dir, f)) });
  }
  console.log('lignes à insérer:', rows.length, '| chars:', new Set(rows.map((r) => r.char)).size);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE hanzi_evolution');
    const BATCH = 400;
    let done = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const vals = [];
      const params = [];
      slice.forEach((r, k) => {
        const b = k * 4;
        vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4})`);
        params.push(r.char, r.era, r.buf, 'image/webp');
      });
      await client.query(
        `INSERT INTO hanzi_evolution (char, era, image, mime) VALUES ${vals.join(',')}
         ON CONFLICT (char, era) DO UPDATE SET image = EXCLUDED.image, mime = EXCLUDED.mime`,
        params,
      );
      done += slice.length;
      if (done % 4000 === 0 || done === rows.length) console.log('  inséré', done, '/', rows.length);
    }
    await client.query('COMMIT');
    const { rows: c } = await client.query('SELECT count(*) n, count(distinct char) d FROM hanzi_evolution');
    console.log('OK — hanzi_evolution:', c[0].n, 'images,', c[0].d, 'caractères');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ÉCHEC, rollback:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
