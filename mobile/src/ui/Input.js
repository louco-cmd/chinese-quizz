// Input — champ texte unifié avec label, icône et état d'erreur. Bordure qui
// réagit au focus/erreur. Transmet toutes les props TextInput (value, onChangeText,
// placeholder, secureTextEntry, keyboardType, multiline…).
import { useState } from 'react';
import { View, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from './Text';
import { COLORS, radius, fontSize } from './tokens';

export default function Input({ label, error, icon, style, inputStyle, onFocus, onBlur, ...rest }) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? COLORS.danger : (focused ? COLORS.jiayou : COLORS.line);

  return (
    <View style={style}>
      {label ? <Text variant="label" style={{ marginBottom: 6 }}>{label}</Text> : null}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        borderWidth: 1.5, borderColor, borderRadius: radius.md,
        paddingHorizontal: 12, backgroundColor: '#fff',
      }}>
        {icon ? <Ionicons name={icon} size={18} color={COLORS.muted} /> : null}
        <TextInput
          placeholderTextColor={COLORS.mutedLight}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          style={[{ flex: 1, paddingVertical: 12, fontSize: fontSize.base, color: COLORS.ink }, inputStyle]}
          {...rest}
        />
      </View>
      {error ? <Text variant="caption" color={COLORS.danger} style={{ marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}
