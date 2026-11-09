// ════════════════════════════════════════════════════════════════════════════
//  CONTENU PUBLIC — tracés hanzi (relais CDN + cache) et TTS audio.
//  Extrait de routes/mobile.js. Monté via registerContentRoutes(router).
//  Routes publiques (pas d'auth). Cache mémoire persistant (register appelé 1×).
// ════════════════════════════════════════════════════════════════════════════

module.exports = function registerContentRoutes(router) {

// -------------------- Données de tracés (hanzi-writer) --------------------
// L'app ne peut pas taper jsDelivr : le CDN est bloqué / très instable en Chine,
// où se trouve l'essentiel des utilisateurs. Le serveur (hors Chine) va donc
// chercher le JSON de tracés et le relaie. Cache mémoire : ces données sont
// immuables et un même caractère revient sans cesse.
const hanziCache = new Map();
const HANZI_CACHE_MAX = 3000;

router.get('/api/m/hanzi/:char', async (req, res) => {
  const ch = Array.from(req.params.char || '')[0] || '';
  if (!/[㐀-鿿]/.test(ch)) return res.status(400).json({ error: 'not a Han character' });

  if (hanziCache.has(ch)) {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res.json(hanziCache.get(ch));
  }
  try {
    const r = await fetch(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/${encodeURIComponent(ch)}.json`);
    if (!r.ok) return res.status(404).json({ error: 'character not found' });
    const data = await r.json();
    if (hanziCache.size >= HANZI_CACHE_MAX) hanziCache.clear(); // purge simple
    hanziCache.set(ch, data);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.json(data);
  } catch (e) {
    console.error('hanzi data:', e.message);
    res.status(502).json({ error: 'could not fetch character data' });
  }
});

// ── TTS proxy ──────────────────────────────────────────────────────────────────
// GET /api/m/tts?text=你好&lang=zh-CN
// Public (no token) — returns cached MP3 audio via Edge neural voices.
// Cache is on-disk per (lang, text) SHA-1; ~5-15 KB per word, persistent.
let _ttsLib;
function getTTS() { if (!_ttsLib) _ttsLib = require('../../lib/tts'); return _ttsLib; }
router.get('/api/m/tts', async (req, res) => {
  const text = (req.query.text || '').trim().slice(0, 300);
  const lang = (req.query.lang || 'zh-CN').replace(/[^a-zA-Z-]/g, '');
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const stream = await getTTS().synthesize(text, lang);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    stream.pipe(res);
  } catch (e) {
    console.error('TTS error:', e.message);
    res.status(502).json({ error: 'tts unavailable' });
  }
});


};
