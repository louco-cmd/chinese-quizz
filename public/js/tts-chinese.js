class ChineseTTS {
  constructor() {
    this.synth = window.speechSynthesis;
    this.voices = [];
    this.chineseVoice = null;
    
    this.init();
  }
  
  init() {
    // Charger les voix disponibles
    this.loadVoices();
    
    // Recharger les voix si nécessaire (certains navigateurs chargent les voix après)
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = () => this.loadVoices();
    }
  }
  
  loadVoices() {
    this.voices = this.synth.getVoices();
    
    // Chercher une voix chinoise
    this.chineseVoice = this.voices.find(voice => 
      voice.lang.includes('zh') || 
      voice.lang.includes('cn') ||
      voice.name.toLowerCase().includes('chinese')
    );
    
    console.log('🎙️ Voix disponibles:', this.voices.map(v => `${v.name} (${v.lang})`));
    console.log('🎯 Voix chinoise sélectionnée:', this.chineseVoice);
    
    return this.chineseVoice;
  }
  
  speak(text, options = {}) {
    // Arrêter toute lecture en cours
    this.stop();
    
    if (!this.synth) {
      console.error('❌ API Speech Synthesis non supportée');
      return false;
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Configuration
    utterance.rate = options.rate || 0.8; // Vitesse lente pour le chinois
    utterance.pitch = options.pitch || 1;
    utterance.volume = options.volume || 1;
    
    // Utiliser une voix chinoise si disponible
    if (this.chineseVoice) {
      utterance.voice = this.chineseVoice;
      utterance.lang = 'zh-CN';
    } else {
      utterance.lang = 'zh-CN'; // Forcer la langue même sans voix spécifique
    }
    
    // Événements
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
    
    this.synth.speak(utterance);
    return true;
  }
  
  stop() {
    if (this.synth.speaking) {
      this.synth.cancel();
    }
  }
  
  isSpeaking() {
    return this.synth.speaking;
  }
  
  // Vérifier la compatibilité navigateur
  static isSupported() {
    return 'speechSynthesis' in window;
  }
}

// Instance globale
window.chineseTTS = new ChineseTTS();