// TTS service — uses Edge neural voices via backend proxy (/api/m/tts).
// Falls back to expo-speech if the request fails or on web without audio support.
import { Platform } from 'react-native';
import { API_BASE } from './api';

// expo-av est un module natif : il n'existe pas tant que l'AAB ne l'embarque pas.
// On le charge en lazy-require protégé pour qu'une OTA ne crashe pas sur un binaire
// qui ne le contient pas encore (le TTS tombe alors sur expo-speech).
var _Audio;
function getAudio() {
  if (_Audio !== undefined) return _Audio;
  try { _Audio = require('expo-av').Audio; } catch (e) { _Audio = null; }
  return _Audio;
}

var _sound = null;
var _playing = false;

export async function stop() {
  _playing = false;
  if (_sound) {
    try { await _sound.stopAsync(); } catch (e) { /* noop */ }
  }
}

// speak(text, lang, opts?)
//   text : string to synthesize
//   lang : locale code matching LANG_META.tts (e.g. 'zh-CN', 'fr-FR', 'en-US')
//   opts : { rate?: 0.5–2.0, onStart?, onDone?, onError? }
export async function speak(text, lang, opts) {
  if (!lang) lang = 'zh-CN';
  if (!opts) opts = {};
  var rate = opts.rate || 1.0;
  var onStart = opts.onStart;
  var onDone = opts.onDone;
  var onError = opts.onError;

  if (!text || !text.trim()) return;

  var url = API_BASE + '/api/m/tts?text=' + encodeURIComponent(text) + '&lang=' + encodeURIComponent(lang);

  var Audio = getAudio();
  // Pas d'expo-av dans ce binaire → fallback direct expo-speech.
  if (!Audio) {
    try {
      var Speech = require('expo-speech');
      if (onStart) onStart();
      Speech.speak(text, { language: lang, rate: rate, onDone: function() { if (onDone) onDone(); } });
    } catch (e) { if (onError) onError(e); }
    return;
  }

  try {
    await stop();
    _playing = true;

    if (_sound) {
      try { await _sound.unloadAsync(); } catch (e) { /* noop */ }
      _sound = null;
    }

    if (onStart) onStart();

    var result = await Audio.Sound.createAsync(
      { uri: url },
      { shouldPlay: true, rate: rate, volume: 1.0, shouldCorrectPitch: true }
    );
    var sound = result.sound;
    _sound = sound;

    sound.setOnPlaybackStatusUpdate(function(status) {
      if (!_playing) return;
      if (status.didJustFinish) {
        _playing = false;
        if (onDone) onDone();
        sound.unloadAsync().catch(function() {});
        if (_sound === sound) _sound = null;
      }
    });
  } catch (e) {
    _playing = false;
    // Fallback to expo-speech on error
    try {
      var Speech2 = require('expo-speech');
      Speech2.speak(text, { language: lang, rate: rate });
      if (onDone) onDone();
    } catch (e2) {
      if (onError) onError(e);
    }
  }
}
