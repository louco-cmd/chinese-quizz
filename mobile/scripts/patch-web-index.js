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
// Zoom désactivé (iOS PWA) : `maximum-scale=1, user-scalable=no` empêche le
// pincement en mode standalone (écran d'accueil). En onglet Safari, ces valeurs
// sont ignorées → un garde JS (plus bas) bloque le pincement dans tous les cas.
if (/<meta name="viewport"[^>]*>/.test(html)) {
  html = html.replace(/<meta name="viewport"([^>]*?)content="([^"]*)"([^>]*)>/, (m, pre, content, post) => {
    let c = content.trim();
    if (!/interactive-widget/.test(c)) c += ', interactive-widget=resizes-content';
    if (!/maximum-scale/.test(c)) c += ', maximum-scale=1';
    if (!/user-scalable/.test(c)) c += ', user-scalable=no';
    return `<meta name="viewport"${pre}content="${c}"${post}>`;
  });
} else {
  html = html.replace('</head>', '    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, interactive-widget=resizes-content" />\n  </head>');
}

// Favicon déterministe : on retire le lien Expo par défaut (/favicon.ico) pour
// éviter deux <link rel="icon"> concurrents, puis on injecte nos icônes de marque
// (加油!) en PNG dimensionnés. `?v=` = cache-bust → force les navigateurs à
// reprendre le bon logo si un ancien favicon est en cache. Monter ce numéro à
// chaque changement d'icône.
const ICON_V = '3';
html = html.replace(/\s*<link[^>]*rel="(?:shortcut )?icon"[^>]*>/gi, '');

const tags = [
  '<link rel="manifest" href="/manifest.json" />',
  '<meta name="theme-color" content="#0d6efd" />',
  `<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png?v=${ICON_V}" />`,
  `<link rel="icon" type="image/png" sizes="512x512" href="/icons/icon-512.png?v=${ICON_V}" />`,
  `<link rel="icon" href="/favicon.ico?v=${ICON_V}" />`,
  `<link rel="apple-touch-icon" href="/icons/icon-192.png?v=${ICON_V}" />`,
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
  '<meta name="apple-mobile-web-app-title" content="Jiayou" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
].join('\n    ');

html = html.replace('</head>', `    ${tags}\n  </head>`);

// Anti-zoom : `touch-action: manipulation` supprime le double-tap zoom (sans
// casser les clics) ; le garde JS bloque le pincement (événements `gesture*`
// propres à Safari) — utile en onglet où `user-scalable=no` est ignoré.
const noZoom = [
  '<style>html,body{touch-action:manipulation;-webkit-text-size-adjust:100%}</style>',
  '<script>(function(){var p=function(e){e.preventDefault();};'
    + "document.addEventListener('gesturestart',p,{passive:false});"
    + "document.addEventListener('gesturechange',p,{passive:false});"
    + "document.addEventListener('gestureend',p,{passive:false});})();</script>",
].join('\n    ');
html = html.replace('</head>', `    ${noZoom}\n  </head>`);

fs.writeFileSync(file, html);
console.log('patch-web-index: balises PWA + anti-zoom injectées.');
