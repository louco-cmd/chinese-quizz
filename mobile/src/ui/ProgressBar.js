// ProgressBar — barre de progression (track + fill). value ∈ [0,1] (ou 0..100 si
// `max`). Couvre MasteryBar et les jauges de maîtrise. Pur View (aucune dépendance).
import { View } from 'react-native';
import { COLORS, radius } from './tokens';

export default function ProgressBar({ value = 0, max = 1, height = 8, color = COLORS.jiayou, track = COLORS.surfaceAlt, rounded = true, style }) {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  return (
    <View style={[{ width: '100%', height, backgroundColor: track, borderRadius: rounded ? radius.pill : 0, overflow: 'hidden' }, style]}>
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color, borderRadius: rounded ? radius.pill : 0 }} />
    </View>
  );
}

// Jauge segmentée (ex. maîtrise par palier) : plusieurs segments colorés.
export function SegmentBar({ segments = [], height = 8, gap = 2, style }) {
  const total = segments.reduce((s, x) => s + (x.value || 0), 0) || 1;
  return (
    <View style={[{ flexDirection: 'row', height, gap, width: '100%' }, style]}>
      {segments.map((s, i) => (
        <View key={i} style={{ flex: (s.value || 0) / total, backgroundColor: s.color || COLORS.jiayou, borderRadius: radius.pill }} />
      ))}
    </View>
  );
}
