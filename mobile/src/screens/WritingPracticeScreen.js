import { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HanziQuiz from '../components/HanziQuiz';
import { Loading, ErrorRetry } from '../components/ErrorRetry';
import { getCollection } from '../api';
import { COLORS } from '../theme';

const isHan = (ch) => /[㐀-鿿]/.test(ch);
function shuffle(a) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

// Construit un deck de caractères UNIQUES à partir des mots de la collection,
// en gardant un mot d'exemple (sens + pinyin) pour le contexte.
function buildDeck(words) {
  const seen = new Set();
  const deck = [];
  for (const w of words) {
    for (const ch of Array.from(w.chinese || '')) {
      if (isHan(ch) && !seen.has(ch)) { seen.add(ch); deck.push({ char: ch, english: w.english, pinyin: w.pinyin }); }
    }
  }
  return shuffle(deck).slice(0, 60); // MVP : session de 60 caractères max
}

export default function WritingPracticeScreen({ onBack }) {
  const { width } = useWindowDimensions();
  const size = Math.min(width - 48, 300);

  const [words, setWords] = useState(null);
  const [error, setError] = useState('');
  const [deck, setDeck] = useState([]);
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState(0);       // caractères réussis
  const [result, setResult] = useState(null); // { mistakes } après complétion
  const [hintNonce, setHintNonce] = useState(0);

  const load = useCallback(async () => {
    setError('');
    try {
      const d = await getCollection();
      const w = d.words || [];
      setWords(w);
      setDeck(buildDeck(w));
    } catch (e) { setError(e.message || 'Could not load your words.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const current = deck[idx];

  function onComplete(mistakes) {
    setResult({ mistakes });
    setDone((d) => d + 1);
    setTimeout(() => { setResult(null); next(); }, 1100);
  }
  function next() { setIdx((i) => i + 1); }
  function restart() { setDeck(buildDeck(words)); setIdx(0); setDone(0); setResult(null); }

  if (words === null && !error) return <Loading />;
  if (error) return <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}><Header onBack={onBack} /><ErrorRetry error={error} onRetry={load} /></View>;

  // Aucun caractère à pratiquer.
  if (!deck.length) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
        <Header onBack={onBack} />
        <Empty text="Add some Chinese words to your collection first." />
      </View>
    );
  }

  // Fin de session.
  if (idx >= deck.length) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
        <Header onBack={onBack} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Ionicons name="trophy" size={48} color="#f7c948" />
          <Text style={{ fontSize: 22, fontWeight: '800', color: '#1a1a2e', marginTop: 12 }}>{done} characters written!</Text>
          <Text style={{ color: COLORS.muted, marginTop: 6, textAlign: 'center' }}>Nice work practising your strokes.</Text>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 22 }}>
            <Pressable onPress={onBack} style={{ borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 22 }}>
              <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Done</Text>
            </Pressable>
            <Pressable onPress={restart} style={{ backgroundColor: COLORS.jiayou, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 26 }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Again</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <Header onBack={onBack} progress={`${idx + 1}/${deck.length}`} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
        {/* Consigne : sens + pinyin, on cache le caractère (c'est ce qu'on doit écrire). */}
        <Text style={{ fontSize: 15, color: COLORS.muted }}>Write the character for</Text>
        <Text style={{ fontSize: 22, fontWeight: '800', color: '#1a1a2e', marginTop: 4, textAlign: 'center' }} numberOfLines={2}>
          {current.english || '—'}
        </Text>
        {current.pinyin ? <Text style={{ fontSize: 15, color: COLORS.jiayou, marginTop: 2 }}>{current.pinyin}</Text> : null}

        <View style={{ marginTop: 18, borderRadius: 20, overflow: 'hidden' }}>
          <HanziQuiz
            key={`${current.char}-${idx}`}
            char={current.char}
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
            <Pressable onPress={() => setHintNonce((n) => n + 1)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 18 }}>
              <Ionicons name="eye-outline" size={17} color={COLORS.jiayou} />
              <Text style={{ color: COLORS.jiayou, fontWeight: '700' }}>Show me</Text>
            </Pressable>
            <Pressable onPress={next} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 18, backgroundColor: '#eef0f4' }}>
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

function Empty({ text }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <Ionicons name="brush-outline" size={40} color={COLORS.mutedLight} />
      <Text style={{ color: COLORS.muted, marginTop: 12, textAlign: 'center' }}>{text}</Text>
    </View>
  );
}
