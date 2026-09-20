// Import one-shot de la décomposition des caractères depuis makemeahanzi.
//
// 1) Récupère `dictionary.txt` :   git clone https://github.com/skishore/makemeahanzi
//    (ou télécharge juste le fichier dictionary.txt du dépôt)
// 2) Lance :   node scripts/import-hanzi.js /chemin/vers/dictionary.txt
//    (DATABASE_URL doit être dans l'env — cf. .env)
//
// Format : un objet JSON par ligne :
//   { "character":"好", "definition":"good…", "pinyin":["hǎo","hào"],
//     "decomposition":"⿰女子", "radical":"女",
//     "etymology":{ "type":"ideographic", "hint":"A woman 女 with a son 子" } }
//
// On n'importe QUE radical / decomposition / etymology (pinyin + traduction viennent
// déjà de notre table `mots`, dans la langue native de l'utilisateur).

const fs = require('fs');
const readline = require('readline');
const { pool } = require('../config/database');

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/import-hanzi.js <dictionary.txt>'); process.exit(1); }
  if (!fs.existsSync(file)) { console.error('Fichier introuvable:', file); process.exit(1); }

  // Table créée au boot, mais on la garantit ici aussi (script autonome).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hanzi (
      char text PRIMARY KEY, radical text, decomposition text, etymology jsonb
    )`);

  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let batch = [];
  let total = 0, bad = 0;

  const flush = async () => {
    if (!batch.length) return;
    // UPSERT groupé : un VALUES multi-lignes par lot de 500.
    const vals = [];
    const params = [];
    batch.forEach((r, i) => {
      const b = i * 4;
      vals.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`);
      params.push(r.char, r.radical, r.decomposition, r.etymology);
    });
    await pool.query(
      `INSERT INTO hanzi (char, radical, decomposition, etymology)
       VALUES ${vals.join(',')}
       ON CONFLICT (char) DO UPDATE
         SET radical = EXCLUDED.radical,
             decomposition = EXCLUDED.decomposition,
             etymology = EXCLUDED.etymology`,
      params
    );
    total += batch.length;
    batch = [];
  };

  for await (const line of rl) {
    const s = line.trim();
    if (!s) continue;
    let o;
    try { o = JSON.parse(s); } catch { bad += 1; continue; }
    if (!o.character) { bad += 1; continue; }
    batch.push({
      char: o.character,
      radical: o.radical || null,
      decomposition: o.decomposition || null,
      etymology: o.etymology ? JSON.stringify(o.etymology) : null,
    });
    if (batch.length >= 500) await flush();
  }
  await flush();

  console.log(`✅ Import terminé : ${total} caractères (${bad} ligne(s) ignorée(s)).`);
  await pool.end();
}

main().catch((e) => { console.error('Import échoué:', e); process.exit(1); });
