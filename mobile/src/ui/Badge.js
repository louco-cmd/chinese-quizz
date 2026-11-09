// Badge — pastille sémantique (pill). tone = default|primary|success|danger|warning|muted.
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from './Text';
import { radius, tones } from './tokens';

export default function Badge({ children, tone = 'default', icon, style }) {
  const t = tones[tone] || tones.default;
  return (
    <View style={[{
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: t.bg, borderRadius: radius.pill,
      paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start',
    }, style]}>
      {icon ? <Ionicons name={icon} size={12} color={t.fg} /> : null}
      <Text variant="caption" style={{ color: t.fg, fontWeight: '700' }}>{children}</Text>
    </View>
  );
}
