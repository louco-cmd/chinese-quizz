import { Platform } from 'react-native';

// expo-haptics / expo-audio sont des modules natifs : absents tant que l'AAB ne les
// embarque pas. Lazy-require protégé → une OTA ne crashe pas sur un ancien binaire ;
// le retour haptique / sonore est simplement un no-op jusqu'au prochain build natif.
// (expo-av a été retiré de SDK 57 ; expo-audio est son remplaçant — cf. tts.js.)
let _Haptics;
function getHaptics() {
  if (_Haptics !== undefined) return _Haptics;
  try { _Haptics = require('expo-haptics'); } catch { _Haptics = null; }
  return _Haptics;
}
let _Audio;
function getAudio() {
  if (_Audio !== undefined) return _Audio;
  try { _Audio = require('expo-audio'); } catch { _Audio = null; }
  return _Audio;
}

// Chimes réussite / erreur, bundlés comme assets (require → source expo-audio).
const SUCCESS_SRC = require('../assets/sfx/success.wav');
const ERROR_SRC = require('../assets/sfx/error.wav');

let successPlayer = null;
let errorPlayer = null;

function loadSounds() {
  if (successPlayer && errorPlayer) return;
  const Audio = getAudio();
  if (!Audio) return;
  try {
    // Les chimes respectent le mode silencieux iOS (playsInSilentMode: false).
    Audio.setAudioModeAsync({ playsInSilentMode: false });
    successPlayer = Audio.createAudioPlayer(SUCCESS_SRC);
    successPlayer.volume = 0.6;
    errorPlayer = Audio.createAudioPlayer(ERROR_SRC);
    errorPlayer.volume = 0.5;
  } catch { /* sounds optional */ }
}

// Preload on first import so first answer has no latency
if (Platform.OS !== 'web') loadSounds();

function playSound(player) {
  if (!player) return;
  try {
    player.seekTo(0); // rejoue depuis le début
    player.play();
  } catch { /* noop */ }
}

export async function feedbackSuccess() {
  loadSounds();
  const Haptics = getHaptics();
  if (Haptics) { try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch { /* noop */ } }
  playSound(successPlayer);
}

export async function feedbackError() {
  loadSounds();
  const Haptics = getHaptics();
  if (Haptics) { try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); } catch { /* noop */ } }
  playSound(errorPlayer);
}
