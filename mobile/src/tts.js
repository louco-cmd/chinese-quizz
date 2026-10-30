// TTS service — uses Edge neural voices via backend proxy (/api/m/tts).
// Falls back to expo-speech if the request fails or on web without audio support.
import { Audio } from 'expo-av';
import { Platform } from 'react-native';
import { API_BASE } from './api';

// One Sound instance reused across calls (replaces previous before playing)
let _sound = null;
let _playing = false;

export async function stop() {
  _playing = false;
  if (_sound) {
    try { await _sound.stopAsync(); } catch { /* noop */ }
  }
}

// speak(text, lang, opts?)
//   text : string to synthesize
//   lang : locale code matching LANG_META.tts (e.g. 'zh-CN', 'fr-FR', 'en-US')
//   opts : { rate?: 0.5–2.0, onStart?, onDone?, onError? }
export async function speak(text, lang = 'zh-CN', opts = {}) {
  const { rate = 1.0, onStart, onDone, onError } = opts;

  if (!text?.trim()) return;

  // Web: the backend URL is accessible same-origin; Audio.Sound works via <audio>
  // Native: expo-av plays HTTP URLs natively
  const url = `${API_BASE}/api/m/tts?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang)}`;

  try {
    await stop();
    _playing = true;

    if (_sound) {
      try { await _sound.unloadAsync(); } catch { /* noop */ }
      _sound = null;
    }

    onStart?.();

    const { sound } = await Audio.Sound.createAsync(
      { uri: url },
      { shouldPlay: true, rate, volume: 1.0 },
    );
    _sound = sound;

    sound.setOnPlaybackStatusUpdate((status) => {
      if (!_playing) return;
      if (status.didJustFinish) {
        _playing = false;
        onDone?.();
        sound.unloadAsync().catch(() => {});
        if (_sound === sound) _sound = null;
      }
    });
  } catch (e) {
    _playing = false;
    // Fallback to expo-speech on error
    try {
      const Speech = await import('expo-speech');
      Speech.default.speak(text, { language: lang, rate });
      onDone?.();
    } catch {
      onError?.(e);
    }
  }
}
