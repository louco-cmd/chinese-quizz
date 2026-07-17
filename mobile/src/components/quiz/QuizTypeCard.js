import { Pressable, View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

// Carte de type de quiz (dégradé + icône + titre + description + flèche),
// calquée sur .quiz-card de l'EJS (bleu = pinyin, violet = caractères).
export default function QuizTypeCard({ colors, icon, title, description, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ borderRadius: 18, paddingVertical: 26, paddingHorizontal: 20, marginBottom: 14 }}
      >
        <Ionicons name="arrow-forward-circle" size={22} color="rgba(255,255,255,0.5)" style={{ position: 'absolute', top: 12, right: 14 }} />
        <View style={{ alignItems: 'center' }}>
          <Ionicons name={icon} size={44} color="#fff" style={{ marginBottom: 8 }} />
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 4 }}>{title}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, textAlign: 'center' }}>{description}</Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}
