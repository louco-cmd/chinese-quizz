// public/js/global.js

// Protection globale contre les cold starts
async function safeFetch(url, options = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, options);
      
      if (response.status === 500 || response.status === 401) {
        console.log(`😴 Tentative ${attempt}/3 - Serveur en redémarrage...`);
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }
      
      return response; // Succès !
      
    } catch (error) {
      console.log(`🌐 Tentative ${attempt}/3 - Erreur réseau...`);
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  throw new Error('Échec après 3 tentatives');
}

// Ou solution globale automatique (encore mieux)
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await originalFetch.apply(this, args);
      
      if (response.status === 500 || response.status === 401) {
        console.log(`🔄 Tentative ${attempt}/3 - Cold start...`);
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      return response;
    } catch (error) {
      console.log(`🔄 Tentative ${attempt}/3 - Erreur réseau...`);
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  throw new Error('Échec après 3 tentatives');
};

// Intercepteur global pour les erreurs d'authentification
async function fetchWithAuth(url, options = {}) {
    try {
        const response = await fetch(url, options);
        
        if (response.status === 401) {
            const data = await response.json();
            // Rediriger vers la page de login
            window.location.href = data.redirectUrl || '/login';
            return null;
        }
        
        return response;
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}

// Export pour utilisation dans d'autres fichiers
window.fetchWithAuth = fetchWithAuth;

// Service Worker pour PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
// 🔥 CHARGEMENT DYNAMIQUE robuste
function chargerPinyinPro() {
  return new Promise((resolve, reject) => {
    // Vérifie si déjà en cours de chargement
    if (window._pinyinLoading) {
      window._pinyinLoading.then(resolve).catch(reject);
      return;
    }
    
    window._pinyinLoading = new Promise((res, rej) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/pinyin-pro@3';
      script.onload = () => {
        console.log('✅ pinyin-pro chargé avec succès');
        res();
      };
      script.onerror = () => {
        console.warn('❌ CDN bloqué, utilisation alternative...');
        rej();
      };
      document.head.appendChild(script);
    });
    
    window._pinyinLoading.then(resolve).catch(reject);
  });
}

window.convertirPinyin = function(texteChinois) {
  // Si pinyin-pro n'est pas chargé, on le charge dynamiquement
  if (typeof pinyinPro === 'undefined') {
    return chargerPinyinPro().then(() => {
      return convertirPinyin(texteChinois); // Rappelle la fonction une fois chargé
    }).catch(() => {
      return ''; // Retourne vide si échec
    });
  }

  if (!texteChinois || typeof texteChinois !== 'string') {
    return '';
  }

  try {
    return pinyinPro.pinyin(texteChinois, {
      toneType: 'symbol',
      pattern: 'pinyin',
      separate: ' '
    });
  } catch (error) {
    console.error('❌ Erreur conversion pinyin:', error);
    return '';
  }
};

// ── Ouvre un lien externe hors de la capsule PWA ─────────────────────────────
// Sur mobile (iOS + Android), window.open() et a.click() programmatiques sont
// bloqués par les navigateurs mobiles (popup blocker, restriction WebView PWA).
// → window.location.href est la seule méthode 100% fiable sur mobile :
//   iOS Safari intercepte le cross-origin et ouvre Safari natif.
//   Android Chrome navigue vers l'URL (back button pour revenir).
// Sur desktop uniquement, on ouvre un nouvel onglet classique.
//
(function() {
  const isMobile = /iphone|ipad|ipod|android/i.test(navigator.userAgent);
  console.log('[openExternal] global.js v6 chargé | isMobile=' + isMobile + ' | UA=' + navigator.userAgent.slice(0, 80));

  window.openExternal = function(url, closeCallback) {
    console.log('[openExternal] appelé | url=' + url + ' | isMobile=' + isMobile);
    if (typeof closeCallback === 'function') closeCallback();
    // Sur mobile : location.href navigue dans l'onglet courant (impossible à bloquer).
    // Sur desktop : window.open() ouvre un nouvel onglet.
    if (isMobile) {
      console.log('[openExternal] → location.href');
      window.location.href = url;
    } else {
      console.log('[openExternal] → window.open');
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };
})();

// Délègue tous les clics sur [data-external] → openExternal
document.addEventListener('click', function(e) {
  const el = e.target.closest('[data-external]');
  if (!el) return;
  console.log('[data-external] click intercepté | url=' + el.dataset.external);
  e.preventDefault();
  e.stopPropagation();
  openExternal(el.dataset.external);
});
