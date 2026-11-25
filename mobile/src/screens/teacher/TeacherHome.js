import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, useWindowDimensions, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TeacherDashboardScreen from './TeacherDashboardScreen';
import TeacherClassScreen from './TeacherClassScreen';
import TeacherTaskScreen from './TeacherTaskScreen';
import TeacherAgendaScreen from './TeacherAgendaScreen';
import TeacherProfileScreen from './TeacherProfileScreen';
import TeacherSettingsScreen from './TeacherSettingsScreen';
import EndCourseScreen from './EndCourseScreen';
import SupportScreen from '../SupportScreen';
import LegalScreen from '../LegalScreen';
import BankScreen from '../BankScreen';
import StoreScreen from '../StoreScreen';
import CreatePackScreen from '../CreatePackScreen';
import TeachersScreen from '../TeachersScreen';
import MessagesScreen from '../MessagesScreen';
import NotificationsPopup from '../../components/NotificationsPopup';
import { getConversations, getNotifications, markNotificationsRead } from '../../api';
import QuizScreen from '../QuizScreen';
import PricingScreen from '../PricingScreen';
import TeacherPricingScreen from './TeacherPricingScreen';
import { COLORS } from '../../theme';
import useKeyboardOpen from '../../useKeyboardOpen';

const TABS = [
  { key: 'store', icon: 'storefront', label: 'JiaStore' },
  { key: 'classes', icon: 'easel', label: 'Classes' },
  { key: 'agenda', icon: 'calendar', label: 'Agenda' },
  { key: 'messages', icon: 'chatbubbles', label: 'Messages' },
  { key: 'profile', icon: 'person-circle', label: 'Profile' },
];

// Header prof — mêmes dimensions que le header étudiant (paddingVertical 16,
// logo 26px). Gauche : 加油 Mentor. Droite : pastille coins (→ Bank) + réglages.
function TeacherPlanBadge({ plan }) {
  const label = plan === 'pro' ? 'PRO' : plan === 'guest' ? 'GUEST' : 'FREE';
  const textColor = plan === 'pro' ? COLORS.jiayou : '#585858';
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)' }}>
      <Text style={{ color: textColor, fontSize: 13, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

function TeacherHeader({ onSettings, onLogo, onBank, onPlan, plan, insetTop, balance, onNotifNavigate }) {
  // Centre de notifications prof (même système que l'élève, notifs par user_id :
  // réservations, reprogrammations, messages, ventes de packs…).
  const [notifs, setNotifs] = useState([]);
  const [unread, setUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);

  const loadNotifs = useCallback(() => {
    getNotifications().then((d) => { setNotifs(d.notifications || []); setUnread(d.unread || 0); }).catch(() => {});
  }, []);
  useEffect(() => { loadNotifs(); }, [loadNotifs]);
  // Rafraîchit au retour de veille + toutes les 60 s.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') loadNotifs(); });
    const iv = setInterval(loadNotifs, 60000);
    return () => { sub.remove(); clearInterval(iv); };
  }, [loadNotifs]);

  function openNotifs() {
    setNotifOpen(true);
    if (unread > 0) { setUnread(0); markNotificationsRead().catch(() => {}); } // efface le badge
  }

  return (
    <View style={{ paddingTop: insetTop }} className="bg-jiayou">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={onLogo} hitSlop={6}>
            <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800' }}>加油!</Text>
          </Pressable>
          <Pressable onPress={onPlan} hitSlop={6}>
            <TeacherPlanBadge plan={plan} />
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Pressable
            onPress={onBank}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 }}
          >
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>{balance == null ? '…' : `${balance}₵`}</Text>
          </Pressable>
          {/* Cloche notifications + badge non-lu */}
          <Pressable onPress={openNotifs} hitSlop={8}>
            <Ionicons name="notifications" size={23} color="#fff" />
            {unread > 0 ? (
              <View style={{ position: 'absolute', top: -4, right: -5, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: '#e0322e', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: COLORS.jiayou }}>
                <Text style={{ color: '#fff', fontSize: 9.5, fontWeight: '800' }}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable onPress={onSettings} hitSlop={10}><Ionicons name="settings-outline" size={22} color="#fff" /></Pressable>
        </View>
      </View>

      <NotificationsPopup visible={notifOpen} notifications={notifs} onClose={() => setNotifOpen(false)}
        onNavigate={onNotifNavigate ? (n) => { setNotifOpen(false); onNotifNavigate(n); } : undefined} />
    </View>
  );
}

function TeacherTabBar({ active, onChange, insetBottom, maxWidth, badges = {} }) {
  return (
    <View style={{ paddingBottom: insetBottom }} className="bg-white border-t border-line-soft">
      {/* En desktop, boutons centrés (max-width) plutôt qu'étirés. */}
      <View style={{ flexDirection: 'row', width: '100%', maxWidth, alignSelf: 'center' }}>
        {TABS.map((t) => {
          const on = active === t.key;
          const badge = badges[t.key] || 0;
          return (
            <Pressable key={t.key} onPress={() => onChange(t.key)} className="flex-1 items-center py-2.5">
              <View>
                <Ionicons name={on ? t.icon : `${t.icon}-outline`} size={22} color={on ? COLORS.jiayou : '#9aa4b2'} />
                {badge ? (
                  <View style={{ position: 'absolute', top: -5, right: -10, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 999, backgroundColor: COLORS.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#fff' }}>
                    <Text style={{ color: '#fff', fontSize: 9.5, fontWeight: '800' }}>{badge > 99 ? '99+' : badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text className={`text-[11px] mt-0.5 ${on ? 'text-jiayou font-bold' : 'text-muted-light'}`}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// Conteneur de la plateforme prof : onglets (Classes/Students/Profile) +
// sous-vues (classe → task, réglages, support).
export default function TeacherHome({ profile, onLogout, onReplayFlow, onVideoCall, endCourse, onCloseEndCourse }) {
  const insets = useSafeAreaInsets();
  const kbOpen = useKeyboardOpen(); // web mobile : clavier ouvert → on masque la TabBar
  const { width } = useWindowDimensions();
  const tabMaxWidth = width >= 992 ? 460 : undefined;
  const [tab, setTab] = useState('classes');
  const [view, setView] = useState(null);
  const [unread, setUnread] = useState(0);
  const direction = profile?.quiz_direction || 'en→zh';

  // Compteur de messages non-lus pour la pastille de l'onglet Messages. Léger :
  // on rafraîchit au montage, quand l'app repasse active, à chaque bascule
  // d'onglet (la lecture dans l'onglet Messages remet à zéro), et un poll lent
  // (45 s) pendant que l'app est active — pas de requête en arrière-plan.
  const refreshUnread = useCallback(async () => {
    try { const d = await getConversations(); setUnread(d?.unread_total || 0); } catch { /* silencieux */ }
  }, []);
  useEffect(() => {
    refreshUnread();
    let timer = setInterval(refreshUnread, 45000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') { refreshUnread(); if (!timer) timer = setInterval(refreshUnread, 45000); }
      else if (timer) { clearInterval(timer); timer = null; }
    });
    return () => { if (timer) clearInterval(timer); sub.remove(); };
  }, [refreshUnread]);
  // Rafraîchit à chaque bascule d'onglet (ex. on quitte Messages après lecture).
  useEffect(() => { refreshUnread(); }, [tab, refreshUnread]);

  // Support / legal : plein écran (leur propre retour). Réglages : dans le shell
  // (header 加油 Mentor + tab bar conservés) — voir plus bas dans `content`.
  if (view?.type === 'support') {
    return <SupportScreen onBack={() => setView({ type: 'settings' })} />;
  }
  if (view?.type === 'legal') {
    return <LegalScreen onBack={() => setView({ type: 'settings' })} />;
  }

  // Classe / task restent DANS le shell (header + footer conservés).
  let content;
  if (view?.type === 'class') {
    content = (
      <TeacherClassScreen
        classId={view.id} direction={direction}
        onBack={() => setView(null)}
        onOpenTask={(lessonId) => setView({ type: 'task', lessonId, classId: view.id })}
      />
    );
  } else if (view?.type === 'task') {
    content = <TeacherTaskScreen lessonId={view.lessonId} direction={direction} onBack={() => setView({ type: 'class', id: view.classId })} />;
  } else if (view?.type === 'bank') {
    // Bank DANS le shell → header 加油 Mentor + tab bar conservés.
    content = <BankScreen onBack={() => setView(null)} />;
  } else if (view?.type === 'teachers') {
    // Liste des professeurs (même écran que côté élève), DANS le shell.
    content = <TeachersScreen onBack={() => setView({ type: 'settings' })} />;
  } else if (view?.type === 'settings') {
    // Réglages DANS le shell → header 加油 Mentor + tab bar conservés.
    content = (
      <TeacherSettingsScreen
        onBack={() => setView(null)}
        onLogout={onLogout}
        onOpenTeachers={() => setView({ type: 'teachers' })}
        onOpenSupport={() => setView({ type: 'support' })}
        onOpenLegal={() => setView({ type: 'legal' })}
        onReplayFlow={onReplayFlow}
      />
    );
  } else if (view?.type === 'create-pack') {
    content = (
      <CreatePackScreen
        editPack={view.editPack || null}
        onBack={() => setView(null)}
        onCreated={() => setView(null)}
      />
    );
  } else if (view?.type === 'quiz') {
    content = (
      <QuizScreen
        initialPack={view.pack}
        onInitialConsumed={() => {}}
        onOpenStore={() => setView(null)}
        onBalanceChanged={() => {}}
      />
    );
  } else if (view?.type === 'pricing') {
    content = <PricingScreen onBack={() => setView(null)} isPremium={!!profile?.isPremium} onPurchased={() => setView(null)} />;
  } else if (view?.type === 'teacher-pricing') {
    content = <TeacherPricingScreen onBack={() => setView(null)} isPro={!!profile?.isTeacherPro} />;
  } else if (tab === 'store') {
    // JiaStore côté prof : mêmes écrans que l'étudiant (parcourir / acheter /
    // créer-éditer des packs / quiz de pack).
    content = (
      <StoreScreen
        navOverlaps={false}
        onCreate={() => setView({ type: 'create-pack', editPack: null })}
        onEditPack={(d) => setView({ type: 'create-pack', editPack: d })}
        onStartQuiz={(pack) => setView({ type: 'quiz', pack })}
        onUpgrade={() => setView({ type: 'pricing' })}
      />
    );
  } else if (tab === 'agenda') {
    content = <TeacherAgendaScreen onVideoCall={onVideoCall} />;
  } else if (tab === 'messages') {
    // Messagerie prof ↔ élève : onglet du footer (retour → Classes).
    content = <MessagesScreen onBack={() => setTab('classes')} />;
  } else if (tab === 'profile') {
    content = <TeacherProfileScreen />;
  } else {
    content = <TeacherDashboardScreen teacherName={profile?.name} onOpenClass={(id) => setView({ type: 'class', id })} onOpenAgenda={() => { setView(null); setTab('agenda'); }} onVideoCall={onVideoCall} />;
  }

  // Page « fin de cours » : prioritaire sur l'onglet/sous-vue courante, mais DANS
  // le shell (header 加油 Mentor + tab bar conservés). Fermée via Back / après envoi.
  if (endCourse) {
    content = (
      <EndCourseScreen
        slot={endCourse}
        direction={direction}
        onClose={onCloseEndCourse}
        onSent={onCloseEndCourse}
      />
    );
  }

  // Un tap sur un onglet quitte la sous-vue classe/task (et la page fin de cours).
  const changeTab = (t) => { onCloseEndCourse?.(); setView(null); setTab(t); };

  return (
    <View className="flex-1 bg-surface-page">
      <TeacherHeader
        onSettings={() => setView({ type: 'settings' })}
        onLogo={() => changeTab('classes')}
        onBank={() => setView({ type: 'bank' })}
        onPlan={() => setView({ type: 'teacher-pricing' })}
        plan={profile?.isSpecialGuest ? 'guest' : (profile?.isTeacherPro ? 'pro' : 'free')}
        insetTop={insets.top}
        balance={profile?.balance}
        onNotifNavigate={(n) => {
          const t = n?.type || '';
          if (t === 'message') changeTab('messages');
          else if (/lesson|book|trial|slot/.test(t)) changeTab('agenda');
        }}
      />
      <View className="flex-1">{content}</View>
      {kbOpen ? null : <TeacherTabBar active={tab} onChange={changeTab} insetBottom={insets.bottom} maxWidth={tabMaxWidth} badges={{ messages: tab === 'messages' ? 0 : unread }} />}
    </View>
  );
}
