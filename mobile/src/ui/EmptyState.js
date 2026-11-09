// EmptyState — état vide (icône + titre + texte + action optionnelle). Pour les
// listes vides (pas de mots, pas de duels, pas de résultats de recherche…).
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from './Text';
import Button from './Button';
import { COLORS } from './tokens';

export default function EmptyState({ icon = 'sparkles-outline', title, children, actionLabel, onAction, style }) {
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center', paddingVertical: 40, paddingHorizontal: 24, gap: 10 }, style]}>
      <Ionicons name={icon} size={44} color={COLORS.mutedLight} />
      {title ? <Text variant="subtitle" align="center">{title}</Text> : null}
      {children ? <Text variant="muted" align="center">{children}</Text> : null}
      {actionLabel && onAction ? <Button title={actionLabel} variant="secondary" onPress={onAction} style={{ marginTop: 6 }} /> : null}
    </View>
  );
}
