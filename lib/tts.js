const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let _MsEdgeTTS, _OUTPUT_FORMAT;
function loadEdgeTTS() {
  if (_MsEdgeTTS !== undefined) return !!_MsEdgeTTS;
  try {
    const mod = require('msedge-tts');
    _MsEdgeTTS = mod.MsEdgeTTS;
    _OUTPUT_FORMAT = mod.OUTPUT_FORMAT;
    return true;
  } catch {
    _MsEdgeTTS = null;
    return false;
  }
}

// Neural voices per locale — best quality, natural pronunciation
const VOICES = {
  'zh-CN': 'zh-CN-XiaoxiaoNeural',
  'zh-TW': 'zh-TW-HsiaoChenNeural',
  'en-US': 'en-US-AriaNeural',
  'en-GB': 'en-GB-SoniaNeural',
  'fr-FR': 'fr-FR-DeniseNeural',
  'es-ES': 'es-ES-ElviraNeural',
  'de-DE': 'de-DE-KatjaNeural',
  'it-IT': 'it-IT-ElsaNeural',
  'pt-PT': 'pt-PT-RaquelNeural',
  'pt-BR': 'pt-BR-FranciscaNeural',
  'ja-JP': 'ja-JP-NanamiNeural',
  'ko-KR': 'ko-KR-SunHiNeural',
  'ru-RU': 'ru-RU-SvetlanaNeural',
};

const CACHE_DIR = path.join(__dirname, '../tts-cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// One TTS instance per voice (reuse WebSocket connection)
const clients = {};

async function getClient(voice) {
  if (!clients[voice]) {
    const tts = new _MsEdgeTTS();
    await tts.setMetadata(voice, _OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    clients[voice] = tts;
  }
  return clients[voice];
}

function cacheKey(text, lang) {
  return crypto.createHash('sha1').update(`${lang}:${text}`).digest('hex');
}

function cachePath(key) {
  return path.join(CACHE_DIR, `${key}.mp3`);
}

async function synthesize(text, lang) {
  if (!loadEdgeTTS()) throw new Error('msedge-tts not available');

  const voice = VOICES[lang] || VOICES['en-US'];
  const key = cacheKey(text, lang);
  const file = cachePath(key);

  if (fs.existsSync(file)) return fs.createReadStream(file);

  const tts = await getClient(voice);
  const { audioStream } = tts.toStream(text);

  // Save to cache while streaming
  const ws = fs.createWriteStream(file);
  const chunks = [];

  return new Promise((resolve, reject) => {
    audioStream.on('data', (chunk) => {
      chunks.push(chunk);
      ws.write(chunk);
    });
    audioStream.on('end', () => {
      ws.end();
      const { Readable } = require('stream');
      const r = new Readable();
      chunks.forEach((c) => r.push(c));
      r.push(null);
      resolve(r);
    });
    audioStream.on('error', (err) => {
      ws.destroy();
      try { fs.unlinkSync(file); } catch { /* noop */ }
      reject(err);
    });
  });
}

module.exports = { synthesize, VOICES };
