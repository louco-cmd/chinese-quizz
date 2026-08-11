import { useState } from 'react';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TeacherDashboardScreen from './TeacherDashboardScreen';
import TeacherClassScreen from './TeacherClassScreen';
import TeacherTaskScreen from './TeacherTaskScreen';
import TeacherStudentsScreen from './TeacherStudentsScreen';
import TeacherProfileScreen from './TeacherProfileScreen';
import TeacherSettingsScreen from './TeacherSettingsScreen';
import SupportScreen from '../SupportScreen';
import LegalScreen from '../LegalScreen';
import BankScreen from '../BankScreen';
import StoreScreen from '../StoreScreen';
import CreatePackScreen from '../CreatePackScreen';
import QuizScreen from '../QuizScreen';
import PricingScreen from '../PricingScreen';
import { COLORS } from '../../theme';
import useKeyboardOpen from '../../useKeyboardOpen';

const TABS = [
  { key: 'store', icon: 'storefront', label: 'JiaStore' },
  { key: 'classes', icon: 'easel', label: 'Classes' },
  { key: 'students', icon: 'bar-chart', label: 'Students' },
  { key: 'profile', icon: 'person-circle', label: 'Profile' },
];

// Header prof — mêmes dimensions que le header étudiant (paddingVertical 16,
// logo 26px). Gauche : 加油 Mentor. Droite : pastille coins (→ Bank) + réglages.
function TeacherHeader({ onSettings, onLogo, onBank, insetTop, balance }) {
  return (
    <View style={{ paddingTop: insetTop }} className="bg-jiayou">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16 }}>
        <Pressable onPress={onLogo} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800' }}>加油</Text>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>Mentor</Text>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Pressable
            onPress={onBank}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 }}
          >
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>{balance == null ? '…' : `${balance}₵`}</Text>
          </Pressable>
          <Pressable onPress={onSettings} hitSlop={10}><Ionicons name="settings-outline" size={22} color="#fff" /></Pressable>
        </View>
      </View>
    </View>
  );
}

function TeacherTabBar({ active, onChange, insetBottom, maxWidth }) {
  return (
    <View style={{ paddingBottom: insetBottom }} className="bg-white border-t border-line-soft">
      {/* En desktop, boutons centrés (max-width) plutôt qu'étirés. */}
      <View style={{ flexDirection: 'row', width: '100%', maxWidth, alignSelf: 'center' }}>
        {TABS.map((t) => {
          const on = active === t.key;
          return (
            <Pressable key={t.key} onPress={() => onChange(t.key)} className="flex-1 items-center py-2.5">
              <Ionicons name={on ? t.icon : `${t.icon}-outline`} size={22} color={on ? COLORS.jiayou : '#9aa4b2'} />
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
export default function TeacherHome({ profile, onLogout, onReplayFlow }) {
  const insets = useSafeAreaInsets();
  const kbOpen = useKeyboardOpen(); // web mobile : clavier ouvert → on masque la TabBar
  const { width } = useWindowDimensions();
  const tabMaxWidth = width >= 992 ? 460 : undefined;
  const [tab, setTab] = useState('classes');
  const [view, setView] = useState(null);
  const direction = profile?.quiz_direction || 'en→zh';

  // Réglages / support : plein écran (leur propre retour).
  if (view?.type === 'settings') {
    return (
      <TeacherSettingsScreen
        onBack={() => setView(null)}
        onLogout={onLogout}
        onOpenProfile={() => { setTab('profile'); setView(null); }}
        onOpenSupport={() => setView({ type: 'support' })}
        onOpenLegal={() => setView({ type: 'legal' })}
        onReplayFlow={onReplayFlow}
      />
    );
  }
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
    content = <TeacherTaskScreen lessonId={view.lessonId} onBack={() => setView({ type: 'class', id: view.classId })} />;
  } else if (view?.type === 'bank') {
    // Bank DANS le shell → header 加油 Mentor + tab bar conservés.
    content = <BankScreen onBack={() => setView(null)} />;
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
  } else if (tab === 'students') {
    content = <TeacherStudentsScreen />;
  } else if (tab === 'profile') {
    content = <TeacherProfileScreen />;
  } else {
    content = <TeacherDashboardScreen teacherName={profile?.name} onOpenClass={(id) => setView({ type: 'class', id })} />;
  }

  // Un tap sur un onglet quitte la sous-vue classe/task.
  const changeTab = (t) => { setView(null); setTab(t); };

  return (
    <View className="flex-1 bg-surface-page">
      <TeacherHeader
        onSettings={() => setView({ type: 'settings' })}
        onLogo={() => changeTab('classes')}
        onBank={() => setView({ type: 'bank' })}
        insetTop={insets.top}
        balance={profile?.balance}
      />
      <View className="flex-1">{content}</View>
      {kbOpen ? null : <TeacherTabBar active={tab} onChange={changeTab} insetBottom={insets.bottom} maxWidth={tabMaxWidth} />}
    </View>
  );
}
