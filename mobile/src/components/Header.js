import { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getMe, getNotifications, markNotificationsRead } from '../api';
import NotificationsPopup from './NotificationsPopup';
import { COLORS } from '../theme';

// Header bleu constant, identique à l'EJS (partials/header.ejs) :
// gauche = 加油！ + badge de plan ; droite = solde + icône compte.
export default function Header({ onAccount, onLogo, onBalance, onPlan, plan: planProp, profile, bg, hideLogo = false, accountIcon = 'person-circle', refreshKey = 0 }) {
  const [balance, setBalance] = useState(profile?.balance ?? null);
  const [plan, setPlan] = useState(planProp || profile?.plan || 'free');

  // Notifications (centre 🔔)
  const [notifs, setNotifs] = useState([]);
  const [unread, setUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);

  const loadNotifs = useCallback(() => {
    getNotifications().then((d) => { setNotifs(d.notifications || []); setUnread(d.unread || 0); }).catch(() => {});
  }, []);
  useEffect(() => { loadNotifs(); }, [loadNotifs, refreshKey]);

  function openNotifs() {
    setNotifOpen(true);
    if (unread > 0) {
      setUnread(0); // efface le badge ; les points "non lu" restent visibles à l'ouverture
      markNotificationsRead().catch(() => {});
    }
  }

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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Pressable
            onPress={onBalance}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              backgroundColor: 'rgba(255,255,255,0.12)',
              paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>
              {balance == null ? '…' : `${balance}₵`}
            </Text>
          </Pressable>
          {/* Cloche notifications + badge */}
          <Pressable onPress={openNotifs} hitSlop={8}>
            <Ionicons name="notifications" size={24} color="#fff" />
            {unread > 0 ? (
              <View style={{ position: 'absolute', top: -4, right: -5, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: '#e0322e', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: bg || COLORS.jiayou }}>
                <Text style={{ color: '#fff', fontSize: 9.5, fontWeight: '800' }}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable onPress={onAccount} hitSlop={8}>
            <Ionicons name={accountIcon} size={accountIcon === 'person-circle' ? 30 : 26} color="#fff" />
          </Pressable>
        </View>
      </View>

      <NotificationsPopup visible={notifOpen} notifications={notifs} onClose={() => setNotifOpen(false)} />
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
