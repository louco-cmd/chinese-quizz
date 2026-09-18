import { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator, FlatList, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getMe, getMarketPacks } from '../api';
import { useT } from '../i18n';
import { COLORS, SHADOW_CARD, TAB_CLEARANCE } from '../theme';
import PackDetailPopup, { glyphOf, COVER_BG, COVER_FG, OwnedProgress, isPremiumPack } from './PackDetailPopup';
import CatLoader from './CatLoader';
import { ErrorRetry } from './ErrorRetry';

function PackCard({ pack, onPress }) {
  const { t } = useT();
  const soon = (pack.word_count || 0) === 0;
  return (
    <Pressable onPress={soon ? undefined : () => onPress(pack)} style={{ flex: 1, marginBottom: 18, opacity: soon ? 0.75 : 1 }}>
      <View style={{ backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', ...SHADOW_CARD }}>
        <View style={{ height: 72, backgroundColor: COVER_BG, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 32, fontWeight: '700', color: COVER_FG }}>{glyphOf(pack.cover_key)}</Text>
          {pack.owned ? (
            <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: COLORS.success, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{t('st_owned')}</Text>
            </View>
          ) : null}
          {/* Coin haut-gauche : badge Premium (prioritaire) sinon Nouveauté (<7j). */}
          {isPremiumPack(pack) ? (
            <View style={{ position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#f5b301', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Ionicons name="star" size={10} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{t('st_premium_tag')}</Text>
            </View>
          ) : pack.is_new ? (
            <View style={{ position: 'absolute', top: 8, left: 8, backgroundColor: '#ff6b35', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{t('st_new')}</Text>
            </View>
          ) : null}
          {/* Jauge de part possédée, bas-droite — masquée si le pack est déjà acheté. */}
          {!pack.owned ? <OwnedProgress owned={pack.owned_words} total={pack.word_count} /> : null}
        </View>
        <View style={{ padding: 11 }}>
          {/* Titre */}
          <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '800', color: '#1a1a2e' }}>{pack.title}</Text>
          {/* Stats du pack, juste sous le titre */}
          <Text numberOfLines={1} style={{ fontSize: 11.5, color: COLORS.mutedLight, marginTop: 2 }}>
            {pack.word_count} {t('st_words')} · {pack.sales_count || 0} {t('st_bought')}
          </Text>

          {soon ? (
            <View style={{ alignSelf: 'flex-start', backgroundColor: '#f1f3f5', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 10 }}>
              <Text style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: '600' }}>{t('st_soon')}</Text>
            </View>
          ) : (
            <>
              {/* Début de description (2 lignes) */}
              <Text numberOfLines={2} style={{ fontSize: 12, color: COLORS.muted, lineHeight: 16, marginTop: 7, minHeight: 32 }}>
                {pack.description || t('st_no_desc')}
              </Text>
              {/* Prix ↔ créateur (prix barré + remisé si promo active) */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 9 }}>
                {pack.price !== 0 && pack.boosted && (pack.discount_pct || 0) > 0 && pack.effective_price < pack.price ? (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 5 }}>
                    <Text style={{ fontSize: 12, color: COLORS.mutedLight, textDecorationLine: 'line-through' }}>{pack.price}</Text>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: COLORS.success }}>{pack.effective_price} ₵</Text>
                  </View>
                ) : (
                  <Text style={{ fontSize: 15, fontWeight: '800', color: COLORS.jiayou }}>
                    {pack.price === 0 ? t('st_free') : `${pack.price} ₵`}
                  </Text>
                )}
                <Text numberOfLines={1} style={{ flexShrink: 1, marginLeft: 8, fontSize: 11.5, color: COLORS.muted, textAlign: 'right' }}>
                  {t('st_by')} {pack.creator}
                </Text>
              </View>
            </>
          )}
        </View>
      </View>
    </Pressable>
  );
}

// Carte « mise en avant » (pack boosté) : large, pleine largeur, posée au-dessus
// de la grille. Cover ronde à gauche, titre + prix, description, CTA + créateur.
function FeaturedPackCard({ pack, onPress }) {
  const { t } = useT();
  return (
    <Pressable onPress={() => onPress(pack)} style={{ marginBottom: 14 }}>
      <View style={{ backgroundColor: '#fff', borderRadius: 18, padding: 14, ...SHADOW_CARD }}>
        <View style={{ position: 'absolute', top: 10, right: 12, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#fff7e6', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
          <Ionicons name="megaphone" size={10} color="#b3820a" />
          <Text style={{ color: '#b3820a', fontSize: 10, fontWeight: '800' }}>{t('st_sponsored')}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <View style={{ width: 92, height: 92, borderRadius: 46, backgroundColor: COVER_BG, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 40, fontWeight: '700', color: COVER_FG }}>{glyphOf(pack.cover_key)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, paddingRight: 70 }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, fontWeight: '800', color: '#1a1a2e' }}>{pack.title}</Text>
            </View>
            <Text numberOfLines={2} style={{ fontSize: 12.5, color: COLORS.muted, lineHeight: 17, marginTop: 6, minHeight: 34 }}>
              {pack.description || t('st_no_desc')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12 }}>
              <View style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16 }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{t('st_discover')}</Text>
              </View>
              <View style={{ flexShrink: 1, alignItems: 'flex-end' }}>
                {pack.price !== 0 && pack.boosted && (pack.discount_pct || 0) > 0 && pack.effective_price < pack.price ? (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 5 }}>
                    <Text style={{ fontSize: 12, color: COLORS.mutedLight, textDecorationLine: 'line-through' }}>{pack.price}</Text>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: COLORS.success }}>{pack.effective_price} ₵</Text>
                  </View>
                ) : (
                  <Text style={{ fontSize: 15, fontWeight: '800', color: COLORS.jiayou }}>{pack.price === 0 ? t('st_free') : `${pack.price} ₵`}</Text>
                )}
                <Text numberOfLines={1} style={{ fontSize: 11, color: COLORS.muted }}>{t('st_by')} {pack.creator}</Text>
              </View>
            </View>
          </View>
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
  onUpgrade,       // free qui ouvre un pack premium → propose l'upgrade (via popup)
  extraBottomPad = 0, // marge basse en plus (ex. dégager un FAB flottant)
  maxPrice = null, // si défini, n'affiche que les packs coûtant strictement moins (onboarding)
  columns = null,  // force le nombre de colonnes (sinon auto selon la largeur fenêtre)
  search = '',     // recherche texte (q)
  sort = 'featured', // tri : featured | recent | popular | price_asc | price_desc
  learningLang = null, // langue apprise (override du profil, ex. onboarding)
  baseLang = null,     // langue de base / native (override du profil)
}) {
  const { t } = useT();
  const [me, setMe] = useState(null);
  const [packs, setPacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null); // résumé du pack ouvert

  const fetchPacks = useCallback(async () => {
    setError('');
    try {
      const d = await getMarketPacks({ q: search, sort, learning: learningLang || '', native: baseLang || '' });
      setPacks(d.packs || []);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [search, sort, learningLang, baseLang]);

  // Solde : une seule fois au montage.
  useEffect(() => {
    getMe().then((u) => { setMe(u); onBalance?.(u?.balance); }).catch(() => {});
  }, [onBalance]);

  // Packs : (re)chargés quand la recherche/tri change, avec un léger debounce.
  // On ne remet PAS loading à true ici → les résultats actuels restent affichés
  // jusqu'à l'arrivée des nouveaux (pas de clignotement du loader en tapant).
  useEffect(() => {
    const timer = setTimeout(fetchPacks, 250);
    return () => clearTimeout(timer);
  }, [fetchPacks]);

  // Après achat : maj solde + carte de la grille.
  function onBought(id, d) {
    setMe((m) => ({ ...m, balance: d.newBalance }));
    onBalance?.(d.newBalance);
    setPacks((list) => list.map((p) => (p.id === id ? { ...p, owned: true, sales_count: (p.sales_count || 0) + 1 } : p)));
    setSelected((s) => (s ? { ...s, owned: true } : s));
  }

  // 3 colonnes en desktop, 2 sinon. La grille se réajuste avec la fenêtre.
  const { width } = useWindowDimensions();
  const numColumns = columns || (width >= 992 ? 3 : 2);

  // Construit la grille : packs (filtrés par prix si maxPrice) + tuile injectée +
  // spacers pour compléter la dernière rangée (multiple de numColumns).
  const visiblePacks = maxPrice == null ? packs : packs.filter((p) => (p.price || 0) < maxPrice);
  // Packs boostés → cartes « mises en avant » au-dessus de la grille (retirés de
  // la grille pour ne pas apparaître deux fois).
  const featured = visiblePacks.filter((p) => p.boosted);
  const items = visiblePacks.filter((p) => !p.boosted);
  // La tuile injectée (ex. « import manuel » de l'onboarding) n'apparaît qu'une
  // fois les packs chargés → sinon elle s'affichait seule avant le reste (et des
  // users impatients cliquaient dessus). Pendant `loading`, la grille reste vide
  // → le CatLoader du ListEmptyComponent s'affiche.
  if (extraTile && !loading) items.splice(Math.min(extraTileAt ?? items.length, items.length), 0, { id: '__extra__', _extra: true });
  const remainder = items.length % numColumns;
  const gridData = remainder === 0
    ? items
    : [...items, ...Array.from({ length: numColumns - remainder }, (_, i) => ({ id: `__spacer_${i}__`, _spacer: true }))];

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={gridData}
        keyExtractor={(p) => String(p.id)}
        // `key` force le remontage quand le nombre de colonnes change (contrainte RN).
        key={numColumns}
        numColumns={numColumns}
        columnWrapperStyle={{ gap: 18 }}
        contentContainerStyle={contentContainerStyle || { flexGrow: 1, width: '100%', maxWidth: numColumns === 3 ? 980 : 720, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: TAB_CLEARANCE + extraBottomPad }}
        ListHeaderComponent={(
          <>
            {ListHeaderComponent}
            {featured.length && !loading ? (
              <View>{featured.map((p) => <FeaturedPackCard key={`feat-${p.id}`} pack={p} onPress={setSelected} />)}</View>
            ) : null}
          </>
        )}
        ListFooterComponent={ListFooterComponent}
        renderItem={({ item }) =>
          item._spacer ? <View style={{ flex: 1 }} />
            : item._extra ? extraTile
              : <PackCard pack={item} onPress={setSelected} />
        }
        ListEmptyComponent={
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }}>
            {loading ? (
              <CatLoader size={110} />
            ) : error ? (
              <ErrorRetry onRetry={fetchPacks} />
            ) : (['zh', 'en'].includes(learningLang || me?.learning_lang || 'zh') && ['zh', 'en'].includes(baseLang || me?.native_lang || 'en')) ? (
              <Text style={{ textAlign: 'center', color: COLORS.muted, fontSize: 15, paddingHorizontal: 24 }}>{t('st_no_packs')}</Text>
            ) : (
              // Les packs n'existent (traductions complètes) que pour la paire
              // chinois-depuis-anglais. Toute autre combinaison → titre + sous-titre
              // « bientôt » (le « aucun pack » reste pour zh/en + recherche vide).
              <View style={{ alignItems: 'center', paddingHorizontal: 28, maxWidth: 420 }}>
                <Text style={{ fontSize: 44, marginBottom: 14 }}>🚀</Text>
                <Text style={{ textAlign: 'center', color: COLORS.ink, fontSize: 18, fontWeight: '700', marginBottom: 8 }}>{t('st_packs_soon_title')}</Text>
                <Text style={{ textAlign: 'center', color: COLORS.muted, fontSize: 14, lineHeight: 20 }}>{t('st_packs_soon_sub')}</Text>
              </View>
            )}
          </View>
        }
      />

      <PackDetailPopup
        pack={selected}
        balance={me?.balance}
        isPremium={!!me?.isPremium}
        onUpgrade={onUpgrade}
        onClose={() => setSelected(null)}
        onBought={onBought}
        onPromoted={(id, d) => { setMe((m) => ({ ...m, balance: d.balance })); onBalance?.(d.balance); fetchPacks(); }}
        onForgotten={() => fetchPacks()}
        onStartQuiz={onStartQuiz ? (p) => { setSelected(null); onStartQuiz(p); } : undefined}
        onEditPack={onEditPack ? (d) => { setSelected(null); onEditPack(d); } : undefined}
      />
    </View>
  );
}
