// tts-chinese.js - Version corrigée

class ChineseTTS {
  constructor() {
    // Vérifier si l'API est supportée
    if (!('speechSynthesis' in window)) {
      console.warn('⚠️ API Speech Synthesis non supportée par ce navigateur');
      this.synth = null;
      return;
    }
    
    this.synth = window.speechSynthesis;
    this.voices = [];
    this.chineseVoice = null;
    this.isInitialized = false;
    
    this.init();
  }
  
  init() {
    if (!this.synth) return;
    
    // Charger les voix disponibles
    this.loadVoices();
    
    // Certains navigateurs chargent les voix de manière asynchrone
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = () => {
        console.log('🎙️ Événement onvoiceschangé déclenché');
        this.loadVoices();
      };
    }
    
    // Essayer de charger les voix après un court délai (pour certains navigateurs)
    setTimeout(() => {
      if (this.voices.length === 0) {
        this.loadVoices();
      }
    }, 1000);
  }
  
  loadVoices() {
    if (!this.synth) return null;
    
    try {
      this.voices = this.synth.getVoices();
      
      console.log(`🎙️ ${this.voices.length} voix disponibles`);
      
      // Chercher une voix chinoise (priorité aux voix natives)
      this.chineseVoice = this.voices.find(voice => 
        voice.lang === 'zh-CN' || 
        voice.lang === 'zh-TW' ||
        voice.lang === 'zh-HK' ||
        voice.lang === 'zh'
      );
      
      // Fallback: chercher par nom
      if (!this.chineseVoice) {
        this.chineseVoice = this.voices.find(voice => 
          voice.name.toLowerCase().includes('chinese') ||
          voice.name.toLowerCase().includes('chinois') ||
          voice.name.toLowerCase().includes('zh') ||
          voice.name.toLowerCase().includes('cn')
        );
      }
      
      // Fallback: prendre une voix qui supporte le chinois
      if (!this.chineseVoice) {
        this.chineseVoice = this.voices.find(voice => 
          voice.lang.startsWith('zh')
        );
      }
      
      if (this.chineseVoice) {
        console.log('🎯 Voix chinoise sélectionnée:', {
          name: this.chineseVoice.name,
          lang: this.chineseVoice.lang,
          default: this.chineseVoice.default
        });
      } else {
        console.log('ℹ️ Aucune voix chinoise spécifique trouvée, utilisation de la voix par défaut');
        // Prendre la voix par défaut ou la première disponible
        this.chineseVoice = this.voices.find(v => v.default) || this.voices[0];
      }
      
      this.isInitialized = true;
      return this.chineseVoice;
      
    } catch (error) {
      console.error('❌ Erreur lors du chargement des voix:', error);
      return null;
    }
  }
  
  speak(text, options = {}) {
    // Validation
    if (!this.synth) {
      console.error('❌ API Speech Synthesis non disponible');
      if (options.onError) options.onError('TTS_NOT_SUPPORTED');
      return false;
    }
    
    if (!text || typeof text !== 'string') {
      console.error('❌ Texte invalide pour la synthèse vocale');
      if (options.onError) options.onError('INVALID_TEXT');
      return false;
    }
    
    // Arrêter toute lecture en cours
    this.stop();
    
    // S'assurer que les voix sont chargées
    if (!this.isInitialized || this.voices.length === 0) {
      this.loadVoices();
    }
    
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      
      // Configuration
      utterance.rate = options.rate || 0.75; // Vitesse optimale pour le chinois
      utterance.pitch = options.pitch || 1.0;
      utterance.volume = options.volume || 1.0;
      
      // Utiliser une voix chinoise si disponible
      if (this.chineseVoice) {
        utterance.voice = this.chineseVoice;
        utterance.lang = this.chineseVoice.lang || 'zh-CN';
      } else {
        utterance.lang = 'zh-CN'; // Forcer la langue
      }
      
      // Gestion des événements
      utterance.onstart = () => {
        console.log('🔊 Début de la lecture:', text);
        if (options.onStart) options.onStart();
      };
      
      utterance.onend = () => {
        console.log('✅ Fin de la lecture');
        if (options.onEnd) options.onEnd();
      };
      
      utterance.onerror = (event) => {
        console.error('❌ Erreur TTS:', event.error);
        if (options.onError) options.onError(event.error);
      };
      
      // Délai minimal pour certains navigateurs
      setTimeout(() => {
        this.synth.speak(utterance);
      }, 50);
      
      return true;
      
    } catch (error) {
      console.error('❌ Erreur lors de la création de l\'utterance:', error);
      if (options.onError) options.onError(error.message);
      return false;
    }
  }
  
  stop() {
    if (this.synth && this.synth.speaking) {
      this.synth.cancel();
      console.log('⏹️ Lecture arrêtée');
    }
  }
  
  isSpeaking() {
    return this.synth ? this.synth.speaking : false;
  }
  
  getVoices() {
    return this.voices;
  }
  
  getChineseVoice() {
    return this.chineseVoice;
  }
  
  // Vérifier la compatibilité navigateur
  static isSupported() {
    return 'speechSynthesis' in window;
  }
  
  // Méthode pour tester la synthèse
  test(text = '你好') {
    console.log('🧪 Test TTS avec:', text);
    return this.speak(text, {
      onStart: () => console.log('🧪 Test démarré'),
      onEnd: () => console.log('🧪 Test terminé'),
      onError: (err) => console.error('🧪 Test échoué:', err)
    });
  }
}

// ==================================================
// FONCTIONS GLOBALES DE COMPATIBILITÉ
// ==================================================

// Fonction globale simple (pour compatibilité avec l'ancien code)
window.textToSpeech = function(text, lang = 'zh-CN', options = {}) {
  if (!window.chineseTTS || !window.chineseTTS.synth) {
    console.warn('Utilisation du fallback TTS');
    return fallbackTTS(text, lang);
  }
  return window.chineseTTS.speak(text, {
    rate: options.rate || 0.75,
    ...options
  });
};

// Fonction globale alternative (autre nom pour compatibilité)
window.speakChinese = function(text) {
  return window.textToSpeech(text, 'zh-CN');
};

// Fonction fallback si la classe échoue
function fallbackTTS(text, lang = 'zh-CN') {
  if (!('speechSynthesis' in window)) {
    console.error('❌ Speech Synthesis non supporté');
    return false;
  }
  
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.75;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    // Chercher une voix chinoise rapidement
    const voices = speechSynthesis.getVoices();
    const chineseVoice = voices.find(v => 
      v.lang === 'zh-CN' || 
      v.lang === 'zh-TW' ||
      v.lang.startsWith('zh')
    );
    
    if (chineseVoice) {
      utterance.voice = chineseVoice;
    }
    
    speechSynthesis.speak(utterance);
    return true;
    
  } catch (error) {
    console.error('❌ Erreur fallback TTS:', error);
    return false;
  }
}

// ==================================================
// INITIALISATION AUTOMATIQUE
// ==================================================

// Attendre que le DOM soit chargé
document.addEventListener('DOMContentLoaded', () => {
  console.log('🎵 Initialisation TTS...');
  
  // Créer l'instance globale
  if (!window.chineseTTS) {
    window.chineseTTS = new ChineseTTS();
  }
  
  // Exposer une méthode de test globale
  window.testTTS = function() {
    if (window.chineseTTS) {
      return window.chineseTTS.test();
    }
    return false;
  };
  
  console.log('✅ TTS initialisé');
  
  // Tester automatiquement en développement
  if (window.location.hostname === 'localhost' || 
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === '') {
    setTimeout(() => {
      if (window.chineseTTS && window.chineseTTS.isInitialized) {
        console.log('🧪 Test TTS automatique (développement)');
        // window.chineseTTS.test(); // Décommenter pour tester automatiquement
      }
    }, 2000);
  }
});

// Initialisation immédiate pour les pages déjà chargées
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  if (!window.chineseTTS) {
    window.chineseTTS = new ChineseTTS();
  }
}

// Export pour les modules (si nécessaire)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ChineseTTS,
    textToSpeech: window.textToSpeech,
    speakChinese: window.speakChinese
  };
}