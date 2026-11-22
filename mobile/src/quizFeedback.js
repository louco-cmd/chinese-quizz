import { Platform } from 'react-native';

// expo-haptics est un module natif : absent tant que l'AAB ne l'embarque pas.
// Lazy-require protégé → une OTA ne crashe pas sur un ancien binaire ; le retour
// haptique est simplement un no-op jusqu'au prochain build natif.
// (Les chimes sonores réussite/erreur ont été retirés — plus de son sur les quiz.)
let _Haptics;
function getHaptics() {
  if (_Haptics !== undefined) return _Haptics;
  try { _Haptics = require('expo-haptics'); } catch { _Haptics = null; }
  return _Haptics;
}

export async function feedbackSuccess() {
  if (Platform.OS === 'web') return;
  const Haptics = getHaptics();
  if (Haptics) { try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch { /* noop */ } }
}

export async function feedbackError() {
  if (Platform.OS === 'web') return;
  const Haptics = getHaptics();
  if (Haptics) { try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); } catch { /* noop */ } }
}
