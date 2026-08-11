import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { COLORS, SHADOW_CARD } from '../theme';

// Carte horizontale montrant la réponse après une erreur (quiz + duel).
// Apprentissage du chinois : caractère + pinyin + bouton audio (voix chinoise).
// Apprentissage de l'anglais (direction zh→en) : mot anglais + bouton audio (voix anglaise).
export default function RevealAnswerCard({ word, direction }) {
  const learningEnglish = direction === 'zh→en';
  const spoken = learningEnglish ? (word.english || '').split('/')[0].trim() : (word.chinese || '');
  const lang = learningEnglish ? 'en-US' : 'zh-CN';

  const speak = () => {
    try { Speech.stop(); Speech.speak(spoken, { language: lang, rate: 0.9 }); } catch { /* TTS indispo */ }
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 18, marginBottom: 16, gap: 12, ...SHADOW_CARD }}>
      <View style={{ flex: 1 }}>
        {learningEnglish ? (
          <Text style={{ fontSize: 20, fontWeight: '800', color: '#1a1a2e' }}>{word.english}</Text>
        ) : (
          <>
            <Text style={{ fontSize: 24, fontWeight: '800', color: '#1a1a2e' }}>{word.chinese}</Text>
            {word.pinyin ? <Text style={{ fontSize: 14.5, color: COLORS.muted, marginTop: 1 }}>{word.pinyin}</Text> : null}
          </>
        )}
      </View>
      <Pressable
        onPress={speak}
        hitSlop={8}
        style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.jiayou, alignItems: 'center', justifyContent: 'center' }}
      >
        <Ionicons name="volume-high" size={22} color="#fff" />
      </Pressable>
    </View>
  );
}
