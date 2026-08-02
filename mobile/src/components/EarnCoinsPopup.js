import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from './Popup';
import { useT } from '../i18n';
import { COLORS } from '../theme';

// Popup « comment gagner des pièces », affichée à la racine (au-dessus de toutes
// les popups) quand le solde est insuffisant. Il n'existe pas d'achat de pièces :
// on explique les 5 moyens d'en gagner. Déclenchée par le handler global de api.js.
const WAYS = [
  { icon: 'school', key: 'ic_way_quiz' },
  { icon: 'flash', key: 'ic_way_duel' },
  { icon: 'gift', key: 'ic_way_redpocket' },
  { icon: 'pricetags', key: 'ic_way_pack' },
  { icon: 'people', key: 'ic_way_invite' },
];

export default function EarnCoinsPopup({ visible, onClose }) {
  const { t } = useT();

  return (
    <Popup visible={visible} onClose={onClose} maxWidth={400}>
      <View>
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <View style={{
            width: 64, height: 64, borderRadius: 999, backgroundColor: '#fff6db',
            alignItems: 'center', justifyContent: 'center', marginBottom: 12,
          }}>
            <Text style={{ fontSize: 30 }}>🪙</Text>
          </View>
          <Text style={{ fontSize: 19, fontWeight: '800', color: '#1a1a2e', textAlign: 'center' }}>
            {t('ic_title')}
          </Text>
          <Text style={{ fontSize: 13.5, color: COLORS.muted, textAlign: 'center', marginTop: 4 }}>
            {t('ic_intro')}
          </Text>
        </View>

        <View style={{ gap: 10, marginBottom: 20 }}>
          {WAYS.map((w) => (
            <View key={w.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{
                width: 34, height: 34, borderRadius: 10, backgroundColor: COLORS.jiayouSoft,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Ionicons name={w.icon} size={17} color={COLORS.jiayou} />
              </View>
              <Text style={{ flex: 1, fontSize: 14.5, color: '#334', lineHeight: 19 }}>{t(w.key)}</Text>
            </View>
          ))}
        </View>

        <Pressable
          onPress={onClose}
          style={{ borderRadius: 999, paddingVertical: 14, alignItems: 'center', backgroundColor: COLORS.jiayou }}
        >
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{t('ic_got_it')}</Text>
        </Pressable>
      </View>
    </Popup>
  );
}
