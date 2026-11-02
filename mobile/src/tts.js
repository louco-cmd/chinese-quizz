// TTS service.
//  • Web   : neural Edge voice via the backend proxy (/api/m/tts), played with the
//    browser's own Audio element — no native module, works everywhere.
//  • Native: neural Edge voice via expo-audio streaming the same /api/m/tts MP3.
//    If expo-audio is absent (older binary without the native module) or playback
//    fails, we fall back to expo-speech (OS voice). We deliberately do NOT use
//    expo-av: it was removed in SDK 57 and streaming a remote URL through it
//    crashed the app (black screen).
import { Platform } from 'react-native';
import { API_BASE } from './api';

var _webAudio = null;   // single reused HTMLAudioElement on web
var _nativePlayer = null; // single reused expo-audio AudioPlayer on native

var _AudioMod;
function getAudio() {
  if (_AudioMod !== undefined) return _AudioMod;
  try { _AudioMod = require('expo-audio'); } catch (e) { _AudioMod = null; }
  return _AudioMod;
}

function stopNativePlayer() {
  if (!_nativePlayer) return;
  try { _nativePlayer.pause(); } catch (e) { /* noop */ }
  try { _nativePlayer.remove(); } catch (e) { /* noop */ }
  _nativePlayer = null;
}

export async function stop() {
  if (Platform.OS === 'web') {
    if (_webAudio) { try { _webAudio.pause(); } catch (e) { /* noop */ } }
    return;
  }
  stopNativePlayer();
  try { require('expo-speech').stop(); } catch (e) { /* noop */ }
}

function ttsUrl(text, lang) {
  return API_BASE + '/api/m/tts?text=' + encodeURIComponent(text) + '&lang=' + encodeURIComponent(lang);
}

// speak(text, lang, opts?)
//   text : string to synthesize
//   lang : locale code (e.g. 'zh-CN', 'fr-FR', 'en-US')
//   opts : { rate?: 0.5–2.0, onStart?, onDone?, onError? }
export async function speak(text, lang, opts) {
  if (!lang) lang = 'zh-CN';
  if (!opts) opts = {};
  var rate = opts.rate || 1.0;
  var onStart = opts.onStart;
  var onDone = opts.onDone;
  var onError = opts.onError;

  if (!text || !text.trim()) return;

  // ── Web : neural MP3 via <audio> ────────────────────────────────────────────
  if (Platform.OS === 'web') {
    var url = ttsUrl(text, lang);
    try {
      if (_webAudio) { try { _webAudio.pause(); } catch (e) { /* noop */ } }
      var audio = new Audio(url);
      audio.playbackRate = rate;
      _webAudio = audio;
      if (onStart) onStart();
      audio.onended = function () { if (onDone) onDone(); };
      audio.onerror = function () { speakWithSpeech(text, lang, rate, onDone, onError); };
      var p = audio.play();
      if (p && p.catch) p.catch(function () { speakWithSpeech(text, lang, rate, onDone, onError); });
    } catch (e) {
      speakWithSpeech(text, lang, rate, onDone, onError);
    }
    return;
  }

  // ── Native : neural via expo-audio, repli expo-speech ───────────────────────
  speakNeuralNative(text, lang, rate, onStart, onDone, onError);
}

// Lecture neural native : streame le MP3 /api/m/tts via expo-audio.
function speakNeuralNative(text, lang, rate, onStart, onDone, onError) {
  var Audio = getAudio();
  if (!Audio) { // binaire sans le module natif → voix OS
    if (onStart) onStart();
    speakWithSpeech(text, lang, rate, onDone, onError);
    return;
  }
  try {
    stopNativePlayer();
    try { Audio.setAudioModeAsync({ playsInSilentMode: true }); } catch (e) { /* noop */ }
    var player = Audio.createAudioPlayer(ttsUrl(text, lang));
    _nativePlayer = player;
    try { player.playbackRate = rate; } catch (e) { /* noop */ }
    var done = false;
    player.addListener('playbackStatusUpdate', function (st) {
      if (done) return;
      if (st && st.didJustFinish) { done = true; if (onDone) onDone(); }
    });
    if (onStart) onStart();
    player.play();
  } catch (e) {
    // repli voix OS si la lecture neural échoue
    if (onStart) onStart();
    speakWithSpeech(text, lang, rate, onDone, onError);
  }
}

function speakWithSpeech(text, lang, rate, onDone, onError) {
  try {
    var Speech = require('expo-speech');
    Speech.stop();
    Speech.speak(text, {
      language: lang,
      rate: rate,
      onDone: function () { if (onDone) onDone(); },
      onError: function (e) { if (onError) onError(e); },
    });
  } catch (e) {
    if (onError) onError(e);
  }
}
