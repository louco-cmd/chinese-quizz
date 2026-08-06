import { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getMe } from '../api';
import { COLORS } from '../theme';
import CatLoader from '../components/CatLoader';

const MAX_ATTEMPTS = 15;

// Retour de paiement Stripe (miroir de welcome-jiayou-premium.ejs) :
// poll getMe jusqu'à isPremium, puis confirme l'activation.
export default function WelcomePremiumScreen({ onDone }) {
  const [status, setStatus] = useState('polling'); // 'polling' | 'active' | 'timeout'
  const [attempts, setAttempts] = useState(0);
  const timer = useRef(null);
  const attemptsRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      attemptsRef.current += 1;
      setAttempts(attemptsRef.current);
      try {
        const me = await getMe();
        if (cancelled) return;
        if (me.isPremium || me.plan === 'premium') { setStatus('active'); clearInterval(timer.current); return; }
      } catch { /* ignore réseau */ }
      if (attemptsRef.current >= MAX_ATTEMPTS) { setStatus('timeout'); clearInterval(timer.current); }
    }
    tick();
    timer.current = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(timer.current); };
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-surface-page">
      <View className="flex-1 items-center justify-center px-8">
        <View className="bg-white rounded-3xl p-7 w-full items-center" style={{ maxWidth: 420, shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.08, shadowRadius: 30, elevation: 4 }}>
          <Text className="text-5xl font-extrabold text-jiayou mb-1">加油!</Text>

          {status === 'active' ? (
            <>
              <View className="w-16 h-16 rounded-full bg-[#dcfce7] items-center justify-center mt-3 mb-2">
                <Ionicons name="checkmark-circle" size={40} color="#16a34a" />
              </View>
              <Text className="text-[19px] font-extrabold text-ink mt-2">Premium active ✓</Text>
              <Text className="text-muted text-center text-[13.5px] mt-2 mb-6">All features are unlocked on your account. Thank you for your support!</Text>
              <Pressable onPress={onDone} className="bg-jiayou rounded-full py-3.5 px-8 items-center w-full active:opacity-80">
                <Text className="text-white font-bold">Start learning</Text>
              </Pressable>
            </>
          ) : status === 'timeout' ? (
            <>
              <Ionicons name="time-outline" size={44} color={COLORS.muted} style={{ marginTop: 12 }} />
              <Text className="text-[17px] font-bold text-ink mt-2 text-center">Taking longer than usual…</Text>
              <Text className="text-muted text-center text-[13.5px] mt-2 mb-6">Your Premium will activate once the payment is confirmed. You can safely continue.</Text>
              <Pressable onPress={onDone} className="bg-jiayou rounded-full py-3.5 px-8 items-center w-full active:opacity-80">
                <Text className="text-white font-bold">Go to the app</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={{ marginTop: 16, alignItems: 'center' }}><CatLoader size={110} /></View>
              <Text className="text-[17px] font-bold text-ink mt-4">Confirming your payment…</Text>
              <Text className="text-muted text-center text-[13px] mt-2">({attempts}/{MAX_ATTEMPTS}) This only takes a few seconds.</Text>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}
