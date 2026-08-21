import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../../theme';
import { useT } from '../../i18n';

// Tutoriel professeur — même design que le tutoriel élève. Pas d'images pour
// l'instant : un idéogramme/icône occupe la zone visuelle (à remplacer par des
// captures plus tard). Chaque slide a `icon`, `title`, `body`.
const SLIDES = [
  { icon: 'people', titleKey: 'tut_t_s1_title', bodyKey: 'tut_t_s1_body' },
  { icon: 'clipboard', titleKey: 'tut_t_s2_title', bodyKey: 'tut_t_s2_body' },
  { icon: 'storefront', titleKey: 'tut_t_s3_title', bodyKey: 'tut_t_s3_body' },
];

// `onDone` termine le tutoriel ; `onClose` (optionnel) ferme sans terminer.
export default function TeacherTutorialScreen({ onDone, onClose }) {
  const { t } = useT();
  const [index, setIndex] = useState(0);
  const total = SLIDES.length;
  const isLast = index === total - 1;
  const slide = SLIDES[index];

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
          {/* Zone visuelle (icône pour l'instant, image plus tard) */}
          <LinearGradient
            colors={['#1772F5', '#1EBCEE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ height: 300, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name={slide.icon} size={96} color="rgba(255,255,255,0.95)" />
          </LinearGradient>
          <Text style={{ fontSize: 26, fontWeight: '700', color: COLORS.jiayou, marginTop: 18, letterSpacing: -0.4 }}>{t(slide.titleKey)}</Text>
          <Text style={{ fontSize: 15, color: '#4b5565', lineHeight: 24, marginTop: 10 }}>{t(slide.bodyKey)}</Text>
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

        {/* Next / Done */}
        {isLast ? (
          <Pressable
            onPress={() => onDone?.()}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.jiayou, borderRadius: 60, paddingVertical: 12, paddingHorizontal: 22 }}
          >
            <Ionicons name="checkmark-circle" size={18} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{t('tut_t_start')}</Text>
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
