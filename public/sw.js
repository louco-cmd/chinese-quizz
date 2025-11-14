// Dans ton sw.js
const CACHE_NAME = 'jiayou-v2';
const urlsToCache = [
  '/',
  '/css/accountandduels.css',
  '/js/global.js',
  '/js/saveQuiz.js',
  '/js/card-functions.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Retourne le cache si trouvé, sinon fetch
        return response || fetch(event.request);
      }
    )
  );
});

// Dans ton sw.js - ajoute cette règle
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // 🔥 AUTORISER les requêtes vers jsdelivr
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(fetch(event.request));
    return;
  }
  
  // ... le reste de ta logique existante
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});