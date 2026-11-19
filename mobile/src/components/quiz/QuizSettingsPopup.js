import { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from '../../ui/Popup';
import { useT } from '../../i18n';
import { COLORS } from '../../theme';

const HSK_LEVELS = [1, 2, 3, 4, 5, 6, 7]; // 7 = Street / unclassified
const label = (n) => (n === 7 ? 'S' : String(n));

// Nombre de mots : progression linéaire 10→50 (pas de 5), puis le BOUT de la
// piste passe à 100. Slider maison (PanResponder) → OTA-safe, pas de module natif.
const WORD_STOPS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 100];

// Slider compact : juste le chiffre à gauche qui change + la piste (pas de
// légende ni de bulle flottante). Inspiré du EraSlider (measureInWindow + refs
// pour éviter les closures périmées).
function WordCountSlider({ value, onChange }) {
  const N = WORD_STOPS.length;
  const idxOf = (v) => { const i = WORD_STOPS.indexOf(v); return i >= 0 ? i : 2; };
  const [pos, setPos] = useState(idxOf(value)); // position continue 0..N-1
  const draggingRef = useRef(false);
  // Resync depuis l'extérieur (reset à l'ouverture) — MAIS jamais pendant un drag,
  // sinon onChange→count→cet effet remet `pos` sur le stop arrondi → tremblement.
  useEffect(() => { if (!draggingRef.current) setPos(idxOf(value)); }, [value]);

  const trackRef = useRef(null);
  const geo = useRef({ x: 0, w: 0 });
  const posRef = useRef(pos); posRef.current = pos;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;

  const measure = () => { trackRef.current?.measureInWindow?.((x, y, w) => { if (w) geo.current = { x, w }; }); };
  const setFromAbs = (absX) => {
    const { x, w } = geo.current;
    if (w <= 0) return;
    const p = Math.max(0, Math.min(N - 1, ((absX - x) / w) * (N - 1)));
    setPos(p);
    onChangeRef.current(WORD_STOPS[Math.round(p)]);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e, g) => { draggingRef.current = true; measure(); setFromAbs(g.x0); },
      onPanResponderMove: (e, g) => setFromAbs(g.moveX),
      onPanResponderRelease: () => { draggingRef.current = false; const r = Math.round(posRef.current); setPos(r); onChangeRef.current(WORD_STOPS[r]); },
      onPanResponderTerminate: () => { draggingRef.current = false; const r = Math.round(posRef.current); setPos(r); onChangeRef.current(WORD_STOPS[r]); },
    })
  ).current;

  const pct = (pos / (N - 1)) * 100;
  const curVal = WORD_STOPS[Math.round(pos)];

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 }}>
      <Text style={{ width: 46, fontSize: 22, fontWeight: '800', color: COLORS.jiayou }}>{curVal}</Text>
      <View ref={trackRef} {...pan.panHandlers} onLayout={measure} style={{ flex: 1, height: 34, justifyContent: 'center', marginRight: 11 }}>
        <View style={{ height: 5, borderRadius: 999, backgroundColor: '#e6e9ef' }} />
        <View style={{ position: 'absolute', left: 0, height: 5, borderRadius: 999, backgroundColor: COLORS.jiayou, width: `${pct}%` }} />
        <View style={{ position: 'absolute', left: `${pct}%`, marginLeft: -11, width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', borderWidth: 2, borderColor: COLORS.jiayou, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 3, elevation: 3 }} />
      </View>
    </View>
  );
}
// Filtre de maîtrise par INTENTION (plutôt qu'une plage min/max cryptique) : on
// choisit directement « ce que je veux travailler ». `levels` = clés de maîtrise
// envoyées au backend (vide = tous). Les clés (seed/meh/ok/cool/trophy) sont
// celles attendues côté serveur.
const KNOW_PRESETS = [
  { key: 'all', lk: 'qz_kp_all', emojis: '', levels: [] },
  { key: 'work', lk: 'qz_kp_work', emojis: '🌱😐🙂', levels: ['seed', 'meh', 'ok'] },
  { key: 'almost', lk: 'qz_kp_almost', emojis: '😎', levels: ['cool'] },
  { key: 'review', lk: 'qz_kp_review', emojis: '🏆', levels: ['trophy'] },
];

// `tight` : marge réduite quand un sous-titre bleu suit immédiatement (titre collé
// à sa valeur). Sinon marge normale au-dessus des tuiles/boutons.
function SectionLabel({ children, tight }) {
  return (
    <Text style={{ fontSize: 12, fontWeight: '700', color: '#555', letterSpacing: 0.5, marginBottom: tight ? 2 : 10 }}>
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
  const [knowPreset, setKnowPreset] = useState('all'); // intention de maîtrise

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
    if (visible) { setType(defaultType); setHskMin(1); setHskMax(7); setCount(20); setKnowPreset('all'); }
  }, [visible, defaultType]);

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
    // Difficultés : liste de mots figée → seul le type de quiz est choisi.
    if (scope === 'ids') { onStart({ type }); return; }
    if (scope === 'pack') { onStart({ type, count }); return; }
    const hsk = isAll ? 'all' : `${hskMin}-${hskMax}`;
    // Preset d'intention → clés de maîtrise (vide = tous les niveaux).
    const levels = (KNOW_PRESETS.find((p) => p.key === knowPreset) || KNOW_PRESETS[0]).levels;
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
      ) : scope === 'ids' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 }}>
          <Ionicons name="barbell" size={14} color={COLORS.jiayou} />
          <Text style={{ fontSize: 13.5, color: COLORS.muted }} numberOfLines={1}>{t('qz_training_on')} <Text style={{ fontWeight: '700', color: '#1a1a2e' }}>{t('qz_your_difficulties')}</Text></Text>
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

      {/* HSK range + difficulté — collection uniquement */}
      {scope === 'collection' ? (
        <>
          {/* Plage HSK : notion propre au chinois → masquée pour les autres langues. */}
          {learningZh ? (
            <>
              <SectionLabel tight>{t('qz_hsk_range')}</SectionLabel>
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
            </>
          ) : null}

          {/* Maîtrise par INTENTION : « ce que je veux travailler » plutôt qu'une
              plage min/max d'emojis (jugée obscure par les utilisateurs). */}
          <SectionLabel>{t('qz_difficulty')}</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 10, justifyContent: 'space-between', marginBottom: 20 }}>
            {KNOW_PRESETS.map((p) => {
              const active = knowPreset === p.key;
              return (
                <Pressable key={p.key} onPress={() => setKnowPreset(p.key)}
                  style={{ width: '48%', minHeight: 58, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 6, borderColor: active ? COLORS.jiayou : '#e0e0e0', backgroundColor: active ? '#e8f0ff' : '#fff' }}>
                  {p.emojis ? <Text style={{ fontSize: 18, marginBottom: 3 }}>{p.emojis}</Text> : null}
                  <Text numberOfLines={1} style={{ fontWeight: '700', fontSize: 13, color: active ? COLORS.jiayou : '#1a1a2e' }}>{t(p.lk)}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {/* Number of words — masqué pour les difficultés (liste de mots figée). */}
      {scope !== 'ids' ? (
      <><SectionLabel>{t('qz_num_words')}</SectionLabel>
      <WordCountSlider value={count} onChange={setCount} /></>
      ) : null}

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
