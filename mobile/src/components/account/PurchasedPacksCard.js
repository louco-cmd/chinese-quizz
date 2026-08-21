import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AccountCard from './AccountCard';
import PackDetailPopup from '../PackDetailPopup';
import { getPurchasedPacks, getMe } from '../../api';
import { useT } from '../../i18n';
import { COLORS } from '../../theme';
import CatLoader from '../CatLoader';

// Carte "Purchased packs" de la page account : packs achetés (≠ créés). Tap sur
// un pack → popup identique au store (PackDetailPopup) avec mots + "Start a quiz".
export default function PurchasedPacksCard({ onStartQuiz }) {
  const { t } = useT();
  const [packs, setPacks] = useState(null);
  const [selected, setSelected] = useState(null);
  const [isPremium, setIsPremium] = useState(false); // « Forget this pack » = premium

  const load = useCallback(async () => {
    try { const d = await getPurchasedPacks(); setPacks(d.packs || []); } catch { setPacks([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { getMe().then((u) => setIsPremium(!!u?.isPremium)).catch(() => {}); }, []);

  // Aucun achat → on masque la section.
  if (packs !== null && packs.length === 0) return null;

  return (
    <AccountCard icon="bag-handle-outline" title={t('ac_purchased_packs')}>
      {packs === null ? (
        <View style={{ marginVertical: 12, alignItems: 'center' }}><CatLoader size={80} /></View>
      ) : (
        packs.map((p, i) => (
          <Pressable
            key={p.id}
            onPress={() => setSelected(p)}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: i === packs.length - 1 ? 0 : 1, borderColor: '#f2f2f4' }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#1a1a2e' }} numberOfLines={1}>{p.title}</Text>
              <Text style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>
                {p.word_count} {t('st_words')} · {t('st_by')} {p.creator}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.mutedLight} />
          </Pressable>
        ))
      )}

      <PackDetailPopup
        pack={selected}
        isPremium={isPremium}
        onClose={() => setSelected(null)}
        onForgotten={() => load()}
        onStartQuiz={onStartQuiz ? (p) => { setSelected(null); onStartQuiz(p); } : undefined}
      />
    </AccountCard>
  );
}
