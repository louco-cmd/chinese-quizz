import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Popup from '../components/Popup';
import { getMe, buyPack, buyBooster } from '../api';
import { COLORS, SHADOW_CARD } from '../theme';

const PACKS = [
  { level: 1, title: 'HSK 1 Pack', desc: '290 words from HSK level 1', price: 200, colors: ['#0d6efd', '#6610f2'], icon: 'star' },
  { level: 2, title: 'HSK 2 Pack', desc: 'Words from HSK level 2', price: 400, colors: ['#198754', '#0d5c38'], icon: 'star-half' },
];
const SOON = [3, 4, 5, 6];

function PackCard({ pack, balance, onBuy, busy }) {
  const poor = balance != null && balance < pack.price;
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 12, ...SHADOW_CARD }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <LinearGradient colors={pack.colors} style={{ width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={pack.icon} size={22} color="#fff" />
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#1a1a2e' }}>{pack.title}</Text>
          <Text style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 1 }}>{pack.desc}</Text>
        </View>
      </View>
      <Pressable
        onPress={() => onBuy(pack)}
        disabled={busy || poor}
        style={{ marginTop: 12, borderRadius: 10, paddingVertical: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, backgroundColor: poor ? '#e9ecef' : COLORS.jiayou }}
      >
        {busy ? <ActivityIndicator color="#fff" size="small" /> : (
          <>
            <Ionicons name="cart" size={15} color={poor ? COLORS.muted : '#fff'} />
            <Text style={{ color: poor ? COLORS.muted : '#fff', fontWeight: '700', fontSize: 13.5 }}>
              {poor ? 'Not enough coins' : `Buy for ${pack.price} ₵`}
            </Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

function SoonCard({ level }) {
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 12, opacity: 0.7, ...SHADOW_CARD }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <LinearGradient colors={['#6c757d', '#495057']} style={{ width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="lock-closed" size={20} color="#fff" />
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.muted }}>HSK {level} Pack</Text>
          <Text style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 1 }}>Words from HSK {level} level</Text>
        </View>
        <View style={{ backgroundColor: '#e9ecef', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontSize: 11, color: '#6c757d', fontWeight: '600' }}>Coming soon</Text>
        </View>
      </View>
    </View>
  );
}

export default function StoreScreen({ onBack }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // 'pack1' | 'pack2' | 'booster'
  const [result, setResult] = useState(null); // { words } | { error } | { packMsg }

  const load = useCallback(async () => {
    try { setMe(await getMe()); } catch { /* noop */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const direction = me?.quiz_direction || 'en→zh';
  const balance = me?.balance;
  const learningChinese = direction !== 'zh→en';

  async function purchasePack(pack) {
    setBusy(`pack${pack.level}`);
    try {
      const d = await buyPack(pack.level);
      setMe((m) => ({ ...m, balance: d.newBalance }));
      setResult({ packMsg: `${pack.title} added — ${d.wordsAdded} new word${d.wordsAdded === 1 ? '' : 's'}!` });
    } catch (e) { setResult({ error: e.message }); } finally { setBusy(null); }
  }
  async function purchaseBooster() {
    setBusy('booster');
    try {
      const d = await buyBooster();
      setMe((m) => ({ ...m, balance: d.newBalance }));
      setResult({ words: d.words });
    } catch (e) { setResult({ error: e.message }); } finally { setBusy(null); }
  }

  const Hero = (
    <View style={{ backgroundColor: COLORS.jiayou, paddingTop: 16, paddingBottom: 40, paddingHorizontal: 16 }}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 }}>
          <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.9)" />
          <Text style={{ color: 'rgba(255,255,255,0.9)', fontWeight: '600' }}>Back</Text>
        </Pressable>
      ) : null}
      <View style={{ alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>Store</Text>
        <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13.5, marginTop: 4 }}>
          Balance : {balance == null ? '…' : `${balance} ₵`}
        </Text>
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 24, backgroundColor: '#f8f9fa', borderTopLeftRadius: 24, borderTopRightRadius: 24 }} />
    </View>
  );

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>{Hero}<ActivityIndicator color={COLORS.jiayou} style={{ marginTop: 40 }} /></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        {Hero}
        <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 16, marginTop: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Thematic Packs</Text>
          {learningChinese ? (
            <>
              {PACKS.map((p) => <PackCard key={p.level} pack={p} balance={balance} busy={busy === `pack${p.level}`} onBuy={purchasePack} />)}
              {SOON.map((lvl) => <SoonCard key={lvl} level={lvl} />)}
            </>
          ) : (
            <SoonCard level={'—'} />
          )}

          {/* Word Booster */}
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8, marginBottom: 12 }}>Word Booster</Text>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 18, ...SHADOW_CARD }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={{ width: 54, height: 54, borderRadius: 14, backgroundColor: '#e8f0ff', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="gift" size={26} color={COLORS.jiayou} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.jiayou }}>Words Booster</Text>
                <Text style={{ fontSize: 13, color: COLORS.muted, marginTop: 2 }}>5 random Chinese words to discover and learn</Text>
              </View>
            </View>
            <Pressable
              onPress={purchaseBooster}
              disabled={busy === 'booster' || (balance != null && balance < 20)}
              style={{ marginTop: 14, borderRadius: 12, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, backgroundColor: (balance != null && balance < 20) ? '#e9ecef' : COLORS.jiayou }}
            >
              {busy === 'booster' ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Ionicons name="cart" size={16} color={(balance != null && balance < 20) ? COLORS.muted : '#fff'} />
                  <Text style={{ color: (balance != null && balance < 20) ? COLORS.muted : '#fff', fontWeight: '700' }}>
                    {(balance != null && balance < 20) ? 'Insufficient balance' : 'Buy (20 ₵)'}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* Résultat d'achat */}
      <Popup visible={!!result} onClose={() => setResult(null)} maxWidth={400}>
        {result?.error ? (
          <>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 }}>Oops</Text>
            <Text style={{ color: COLORS.muted, marginBottom: 20 }}>{result.error}</Text>
          </>
        ) : result?.packMsg ? (
          <View style={{ alignItems: 'center', marginBottom: 16 }}>
            <Ionicons name="checkmark-circle" size={44} color={COLORS.success} />
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#1a1a2e', textAlign: 'center', marginTop: 10 }}>{result.packMsg}</Text>
          </View>
        ) : result?.words ? (
          <>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 12, textAlign: 'center' }}>🎉 5 new words!</Text>
            {result.words.map((w, i) => (
              <View key={w.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: i === result.words.length - 1 ? 0 : 1, borderColor: '#f5f5f5' }}>
                <Text style={{ fontSize: 22, fontWeight: '700', color: COLORS.jiayou, minWidth: 48 }}>{w.chinese}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, color: '#1a1a2e', fontWeight: '500' }}>{w.english}</Text>
                  <Text style={{ fontSize: 12.5, color: COLORS.muted }}>{w.pinyin}</Text>
                </View>
              </View>
            ))}
          </>
        ) : null}
        <Pressable onPress={() => setResult(null)} style={{ marginTop: 16, backgroundColor: COLORS.jiayou, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Done</Text>
        </Pressable>
      </Popup>
    </View>
  );
}
