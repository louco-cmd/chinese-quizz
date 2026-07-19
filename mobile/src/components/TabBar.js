import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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

export default function TabBar({ active, onChange }) {
  const { t } = useT();
  // En desktop, on centre les boutons (max-width) au lieu de les étirer.
  const { width } = useWindowDimensions();
  const maxWidth = width >= 992 ? 600 : undefined;
  return (
    <SafeAreaView edges={['bottom']} style={{ backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#dee2e6' }}>
      <View style={{ flexDirection: 'row', height: 65, alignItems: 'center', width: '100%', maxWidth, alignSelf: 'center' }}>
        {TABS.map((tab) => {
          const on = active === tab.key;
          const Icon = tab.lib;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onChange(tab.key)}
              style={{
                flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', gap: 4,
                backgroundColor: on ? COLORS.jiayouContainer : 'transparent',
              }}
            >
              <Icon name={tab.icon} size={22} color={on ? ACTIVE : INACTIVE} />
              <Text style={{ fontSize: 11, fontWeight: '500', color: on ? ACTIVE : INACTIVE }}>
                {t(tab.tkey)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}
