// TTS service.
//  • Web   : neural Edge voice via the backend proxy (/api/m/tts), played with the
//    browser's own Audio element — no native module, works everywhere.
//  • Native: expo-speech (OS voice). We deliberately do NOT use expo-av here:
//    expo-av is gone from SDK 57 and streaming a remote URL through it crashed the
//    app (black screen). The neural voice returns on native once expo-audio ships
//    in a native rebuild (see pending-native-rebuild).
import { Platform } from 'react-native';
import { API_BASE } from './api';

var _webAudio = null; // single reused HTMLAudioElement on web

export async function stop() {
  if (Platform.OS === 'web') {
    if (_webAudio) { try { _webAudio.pause(); } catch (e) { /* noop */ } }
    return;
  }
  try {
    var Speech = require('expo-speech');
    Speech.stop();
  } catch (e) { /* noop */ }
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
    var url = API_BASE + '/api/m/tts?text=' + encodeURIComponent(text) + '&lang=' + encodeURIComponent(lang);
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

  // ── Native : voix OS via expo-speech ────────────────────────────────────────
  if (onStart) onStart();
  speakWithSpeech(text, lang, rate, onDone, onError);
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
