// Card — surface blanche standard (radius + ombre + padding). `flat` pour les
// cartes animées en opacity (ombre sans elevation, cf. SHADOW_CARD_FLAT).
import { View } from 'react-native';
import { COLORS, SHADOW_CARD, SHADOW_CARD_FLAT, radius } from './tokens';

export default function Card({ children, padding = 16, flat = false, style, ...rest }) {
  return (
    <View
      style={[
        { backgroundColor: COLORS.surface, borderRadius: radius.card, padding },
        flat ? SHADOW_CARD_FLAT : SHADOW_CARD,
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}
