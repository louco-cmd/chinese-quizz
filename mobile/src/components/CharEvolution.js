import { useRef } from 'react';
import { View, Text, Image, PanResponder } from 'react-native';
import { API_BASE } from '../api';
import { COLORS } from '../theme';
import HanziStroke from './HanziStroke';

// « Time machine » des caractères (données EVOBC). Deux pièces :
//  • EvolutionHero : le glyphe héro, cross-fade entre stades adjacents selon `value`.
//  • EraSlider     : la piste + points + poignée qui pilote `value`.
// value ∈ [0, N-1] où les stops = [...eras historiques triées, MODERN]. MODERN (droite)
// = le hanzi actuel (texte vectoriel). Les images raster ne se morphent pas vraiment →
// on fait un fondu croisé, ce qui donne la sensation « remonter le temps ».

// Eras dans l'ORDRE CHRONOLOGIQUE (codes alignés sur l'extraction EVOBC) :
// 0 OBC 甲骨 → 1 BI 金文 → 2 SAC 春秋 → 3 WSC 战国 → 4 SS 篆 → 5 CS 隶.
const ERA_LABEL = { 0: '甲骨文', 1: '金文', 2: '春秋', 3: '战国', 4: '篆书', 5: '隶书' };
const ERA_SUB = { 0: 'Oracle bone', 1: 'Bronze', 2: 'Spring & Autumn', 3: 'Warring States', 4: 'Seal', 5: 'Clerical' };

// Sentinelles de fin de frise : 98 = forme TRADITIONNELLE (glyphe), 99 = MODERNE
// (le caractère tel qu'affiché, simplifié). Le stop trad n'apparaît que si le
// caractère simplifié diffère de son traditionnel (hasTrad).
const TRAD = 98, MODERN = 99;

// Liste ordonnée des stops : eras historiques → [trad] → moderne.
export function evoStops(eras, hasTrad = false) {
  const sorted = [...(eras || [])].sort((a, b) => a - b);
  return [...sorted, ...(hasTrad ? [TRAD] : []), MODERN];
}

export function EvolutionHero({ char, trad, stops, value, size = 200 }) {
  // Fondu croisé resserré : seuls les deux stops adjacents (f, c) sont visibles, avec
  // une fraction ADOUCIE (smootherstep) → chaque forme tient nette plus longtemps et la
  // bascule se fait vite au milieu (fenêtre de superposition courte). Somme = 1 (jamais
  // de trou). Une petite bande morte aux extrémités coupe les traces sub-pixel.
  const N = stops.length;
  const clamped = Math.max(0, Math.min(N - 1, value));
  const f = Math.floor(clamped);
  const c = Math.min(N - 1, f + 1);
  let t = clamped - f;
  t = t * t * t * (t * (t * 6 - 15) + 10); // smootherstep
  const opacityOf = (i) => (i === f ? (c === f ? 1 : 1 - t) : i === c ? t : 0);

  return (
    <View style={{ width: size, height: size }}>
      {stops.map((era, i) => {
        const opacity = opacityOf(i);
        if (opacity <= 0.02) return null;
        if (era === 99 || era === 98) {
          // 99 = moderne (caractère affiché, simplifié) = animation make-me-a-hanzi
          // (ordre des traits). 98 = forme traditionnelle, même rendu mais sur le
          // glyphe traditionnel → la frise passe par 繁 juste avant le simplifié.
          const g = era === 98 ? (trad || char) : char;
          return (
            <View key={era === 98 ? 'trad' : 'modern'} style={{ position: 'absolute', width: size, height: size, alignItems: 'center', justifyContent: 'center', opacity }}>
              <HanziStroke char={g} size={size} />
            </View>
          );
        }
        return (
          <Image
            key={era}
            source={{ uri: `${API_BASE}/api/m/evolution/${encodeURIComponent(char)}/${era}` }}
            resizeMode="contain"
            style={{ position: 'absolute', width: size, height: size, opacity }}
          />
        );
      })}
    </View>
  );
}

export function EraSlider({ stops, value, onChange }) {
  const N = stops.length;
  // Handlers créés UNE fois → ils lisent des refs (toujours à jour) pour éviter les
  // closures périmées (N change selon le caractère). On calcule la valeur à partir de
  // coordonnées ABSOLUES (moveX) moins la position mesurée de la piste : `locationX`
  // est relatif à la sous-vue touchée sur natif → sautes « épileptiques » + stack à gauche.
  const trackRef = useRef(null);
  const geo = useRef({ x: 0, w: 0 });
  const nRef = useRef(N); nRef.current = N;
  const valRef = useRef(value); valRef.current = value;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;

  const measure = () => {
    trackRef.current?.measureInWindow?.((x, y, w) => { if (w) geo.current = { x, w }; });
  };
  const setFromAbs = (absX) => {
    const { x, w } = geo.current; const n = nRef.current;
    if (w <= 0 || n <= 1) return;
    const v = Math.max(0, Math.min(n - 1, ((absX - x) / w) * (n - 1)));
    onChangeRef.current(v);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e, g) => { measure(); setFromAbs(g.x0); },
      onPanResponderMove: (e, g) => setFromAbs(g.moveX),
      onPanResponderRelease: () => onChangeRef.current(Math.round(valRef.current)), // snap au stop
    })
  ).current;

  const cur = Math.round(value);
  const era = stops[cur];
  const pct = N > 1 ? (value / (N - 1)) * 100 : 100;

  return (
    <View style={{ width: '100%', paddingVertical: 6 }}>
      {/* Marge intérieure = rayon de la poignée → les points/poignée aux extrémités
          ne sont jamais rognés par le bord de la carte. */}
      <View
        ref={trackRef}
        {...pan.panHandlers}
        onLayout={measure}
        style={{ height: 34, justifyContent: 'center', marginHorizontal: 13 }}
      >
        {/* piste */}
        <View style={{ height: 6, borderRadius: 999, backgroundColor: '#e6e9ef' }} />
        {/* points des stops */}
        {stops.map((s, i) => {
          const left = N > 1 ? (i / (N - 1)) * 100 : 100;
          const active = i === cur;
          return (
            <View key={i} style={{ position: 'absolute', left: `${left}%`, marginLeft: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: active ? COLORS.jiayou : '#c4c9d2' }} />
          );
        })}
        {/* poignée */}
        <View style={{ position: 'absolute', left: `${pct}%`, marginLeft: -11, width: 22, height: 22, borderRadius: 11, backgroundColor: COLORS.jiayou, borderWidth: 3, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 3, elevation: 3 }} />
      </View>
      {/* libellé de l'era courante */}
      <Text style={{ textAlign: 'center', marginTop: 6, fontSize: 13, color: COLORS.muted }}>
        {era === 99
          ? <Text style={{ fontWeight: '700', color: '#1a1a2e' }}>今 楷书 · Modern</Text>
          : era === 98
          ? <Text style={{ fontWeight: '700', color: '#1a1a2e' }}>繁 · Traditional</Text>
          : <><Text style={{ fontWeight: '700', color: '#1a1a2e' }}>{ERA_LABEL[era]}</Text>{`  ·  ${ERA_SUB[era]}`}</>}
      </Text>
    </View>
  );
}
