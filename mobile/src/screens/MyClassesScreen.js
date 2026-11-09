import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, RefreshControl, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CoursePage from './CoursePage';
import StudentLessonRows from '../components/teachers/StudentLessonRows';
import CatLoader from '../components/CatLoader';
import { ErrorRetry } from '../components/ErrorRetry';
import { getStudentHistory } from '../api';
import { useT } from '../i18n';
import { Badge } from '../ui';
import { COLORS, SHADOW_CARD, TAB_CLEARANCE } from '../theme';

// Page « Mes cours » (Settings, BETA) : l'HISTORIQUE complet des cours reçus —
// terminés inclus, et profs quittés inclus (en lecture seule). Complète
// /student/classes qui ne montre que les tasks EN COURS des profs actifs.
export default function MyClassesScreen({ onBack }) {
  const { t } = useT();
  const [lessons, setLessons] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [course, setCourse] = useState(null); // { id, readOnly }

  const load = useCallback(async () => {
    setError('');
    try {
      const d = await getStudentHistory();
      setLessons(d.lessons || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Regroupe par prof ; un prof est « actif » si au moins une adhésion active.
  const groups = useMemo(() => {
    const m = new Map();
    (lessons || []).forEach((l) => {
      if (!m.has(l.teacher_id)) m.set(l.teacher_id, { teacher_id: l.teacher_id, teacher_name: l.teacher_name, active: false, lessons: [] });
      const g = m.get(l.teacher_id);
      g.lessons.push(l);
      if (l.membership === 'active') g.active = true;
    });
    return [...m.values()].sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
  }, [lessons]);

  if (course) {
    return <CoursePage lessonId={course.id} readOnly={course.readOnly} onBack={() => { setCourse(null); load(); }} />;
  }

  const Back = onBack ? (
    <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 }}>
      <Ionicons name="chevron-back" size={20} color={COLORS.jiayou} />
      <Text style={{ color: COLORS.jiayou, fontWeight: '600' }}>{t('tr_back') || 'Back'}</Text>
    </Pressable>
  ) : null;

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f9fa' }}><CatLoader size={110} /></View>;
  }
  if (error) {
    return <View style={{ flex: 1, backgroundColor: '#f8f9fa', padding: 16 }}>{Back}<ErrorRetry error={error} onRetry={load} /></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: 16, paddingBottom: TAB_CLEARANCE }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.jiayou} />}
      >
        <View style={{ width: '100%', maxWidth: 700, alignSelf: 'center', paddingHorizontal: 16 }}>
          {Back}
          <Text style={{ fontSize: 26, fontWeight: '800', color: '#1a1a2e' }}>📚 {t('mc_title')}</Text>
          <Text style={{ fontSize: 13, color: COLORS.muted, marginTop: 4, marginBottom: 16 }}>{t('mc_sub')}</Text>

          {groups.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 48 }}>
              <Text style={{ fontSize: 40 }}>🎒</Text>
              <Text style={{ color: COLORS.muted, marginTop: 10, textAlign: 'center' }}>{t('mc_empty')}</Text>
            </View>
          ) : groups.map((g) => (
            <View key={g.teacher_id} style={{ backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 14, ...SHADOW_CARD }}>
              {/* En-tête prof */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, paddingBottom: 4 }}>
                <Ionicons name="person-circle" size={18} color={g.active ? COLORS.jiayou : '#adb5bd'} />
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#1a1a2e', textTransform: 'uppercase', letterSpacing: 0.4 }}>{g.teacher_name}</Text>
                {!g.active ? <Badge tone="muted">{t('mc_ended')}</Badge> : null}
              </View>
              <StudentLessonRows lessons={g.lessons} onOpen={(l, readOnly) => setCourse({ id: l.id, readOnly })} t={t} />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
