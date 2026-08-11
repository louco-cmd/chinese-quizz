import { useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import PackMarket from '../components/PackMarket';
import { useT } from '../i18n';
import { COLORS } from '../theme';

// JiaStore : barre recherche/tri en haut + marketplace de packs (PackMarket).
// Bouton "Sell a pack" en FAB sticky (bas-droite).
// `navOverlaps` : true si la nav bar est en position absolute et recouvre le
// contenu (côté étudiant) → le FAB doit la franchir. False si la nav est un frère
// flex sous le contenu (côté prof) → le FAB n'a besoin que d'un petit écart.
export default function StoreScreen({ onBack, onCreate, onStartQuiz, onEditPack, onUpgrade, navOverlaps = true }) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('featured');

  const SORTS = [
    { value: 'featured', label: t('st_sort_featured') },
    { value: 'recent', label: t('st_sort_recent') },
    { value: 'popular', label: t('st_sort_popular') },
    { value: 'price_asc', label: t('st_sort_price_asc') },
    { value: 'price_desc', label: t('st_sort_price_desc') },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      {/* ── Barre filtre + recherche ── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 }}>
            <Ionicons name="chevron-back" size={20} color={COLORS.jiayou} />
            <Text style={{ color: COLORS.jiayou, fontWeight: '600' }}>{t('common_back')}</Text>
          </Pressable>
        ) : null}

        {/* Recherche */}
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 999, borderWidth: 1, borderColor: COLORS.line, paddingHorizontal: 14 }}>
          <Ionicons name="search" size={18} color={COLORS.mutedLight} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t('st_search')}
            placeholderTextColor={COLORS.mutedLight}
            autoCapitalize="none"
            style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 8, fontSize: 15, color: COLORS.ink }}
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={COLORS.mutedLight} />
            </Pressable>
          ) : null}
        </View>

        {/* Tri (chips) */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 8, paddingTop: 10, paddingRight: 8 }}
        >
          {SORTS.map((s) => {
            const active = sort === s.value;
            return (
              <Pressable
                key={s.value}
                onPress={() => setSort(s.value)}
                style={{
                  paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
                  backgroundColor: active ? COLORS.jiayou : '#fff',
                  borderWidth: 1, borderColor: active ? COLORS.jiayou : COLORS.line,
                }}
              >
                <Text style={{ color: active ? '#fff' : COLORS.muted, fontWeight: '700', fontSize: 13 }}>{s.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Grille de packs ── */}
      <PackMarket
        search={search}
        sort={sort}
        onStartQuiz={onStartQuiz}
        onEditPack={onEditPack}
        onUpgrade={onUpgrade}
        extraBottomPad={72}
      />

      {/* ── FAB "Sell a pack" sticky bas-droite ── */}
      {onCreate ? (
        <Pressable
          onPress={onCreate}
          style={{
            // Étudiant : nav absolute (~60px + safe-area) à franchir. Prof : nav
            // sous le contenu → simple petit écart. Même rendu visuel des deux côtés.
            position: 'absolute', right: 18, bottom: navOverlaps ? insets.bottom + 74 : 16,
            flexDirection: 'row', alignItems: 'center', gap: 6,
            backgroundColor: COLORS.jiayou, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 14,
            shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.28, shadowRadius: 12, elevation: 8,
          }}
        >
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>{t('st_sell_pack')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
