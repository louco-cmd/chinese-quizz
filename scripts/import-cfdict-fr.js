// Alimente les traductions FRANÇAISES des mots zh via CFDICT (dictionnaire
// chinois→français libre, CC-BY-SA — cf. chine.in). Même modèle que le lexème
// anglais : pour chaque mot zh SANS frère `fr` sur son concept, on crée (ou réutilise)
// un lexème `fr` relié au même meaning_id.
//
//   node scripts/import-cfdict-fr.js <cfdict.u8> --dry   # couverture + échantillon
//   node scripts/import-cfdict-fr.js <cfdict.u8>         # écrit (DATABASE_URL en env)
//
// CFDICT ligne : `Traditionnel Simplifié [pinyin] /sens1/sens2/…/` (clé = simplifié).

require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');

const FILE = process.argv[2];
const DRY = process.argv.includes('--dry');
if (!FILE || !fs.existsSync(FILE)) { console.error('Usage: node scripts/import-cfdict-fr.js <cfdict.u8> [--dry]'); process.exit(1); }

const HAN_RE = /[㐀-鿿豈-﫿]/;
const LINE_RE = /^(\S+)\s+(\S+)\s+\[[^\]]*\]\s+\/(.+)\/\s*$/;

// Choisit une glose française propre parmi les sens séparés par /.
function frenchGloss(defField) {
  const senses = defField.split('/').map((s) => s.trim()).filter(Boolean);
  for (let s of senses) {
    if (/^\(.*\)$/.test(s)) continue;              // note entre parenthèses seule
    s = s.replace(/\s*\([^)]*\)\s*/g, ' ').trim(); // retire les parenthèses inline
    if (!s || HAN_RE.test(s)) continue;            // vide ou contient du Han → suivant
    if (s.length > 40) s = s.split(/[;,]/)[0].trim();
    if (s && s.length <= 40 && !HAN_RE.test(s)) return s;
  }
  return null;
}

// simplifié → glose fr (1re entrée gagnante).
function loadCfdict(path) {
  const map = new Map();
  for (const ln of fs.readFileSync(path, 'utf8').split('\n')) {
    if (!ln || ln.startsWith('#')) continue;
    const m = LINE_RE.exec(ln);
    if (!m) continue;
    const simp = m[2];
    if (map.has(simp)) continue;
    const g = frenchGloss(m[3]);
    if (g) map.set(simp, g);
  }
  return map;
}

async function main() {
  const cf = loadCfdict(FILE);
  console.log('CFDICT : %d entrées simplifié→fr', cf.size);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  // Mots zh avec un concept MAIS sans aucun frère `fr` sur ce concept.
  const { rows } = await pool.query(
    `SELECT m.id, m.chinese, m.meaning_id
     FROM mots m
     WHERE m.lang = 'zh' AND m.meaning_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM lexeme_senses ls JOIN mots f ON f.id = ls.mot_id
         WHERE ls.meaning_id = m.meaning_id AND f.lang = 'fr')`
  );

  const todo = [];
  for (const r of rows) {
    const g = cf.get(r.chinese);
    if (g) todo.push({ motId: r.id, chinese: r.chinese, meaningId: r.meaning_id, gloss: g });
  }
  console.log('Mots zh sans trad FR : %d  |  couverts par CFDICT : %d', rows.length, todo.length);
  console.log('Échantillon :');
  todo.slice(0, 15).forEach((t) => console.log('   %s → %s', t.chinese, t.gloss));

  if (DRY) { console.log('\n(DRY RUN — rien écrit)'); await pool.end(); return; }

  let done = 0, reused = 0, createdFr = 0;
  for (let i = 0; i < todo.length; i += 300) {
    const batch = todo.slice(i, i + 300);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const t of batch) {
        // Réutilise un lexème fr existant de même glose, sinon le crée (relié au concept).
        const ex = await client.query(
          "SELECT id FROM mots WHERE lang = 'fr' AND lower(chinese) = lower($1) ORDER BY id LIMIT 1", [t.gloss]);
        let frId;
        if (ex.rows.length) { frId = ex.rows[0].id; reused++; }
        else {
          const ins = await client.query(
            "INSERT INTO mots (chinese, pinyin, lang, meaning_id) VALUES ($1, NULL, 'fr', $2) RETURNING id",
            [t.gloss, t.meaningId]);
          frId = ins.rows[0].id; createdFr++;
        }
        await client.query('INSERT INTO lexeme_senses(mot_id, meaning_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [frId, t.meaningId]);
        done++;
      }
      await client.query('COMMIT');
      process.stdout.write(`\r  traités : ${done}/${todo.length}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('\nBatch échoué à index', i, ':', err.message);
      throw err;
    } finally { client.release(); }
  }
  console.log(`\n✅ Terminé : ${done} mots reçoivent une trad FR (fr créés : ${createdFr}, réutilisés : ${reused}).`);
  await pool.end();
}

main().catch((e) => { console.error('Échec:', e); process.exit(1); });
