import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, Linking, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SHADOW_CARD } from '../theme';
import { getBillingPortal, refreshSubscription, syncRevenueCat } from '../api';
import { buyPremium, purchasesAvailable, restorePurchases, getPremiumPlans, yearlySavingPct, isTestStore } from '../purchases';

// Android : gérer/annuler l'abonnement se fait dans le Play Store.
const PLAY_SUBSCRIPTIONS_URL = 'https://play.google.com/store/account/subscriptions';

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

const PREMIUM_URL = 'https://jiayou.fr/#pricing';

const PREMIUM_FEATURES = [
  { icon: 'infinite', kind: 'inf', title: 'Unlimited words', sub: 'Learn without limits' },
  { icon: 'infinite', kind: 'inf', title: 'Unlimited duels', sub: 'Challenge anytime' },
  { icon: 'infinite', kind: 'inf', title: 'Unlimited quizzes', sub: 'Practice endlessly' },
  { icon: 'checkmark', kind: 'yes', title: 'HSK packs access', sub: 'Curated word packs' },
  { icon: 'checkmark', kind: 'yes', title: 'Priority support', sub: "We've got your back" },
];
const FREE_FEATURES = [
  { icon: 'bookmark', kind: 'lim', title: '600 words', sub: 'Vocabulary limit' },
  { icon: 'time', kind: 'lim', title: '1 duel / day', sub: 'Challenge friends' },
  { icon: 'time', kind: 'lim', title: '4 quizzes / day', sub: 'Practice daily' },
  { icon: 'checkmark', kind: 'yes', title: 'HSK pack access', sub: 'HSK 1' },
  { icon: 'checkmark', kind: 'yes', title: 'Word Booster', sub: 'Discover new words' },
];
const FAQ = [
  { q: 'Can I switch between plans?', a: "Yes! You can upgrade to Premium anytime. If you cancel, you keep Premium access until the end of your billing period, then revert to Free." },
  { q: 'How does payment work?', a: 'Subscriptions are managed securely on jiayou.fr. Tapping "Start Premium" opens your browser to pay with any major card. Your Premium access syncs back to the app automatically.' },
  { q: 'Can I cancel my subscription?', a: 'Absolutely — no commitment. Cancel from your subscription settings at any time. You keep Premium until the billing period ends.' },
  { q: 'Can I reactivate a canceled subscription?', a: 'Yes! Just resubscribe on jiayou.fr — your Premium access is restored immediately after payment.' },
];

const ICON_BG = { inf: { bg: '#e8f0ff', fg: COLORS.jiayou }, yes: { bg: '#e8f5e9', fg: COLORS.success }, lim: { bg: '#fff3cd', fg: '#b8860b' } };

function FeatureRow({ f, last }) {
  const c = ICON_BG[f.kind];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: last ? 0 : 1, borderColor: '#f2f2f4' }}>
      <View style={{ width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
        <Ionicons name={f.icon} size={16} color={c.fg} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: '#1d1d1f' }}>{f.title}</Text>
        <Text style={{ fontSize: 12, color: '#8a8a8e', marginTop: 1 }}>{f.sub}</Text>
      </View>
    </View>
  );
}

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderBottomWidth: 1, borderColor: '#f0f0f0' }}>
      <Pressable onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 }}>
        <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: '#1d1d1f', paddingRight: 10 }}>{q}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.muted} />
      </Pressable>
      {open ? <Text style={{ fontSize: 13.5, color: '#6c757d', lineHeight: 20, paddingBottom: 14 }}>{a}</Text> : null}
    </View>
  );
}

// Page Pricing : hero + carte Premium (featured) + carte Free + trust + FAQ.
export default function PricingScreen({ onBack, isPremium = false, onPurchased }) {
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState('');
  const [sub, setSub] = useState({ cancelAtPeriodEnd: false, currentPeriodEnd: null });
  const [plans, setPlans] = useState([]);       // offres RevenueCat (natif)
  const [planId, setPlanId] = useState(null);   // formule sélectionnée

  // Natif avec RevenueCat configuré → achats in-app (Play Billing). Sinon web/Stripe.
  const native = Platform.OS !== 'web' && purchasesAvailable();

  // Charge les offres du store (prix localisés). Silencieux si l'offering est vide :
  // on retombe alors sur l'affichage statique 5€/mois.
  useEffect(() => {
    if (!native || isPremium) return;
    let alive = true;
    getPremiumPlans().then((list) => {
      if (!alive || !list.length) return;
      setPlans(list);
      setPlanId((list.find((p) => p.annual) || list[0]).id); // annuel par défaut
    });
    return () => { alive = false; };
  }, [native, isPremium]);

  const plan = plans.find((p) => p.id === planId) || null;
  const saving = yearlySavingPct(plans);

  // Natif : à l'ouverture, synchro RevenueCat → base (rattrape un webhook manquant).
  useEffect(() => {
    if (!native) return;
    syncRevenueCat().then((s) => { if (s?.active && !isPremium) onPurchased?.(); }).catch(() => {});
  }, [native]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resync live depuis Stripe à l'ouverture (web uniquement — le natif passe par RC).
  useEffect(() => {
    if (!isPremium || native) return;
    let alive = true;
    refreshSubscription()
      .then((s) => { if (alive) setSub({ cancelAtPeriodEnd: !!s.cancelAtPeriodEnd, currentPeriodEnd: s.currentPeriodEnd }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [isPremium, native]);

  // Bouton Premium : natif → Play Billing (RevenueCat) ; web → Stripe.
  async function onPremiumPress() {
    if (isPremium) {
      // Gérer / annuler : Play Store (natif) ou portail Stripe (web).
      if (native) { Linking.openURL(PLAY_SUBSCRIPTIONS_URL); return; }
      setPortalError(''); setPortalBusy(true);
      try { const { url } = await getBillingPortal(); await Linking.openURL(url); }
      catch (e) { setPortalError(e.message || 'Could not open the billing portal'); }
      finally { setPortalBusy(false); }
      return;
    }
    // Souscrire.
    if (native) {
      setPortalError(''); setPortalBusy(true);
      try {
        const ok = await buyPremium(plan);
        if (ok) {
          // Synchro directe RevenueCat → base, sans attendre le webhook, puis reload.
          await syncRevenueCat().catch(() => {});
          onPurchased?.();
        }
      } catch (e) {
        // Annulation utilisateur : pas une erreur, on n'affiche rien.
        if (e?.userCancelled !== true) setPortalError(e?.message || 'Purchase failed.');
      } finally { setPortalBusy(false); }
      return;
    }
    Linking.openURL(PREMIUM_URL); // web → Stripe
  }

  // Restaurer un achat précédent (obligatoire sur les stores).
  async function onRestore() {
    setPortalError(''); setPortalBusy(true);
    try {
      const ok = await restorePurchases();
      if (ok) {
        await syncRevenueCat().catch(() => {}); // écrit rc_expires_at sans attendre le webhook
        onPurchased?.();
      } else {
        // Même sans entitlement côté SDK, on tente la synchro serveur (au cas où
        // RevenueCat a l'achat mais le SDK local est en cache).
        const s = await syncRevenueCat().catch(() => null);
        if (s?.active) onPurchased?.();
        else setPortalError('No previous purchase found.');
      }
    } catch (e) { setPortalError(e?.message || 'Restore failed.'); }
    finally { setPortalBusy(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Hero */}
        <View style={{ backgroundColor: COLORS.jiayou, paddingTop: 16, paddingBottom: 60, paddingHorizontal: 16 }}>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 }}>
              <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.9)" />
              <Text style={{ color: 'rgba(255,255,255,0.9)', fontWeight: '600' }}>Back</Text>
            </Pressable>
          ) : null}
          <View style={{ alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 12 }}>
              <Ionicons name="flash" size={13} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 12 }}>Simple pricing</Text>
            </View>
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800', textAlign: 'center' }}>Unlock your Chinese potential</Text>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13.5, textAlign: 'center', marginTop: 6 }}>
              Start free, upgrade when you're ready. Cancel anytime.
            </Text>
          </View>
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 24, backgroundColor: '#f8f9fa', borderTopLeftRadius: 24, borderTopRightRadius: 24 }} />
        </View>

        <View style={{ width: '100%', maxWidth: 460, alignSelf: 'center', paddingHorizontal: 16, marginTop: 18 }}>
          {/* ── Premium (featured) ── */}
          <View style={{ backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden', marginBottom: 16, ...SHADOW_CARD }}>
            <LinearGradient colors={['#0d6efd', '#0a58ca']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 18 }}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 17, marginBottom: 4 }}>Premium</Text>
              {/* Prix : celui du store si dispo (localisé + à jour), sinon le tarif web. */}
              <Text style={{ color: '#fff', fontSize: 34, fontWeight: '800' }}>{plan ? plan.priceString : '5€'}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12.5 }}>{plan ? plan.period : 'per month'}</Text>
            </LinearGradient>
            <View style={{ padding: 18 }}>
              {/* Choix de la formule (natif + offering configurée). */}
              {plans.length > 1 && !isPremium ? (
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                  {plans.map((p) => {
                    const on = p.id === planId;
                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => setPlanId(p.id)}
                        style={{
                          flex: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center',
                          borderWidth: 2, borderColor: on ? COLORS.jiayou : '#e6e8eb',
                          backgroundColor: on ? COLORS.jiayouContainer : '#fff',
                        }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '700', color: on ? COLORS.jiayou : '#1d1d1f' }}>{p.label}</Text>
                        <Text style={{ fontSize: 15, fontWeight: '800', color: on ? COLORS.jiayou : '#1d1d1f', marginTop: 2 }}>{p.priceString}</Text>
                        {p.annual && saving ? (
                          <View style={{ marginTop: 5, backgroundColor: COLORS.success, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                            <Text style={{ color: '#fff', fontSize: 10.5, fontWeight: '700' }}>Save {saving}%</Text>
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              {sub.cancelAtPeriodEnd ? (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#fff8e1', borderRadius: 12, padding: 12, marginBottom: 14 }}>
                  <Ionicons name="time-outline" size={18} color="#b8860b" />
                  <Text style={{ flex: 1, fontSize: 13, color: '#7a5c00', lineHeight: 18, fontWeight: '600' }}>
                    Your Premium is set to cancel. You keep access until {fmtDate(sub.currentPeriodEnd)} — resume anytime below.
                  </Text>
                </View>
              ) : null}
              {PREMIUM_FEATURES.map((f, i) => <FeatureRow key={i} f={f} last={i === PREMIUM_FEATURES.length - 1} />)}
              <Pressable
                onPress={onPremiumPress}
                disabled={portalBusy}
                style={{ marginTop: 18, borderRadius: 999, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, backgroundColor: COLORS.jiayou, opacity: portalBusy ? 0.7 : 1 }}
              >
                {portalBusy ? <ActivityIndicator color="#fff" size="small" /> : (
                  <>
                    <Ionicons name={isPremium ? 'settings' : 'rocket'} size={16} color="#fff" />
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
                      {isPremium ? 'Manage subscription' : `Start Premium — ${plan ? plan.priceString : '€5/mo'}`}
                    </Text>
                  </>
                )}
              </Pressable>
              {portalError ? (
                <Text style={{ textAlign: 'center', color: COLORS.danger, fontSize: 12.5, marginTop: 8, fontWeight: '600' }}>{portalError}</Text>
              ) : null}
              {native && !isPremium ? (
                <Pressable onPress={onRestore} disabled={portalBusy} style={{ marginTop: 10, alignItems: 'center' }}>
                  <Text style={{ color: COLORS.jiayou, fontSize: 12.5, fontWeight: '600' }}>Restore purchases</Text>
                </Pressable>
              ) : null}
              <Text style={{ textAlign: 'center', color: COLORS.muted, fontSize: 11.5, marginTop: 10 }}>
                <Ionicons name={native ? 'logo-google-playstore' : 'globe-outline'} size={11} color={COLORS.muted} />  {native ? 'Billed through Google Play · Cancel anytime' : 'Managed on jiayou.fr · Cancel anytime'}
              </Text>
              {/* Clé RevenueCat de test : aucun paiement réel n'a lieu. */}
              {native && isTestStore() ? (
                <Text style={{ textAlign: 'center', color: '#b8860b', fontSize: 11, marginTop: 6, fontWeight: '700' }}>
                  Sandbox mode — purchases are simulated
                </Text>
              ) : null}
            </View>
          </View>

          {/* ── Free ── */}
          <View style={{ backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden', marginBottom: 20, ...SHADOW_CARD }}>
            <View style={{ padding: 18, borderBottomWidth: 1, borderColor: '#f2f2f4' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View>
                  <Text style={{ color: '#1d1d1f', fontWeight: '700', fontSize: 17, marginBottom: 4 }}>Free</Text>
                  <Text style={{ color: '#1d1d1f', fontSize: 34, fontWeight: '800' }}>0€</Text>
                  <Text style={{ color: '#888', fontSize: 12.5 }}>forever</Text>
                </View>
                {!isPremium ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#e8ecf0', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Ionicons name="checkmark-circle" size={13} color={COLORS.success} />
                    <Text style={{ color: '#555', fontWeight: '600', fontSize: 11.5 }}>Current plan</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <View style={{ padding: 18 }}>
              {FREE_FEATURES.map((f, i) => <FeatureRow key={i} f={f} last={i === FREE_FEATURES.length - 1} />)}
              <View style={{ marginTop: 18, borderRadius: 999, paddingVertical: 13, alignItems: 'center', backgroundColor: '#f1f3f5' }}>
                <Text style={{ color: COLORS.muted, fontWeight: '700' }}>{isPremium ? 'Free plan' : 'Your current plan'}</Text>
              </View>
            </View>
          </View>

          {/* FAQ */}
          <Text style={{ textAlign: 'center', fontWeight: '700', fontSize: 16, color: '#1d1d1f', marginBottom: 8 }}>
            Frequently asked questions
          </Text>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 16, ...SHADOW_CARD }}>
            {FAQ.map((f, i) => <FaqItem key={i} q={f.q} a={f.a} />)}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
