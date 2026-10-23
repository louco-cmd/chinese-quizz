import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { Calendar } from 'react-native-calendars';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from '../../components/BottomSheet';
import CatLoader from '../../components/CatLoader';
import { ErrorRetry } from '../../components/ErrorRetry';
import { getTeacherSlots, createTeacherSlot, deleteTeacherSlot } from '../../api';
import { useT } from '../../i18n';
import { COLORS, TAB_CLEARANCE, SHADOW_CARD } from '../../theme';

// Clé de date LOCALE (YYYY-MM-DD) à partir d'un Date — sert au marquage du
// calendrier et au regroupement par jour (on affiche en heure locale du prof).
function localKey(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function hhmm(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
const DURATIONS = [30, 45, 60, 90];

function Stepper({ label, value, onDec, onInc }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 11, color: COLORS.muted, marginBottom: 4 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable onPress={onDec} hitSlop={8} style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: '#eef2f7', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="remove" size={18} color={COLORS.jiayou} />
        </Pressable>
        <Text style={{ fontSize: 20, fontWeight: '800', color: '#1a1a2e', minWidth: 34, textAlign: 'center' }}>{value}</Text>
        <Pressable onPress={onInc} hitSlop={8} style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: '#eef2f7', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="add" size={18} color={COLORS.jiayou} />
        </Pressable>
      </View>
    </View>
  );
}

export default function TeacherAgendaScreen() {
  const { t } = useT();
  const [slots, setSlots] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(localKey(new Date()));
  const [adding, setAdding] = useState(false);
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [duration, setDuration] = useState(60);
  const [saving, setSaving] = useState(false);
  const [addErr, setAddErr] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { const r = await getTeacherSlots(); setSlots(r.slots || []); }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Marquage du calendrier : un point sous chaque jour qui a ≥1 créneau + le jour
  // sélectionné surligné.
  const marked = useMemo(() => {
    const m = {};
    (slots || []).forEach((s) => {
      const k = localKey(new Date(s.starts_at));
      if (!m[k]) m[k] = { marked: true, dotColor: s.status === 'booked' ? COLORS.success : COLORS.jiayou };
    });
    m[selected] = { ...(m[selected] || {}), selected: true, selectedColor: COLORS.jiayou };
    return m;
  }, [slots, selected]);

  const daySlots = useMemo(
    () => (slots || []).filter((s) => localKey(new Date(s.starts_at)) === selected).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)),
    [slots, selected]);

  async function submit() {
    setAddErr('');
    // Construit le créneau en heure LOCALE du jour sélectionné.
    const [y, mo, d] = selected.split('-').map((n) => parseInt(n, 10));
    const start = new Date(y, mo - 1, d, hour, minute, 0, 0);
    if (start.getTime() < Date.now()) { setAddErr(t('ag_past')); return; }
    const end = new Date(start.getTime() + duration * 60000);
    setSaving(true);
    try {
      await createTeacherSlot(start.toISOString(), end.toISOString());
      setAdding(false);
      await load();
    } catch (e) { setAddErr(e.message || 'Error'); }
    finally { setSaving(false); }
  }

  function removeSlot(s) {
    const booked = s.status === 'booked';
    Alert.alert(
      booked ? t('ag_cancel_title') : t('ag_delete_title'),
      booked ? t('ag_cancel_booked_confirm').replace('{name}', s.student_name || '') : t('ag_delete_confirm'),
      [
        { text: t('common_back'), style: 'cancel' },
        {
          text: booked ? t('ag_cancel_yes') : t('ag_delete_yes'), style: 'destructive',
          onPress: async () => { try { await deleteTeacherSlot(s.id); await load(); } catch (e) { setError(e.message); } },
        },
      ]);
  }

  if (slots === null && !error) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><CatLoader size={110} /></View>;
  }
  if (error) return <ErrorRetry onRetry={load} />;

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <ScrollView contentContainerStyle={{ paddingBottom: TAB_CLEARANCE, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: '#1a1a2e', paddingHorizontal: 16, paddingTop: 14 }}>📅 {t('ag_title')}</Text>
        <Text style={{ fontSize: 13, color: COLORS.muted, paddingHorizontal: 16, marginTop: 4, marginBottom: 10 }}>{t('ag_sub')}</Text>

        <View style={{ marginHorizontal: 12, borderRadius: 16, overflow: 'hidden', backgroundColor: '#fff', ...SHADOW_CARD }}>
          <Calendar
            current={selected}
            onDayPress={(d) => setSelected(d.dateString)}
            markedDates={marked}
            firstDay={1}
            theme={{
              todayTextColor: COLORS.jiayou,
              arrowColor: COLORS.jiayou,
              textMonthFontWeight: '800',
              textDayFontWeight: '600',
            }}
          />
        </View>

        {/* Créneaux du jour sélectionné */}
        <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: '#1a1a2e' }}>{t('ag_slots_on').replace('{date}', selected)}</Text>
            <Pressable onPress={() => { setAddErr(''); setAdding(true); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{t('ag_add')}</Text>
            </Pressable>
          </View>

          {daySlots.length === 0 ? (
            <Text style={{ fontSize: 13.5, color: COLORS.mutedLight, paddingVertical: 18, textAlign: 'center' }}>{t('ag_no_slots')}</Text>
          ) : daySlots.map((s) => {
            const booked = s.status === 'booked';
            return (
              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, ...SHADOW_CARD }}>
                <View style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: booked ? '#e6f7ee' : '#eef4ff' }}>
                  <Ionicons name={booked ? 'person' : 'time-outline'} size={22} color={booked ? COLORS.success : COLORS.jiayou} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: '#1a1a2e' }}>{hhmm(new Date(s.starts_at))} – {hhmm(new Date(s.ends_at))}</Text>
                  <Text style={{ fontSize: 12.5, color: booked ? COLORS.success : COLORS.mutedLight, fontWeight: '600', marginTop: 2 }}>
                    {booked ? t('ag_booked_by').replace('{name}', s.student_name || '—') : t('ag_open')}
                  </Text>
                </View>
                <Pressable onPress={() => removeSlot(s)} hitSlop={8} style={{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f6f8fb' }}>
                  <Ionicons name={booked ? 'close' : 'trash-outline'} size={17} color={COLORS.danger} />
                </Pressable>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Sheet d'ajout de créneau */}
      <BottomSheet visible={adding} onClose={() => setAdding(false)}>
        <Text style={{ fontSize: 19, fontWeight: '800', color: '#1a1a2e', textAlign: 'center' }}>{t('ag_add_title')}</Text>
        <Text style={{ fontSize: 13, color: COLORS.muted, textAlign: 'center', marginTop: 4, marginBottom: 18 }}>{selected}</Text>

        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 26, marginBottom: 20 }}>
          <Stepper label={t('ag_hour')} value={String(hour).padStart(2, '0')} onDec={() => setHour((h) => (h + 23) % 24)} onInc={() => setHour((h) => (h + 1) % 24)} />
          <Stepper label={t('ag_minute')} value={String(minute).padStart(2, '0')} onDec={() => setMinute((m) => (m + 45) % 60)} onInc={() => setMinute((m) => (m + 15) % 60)} />
        </View>

        <Text style={{ fontSize: 12, color: COLORS.muted, textAlign: 'center', marginBottom: 8 }}>{t('ag_duration')}</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
          {DURATIONS.map((d) => {
            const on = duration === d;
            return (
              <Pressable key={d} onPress={() => setDuration(d)} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: on ? COLORS.jiayou : '#f1f3f5' }}>
                <Text style={{ fontWeight: '800', fontSize: 13, color: on ? '#fff' : '#55607a' }}>{d}′</Text>
              </Pressable>
            );
          })}
        </View>

        {addErr ? <Text style={{ color: COLORS.danger, fontSize: 13, fontWeight: '600', textAlign: 'center', marginBottom: 10 }}>{addErr}</Text> : null}
        <Pressable onPress={submit} disabled={saving} style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 15, alignItems: 'center', opacity: saving ? 0.6 : 1 }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15.5 }}>{saving ? '…' : t('ag_create')}</Text>
        </Pressable>
      </BottomSheet>
    </View>
  );
}
