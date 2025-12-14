// sw.js - VERSION ROBUSTE
const CACHE_NAME = 'jiayou-v3'; // 🔥 CHANGEZ À CHAQUE DÉPLOIEMENT MAJEUR
const OFFLINE_URL = '/offline.html'; // Optionnel : page hors ligne

const urlsToCache = [
  '/',
  '/css/accountandduels.css',
  '/js/global.js',
  '/js/saveQuiz.js',
  '/js/card-functions.js',
  '/manifest.json'
];

// ========== INSTALL ==========
self.addEventListener('install', (event) => {
  console.log('[SW] Installation v3');
  
  // Force l'activation IMMÉDIATE sans attendre
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Mise en cache des ressources');
      for (const url of urlsToCache) {
        try {
          // Utilise cache.put() au lieu de cache.add() pour plus de contrôle
          const response = await fetch(url, { cache: 'reload' });
          if (response.ok) {
            await cache.put(url, response);
          }
        } catch (err) {
          console.warn(`[SW] Impossible de cacher ${url}:`, err);
        }
      }
    })
  );
});

// ========== ACTIVATE ==========
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation v3');
  
  event.waitUntil(
    Promise.all([
      // 1. PRENDRE LE CONTRÔLE IMMÉDIATEMENT sur tous les clients
      clients.claim(),
      
      // 2. NETTOYER LES ANCIENS CACHES
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log(`[SW] Suppression ancien cache: ${cacheName}`);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      
      // 3. SUPPRIMER TOUS LES ANCIENS SERVICE WORKERS
      // Cette étape est cruciale pour éviter les conflits
      self.registration.unregister().then(() => {
        console.log('[SW] Ancien SW désinscrit');
      }).catch(() => {})
    ]).then(() => {
      console.log('[SW] Prêt à fonctionner!');
      // Envoyer un message à tous les clients pour recharger
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_UPDATED', version: 'v3' });
        });
      });
    })
  );
});

// ========== FETCH ==========
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // 1. Exclusion : ressources externes ou API
  if (url.hostname === 'cdn.jsdelivr.net' || 
      url.pathname.startsWith('/api/') || 
      event.request.method !== 'GET') {
    return; // Laisser passer sans interception
  }
  
  // 2. Stratégie "Cache d'abord, puis réseau" pour les assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Retourne du cache si disponible
      if (cachedResponse) {
        // En parallèle, met à jour le cache avec la version réseau
        fetch(event.request).then((networkResponse) => {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse);
          });
        }).catch(() => {}); // Ignore les erreurs
        return cachedResponse;
      }
      
      // Sinon, va chercher sur le réseau
      return fetch(event.request).then((networkResponse) => {
        // Mettre en cache pour la prochaine fois
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return networkResponse;
      }).catch(() => {
        // Mode hors ligne : retourne la page offline si elle existe
        if (event.request.mode === 'navigate') {
          return caches.match(OFFLINE_URL);
        }
        // Pour les autres ressources, retourne une réponse vide
        return new Response('', { 
          status: 408, 
          statusText: 'Hors ligne' 
        });
      });
    })
  );
});

// ========== COMMUNICATION ==========
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});