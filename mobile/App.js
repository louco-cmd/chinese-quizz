import './global.css';
import { useEffect, useState, useCallback } from 'react';
import { View, ActivityIndicator, AppState, BackHandler, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { getToken, setToken, getMe, getUnseenEnvelopes, markEnvelopesSeen, completeTutorial, savePushToken, getPendingRef, setPendingRef, clearPendingRef } from './src/api';
import { configurePurchases } from './src/purchases';
import { registerForPush, configureNotificationHandler } from './src/push';
import { LangContext, makeT } from './src/i18n';
import useKeyboardOpen from './src/useKeyboardOpen';
import Header from './src/components/Header';
import TabBar from './src/components/TabBar';
import LoginScreen from './src/screens/LoginScreen';
import TeachersScreen from './src/screens/TeachersScreen';
import CollectionScreen from './src/screens/CollectionScreen';
import AddWordScreen from './src/screens/AddWordScreen';
import QuizScreen from './src/screens/QuizScreen';
import DuelsScreen from './src/screens/DuelsScreen';
import AccountScreen from './src/screens/AccountScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import BankScreen from './src/screens/BankScreen';
import PricingScreen from './src/screens/PricingScreen';
import StoreScreen from './src/screens/StoreScreen';
import CreatePackScreen from './src/screens/CreatePackScreen';
import ImportWordsScreen from './src/screens/ImportWordsScreen';
import SupportScreen from './src/screens/SupportScreen';
import LegalScreen from './src/screens/LegalScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import TutorialScreen from './src/screens/TutorialScreen';
import TeacherHome from './src/screens/teacher/TeacherHome';
import WritingPracticeScreen from './src/screens/WritingPracticeScreen';
import TeacherTutorialScreen from './src/screens/teacher/TeacherTutorialScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import ResetPasswordScreen from './src/screens/ResetPasswordScreen';
import WelcomePremiumScreen from './src/screens/WelcomePremiumScreen';
import { RedEnvelopeReceivedPopup } from './src/components/RedEnvelopePopups';

export default function App() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState('add'); // page d'accueil = Add words
  const [bankReturn, setBankReturn] = useState('add');
  const [quizPack, setQuizPack] = useState(null); // pack à quizzer (depuis store/account)
  const [editPack, setEditPack] = useState(null); // pack à éditer (create-pack pré-rempli)

  // Lance un quiz sur un pack possédé → onglet Quiz, popup de réglages pré-rempli.
  const startPackQuiz = (pack) => { setQuizPack(pack); setTab('quiz'); };
  // Édite un pack créé → page create-pack pré-remplie.
  const startEditPack = (detail) => { setEditPack(detail); setTab('create-pack'); };

  // Profil + aiguillage onboarding/tutoriel.
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [flow, setFlow] = useState(null); // null | 'onboarding' | 'tutorial'
  const [flowFromSettings, setFlowFromSettings] = useState(false);
  const [duelDefeat, setDuelDefeat] = useState(false); // duel perdu → header + fond rouge

  // Flux d'auth hors connexion + entrées par URL (web) : reset password, retour Stripe.
  const [authView, setAuthView] = useState('login'); // 'login' | 'forgot' | 'reset'
  const [resetToken, setResetToken] = useState(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [envelopes, setEnvelopes] = useState([]); // red envelopes non vues
  const [lang, setLang] = useState('en'); // langue de l'interface (en | zh)
  const [refCode, setRefCode] = useState(null); // code de parrainage capté (?ref=)
  // Web mobile : le clavier réduit la zone visible et la TabBar recouvrirait le
  // bas du contenu (champ de réponse du quiz…) → on la masque le temps de la saisie.
  const kbOpen = useKeyboardOpen();

  // Charge le profil et calcule l'aiguillage initial (sauf si `route:false`,
  // p.ex. quand on rejoue un flow depuis les réglages).
  const loadProfile = useCallback(async ({ route = true } = {}) => {
    setProfileLoading(true);
    try {
      const me = await getMe();
      setProfile(me);
      configurePurchases(me.id); // lie les achats in-app (RevenueCat) au compte
      // Enregistre le token de push natif (no-op sur web / build sans le module).
      registerForPush().then((tok) => { if (tok) savePushToken(tok).catch(() => {}); }).catch(() => {});
      if (route) {
        if (!me.onboarding_done) setFlow('onboarding');
        else if (!me.has_seen_tutorial) setFlow(me.role === 'teacher' ? 'teacher-tutorial' : 'tutorial');
        else setFlow(null);
        // Red envelopes reçues à révéler (utilisateur déjà onboardé).
        if (me.onboarding_done) {
          getUnseenEnvelopes()
            .then((d) => { if (d.envelopes?.length) setEnvelopes(d.envelopes); })
            .catch(() => {});
        }
      }
      return me;
    } catch {
      return null; // échec réseau → pas de flow imposé, l'app reste utilisable
    } finally {
      setProfileLoading(false);
    }
  }, []);

  // Rafraîchit UNIQUEMENT le solde/plan (léger), sans la logique de routage de
  // loadProfile. Le solde change depuis beaucoup d'endroits (quiz, duel, capture,
  // achat pack, enveloppe) → sinon le header reste souvent en retard.
  const refreshBalance = useCallback(() => {
    getMe()
      .then((me) => setProfile((p) => (p ? { ...p, balance: me.balance, plan: me.plan, isPremium: me.isPremium } : p)))
      .catch(() => {});
  }, []);

  // À chaque navigation (changement d'onglet) et au retour au premier plan.
  useEffect(() => { if (authed) refreshBalance(); }, [tab, authed, refreshBalance]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active' && authed) refreshBalance(); });
    return () => sub.remove();
  }, [authed, refreshBalance]);

  // Détecte les entrées par URL sur web (lien email de reset, retour de paiement Stripe).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location) return;
    try {
      const url = new URL(window.location.href);
      const token = url.searchParams.get('token') || url.searchParams.get('reset_token');
      if (url.pathname.includes('reset-password') && token) {
        setResetToken(token); setAuthView('reset');
      } else if (url.pathname.includes('welcome-jiayou-premium') || url.searchParams.get('session_id')) {
        setShowWelcome(true);
      }
      // Parrainage : ?ref=CODE → on persiste (survit au redirect Google OAuth) et
      // on retire le paramètre de l'URL pour ne pas le rejouer.
      const ref = url.searchParams.get('ref');
      if (ref) {
        setPendingRef(ref);
        setRefCode(ref);
        if (window.history?.replaceState) {
          url.searchParams.delete('ref');
          window.history.replaceState({}, '', url.pathname + url.search + url.hash);
        }
      }
    } catch { /* ignore URL invalide */ }
  }, []);

  // Hydrate le code de parrainage persisté (si l'utilisateur revient après le
  // redirect Google, la query a disparu mais le storage le conserve).
  useEffect(() => { getPendingRef().then((r) => { if (r) setRefCode(r); }); }, []);

  function clearUrl() {
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState({}, '', '/');
    }
  }

  useEffect(() => { configureNotificationHandler(); }, []);

  useEffect(() => {
    getToken().then((t) => {
      setAuthed(!!t);
      setReady(true);
      if (t) loadProfile();
    });
  }, [loadProfile]);

  // Langue de l'interface = interface_lang du profil.
  useEffect(() => {
    if (profile?.interface_lang === 'en' || profile?.interface_lang === 'zh') setLang(profile.interface_lang);
  }, [profile]);

  async function onLoggedIn() {
    setAuthed(true);
    setTab('add');
    await loadProfile();
  }

  async function logout() {
    await setToken(null);
    setAuthed(false);
    setProfile(null);
    setFlow(null);
    setFlowFromSettings(false);
    setTab('add');
  }

  const backToSettings = () => { setFlowFromSettings(false); setFlow(null); setTab('settings'); };

  // Fin de l'onboarding : enchaîne vers le tutoriel pour un nouveau compte,
  // ou revient aux réglages si rejoué depuis là.
  async function onOnboardingDone(role) {
    if (flowFromSettings) { backToSettings(); return; }
    // Le code de parrainage a été transmis au backend par l'onboarding : on purge.
    clearPendingRef(); setRefCode(null);
    const me = await loadProfile({ route: false });
    // Compte fraîchement créé → on lance le tutoriel SAUF si on sait POSITIVEMENT
    // qu'il a déjà été vu. Si le refetch a échoué (réseau instable), `me` est null
    // → on le montre quand même plutôt que de le sauter par erreur. Les profs ont
    // leur propre tutoriel (auparavant sauté à tort ici).
    if (me?.has_seen_tutorial === true) { setFlow(null); return; }
    setFlow(role === 'teacher' ? 'teacher-tutorial' : 'tutorial');
  }

  async function onTutorialDone() {
    await loadProfile({ route: false });
    if (flowFromSettings) backToSettings();
    else setFlow(null);
  }

  // Le tuto prof n'appelle pas completeTutorial lui-même : on marque "vu" ici pour
  // qu'il ne se relance pas à chaque ouverture (sauf rejoué depuis les réglages).
  async function onTeacherTutorialDone() {
    if (!flowFromSettings) { try { await completeTutorial(); } catch { /* non bloquant */ } }
    await loadProfile({ route: false });
    if (flowFromSettings) backToSettings();
    else setFlow(null);
  }

  function handleSettingsOpen(name) {
    if (name === 'tutorial' || name === 'onboarding' || name === 'teacher-tutorial') {
      setFlowFromSettings(true);
      setFlow(name);
      return;
    }
    setBankReturn('settings');
    setTab(name);
  }

  // ── Retour matériel Android (bouton / geste depuis le bord) ──
  // Sur web le navigateur gère l'historique ; sur natif rien n'interceptait le
  // retour → l'app se fermait. On mappe ici chaque écran vers son parent, comme
  // les boutons « Back ». Les écrans à état interne (quiz/duel en cours, liste de
  // la collection…) enregistrent leur PROPRE handler : RN les appelle en premier
  // (ordre LIFO) et n'arrive ici que s'ils n'ont pas consommé le retour.
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const onBack = () => {
      // 1) Overlays d'abord.
      if (envelopes.length > 0) { markEnvelopesSeen().catch(() => {}); setEnvelopes([]); return true; }
      if (showWelcome) return true; // page de bienvenue paiement : on reste
      // 2) Onboarding / tutoriel : on ne quitte jamais l'app par erreur.
      if (flow) { if (flowFromSettings) backToSettings(); return true; }
      // 3) Écran de login : laisser le comportement par défaut (quitter).
      if (!authed) return false;
      // 4) Plateforme prof : ses onglets gèrent leur propre retour.
      if (profile?.role === 'teacher') return false;
      // 5) Sous-écrans → parent (miroir de leurs boutons onBack).
      const PARENTS = { settings: 'account', account: 'add', writing: 'settings', 'create-pack': 'store' };
      if (PARENTS[tab]) { setTab(PARENTS[tab]); return true; }
      if (['bank', 'pricing', 'teachers', 'import', 'support', 'legal'].includes(tab)) {
        setTab(bankReturn || 'add'); return true;
      }
      // 6) Onglet principal (store/collection/quiz/duels) → accueil (Add Word).
      if (tab !== 'add') { setTab('add'); return true; }
      // 7) Accueil : comportement par défaut (quitter l'app).
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [tab, flow, flowFromSettings, authed, profile, showWelcome, envelopes, bankReturn]); // eslint-disable-line react-hooks/exhaustive-deps

  function renderScreen() {
    switch (tab) {
      case 'teachers': return <TeachersScreen onBack={() => setTab(bankReturn)} />;
      case 'collection': return <CollectionScreen />;
      case 'add': return <AddWordScreen onBalanceChanged={refreshBalance} />;
      case 'quiz': return <QuizScreen onOpenStore={() => { setBankReturn('quiz'); setTab('store'); }} initialPack={quizPack} onInitialConsumed={() => setQuizPack(null)} onBalanceChanged={refreshBalance} />;
      case 'duels': return <DuelsScreen onDefeat={setDuelDefeat} />;
      case 'account': return <AccountScreen onLogout={logout} onNavigate={setTab} onStartQuiz={startPackQuiz} />;
      case 'settings': return <SettingsScreen onLogout={logout} onOpen={handleSettingsOpen} onBack={() => setTab('account')} isPremium={!!profile?.isPremium} />;
      case 'bank': return <BankScreen onBack={() => setTab(bankReturn)} />;
      case 'pricing': return <PricingScreen onBack={() => setTab(bankReturn)} isPremium={!!profile?.isPremium} onPurchased={() => loadProfile({ route: false })} />;
      case 'store': return <StoreScreen onCreate={() => { setEditPack(null); setTab('create-pack'); }} onStartQuiz={startPackQuiz} onEditPack={startEditPack} />;
      case 'create-pack': return <CreatePackScreen editPack={editPack} onBack={() => { setEditPack(null); setTab('store'); }} onCreated={() => { setEditPack(null); setTab('store'); }} />;
      case 'import': return <ImportWordsScreen onBack={() => setTab(bankReturn)} onDone={() => setTab('add')} />;
      case 'writing': return <WritingPracticeScreen onBack={() => setTab('settings')} />;
      case 'support': return <SupportScreen onBack={() => setTab(bankReturn)} />;
      case 'legal': return <LegalScreen onBack={() => setTab(bankReturn)} />;
      default: return <CollectionScreen />;
    }
  }

  const spinner = (
    <View className="flex-1 items-center justify-center bg-white">
      <ActivityIndicator color="#0d6efd" />
    </View>
  );

  function renderBody() {
    if (!ready) return spinner;

    // Reset password (lien email) : accessible connecté ou non.
    if (authView === 'reset') {
      return <ResetPasswordScreen token={resetToken} onDone={() => { clearUrl(); setResetToken(null); setAuthView('login'); }} />;
    }

    if (!authed) {
      if (authView === 'forgot') return <ForgotPasswordScreen onBack={() => setAuthView('login')} />;
      return <LoginScreen onLoggedIn={onLoggedIn} onForgot={() => setAuthView('forgot')} />;
    }

    // Retour de paiement Stripe.
    if (showWelcome) {
      return <WelcomePremiumScreen onDone={() => { clearUrl(); setShowWelcome(false); loadProfile({ route: false }); }} />;
    }

    if (flow === 'onboarding') {
      return (
        <OnboardingScreen
          initial={{ name: profile?.name }}
          refCode={refCode}
          onDone={onOnboardingDone}
          onClose={flowFromSettings ? backToSettings : undefined}
        />
      );
    }
    if (flow === 'tutorial') {
      return (
        <TutorialScreen
          onDone={onTutorialDone}
          onClose={flowFromSettings ? backToSettings : undefined}
        />
      );
    }
    if (flow === 'teacher-tutorial') {
      return (
        <TeacherTutorialScreen
          onDone={onTeacherTutorialDone}
          onClose={flowFromSettings ? backToSettings : undefined}
        />
      );
    }
    if (profileLoading && !profile) return spinner;

    // Professeur : plateforme dédiée (onglets Classes/Students/Profile).
    if (profile?.role === 'teacher') {
      return <TeacherHome profile={profile} onLogout={logout} onReplayFlow={handleSettingsOpen} />;
    }

    return (
      <View className="flex-1" style={{ backgroundColor: duelDefeat ? '#fbeceb' : '#f8f9fa' }}>
        <Header
          profile={profile}
          bg={duelDefeat ? '#c0392b' : undefined}
          onAccount={() => setTab(tab === 'account' ? 'settings' : 'account')}
          accountIcon={tab === 'account' ? 'settings-outline' : 'person-circle'}
          onLogo={() => setTab('add')}
          onBalance={() => { if (tab !== 'bank') { setBankReturn(tab); setTab('bank'); } }}
          onPlan={() => { if (tab !== 'pricing') { setBankReturn(tab); setTab('pricing'); } }}
          hideLogo={tab === 'add'}
        />
        <View className="flex-1">{renderScreen()}</View>
        {/* Barre masquée au clavier et sur les pages secondaires plein écran
            (réglages, abonnement). Fondu coupé sur Add Word (fond dégradé). */}
        {/* On masque la barre au clavier UNIQUEMENT là où un champ est en bas
            (quiz, recherche de collection…). Sur l'accueil (Add Word) le champ de
            recherche est en HAUT : masquer toute la barre + le chat à chaque focus
            donnait l'impression que la nav-bar « disparaissait » par intermittence. */}
        {(kbOpen && tab !== 'add') || tab === 'settings' || tab === 'pricing' || tab === 'import' ? null : (
          <TabBar active={tab} onChange={setTab} showChar={tab === 'add'} />
        )}
      </View>
    );
  }

  return (
    <LangContext.Provider value={{ lang, t: makeT(lang), setLang }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {renderBody()}
        <RedEnvelopeReceivedPopup
          visible={envelopes.length > 0}
          envelopes={envelopes}
          onClose={() => { markEnvelopesSeen().catch(() => {}); setEnvelopes([]); }}
        />
      </SafeAreaProvider>
    </LangContext.Provider>
  );
}
