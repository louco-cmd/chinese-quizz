// Tabs — onglets in-page soulignés (différent de SegmentedControl qui est un
// sélecteur « pilule »). Pour naviguer entre sections d'un écran.
import { Pressable, View } from 'react-native';
import Text from './Text';
import { COLORS } from './tokens';

export default function Tabs({ options = [], value, onChange, style }) {
  return (
    <View style={[{ flexDirection: 'row', borderBottomWidth: 1, borderColor: COLORS.line }, style]}>
      {options.map((opt) => {
        const val = opt?.value ?? opt;
        const label = opt?.label ?? opt;
        const active = val === value;
        return (
          <Pressable
            key={String(val)}
            onPress={() => onChange?.(val)}
            style={{ paddingVertical: 12, paddingHorizontal: 4, marginRight: 20, borderBottomWidth: 2, borderColor: active ? COLORS.jiayou : 'transparent', marginBottom: -1 }}
          >
            <Text variant="label" style={{ color: active ? COLORS.jiayou : COLORS.muted }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
