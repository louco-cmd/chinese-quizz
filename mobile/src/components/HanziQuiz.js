import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';

// Fallback web : l'entraînement à l'écriture (WebView + HanziWriter) est natif.
export default function HanziQuiz({ size = 260 }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f9fa', borderRadius: 20, padding: 16 }}>
      <Ionicons name="brush-outline" size={36} color={COLORS.mutedLight} />
      <Text style={{ color: COLORS.muted, textAlign: 'center', marginTop: 10, fontSize: 13 }}>
        Writing practice is available in the mobile app.
      </Text>
    </View>
  );
}
