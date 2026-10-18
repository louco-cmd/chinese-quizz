import { View, Text, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from './BottomSheet';
import { requestNativeReview } from '../reviewPrompt';
import { LEGAL_CONTACT } from '../data/legalContent';
import { useT } from '../i18n';
import { COLORS } from '../theme';

// Pré-prompt « note l'app » en DEUX temps (standard du secteur) :
//  • 😍 J'adore  → ouvre la vraie feuille de notation in-app native (store).
//  • 😐 Bof      → ouvre un email support pré-rempli (on ne brûle pas l'avis
//                  store, on capte le retour en privé). Choix produit : mailto.
// Le gating (3 moments positifs, cooldown 120 j, dispo OS) est fait en amont
// dans reviewPrompt.js AVANT d'afficher ce sheet.
export default function ReviewPromptSheet({ visible, onClose }) {
  const { t } = useT();

  const onLove = async () => {
    onClose?.();
    try { await requestNativeReview(); } catch { /* noop */ }
  };

  const onMeh = async () => {
    onClose?.();
    const subject = encodeURIComponent(t('rp_mail_subject'));
    const body = encodeURIComponent(t('rp_mail_body'));
    try { await Linking.openURL(`mailto:${LEGAL_CONTACT}?subject=${subject}&body=${body}`); } catch { /* noop */ }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {/* Cœur / mascotte */}
      <View style={{ alignItems: 'center', marginBottom: 6 }}>
        <View style={{ width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.jiayou }}>
          <Ionicons name="heart" size={44} color="#fff" />
        </View>
        <Text style={{ fontSize: 22, fontWeight: '800', color: '#1a1a2e', marginTop: 14, textAlign: 'center' }}>
          {t('rp_title')}
        </Text>
        <Text style={{ fontSize: 14, color: COLORS.muted, marginTop: 6, textAlign: 'center', lineHeight: 20 }}>
          {t('rp_sub')}
        </Text>
      </View>

      {/* Choix : J'adore (primaire) / Bof (secondaire) */}
      <View style={{ gap: 10, marginTop: 20 }}>
        <Pressable onPress={onLove} style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          <Ionicons name="happy" size={18} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15.5 }}>{t('rp_love')}</Text>
        </Pressable>
        <Pressable onPress={onMeh} style={{ backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          <Ionicons name="chatbubble-ellipses-outline" size={17} color="#55607a" />
          <Text style={{ color: '#55607a', fontWeight: '700', fontSize: 15 }}>{t('rp_meh')}</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
