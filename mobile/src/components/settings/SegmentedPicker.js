import { View, Text, Pressable } from 'react-native';
import { COLORS } from '../../theme';

// Sélecteur à gélules (choix unique), comme .dir-picker/.dir-btn de l'EJS.
// `options` = [{ value, label, sub? }] ; `value` sélectionné ; `onChange(value)`.
// `sub` (optionnel) = petit sous-titre 2 mots sous le label, dans le bouton.
export default function SegmentedPicker({ options, value, onChange }) {
  const hasSub = options.some((o) => o.sub);
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={{
              flex: 1, borderRadius: hasSub ? 16 : 999, paddingVertical: hasSub ? 8 : 10, paddingHorizontal: 4, alignItems: 'center',
              borderWidth: 1.5,
              borderColor: active ? COLORS.jiayou : '#e2e6ea',
              backgroundColor: active ? '#e8f0ff' : '#fff',
            }}
          >
            <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '600', color: active ? COLORS.jiayou : '#555' }}>
              {opt.label}
            </Text>
            {opt.sub ? (
              <Text numberOfLines={1} style={{ fontSize: 10.5, fontWeight: '500', marginTop: 2, color: active ? COLORS.jiayou : COLORS.mutedLight }}>
                {opt.sub}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
