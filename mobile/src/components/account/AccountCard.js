import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOW_CARD } from '../../theme';

// Carte blanche arrondie (16px, ombre douce) commune à la page account.
// - `icon` + `title` → l'en-tête « section-title » (icône grise + libellé).
// - `actionLabel` + `onPress` → carte cliquable avec action soulignée en bas-droite.
export default function AccountCard({ icon, title, actionLabel, onPress, children, style }) {
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper
      onPress={onPress}
      style={[
        { backgroundColor: '#fff', borderRadius: 16, padding: 20, marginBottom: 14, ...SHADOW_CARD },
        style,
      ]}
    >
      {title ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 8 }}>
          {icon ? <Ionicons name={icon} size={20} color={COLORS.muted} /> : null}
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#444' }}>{title}</Text>
        </View>
      ) : null}

      {children}

      {actionLabel ? (
        <View style={{ alignItems: 'flex-end', marginTop: 12 }}>
          <Text style={{ color: '#444', fontWeight: '600', fontSize: 13, textDecorationLine: 'underline' }}>
            {actionLabel}
          </Text>
        </View>
      ) : null}
    </Wrapper>
  );
}
