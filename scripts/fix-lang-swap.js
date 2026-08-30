// One-time : répare les concepts dont les labels `lang` sont INVERSÉS (hanzi
// étiqueté 'en', glose anglaise étiquetée 'zh') — corruption d'un import de pack.
// Symptôme : en cours de chinois, la colonne « mot appris » affiche l'anglais.
//
// Périmètre = les CONCEPTS ayant un lexème hanzi (CJK) étiqueté 'en'. Pour ces
// concepts :
//   1. Re-pointe les user_mots possédant la glose latine (lang zh) vers le lexème
//      hanzi du MÊME sens (préserve la progression : max score, somme nb_quiz).
//   2. Swap les langs : hanzi 'en'→'zh' ; glose latine 'zh'→'en'.
// word_pack_items pointent déjà sur le hanzi → deviennent corrects après le swap.
//
// Usage :
//   DATABASE_URL=<url> node scripts/fix-lang-swap.js            # DRY-RUN
//   DATABASE_URL=<url> node scripts/fix-lang-swap.js --commit   # applique
const { Pool } = require('pg');
const COMMIT = process.argv.includes('--commit');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL manquant'); process.exit(2); }
const pool = new Pool({ connectionString: url });
const CJK = '[一-鿿]';

(async () => {
  const client = await pool.connect();
  try {
    // Concepts affectés : un lexème hanzi est étiqueté 'en'.
    const aff = await client.query(
      `SELECT DISTINCT ls.meaning_id
       FROM lexeme_senses ls JOIN mots m ON m.id = ls.mot_id
       WHERE m.chinese ~ $1 AND m.lang = 'en'`, [CJK]);
    const meanings = aff.rows.map((r) => r.meaning_id);
    console.log(`Concepts affectés : ${meanings.length}`);
    if (!meanings.length) { console.log('Rien à faire.'); return; }

    const hanziEn = await client.query(
      `SELECT id, chinese, meaning_id FROM mots WHERE meaning_id = ANY($1::int[]) AND chinese ~ $2 AND lang = 'en'`, [meanings, CJK]);
    const glossZh = await client.query(
      `SELECT id, chinese, meaning_id FROM mots WHERE meaning_id = ANY($1::int[]) AND chinese !~ $2 AND lang = 'zh'`, [meanings, CJK]);
    console.log(`  hanzi 'en'→'zh' : ${hanziEn.rows.length}`);
    console.log(`  glose 'zh'→'en' : ${glossZh.rows.length}`);

    // user_mots à re-pointer : possessions sur un lexème glose (latin, zh) d'un concept affecté.
    const repoint = await client.query(
      `SELECT um.user_id, um.mot_id AS from_mot, um.meaning_id, um.score, um.nb_quiz,
              (SELECT h.id FROM lexeme_senses lh JOIN mots h ON h.id = lh.mot_id
                 WHERE lh.meaning_id = um.meaning_id AND h.chinese ~ $2 LIMIT 1) AS to_mot
       FROM user_mots um JOIN mots m ON m.id = um.mot_id
       WHERE um.meaning_id = ANY($1::int[]) AND m.chinese !~ $2 AND m.lang = 'zh'`, [meanings, CJK]);
    console.log(`  user_mots à re-pointer (glose→hanzi) : ${repoint.rows.length}`);
    repoint.rows.slice(0, 20).forEach((r) => console.log(`     user ${r.user_id}: mot#${r.from_mot} → #${r.to_mot} (mid ${r.meaning_id})`));

    if (!COMMIT) { console.log('\n(DRY-RUN — rien écrit. --commit pour appliquer.)'); return; }

    await client.query('BEGIN');
    // 1. Re-pointe les possessions (merge SRS si le hanzi est déjà possédé).
    for (const r of repoint.rows) {
      if (!r.to_mot) continue;
      await client.query(
        `INSERT INTO user_mots (user_id, mot_id, meaning_id, score, nb_quiz)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, mot_id, meaning_id)
         DO UPDATE SET score = GREATEST(user_mots.score, EXCLUDED.score),
                       nb_quiz = user_mots.nb_quiz + EXCLUDED.nb_quiz`,
        [r.user_id, r.to_mot, r.meaning_id, r.score || 0, r.nb_quiz || 0]);
      await client.query('DELETE FROM user_mots WHERE user_id=$1 AND mot_id=$2 AND meaning_id=$3', [r.user_id, r.from_mot, r.meaning_id]);
    }
    // 2. Swap les langs.
    const up1 = await client.query(`UPDATE mots SET lang='zh' WHERE meaning_id = ANY($1::int[]) AND chinese ~ $2 AND lang='en'`, [meanings, CJK]);
    const up2 = await client.query(`UPDATE mots SET lang='en' WHERE meaning_id = ANY($1::int[]) AND chinese !~ $2 AND lang='zh'`, [meanings, CJK]);
    await client.query('COMMIT');
    console.log(`\n✅ Appliqué : ${repoint.rows.length} possession(s) re-pointée(s), ${up1.rowCount} hanzi→zh, ${up2.rowCount} glose→en.`);

    // Vérif : plus de hanzi 'en' ni de latin 'zh' sur ces concepts.
    const leftH = await client.query(`SELECT COUNT(*)::int n FROM mots WHERE meaning_id=ANY($1::int[]) AND chinese ~ $2 AND lang<>'zh'`, [meanings, CJK]);
    const leftG = await client.query(`SELECT COUNT(*)::int n FROM mots WHERE meaning_id=ANY($1::int[]) AND chinese !~ $2 AND lang='zh'`, [meanings, CJK]);
    console.log(`Vérif : hanzi mal étiquetés restants=${leftH.rows[0].n}, gloses zh restantes=${leftG.rows[0].n}`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    console.error('ERREUR:', e.message); process.exitCode = 1;
  } finally { client.release(); await pool.end(); }
})();
