import { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator, FlatList } from 'react-native';
import { getMe, getMarketPacks } from '../api';
import { COLORS, SHADOW_CARD, TAB_CLEARANCE } from '../theme';
import PackDetailPopup, { glyphOf, COVER_BG, COVER_FG } from './PackDetailPopup';

function PackCard({ pack, onPress }) {
  const soon = (pack.word_count || 0) === 0;
  return (
    <Pressable onPress={soon ? undefined : () => onPress(pack)} style={{ flex: 1, marginBottom: 18, opacity: soon ? 0.75 : 1 }}>
      <View style={{ backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', ...SHADOW_CARD }}>
        <View style={{ height: 72, backgroundColor: COVER_BG, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 32, fontWeight: '700', color: COVER_FG }}>{glyphOf(pack.cover_key)}</Text>
          {pack.owned ? (
            <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: COLORS.success, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>Owned</Text>
            </View>
          ) : null}
        </View>
        <View style={{ padding: 11 }}>
          {/* Titre */}
          <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '800', color: '#1a1a2e' }}>{pack.title}</Text>
          {/* Stats du pack, juste sous le titre */}
          <Text numberOfLines={1} style={{ fontSize: 11.5, color: COLORS.mutedLight, marginTop: 2 }}>
            {pack.word_count} words · {pack.sales_count || 0} bought
          </Text>

          {soon ? (
            <View style={{ alignSelf: 'flex-start', backgroundColor: '#f1f3f5', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 10 }}>
              <Text style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: '600' }}>Soon available</Text>
            </View>
          ) : (
            <>
              {/* Début de description (2 lignes) */}
              <Text numberOfLines={2} style={{ fontSize: 12, color: COLORS.muted, lineHeight: 16, marginTop: 7, minHeight: 32 }}>
                {pack.description || 'No description'}
              </Text>
              {/* Prix ↔ créateur */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 9 }}>
                <Text style={{ fontSize: 15, fontWeight: '800', color: COLORS.jiayou }}>
                  {pack.price === 0 ? 'Free' : `${pack.price} ₵`}
                </Text>
                <Text numberOfLines={1} style={{ flexShrink: 1, marginLeft: 8, fontSize: 11.5, color: COLORS.muted, textAlign: 'right' }}>
                  by {pack.creator}
                </Text>
              </View>
            </>
          )}
        </View>
      </View>
    </Pressable>
  );
}

// Grille 2 colonnes des packs JiaStore + popup de détail (PackDetailPopup).
// Réutilisable (store, onboarding). `extraTile` = un nœud injecté dans la grille
// à `extraTileAt` (index 0-based). `onStartQuiz(pack)` = lance un quiz sur un
// pack possédé (bouton dans le popup).
export default function PackMarket({
  extraTile = null,
  extraTileAt = null,
  ListHeaderComponent = null,
  ListFooterComponent = null,
  contentContainerStyle,
  onBalance,
  onStartQuiz,
  onEditPack,
}) {
  const [me, setMe] = useState(null);
  const [packs, setPacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null); // résumé du pack ouvert

  const fetchPacks = useCallback(async () => {
    setError('');
    try {
      const d = await getMarketPacks({ sort: 'price_asc' });
      setPacks(d.packs || []);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    getMe().then((u) => { setMe(u); onBalance?.(u?.balance); }).catch(() => {});
    fetchPacks();
  }, [fetchPacks, onBalance]);

  // Après achat : maj solde + carte de la grille.
  function onBought(id, d) {
    setMe((m) => ({ ...m, balance: d.newBalance }));
    onBalance?.(d.newBalance);
    setPacks((list) => list.map((p) => (p.id === id ? { ...p, owned: true, sales_count: (p.sales_count || 0) + 1 } : p)));
    setSelected((s) => (s ? { ...s, owned: true } : s));
  }

  // Construit la grille : packs + tuile injectée + spacer pour égaliser les colonnes.
  const items = [...packs];
  if (extraTile) items.splice(Math.min(extraTileAt ?? items.length, items.length), 0, { id: '__extra__', _extra: true });
  const gridData = items.length % 2 === 1 ? [...items, { id: '__spacer__', _spacer: true }] : items;

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={gridData}
        keyExtractor={(p) => String(p.id)}
        numColumns={2}
        columnWrapperStyle={{ gap: 18 }}
        contentContainerStyle={contentContainerStyle || { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: TAB_CLEARANCE }}
        ListHeaderComponent={ListHeaderComponent}
        ListFooterComponent={ListFooterComponent}
        renderItem={({ item }) =>
          item._spacer ? <View style={{ flex: 1 }} />
            : item._extra ? extraTile
              : <PackCard pack={item} onPress={setSelected} />
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={COLORS.jiayou} style={{ marginTop: 30 }} />
          ) : error ? (
            <Text style={{ textAlign: 'center', color: COLORS.danger, marginTop: 30 }}>{error}</Text>
          ) : (
            <Text style={{ textAlign: 'center', color: COLORS.muted, marginTop: 40 }}>No packs yet.</Text>
          )
        }
      />

      <PackDetailPopup
        pack={selected}
        balance={me?.balance}
        onClose={() => setSelected(null)}
        onBought={onBought}
        onStartQuiz={onStartQuiz ? (p) => { setSelected(null); onStartQuiz(p); } : undefined}
        onEditPack={onEditPack ? (d) => { setSelected(null); onEditPack(d); } : undefined}
      />
    </View>
  );
}
