import { View, Text, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import BottomSheet from './BottomSheet';
import { useT } from '../i18n';
import { COLORS } from '../theme';

const IG_URL = 'https://www.instagram.com/jiayou.app';
// Dégradé officiel Instagram (jaune → orange → rose → violet → bleu), en diagonale.
const IG_GRADIENT = ['#feda75', '#fa7e1e', '#d62976', '#962fbf', '#4f5bd5'];

// Annonce ponctuelle (drawer) : inviter à suivre Jiayou sur Instagram.
// Affiché une seule fois par utilisateur (piloté par showIgPromo côté serveur).
export default function InstagramPromoSheet({ visible, onClose, onFollow }) {
  const { t } = useT();
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ alignItems: 'center', marginBottom: 6 }}>
        {/* Pastille dégradé Instagram officiel */}
        <LinearGradient
          colors={IG_GRADIENT}
          start={{ x: 0, y: 1 }}
          end={{ x: 1, y: 0 }}
          style={{ width: 84, height: 84, borderRadius: 24, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="logo-instagram" size={46} color="#fff" />
        </LinearGradient>
        <Text style={{ fontSize: 12, fontWeight: '800', color: '#c13584', letterSpacing: 1, textTransform: 'uppercase', marginTop: 14, textAlign: 'center' }}>
          {t('ig_kicker')}
        </Text>
        <Text style={{ fontSize: 22, fontWeight: '800', color: '#1a1a2e', marginTop: 4, textAlign: 'center' }}>
          {t('ig_title')}
        </Text>
        <Text style={{ fontSize: 14.5, color: COLORS.muted, marginTop: 8, textAlign: 'center', lineHeight: 21 }}>
          {t('ig_body')}
        </Text>
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#1a1a2e', marginTop: 10 }}>@jiayou.app</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
        <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 14, alignItems: 'center' }}>
          <Text style={{ color: '#1a1a2e', fontWeight: '700', fontSize: 15 }}>{t('ig_later')}</Text>
        </Pressable>
        <Pressable
          onPress={() => { Linking.openURL(IG_URL).catch(() => {}); onFollow?.(); }}
          style={{ flex: 1, borderRadius: 999, overflow: 'hidden' }}
        >
          <LinearGradient
            colors={IG_GRADIENT}
            start={{ x: 0, y: 1 }}
            end={{ x: 1, y: 0 }}
            style={{ paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
          >
            <Ionicons name="logo-instagram" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{t('ig_follow')}</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
