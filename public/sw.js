// sw.js - VERSION CORRIGÉE & SIMPLIFIÉE
const CACHE_NAME = 'jiayou-v8';
const OFFLINE_URL = '/offline.html';

// Ne PAS mettre global.js en cache : il doit toujours être rechargé depuis le réseau
// pour que les mises à jour soient instantanées.
const urlsToCache = [
  '/',
  '/offline.html',
  '/css/accountandduels.css',
  '/js/saveQuiz.js',
  '/js/card-function.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-app.png',
];

// ========== INSTALL ==========
self.addEventListener('install', (event) => {
  console.log('[SW] Installation v4');
  self.skipWaiting(); // Prend le contrôle ASAP
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .catch(err => console.warn('[SW] Cache initial échoué:', err))
  );
});

// ========== ACTIVATE ==========
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation v4 - Nettoyage');
  
  event.waitUntil(
    Promise.all([
      clients.claim(), // Prendre contrôle des pages
      
      // NETTOYER UNIQUEMENT les anciens CACHES (pas le SW lui-même !)
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              console.log(`[SW] Suppression cache obsolète: ${cacheName}`);
              return caches.delete(cacheName);
            }
          })
        );
      })
    ]).then(() => {
      console.log('[SW] Prêt (v1)');
      // Notification discrète aux clients
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'SW_READY', version: 'v1' });
        });
      });
    })
  );
});

// ========== FETCH ==========
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isNav = event.request.mode === 'navigate';
  
  // 1. EXCLUSIONS : ne JAMAIS mettre en cache
  if (url.pathname.startsWith('/auth/') ||  // Routes d'authentification
      url.pathname.startsWith('/api/') ||   // Appels API
      event.request.method !== 'GET' ||
      url.hostname !== self.location.hostname) { // Ressources externes
    return; // Laisser passer au réseau
  }
  
  // Pour les navigations (pages) : Réseau d'abord, puis cache offline
  if (isNav) {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match('/offline.html'))
    );
    return;
  }
  
  // Pour les assets (CSS, JS, images) : Cache d'abord, puis réseau
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
      .catch(() => {
        if (event.request.destination === 'image') {
          return new Response(''); // Image vide si échec
        }
        return new Response('Ressource non disponible');
      })
  );
});

// ========== MESSAGE ==========
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});

// ========== PUSH NOTIFICATIONS ==========
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title || 'Jiayou', {
      body:  data.body  || '',
      icon:  '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data:  { url: data.url || '/duels' },
      tag:   data.tag  || 'jiayou-duel',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/duels';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Si une fenêtre est déjà ouverte, la focus et naviguer
      for (const client of list) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(targetUrl);
          return;
        }
      }
      // Sinon ouvrir un nouvel onglet
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});