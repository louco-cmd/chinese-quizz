import { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getTrophies } from '../api';
import { useT } from '../i18n';
import { COLORS, TAB_CLEARANCE, SHADOW_CARD } from '../theme';
import CatLoader from '../components/CatLoader';
import { ErrorRetry } from '../components/ErrorRetry';
import useAndroidBack from '../useAndroidBack';

// Icône + couleur d'accent par catégorie de trophée. Exporté : réutilisé par
// TrophyUnlockedSheet (drawer d'obtention de trophée).
export const CAT_META = {
  captures:    { icon: 'albums',        color: '#0d6efd' },
  mastered:    { icon: 'ribbon',        color: '#6f42c1' },
  streak:      { icon: 'flame',         color: '#e8590c' },
  quiz:        { icon: 'school',        color: '#7c3aed' },
  duel_win:    { icon: 'trophy',        color: '#f5b301' },
  duel_play:   { icon: 'flash',         color: '#20c997' },
  money:       { icon: 'cash',          color: '#198754' },
  pack_create: { icon: 'create',        color: '#e83e8c' },
  pack_buy:    { icon: 'cart',          color: '#0dcaf0' },
};

function TrophyRow({ tr: trophy, t, last }) {
  const meta = CAT_META[trophy._cat] || { icon: 'ribbon', color: COLORS.jiayou };
  const on = trophy.unlocked;
  const pct = trophy.target > 0 ? Math.min(100, Math.round((trophy.value / trophy.target) * 100)) : 0;
  const title = `${trophy.target} ${t('tru_' + trophy.unit)}`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderColor: '#f2f4f7', opacity: on ? 1 : 0.92 }}>
      {/* Pastille : colorée si atteint, grisée sinon */}
      <View style={{ width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? meta.color : '#eceef1' }}>
        <Ionicons name={meta.icon} size={22} color={on ? '#fff' : '#adb5bd'} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: on ? '#1a1a2e' : '#8a94a6' }}>{title}</Text>
        {on ? (
          <Text style={{ fontSize: 12.5, color: COLORS.success, fontWeight: '700', marginTop: 2 }}>{t('tr_earned')}</Text>
        ) : (
          <View style={{ marginTop: 6 }}>
            <View style={{ height: 6, borderRadius: 999, backgroundColor: '#eceef1', overflow: 'hidden' }}>
              <View style={{ width: `${pct}%`, height: '100%', borderRadius: 999, backgroundColor: meta.color }} />
            </View>
            <Text style={{ fontSize: 11, color: COLORS.mutedLight, marginTop: 3 }}>{trophy.value}/{trophy.target}</Text>
          </View>
        )}
      </View>
      {/* Récompense : chip coloré si atteint, grisé sinon */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: on ? '#fff8e1' : '#f6f8fb', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
        {on ? <Ionicons name="checkmark-circle" size={13} color="#d97706" /> : null}
        <Text style={{ fontSize: 12.5, fontWeight: '800', color: on ? '#856404' : '#adb5bd' }}>+{trophy.reward} ₵</Text>
      </View>
    </View>
  );
}

export default function TrophiesScreen({ onBack }) {
  const { t } = useT();
  useAndroidBack(() => { onBack?.(); return true; }, true, [onBack]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setData(await getTrophies()); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Bouton retour transparent (pas de barre blanche → évite le double header).
  const BackBtn = (
    <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 2 }}>
      <Ionicons name="chevron-back" size={22} color={COLORS.jiayou} />
      <Text style={{ color: COLORS.jiayou, fontWeight: '600' }}>{t('common_back')}</Text>
    </Pressable>
  );

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>{BackBtn}<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><CatLoader size={110} /></View></View>;
  }
  if (error) {
    return <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>{BackBtn}<ErrorRetry onRetry={load} /></View>;
  }

  const totalUnlocked = (data?.categories || []).reduce((s, c) => s + c.trophies.filter((x) => x.unlocked).length, 0);
  const totalCount = (data?.categories || []).reduce((s, c) => s + c.trophies.length, 0);

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      {BackBtn}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: TAB_CLEARANCE, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
        {/* Titre DANS la page (pas dans la barre de retour). */}
        <Text style={{ fontSize: 26, fontWeight: '800', color: '#1a1a2e' }}>🏆 {t('tr_title')}</Text>
        <Text style={{ fontSize: 13, color: COLORS.muted, marginTop: 4, marginBottom: 16 }}>
          {t('tr_progress').replace('{n}', totalUnlocked).replace('{total}', totalCount)}
        </Text>
        {(data?.categories || []).map((c) => (
          <View key={c.key} style={{ backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 14, ...SHADOW_CARD }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, paddingBottom: 4 }}>
              <Ionicons name={(CAT_META[c.key] || {}).icon || 'ribbon'} size={16} color={(CAT_META[c.key] || {}).color || COLORS.jiayou} />
              <Text style={{ fontSize: 13, fontWeight: '800', color: '#1a1a2e', textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('trc_' + c.key)}</Text>
              {c.yearly ? (
                <View style={{ backgroundColor: '#eef2f7', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 9.5, fontWeight: '800', color: '#8a94a6' }}>{t('tr_yearly')}</Text>
                </View>
              ) : null}
            </View>
            {c.trophies.map((x, i) => (
              <TrophyRow key={x.id} tr={{ ...x, _cat: c.key }} t={t} last={i === c.trophies.length - 1} />
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
