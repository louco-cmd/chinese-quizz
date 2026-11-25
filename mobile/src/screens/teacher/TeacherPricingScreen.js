import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useWindowDimensions } from 'react-native';
import { useFonts, LaBelleAurore_400Regular } from '@expo-google-fonts/la-belle-aurore';
import { Button } from '../../ui';
import { COLORS, SHADOW_CARD, TAB_CLEARANCE } from '../../theme';
import { buyTeacherPro, getTeacherProPlans, restorePurchases, purchasesAvailable, yearlySavingPct } from '../../purchases';
import { syncRevenueCat } from '../../api';

const PLAY_SUBSCRIPTIONS_URL = 'https://play.google.com/store/account/subscriptions';

// Page « Mentor Pro » — pendant prof de PricingScreen (élève). teacher_pro est un
// abonnement DIGITAL → même règle stores que le premium élève : IAP sur natif,
// Stripe sur web. Les PRODUITS (Stripe + RevenueCat `teacher_pro`) ne sont pas
// encore créés → le CTA d'achat est volontairement neutralisé (« bientôt »).
// Quand les produits existeront : brancher buyTeacherPro()/createTeacherCheckout()
// sur onSubscribe, comme PricingScreen. Cf. mémoire teacher-freemium.

const PRO_FEATURES = [
  { icon: 'sparkles', kind: 'yes', t: 'AI lesson recap', s: 'Auto summary + vocabulary after each class' },
  { icon: 'pricetag', kind: 'yes', t: '7% commission', s: 'On paid lessons — half the free rate' },
  { icon: 'infinite', kind: 'inf', t: 'Unlimited everything', s: 'Classes, students, tasks — no caps' },
  { icon: 'star', kind: 'yes', t: 'Priority in the directory', s: 'Stand out to students browsing teachers' },
];
const FREE_FEATURES = [
  { icon: 'infinite', kind: 'inf', t: 'Unlimited classes & students', s: 'No headcount limit' },
  { icon: 'videocam', kind: 'yes', t: 'Video lessons', s: 'Trials, bookings and in-app visio' },
  { icon: 'document-text', kind: 'lim', t: 'Manual end-of-course', s: 'No AI recap — you write it yourself' },
  { icon: 'pricetag', kind: 'lim', t: '15% commission', s: 'On paid lessons' },
];
const ICON_BG = {
  inf: { bg: '#e8f0ff', fg: COLORS.jiayou },
  yes: { bg: '#e8f5e9', fg: COLORS.success },
  lim: { bg: '#fff3cd', fg: '#b8860b' },
};

function FeatureRow({ f, last }) {
  const c = ICON_BG[f.kind] || ICON_BG.yes;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: last ? 0 : 1, borderColor: '#f2f2f4' }}>
      <View style={{ width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
        <Ionicons name={f.icon} size={16} color={c.fg} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: '#1d1d1f' }}>{f.t}</Text>
        <Text style={{ fontSize: 12, color: '#8a8a8e', marginTop: 1 }}>{f.s}</Text>
      </View>
    </View>
  );
}

export default function TeacherPricingScreen({ isPro = false, onPurchased }) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 760;
  const [fontsLoaded] = useFonts({ LaBelleAurore_400Regular });

  // Achat in-app réellement dispo (clé RevenueCat + module natif dans ce build).
  const native = Platform.OS !== 'web' && purchasesAvailable();
  const [plans, setPlans] = useState([]);       // offres RevenueCat (natif)
  const [planId, setPlanId] = useState(null);   // formule sélectionnée
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Offering teacher_pro : prix localisés du store (mensuel + annuel). Silencieux
  // si l'offering est vide → on retombe sur l'affichage statique $25/mois.
  useEffect(() => {
    if (!native || isPro) return;
    let alive = true;
    getTeacherProPlans().then((list) => {
      if (!alive || !list.length) return;
      setPlans(list);
      setPlanId((list.find((p) => p.annual) || list[0]).id); // annuel par défaut
    }).catch(() => {});
    return () => { alive = false; };
  }, [native, isPro]);

  // À l'ouverture : synchro RevenueCat → base (rattrape un webhook manquant).
  useEffect(() => {
    if (!native) return;
    syncRevenueCat().then((s) => { if (s?.teacherActive && !isPro) onPurchased?.(); }).catch(() => {});
  }, [native]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = plans.find((p) => p.id === planId) || null;
  const saving = yearlySavingPct(plans);

  // Natif → Play Billing (RevenueCat). Jamais de fallback Stripe en natif (interdit
  // stores + « silent success »). Web → Stripe teacher_pro pas encore branché.
  async function onSubscribe() {
    if (isPro) { if (native) Linking.openURL(PLAY_SUBSCRIPTIONS_URL); return; }
    if (!native) { setErr('Teacher billing on the web is coming soon.'); return; }
    setErr(''); setBusy(true);
    try {
      const ok = await buyTeacherPro(plan);
      if (ok) { await syncRevenueCat().catch(() => {}); onPurchased?.(); } // écrit teacher_pro_expires_at sans attendre le webhook
    } catch (e) {
      if (e?.userCancelled !== true) setErr(e?.message || 'Purchase failed. Please try again.');
    } finally { setBusy(false); }
  }

  // Restaurer un achat précédent (obligatoire sur les stores).
  async function onRestore() {
    setErr(''); setBusy(true);
    try {
      const ok = await restorePurchases();
      if (ok) { await syncRevenueCat().catch(() => {}); onPurchased?.(); }
      else {
        const s = await syncRevenueCat().catch(() => null);
        if (s?.teacherActive) onPurchased?.();
        else setErr('No previous purchase found.');
      }
    } catch (e) { setErr(e?.message || 'Restore failed.'); }
    finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <ScrollView contentContainerStyle={{ paddingBottom: TAB_CLEARANCE }}>
        {/* Hero — slogan cursif (La Belle Aurore), comme la page premium élève. */}
        <View style={{ backgroundColor: COLORS.jiayou, paddingTop: 16, paddingBottom: 28, paddingHorizontal: 16 }}>
          <View style={{ alignItems: 'center', marginTop: 8 }}>
            <Text
              // Police cursive à grandes hampes/jambages : lineHeight généreux
              // (~1.4×) + pas de scaling système → évite le rognage vertical du
              // texte sur certains mobiles (accessibilité grande police).
              allowFontScaling={false}
              style={{
                color: '#fff',
                fontFamily: fontsLoaded ? 'LaBelleAurore_400Regular' : undefined,
                fontStyle: fontsLoaded ? 'normal' : 'italic',
                fontSize: 52, lineHeight: 74, textAlign: 'center', paddingHorizontal: 8,
              }}
            >
              Unlock your teaching
            </Text>
          </View>
        </View>

        <View style={{ width: '100%', maxWidth: isDesktop ? 940 : 460, alignSelf: 'center', paddingHorizontal: 16, marginTop: 18 }}>
          <View style={{ flexDirection: isDesktop ? 'row-reverse' : 'column', alignItems: isDesktop ? 'stretch' : 'flex-start', gap: isDesktop ? 20 : 0, marginBottom: 20 }}>

            {/* ── Pro (featured) ── */}
            <View style={{ flex: isDesktop ? 1 : undefined, width: isDesktop ? undefined : '100%', backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden', marginBottom: isDesktop ? 0 : 16, ...SHADOW_CARD }}>
              <LinearGradient colors={['#0d6efd', '#0a58ca']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 18 }}>
                {!isPro ? <Text style={{ color: '#fff', fontWeight: '700', fontSize: 17, marginBottom: 4 }}>Mentor Pro</Text> : null}
                {isPro ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 2 }}>
                    <Ionicons name="checkmark-circle" size={24} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>Pro active</Text>
                  </View>
                ) : (
                  <>
                    <Text style={{ color: '#fff', fontSize: 34, fontWeight: '800' }}>{plan ? plan.priceString : '$25'}</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12.5 }}>{plan ? plan.period : 'per month'}</Text>
                  </>
                )}
              </LinearGradient>
              <View style={{ padding: 18 }}>
                {PRO_FEATURES.map((f, i) => <FeatureRow key={i} f={f} last={i === PRO_FEATURES.length - 1} />)}
                {/* Choix de la formule (natif + offering ≥ 2 packages). */}
                {plans.length > 1 && !isPro ? (
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                    {plans.map((p) => {
                      const on = p.id === planId;
                      return (
                        <Pressable
                          key={p.id}
                          onPress={() => setPlanId(p.id)}
                          style={{
                            flex: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center',
                            borderWidth: 2, borderColor: on ? COLORS.jiayou : '#e6e8eb',
                            backgroundColor: on ? '#e8f0ff' : '#fff',
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
                {/* CTA : natif → Play Billing (RevenueCat) ; web → bientôt (Stripe à venir). */}
                <Button
                  onPress={onSubscribe}
                  loading={busy}
                  disabled={!native && !isPro}
                  icon={isPro ? 'settings-outline' : 'rocket'}
                  title={isPro ? 'Manage subscription' : native ? `Subscribe${plan ? ` — ${plan.priceString}` : ''}` : 'Coming soon'}
                  fullWidth
                  style={{ marginTop: 18, justifyContent: 'center' }}
                />
                {err ? (
                  <Text style={{ textAlign: 'center', color: COLORS.danger, fontSize: 12, marginTop: 8 }}>{err}</Text>
                ) : null}
                {native && !isPro ? (
                  <Pressable onPress={onRestore} hitSlop={6} style={{ marginTop: 10, alignItems: 'center' }}>
                    <Text style={{ color: COLORS.muted, fontSize: 12.5, fontWeight: '700' }}>Restore purchase</Text>
                  </Pressable>
                ) : null}
                {!native && !isPro ? (
                  <Text style={{ textAlign: 'center', color: COLORS.muted, fontSize: 11.5, marginTop: 10, lineHeight: 17 }}>
                    Teacher billing on the web is being set up. Subscribe from the mobile app for now.
                  </Text>
                ) : null}
              </View>
            </View>

            {/* ── Free ── */}
            <View style={{ flex: isDesktop ? 1 : undefined, width: isDesktop ? undefined : '100%', backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden', ...SHADOW_CARD }}>
              <View style={{ padding: 18, borderBottomWidth: 1, borderColor: '#f2f2f4' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View>
                    <Text style={{ color: '#1d1d1f', fontWeight: '700', fontSize: 17, marginBottom: 4 }}>Free</Text>
                    <Text style={{ color: '#1d1d1f', fontSize: 34, fontWeight: '800' }}>$0</Text>
                    <Text style={{ color: '#888', fontSize: 12.5 }}>forever</Text>
                  </View>
                  {!isPro ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#e8ecf0', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <Ionicons name="checkmark-circle" size={13} color={COLORS.success} />
                      <Text style={{ color: '#555', fontWeight: '600', fontSize: 11.5 }}>Current plan</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <View style={{ padding: 18, flex: isDesktop ? 1 : undefined }}>
                {FREE_FEATURES.map((f, i) => <FeatureRow key={i} f={f} last={i === FREE_FEATURES.length - 1} />)}
                <View style={{ marginTop: isDesktop ? 'auto' : 18, borderRadius: 999, paddingVertical: 13, alignItems: 'center', backgroundColor: '#f1f3f5' }}>
                  <Text style={{ color: COLORS.muted, fontWeight: '700' }}>{isPro ? 'Free plan' : 'Your current plan'}</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={{ marginTop: 4, alignItems: 'center', paddingBottom: 8 }}>
            <Text style={{ color: COLORS.mutedLight, fontSize: 11.5, textAlign: 'center', lineHeight: 17, paddingHorizontal: 8 }}>
              Commission applies to lessons students pay for in the app (coming later).
              Free video lessons never take a fee.
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <Pressable onPress={() => Linking.openURL('https://app.jiayou.fr/legal')} hitSlop={6}>
                <Text style={{ color: COLORS.jiayou, fontSize: 12.5, fontWeight: '700' }}>Terms</Text>
              </Pressable>
              <Text style={{ color: COLORS.mutedLight, fontSize: 12.5 }}>·</Text>
              <Pressable onPress={() => Linking.openURL('https://app.jiayou.fr/privacy')} hitSlop={6}>
                <Text style={{ color: COLORS.jiayou, fontSize: 12.5, fontWeight: '700' }}>Privacy</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
