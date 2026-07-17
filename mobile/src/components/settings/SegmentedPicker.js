import { View, Text, Pressable } from 'react-native';
import { COLORS } from '../../theme';

// Sélecteur à gélules (choix unique), comme .dir-picker/.dir-btn de l'EJS.
// `options` = [{ value, label }] ; `value` sélectionné ; `onChange(value)`.
export default function SegmentedPicker({ options, value, onChange }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={{
              flex: 1, borderRadius: 999, paddingVertical: 10, alignItems: 'center',
              borderWidth: 1.5,
              borderColor: active ? COLORS.jiayou : '#e2e6ea',
              backgroundColor: active ? '#e8f0ff' : '#fff',
            }}
          >
            <Text style={{ fontSize: 13.5, fontWeight: '600', color: active ? COLORS.jiayou : '#555' }}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
