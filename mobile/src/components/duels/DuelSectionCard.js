import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOW_CARD } from '../../theme';

// Carte de section des duels : en-tête (icône grise + titre + note à droite) puis
// corps. Calquée sur .duels-card / .card-header de l'EJS. `noBodyPad` = liste collée.
export default function DuelSectionCard({ icon, title, note, onPress, noBodyPad, children }) {
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', marginBottom: 14, ...SHADOW_CARD }}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#f0f0f0',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon ? <Ionicons name={icon} size={19} color={COLORS.muted} /> : null}
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#444' }}>{title}</Text>
        </View>
        {note ? <Text style={{ fontSize: 12, color: COLORS.muted }}>{note}</Text> : null}
        {onPress && !note ? <Ionicons name="chevron-forward" size={16} color="#c4c4c4" /> : null}
      </Pressable>
      <View style={noBodyPad ? null : { padding: 18 }}>{children}</View>
    </View>
  );
}
