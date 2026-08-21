import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from './Popup';
import { useT } from '../i18n';
import { COLORS } from '../theme';

// Paywall standardisé, affiché à la racine de l'app (au-dessus de toutes les
// popups). Déclenché par le handler global de api.js quand une limite du plan
// gratuit est atteinte. `feature` choisit le message ; le reste est générique.
const FEATURE_KEYS = {
  words: 'pw_words',
  duel: 'pw_duel',
  quiz: 'pw_quiz',
  pack_limit: 'pw_pack_limit',
  hsk_pack: 'pw_hsk_pack',
  ghost: 'pw_ghost',
  bulk_delete: 'pw_bulk_delete',
};

export default function PremiumLimitPopup({ feature, onClose, onGoPremium }) {
  const { t } = useT();
  const visible = !!feature;
  const bodyKey = FEATURE_KEYS[feature] || 'pw_default';

  return (
    <Popup visible={visible} onClose={onClose} maxWidth={380}>
      <View style={{ alignItems: 'center' }}>
        <View style={{
          width: 64, height: 64, borderRadius: 999, backgroundColor: COLORS.jiayouSoft,
          alignItems: 'center', justifyContent: 'center', marginBottom: 14,
        }}>
          <Ionicons name="diamond" size={30} color={COLORS.jiayou} />
        </View>

        <Text style={{ fontSize: 19, fontWeight: '800', color: '#1a1a2e', textAlign: 'center', marginBottom: 8 }}>
          {t('pw_title')}
        </Text>
        <Text style={{ fontSize: 14.5, color: COLORS.muted, textAlign: 'center', lineHeight: 21, marginBottom: 22 }}>
          {t(bodyKey)}
        </Text>

        <Pressable
          onPress={onGoPremium}
          style={{
            width: '100%', borderRadius: 999, paddingVertical: 15, alignItems: 'center',
            flexDirection: 'row', justifyContent: 'center', gap: 8, backgroundColor: COLORS.jiayou,
          }}
        >
          <Ionicons name="rocket" size={17} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15.5 }}>{t('pw_go')}</Text>
        </Pressable>

        <Pressable onPress={onClose} hitSlop={8} style={{ paddingVertical: 14, marginTop: 2 }}>
          <Text style={{ color: COLORS.muted, fontWeight: '700', fontSize: 14.5 }}>{t('pw_later')}</Text>
        </Pressable>
      </View>
    </Popup>
  );
}
