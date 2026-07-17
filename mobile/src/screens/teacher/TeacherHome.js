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
import { COLORS } from '../../theme';

const TABS = [
  { key: 'profile', icon: 'person-circle', label: 'Profile' },
  { key: 'classes', icon: 'easel', label: 'Classes' },
  { key: 'students', icon: 'bar-chart', label: 'Students' },
];

function TeacherHeader({ onSettings, onLogo, insetTop, plan }) {
  const label = plan === 'premium' ? 'PREMIUM' : plan === 'guest' ? 'GUEST' : 'FREE';
  const badgeColor = plan === 'premium' ? COLORS.jiayou : '#585858';
  return (
    <View style={{ paddingTop: insetTop }} className="bg-jiayou">
      <View className="flex-row items-center justify-between px-4 h-14">
        <View className="flex-row items-center gap-2.5">
          <Pressable onPress={onLogo} hitSlop={6} className="flex-row items-center gap-2.5">
            <Text className="text-white font-extrabold text-[22px]">加油</Text>
            <Text className="text-white font-bold text-[19px]">Mentor</Text>
          </Pressable>
          <View className="rounded-full px-3 py-1 bg-white" style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)' }}>
            <Text style={{ color: badgeColor, fontSize: 11.5, fontWeight: '700' }}>{label}</Text>
          </View>
        </View>
        <Pressable onPress={onSettings} hitSlop={10}><Ionicons name="settings-outline" size={22} color="#fff" /></Pressable>
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
export default function TeacherHome({ profile, onLogout }) {
  const insets = useSafeAreaInsets();
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
      <TeacherHeader onSettings={() => setView({ type: 'settings' })} onLogo={() => changeTab('classes')} insetTop={insets.top} plan={profile?.plan} />
      <View className="flex-1">{content}</View>
      <TeacherTabBar active={tab} onChange={changeTab} insetBottom={insets.bottom} maxWidth={tabMaxWidth} />
    </View>
  );
}
