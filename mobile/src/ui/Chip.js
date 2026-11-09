// Chip — pastille INTERACTIVE (sélectionnable), distincte de Badge (statique).
// Pour les filtres (MentorFilters), les choix (semaines récurrentes), les tags.
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from './Text';
import { COLORS, radius } from './tokens';

export default function Chip({ label, children, selected = false, icon, onPress, disabled = false, style }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill,
        borderWidth: 1.5,
        borderColor: selected ? COLORS.jiayou : COLORS.line,
        backgroundColor: selected ? COLORS.jiayouSoft : '#fff',
        opacity: disabled ? 0.5 : (pressed ? 0.8 : 1),
      }, style]}
    >
      {icon ? <Ionicons name={icon} size={15} color={selected ? COLORS.jiayou : COLORS.muted} /> : null}
      <Text variant="label" style={{ color: selected ? COLORS.jiayouDark : COLORS.muted }}>{label ?? children}</Text>
    </Pressable>
  );
}
