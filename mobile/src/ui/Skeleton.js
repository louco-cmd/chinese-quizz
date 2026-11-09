// Skeleton — placeholder de chargement (bloc pulsant). Remplace les spinners sur
// les listes/cartes pendant le fetch. SkeletonText pose N lignes.
import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { COLORS, radius } from './tokens';

export default function Skeleton({ width = '100%', height = 16, rounded = radius.sm, style }) {
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.4, duration: 650, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View style={[{ width, height, borderRadius: rounded, backgroundColor: COLORS.surfaceAlt, opacity: pulse }, style]} />
  );
}

export function SkeletonText({ lines = 3, gap = 8, lastWidth = '60%', style }) {
  return (
    <View style={[{ gap }, style]}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? lastWidth : '100%'} />
      ))}
    </View>
  );
}
