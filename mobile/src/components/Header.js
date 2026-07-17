import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getMe } from '../api';
import { COLORS } from '../theme';

// Header bleu constant, identique à l'EJS (partials/header.ejs) :
// gauche = 加油！ + badge de plan ; droite = solde + icône compte.
export default function Header({ onAccount, onLogo, onBalance, onPlan, plan: planProp, profile, bg, hideLogo = false, accountIcon = 'person-circle', refreshKey = 0 }) {
  const [balance, setBalance] = useState(profile?.balance ?? null);
  const [plan, setPlan] = useState(planProp || profile?.plan || 'free');

  useEffect(() => {
    // Si le parent fournit déjà le profil (App le charge au démarrage), on l'utilise
    // directement — pas de requête getMe redondante.
    if (profile) {
      setBalance(profile.balance ?? null);
      if (!planProp && profile.plan) setPlan(profile.plan);
      return;
    }
    let alive = true;
    getMe().then((u) => {
      if (!alive) return;
      setBalance(u.balance);
      if (!planProp && u.plan) setPlan(u.plan);
    }).catch(() => {});
    return () => { alive = false; };
  }, [profile, planProp, refreshKey]);

  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: bg || COLORS.jiayou }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 16,
      }}>
        {/* Gauche : logo (→ add) + badge de plan (→ pricing) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {!hideLogo && (
            <Pressable onPress={onLogo}>
              <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800' }}>加油！</Text>
            </Pressable>
          )}
          <Pressable onPress={onPlan}>
            <PlanBadge plan={plan} />
          </Pressable>
        </View>

        {/* Droite : solde + compte */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable
            onPress={onBalance}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              backgroundColor: 'rgba(255,255,255,0.12)',
              paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 12, opacity: 0.85 }}>balance :</Text>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>
              {balance == null ? '…' : `${balance}₵`}
            </Text>
          </Pressable>
          <Pressable onPress={onAccount} hitSlop={8}>
            <Ionicons name={accountIcon} size={accountIcon === 'person-circle' ? 30 : 26} color="#fff" />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function PlanBadge({ plan }) {
  const label = plan === 'premium' ? 'PREMIUM' : plan === 'guest' ? 'GUEST' : 'FREE';
  const textColor = plan === 'premium' ? COLORS.jiayou : '#585858';
  return (
    <View style={{
      backgroundColor: '#fff', borderRadius: 999,
      paddingHorizontal: 14, paddingVertical: 6,
      borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)',
    }}>
      <Text style={{ color: textColor, fontSize: 13, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}
