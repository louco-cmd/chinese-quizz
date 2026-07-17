import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ErrorRetry } from '../components/ErrorRetry';
import { getWallet } from '../api';
import { COLORS, SHADOW_CARD } from '../theme';

// Type de transaction → icône + libellé (calqué sur TX_ICONS de bank.ejs).
const TX_META = {
  quiz: { icon: 'school', label: 'Quiz' },
  quiz_reward: { icon: 'school', label: 'Quiz reward' },
  duel: { icon: 'flash', label: 'Duel' },
  bet: { icon: 'flash', label: 'Duel bet' },
  duel_reward: { icon: 'trophy', label: 'Duel reward' },
  bet_reward: { icon: 'trophy', label: 'Duel win' },
  bet_refund: { icon: 'arrow-undo', label: 'Duel refund' },
  capture_word: { icon: 'book', label: 'Word' },
  word: { icon: 'book', label: 'Word' },
  pack: { icon: 'bag', label: 'Pack' },
  pack_purchase: { icon: 'bag', label: 'Pack' },
  store: { icon: 'bag', label: 'Store' },
  reward: { icon: 'gift', label: 'Reward' },
  referral: { icon: 'person-add', label: 'Referral bonus' },
  subscription: { icon: 'star', label: 'Premium' },
  refund: { icon: 'arrow-undo', label: 'Refund' },
};
function meta(type, amount) {
  return TX_META[type] || TX_META[(type || '').toLowerCase()]
    || { icon: amount > 0 ? 'add-circle' : 'remove-circle', label: type || '—' };
}
const isThisMonth = (d) => { const x = new Date(d), n = new Date(); return x.getMonth() === n.getMonth() && x.getFullYear() === n.getFullYear(); };
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtMonth = (d) => new Date(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

function TxRow({ tx, last }) {
  const positive = Number(tx.amount) > 0;
  const m = meta(tx.type, tx.amount);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderColor: '#f5f5f5' }}>
      <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: positive ? '#e8f5e9' : '#fdecef' }}>
        <Ionicons name={m.icon} size={18} color={positive ? COLORS.success : COLORS.danger} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: '#1a1a2e' }} numberOfLines={1}>{tx.description || m.label}</Text>
        <Text style={{ fontSize: 12, color: '#adb5bd', marginTop: 1 }}>{fmtDate(tx.created_at)}</Text>
      </View>
      <Text style={{ fontSize: 15, fontWeight: '700', color: positive ? COLORS.success : COLORS.danger }}>
        {positive ? '+' : ''}{tx.amount}₵
      </Text>
    </View>
  );
}

function Pill({ value, label, color }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: 17, fontWeight: '800', color }}>{value}</Text>
      <Text style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

// Page "Wallet / Bank" : hero solde + résumé du mois + historique filtrable.
export default function BankScreen({ onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('month');

  const load = useCallback(async () => {
    setError('');
    try { setData(await getWallet()); } catch (e) { setError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const all = data?.transactions || [];
  const monthTx = useMemo(() => all.filter((t) => isThisMonth(t.created_at)), [all]);
  const earned = monthTx.filter((t) => t.amount > 0).reduce((s, t) => s + Number(t.amount), 0);
  const spent = monthTx.filter((t) => t.amount < 0).reduce((s, t) => s + Number(t.amount), 0);
  const list = filter === 'month' ? monthTx : all;

  // Groupe par mois en mode "All time"
  const grouped = useMemo(() => {
    if (filter !== 'all') return null;
    const g = {};
    list.forEach((t) => { const k = fmtMonth(t.created_at); (g[k] = g[k] || []).push(t); });
    return Object.entries(g);
  }, [filter, list]);

  const Hero = (
    <View style={{ backgroundColor: COLORS.jiayou, paddingTop: 18, paddingBottom: 44, paddingHorizontal: 16 }}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
          <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.9)" />
          <Text style={{ color: 'rgba(255,255,255,0.9)', fontWeight: '600' }}>Back</Text>
        </Pressable>
      ) : null}
      {/* Solde centré */}
      <View style={{ alignItems: 'center', marginTop: 4 }}>
        <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '600', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Your balance</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <Text style={{ color: '#fff', fontSize: 46, fontWeight: '800', lineHeight: 50 }}>
            {data ? Number(data.balance).toLocaleString() : '—'}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 24, fontWeight: '700', marginLeft: 4, marginBottom: 4 }}>₵</Text>
        </View>
      </View>

      {/* Courbe arrondie qui fait la jonction avec le corps clair (comme la page account) */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 24, backgroundColor: '#f8f9fa', borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
      />
    </View>
  );

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>{Hero}<ActivityIndicator color={COLORS.jiayou} style={{ marginTop: 40 }} /></View>;
  }
  if (error) {
    return <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>{Hero}<ErrorRetry error={error} onRetry={load} /></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.jiayou} />}
      >
        {Hero}

        <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 16, marginTop: 16 }}>
          {/* Résumé du mois */}
          <View style={{ flexDirection: 'row', backgroundColor: '#fff', borderRadius: 16, paddingVertical: 16, marginBottom: 18, ...SHADOW_CARD }}>
            <Pill value={`+${earned}₵`} label="Earned" color={COLORS.success} />
            <Pill value={`${spent}₵`} label="Spent" color={COLORS.danger} />
            <Pill value={monthTx.length} label="Transactions" color={COLORS.jiayou} />
          </View>

          {/* Historique + filtres */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#1a1a2e' }}>History</Text>
            <View style={{ flexDirection: 'row', backgroundColor: '#eef1f5', borderRadius: 999, padding: 3 }}>
              {[['month', 'This month'], ['all', 'All time']].map(([f, label]) => (
                <Pressable key={f} onPress={() => setFilter(f)} style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: filter === f ? '#fff' : 'transparent' }}>
                  <Text style={{ fontSize: 12.5, fontWeight: '600', color: filter === f ? COLORS.jiayou : COLORS.muted }}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={{ backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 16, ...SHADOW_CARD }}>
            {list.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                <Ionicons name="receipt-outline" size={34} color={COLORS.muted} />
                <Text style={{ color: COLORS.muted, marginTop: 8, fontSize: 13 }}>No transactions {filter === 'month' ? 'this month' : 'yet'}.</Text>
              </View>
            ) : grouped ? (
              grouped.map(([month, txs]) => (
                <View key={month}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.5, paddingTop: 14, paddingBottom: 4 }}>{month}</Text>
                  {txs.map((tx, i) => <TxRow key={tx.id} tx={tx} last={i === txs.length - 1} />)}
                </View>
              ))
            ) : (
              list.map((tx, i) => <TxRow key={tx.id} tx={tx} last={i === list.length - 1} />)
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
