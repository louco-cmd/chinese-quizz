import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from '../../ui/BottomSheet';
import { Button } from '../../ui';
import { useT } from '../../i18n';
import { deleteTeacherLesson, updateTeacherLesson } from '../../api';
import { COLORS } from '../../theme';

// Drawer détail d'un cours côté PROF (Start meeting / Reschedule / Delete).
// Partagé entre l'Agenda et le Dashboard (« Start next Lesson ») → même UX.
// Props : lesson, visible, onClose, onSaved (reload), onStart (→ visio).

function localKey(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function hhmm(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
const HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 07:00 → 22:00
const START_EARLY_MS = 15 * 60 * 1000;
const REJOIN_MS = 10 * 60 * 1000;
function lessonJoinable(l, now) {
  const s = new Date(l.starts_at).getTime(), e = new Date(l.ends_at).getTime();
  return now >= s - START_EARLY_MS && now <= e + REJOIN_MS;
}
function lessonFinished(l, now) { return now > new Date(l.ends_at).getTime() + REJOIN_MS; }
function isTrial(l) { return (l.note || '').toLowerCase() === 'trial'; }

function TrialBadge({ t }) {
  return (
    <View style={{ backgroundColor: '#fff4e5', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1.5 }}>
      <Text style={{ fontSize: 9.5, fontWeight: '800', color: '#c77700', textTransform: 'uppercase', letterSpacing: 0.3 }}>{t('ag_trial')}</Text>
    </View>
  );
}

export default function LessonDetailSheet({ lesson, visible, onClose, onSaved, onStart }) {
  const { t, lang } = useT();
  const [mode, setMode] = useState('view'); // view | edit | reschedule | confirm_delete
  const [busy, setBusy] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newHour, setNewHour] = useState(9);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (visible && lesson) {
      setMode('view');
      setBusy(false);
      const s = new Date(lesson.starts_at);
      setNewDate(localKey(s));
      setNewHour(s.getHours());
      setNote(lesson.note || '');
    }
  }, [visible, lesson]);

  if (!lesson) return null;

  const s = new Date(lesson.starts_at);
  const e = new Date(lesson.ends_at);
  const trial = isTrial(lesson);
  const finished = lessonFinished(lesson, Date.now());
  const joinable = lessonJoinable(lesson, Date.now());

  async function doDelete() {
    setBusy(true);
    try { await deleteTeacherLesson(lesson.id); onSaved?.(); onClose?.(); }
    catch (err) { Alert.alert('', err.message || 'Error'); }
    finally { setBusy(false); }
  }

  async function doReschedule() {
    const [y, m, d] = newDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d, newHour, 0, 0);
    if (dt <= new Date()) { Alert.alert('', t('ag_past')); return; }
    setBusy(true);
    try {
      await updateTeacherLesson(lesson.id, { starts_at: dt.toISOString(), note: note.trim() });
      onSaved?.();
      onClose?.();
    } catch (err) { Alert.alert('', err.message || 'Error'); }
    finally { setBusy(false); }
  }

  const fmtDay = (d2) => {
    try { return d2.toLocaleDateString(lang === 'zh' ? 'zh-CN' : lang === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' }); }
    catch { return d2.toDateString(); }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeightRatio={0.75}>
      {/* ── Ecran principal : infos + Start meeting / Edit ──────────────── */}
      {mode === 'view' && (
        <>
          <View style={{ alignItems: 'center', marginBottom: 16 }}>
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: finished ? '#f4f5f7' : '#e8f0ff', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
              <Ionicons name="videocam" size={24} color={finished ? COLORS.mutedLight : COLORS.jiayou} />
            </View>
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a1a2e' }}>{lesson.student_name || 'Student'}</Text>
            {trial ? <View style={{ marginTop: 4 }}><TrialBadge t={t} /></View> : null}
            <Text style={{ fontSize: 14, color: COLORS.muted, marginTop: 4, textTransform: 'capitalize' }}>{fmtDay(s)}</Text>
            <Text style={{ fontSize: 22, fontWeight: '800', color: COLORS.jiayou, marginTop: 2 }}>{hhmm(s)} – {hhmm(e)}</Text>
            {lesson.note ? <Text style={{ fontSize: 13, color: COLORS.mutedLight, marginTop: 6 }}>{lesson.note}</Text> : null}
          </View>

          {!finished && (
            <View style={{ gap: 10 }}>
              {joinable && (
                <Button onPress={() => { onClose?.(); onStart?.(lesson); }} icon="videocam" title={t('ag_start_class')} fullWidth style={{ paddingVertical: 14 }} />
              )}
              <Button onPress={() => setMode('edit')} variant="secondary" icon="create-outline" title={t('ag_edit')} fullWidth style={{ paddingVertical: 14 }} textStyle={{ color: '#55607a', fontWeight: '800' }} />
            </View>
          )}
        </>
      )}

      {/* ── Ecran Edit : Reschedule / Delete ───────────────────────────── */}
      {mode === 'edit' && (
        <>
          <View style={{ alignItems: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a1a2e' }}>{t('ag_edit')}</Text>
            <Text style={{ fontSize: 13, color: COLORS.muted, marginTop: 4 }}>{lesson.student_name} · {hhmm(s)}</Text>
          </View>
          <View style={{ gap: 10 }}>
            <Button onPress={() => setMode('reschedule')} icon="calendar-outline" title={t('ag_reschedule')} fullWidth style={{ paddingVertical: 14 }} />
            <Pressable onPress={() => setMode('confirm_delete')} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 999, backgroundColor: '#fef2f2', borderWidth: 1.5, borderColor: '#fecaca' }}>
              <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
              <Text style={{ color: COLORS.danger, fontWeight: '800', fontSize: 15 }}>{t('ag_cancel_yes')}</Text>
            </Pressable>
            <Pressable onPress={() => setMode('view')} style={{ paddingVertical: 12, alignItems: 'center' }}>
              <Text style={{ fontWeight: '700', color: COLORS.muted }}>{t('common_back')}</Text>
            </Pressable>
          </View>
        </>
      )}

      {/* ── Reschedule : date + heure ──────────────────────────────────── */}
      {mode === 'reschedule' && (
        <>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a1a2e', textAlign: 'center', marginBottom: 4 }}>{t('ag_reschedule')}</Text>
          <Text style={{ fontSize: 13, color: COLORS.muted, textAlign: 'center', marginBottom: 16 }}>{t('ag_reschedule_sub')}</Text>

          <Text style={{ fontSize: 13, fontWeight: '700', color: '#55607a', marginBottom: 6 }}>{t('ag_new_date')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }} contentContainerStyle={{ gap: 8 }}>
            {Array.from({ length: 14 }, (_, i) => {
              const d2 = new Date(); d2.setDate(d2.getDate() + i + 1);
              const k = localKey(d2);
              const on = k === newDate;
              const dayName = (() => { try { return d2.toLocaleDateString(lang === 'zh' ? 'zh-CN' : lang === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'short' }).replace('.', ''); } catch { return ''; } })();
              return (
                <Pressable key={k} onPress={() => setNewDate(k)} style={{ width: 54, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: on ? COLORS.jiayou : '#f1f3f5' }}>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: on ? '#fff' : '#8a94a3', textTransform: 'uppercase' }}>{dayName}</Text>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: on ? '#fff' : '#1a1a2e', marginTop: 2 }}>{d2.getDate()}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={{ fontSize: 13, fontWeight: '700', color: '#55607a', marginBottom: 6 }}>{t('ag_hour')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 18 }} contentContainerStyle={{ gap: 8 }}>
            {HOURS.map((h) => {
              const on = h === newHour;
              return (
                <Pressable key={h} onPress={() => setNewHour(h)} style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: on ? COLORS.jiayou : '#f1f3f5' }}>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: on ? '#fff' : '#55607a' }}>{String(h).padStart(2, '0')}:00</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title={t('common_back')} variant="secondary" onPress={() => setMode('edit')} style={{ flex: 1, justifyContent: 'center' }} textStyle={{ color: COLORS.muted }} />
            <Button title={t('ag_save')} loading={busy} onPress={doReschedule} style={{ flex: 1, justifyContent: 'center' }} />
          </View>
        </>
      )}

      {/* ── Confirmation suppression ───────────────────────────────────── */}
      {mode === 'confirm_delete' && (
        <>
          <View style={{ alignItems: 'center', marginBottom: 16 }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#fef2f2', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
              <Ionicons name="alert-circle" size={28} color={COLORS.danger} />
            </View>
            <Text style={{ fontSize: 17, fontWeight: '800', color: '#1a1a2e', textAlign: 'center' }}>{t('ag_lesson_cancel_title')}</Text>
            <Text style={{ fontSize: 13, color: COLORS.muted, textAlign: 'center', marginTop: 6, lineHeight: 19 }}>
              {t('ag_lesson_cancel_confirm').replace('{name}', lesson.student_name || '')}
            </Text>
            <Text style={{ fontSize: 12, color: COLORS.mutedLight, textAlign: 'center', marginTop: 4 }}>{t('ag_notif_hint')}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title={t('common_back')} variant="secondary" onPress={() => setMode('edit')} style={{ flex: 1, justifyContent: 'center' }} textStyle={{ color: COLORS.muted }} />
            <Button title={t('ag_cancel_yes')} variant="danger" loading={busy} onPress={doDelete} style={{ flex: 1, justifyContent: 'center' }} />
          </View>
        </>
      )}
    </BottomSheet>
  );
}
