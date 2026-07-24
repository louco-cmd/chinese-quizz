import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HanziQuiz from '../components/HanziQuiz';
import { Loading, ErrorRetry } from '../components/ErrorRetry';
import { getCollection } from '../api';
import { COLORS } from '../theme';

const isHan = (ch) => /[㐀-鿿]/.test(ch);
const HSK_LEVELS = [1, 2, 3, 4, 5, 6, 7];        // 7 = Street / non classé
const label = (n) => (n === 7 ? 'S' : String(n));
const hskOf = (w) => { const n = parseInt(w.hsk, 10); return Number.isInteger(n) && n >= 1 && n <= 6 ? n : 7; };

function shuffle(a) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

// Un mot est traçable ici s'il tient en UN SEUL caractère Han. Les mots composés
// sont écartés : on ne faisait écrire qu'un de leurs caractères tout en affichant
// le sens du mot entier, ce qui était trompeur.
const singleChar = (w) => {
  const chars = Array.from(w.chinese || '').filter(isHan);
  return chars.length === 1 && Array.from(w.chinese || '').length === 1 ? chars[0] : null;
};

function buildDeck(words, hskMin, hskMax) {
  const seen = new Set();
  const deck = [];
  for (const w of words) {
    const ch = singleChar(w);
    if (!ch || seen.has(ch)) continue;
    const lvl = hskOf(w);
    if (lvl < hskMin || lvl > hskMax) continue;
    seen.add(ch);
    deck.push({ char: ch, english: w.english, pinyin: w.pinyin });
  }
  return shuffle(deck).slice(0, 60); // session de 60 caractères max
}

export default function WritingPracticeScreen({ onBack }) {
  const { width } = useWindowDimensions();
  const size = Math.min(width - 48, 300);

  const [words, setWords] = useState(null);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);
  const [hskMin, setHskMin] = useState(1);
  const [hskMax, setHskMax] = useState(7);

  const [deck, setDeck] = useState([]);
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState(0);
  const [result, setResult] = useState(null);
  const [hintNonce, setHintNonce] = useState(0);

  const load = useCallback(async () => {
    setError('');
    try {
      const d = await getCollection();
      setWords(d.words || []);
    } catch (e) { setError(e.message || 'Could not load your words.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Caractères disponibles par niveau — sert à afficher le compte et à griser
  // les niveaux vides plutôt que de laisser lancer une session sans contenu.
  const countByLevel = useMemo(() => {
    const m = {};
    const seen = new Set();
    for (const w of words || []) {
      const ch = singleChar(w);
      if (!ch || seen.has(ch)) continue;
      seen.add(ch);
      const l = hskOf(w);
      m[l] = (m[l] || 0) + 1;
    }
    return m;
  }, [words]);

  const available = useMemo(() => {
    let n = 0;
    for (let l = hskMin; l <= hskMax; l++) n += countByLevel[l] || 0;
    return n;
  }, [countByLevel, hskMin, hskMax]);

  function tapLevel(v) {
    if (v < hskMin) setHskMin(v);
    else if (v > hskMax) setHskMax(v);
    else if (v === hskMin && v === hskMax) { setHskMin(1); setHskMax(7); }
    else { setHskMin(v); setHskMax(v); }
  }

  function start() {
    setDeck(buildDeck(words, hskMin, hskMax));
    setIdx(0); setDone(0); setResult(null); setStarted(true);
  }

  const current = deck[idx];

  function onComplete(mistakes) {
    setResult({ mistakes });
    setDone((d) => d + 1);
    setTimeout(() => { setResult(null); next(); }, 1100);
  }
  function next() { setIdx((i) => i + 1); }

  if (words === null && !error) return <Loading />;
  if (error) return <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}><Header onBack={onBack} /><ErrorRetry error={error} onRetry={load} /></View>;

  // ---------- Écran de réglages : on choisit ce qu'on travaille ----------
  if (!started) {
    const isAll = hskMin === 1 && hskMax === 7;
    const status = isAll ? 'All levels (HSK 1–6 + Street)'
      : hskMin === 7 ? 'Street'
      : hskMax === 7 ? (hskMin === 6 ? 'HSK 6 + Street' : `HSK ${hskMin}–6 + Street`)
      : hskMin === hskMax ? `HSK ${label(hskMin)}` : `HSK ${label(hskMin)}–${label(hskMax)}`;

    return (
      <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
        <Header onBack={onBack} />
        <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}>
          <View style={{ width: '100%', maxWidth: 460, alignSelf: 'center' }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.muted, letterSpacing: 0.6, marginBottom: 8 }}>
              HSK LEVEL RANGE
            </Text>
            <Text style={{ fontSize: 14, fontWeight: '500', color: COLORS.jiayou, marginBottom: 12 }}>{status}</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {HSK_LEVELS.map((n) => {
                const active = n >= hskMin && n <= hskMax;
                const edge = n === hskMin || n === hskMax;
                const empty = !countByLevel[n];
                return (
                  <Pressable key={n} onPress={() => tapLevel(n)} disabled={empty}
                    style={{ flex: 1, aspectRatio: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', opacity: empty ? 0.4 : 1, backgroundColor: active ? (edge ? COLORS.jiayou : '#cfe2ff') : '#f1f3f5' }}>
                    <Text style={{ fontWeight: '700', color: active ? (edge ? '#fff' : COLORS.jiayou) : '#888' }}>{label(n)}</Text>
                    <Text style={{ fontSize: 10, marginTop: 1, color: active ? (edge ? 'rgba(255,255,255,0.85)' : COLORS.jiayou) : '#aaa' }}>
                      {countByLevel[n] || 0}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#eef4ff', borderRadius: 12, padding: 12, marginTop: 20 }}>
              <Ionicons name="information-circle-outline" size={17} color={COLORS.jiayou} />
              <Text style={{ flex: 1, fontSize: 12.5, color: COLORS.jiayou, lineHeight: 18 }}>
                Only single-character words are practised for now, so the meaning you see always matches the character you draw.
              </Text>
            </View>

            <Text style={{ textAlign: 'center', color: COLORS.muted, marginTop: 22, fontSize: 13.5 }}>
              {available} character{available === 1 ? '' : 's'} ready
            </Text>

            <Pressable
              onPress={start}
              disabled={!available}
              style={{ marginTop: 12, borderRadius: 999, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, backgroundColor: available ? COLORS.jiayou : '#dfe3e8' }}
            >
              <Ionicons name="brush" size={17} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Start writing</Text>
            </Pressable>

            {!available ? (
              <Text style={{ textAlign: 'center', color: COLORS.muted, marginTop: 12, fontSize: 12.5 }}>
                No single-character word in this range. Add some to your collection first.
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  // ---------- Fin de session ----------
  if (idx >= deck.length) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
        <Header onBack={onBack} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Ionicons name="trophy" size={48} color="#f7c948" />
          <Text style={{ fontSize: 22, fontWeight: '800', color: '#1a1a2e', marginTop: 12 }}>{done} characters written!</Text>
          <Text style={{ color: COLORS.muted, marginTop: 6, textAlign: 'center' }}>Nice work practising your strokes.</Text>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 22 }}>
            <Pressable onPress={() => setStarted(false)} style={{ borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 999, paddingVertical: 13, paddingHorizontal: 22 }}>
              <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Change levels</Text>
            </Pressable>
            <Pressable onPress={start} style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 13, paddingHorizontal: 26 }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Again</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // ---------- Session ----------
  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <Header onBack={() => setStarted(false)} progress={`${idx + 1}/${deck.length}`} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
        <Text style={{ fontSize: 15, color: COLORS.muted }}>Write the character for</Text>
        <Text style={{ fontSize: 22, fontWeight: '800', color: '#1a1a2e', marginTop: 4, textAlign: 'center' }} numberOfLines={2}>
          {current.english || '—'}
        </Text>
        {current.pinyin ? <Text style={{ fontSize: 15, color: COLORS.jiayou, marginTop: 2 }}>{current.pinyin}</Text> : null}

        <View style={{ marginTop: 18, borderRadius: 20, overflow: 'hidden' }}>
          {/* Pas de `key` par caractère : remonter la WebView rechargeait la page
              et la lib à chaque mot. On garde la même instance et on lui envoie
              simplement le caractère suivant. */}
          <HanziQuiz
            char={current.char}
            nextChar={deck[idx + 1]?.char}
            size={size}
            hintNonce={hintNonce}
            onComplete={onComplete}
          />
        </View>

        {result ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 }}>
            <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
            <Text style={{ color: COLORS.success, fontWeight: '700' }}>
              {result.mistakes === 0 ? 'Perfect!' : `Done — ${result.mistakes} mistake${result.mistakes === 1 ? '' : 's'}`}
            </Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
            <Pressable onPress={() => setHintNonce((n) => n + 1)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 999, paddingVertical: 11, paddingHorizontal: 18 }}>
              <Ionicons name="eye-outline" size={17} color={COLORS.jiayou} />
              <Text style={{ color: COLORS.jiayou, fontWeight: '700' }}>Show me</Text>
            </Pressable>
            <Pressable onPress={next} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingVertical: 11, paddingHorizontal: 18, backgroundColor: '#eef0f4' }}>
              <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Skip</Text>
              <Ionicons name="arrow-forward" size={16} color={COLORS.muted} />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

function Header({ onBack, progress }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
      <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Ionicons name="chevron-back" size={20} color={COLORS.jiayou} />
        <Text style={{ color: COLORS.jiayou, fontWeight: '600' }}>Back</Text>
      </Pressable>
      <Text style={{ fontSize: 16, fontWeight: '800', color: '#1a1a2e' }}>Writing practice</Text>
      <Text style={{ color: COLORS.muted, fontWeight: '600', minWidth: 44, textAlign: 'right' }}>{progress || ''}</Text>
    </View>
  );
}
