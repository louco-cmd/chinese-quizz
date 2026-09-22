import './global.css';
import { useEffect, useState, useCallback, useRef } from 'react';
import { View, ActivityIndicator, AppState, BackHandler, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { getToken, setToken, getMe, getUnseenEnvelopes, markEnvelopesSeen, completeTutorial, savePushToken, getPendingRef, setPendingRef, clearPendingRef, setUpgradeHandler, setCoinsHandler, setUnauthorizedHandler, getTrophies, markIgPromoSeen } from './src/api';
import { configurePurchases } from './src/purchases';
import { registerForPush, configureNotificationHandler, addNotificationResponseListener } from './src/push';
import { LangContext, makeT } from './src/i18n';
import { initSentry, wrapApp } from './src/sentry';

// Initialise Sentry le plus tôt possible (avant le premier rendu). No-op si le
// module natif ou le DSN est absent (voir src/sentry.js).
initSentry();
import useKeyboardOpen from './src/useKeyboardOpen';
import Header from './src/components/Header';
import VerifyEmailBanner from './src/components/VerifyEmailBanner';
import TabBar from './src/components/TabBar';
import LoginScreen from './src/screens/LoginScreen';
import TeachersScreen from './src/screens/TeachersScreen';
import CollectionScreen from './src/screens/CollectionScreen';
import AddWordScreen from './src/screens/AddWordScreen';
import QuizScreen from './src/screens/QuizScreen';
import DuelsScreen from './src/screens/DuelsScreen';
import AccountScreen from './src/screens/AccountScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import TrophiesScreen from './src/screens/TrophiesScreen';
import BankScreen from './src/screens/BankScreen';
import PricingScreen from './src/screens/PricingScreen';
import StoreScreen from './src/screens/StoreScreen';
import CreatePackScreen from './src/screens/CreatePackScreen';
import ImportWordsScreen from './src/screens/ImportWordsScreen';
import SupportScreen from './src/screens/SupportScreen';
import LegalScreen from './src/screens/LegalScreen';
import { TERMS_BLOCKS, PRIVACY_BLOCKS, CREDITS_BLOCKS } from './src/data/legalContent';
import OnboardingScreen from './src/screens/OnboardingScreen';
import TutorialScreen from './src/screens/TutorialScreen';
import TeacherHome from './src/screens/teacher/TeacherHome';
import WritingPracticeScreen from './src/screens/WritingPracticeScreen';
import TeacherTutorialScreen from './src/screens/teacher/TeacherTutorialScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import ResetPasswordScreen from './src/screens/ResetPasswordScreen';
import WelcomePremiumScreen from './src/screens/WelcomePremiumScreen';
import { RedEnvelopeReceivedPopup } from './src/components/RedEnvelopePopups';
import PremiumLimitPopup from './src/components/PremiumLimitPopup';
import EarnCoinsPopup from './src/components/EarnCoinsPopup';
import UpdateAvailablePopup from './src/components/UpdateAvailablePopup';
import TrophyUnlockedSheet from './src/components/TrophyUnlockedSheet';
import InstagramPromoSheet from './src/components/InstagramPromoSheet';
import { checkStoreUpdate } from './src/appUpdate';
import CatLoader from './src/components/CatLoader';

function App() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState('add'); // page d'accueil = Add words
  const [bankReturn, setBankReturn] = useState('add');
  const [quizPack, setQuizPack] = useState(null); // pack à quizzer (depuis store/account)
  const [editPack, setEditPack] = useState(null); // pack à éditer (create-pack pré-rempli)
  const [duelDeepLink, setDuelDeepLink] = useState(null); // id de duel à ouvrir en détail (depuis une notif)
  const [storeSort, setStoreSort] = useState(null); // tri imposé au JiaStore (notif « nouveau pack » → recent)

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
  const [paywall, setPaywall] = useState(null); // feature de la limite atteinte → popup Go Premium
  const [needCoins, setNeedCoins] = useState(false); // solde insuffisant → popup « gagner des pièces »
  const [trophyQueue, setTrophyQueue] = useState([]); // trophées fraîchement débloqués → drawer
  const [showIg, setShowIg] = useState(false); // drawer « suivez-nous sur Instagram » (1×/user)
  const igHandledRef = useRef(false);
  const [updateUrl, setUpdateUrl] = useState(null); // build store plus récent → popup incitative
  const [lang, setLang] = useState('en'); // langue de l'interface (en | zh | fr)
  const [refCode, setRefCode] = useState(null); // code de parrainage capté (?ref=)
  // Web mobile : le clavier réduit la zone visible et la TabBar recouvrirait le
  // bas du contenu (champ de réponse du quiz…) → on la masque le temps de la saisie.
  const kbOpen = useKeyboardOpen();

  // Paywall global : toute réponse API portant `upgradeRequired` (limites du plan
  // gratuit : mots, duels, quiz, packs…) ouvre la popup « Go Premium », au-dessus
  // de toutes les autres popups. Enregistré une fois au montage.
  useEffect(() => {
    setUpgradeHandler((feature) => setPaywall(feature || 'default'));
    setCoinsHandler(() => setNeedCoins(true));
    // Token expiré/invalide sur un appel authentifié → déconnexion propre (retour
    // au login) au lieu d'une session fantôme. `logout` est hoisté (function decl).
    setUnauthorizedHandler(() => { logout(); });
    return () => { setUpgradeHandler(null); setCoinsHandler(null); setUnauthorizedHandler(null); };
  }, []);

  // Une fois par lancement : si un build store plus récent existe, on propose la
  // mise à jour (non bloquant). Tout échec est silencieux (checkStoreUpdate → null).
  useEffect(() => {
    checkStoreUpdate().then((url) => { if (url) setUpdateUrl(url); });
  }, []);

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

  // Trophées : /api/m/trophies débloque à la lecture et renvoie `newlyUnlocked`.
  // On enrichit chaque nouveau trophée de son unité (pour le libellé) et on ouvre
  // le drawer d'obtention. Appelé après une activité (fin de quiz/duel) et au boot.
  const checkTrophies = useCallback(async () => {
    try {
      const d = await getTrophies();
      const fresh = d?.newlyUnlocked || [];
      if (!fresh.length) return;
      const unitByCat = Object.fromEntries((d.categories || []).map((c) => [c.key, c.unit]));
      setTrophyQueue(fresh.map((x) => ({ ...x, unit: x.unit || unitByCat[x.cat] })));
      if (d.balance != null) setProfile((p) => (p ? { ...p, balance: d.balance } : p));
    } catch { /* silencieux */ }
  }, []);

  // À chaque navigation (changement d'onglet) et au retour au premier plan.
  useEffect(() => { if (authed) refreshBalance(); }, [tab, authed, refreshBalance]);
  // Au boot (une fois connecté) : ramasse les trophées débloqués hors-session.
  useEffect(() => { if (authed) checkTrophies(); }, [authed, checkTrophies]);

  // Drawer Instagram : éligible côté serveur (showIgPromo = compte ≥ 3 j, jamais vu).
  // On l'affiche une fois, hors onboarding et sans empiler d'autres overlays.
  const dismissIg = useCallback(() => {
    setShowIg(false);
    markIgPromoSeen().catch(() => {});
    setProfile((p) => (p ? { ...p, showIgPromo: false } : p));
  }, []);
  useEffect(() => {
    if (igHandledRef.current || !authed || flow) return;
    if (!profile?.showIgPromo || !profile?.onboarding_done) return;
    if (trophyQueue.length || envelopes.length || showWelcome) return;
    igHandledRef.current = true;
    setShowIg(true);
  }, [authed, flow, profile, trophyQueue, envelopes, showWelcome]);
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

  // Routage des notifications tapées → écran ciblé (au lieu d'ouvrir toujours la
  // home). Le backend envoie `data.type` (+ ids) : cf. notify() côté serveur.
  useEffect(() => {
    const cleanup = addNotificationResponseListener((data) => {
      const type = data?.type;
      if ((type === 'duel_result' || type === 'duel_reminder') && data.duelId) {
        setDuelDeepLink(Number(data.duelId)); // ouvre le détail du duel (résultat ou à jouer)
        setTab('duels');
      } else if (type === 'duel_new' || type === 'duel_expired') {
        setTab('duels');
      } else if (type === 'pack_new') {
        setStoreSort('recent'); // atterrit sur le JiaStore, tri « nouveautés »
        setTab('store');
      } else if (type === 'pack_sold') {
        setTab('store');
      } else if (type === 'red_envelope' || type === 'reengage') {
        setTab('add'); // enveloppes en popup / relance inactif → home
      }
    });
    return cleanup;
  }, []);

  useEffect(() => {
    getToken().then((t) => {
      setAuthed(!!t);
      setReady(true);
      if (t) loadProfile();
    });
  }, [loadProfile]);

  // Langue de l'interface = interface_lang du profil. Dépendance sur la VALEUR
  // interface_lang (pas l'objet profil) : sinon refreshBalance — qui recrée le
  // profil à chaque changement d'onglet en gardant l'ancienne langue — annulait
  // le choix fait en direct dans les réglages (retour à l'ancienne langue).
  useEffect(() => {
    if (['en', 'zh', 'fr'].includes(profile?.interface_lang)) setLang(profile.interface_lang);
  }, [profile?.interface_lang]);

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
      if (showIg) { dismissIg(); return true; }
      if (trophyQueue.length > 0) { setTrophyQueue([]); return true; }
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
      if (['bank', 'pricing', 'teachers', 'import', 'support', 'legal', 'terms', 'privacy', 'credits', 'trophies'].includes(tab)) {
        setTab(bankReturn || 'add'); return true;
      }
      // 6) Onglet principal (store/collection/quiz/duels) → accueil (Add Word).
      if (tab !== 'add') { setTab('add'); return true; }
      // 7) Accueil : comportement par défaut (quitter l'app).
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [tab, flow, flowFromSettings, authed, profile, showWelcome, envelopes, bankReturn, trophyQueue, showIg]); // eslint-disable-line react-hooks/exhaustive-deps

  function renderScreen() {
    switch (tab) {
      case 'teachers': return <TeachersScreen onBack={() => setTab(bankReturn)} />;
      case 'collection': return <CollectionScreen onNavigate={setTab} onOpenCredits={() => { setBankReturn('collection'); setTab('credits'); }} />;
      case 'add': return <AddWordScreen onBalanceChanged={refreshBalance} />;
      case 'quiz': return <QuizScreen onOpenStore={() => { setBankReturn('quiz'); setTab('store'); }} onCapture={() => setTab('add')} initialPack={quizPack} onInitialConsumed={() => setQuizPack(null)} onBalanceChanged={refreshBalance} onNavigate={setTab} onActivityDone={checkTrophies} />;
      case 'duels': return <DuelsScreen onDefeat={setDuelDefeat} emailVerified={profile?.emailVerified} onCapture={() => setTab('add')} onOpenStore={() => { setBankReturn('duels'); setTab('store'); }} initialDetailDuelId={duelDeepLink} onDeepLinkConsumed={() => setDuelDeepLink(null)} onActivityDone={checkTrophies} />;
      case 'account': return <AccountScreen onLogout={logout} onNavigate={setTab} onStartQuiz={startPackQuiz} onOpenTrophies={() => { setBankReturn('account'); setTab('trophies'); }} />;
      case 'settings': return <SettingsScreen onLogout={logout} onOpen={handleSettingsOpen} onBack={() => setTab('account')} isPremium={!!profile?.isPremium} />;
      case 'trophies': return <TrophiesScreen onBack={() => setTab(bankReturn || 'settings')} />;
      case 'bank': return <BankScreen onBack={() => setTab(bankReturn)} />;
      case 'pricing': return <PricingScreen onBack={() => setTab(bankReturn)} isPremium={!!profile?.isPremium} onPurchased={() => loadProfile({ route: false })} />;
      case 'store': return <StoreScreen onCreate={() => { setEditPack(null); setTab('create-pack'); }} canCreate onStartQuiz={startPackQuiz} onEditPack={startEditPack} onUpgrade={() => { setBankReturn('store'); setTab('pricing'); }} initialSort={storeSort} onSortConsumed={() => setStoreSort(null)} />;
      case 'create-pack': return <CreatePackScreen editPack={editPack} learningLang={profile?.learning_lang || 'zh'} nativeLang={profile?.native_lang || 'en'} onBack={() => { setEditPack(null); setTab('store'); }} onCreated={() => { setEditPack(null); setTab('store'); }} />;
      case 'import': return <ImportWordsScreen onBack={() => setTab(bankReturn)} onDone={() => setTab('add')} />;
      case 'writing': return <WritingPracticeScreen onBack={() => setTab('settings')} />;
      case 'support': return <SupportScreen onBack={() => setTab(bankReturn)} />;
      case 'legal': return <LegalScreen onBack={() => setTab(bankReturn)} />;
      case 'terms': return <LegalScreen onBack={() => setTab(bankReturn)} title={makeT(lang)('set_terms')} blocks={TERMS_BLOCKS} />;
      case 'privacy': return <LegalScreen onBack={() => setTab(bankReturn)} title={makeT(lang)('set_privacy_policy')} blocks={PRIVACY_BLOCKS} />;
      case 'credits': return <LegalScreen onBack={() => setTab(bankReturn)} title={makeT(lang)('set_credits')} blocks={CREDITS_BLOCKS} />;
      default: return <CollectionScreen />;
    }
  }

  const spinner = (
    <View className="flex-1 items-center justify-center bg-white">
      <CatLoader size={200} />
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
        {/* Rappel non bloquant de vérification d'email (masqué si vérifié / OAuth). */}
        {profile && profile.emailVerified === false ? <VerifyEmailBanner /> : null}
        <View className="flex-1">{renderScreen()}</View>
        {/* Barre masquée au clavier et sur les pages secondaires plein écran
            (réglages, abonnement). Fondu coupé sur Add Word (fond dégradé). */}
        {/* On masque la barre au clavier UNIQUEMENT là où un champ est en bas
            (quiz, recherche de collection…). Sur l'accueil (Add Word) le champ de
            recherche est en HAUT : masquer toute la barre + le chat à chaque focus
            donnait l'impression que la nav-bar « disparaissait » par intermittence. */}
        {(kbOpen && tab !== 'add') || tab === 'settings' || tab === 'import'
          || tab === 'legal' || tab === 'terms' || tab === 'privacy' || tab === 'support' || tab === 'credits' ? null : (
          // On garde la nav-bar sur Add Word même clavier ouvert, mais on masque
          // le CHAT (showChar) tant que le clavier est là : sinon il chevauche le
          // champ de recherche (surtout en web mobile) et gêne la saisie.
          <TabBar active={tab} onChange={setTab} showChar={tab === 'add' && !kbOpen} />
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
        <PremiumLimitPopup
          feature={paywall}
          onClose={() => setPaywall(null)}
          onGoPremium={() => {
            setPaywall(null);
            if (tab !== 'pricing') { setBankReturn(tab); setTab('pricing'); }
          }}
        />
        <EarnCoinsPopup visible={needCoins} onClose={() => setNeedCoins(false)} />
        <UpdateAvailablePopup url={updateUrl} onClose={() => setUpdateUrl(null)} />
        <TrophyUnlockedSheet
          visible={trophyQueue.length > 0}
          trophies={trophyQueue}
          onClose={() => setTrophyQueue([])}
          onViewAll={() => { setTrophyQueue([]); setBankReturn(tab); setTab('trophies'); }}
        />
        <InstagramPromoSheet visible={showIg} onClose={dismissIg} onFollow={dismissIg} />
      </SafeAreaProvider>
    </LangContext.Provider>
  );
}

// Enveloppé par Sentry (ErrorBoundary + capture des crashs). Dégrade en App brut
// si Sentry est indisponible (build sans le module natif / DSN non configuré).
export default wrapApp(App);
