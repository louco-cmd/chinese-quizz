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

// Barre d'onglets FLOTTANTE (façon Telegram) : une pilule arrondie détachée des
// bords. Elle ne touche jamais les coins arrondis ni l'indicateur home de l'iPhone
// — ce qui corrige le rognage de l'ancienne barre collée au bas de l'écran.
export default function TabBar({ active, onChange }) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const maxWidth = width >= 992 ? 560 : undefined;

  return (
    // Wrapper transparent : le fond de page reste visible autour de la pilule.
    // On réserve l'inset bas (home indicator) + une marge, avec un minimum sur
    // les appareils sans inset (Android à boutons).
    <View
      pointerEvents="box-none"
      style={{ paddingHorizontal: 14, paddingBottom: Math.max(insets.bottom, 10) + 2, paddingTop: 6 }}
    >
      <View
        style={{
          flexDirection: 'row',
          height: 62,
          alignItems: 'center',
          alignSelf: 'center',
          width: '100%',
          maxWidth,
          backgroundColor: '#fff',
          borderRadius: 30,
          paddingHorizontal: 6,
          // Ombre portée douce pour l'effet "flottant".
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.12,
          shadowRadius: 16,
          elevation: 8,
        }}
      >
        {TABS.map((tab) => {
          const on = active === tab.key;
          const Icon = tab.lib;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onChange(tab.key)}
              style={{
                flex: 1, height: 50, alignItems: 'center', justifyContent: 'center', gap: 3,
                borderRadius: 24,
                // Surbrillance arrondie derrière l'onglet actif (le "pill" Telegram).
                backgroundColor: on ? COLORS.jiayouContainer : 'transparent',
              }}
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
  );
}
