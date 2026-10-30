import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CatLoader from '../components/CatLoader';
import { ErrorRetry } from '../components/ErrorRetry';
import { getStudentSlots, getUpcomingSessions, bookSlot, cancelSlotBooking } from '../api';
import { useT } from '../i18n';
import { COLORS, TAB_CLEARANCE, SHADOW_CARD } from '../theme';
import useAndroidBack from '../useAndroidBack';

function fmtDay(d, lang) {
  try { return d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : lang === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' }); }
  catch { return d.toDateString(); }
}
function hhmm(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

export default function StudentAgendaScreen({ onBack, onVideoCall }) {
  const { t, lang } = useT();
  useAndroidBack(() => { onBack?.(); return true; }, true, [onBack]);
  const [slots, setSlots] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null); // clé du créneau en cours d'action
  const slotKey = (s) => `${s.teacher_id}|${s.starts_at}`;

  const load = useCallback(async () => {
    setError('');
    try {
      const [s, u] = await Promise.all([getStudentSlots(), getUpcomingSessions()]);
      setSlots(s.slots || []);
      setUpcoming(u.sessions || []);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Créneaux libres groupés par prof.
  const byTeacher = useMemo(() => {
    const m = new Map();
    (slots || []).forEach((s) => {
      if (!m.has(s.teacher_id)) m.set(s.teacher_id, { name: s.teacher_name, items: [] });
      m.get(s.teacher_id).items.push(s);
    });
    return [...m.values()];
  }, [slots]);

  async function book(s) {
    setBusy(slotKey(s));
    try { await bookSlot(s.teacher_id, s.starts_at); Alert.alert('', t('ag_booked_ok')); await load(); }
    catch (e) { Alert.alert('', e.taken || /available/i.test(e.message || '') ? t('ag_taken') : (e.message || 'Error')); await load(); }
    finally { setBusy(null); }
  }
  function cancel(s) {
    Alert.alert(t('ag_cancel_title'), t('ag_cancel_mine_confirm'), [
      { text: t('common_back'), style: 'cancel' },
      { text: t('ag_cancel_mine'), style: 'destructive', onPress: async () => {
        setBusy(s.id);
        try { await cancelSlotBooking(s.id); await load(); } catch (e) { setError(e.message); } finally { setBusy(null); }
      } },
    ]);
  }

  const BackBtn = (
    <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 2 }}>
      <Ionicons name="chevron-back" size={22} color={COLORS.jiayou} />
      <Text style={{ color: COLORS.jiayou, fontWeight: '600' }}>{t('common_back')}</Text>
    </Pressable>
  );

  if (slots === null && !error) {
    return <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>{BackBtn}<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><CatLoader size={110} /></View></View>;
  }
  if (error) return <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>{BackBtn}<ErrorRetry onRetry={load} /></View>;

  const mine = upcoming.filter((u) => !u.i_am_teacher);

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      {BackBtn}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: TAB_CLEARANCE, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
        <Text style={{ fontSize: 26, fontWeight: '800', color: '#1a1a2e' }}>📅 {t('ag_book_title')}</Text>

        {/* Sessions à venir */}
        {mine.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontSize: 14, fontWeight: '800', color: '#1a1a2e', marginBottom: 8 }}>{t('ag_upcoming')}</Text>
            {mine.map((u) => {
              const s = new Date(u.starts_at);
              return (
                <View key={u.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, ...SHADOW_CARD }}>
                  <View style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e6f7ee' }}>
                    <Ionicons name="videocam" size={22} color={COLORS.success} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: '#1a1a2e' }}>{fmtDay(s, lang)} · {hhmm(s)}</Text>
                    <Text style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 2 }}>{t('ag_with').replace('{name}', u.other_name || '—')}</Text>
                  </View>
                  <Pressable onPress={() => onVideoCall?.(u.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: COLORS.jiayou }}>
                    <Ionicons name="videocam" size={14} color="#fff" />
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12.5 }}>{t('ag_join')}</Text>
                  </Pressable>
                  <Pressable onPress={() => cancel(u)} disabled={busy === u.id} hitSlop={8} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: '#f6f8fb' }}>
                    <Text style={{ color: COLORS.danger, fontWeight: '700', fontSize: 12.5 }}>{t('ag_cancel_mine')}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}

        {/* Créneaux libres à réserver */}
        <Text style={{ fontSize: 14, fontWeight: '800', color: '#1a1a2e', marginTop: 20, marginBottom: 8 }}>{t('ag_add')}</Text>
        {byTeacher.length === 0 ? (
          <Text style={{ fontSize: 13.5, color: COLORS.mutedLight, paddingVertical: 24, textAlign: 'center' }}>{t('ag_book_none')}</Text>
        ) : byTeacher.map((grp, gi) => (
          <View key={gi} style={{ backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 14, ...SHADOW_CARD }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: COLORS.jiayou, marginBottom: 10 }}>{grp.name}</Text>
            {grp.items.map((s) => {
              const st = new Date(s.starts_at), en = new Date(s.ends_at);
              return (
                <View key={slotKey(s)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderColor: '#f2f4f7' }}>
                  <Ionicons name="time-outline" size={18} color={COLORS.mutedLight} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#1a1a2e' }}>{fmtDay(st, lang)}</Text>
                    <Text style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 1 }}>{hhmm(st)} – {hhmm(en)}</Text>
                  </View>
                  <Pressable onPress={() => book(s)} disabled={busy === slotKey(s)} style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, opacity: busy === slotKey(s) ? 0.6 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{busy === slotKey(s) ? '…' : t('ag_book')}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
