import { useEffect, useRef, useState } from 'react';
import { Modal, View, Pressable, Animated, StyleSheet, Keyboard, Platform, ScrollView, useWindowDimensions } from 'react-native';

// Popup réutilisable : fond noirci, contenu blanc centré, fadeInScale.
// Le backdrop est un Pressable DERRIÈRE le contenu (absolute), pas un wrapper —
// sinon, sur natif, il capture les gestes et bloque le scroll interne (carrousels).
//
// Hauteur unifiée : la carte est plafonnée à ~86% de la hauteur d'écran et son
// corps scrolle si le contenu dépasse. `header` (en-tête fixe) et `footer` (pied
// collé en bas, ex. bouton d'action) restent visibles pendant le scroll.
//
// `scroll={false}` : opt-out pour les popups qui gèrent leur propre scroll/layout
// (carrousel horizontal, ScrollView interne à hauteur fixe) → rendu brut, comme
// avant (aucun cap, aucun wrapper), pour éviter les scrolls imbriqués.
//
// Clavier : KeyboardAvoidingView ne fonctionne PAS dans un <Modal> sur Android
// (le Modal a sa propre fenêtre). On gère donc la hauteur du clavier à la main et
// on ajoute un paddingBottom = hauteur clavier au conteneur centré → le contenu
// se recentre au-dessus du clavier. Solution générale pour TOUTES les popups.
export default function Popup({
  visible, onClose, children, maxWidth = 440, contentStyle,
  header = null, footer = null, scroll = true, maxHeight,
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const [kb, setKb] = useState(0);
  const { height: screenH } = useWindowDimensions();

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

  const cardBase = {
    backgroundColor: '#fff', borderRadius: 20, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.2, shadowRadius: 40, elevation: 12,
  };

  // Plafond de hauteur commun (retire le clavier + les marges du conteneur).
  const capH = Math.max(240, (maxHeight ?? Math.round(screenH * 0.86)) - kb);

  let inner;
  if (scroll) {
    inner = (
      <View style={[cardBase, { maxHeight: capH, overflow: 'hidden' }, contentStyle]}>
        {header}
        <ScrollView
          style={{ flexShrink: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        {footer}
      </View>
    );
  } else {
    // Rendu brut historique (le contenu gère sa propre hauteur/scroll).
    inner = <View style={[cardBase, contentStyle]}>{children}</View>;
  }

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20 + kb }}>
        {/* Fond noirci — tap dehors = fermer. En dessous du contenu (sibling absolu). */}
        <Pressable onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]} />

        {/* Contenu au-dessus : tap dedans ne ferme pas, et le scroll interne marche. */}
        <Animated.View style={{ width: '100%', maxWidth, flexShrink: 1, opacity: anim, transform: [{ scale }] }}>
          {inner}
        </Animated.View>
      </View>
    </Modal>
  );
}
