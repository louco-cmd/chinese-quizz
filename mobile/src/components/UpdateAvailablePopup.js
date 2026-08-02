import { View, Text, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from './Popup';
import { useT } from '../i18n';
import { COLORS } from '../theme';

// Popup INCITATIVE (non bloquante) : proposée quand un build plus récent existe
// sur le store. « Later » ferme simplement — l'utilisateur peut rester sur sa
// version. Affichée une seule fois par lancement (géré dans App.js).
export default function UpdateAvailablePopup({ url, onClose }) {
  const { t } = useT();
  const open = () => { if (url) Linking.openURL(url).catch(() => {}); onClose(); };

  return (
    <Popup visible={!!url} onClose={onClose} maxWidth={380}>
      <View>
        <View style={{ alignItems: 'center', marginBottom: 14 }}>
          <View style={{
            width: 60, height: 60, borderRadius: 999, backgroundColor: COLORS.jiayouSoft,
            alignItems: 'center', justifyContent: 'center', marginBottom: 12,
          }}>
            <Ionicons name="rocket" size={28} color={COLORS.jiayou} />
          </View>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a1a2e', textAlign: 'center' }}>
            {t('up_title')}
          </Text>
          <Text style={{ fontSize: 13.5, color: COLORS.muted, textAlign: 'center', marginTop: 6, lineHeight: 19 }}>
            {t('up_body')}
          </Text>
        </View>

        <Pressable
          onPress={open}
          style={{ borderRadius: 999, paddingVertical: 14, alignItems: 'center', backgroundColor: COLORS.jiayou, marginBottom: 8 }}
        >
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{t('up_now')}</Text>
        </Pressable>
        <Pressable onPress={onClose} style={{ paddingVertical: 10, alignItems: 'center' }}>
          <Text style={{ color: COLORS.muted, fontWeight: '700', fontSize: 14 }}>{t('up_later')}</Text>
        </Pressable>
      </View>
    </Popup>
  );
}
