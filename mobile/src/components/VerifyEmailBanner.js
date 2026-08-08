import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resendVerification } from '../api';
import { useT } from '../i18n';

// Bandeau de rappel « vérifie ton email » — non bloquant. S'affiche tant que le
// compte n'est pas vérifié ; l'utilisateur peut renvoyer l'email ou le masquer
// pour la session (il réapparaît au prochain lancement tant que non vérifié).
export default function VerifyEmailBanner() {
  const { t } = useT();
  const [state, setState] = useState('idle'); // idle | sending | sent
  const [hidden, setHidden] = useState(false);

  if (hidden || state === 'sent') {
    if (state === 'sent') {
      return (
        <View style={{ backgroundColor: '#e7f7ec', paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="checkmark-circle" size={18} color="#1b7a3d" />
          <Text style={{ color: '#1b7a3d', fontSize: 13, flex: 1 }}>{t('verify_sent')}</Text>
        </View>
      );
    }
    return null;
  }

  async function onResend() {
    setState('sending');
    try {
      await resendVerification();
      setState('sent');
    } catch {
      setState('idle');
    }
  }

  return (
    <View style={{ backgroundColor: '#fff3cd', paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Ionicons name="mail-unread-outline" size={18} color="#8a6d00" />
      <Text style={{ color: '#7a6100', fontSize: 12.5, flex: 1, lineHeight: 17 }}>{t('verify_banner')}</Text>
      <Pressable onPress={onResend} disabled={state === 'sending'} hitSlop={8} style={{ backgroundColor: '#8a6d00', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
        {state === 'sending'
          ? <ActivityIndicator size="small" color="#fff" />
          : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{t('verify_resend')}</Text>}
      </Pressable>
      <Pressable onPress={() => setHidden(true)} hitSlop={8}>
        <Ionicons name="close" size={18} color="#8a6d00" />
      </Pressable>
    </View>
  );
}
