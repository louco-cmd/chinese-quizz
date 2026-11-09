// SegmentedControl — sélecteur à segments (ex. en→zh / zh→en, filtres). options =
// [{ label, value }] ou tableau de strings. value = segment actif, onChange(value).
import { Pressable, View } from 'react-native';
import Text from './Text';
import { COLORS, radius } from './tokens';

export default function SegmentedControl({ options = [], value, onChange, style }) {
  return (
    <View style={[{ flexDirection: 'row', backgroundColor: COLORS.surfaceAlt, borderRadius: radius.md, padding: 3 }, style]}>
      {options.map((opt) => {
        const val = opt?.value ?? opt;
        const label = opt?.label ?? opt;
        const active = val === value;
        return (
          <Pressable
            key={String(val)}
            onPress={() => onChange?.(val)}
            style={{
              flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: 'center',
              backgroundColor: active ? '#fff' : 'transparent',
              ...(active ? { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : null),
            }}
          >
            <Text variant="label" style={{ color: active ? COLORS.jiayou : COLORS.muted }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
