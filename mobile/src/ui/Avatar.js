import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';

// Jeu d'avatars : pictos Ionicons (déjà bundlés → aucun rebuild) + fonds unis.
// Ces deux listes sont la SOURCE DE VÉRITÉ, partagées par le sélecteur et le
// rendu, et validées côté backend (allowlist).
export const AVATAR_ICONS = [
  'happy', 'paw', 'rocket', 'planet', 'flame', 'flash', 'star', 'heart',
  'leaf', 'musical-notes', 'football', 'game-controller', 'fish', 'diamond',
  'moon', 'sunny',
];
export const AVATAR_COLORS = [
  '#0d6efd', '#6f42c1', '#e83e8c', '#dc3545', '#fd7e14', '#f7b500',
  '#198754', '#20c997', '#0dcaf0', '#495057',
];

// Avatar rond : picto blanc sur fond coloré si l'utilisateur en a choisi un,
// sinon repli sur l'initiale du nom (fond bleu pâle), comme avant.
export default function Avatar({ icon, color, name, size = 40 }) {
  const hasIcon = !!icon && AVATAR_ICONS.includes(icon);
  const bg = hasIcon ? (color || AVATAR_COLORS[0]) : '#e8f0ff';
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      {hasIcon ? (
        <Ionicons name={icon} size={Math.round(size * 0.55)} color="#fff" />
      ) : (
        <Text style={{ color: COLORS.jiayou, fontWeight: '700', fontSize: Math.round(size * 0.42) }}>
          {(name || '?').charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );
}
