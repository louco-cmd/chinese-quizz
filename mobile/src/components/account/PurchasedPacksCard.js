import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AccountCard from './AccountCard';
import Popup from '../Popup';
import { WordRow } from '../PackMarket';
import { getPurchasedPacks, getMarketPack } from '../../api';
import { COLORS } from '../../theme';

// Carte "Purchased packs" de la page account : packs achetés (≠ créés). Tap sur
// un pack → popup avec la liste complète des mots.
export default function PurchasedPacksCard() {
  const [packs, setPacks] = useState(null);
  const [sel, setSel] = useState(null); // { loading, pack, words, error }

  const load = useCallback(async () => {
    try { const d = await getPurchasedPacks(); setPacks(d.packs || []); } catch { setPacks([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function open(p) {
    setSel({ loading: true, pack: p });
    try {
      const d = await getMarketPack(p.id);
      setSel({ loading: false, pack: d.pack, words: d.words || [] });
    } catch (e) {
      setSel({ loading: false, pack: p, error: e.message });
    }
  }

  // Aucun achat → on masque la section.
  if (packs !== null && packs.length === 0) return null;

  return (
    <AccountCard icon="bag-handle-outline" title="Purchased packs">
      {packs === null ? (
        <ActivityIndicator color={COLORS.jiayou} style={{ marginVertical: 12 }} />
      ) : (
        packs.map((p, i) => (
          <Pressable
            key={p.id}
            onPress={() => open(p)}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: i === packs.length - 1 ? 0 : 1, borderColor: '#f2f2f4' }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#1a1a2e' }} numberOfLines={1}>{p.title}</Text>
              <Text style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>
                {p.word_count} words · by {p.creator}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.mutedLight} />
          </Pressable>
        ))
      )}

      {/* ── Popup : mots du pack ── */}
      <Popup visible={!!sel} onClose={() => setSel(null)} maxWidth={440}>
        {sel?.loading ? (
          <ActivityIndicator color={COLORS.jiayou} style={{ marginVertical: 30 }} />
        ) : sel ? (
          <View>
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a1a2e' }}>{sel.pack.title}</Text>
            <Text style={{ fontSize: 13, color: COLORS.muted, marginTop: 2, marginBottom: 12 }}>
              {(sel.words?.length ?? sel.pack.word_count) || 0} words
            </Text>
            {sel.error ? (
              <Text style={{ color: COLORS.danger, fontSize: 13, fontWeight: '600' }}>{sel.error}</Text>
            ) : (
              <ScrollView style={{ maxHeight: 360 }} nestedScrollEnabled>
                {(sel.words || []).map((w, i) => <WordRow key={w.id} w={w} last={i === sel.words.length - 1} />)}
              </ScrollView>
            )}
          </View>
        ) : null}
      </Popup>
    </AccountCard>
  );
}
