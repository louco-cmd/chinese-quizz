import { Pressable, View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

// Carte d'action en dégradé (Start a duel = vert, Invite a friend = gris foncé),
// avec flèche en haut à droite. Calquée sur .duel-start-card / .invite-launch-card.
// `fill` : le dégradé prend toute la hauteur disponible (pour s'aligner sur des
// cartes voisines plus hautes dans une même rangée de grille).
export default function CtaCard({ colors, icon, title, text, onPress, fill = false }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flex: 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ borderRadius: 16, paddingVertical: 18, paddingHorizontal: 14, minHeight: fill ? 160 : 118, justifyContent: 'center', ...(fill ? { flex: 1 } : null) }}
      >
        <Ionicons name="arrow-forward-circle" size={20} color="rgba(255,255,255,0.7)" style={{ position: 'absolute', top: 10, right: 12 }} />
        <View style={{ alignItems: 'center' }}>
          {icon ? <Ionicons name={icon} size={30} color="#fff" style={{ marginBottom: 6 }} /> : null}
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16, textAlign: 'center' }}>{title}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2, textAlign: 'center' }}>{text}</Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}
