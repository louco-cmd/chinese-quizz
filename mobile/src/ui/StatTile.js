// StatTile — valeur + label (+ icône / delta optionnels). L'atome des blocs de
// stats (StatTriplet, DuelStats, QuizStats…). StatRow pose plusieurs tuiles en ligne.
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from './Text';
import { COLORS, fontWeight } from './tokens';

export default function StatTile({ value, label, icon, delta, align = 'center', style }) {
  const up = typeof delta === 'number' && delta >= 0;
  return (
    <View style={[{ flex: 1, alignItems: align === 'center' ? 'center' : 'flex-start', gap: 2 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon ? <Ionicons name={icon} size={16} color={COLORS.jiayou} /> : null}
        <Text style={{ fontSize: 24, fontWeight: fontWeight.bold, color: COLORS.ink, lineHeight: 28 }}>{value}</Text>
        {typeof delta === 'number' ? (
          <Text variant="caption" style={{ color: up ? COLORS.success : COLORS.danger, fontWeight: '700' }}>
            {up ? '▲' : '▼'} {Math.abs(delta)}
          </Text>
        ) : null}
      </View>
      <Text variant="caption">{label}</Text>
    </View>
  );
}

// Rangée de StatTile séparées par un trait (comme .stats-row EJS).
export function StatRow({ children, bordered = true, style }) {
  return (
    <View style={[{
      flexDirection: 'row', paddingVertical: 14,
      ...(bordered ? { borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLORS.lineSoft } : null),
    }, style]}>
      {children}
    </View>
  );
}
