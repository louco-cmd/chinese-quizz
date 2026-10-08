// Mapping simplifié → traditionnel (1 caractère), source OpenCC STCharacters.
// Sert UNIQUEMENT la « time machine » : les formes anciennes EVOBC sont clé sur le
// TRADITIONNEL, donc pour un caractère simplifié on insère un stop 繁 (traditionnel)
// juste avant le moderne dans la frise. ~3900 entrées, chargé une fois (petit JSON).
const map = require('../data/simp-trad.json');

// Renvoie la forme traditionnelle si elle DIFFÈRE du caractère donné, sinon null
// (majorité des caractères = identiques simplifié/traditionnel → pas de stop trad).
function toTrad(ch) {
  const t = map[ch];
  return t && t !== ch ? t : null;
}

module.exports = { toTrad };
