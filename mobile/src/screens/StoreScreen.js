import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PackMarket from '../components/PackMarket';
import { useT } from '../i18n';
import { COLORS } from '../theme';

// JiaStore : hero + marketplace de packs (grille + achat via PackMarket).
export default function StoreScreen({ onBack, onCreate, onStartQuiz, onEditPack }) {
  const { t } = useT();
  const Hero = (
    <View style={{ paddingTop: 14, paddingBottom: 24 }}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
          <Ionicons name="chevron-back" size={20} color={COLORS.jiayou} />
          <Text style={{ color: COLORS.jiayou, fontWeight: '600' }}>{t('common_back')}</Text>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#1a1a2e', fontSize: 22, fontWeight: '800' }}>{t('nav_store')}</Text>
          <Text style={{ color: COLORS.muted, fontSize: 13, marginTop: 2 }}>{t('st_subtitle')}</Text>
        </View>
        {onCreate ? (
          <Pressable
            onPress={onCreate}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 }}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{t('st_sell_pack')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      {/* Hero = en-tête scrollable de la grille (ne reste plus fixe en haut). */}
      <PackMarket ListHeaderComponent={Hero} onStartQuiz={onStartQuiz} onEditPack={onEditPack} />
    </View>
  );
}
