import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { useT } from '../i18n';

// Ordre identique à l'EJS ; libellés via i18n (tkey).
const TABS = [
  { key: 'store',      tkey: 'nav_store',      lib: Ionicons,               icon: 'storefront' },
  { key: 'collection', tkey: 'nav_collection', lib: MaterialCommunityIcons, icon: 'notebook' },
  { key: 'add',        tkey: 'nav_add',        lib: Ionicons,               icon: 'search' },
  { key: 'quiz',       tkey: 'nav_quiz',       lib: MaterialCommunityIcons, icon: 'pencil-box' },
  { key: 'duels',      tkey: 'nav_duels',      lib: Ionicons,               icon: 'game-controller' },
];

const ACTIVE = COLORS.jiayou;     // #0d6efd
const INACTIVE = COLORS.muted;    // #6c757d
const RADIUS = 28;                // bouts bien arrondis

// NB: pas de BlurView ici. `expo-blur` est bundlé dans le JS mais son module NATIF
// n'existe pas dans les builds ≤ 10 : require() réussit (donc un try/catch ne
// protège de rien), et c'est le RENDU de <BlurView> qui crashe au démarrage
// (composant natif ExpoBlurView introuvable). On garde donc un fond blanc
// translucide, servable en OTA sans risque. Le vrai verre dépoli sera réactivé
// dans un prochain build natif, où le module ExpoBlur sera réellement présent.

// Barre d'onglets FLOTTANTE : pilule arrondie détachée des bords (ne touche ni les
// coins arrondis ni l'indicateur home). Fond blanc translucide.
export default function TabBar({ active, onChange }) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const maxWidth = width >= 992 ? 560 : undefined;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        paddingHorizontal: 14, paddingBottom: Math.max(insets.bottom, 12) + 8, paddingTop: 14,
      }}
    >
      {/* Couche d'OMBRE (pas d'overflow, sinon l'ombre iOS serait rognée). */}
      <View
        style={{
          alignSelf: 'center', width: '100%', maxWidth, borderRadius: RADIUS,
          shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 8,
        }}
      >
        {/* Couche qui CLIPPE le fond flou aux coins arrondis + porte les onglets. */}
        <View
          style={{
            flexDirection: 'row', height: 62, alignItems: 'center', paddingHorizontal: 6,
            borderRadius: RADIUS, overflow: 'hidden',
            // Blanc translucide uniforme (plus de bande blanche).
            backgroundColor: 'rgba(255,255,255,0.85)',
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)',
          }}
        >
          {TABS.map((tab) => {
            const on = active === tab.key;
            const Icon = tab.lib;

            // Onglet "Add Word" : bouton + façon TikTok, sans libellé.
            if (tab.key === 'add') {
              return (
                <Pressable key={tab.key} onPress={() => onChange(tab.key)} style={{ flex: 1, height: 50, alignItems: 'center', justifyContent: 'center' }}>
                  {/* Sélectionné : bleu plein, + blanc. Sinon : tuile bleu clair, + bleu. */}
                  <View style={{ width: 52, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? ACTIVE : COLORS.jiayouContainer }}>
                    <Ionicons name="add" size={26} color={on ? '#fff' : ACTIVE} />
                  </View>
                </Pressable>
              );
            }

            return (
              <Pressable
                key={tab.key}
                onPress={() => onChange(tab.key)}
                style={{ flex: 1, height: 50, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 16, backgroundColor: on ? COLORS.jiayouContainer : 'transparent' }}
              >
                <Icon name={tab.icon} size={21} color={on ? ACTIVE : INACTIVE} />
                <Text style={{ fontSize: 10.5, fontWeight: on ? '700' : '500', color: on ? ACTIVE : INACTIVE }}>
                  {t(tab.tkey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
