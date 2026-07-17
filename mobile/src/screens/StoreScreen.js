import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, Pressable, ActivityIndicator, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from '../components/Popup';
import { getMe, getMarketPacks, getMarketPack, buyMarketPack } from '../api';
import { COLORS, SHADOW_CARD } from '../theme';

// Illustration fictive : fond bleu pâle uniforme + idéogramme du niveau HSK.
const HSK_GLYPH = { hsk1: '一', hsk2: '二', hsk3: '三', hsk4: '四', hsk5: '五', hsk6: '六' };
const glyphOf = (k) => HSK_GLYPH[k] || '汉';
const COVER_BG = '#e8f0ff';
const COVER_FG = '#5b8def';

function PackCard({ pack, onPress }) {
  const soon = (pack.word_count || 0) === 0;
  return (
    <Pressable onPress={soon ? undefined : () => onPress(pack)} style={{ flex: 1, marginBottom: 18, opacity: soon ? 0.75 : 1 }}>
      <View style={{ backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', ...SHADOW_CARD }}>
        {/* Illustration fictive (bleu pâle) */}
        <View style={{ height: 72, backgroundColor: COVER_BG, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 32, fontWeight: '700', color: COVER_FG }}>{glyphOf(pack.cover_key)}</Text>
          {pack.owned ? (
            <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: COLORS.success, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>Owned</Text>
            </View>
          ) : null}
        </View>
        {/* Infos */}
        <View style={{ padding: 11 }}>
          <Text numberOfLines={2} style={{ fontSize: 14, fontWeight: '700', color: '#1a1a2e', minHeight: 36 }}>{pack.title}</Text>
          <Text numberOfLines={1} style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>by {pack.creator}</Text>
          {soon ? (
            <View style={{ alignSelf: 'flex-start', backgroundColor: '#f1f3f5', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 10 }}>
              <Text style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: '600' }}>Soon available</Text>
            </View>
          ) : (
            <>
              <Text style={{ fontSize: 11.5, color: COLORS.mutedLight, marginTop: 8 }}>
                {pack.word_count} words · {pack.sales_count || 0} bought
              </Text>
              <Text style={{ fontSize: 15, fontWeight: '800', color: COLORS.jiayou, marginTop: 3 }}>
                {pack.price === 0 ? 'Free' : `${pack.price} ₵`}
              </Text>
            </>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export default function StoreScreen({ onBack }) {
  const [me, setMe] = useState(null);
  const [packs, setPacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null); // { loading, pack, preview, buying, msg, error }

  const balance = me?.balance;

  const fetchPacks = useCallback(async () => {
    setError('');
    try {
      const d = await getMarketPacks({ sort: 'price_asc' });
      setPacks(d.packs || []);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { getMe().then(setMe).catch(() => {}); fetchPacks(); }, [fetchPacks]);

  async function openPack(p) {
    setSelected({ loading: true, pack: p });
    try {
      const d = await getMarketPack(p.id);
      setSelected({ loading: false, pack: d.pack, preview: d.preview });
    } catch (e) {
      setSelected({ loading: false, pack: p, error: e.message });
    }
  }

  async function doBuy() {
    if (!selected?.pack) return;
    const id = selected.pack.id;
    setSelected((s) => ({ ...s, buying: true, error: '' }));
    try {
      const d = await buyMarketPack(id);
      setMe((m) => ({ ...m, balance: d.newBalance }));
      setPacks((list) => list.map((p) => (p.id === id ? { ...p, owned: true, sales_count: (p.sales_count || 0) + 1 } : p)));
      setSelected((s) => ({
        ...s, buying: false,
        pack: { ...s.pack, owned: true },
        msg: `Added to your collection — ${d.wordsAdded} new word${d.wordsAdded === 1 ? '' : 's'}!`,
      }));
    } catch (e) {
      setSelected((s) => ({ ...s, buying: false, error: e.message }));
    }
  }

  const Hero = (
    <View style={{ backgroundColor: COLORS.jiayou, paddingTop: 16, paddingBottom: 20, paddingHorizontal: 16 }}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 }}>
          <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.9)" />
          <Text style={{ color: 'rgba(255,255,255,0.9)', fontWeight: '600' }}>Back</Text>
        </Pressable>
      ) : null}
      <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800' }}>JiaStore</Text>
      <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 }}>Word packs to grow your vocabulary</Text>
    </View>
  );

  // Colonnes égales même en nombre impair : on complète avec un item "vide".
  const gridData = packs.length % 2 === 1 ? [...packs, { id: '__spacer__', _spacer: true }] : packs;

  const sel = selected;
  const selPack = sel?.pack;
  const canBuy = selPack && !selPack.owned && !selPack.isMine && (selPack.word_count || 0) > 0
    && balance != null && balance >= selPack.price;

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      {Hero}
      <FlatList
        data={gridData}
        keyExtractor={(p) => String(p.id)}
        numColumns={2}
        columnWrapperStyle={{ gap: 18 }}
        contentContainerStyle={{ width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 30 }}
        renderItem={({ item }) =>
          item._spacer ? <View style={{ flex: 1 }} /> : <PackCard pack={item} onPress={openPack} />
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

      {/* ── Détail d'un pack ── */}
      <Popup visible={!!selected} onClose={() => setSelected(null)} maxWidth={420}>
        {sel?.loading ? (
          <ActivityIndicator color={COLORS.jiayou} style={{ marginVertical: 30 }} />
        ) : selPack ? (
          <View>
            <View style={{ height: 84, borderRadius: 14, backgroundColor: COVER_BG, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
              <Text style={{ fontSize: 40, fontWeight: '700', color: COVER_FG }}>{glyphOf(selPack.cover_key)}</Text>
            </View>
            <Text style={{ fontSize: 19, fontWeight: '800', color: '#1a1a2e' }}>{selPack.title}</Text>
            <Text style={{ fontSize: 13, color: COLORS.muted, marginTop: 2 }}>
              by {selPack.creator} · {selPack.word_count} words · {selPack.sales_count || 0} bought
            </Text>
            {selPack.description ? (
              <Text style={{ fontSize: 13.5, color: '#444', marginTop: 10, lineHeight: 19 }}>{selPack.description}</Text>
            ) : null}

            {/* Aperçu des mots */}
            {sel.preview?.length ? (
              <View style={{ marginTop: 14, backgroundColor: '#f8f9fa', borderRadius: 12, padding: 10 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.mutedLight, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Preview</Text>
                {sel.preview.map((w, i) => (
                  <View key={w.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5, borderBottomWidth: i === sel.preview.length - 1 ? 0 : 1, borderColor: '#eceef1' }}>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: '#1a1a2e', minWidth: 42 }}>{w.chinese}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, color: '#1a1a2e' }} numberOfLines={1}>{w.english}</Text>
                      <Text style={{ fontSize: 11.5, color: COLORS.muted }}>{w.pinyin}</Text>
                    </View>
                  </View>
                ))}
                {selPack.word_count > sel.preview.length ? (
                  <Text style={{ fontSize: 11.5, color: COLORS.mutedLight, marginTop: 6 }}>+ {selPack.word_count - sel.preview.length} more…</Text>
                ) : null}
              </View>
            ) : null}

            {sel.msg ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#e8f5e9', borderRadius: 12, padding: 12, marginTop: 14 }}>
                <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
                <Text style={{ flex: 1, fontSize: 13.5, color: '#1b5e20', fontWeight: '600' }}>{sel.msg}</Text>
              </View>
            ) : null}
            {sel.error ? (
              <Text style={{ color: COLORS.danger, fontSize: 13, fontWeight: '600', marginTop: 12 }}>{sel.error}</Text>
            ) : null}

            {/* CTA */}
            {sel.msg || selPack.owned ? (
              <View style={{ marginTop: 16, backgroundColor: '#e9ecef', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
                <Text style={{ color: COLORS.muted, fontWeight: '700' }}>✓ In your collection</Text>
              </View>
            ) : (selPack.word_count || 0) === 0 ? (
              <View style={{ marginTop: 16, backgroundColor: '#e9ecef', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
                <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Coming soon</Text>
              </View>
            ) : (
              <Pressable
                onPress={doBuy}
                disabled={sel.buying || !canBuy}
                style={{ marginTop: 16, borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, backgroundColor: canBuy ? COLORS.jiayou : '#e9ecef' }}
              >
                {sel.buying ? <ActivityIndicator color="#fff" size="small" /> : (
                  <>
                    <Ionicons name="cart" size={16} color={canBuy ? '#fff' : COLORS.muted} />
                    <Text style={{ color: canBuy ? '#fff' : COLORS.muted, fontWeight: '700', fontSize: 15 }}>
                      {canBuy ? `Buy for ${selPack.price} ₵` : 'Not enough coins'}
                    </Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
        ) : null}
      </Popup>
    </View>
  );
}
