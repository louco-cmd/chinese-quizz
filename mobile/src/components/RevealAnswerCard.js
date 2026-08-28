import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { COLORS, SHADOW_CARD } from '../theme';
import { isZhLearning, ttsFor } from '../langs';

// Carte horizontale montrant la réponse après une erreur (quiz + duel). La ligne
// PRINCIPALE = la réponse attendue, sans répéter la consigne (déjà montrée) :
//  • lecture CHINOIS (montre le hanzi → répond le pinyin) → pinyin (gras) +
//    traduction en secondaire ; on NE répète PAS le caractère.
//  • lecture NON-ZH (montre le mot → répond la trad) → traduction (gras) seule.
//  • sinon (pinyin/caractère zh, écriture non-zh) → mot appris (hanzi en chinois)
//    en principal + pinyin (zh) + traduction en secondaire.
// Voix TTS = toujours le mot appris, dans la langue apprise.
export default function RevealAnswerCard({ word, learningLang = 'zh', type }) {
  const isZh = isZhLearning(learningLang);
  const isReading = type === 'reading';
  const readingBase = !isZh && isReading; // non-zh lecture → réponse = traduction
  const readingZh = isZh && isReading;    // chinois lecture → réponse = pinyin
  const spoken = word.chinese || '';
  const lang = ttsFor(learningLang);

  const speak = () => {
    try { Speech.stop(); Speech.speak(spoken, { language: lang, rate: 0.9 }); } catch { /* TTS indispo */ }
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 18, marginBottom: 16, gap: 12, ...SHADOW_CARD }}>
      <View style={{ flex: 1 }}>
        {readingBase ? (
          <Text style={{ fontSize: 22, fontWeight: '800', color: '#1a1a2e' }}>{word.english}</Text>
        ) : readingZh ? (
          <>
            <Text style={{ fontSize: 24, fontWeight: '800', color: '#1a1a2e' }}>{word.pinyin || word.chinese}</Text>
            {word.english ? <Text style={{ fontSize: 14.5, color: COLORS.muted, marginTop: 2 }}>{word.english}</Text> : null}
          </>
        ) : (
          <>
            <Text style={{ fontSize: isZh ? 24 : 20, fontWeight: '800', color: '#1a1a2e' }}>{word.chinese}</Text>
            {isZh && word.pinyin ? <Text style={{ fontSize: 14.5, color: COLORS.muted, marginTop: 1 }}>{word.pinyin}</Text> : null}
            {word.english ? <Text style={{ fontSize: 14.5, color: COLORS.muted, marginTop: 2 }}>{word.english}</Text> : null}
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
