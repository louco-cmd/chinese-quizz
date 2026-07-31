// CC-CEDICT : dictionnaire chinois→anglais libre (~120k entrées), utilisé comme
// FALLBACK de traduction pour les mots absents de notre table `mots`.
// - Source : MDBG (fichier data/cedict.txt.gz, licence CC-BY-SA 4.0).
// - Chargé une seule fois, en mémoire (~40 Mo), de façon PARESSEUSE : le parsing
//   n'a lieu qu'au premier lookup, pas au boot (l'import est un usage rare).
// - On n'expose QUE l'anglais : le pinyin reste généré par pinyin-pro côté appelant.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const GZ_PATH = path.join(__dirname, '..', 'data', 'cedict.txt.gz');

let map = null; // Map<hanzi simplifié, string anglais>

// Ligne CEDICT : `Traditionnel Simplifié [pin1 yin1] /sens 1/sens 2/.../`
const LINE_RE = /^(\S+)\s+(\S+)\s+\[[^\]]*\]\s+\/(.+)\/\s*$/;

// Nettoie la liste de glosses : retire les classificateurs (CL:…), garde les
// 3 premiers sens, joint par « ; ». Renvoie '' si rien d'exploitable.
function cleanGlosses(raw) {
  const glosses = raw.split('/')
    .map((g) => g.trim())
    .filter((g) => g && !/^CL:/.test(g));
  return glosses.slice(0, 3).join('; ');
}

function build() {
  const m = new Map();
  try {
    const text = zlib.gunzipSync(fs.readFileSync(GZ_PATH)).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line || line[0] === '#') continue;
      const match = LINE_RE.exec(line);
      if (!match) continue;
      const simplified = match[2];
      if (m.has(simplified)) continue; // 1re graphie gagne (suffisant pour l'import)
      const english = cleanGlosses(match[3]);
      if (english) m.set(simplified, english);
    }
  } catch (e) {
    console.error('cedict load error:', e.message);
  }
  return m;
}

// Renvoie la traduction anglaise d'un mot chinois, ou '' si introuvable.
function translate(chinese) {
  if (!chinese) return '';
  if (!map) map = build();
  return map.get(chinese) || '';
}

module.exports = { translate };
