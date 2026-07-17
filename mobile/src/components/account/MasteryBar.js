import { View, Text } from 'react-native';

// Barre de maîtrise segmentée (mastered/learning/medium/novice) + légende %,
// calquée sur .mastery-track de l'EJS. `dist` = { mastered, learning, medium, novice }.
const SEGMENTS = [
  { key: 'mastered', color: '#0d6efd' },
  { key: 'learning', color: '#0dcaf0' },
  { key: 'medium',   color: '#ffc107' },
  { key: 'novice',   color: '#adb5bd' },
];

export default function MasteryBar({ dist, total, caption }) {
  const t = total || 0;
  const pct = (v) => (t > 0 ? `${(v / t) * 100}%` : '0%');
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ height: 8, borderRadius: 999, overflow: 'hidden', backgroundColor: '#e9ecef', flexDirection: 'row' }}>
        {SEGMENTS.map((s) => (
          <View key={s.key} style={{ width: pct(dist[s.key] || 0), backgroundColor: s.color, height: '100%' }} />
        ))}
      </View>
      {caption ? <Text style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{caption}</Text> : null}
    </View>
  );
}
