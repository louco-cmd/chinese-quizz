import { useState, useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from '../Popup';
import { COLORS } from '../../theme';

const HSK_LEVELS = [1, 2, 3, 4, 5, 6, 7]; // 7 = Street / unclassified
const label = (n) => (n === 7 ? 'S' : String(n));

const WORD_COUNTS = [
  { value: 10, sub: 'fast' },
  { value: 20, sub: 'standard' },
  { value: 30, sub: 'serious' },
  { value: 100, sub: 'crazy' },
];
const DIFFICULTIES = [
  { value: 'revision', title: 'Revision', sub: 'Known (blue)' },
  { value: 'balanced', title: 'Balanced', sub: 'Learning (yellow)' },
  { value: 'discovery', title: 'Discovery', sub: 'Unknown (grey)' },
];

function SectionLabel({ children }) {
  return (
    <Text style={{ fontSize: 12, fontWeight: '700', color: '#555', letterSpacing: 0.5, marginBottom: 10 }}>
      {children}
    </Text>
  );
}

// Popup de réglages du quiz.
//  scope  : 'collection' (HSK + difficulté) | 'pack' (mots d'un pack)
//  showMode : afficher le toggle Pinyin/Characters (faux en zh→en)
//  onStart({ type, count[, hsk, difficulty] })
export default function QuizSettingsPopup({ visible, scope = 'collection', packLabel, showMode = true, onClose, onStart }) {
  const [type, setType] = useState('pinyin');
  const [hskMin, setHskMin] = useState(1);
  const [hskMax, setHskMax] = useState(7);
  const [count, setCount] = useState(20);
  const [difficulty, setDifficulty] = useState('balanced');

  useEffect(() => {
    if (visible) { setType('pinyin'); setHskMin(1); setHskMax(7); setCount(20); setDifficulty('balanced'); }
  }, [visible]);

  function tapLevel(v) {
    if (v < hskMin) setHskMin(v);
    else if (v > hskMax) setHskMax(v);
    else { setHskMin(v); setHskMax(v); }
  }

  const isAll = hskMin === 1 && hskMax === 7;
  const status = isAll
    ? 'All levels (HSK 1–6 + Street)'
    : hskMax === 7
      ? `HSK ${hskMin}–6 + Street`
      : hskMin === hskMax ? `HSK ${label(hskMin)}` : `HSK ${label(hskMin)}–${label(hskMax)}`;

  function start() {
    if (scope === 'pack') { onStart({ type, count }); return; }
    const hsk = isAll ? 'all' : `${hskMin}-${hskMax}`;
    onStart({ type, count, hsk, difficulty });
  }

  return (
    <Popup visible={visible} onClose={onClose} maxWidth={440}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#1a1a2e' }}>Quiz settings</Text>
        <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={COLORS.muted} /></Pressable>
      </View>
      {scope === 'pack' && packLabel ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 }}>
          <Ionicons name="albums" size={14} color={COLORS.jiayou} />
          <Text style={{ fontSize: 13.5, color: COLORS.muted }} numberOfLines={1}>Training on <Text style={{ fontWeight: '700', color: '#1a1a2e' }}>{packLabel}</Text></Text>
        </View>
      ) : <View style={{ height: 14 }} />}

      {/* Mode (pinyin / caractères) */}
      {showMode ? (
        <>
          <SectionLabel>MODE</SectionLabel>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
            {[
              { value: 'pinyin', title: 'Pinyin', icon: 'text' },
              { value: 'character', title: 'Characters', icon: 'language' },
            ].map((m) => {
              const active = type === m.value;
              return (
                <Pressable key={m.value} onPress={() => setType(m.value)}
                  style={{ flex: 1, borderRadius: 999, borderWidth: 2, paddingVertical: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, borderColor: active ? COLORS.jiayou : '#e0e0e0', backgroundColor: active ? '#e8f0ff' : '#fff' }}>
                  <Ionicons name={m.icon} size={16} color={active ? COLORS.jiayou : '#888'} />
                  <Text style={{ fontWeight: '700', fontSize: 15, color: active ? COLORS.jiayou : '#1a1a2e' }}>{m.title}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {/* HSK range — collection uniquement */}
      {scope === 'collection' ? (
        <>
          <SectionLabel>HSK LEVEL RANGE</SectionLabel>
          <Text style={{ fontSize: 14, fontWeight: '500', color: COLORS.jiayou, marginBottom: 12 }}>{status}</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 4 }}>
            {HSK_LEVELS.map((n) => {
              const active = n >= hskMin && n <= hskMax;
              const edge = n === hskMin || n === hskMax;
              return (
                <Pressable key={n} onPress={() => tapLevel(n)}
                  style={{ flex: 1, aspectRatio: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? (edge ? COLORS.jiayou : '#cfe2ff') : '#f1f3f5' }}>
                  <Text style={{ fontWeight: '700', color: active ? (edge ? '#fff' : COLORS.jiayou) : '#888' }}>{label(n)}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ fontSize: 11, color: '#888', textAlign: 'right', marginBottom: 20 }}>S = Unclassified (Street)</Text>
        </>
      ) : null}

      {/* Number of words */}
      <SectionLabel>NUMBER OF WORDS</SectionLabel>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
        {WORD_COUNTS.map((w) => {
          const active = w.value === count;
          return (
            <Pressable key={w.value} onPress={() => setCount(w.value)}
              style={{ flex: 1, borderRadius: 999, borderWidth: 2, paddingVertical: 10, alignItems: 'center', borderColor: active ? COLORS.jiayou : '#e0e0e0', backgroundColor: active ? '#e8f0ff' : '#fff' }}>
              <Text style={{ fontWeight: '700', fontSize: 20, color: active ? COLORS.jiayou : '#1a1a2e' }}>{w.value}</Text>
              <Text style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{w.sub}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Difficulty — collection uniquement */}
      {scope === 'collection' ? (
        <>
          <SectionLabel>DIFFICULTY</SectionLabel>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 22 }}>
            {DIFFICULTIES.map((d) => {
              const active = d.value === difficulty;
              return (
                <Pressable key={d.value} onPress={() => setDifficulty(d.value)}
                  style={{ flex: 1, borderRadius: 999, borderWidth: 2, paddingVertical: 10, paddingHorizontal: 4, alignItems: 'center', borderColor: active ? COLORS.jiayou : '#e0e0e0', backgroundColor: active ? '#e8f0ff' : '#fff' }}>
                  <Text style={{ fontWeight: '700', fontSize: 14, color: active ? COLORS.jiayou : '#1a1a2e' }}>{d.title}</Text>
                  <Text style={{ fontSize: 10, color: '#888', marginTop: 2, textAlign: 'center' }}>{d.sub}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : <View style={{ height: 2 }} />}

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 14, alignItems: 'center' }}>
          <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Cancel</Text>
        </Pressable>
        <Pressable onPress={start} style={{ flex: 1, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
          <Ionicons name="rocket" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700' }}>Start quiz</Text>
        </Pressable>
      </View>
    </Popup>
  );
}
