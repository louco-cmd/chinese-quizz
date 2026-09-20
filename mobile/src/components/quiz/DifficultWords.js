import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Toggle from '../Toggle';
import { COLORS, SHADOW_CARD } from '../../theme';
import { useT } from '../../i18n';
import { getDifficultWords, getMe } from '../../api';
import CatLoader from '../CatLoader';

// Section "Your difficulties" : tableau des mots les plus ratés sur ~2 semaines.
// Chaque ligne = terme appris (+ pinyin si chinois) : traduction. Un bouton
// « Hide translation » (à côté du titre, comme un show-pinyin) masque la colonne
// traduction, et un bouton « Start quiz on these words » lance un quiz sur la liste.
export default function DifficultWords({ onQuickQuiz, wordsCount, onCapture, onStartQuiz }) {
  const { t } = useT();
  const [words, setWords] = useState(null);
  const [learningLang, setLearningLang] = useState('zh');
  const [hideTranslation, setHideTranslation] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([getDifficultWords(), getMe().catch(() => ({}))]).then(([d, me]) => {
      if (!alive) return;
      setWords(d.words || []);
      if (me.learning_lang) setLearningLang(me.learning_lang);
    }).catch(() => setWords([])).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const learningChinese = learningLang === 'zh';
  // Collection maigre (<10 mots) → on invite à capturer plutôt qu'à lancer un quiz.
  const fewWords = typeof wordsCount === 'number' && wordsCount < 10;

  return (
    <View style={{ marginTop: 8 }}>
      {loading ? (
        <View style={{ marginVertical: 24, alignItems: 'center' }}><CatLoader size={90} /></View>
      ) : words.length === 0 ? (
        <View style={{ backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 16, ...SHADOW_CARD }}>
          {/* Entête identique (icône + titre), sans toggle. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#f0f0f0' }}>
            <Ionicons name="barbell" size={19} color={COLORS.muted} />
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#444' }}>{t('qz_your_difficulties')}</Text>
          </View>
          {/* Empty state : titre secondaire + sous-titre + CTA (sans picto). */}
          <View style={{ alignItems: 'center', paddingVertical: 28, paddingHorizontal: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.muted, textAlign: 'center' }}>{t('qz_no_difficult')}</Text>
            {fewWords ? (
              <>
                <Text style={{ fontSize: 13.5, color: COLORS.mutedLight, textAlign: 'center', marginTop: 8, lineHeight: 20, maxWidth: 300 }}>{t('qz_empty_capture_sub')}</Text>
                <Pressable onPress={() => onCapture?.()}
                  style={{ marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 13, paddingHorizontal: 26 }}>
                  <Ionicons name="add-circle" size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14.5 }}>{t('qz_empty_capture_cta')}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 13.5, color: COLORS.mutedLight, textAlign: 'center', marginTop: 8, lineHeight: 20, maxWidth: 300 }}>{t('qz_empty_quiz_sub')}</Text>
                <Pressable onPress={() => onStartQuiz?.()}
                  style={{ marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 24 }}>
                  <Ionicons name="flash" size={16} color={COLORS.jiayou} />
                  <Text style={{ color: COLORS.jiayou, fontWeight: '800', fontSize: 14.5 }}>{t('qz_start_quiz')}</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      ) : (
        <>
          {/* Tableau : entête (titre + toggle) puis lignes terme (+ pinyin) : traduction. */}
          <View style={{ backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 16, ...SHADOW_CARD }}>
            {/* Entête de tableau — même UI que « My statistics » : icône grise +
                titre (15/700/#444), toggle « masquer traduction » à droite. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderColor: '#f0f0f0' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="barbell" size={19} color={COLORS.muted} />
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#444' }}>{t('qz_your_difficulties')}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ color: COLORS.muted, fontSize: 13 }}>{t('qz_hide_translation')}</Text>
                <Toggle value={hideTranslation} onValueChange={setHideTranslation} />
              </View>
            </View>
            {words.map((w, i) => (
              <View
                key={w.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: i === words.length - 1 ? 0 : 1, borderColor: '#f2f4f7' }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: learningChinese ? 20 : 17, fontWeight: '700', color: '#1a1a2e' }}>{w.chinese}</Text>
                  {learningChinese && w.pinyin ? (
                    <Text style={{ fontSize: 13, color: COLORS.jiayou, fontWeight: '600', marginTop: 2 }}>{w.pinyin}</Text>
                  ) : null}
                </View>
                <View style={{ flex: 1.2, minWidth: 0 }}>
                  {hideTranslation ? (
                    <Text style={{ fontSize: 16, color: '#c4c9d2', letterSpacing: 1 }}>•••</Text>
                  ) : (
                    <Text style={{ fontSize: 14, color: '#495057', fontWeight: '500' }}>{w.english}</Text>
                  )}
                </View>
              </View>
            ))}
          </View>

          <Pressable
            onPress={() => onQuickQuiz(words.map((w) => w.id).filter(Boolean))}
            style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 14 }}
          >
            <Ionicons name="flash" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{t('qz_start_quiz_words')}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
