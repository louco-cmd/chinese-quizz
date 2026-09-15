import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CatLoader from './CatLoader';
import { useT } from '../i18n';

// Loader plein écran générique — utilisé par la plupart des écrans.
// Rend le chat Lottie (fallback spinner géré dans CatLoader sur les vieux builds).
export function Loading() {
  return (
    <View className="flex-1 items-center justify-center">
      <CatLoader size={110} />
    </View>
  );
}

// Empty state formaté pour les erreurs de chargement (500, réseau…).
// On n'affiche plus le message technique brut en rouge : icône + titre +
// sous-titre neutre + bouton Réessayer. `title`/`subtitle` restent surchargeables.
export function ErrorRetry({ error, onRetry, title, subtitle }) {
  const { t } = useT();
  return (
    <View className="flex-1 items-center justify-center px-8">
      <View
        style={{
          width: 72, height: 72, borderRadius: 36, backgroundColor: '#eef2f7',
          alignItems: 'center', justifyContent: 'center', marginBottom: 16,
        }}
      >
        <Ionicons name="cloud-offline-outline" size={34} color="#8a94a6" />
      </View>
      <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', textAlign: 'center' }}>
        {title || t('err_title')}
      </Text>
      <Text style={{ fontSize: 13.5, color: '#8a94a6', textAlign: 'center', marginTop: 6, lineHeight: 19, maxWidth: 300 }}>
        {subtitle || t('err_subtitle')}
      </Text>
      {onRetry ? (
        <Pressable onPress={onRetry} className="mt-5 bg-jiayou rounded-full px-6 py-2.5 active:opacity-80">
          <Text className="text-white font-semibold">{t('common_retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
