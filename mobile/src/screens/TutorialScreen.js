import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { completeTutorial } from '../api';
import { COLORS } from '../theme';

// Tutoriel élève — carrousel. Chaque slide a `icon`, `title`, `body` et
// (optionnel) `image` = capture d'écran. Si `image` est présente elle occupe la
// zone visuelle ; sinon on retombe sur l'icône dégradée (aucune casse si les
// fichiers ne sont pas encore déposés).
//
// Captures attendues dans `assets/tutorial/` (à décommenter les require une fois
// les PNG déposés) :
//   01-home.png · 02-collection.png · 03-stats.png
//   04-duels.png · 05-store.png · 06-teacher.png
const SLIDES = [
  {
    icon: 'earth',
    image: require('../../assets/tutorial/01-home.png'),
    title: 'Join the Jiayou world',
    body: 'Learn Chinese better and faster with a community-powered app.',
  },
  {
    icon: 'bookmarks',
    image: require('../../assets/tutorial/02-collection.png'),
    title: 'Collect your words',
    body: 'Save every word you meet and build your own growing collection.',
  },
  {
    icon: 'school',
    image: require('../../assets/tutorial/03-stats.png'),
    title: 'Train yourself',
    body: 'Practise with personalised quizzes and flash cards to make each word stick.',
  },
  {
    icon: 'trophy',
    image: require('../../assets/tutorial/04-duels.png'),
    title: 'Challenge your friends',
    body: 'Take on your friends in duels and show them who is the best — mind the coin bets!',
  },
  {
    icon: 'pricetags',
    image: require('../../assets/tutorial/05-store.png'),
    title: 'Thematic word packs',
    body: 'Build, share and get ready-made vocabulary packs on the JiaStore.',
  },
  {
    icon: 'person-add',
    image: require('../../assets/tutorial/06-teacher.png'),
    title: 'Invite your teacher',
    body: 'Add your teacher so they can follow your learning and send you homework.',
  },
];

// `onDone` appelé après avoir marqué le tutoriel vu ; `onClose` (optionnel)
// pour un simple retour sans re-marquer (rejoué depuis les réglages).
export default function TutorialScreen({ onDone, onClose }) {
  const [index, setIndex] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const total = SLIDES.length;
  const isLast = index === total - 1;
  const slide = SLIDES[index];

  async function finish() {
    setFinishing(true);
    try { await completeTutorial(); } catch { /* non bloquant */ }
    onDone?.();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Logo + fermer éventuel */}
      <View style={{ height: 56, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 30, fontWeight: '700', color: COLORS.jiayou, letterSpacing: 2 }}>加油</Text>
        {onClose ? (
          <Pressable onPress={onClose} hitSlop={10} style={{ position: 'absolute', right: 18, top: 16 }}>
            <Ionicons name="close" size={24} color={COLORS.muted} />
          </Pressable>
        ) : null}
      </View>

      {/* Slide */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        <View style={{
          width: '100%', maxWidth: 560, backgroundColor: '#fff', borderRadius: 28, padding: 24,
          shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.08, shadowRadius: 32, elevation: 4,
        }}>
          {/* Zone visuelle : capture d'écran si fournie, sinon icône dégradée.
              Les captures sont déjà sur fond bleu → `contain` sur un fond bleu
              assorti pour les afficher en entier sans rognage. */}
          {slide.image ? (
            <View style={{ height: 300, borderRadius: 20, overflow: 'hidden', backgroundColor: '#1772F5', alignItems: 'center', justifyContent: 'center' }}>
              <Image source={slide.image} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
            </View>
          ) : (
            <LinearGradient
              colors={['#1772F5', '#1EBCEE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ height: 300, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name={slide.icon} size={96} color="rgba(255,255,255,0.95)" />
            </LinearGradient>
          )}
          <Text style={{ fontSize: 26, fontWeight: '700', color: COLORS.jiayou, marginTop: 18, letterSpacing: -0.4 }}>{slide.title}</Text>
          <Text style={{ fontSize: 15, color: '#4b5565', lineHeight: 24, marginTop: 10 }}>{slide.body}</Text>
        </View>
      </View>

      {/* Bottom bar */}
      <View style={{
        height: 84, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, borderTopWidth: 1, borderColor: '#f0f2f5',
      }}>
        {/* Prev */}
        <Pressable
          onPress={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          style={{
            width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
            borderWidth: 1.5, borderColor: '#dee2e6', opacity: index === 0 ? 0 : 1,
          }}
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.jiayou} />
        </Pressable>

        {/* Dots + step */}
        <View style={{ alignItems: 'center', gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            {SLIDES.map((_, i) => (
              <View key={i} style={{
                height: 7, borderRadius: 20,
                width: i === index ? 22 : 7,
                backgroundColor: i === index ? COLORS.jiayou : '#cbd5e1',
              }} />
            ))}
          </View>
          <Text style={{ fontSize: 12, fontWeight: '600', color: '#94a3b8', letterSpacing: 0.5 }}>{index + 1} / {total}</Text>
        </View>

        {/* Next / Start */}
        {isLast ? (
          <Pressable
            onPress={finish} disabled={finishing}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.jiayou, borderRadius: 60, paddingVertical: 12, paddingHorizontal: 22 }}
          >
            {finishing ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <Ionicons name="play-circle" size={18} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Start playing</Text>
              </>
            )}
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setIndex((i) => Math.min(total - 1, i + 1))}
            style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.jiayou }}
          >
            <Ionicons name="arrow-forward" size={22} color="#fff" />
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}
