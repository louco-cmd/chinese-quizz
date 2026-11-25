import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme';

// Écran d'attente « AI load » de la popup fin de cours : l'IA lit le cours et
// rédige le résumé + le vocabulaire. Pulse + barre indéterminée + étapes qui
// défilent. 100% RN Animated (OTA-safe). `onSkip` → écrire à la main tout de suite.
const STEPS = [
  'Reading the lesson transcript…',
  'Writing the summary…',
  'Picking out the vocabulary…',
];

export default function AiRecapLoader({ studentName, onSkip }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const [step, setStep] = useState(0);

  useEffect(() => {
    const p = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    const b = Animated.loop(Animated.timing(bar, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }));
    p.start(); b.start();
    const iv = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 1800);
    return () => { p.stop(); b.stop(); clearInterval(iv); };
  }, [pulse, bar]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.5] });
  const tx = bar.interpolate({ inputRange: [0, 1], outputRange: [-120, 220] });

  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 }}>
      {/* Pastille animée */}
      <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{ position: 'absolute', width: 96, height: 96, borderRadius: 48, backgroundColor: COLORS.jiayou, opacity: glow, transform: [{ scale }] }} />
        <View style={{ width: 66, height: 66, borderRadius: 33, backgroundColor: COLORS.jiayou, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="sparkles" size={30} color="#fff" />
        </View>
      </View>

      <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a1a2e', marginTop: 20, textAlign: 'center' }}>Preparing the recap</Text>
      <Text style={{ fontSize: 13, color: COLORS.muted, marginTop: 6, textAlign: 'center', lineHeight: 19 }}>
        The AI is reviewing the lesson with {studentName || 'your student'} to pre-fill the summary and vocabulary. No action needed — it drops in automatically.
      </Text>

      {/* Barre indéterminée */}
      <View style={{ width: '82%', maxWidth: 320, height: 6, borderRadius: 999, backgroundColor: '#e9eef7', overflow: 'hidden', marginTop: 22 }}>
        <Animated.View style={{ width: 110, height: 6, borderRadius: 999, backgroundColor: COLORS.jiayou, transform: [{ translateX: tx }] }} />
      </View>

      {/* Étape courante */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 16 }}>
        <Ionicons name="ellipse" size={7} color={COLORS.jiayou} />
        <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.jiayou }}>{STEPS[step]}</Text>
      </View>

      {onSkip ? (
        <Pressable onPress={onSkip} hitSlop={8} style={{ marginTop: 28 }}>
          <Text style={{ fontSize: 13.5, fontWeight: '700', color: COLORS.muted, textDecorationLine: 'underline' }}>I'll write it myself</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
