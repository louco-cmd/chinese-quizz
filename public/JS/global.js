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