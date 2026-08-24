// Métadonnées de langue pour le cours multilingue. Le backend renvoie déjà le
// terme appris dans `word.chinese` et la traduction native dans `word.english`
// (dérivée du concept) : le frontend n'a plus besoin du binaire quiz_direction,
// seulement de la langue apprise (pinyin/hanzi/voix/types de quiz) et des labels.

export const LANG_META = {
  zh: { label: 'Chinese', endonym: '中文', hasPinyin: true, tts: 'zh-CN' },
  en: { label: 'English', endonym: 'English', hasPinyin: false, tts: 'en-US' },
  fr: { label: 'French', endonym: 'Français', hasPinyin: false, tts: 'fr-FR' },
  es: { label: 'Spanish', endonym: 'Español', hasPinyin: false, tts: 'es-ES' },
  de: { label: 'German', endonym: 'Deutsch', hasPinyin: false, tts: 'de-DE' },
};

// Langues qu'on peut APPRENDRE aujourd'hui (celles qui ont du contenu).
export const LEARNABLE = ['zh', 'en', 'fr'];

// Helpers sûrs (valeurs par défaut = l'historique zh depuis en).
export const langMeta = (code) => LANG_META[code] || LANG_META.zh;
export const langLabel = (code) => (LANG_META[code] || {}).label || code;
export const isZhLearning = (learningLang) => (learningLang || 'zh') === 'zh';
export const ttsFor = (code) => langMeta(code).tts;
