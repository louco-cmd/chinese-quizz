import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, ScrollView, Pressable, ActivityIndicator, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Popup from '../components/Popup';
import { getMe, getMarketPacks, getMarketPack, buyMarketPack } from '../api';
import { COLORS, SHADOW_CARD } from '../theme';

// Illustrations fictives : chaque cover_key → dégradé + emoji.
const COVERS = {
  hsk1:     { colors: ['#0d6efd', '#6610f2'], glyph: '一' },
  hsk2:     { colors: ['#198754', '#0d5c38'], glyph: '二' },
  hsk3:     { colors: ['#0dcaf0', '#0a83a0'], glyph: '三' },
  food:     { colors: ['#ff7e5f', '#feb47b'], glyph: '🍜' },
  travel:   { colors: ['#2193b0', '#6dd5ed'], glyph: '✈️' },
  business: { colors: ['#434343', '#4b6cb7'], glyph: '💼' },
  street:   { colors: ['#8e2de2', '#e94dc0'], glyph: '🛵' },
  verbs:    { colors: ['#f7971e', '#ffd200'], glyph: '⚡' },
  _default: { colors: ['#6c757d', '#495057'], glyph: '📦' },
};
const coverOf = (k) => COVERS[k] || COVERS._default;

const SORTS = [
  { key: 'recent', label: 'Recent' },
  { key: 'popular', label: 'Popular' },
  { key: 'price_asc', label: 'Price ↑' },
  { key: 'price_desc', label: 'Price ↓' },
];
const PRICE_FILTERS = [
  { key: '', label: 'All' },
  { key: '100', label: '≤ 100' },
  { key: '200', label: '≤ 200' },
  { key: '300', label: '≤ 300' },
];

function Chip({ label, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, marginRight: 8,
        backgroundColor: active ? COLORS.jiayou : '#fff',
        borderWidth: 1, borderColor: active ? COLORS.jiayou : COLORS.line,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : COLORS.muted }}>{label}</Text>
    </Pressable>
  );
}

function PackCard({ pack, onPress }) {
  const c = coverOf(pack.cover_key);
  return (
    <Pressable onPress={() => onPress(pack)} style={{ flex: 1, marginBottom: 14 }}>
      <View style={{ backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', ...SHADOW_CARD }}>
        {/* Illustration fictive */}
        <LinearGradient colors={c.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 104, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 40 }}>{c.glyph}</Text>
          {pack.is_official ? (
            <View style={{ position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Ionicons name="shield-checkmark" size={11} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>Official</Text>
            </View>
          ) : null}
          {pack.owned ? (
            <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: COLORS.success, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>Owned</Text>
            </View>
          ) : null}
        </LinearGradient>
        {/* Infos */}
        <View style={{ padding: 11 }}>
          <Text numberOfLines={2} style={{ fontSize: 14, fontWeight: '700', color: '#1a1a2e', minHeight: 36 }}>{pack.title}</Text>
          <Text numberOfLines={1} style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>by {pack.creator}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: COLORS.jiayou }}>
              {pack.price === 0 ? 'Free' : `${pack.price} ₵`}
            </Text>
            <Text style={{ fontSize: 11.5, color: COLORS.mutedLight }}>{pack.word_count} words</Text>
          </View>
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

  const [q, setQ] = useState('');
  const [sort, setSort] = useState('recent');
  const [priceMax, setPriceMax] = useState('');

  const [selected, setSelected] = useState(null); // { loading, pack, preview, buying, msg, error }

  const balance = me?.balance;

  const fetchPacks = useCallback(async (opts) => {
    setError('');
    try {
      const d = await getMarketPacks(opts);
      setPacks(d.packs || []);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { getMe().then(setMe).catch(() => {}); }, []);

  // Recherche debouncée ; tri/prix immédiats.
  const debounce = useRef(null);
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      fetchPacks({ q, sort, max: priceMax });
    }, q ? 300 : 0);
    return () => clearTimeout(debounce.current);
  }, [q, sort, priceMax, fetchPacks]);

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
      setPacks((list) => list.map((p) => (p.id === id ? { ...p, owned: true } : p)));
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
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800' }}>JiaStore</Text>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 }}>Word packs by the community</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Ionicons name="wallet" size={14} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{balance == null ? '…' : `${balance} ₵`}</Text>
        </View>
      </View>
    </View>
  );

  const Filters = (
    <View style={{ marginBottom: 4 }}>
      {/* Recherche */}
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 999, borderWidth: 1, borderColor: COLORS.line, paddingHorizontal: 14, marginBottom: 12 }}>
        <Ionicons name="search" size={16} color={COLORS.mutedLight} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search packs, creators…"
          placeholderTextColor={COLORS.mutedLight}
          autoCapitalize="none"
          style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 8, fontSize: 14.5 }}
        />
        {q ? (
          <Pressable onPress={() => setQ('')} hitSlop={8}><Ionicons name="close-circle" size={16} color={COLORS.mutedLight} /></Pressable>
        ) : null}
      </View>
      {/* Tri */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        {SORTS.map((s) => <Chip key={s.key} label={s.label} active={sort === s.key} onPress={() => setSort(s.key)} />)}
      </ScrollView>
      {/* Filtre prix */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
        {PRICE_FILTERS.map((f) => <Chip key={f.key} label={f.label} active={priceMax === f.key} onPress={() => setPriceMax(f.key)} />)}
      </ScrollView>
    </View>
  );

  const sel = selected;
  const selPack = sel?.pack;
  const cover = selPack ? coverOf(selPack.cover_key) : null;
  const canBuy = selPack && !selPack.owned && !selPack.isMine && balance != null && balance >= selPack.price;

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      {Hero}
      <FlatList
        data={packs}
        keyExtractor={(p) => String(p.id)}
        numColumns={2}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{ width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 30 }}
        ListHeaderComponent={Filters}
        renderItem={({ item }) => <PackCard pack={item} onPress={openPack} />}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={COLORS.jiayou} style={{ marginTop: 30 }} />
          ) : error ? (
            <Text style={{ textAlign: 'center', color: COLORS.danger, marginTop: 30 }}>{error}</Text>
          ) : (
            <View style={{ alignItems: 'center', marginTop: 40 }}>
              <Ionicons name="search" size={34} color={COLORS.mutedLight} />
              <Text style={{ color: COLORS.muted, marginTop: 10 }}>No pack matches your search.</Text>
            </View>
          )
        }
      />

      {/* ── Détail d'un pack ── */}
      <Popup visible={!!selected} onClose={() => setSelected(null)} maxWidth={420}>
        {sel?.loading ? (
          <ActivityIndicator color={COLORS.jiayou} style={{ marginVertical: 30 }} />
        ) : selPack ? (
          <View>
            <LinearGradient colors={cover.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 96, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
              <Text style={{ fontSize: 44 }}>{cover.glyph}</Text>
            </LinearGradient>
            <Text style={{ fontSize: 19, fontWeight: '800', color: '#1a1a2e' }}>{selPack.title}</Text>
            <Text style={{ fontSize: 13, color: COLORS.muted, marginTop: 2 }}>
              by {selPack.creator} · {selPack.word_count} words · {selPack.sales_count || 0} sold
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

            {/* CTA achat */}
            {sel.msg || selPack.owned ? (
              <View style={{ marginTop: 16, backgroundColor: '#e9ecef', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
                <Text style={{ color: COLORS.muted, fontWeight: '700' }}>✓ In your collection</Text>
              </View>
            ) : selPack.isMine ? (
              <View style={{ marginTop: 16, backgroundColor: '#e9ecef', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
                <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Your pack</Text>
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
                      {canBuy
                        ? (selPack.price === 0 ? 'Get for free' : `Buy for ${selPack.price} ₵`)
                        : 'Not enough coins'}
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
