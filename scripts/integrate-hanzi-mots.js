// Intègre les caractères de la table `hanzi` (makemeahanzi) dans `mots` comme de
// VRAIS lexèmes appris (zh) avec une traduction anglaise, selon le modèle par
// concepts. Reproduit fidèlement le chemin canonique syncConceptSiblings en mode
// `freshBox` (chaque caractère a SA propre boîte concept → pas de sur-merge).
//
//   node scripts/integrate-hanzi-mots.js --dry    # compte + échantillon, n'écrit rien
//   node scripts/integrate-hanzi-mots.js          # écrit en prod (DATABASE_URL en env)
//
// Choix (validés) : vrais hanzi seulement (pas de fragments de radicaux ni de
// variantes « old form of X ») + SENS PRINCIPAL seul comme lexème anglais.

const { Pool } = require('pg');

const DRY = process.argv.includes('--dry');

// Vrais caractères CJK (exclut radicaux Kangxi U+2F00–, radicaux CJK U+2E80–, etc.).
function isRealHan(ch) {
  const c = ch.codePointAt(0);
  return (
    (c >= 0x3400 && c <= 0x4dbf) ||   // Ext A
    (c >= 0x4e00 && c <= 0x9fff) ||   // CJK unifié
    (c >= 0xf900 && c <= 0xfaff) ||   // Compat
    (c >= 0x20000 && c <= 0x2fa1f)    // Ext B+ (surrogates)
  );
}

// Définition non enseignable (renvoie juste vers un autre caractère) → on saute.
function isVariantDef(def) {
  return /\b(old form of|variant of|same as|ancient form of|non-classical form|archaic form of)\b/i.test(def)
    || /^\s*see\s/i.test(def);
}

const HAN_RE = /[㐀-鿿豈-﫿]/;

// Sens principal : 1er segment (séparateurs ; / ,), sans numérotation, plafonné,
// et rejeté s'il contient du Han (glose non latine) ou est vide.
function primaryGloss(def) {
  let s = String(def || '').replace(/^\s*\d+\s+/, '').trim();
  s = s.split(/[;/,]/)[0].trim().replace(/\.$/, '').trim();
  if (!s || s.length > 40 || HAN_RE.test(s)) return null;
  return s;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  const { rows } = await pool.query(
    `SELECT h.char, h.pinyin, h.definition
     FROM hanzi h
     WHERE h.definition IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM mots m WHERE m.lang = 'zh' AND m.chinese = h.char)`
  );

  const eligible = [];
  let skipRadical = 0, skipVariant = 0, skipGloss = 0;
  for (const r of rows) {
    if (!isRealHan(r.char)) { skipRadical++; continue; }
    if (isVariantDef(r.definition)) { skipVariant++; continue; }
    const gloss = primaryGloss(r.definition);
    if (!gloss) { skipGloss++; continue; }
    eligible.push({ char: r.char, pinyin: r.pinyin || null, gloss });
  }

  console.log(`Candidats absents de mots : ${rows.length}`);
  console.log(`  exclus radicaux/non-CJK : ${skipRadical}`);
  console.log(`  exclus variantes/old-form: ${skipVariant}`);
  console.log(`  exclus glose inutilisable: ${skipGloss}`);
  console.log(`  → à intégrer            : ${eligible.length}`);
  console.log('Échantillon :');
  eligible.slice(0, 12).forEach((e) => console.log(`   ${e.char}  ${e.pinyin || ''}  → ${e.gloss}`));

  if (DRY) { console.log('\n(DRY RUN — rien écrit)'); await pool.end(); return; }

  let created = 0, enReused = 0, enCreated = 0;
  for (let i = 0; i < eligible.length; i += 300) {
    const batch = eligible.slice(i, i + 300);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const e of batch) {
        // 1) Concept dédié (freshBox) + lexème zh appris.
        const m = await client.query("INSERT INTO meanings(note) VALUES ($1) RETURNING id", ['hanzi:' + e.char]);
        const meaningId = m.rows[0].id;
        const zh = await client.query(
          'INSERT INTO mots (chinese, pinyin, lang, meaning_id) VALUES ($1, $2, $3, $4) RETURNING id',
          [e.char, e.pinyin, 'zh', meaningId]);
        const motId = zh.rows[0].id;
        await client.query('INSERT INTO lexeme_senses(mot_id, meaning_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [motId, meaningId]);

        // 2) Lexème anglais canonique (réutilisé si existant), relié au concept.
        const ex = await client.query(
          "SELECT id FROM mots WHERE lang = 'en' AND lower(chinese) = lower($1) ORDER BY id LIMIT 1", [e.gloss]);
        let enId;
        if (ex.rows.length) { enId = ex.rows[0].id; enReused++; }
        else {
          const ins = await client.query(
            "INSERT INTO mots (chinese, pinyin, lang, meaning_id) VALUES ($1, NULL, 'en', $2) RETURNING id",
            [e.gloss, meaningId]);
          enId = ins.rows[0].id; enCreated++;
        }
        await client.query('INSERT INTO lexeme_senses(mot_id, meaning_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [enId, meaningId]);
        created++;
      }
      await client.query('COMMIT');
      process.stdout.write(`\r  intégrés : ${created}/${eligible.length}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('\nBatch échoué à index', i, ':', err.message);
      throw err;
    } finally { client.release(); }
  }
  console.log(`\n✅ Terminé : ${created} caractères intégrés (lexèmes en : ${enCreated} créés, ${enReused} réutilisés).`);
  await pool.end();
}

main().catch((e) => { console.error('Échec:', e); process.exit(1); });
