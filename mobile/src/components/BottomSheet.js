import { useEffect, useRef, useState } from 'react';
import { Modal, View, Pressable, Animated, Easing, StyleSheet, PanResponder, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Drawer réutilisable qui glisse depuis le BAS (annonces, notifications spéciales).
// - Slide-in / slide-out animé (translateY) + fondu du backdrop.
// - Tap sur le fond OU glisser vers le bas = fermer (si `dismissable`).
// - Poignée (grabber) en haut, coins arrondis, safe-area en bas.
// - Centré et borné en largeur sur grand écran (web/tablette).
//
// Usage : <BottomSheet visible={x} onClose={...}>{contenu}</BottomSheet>
export default function BottomSheet({
  visible, onClose, children, dismissable = true, maxHeightRatio = 0.9, maxWidth = 480,
}) {
  const { height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [render, setRender] = useState(visible);
  const anim = useRef(new Animated.Value(0)).current;      // 0 fermé → 1 ouvert
  const drag = useRef(new Animated.Value(0)).current;       // décalage du glissé (>= 0)

  useEffect(() => {
    if (visible) {
      setRender(true);
      drag.setValue(0);
      Animated.timing(anim, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else if (render) {
      Animated.timing(anim, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true })
        .start(({ finished }) => { if (finished) setRender(false); });
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { if (dismissable) onClose?.(); };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => dismissable && g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => { if (g.dy > 0) drag.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (dismissable && (g.dy > 110 || g.vy > 0.8)) onClose?.();
        else Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      },
    })
  ).current;

  if (!render) return null;

  const slideY = anim.interpolate({ inputRange: [0, 1], outputRange: [screenH, 0] });
  const translateY = Animated.add(slideY, drag);
  const backdropOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] });

  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={close}>
      <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
        <AnimatedPressable
          onPress={close}
          style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: backdropOpacity }]}
        />
        <Animated.View
          {...pan.panHandlers}
          style={{
            width: '100%', maxWidth, alignSelf: 'center',
            transform: [{ translateY }],
            backgroundColor: '#fff',
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            paddingTop: 10, paddingHorizontal: 22, paddingBottom: insets.bottom + 18,
            maxHeight: Math.round(screenH * maxHeightRatio),
            shadowColor: '#000', shadowOffset: { width: 0, height: -8 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 16,
          }}
        >
          {/* Poignée */}
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 999, backgroundColor: '#e2e6ee', marginBottom: 14 }} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}
