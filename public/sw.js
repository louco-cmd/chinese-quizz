// sw.js - version basique
const CACHE_NAME = 'chinois-app-v1.1';

self.addEventListener('install', (event) => {
  console.log('PWA installée !');
});

self.addEventListener('fetch', (event) => {
  // Logique de cache simple
  event.respondWith(fetch(event.request));
});