// IconButton — bouton rond à icône (header, actions). hitSlop pour le tap confort.
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, radius } from './tokens';

export default function IconButton({ icon, size = 20, color = COLORS.ink, bg = 'transparent', onPress, disabled = false, style, ...rest }) {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={8}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [{
        width: 40, height: 40, borderRadius: radius.pill,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: bg, opacity: disabled ? 0.4 : (pressed ? 0.6 : 1),
      }, style]}
      {...rest}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}
