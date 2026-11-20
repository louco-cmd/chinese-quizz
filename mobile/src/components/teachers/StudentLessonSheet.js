import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Alert, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from '../../ui/BottomSheet';
import { Button } from '../../ui';
import CatLoader from '../CatLoader';
import { ErrorRetry } from '../ErrorRetry';
import { cancelSlotBooking, rescheduleSlotBooking, getStudentSlots } from '../../api';
import { COLORS } from '../../theme';

const START_EARLY_MS = 15 * 60 * 1000;
const REJOIN_MS = 10 * 60 * 1000;

function fmtSession(iso) {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}
const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

// Drawer d'actions sur un cours visio à venir (côté ÉLÈVE) : rejoindre (si c'est
// l'heure), REPROGRAMMER (vers un créneau ouvert du prof) ou ANNULER. Miroir du
// LessonDetailSheet côté prof (reschedule + cancel).
export default function StudentLessonSheet({ lesson, visible, onClose, onJoin, onCancelled, teacherId }) {
  const [mode, setMode] = useState('view'); // view | reschedule | confirm_cancel
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(null);     // créneau choisi pour la reprog
  const [slots, setSlots] = useState(null);
  const [err, setErr] = useState('');

  const tId = lesson?.teacher_id || teacherId || null;

  // Recharge quand on ouvre l'écran de reprog.
  const loadSlots = useCallback(() => {
    if (!tId) return;
    setErr(''); setSlots(null);
    getStudentSlots(tId).then((r) => setSlots(r.slots || [])).catch((e) => setErr(e.message));
  }, [tId]);
  useEffect(() => { if (visible && mode === 'reschedule') loadSlots(); }, [visible, mode, loadSlots]);
  // Réinitialise à la fermeture / changement de cours.
  useEffect(() => { if (!visible) { setMode('view'); setSel(null); setBusy(false); } }, [visible]);

  const groups = useMemo(() => {
    const m = new Map();
    (slots || []).forEach((s) => {
      const d = new Date(s.starts_at);
      const key = d.toDateString();
      if (!m.has(key)) m.set(key, { date: d, items: [] });
      m.get(key).items.push(s);
    });
    return [...m.values()];
  }, [slots]);

  if (!lesson) return null;
  const now = Date.now();
  const st = new Date(lesson.starts_at).getTime();
  const en = new Date(lesson.ends_at).getTime();
  const joinable = now >= st - START_EARLY_MS && now <= en + REJOIN_MS;
  const started = now >= st - START_EARLY_MS; // trop tard pour reprogrammer
  const name = lesson.other_name || lesson.teacher_name || 'your teacher';
  const trial = (lesson.note || '').toLowerCase() === 'trial';

  async function doCancel() {
    setBusy(true);
    try {
      await cancelSlotBooking(lesson.id);
      setMode('view'); onClose?.(); onCancelled?.();
    } catch (e) {
      Alert.alert('', e.message || 'This lesson can no longer be cancelled.');
    } finally { setBusy(false); }
  }

  async function doReschedule() {
    if (!sel) return;
    setBusy(true);
    try {
      await rescheduleSlotBooking(lesson.id, sel);
      setMode('view'); setSel(null); onClose?.(); onCancelled?.();
    } catch (e) {
      const msg = e.taken ? 'This slot was just taken — pick another.' : (e.message || 'Could not reschedule.');
      Alert.alert('', msg); loadSlots(); setSel(null);
    } finally { setBusy(false); }
  }

  return (
    <BottomSheet visible={visible} onClose={() => { setMode('view'); setSel(null); onClose?.(); }} maxHeightRatio={mode === 'reschedule' ? 0.88 : 0.6}>
      <View style={{ alignItems: 'center', marginBottom: 18 }}>
        <View style={{ width: 54, height: 54, borderRadius: 14, backgroundColor: '#e3f0ff', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="videocam" size={26} color={COLORS.jiayou} />
        </View>
        <Text style={{ fontSize: 17, fontWeight: '800', color: '#1a1a2e', marginTop: 12, textAlign: 'center' }}>{fmtSession(lesson.starts_at)}</Text>
        <Text style={{ fontSize: 13, color: COLORS.muted, marginTop: 3 }}>with {name}{trial ? ' · Trial' : ''}</Text>
      </View>

      {/* ── Confirmation d'annulation ──────────────────────────────── */}
      {mode === 'confirm_cancel' ? (
        <>
          <Text style={{ fontSize: 13.5, color: COLORS.muted, textAlign: 'center', marginBottom: 16, lineHeight: 19 }}>
            Cancel this lesson? The slot will be freed and your teacher notified.
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Keep it" variant="secondary" onPress={() => setMode('view')} style={{ flex: 1, justifyContent: 'center' }} />
            <Button title="Cancel lesson" variant="danger" loading={busy} onPress={doCancel} style={{ flex: 1, justifyContent: 'center' }} />
          </View>
        </>
      ) : mode === 'reschedule' ? (
        /* ── Reprogrammation : choisir un créneau ouvert du prof ────── */
        <>
          <Text style={{ fontSize: 13, fontWeight: '800', color: '#1a1a2e', textAlign: 'center' }}>Pick a new time</Text>
          <Text style={{ fontSize: 11.5, color: COLORS.mutedLight, textAlign: 'center', marginTop: 2, marginBottom: 12 }}>The current slot will be freed.</Text>
          {err ? <ErrorRetry error={err} onRetry={loadSlots} />
            : !slots ? <View style={{ paddingVertical: 24, alignItems: 'center' }}><CatLoader size={70} /></View>
              : groups.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: 22 }}>
                  <Ionicons name="calendar-clear-outline" size={28} color={COLORS.mutedLight} />
                  <Text style={{ fontSize: 13, color: COLORS.mutedLight, textAlign: 'center', marginTop: 8 }}>No other open slot right now.</Text>
                </View>
              ) : (
                <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                  {groups.map((g, i) => (
                    <View key={i} style={{ marginBottom: 14 }}>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.mutedLight, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>{fmtDay(g.date)}</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {g.items.map((s) => {
                          const on = sel === s.starts_at;
                          return (
                            <Pressable key={s.starts_at} onPress={() => setSel(on ? null : s.starts_at)}
                              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 999, backgroundColor: on ? COLORS.jiayou : COLORS.jiayouSoft, borderWidth: 1, borderColor: on ? COLORS.jiayou : '#cfe0ff' }}>
                              <Ionicons name={on ? 'checkmark' : 'time'} size={13} color={on ? '#fff' : COLORS.jiayou} />
                              <Text style={{ fontSize: 13.5, fontWeight: '800', color: on ? '#fff' : COLORS.jiayou }}>{fmtTime(s.starts_at)}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <Button title="Back" variant="secondary" onPress={() => { setMode('view'); setSel(null); }} style={{ flex: 1, justifyContent: 'center' }} />
            <Button title="Confirm new time" icon="checkmark-circle" loading={busy} disabled={!sel} onPress={doReschedule} style={{ flex: 2, justifyContent: 'center' }} />
          </View>
        </>
      ) : (
        /* ── Vue principale : Join / Reschedule / Cancel ───────────── */
        <View style={{ gap: 10 }}>
          {joinable ? (
            <Button title="Join the video call" icon="videocam" onPress={() => { onClose?.(); onJoin?.(lesson.id); }} fullWidth />
          ) : null}
          {tId && !started ? (
            <Button title="Reschedule" variant="secondary" icon="calendar-outline" onPress={() => setMode('reschedule')} fullWidth />
          ) : null}
          <Button title="Cancel this lesson" variant="danger" icon="close-circle-outline" onPress={() => setMode('confirm_cancel')} fullWidth />
        </View>
      )}
    </BottomSheet>
  );
}
