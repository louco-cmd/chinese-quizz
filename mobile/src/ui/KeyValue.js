// KeyValue — ligne « label à gauche / valeur à droite ». Ultra-fréquent (infos
// cours, profil, détails pack, réglages en lecture seule).
import { View } from 'react-native';
import Text from './Text';

export default function KeyValue({ label, value, children, icon, style }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
        {icon}
        <Text variant="muted">{label}</Text>
      </View>
      {children ?? <Text variant="bodyStrong" style={{ textAlign: 'right' }}>{value}</Text>}
    </View>
  );
}
