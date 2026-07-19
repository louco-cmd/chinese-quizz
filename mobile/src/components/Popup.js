import { useEffect, useRef } from 'react';
import { Modal, View, Pressable, Animated, StyleSheet } from 'react-native';

// Popup réutilisable : fond noirci, contenu blanc centré, fadeInScale.
// Le backdrop est un Pressable DERRIÈRE le contenu (absolute), pas un wrapper —
// sinon, sur natif, il capture les gestes et bloque le scroll interne (carrousels).
export default function Popup({ visible, onClose, children, maxWidth = 440, contentStyle }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      anim.setValue(0);
      Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [visible, anim]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] });

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        {/* Fond noirci — tap dehors = fermer. En dessous du contenu (sibling absolu). */}
        <Pressable onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]} />

        {/* Contenu au-dessus : tap dedans ne ferme pas, et le scroll interne marche. */}
        <Animated.View style={{ width: '100%', maxWidth, opacity: anim, transform: [{ scale }] }}>
          <View
            style={[
              {
                backgroundColor: '#fff', borderRadius: 20, padding: 24,
                shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.2, shadowRadius: 40, elevation: 12,
              },
              contentStyle,
            ]}
          >
            {children}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
