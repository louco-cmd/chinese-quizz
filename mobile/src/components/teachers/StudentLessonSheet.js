import { useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from '../../ui/BottomSheet';
import { Button } from '../../ui';
import { cancelSlotBooking } from '../../api';
import { COLORS } from '../../theme';

const START_EARLY_MS = 15 * 60 * 1000;
const REJOIN_MS = 10 * 60 * 1000;

function fmtSession(iso) {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

// Drawer d'actions sur un cours visio à venir (côté ÉLÈVE) : rejoindre (si c'est
// l'heure) ou ANNULER la réservation. Miroir du LessonDetailSheet côté prof.
export default function StudentLessonSheet({ lesson, visible, onClose, onJoin, onCancelled }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!lesson) return null;
  const now = Date.now();
  const st = new Date(lesson.starts_at).getTime();
  const en = new Date(lesson.ends_at).getTime();
  const joinable = now >= st - START_EARLY_MS && now <= en + REJOIN_MS;
  const name = lesson.other_name || lesson.teacher_name || 'your teacher';
  const trial = (lesson.note || '').toLowerCase() === 'trial';

  async function doCancel() {
    setBusy(true);
    try {
      await cancelSlotBooking(lesson.id);
      setConfirming(false);
      onClose?.();
      onCancelled?.();
    } catch (e) {
      Alert.alert('', e.message || 'This lesson can no longer be cancelled.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={() => { setConfirming(false); onClose?.(); }} maxHeightRatio={0.6}>
      <View style={{ alignItems: 'center', marginBottom: 18 }}>
        <View style={{ width: 54, height: 54, borderRadius: 14, backgroundColor: '#e3f0ff', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="videocam" size={26} color={COLORS.jiayou} />
        </View>
        <Text style={{ fontSize: 17, fontWeight: '800', color: '#1a1a2e', marginTop: 12, textAlign: 'center' }}>{fmtSession(lesson.starts_at)}</Text>
        <Text style={{ fontSize: 13, color: COLORS.muted, marginTop: 3 }}>
          with {name}{trial ? ' · Trial' : ''}
        </Text>
      </View>

      {confirming ? (
        <>
          <Text style={{ fontSize: 13.5, color: COLORS.muted, textAlign: 'center', marginBottom: 16, lineHeight: 19 }}>
            Cancel this lesson? The slot will be freed and your teacher notified.
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Keep it" variant="secondary" onPress={() => setConfirming(false)} style={{ flex: 1, justifyContent: 'center' }} />
            <Button title="Cancel lesson" variant="danger" loading={busy} onPress={doCancel} style={{ flex: 1, justifyContent: 'center' }} />
          </View>
        </>
      ) : (
        <View style={{ gap: 10 }}>
          {joinable ? (
            <Button title="Join the video call" icon="videocam" onPress={() => { onClose?.(); onJoin?.(lesson.id); }} fullWidth />
          ) : null}
          <Button title="Cancel this lesson" variant="danger" icon="close-circle-outline" onPress={() => setConfirming(true)} fullWidth />
        </View>
      )}
    </BottomSheet>
  );
}
