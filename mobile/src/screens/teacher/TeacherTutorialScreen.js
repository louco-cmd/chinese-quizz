import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme';

// Tutoriel dédié aux professeurs. Placeholder pour l'instant : la structure
// (header + corps + bouton) est prête, le contenu des étapes sera ajouté plus
// tard. `onDone` termine le tuto ; `onClose` (optionnel) le ferme sans le finir.
export default function TeacherTutorialScreen({ onDone, onClose }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: '#1a1a2e' }}>Teacher tutorial</Text>
        {onClose ? (
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={COLORS.muted} />
          </Pressable>
        ) : null}
      </View>

      {/* Corps (à remplir) */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: '#e8f0ff', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
          <Ionicons name="school-outline" size={38} color={COLORS.jiayou} />
        </View>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#1a1a2e', textAlign: 'center' }}>
          Coming soon
        </Text>
        <Text style={{ fontSize: 14, color: COLORS.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
          A guided walkthrough of the teacher tools — creating classes, adding tasks
          and tracking your students — is on its way.
        </Text>
      </View>

      {/* Action */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
        <Pressable
          onPress={onDone}
          style={{ backgroundColor: COLORS.jiayou, borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Got it</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
