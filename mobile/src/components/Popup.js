import { useEffect, useRef, useState } from 'react';
import { Modal, View, Pressable, Animated, StyleSheet, Keyboard, Platform } from 'react-native';

// Popup réutilisable : fond noirci, contenu blanc centré, fadeInScale.
// Le backdrop est un Pressable DERRIÈRE le contenu (absolute), pas un wrapper —
// sinon, sur natif, il capture les gestes et bloque le scroll interne (carrousels).
//
// Clavier : KeyboardAvoidingView ne fonctionne PAS dans un <Modal> sur Android
// (le Modal a sa propre fenêtre). On gère donc la hauteur du clavier à la main et
// on ajoute un paddingBottom = hauteur clavier au conteneur centré → le contenu
// se recentre au-dessus du clavier. Solution générale pour TOUTES les popups.
export default function Popup({ visible, onClose, children, maxWidth = 440, contentStyle }) {
  const anim = useRef(new Animated.Value(0)).current;
  const [kb, setKb] = useState(0);

  useEffect(() => {
    if (visible) {
      anim.setValue(0);
      Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [visible, anim]);

  useEffect(() => {
    if (!visible) { setKb(0); return; }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e) => setKb(e.endCoordinates?.height || 0));
    const h = Keyboard.addListener(hideEvt, () => setKb(0));
    return () => { s.remove(); h.remove(); };
  }, [visible]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] });

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20 + kb }}>
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
