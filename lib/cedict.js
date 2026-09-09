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

// Plage Han (BMP + compat) pour repérer les renvois croisés CC-CEDICT.
const HAN = '[\\u3400-\\u9fff\\uf900-\\ufaff]';

// Sens purement lexicographiques, inutiles voire trompeurs pour un apprenant
// (noms de radicaux, abréviations-renvois, variantes graphiques, noms de famille,
// notes de prononciation régionale). On les ÉCARTE au profit d'un vrai sens.
const META_RE = new RegExp(
  '(?:' +
  'Kangxi radical|radical in Chinese|' +      // 丶 亅 卩 …
  'abbr\\. for|abbreviation for|' +           // 斗 瓦 …
  'variant of|old variant of|erhua variant|' +
  '\\bsurname\\b|' +
  '(?:Taiwan|also|old|Cantonese|Japanese) pr\\.|' + // notes de prononciation
  'used in ' + HAN +
  ')', 'i',
);

// Renvois croisés « 汉字[pin1 yin1] » / « 繁|简[pin1 yin1] » + annotations pinyin
// résiduelles : bruit pour l'apprenant → on les retire du sens conservé.
const REF_RE = new RegExp(`\\s*${HAN}+(?:\\|${HAN}+)?\\s*\\[[^\\]]*\\]`, 'g');
const VARIANT_RE = new RegExp(`(${HAN}+)\\|${HAN}+`, 'g');

function cleanOne(g) {
  return g
    .replace(REF_RE, '')                       // « 點|点[dian3] » → (supprimé)
    .replace(/\s*\[[^\]]*\]/g, '')             // « [pin1 yin1] » orphelin
    .replace(VARIANT_RE, '$1')                 // « 繁|简 » restant → 1re graphie
    .replace(/\s*\(?\s*CL:\s*\)?/gi, '')       // classificateur inline « (CL:…) »
    .replace(/\(\s*\)/g, '')                   // parenthèses vidées par un retrait
    .replace(/\b(?:aka|also written(?: as)?|see(?: also)?|cf\.?)\s*$/i, '') // connecteur orphelin en fin
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([;,.)])/g, '$1')
    .replace(/^[\s;,–-]+/, '')
    .replace(/[\s(;,–-]+$/, '')
    .trim();
}

// Nettoie la liste de glosses : retire les classificateurs (CL:…) et les sens
// méta, nettoie les renvois croisés, garde les 3 premiers VRAIS sens (joints par
// « ; »). Renvoie '' si rien d'exploitable ne subsiste (champ laissé à saisir,
// plutôt qu'une définition trompeuse type « "dot" radical … »).
function cleanGlosses(raw) {
  const useful = raw.split('/')
    .map((g) => g.trim())
    .filter((g) => g && !/^CL:/.test(g) && !META_RE.test(g))
    .map(cleanOne)
    .filter(Boolean);
  return useful.slice(0, 3).join('; ');
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
