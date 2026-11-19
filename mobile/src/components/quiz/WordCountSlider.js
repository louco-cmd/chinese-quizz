import { useState, useEffect, useRef } from 'react';
import { View, Text, PanResponder } from 'react-native';
import { COLORS } from '../../theme';

// Stops par défaut : progression linéaire 10→50 (pas de 5) puis le BOUT = 100.
export const DEFAULT_WORD_STOPS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 100];

// Slider compact du nombre de mots : juste le chiffre à gauche qui change + la
// piste (pas de légende ni de bulle flottante). Slider maison (PanResponder) →
// OTA-safe, aucun module natif. Inspiré du EraSlider (measureInWindow + refs).
export default function WordCountSlider({ value, onChange, stops = DEFAULT_WORD_STOPS }) {
  const N = stops.length;
  const idxOf = (v) => { const i = stops.indexOf(v); return i >= 0 ? i : Math.min(2, N - 1); };
  const [pos, setPos] = useState(idxOf(value)); // position continue 0..N-1
  const draggingRef = useRef(false);
  // Resync depuis l'extérieur (reset à l'ouverture) — MAIS jamais pendant un drag,
  // sinon onChange→value→cet effet remet `pos` sur le stop arrondi → tremblement.
  useEffect(() => { if (!draggingRef.current) setPos(idxOf(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

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
    onChangeRef.current(stops[Math.round(p)]);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e, g) => { draggingRef.current = true; measure(); setFromAbs(g.x0); },
      onPanResponderMove: (e, g) => setFromAbs(g.moveX),
      onPanResponderRelease: () => { draggingRef.current = false; const r = Math.round(posRef.current); setPos(r); onChangeRef.current(stops[r]); },
      onPanResponderTerminate: () => { draggingRef.current = false; const r = Math.round(posRef.current); setPos(r); onChangeRef.current(stops[r]); },
    })
  ).current;

  const pct = N > 1 ? (pos / (N - 1)) * 100 : 0;
  const curVal = stops[Math.round(pos)];

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <Text style={{ width: 46, fontSize: 22, fontWeight: '800', color: COLORS.jiayou }}>{curVal}</Text>
      <View ref={trackRef} {...pan.panHandlers} onLayout={measure} style={{ flex: 1, height: 34, justifyContent: 'center', marginRight: 11 }}>
        <View style={{ height: 5, borderRadius: 999, backgroundColor: '#e6e9ef' }} />
        <View style={{ position: 'absolute', left: 0, height: 5, borderRadius: 999, backgroundColor: COLORS.jiayou, width: `${pct}%` }} />
        <View style={{ position: 'absolute', left: `${pct}%`, marginLeft: -11, width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', borderWidth: 2, borderColor: COLORS.jiayou, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 3, elevation: 3 }} />
      </View>
    </View>
  );
}
