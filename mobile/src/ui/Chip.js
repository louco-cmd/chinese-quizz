// Chip — pastille INTERACTIVE (sélectionnable), distincte de Badge (statique).
// Pour les filtres (MentorFilters), les choix (semaines récurrentes), les tags.
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from './Text';
import { COLORS, radius } from './tokens';

// variant 'soft' (défaut) : sélection en bleu clair (jiayouSoft). 'solid' :
// sélection en bleu plein + texte blanc (filtres de tri, choix de semaines…).
export default function Chip({ label, children, selected = false, icon, onPress, disabled = false, variant = 'soft', style }) {
  const solid = variant === 'solid';
  const fg = selected ? (solid ? '#fff' : COLORS.jiayouDark) : COLORS.muted;
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill,
        borderWidth: 1.5,
        borderColor: selected ? COLORS.jiayou : COLORS.line,
        backgroundColor: selected ? (solid ? COLORS.jiayou : COLORS.jiayouSoft) : '#fff',
        opacity: disabled ? 0.5 : 1,
      }, style]}
    >
      {icon ? <Ionicons name={icon} size={15} color={fg} /> : null}
      <Text variant="label" style={{ color: fg }}>{label ?? children}</Text>
    </Pressable>
  );
}
