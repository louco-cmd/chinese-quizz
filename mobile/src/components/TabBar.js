import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { useT } from '../i18n';
import NavBarLottie from './NavBarLottie';

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

// Barre d'onglets classique : aplat blanc PLEINE LARGEUR collé en bas, avec un
// simple filet de séparation en haut. Sur les écrans à safe-area (indicateur home,
// coins très arrondis) on ajoute un peu de respiration au-dessus de l'indicateur.
export default function TabBar({ active, onChange, showChar = false }) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const maxWidth = width >= 992 ? 560 : undefined;
  const bottomPad = insets.bottom > 0 ? insets.bottom + 6 : 12;

  return (
    <View
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        backgroundColor: '#fff',
        borderTopWidth: 1, borderTopColor: '#ececf0',
        paddingTop: 8, paddingBottom: bottomPad,
      }}
    >
      {/* Perso animé « posé » sur la barre (décoratif, pointerEvents none). */}
      {showChar ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: bottomPad - 6, alignItems: 'center' }}>
          <NavBarLottie size={220} />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignSelf: 'center', width: '100%', maxWidth, paddingHorizontal: 6 }}>
        {TABS.map((tab) => {
          const on = active === tab.key;
          const Icon = tab.lib;

          // Onglet "Add Word" : glyphe 加 + libellé "Jiayou", même format que les autres.
          if (tab.key === 'add') {
            return (
              <Pressable
                key={tab.key}
                onPress={() => onChange(tab.key)}
                style={{ flex: 1, height: 52, alignItems: 'center', justifyContent: 'center', gap: 3 }}
              >
                <Text style={{ fontSize: 23, fontWeight: '800', lineHeight: 25, color: on ? ACTIVE : INACTIVE }}>加</Text>
                <Text style={{ fontSize: 10.5, fontWeight: on ? '700' : '500', color: on ? ACTIVE : INACTIVE }}>Jiayou</Text>
              </Pressable>
            );
          }

          return (
            <Pressable
              key={tab.key}
              onPress={() => onChange(tab.key)}
              style={{ flex: 1, height: 52, alignItems: 'center', justifyContent: 'center', gap: 3 }}
            >
              <Icon name={tab.icon} size={22} color={on ? ACTIVE : INACTIVE} />
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
