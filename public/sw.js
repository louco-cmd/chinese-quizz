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
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of urlsToCache) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn('Impossible de cacher', url, err);
          // Tu peux décider d’ignorer ou gérer autrement
        }
      }
    })
  );
});


self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Autoriser les requêtes vers jsdelivr à passer directement
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Sinon, essaie de retourner du cache, sinon fetch
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    }).catch(() => {
      // Gestion optionnelle en cas d’erreur (ex: offline)
      return caches.match('/offline.html'); // si tu as une page offline
    })
  );
});