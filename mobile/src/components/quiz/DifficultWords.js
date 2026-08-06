import { useEffect, useState, useRef } from 'react';
import { View, Text, Pressable, ActivityIndicator, Animated, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Toggle from '../Toggle';
import { COLORS, SHADOW_CARD } from '../../theme';
import { useT } from '../../i18n';
import { getDifficultWords, getMe } from '../../api';
import CatLoader from '../CatLoader';

// Carte recto/verso qui se retourne au tap (rotateY), comme les flip-cards EJS.
function FlipCard({ front, sub, back, width }) {
  const anim = useRef(new Animated.Value(0)).current;
  const [flipped, setFlipped] = useState(false);
  function flip() {
    Animated.spring(anim, { toValue: flipped ? 0 : 1, useNativeDriver: true, friction: 8, tension: 10 }).start();
    setFlipped((f) => !f);
  }
  const frontRotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const backRotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });

  // Pas d'ombre (elevation) sur les faces qui tournent : sur Android l'ombre est
  // projetée depuis les bords de la vue et se déforme pendant le rotateY. L'ombre
  // est portée par le conteneur statique ci-dessous.
  const face = {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', backfaceVisibility: 'hidden',
    backgroundColor: '#fff', borderRadius: 14, padding: 8,
  };
  return (
    <Pressable onPress={flip} style={{ width, height: 110, borderRadius: 14, backgroundColor: '#fff', ...SHADOW_CARD }}>
      {/* Recto : fond blanc, texte bleu */}
      <Animated.View style={[face, { transform: [{ perspective: 800 }, { rotateY: frontRotate }] }]}>
        <Text style={{ fontSize: 21, fontWeight: '700', color: COLORS.jiayou, textAlign: 'center' }}>{front}</Text>
        {sub ? <Text style={{ fontSize: 13, color: COLORS.jiayou, opacity: 0.7, marginTop: 4 }}>{sub}</Text> : null}
      </Animated.View>
      {/* Verso : fond bleu, texte blanc */}
      <Animated.View style={[face, { backgroundColor: COLORS.jiayou, transform: [{ perspective: 800 }, { rotateY: backRotate }] }]}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#fff', textAlign: 'center' }}>{back}</Text>
      </Animated.View>
    </Pressable>
  );
}

// Section "Your difficulties" : mots les plus ratés en flip-cards + quick quiz.
export default function DifficultWords({ onQuickQuiz }) {
  const { t } = useT();
  const { width } = useWindowDimensions();
  const [words, setWords] = useState(null);
  const [direction, setDirection] = useState('en→zh');
  const [showPinyin, setShowPinyin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([getDifficultWords(), getMe().catch(() => ({}))]).then(([d, me]) => {
      if (!alive) return;
      setWords(d.words || []);
      if (me.quiz_direction) setDirection(me.quiz_direction);
    }).catch(() => setWords([])).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const learningChinese = direction !== 'zh→en';
  // Colonnes selon la largeur ; largeur en % (robuste quelle que soit la marge parent).
  const cols = width >= 900 ? 4 : width >= 560 ? 3 : 2;
  const cardWidth = cols === 4 ? '23.5%' : cols === 3 ? '31.5%' : '48%';

  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a1a2e' }}>{t('qz_your_difficulties')}</Text>
        {learningChinese && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ color: COLORS.muted, fontSize: 13 }}>{t('qz_pinyin')}</Text>
            <Toggle value={showPinyin} onValueChange={setShowPinyin} />
          </View>
        )}
      </View>

      {loading ? (
        <View style={{ marginVertical: 24, alignItems: 'center' }}><CatLoader size={90} /></View>
      ) : words.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 24 }}>
          <Ionicons name="happy-outline" size={40} color={COLORS.muted} />
          <Text style={{ color: COLORS.muted, marginTop: 8 }}>{t('qz_no_difficult')}</Text>
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 }}>
            {words.map((w) => (
              <FlipCard
                key={w.id}
                width={cardWidth}
                front={learningChinese ? w.chinese : w.english}
                sub={learningChinese && showPinyin ? w.pinyin : null}
                back={learningChinese ? w.english : w.chinese}
              />
            ))}
          </View>

          <Pressable
            onPress={() => onQuickQuiz(words.map((w) => w.id).filter(Boolean))}
            style={{ alignSelf: 'center', marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#6c757d', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 18 }}
          >
            <Ionicons name="flash" size={15} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>{t('qz_quick_quiz')}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
