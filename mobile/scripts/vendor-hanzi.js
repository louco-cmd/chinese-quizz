// Régénère src/components/hanziWriterLib.js à partir du paquet npm hanzi-writer.
// La lib est embarquée dans le bundle plutôt que chargée depuis un CDN : jsDelivr
// est bloqué ou très instable en Chine, où se trouve l'essentiel des utilisateurs.
// À relancer après une mise à jour de la dépendance : node scripts/vendor-hanzi.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'node_modules', 'hanzi-writer', 'dist', 'hanzi-writer.min.js'),
  'utf8'
);

const out =
  '// GÉNÉRÉ — source minifiée de hanzi-writer, embarquée pour ne PAS dépendre\n' +
  "// d'un CDN (jsDelivr est bloqué/instable en Chine, notre public principal).\n" +
  '// Régénérer avec : node scripts/vendor-hanzi.js\n' +
  'export default ' + JSON.stringify(src) + ';\n';

fs.writeFileSync(path.join(__dirname, '..', 'src', 'components', 'hanziWriterLib.js'), out);
console.log(`vendor-hanzi: ${(out.length / 1024).toFixed(0)} Ko écrits`);
