// Enrichissement des étymologies de la table `hanzi` (phase 1 : DÉTERMINISTE).
//
//   node scripts/enrich-hanzi.js /chemin/vers/dictionary.txt
//   (DATABASE_URL dans l'env — cf. .env)
//
// Ajoute deux colonnes (additif, réversible ; ne touche PAS au jsonb `etymology`) :
//   • pinyin    : lecture principale (utile pour les chips de composants)
//   • etym_note : explication prête à afficher, en anglais (cohérent avec les hints
//                 makemeahanzi déjà en anglais), enveloppée par des libellés localisés
//                 côté app.
//
// Règles de construction de etym_note :
//   • pictophonetic → « Phono-semantic compound: {sém} ({sens}) gives the meaning,
//                       {phon} ({pinyin}) the sound. »  ← le gros gain (73 % des chars,
//                       dont le hint n'était que le sens du composant sémantique seul)
//   • ideographic / pictographic → on garde le hint (déjà une bonne phrase)
//   • sans étymologie / type inconnu → etym_note laissé NULL (phase 2 : LLM)

const fs = require('fs');
const readline = require('readline');
const { pool } = require('../config/database');

function buildNote(et, dict) {
  if (!et || !et.type) return null;
  if (et.type === 'ideographic' || et.type === 'pictographic') {
    return et.hint ? String(et.hint).trim() : null;
  }
  if (et.type === 'pictophonetic') {
    const sem = et.semantic || '';
    const phon = et.phonetic || '';
    // Sens du composant sémantique = le hint makemeahanzi (sinon 1re glose du composant).
    const semGloss = et.hint || (dict.get(sem)?.definition || '').split(/[;,]/)[0].trim();
    const phonPy = (dict.get(phon)?.pinyin || [])[0] || '';
    if (!sem && !phon) return et.hint ? String(et.hint).trim() : null;
    let s = 'Phono-semantic compound';
    if (sem) s += `: ${sem}` + (semGloss ? ` (${semGloss})` : '') + ' gives the meaning';
    if (phon) s += `${sem ? ',' : ':'} ${phon}` + (phonPy ? ` (${phonPy})` : '') + ' the sound';
    return s + '.';
  }
  return et.hint ? String(et.hint).trim() : null;
}

async function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    console.error('Usage: node scripts/enrich-hanzi.js <dictionary.txt>');
    process.exit(1);
  }

  await pool.query('ALTER TABLE hanzi ADD COLUMN IF NOT EXISTS pinyin text');
  await pool.query('ALTER TABLE hanzi ADD COLUMN IF NOT EXISTS etym_note text');

  // 1er passage : on charge tout dictionary.txt en mémoire (besoin des composants
  // pour résoudre le pinyin du phonétique, qui n'est pas forcément traité avant lui).
  const dict = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const s = line.trim(); if (!s) continue;
    try { const o = JSON.parse(s); if (o.character) dict.set(o.character, o); } catch { /* skip */ }
  }
  console.log(`dictionary.txt: ${dict.size} caractères chargés.`);

  const rows = [];
  for (const [char, o] of dict) {
    rows.push({
      char,
      pinyin: (o.pinyin && o.pinyin[0]) || null,
      note: buildNote(o.etymology, dict),
    });
  }

  let updated = 0, notes = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const vals = [];
    const params = [];
    batch.forEach((r, k) => {
      const b = k * 3;
      vals.push(`($${b + 1}, $${b + 2}, $${b + 3})`);
      params.push(r.char, r.pinyin, r.note);
      if (r.note) notes += 1;
    });
    // Met à jour uniquement les lignes déjà présentes (les caractères importés).
    await pool.query(
      `UPDATE hanzi h SET pinyin = v.pinyin, etym_note = v.note
       FROM (VALUES ${vals.join(',')}) AS v(char, pinyin, note)
       WHERE h.char = v.char`,
      params
    );
    updated += batch.length;
  }

  console.log(`✅ Enrichi : ${updated} lignes traitées, ${notes} etym_note déterministes.`);
  await pool.end();
}

main().catch((e) => { console.error('Enrichissement échoué:', e); process.exit(1); });
