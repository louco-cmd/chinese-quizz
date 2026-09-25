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

const ERA_LABEL = { 0: '甲骨文', 1: '金文', 2: '篆书', 3: '春秋', 4: '战国', 5: '隶书' };
const ERA_SUB = { 0: 'Oracle bone', 1: 'Bronze', 2: 'Seal', 3: 'Spring & Autumn', 4: 'Warring States', 5: 'Clerical' };

// Liste ordonnée des stops : eras historiques + le moderne (sentinelle 99).
export function evoStops(eras) {
  const sorted = [...(eras || [])].sort((a, b) => a - b);
  return [...sorted, 99];
}

export function EvolutionHero({ char, stops, value, size = 200 }) {
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
        if (era === 99) {
          // Moderne = l'animation make-me-a-hanzi (ordre des traits). Montée seulement
          // près du stop moderne → se (re)dessine à l'arrivée sur le présent.
          return (
            <View key="modern" style={{ position: 'absolute', width: size, height: size, alignItems: 'center', justifyContent: 'center', opacity }}>
              <HanziStroke char={char} size={size} />
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
          : <><Text style={{ fontWeight: '700', color: '#1a1a2e' }}>{ERA_LABEL[era]}</Text>{`  ·  ${ERA_SUB[era]}`}</>}
      </Text>
    </View>
  );
}
