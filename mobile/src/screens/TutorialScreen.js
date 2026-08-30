import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts, LaBelleAurore_400Regular } from '@expo-google-fonts/la-belle-aurore';
import { completeTutorial } from '../api';
import { COLORS } from '../theme';
import { useT } from '../i18n';

// Tutoriel élève — carrousel. Chaque slide a `icon`, `title`, `body` et une
// `image` (300×400, ratio 3:4) qui contient déjà le titre manuscrit. Quand une
// image est présente on masque le titre texte (évite le doublon) ; `icon` sert
// de repli si l'image manque.
const SLIDES = [
  { icon: 'bookmarks', titleKey: 'tut_s1_title', bodyKey: 'tut_s1_body', image: require('../../assets/tutorial/01-capture.png') },
  { icon: 'trophy', titleKey: 'tut_s2_title', bodyKey: 'tut_s2_body', image: require('../../assets/tutorial/02-challenge.png') },
  { icon: 'storefront', titleKey: 'tut_s3_title', bodyKey: 'tut_s3_body', image: require('../../assets/tutorial/03-community.png') },
  // Slide monnaie : mockup dédié (fallback symbole ₵ / icône si l'image manque).
  { icon: 'cash', symbol: '₵', titleKey: 'tut_coins_title', bodyKey: 'tut_coins_body', image: require('../../assets/tutorial/coins.png') },
  { icon: 'school', titleKey: 'tut_s4_title', bodyKey: 'tut_s4_body', image: require('../../assets/tutorial/04-learn.png') },
];

// `onDone` appelé après avoir marqué le tutoriel vu ; `onClose` (optionnel)
// pour un simple retour sans re-marquer (rejoué depuis les réglages).
export default function TutorialScreen({ onDone, onClose }) {
  const { t } = useT();
  const [fontsLoaded] = useFonts({ LaBelleAurore_400Regular });
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
          {/* Titre manuscrit (La Belle Aurore) écrit en code, au-dessus de l'image. */}
          <Text
            style={{
              fontFamily: fontsLoaded ? 'LaBelleAurore_400Regular' : undefined,
              fontStyle: fontsLoaded ? 'normal' : 'italic',
              fontSize: 34, lineHeight: 44, color: COLORS.jiayou, textAlign: 'center', marginBottom: 12,
            }}
          >
            {t(slide.titleKey)}
          </Text>

          {/* Zone visuelle : mockups (carré, fond transparent) ou icône en repli. */}
          {slide.image ? (
            <View style={{ width: '100%', maxWidth: 460, alignSelf: 'center', aspectRatio: 1346 / 1444, borderRadius: 20, overflow: 'hidden' }}>
              <Image source={slide.image} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
            </View>
          ) : (
            <LinearGradient
              colors={['#1772F5', '#1EBCEE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ width: '100%', aspectRatio: 1, maxHeight: 450, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
            >
              {slide.symbol ? (
                <Text style={{ fontSize: 150, fontWeight: '800', color: 'rgba(255,255,255,0.97)' }}>{slide.symbol}</Text>
              ) : (
                <Ionicons name={slide.icon} size={96} color="rgba(255,255,255,0.95)" />
              )}
            </LinearGradient>
          )}

          <Text style={{ fontSize: 16.5, color: '#4b5565', lineHeight: 25, marginTop: 14, textAlign: 'center' }}>{t(slide.bodyKey)}</Text>
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
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{t('tut_start')}</Text>
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
