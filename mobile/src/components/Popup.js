import { useEffect, useRef } from 'react';
import { Modal, View, Pressable, Animated } from 'react-native';

// Popup réutilisable, calquée sur .confirm-popup de l'EJS :
// fond noirci, contenu blanc centré, animation d'entrée fadeInScale.
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
      {/* Fond noirci — tap dehors = fermer */}
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      >
        <Animated.View style={{ width: '100%', maxWidth, opacity: anim, transform: [{ scale }] }}>
          {/* Contenu — tap dedans n'ferme pas */}
          <Pressable
            onPress={() => {}}
            style={[
              {
                backgroundColor: '#fff', borderRadius: 20, padding: 24,
                shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.2, shadowRadius: 40, elevation: 12,
              },
              contentStyle,
            ]}
          >
            {children}
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
