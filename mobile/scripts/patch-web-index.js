// Post-build : injecte les balises PWA dans dist/index.html (Expo web ne les met
// pas). Nécessaire pour que l'app soit détectée comme PWA installable (TWA
// PWABuilder / Play Store). Idempotent. Exécuté après `expo export --platform web`.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'dist', 'index.html');
if (!fs.existsSync(file)) {
  console.error('patch-web-index: dist/index.html introuvable (build web manquant ?)');
  process.exit(1);
}

let html = fs.readFileSync(file, 'utf8');

if (html.includes('rel="manifest"')) {
  console.log('patch-web-index: déjà patché.');
  process.exit(0);
}

// Clavier mobile : `interactive-widget=resizes-content` fait redimensionner la
// zone visible quand le clavier s'ouvre (Chrome Android) → le contenu centré
// remonte au lieu d'être couvert par le clavier.
if (/<meta name="viewport"[^>]*>/.test(html)) {
  html = html.replace(/<meta name="viewport"([^>]*?)content="([^"]*)"([^>]*)>/, (m, pre, content, post) => {
    const c = /interactive-widget/.test(content) ? content : `${content.trim()}, interactive-widget=resizes-content`;
    return `<meta name="viewport"${pre}content="${c}"${post}>`;
  });
} else {
  html = html.replace('</head>', '    <meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content" />\n  </head>');
}

const tags = [
  '<link rel="manifest" href="/manifest.json" />',
  '<meta name="theme-color" content="#0d6efd" />',
  '<link rel="apple-touch-icon" href="/icons/icon-192.png" />',
  '<link rel="icon" href="/icons/icon-192.png" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
  '<meta name="apple-mobile-web-app-title" content="Jiayou" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
].join('\n    ');

html = html.replace('</head>', `    ${tags}\n  </head>`);
fs.writeFileSync(file, html);
console.log('patch-web-index: balises PWA injectées.');
