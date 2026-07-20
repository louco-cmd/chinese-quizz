// Tokens de design Jiayou, version JS — pour les props qui n'acceptent pas
// className (ex: color d'ActivityIndicator, tintColor, ombres via style).
// Doit rester synchronisé avec tailwind.config.js.

export const COLORS = {
  jiayou: '#0d6efd',
  jiayouDark: '#0a58ca',
  jiayouSoft: '#e8f0ff',
  jiayouContainer: '#e3f2fd',

  ink: '#1d1d1f',
  muted: '#6c757d',
  mutedLight: '#8a98b5',

  surface: '#ffffff',
  page: '#f8f9fa',
  surfaceAlt: '#e9ecef',

  line: '#e0e0e0',
  lineSoft: '#f0f0f0',

  success: '#198754',
  danger: '#dc3545',
  warning: '#ffc107',
  warningBg: '#fff3cd',

  white: '#ffffff',
};

// Ombre des cartes EJS : 0 2px 12px rgba(0,0,0,0.07)
export const SHADOW_CARD = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.07,
  shadowRadius: 12,
  elevation: 2, // Android
};

// Ombre pour les cartes ANIMÉES en opacity (fondu, carrousel) : pas d'elevation,
// car sur Android une vue avec elevation rendue à opacity < 1 affiche son ombre
// comme un rectangle gris plein. On garde l'ombre iOS + un liseré pour la
// définition sur Android.
export const SHADOW_CARD_FLAT = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.07,
  shadowRadius: 12,
  borderWidth: 1,
  borderColor: '#eef0f4',
};
