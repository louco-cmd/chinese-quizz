import { useState, useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from '../Popup';
import { useT } from '../../i18n';
import { COLORS } from '../../theme';

const HSK_LEVELS = [1, 2, 3, 4, 5, 6, 7]; // 7 = Street / unclassified
const label = (n) => (n === 7 ? 'S' : String(n));

const WORD_COUNTS = [
  { value: 10, sub: 'wc_fast' },
  { value: 20, sub: 'wc_standard' },
  { value: 30, sub: 'wc_serious' },
  { value: 100, sub: 'wc_crazy' },
];
// Niveaux de maîtrise, ordonnés du plus faible au plus fort (comme une plage HSK).
const KNOWLEDGE = [
  { key: 'seed', emoji: '🌱', lk: 'kn_new' },
  { key: 'meh', emoji: '😐', lk: 'kn_weak' },
  { key: 'ok', emoji: '🙂', lk: 'kn_okay' },
  { key: 'cool', emoji: '😎', lk: 'kn_strong' },
  { key: 'trophy', emoji: '🏆', lk: 'quiz_mastered' },
];
const K_MAX = KNOWLEDGE.length - 1;

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
//  onStart({ type, count[, hsk, levels] })
export default function QuizSettingsPopup({ visible, scope = 'collection', packLabel, showMode = true, learningZh = true, onClose, onStart }) {
  const { t } = useT();
  const defaultType = learningZh ? 'pinyin' : 'word';
  const [type, setType] = useState(defaultType);
  const [hskMin, setHskMin] = useState(1);
  const [hskMax, setHskMax] = useState(7);
  const [count, setCount] = useState(20);
  const [kMin, setKMin] = useState(0);       // plage de niveaux de maîtrise (comme HSK)
  const [kMax, setKMax] = useState(K_MAX);

  // Modes selon la langue apprise : chinois = pinyin/caractères/lecture ; autres =
  // écrire le mot (montre la trad) / lecture (montre le mot → donne la trad).
  const MODES = learningZh
    ? [
        { value: 'pinyin', title: t('qz_pinyin'), icon: 'text' },
        { value: 'character', title: t('qz_characters'), icon: 'language' },
        { value: 'reading', title: t('qz_reading'), icon: 'book' },
      ]
    : [
        { value: 'word', title: t('qz_mode_write'), icon: 'create' },
        { value: 'reading', title: t('qz_reading'), icon: 'book' },
      ];

  useEffect(() => {
    if (visible) { setType(defaultType); setHskMin(1); setHskMax(7); setCount(20); setKMin(0); setKMax(K_MAX); }
  }, [visible, defaultType]);

  function tapKnow(i) {
    if (i < kMin) setKMin(i);
    else if (i > kMax) setKMax(i);
    else { setKMin(i); setKMax(i); }
  }
  const kAll = kMin === 0 && kMax === K_MAX;

  function tapLevel(v) {
    if (v < hskMin) setHskMin(v);
    else if (v > hskMax) setHskMax(v);
    else { setHskMin(v); setHskMax(v); }
  }

  const isAll = hskMin === 1 && hskMax === 7;
  const status = isAll
    ? t('qz_all_levels_full')
    : hskMin === 7
      ? t('qz_street')
      : hskMax === 7
        ? (hskMin === 6 ? `HSK 6 + ${t('qz_street')}` : `HSK ${hskMin}–6 + ${t('qz_street')}`)
        : hskMin === hskMax ? `HSK ${label(hskMin)}` : `HSK ${label(hskMin)}–${label(hskMax)}`;

  function start() {
    if (scope === 'pack') { onStart({ type, count }); return; }
    const hsk = isAll ? 'all' : `${hskMin}-${hskMax}`;
    // Plage complète = tous les niveaux (vide) ; sinon les clés de la plage.
    const levels = kAll ? [] : KNOWLEDGE.slice(kMin, kMax + 1).map((b) => b.key);
    onStart({ type, count, hsk, levels });
  }

  return (
    <Popup visible={visible} onClose={onClose} maxWidth={440}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#1a1a2e' }}>{t('qz_settings')}</Text>
        <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={COLORS.muted} /></Pressable>
      </View>
      {scope === 'pack' && packLabel ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 }}>
          <Ionicons name="albums" size={14} color={COLORS.jiayou} />
          <Text style={{ fontSize: 13.5, color: COLORS.muted }} numberOfLines={1}>{t('qz_training_on')} <Text style={{ fontWeight: '700', color: '#1a1a2e' }}>{packLabel}</Text></Text>
        </View>
      ) : <View style={{ height: 14 }} />}

      {/* Mode (pinyin / caractères) */}
      {showMode ? (
        <>
          <SectionLabel>{t('qz_mode')}</SectionLabel>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
            {MODES.map((m) => {
              const active = type === m.value;
              return (
                <Pressable key={m.value} onPress={() => setType(m.value)}
                  style={{ flex: 1, borderRadius: 999, borderWidth: 2, paddingVertical: 12, paddingHorizontal: 4, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5, borderColor: active ? COLORS.jiayou : '#e0e0e0', backgroundColor: active ? '#e8f0ff' : '#fff' }}>
                  <Ionicons name={m.icon} size={15} color={active ? COLORS.jiayou : '#888'} />
                  <Text numberOfLines={1} style={{ fontWeight: '700', fontSize: 13.5, color: active ? COLORS.jiayou : '#1a1a2e' }}>{m.title}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {/* HSK range — collection uniquement */}
      {scope === 'collection' ? (
        <>
          <SectionLabel>{t('qz_hsk_range')}</SectionLabel>
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
          <View style={{ height: 20 }} />

          {/* Difficulté — même UI (plage de tuiles) que le HSK, juste dessous. */}
          <SectionLabel>{t('qz_difficulty')}</SectionLabel>
          <Text style={{ fontSize: 14, fontWeight: '500', color: COLORS.jiayou, marginBottom: 12 }}>
            {kAll ? t('qz_all_levels') : kMin === kMax ? t(KNOWLEDGE[kMin].lk) : `${t(KNOWLEDGE[kMin].lk)} → ${t(KNOWLEDGE[kMax].lk)}`}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 20 }}>
            {KNOWLEDGE.map((b, i) => {
              const active = i >= kMin && i <= kMax;
              const edge = i === kMin || i === kMax;
              return (
                <Pressable key={b.key} onPress={() => tapKnow(i)}
                  style={{ flex: 1, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? (edge ? COLORS.jiayou : '#cfe2ff') : '#f1f3f5' }}>
                  <Text style={{ fontSize: 20, opacity: active ? 1 : 0.45 }}>{b.emoji}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {/* Number of words */}
      <SectionLabel>{t('qz_num_words')}</SectionLabel>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
        {WORD_COUNTS.map((w) => {
          const active = w.value === count;
          return (
            <Pressable key={w.value} onPress={() => setCount(w.value)}
              style={{ flex: 1, borderRadius: 999, borderWidth: 2, paddingVertical: 10, alignItems: 'center', borderColor: active ? COLORS.jiayou : '#e0e0e0', backgroundColor: active ? '#e8f0ff' : '#fff' }}>
              <Text style={{ fontWeight: '700', fontSize: 20, color: active ? COLORS.jiayou : '#1a1a2e' }}>{w.value}</Text>
              <Text style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{t(w.sub)}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 14, alignItems: 'center' }}>
          <Text style={{ color: COLORS.muted, fontWeight: '700' }}>{t('common_cancel')}</Text>
        </Pressable>
        <Pressable onPress={start} style={{ flex: 1, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
          <Ionicons name="rocket" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700' }}>{t('qz_start_quiz_btn')}</Text>
        </Pressable>
      </View>
    </Popup>
  );
}
