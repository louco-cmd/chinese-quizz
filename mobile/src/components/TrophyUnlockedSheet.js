import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from './BottomSheet';
import { CAT_META } from '../screens/TrophiesScreen';
import { useT } from '../i18n';
import { COLORS } from '../theme';

// Premier usage du BottomSheet : célébrer l'obtention d'un (ou plusieurs) trophée(s).
// `trophies` = liste { cat, target, unit, reward } (issue de newlyUnlocked, enrichie
// de l'unité). onViewAll → page Trophées. onClose → fermer.
export default function TrophyUnlockedSheet({ visible, trophies = [], onClose, onViewAll }) {
  const { t } = useT();
  const list = trophies || [];
  const multi = list.length > 1;
  const totalReward = list.reduce((s, x) => s + (x.reward || 0), 0);
  const hero = list[0] ? (CAT_META[list[0].cat] || { icon: 'ribbon', color: COLORS.jiayou }) : { icon: 'ribbon', color: COLORS.jiayou };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {/* Médaille héro */}
      <View style={{ alignItems: 'center', marginBottom: 6 }}>
        <View style={{ width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: hero.color }}>
          <Ionicons name={hero.icon} size={44} color="#fff" />
        </View>
        {!multi && list[0] ? (
          <>
            <Text style={{ fontSize: 12, fontWeight: '800', color: hero.color, letterSpacing: 1, textTransform: 'uppercase', marginTop: 14, textAlign: 'center' }}>
              {t('tsheet_title')}
            </Text>
            <Text style={{ fontSize: 22, fontWeight: '800', color: '#1a1a2e', marginTop: 4, textAlign: 'center' }}>
              {list[0].target} {t('tru_' + list[0].unit)}
            </Text>
          </>
        ) : (
          <Text style={{ fontSize: 22, fontWeight: '800', color: '#1a1a2e', marginTop: 14, textAlign: 'center' }}>
            {t('tsheet_title_multi').replace('{n}', String(list.length))}
          </Text>
        )}
      </View>

      {/* Liste (si plusieurs) ou récompense unique */}
      {multi ? (
        <View style={{ marginTop: 12, gap: 8 }}>
          {list.map((x, i) => {
            const m = CAT_META[x.cat] || { icon: 'ribbon', color: COLORS.jiayou };
            return (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f6f8fb', borderRadius: 14, padding: 12 }}>
                <View style={{ width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: m.color }}>
                  <Ionicons name={m.icon} size={20} color="#fff" />
                </View>
                <Text style={{ flex: 1, fontSize: 14.5, fontWeight: '700', color: '#1a1a2e' }}>{x.target} {t('tru_' + x.unit)}</Text>
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#856404' }}>+{x.reward} ₵</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* Récompense totale */}
      {totalReward > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#fff8e1', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, alignSelf: 'center', marginTop: 16 }}>
          <Ionicons name="add-circle" size={16} color="#d97706" />
          <Text style={{ color: '#856404', fontWeight: '800', fontSize: 14 }}>{totalReward} {t('tsheet_reward')}</Text>
        </View>
      ) : null}

      {/* Actions */}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
        <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 14, alignItems: 'center' }}>
          <Text style={{ color: '#1a1a2e', fontWeight: '700', fontSize: 15 }}>{t('tsheet_nice')}</Text>
        </Pressable>
        <Pressable onPress={onViewAll} style={{ flex: 1, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
          <Ionicons name="trophy" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{t('tsheet_view')}</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
