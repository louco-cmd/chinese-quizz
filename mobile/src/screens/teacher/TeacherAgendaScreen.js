import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, Alert, useWindowDimensions, Platform } from 'react-native';
import { Calendar } from 'react-native-calendars';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from '../../components/BottomSheet';
import CatLoader from '../../components/CatLoader';
import { ErrorRetry } from '../../components/ErrorRetry';
import { getTeacherLessons, deleteTeacherLesson, getTeacherAvailability, setTeacherAvailability, getTeacherDateSlots, setTeacherDateSlots } from '../../api';
import { useT } from '../../i18n';
import { COLORS, TAB_CLEARANCE, SHADOW_CARD } from '../../theme';

function localKey(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function hhmm(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function weekRange(base) {
  const d = new Date(base); d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7;
  const start = new Date(d); start.setDate(d.getDate() - dow);
  const end = new Date(start); end.setDate(start.getDate() + 7);
  return [start, end];
}
function dayLabel(d, lang) {
  try { return d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : lang === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' }); }
  catch { return d.toDateString(); }
}
// Libellés courts des jours (0=lundi) selon la langue.
function weekdayShorts(lang) {
  const loc = lang === 'zh' ? 'zh-CN' : lang === 'fr' ? 'fr-FR' : 'en-US';
  const monday = new Date(2024, 0, 1); // 1er janv. 2024 = lundi
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    try { return d.toLocaleDateString(loc, { weekday: 'short' }).replace('.', ''); } catch { return ['Mo','Tu','We','Th','Fr','Sa','Su'][i]; }
  });
}
const HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 07:00 → 22:00

// Fenêtre de visio : jouable de 15 min avant le début à 10 min après la fin.
const START_EARLY_MS = 15 * 60 * 1000;
const REJOIN_MS = 10 * 60 * 1000;
function lessonJoinable(l, now) {
  const s = new Date(l.starts_at).getTime(), e = new Date(l.ends_at).getTime();
  return now >= s - START_EARLY_MS && now <= e + REJOIN_MS;
}
function lessonFinished(l, now) { return now > new Date(l.ends_at).getTime() + REJOIN_MS; }
function isTrial(l) { return (l.note || '').toLowerCase() === 'trial'; }

// Petit badge « Essai » pour les cours d'essai.
function TrialBadge({ t }) {
  return (
    <View style={{ backgroundColor: '#fff4e5', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1.5 }}>
      <Text style={{ fontSize: 9.5, fontWeight: '800', color: '#c77700', textTransform: 'uppercase', letterSpacing: 0.3 }}>{t('ag_trial')}</Text>
    </View>
  );
}

// ── Popup « semaine type » : heures ouvertes par jour ────────────────────────
function AvailabilityEditor({ visible, onClose, onSaved, t, lang }) {
  const shorts = useMemo(() => weekdayShorts(lang), [lang]);
  const [open, setOpen] = useState(() => new Set()); // "weekday:hour"
  const [wd, setWd] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    getTeacherAvailability()
      .then((r) => setOpen(new Set((r.blocks || []).map((b) => `${b.weekday}:${b.hour}`))))
      .catch(() => setOpen(new Set()))
      .finally(() => setLoading(false));
  }, [visible]);

  const toggle = (h) => setOpen((s) => { const n = new Set(s); const k = `${wd}:${h}`; n.has(k) ? n.delete(k) : n.add(k); return n; });
  const copyWeek = () => setOpen((s) => {
    const n = new Set(s); const hoursOpen = HOURS.filter((h) => s.has(`${wd}:${h}`));
    for (let d = 0; d < 7; d++) { HOURS.forEach((h) => n.delete(`${d}:${h}`)); hoursOpen.forEach((h) => n.add(`${d}:${h}`)); }
    return n;
  });
  const clearDay = () => setOpen((s) => { const n = new Set(s); HOURS.forEach((h) => n.delete(`${wd}:${h}`)); return n; });

  async function save() {
    setSaving(true);
    const blocks = [...open].map((k) => { const [w, h] = k.split(':').map(Number); return { weekday: w, hour: h }; });
    try { await setTeacherAvailability(blocks); onSaved?.(); onClose?.(); }
    catch (e) { Alert.alert('', e.message || 'Error'); }
    finally { setSaving(false); }
  }

  const dayCount = HOURS.filter((h) => open.has(`${wd}:${h}`)).length;

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeightRatio={0.92}>
      <Text style={{ fontSize: 19, fontWeight: '800', color: '#1a1a2e', textAlign: 'center' }}>{t('ag_avail_title')}</Text>
      <Text style={{ fontSize: 12.5, color: COLORS.muted, textAlign: 'center', marginTop: 4, marginBottom: 14, paddingHorizontal: 8 }}>{t('ag_avail_sub')}</Text>

      {/* Sélecteur de jour */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
        {shorts.map((lab, i) => {
          const on = wd === i;
          const has = HOURS.some((h) => open.has(`${i}:${h}`));
          return (
            <Pressable key={i} onPress={() => setWd(i)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, marginHorizontal: 2, borderRadius: 12, backgroundColor: on ? COLORS.jiayou : '#f1f3f5' }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: on ? '#fff' : '#55607a', textTransform: 'capitalize' }}>{lab}</Text>
              <View style={{ width: 5, height: 5, borderRadius: 3, marginTop: 4, backgroundColor: has ? (on ? '#fff' : COLORS.jiayou) : 'transparent' }} />
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={{ paddingVertical: 30, alignItems: 'center' }}><CatLoader size={80} /></View>
      ) : (
        <>
          {/* Grille d'heures (toggle) */}
          <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', paddingVertical: 4 }}>
            {HOURS.map((h) => {
              const on = open.has(`${wd}:${h}`);
              return (
                <Pressable key={h} onPress={() => toggle(h)} style={{ width: 66, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: on ? COLORS.jiayou : '#f1f3f5' }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '800', color: on ? '#fff' : '#55607a' }}>{String(h).padStart(2, '0')}:00</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 10 }}>
            <Pressable onPress={copyWeek} hitSlop={6}><Text style={{ color: COLORS.jiayou, fontWeight: '700', fontSize: 12.5 }}>{t('ag_copy_week')}</Text></Pressable>
            {dayCount > 0 ? <Pressable onPress={clearDay} hitSlop={6}><Text style={{ color: COLORS.danger, fontWeight: '700', fontSize: 12.5 }}>{t('ag_clear_day')}</Text></Pressable> : null}
          </View>

          <Pressable onPress={save} disabled={saving} style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 18, opacity: saving ? 0.6 : 1 }}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15.5 }}>{saving ? '…' : t('ag_save')}</Text>
          </Pressable>
        </>
      )}
    </BottomSheet>
  );
}

// Petit sélecteur +/- (utilisé par l'éditeur de jour pour la plage horaire).
function Stepper({ label, value, onDec, onInc }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 11, color: COLORS.muted, marginBottom: 4 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable onPress={onDec} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: '#eef2f7', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="remove" size={17} color={COLORS.jiayou} />
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a1a2e', minWidth: 40, textAlign: 'center' }}>{value}</Text>
        <Pressable onPress={onInc} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: '#eef2f7', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="add" size={17} color={COLORS.jiayou} />
        </Pressable>
      </View>
    </View>
  );
}

// ── Éditeur de dispos pour une date précise ─────────────────────────────────
// Charge les heures EFFECTIVES du jour (semaine type ou override existant), TOUTES
// modifiables : on peut en ajouter, en retirer, ou ouvrir une plage. Enregistrer
// crée un override qui remplace la semaine type POUR CE JOUR.
function DayEditor({ date, onClose, onSaved, t, lang }) {
  const [sel, setSel] = useState(() => new Set()); // heures effectives du jour
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rs, setRs] = useState(9);
  const [re, setRe] = useState(12);

  useEffect(() => {
    if (!date) return;
    setLoading(true);
    getTeacherDateSlots(date)
      .then((r) => setSel(new Set(r.hours || [])))
      .catch(() => setSel(new Set()))
      .finally(() => setLoading(false));
  }, [date]);

  const toggle = (h) => setSel((s) => { const n = new Set(s); n.has(h) ? n.delete(h) : n.add(h); return n; });
  const openRange = () => setSel((s) => { const n = new Set(s); for (let h = Math.min(rs, re); h < Math.max(rs, re); h++) n.add(h); return n; });

  async function save() {
    setSaving(true);
    try { await setTeacherDateSlots(date, [...sel]); onSaved?.(); onClose?.(); }
    catch (e) { Alert.alert('', e.message || 'Error'); }
    finally { setSaving(false); }
  }

  return (
    <BottomSheet visible={!!date} onClose={onClose} maxHeightRatio={0.92}>
      <Text style={{ fontSize: 19, fontWeight: '800', color: '#1a1a2e', textAlign: 'center' }}>{t('ag_day_title')}</Text>
      <Text style={{ fontSize: 13, color: COLORS.muted, textAlign: 'center', marginTop: 4, marginBottom: 14, textTransform: 'capitalize' }}>{date ? dayLabel(keyToDate(date), lang) : ''}</Text>
      {loading ? (
        <View style={{ paddingVertical: 30, alignItems: 'center' }}><CatLoader size={80} /></View>
      ) : (
        <>
          {/* Ouvrir une plage d'un coup */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 16, marginBottom: 16 }}>
            <Stepper label={t('ag_from')} value={`${String(rs).padStart(2, '0')}h`} onDec={() => setRs((h) => Math.max(0, h - 1))} onInc={() => setRs((h) => Math.min(23, h + 1))} />
            <Stepper label={t('ag_to')} value={`${String(re).padStart(2, '0')}h`} onDec={() => setRe((h) => Math.max(0, h - 1))} onInc={() => setRe((h) => Math.min(24, h + 1))} />
            <Pressable onPress={openRange} style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 11, marginBottom: 2 }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{t('ag_open_range')}</Text>
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 220 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', paddingVertical: 2 }}>
            {HOURS.map((h) => {
              const on = sel.has(h);
              return (
                <Pressable key={h} onPress={() => toggle(h)}
                  style={{ width: 66, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: on ? COLORS.jiayou : '#f1f3f5' }}>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: on ? '#fff' : '#55607a' }}>{String(h).padStart(2, '0')}:00</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={{ fontSize: 11, color: COLORS.mutedLight, textAlign: 'center', marginTop: 8 }}>{t('ag_day_hint')}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 8 }}>
            {sel.size > 0 ? <Pressable onPress={() => setSel(new Set())} hitSlop={6}><Text style={{ color: COLORS.danger, fontWeight: '700', fontSize: 12.5 }}>{t('ag_clear_day')}</Text></Pressable> : null}
          </View>
          <Pressable onPress={save} disabled={saving} style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 14, opacity: saving ? 0.6 : 1 }}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15.5 }}>{saving ? '…' : t('ag_save')}</Text>
          </Pressable>
        </>
      )}
    </BottomSheet>
  );
}

// Carte « Mon calendrier » : prochains cours + cours de la semaine + CTA dispos.
function SummaryCard({ t, lang, lessons, weekCount, onEditAvail, onEditLesson, onStart }) {
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 18, padding: 20, ...SHADOW_CARD }}>
      <Text style={{ fontSize: 22, fontWeight: '800', color: '#1a1a2e' }}>{t('ag_my_calendar')}</Text>

      <Text style={{ fontSize: 14, fontWeight: '800', color: '#1a1a2e', marginTop: 16, marginBottom: 8 }}>{t('ag_next_lesson')}</Text>
      {lessons.length === 0 ? (
        <Text style={{ fontSize: 13, color: COLORS.mutedLight, paddingVertical: 4 }}>{t('ag_no_upcoming')}</Text>
      ) : lessons.slice(0, 3).map((u, i) => {
        const s = new Date(u.starts_at);
        const now = Date.now();
        const isToday = localKey(s) === localKey(new Date());
        const when = `${isToday ? t('ag_today') : dayLabel(s, lang)} ${hhmm(s)}`;
        const joinable = lessonJoinable(u, now);
        const started = now >= s.getTime();
        const trial = isTrial(u);
        return (
          <View key={u.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7 }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 14, color: '#1a1a2e', fontWeight: '600' }}>{when}</Text>
                {trial ? <TrialBadge t={t} /> : null}
              </View>
              {u.student_name ? <Text style={{ fontSize: 11.5, color: COLORS.mutedLight }} numberOfLines={1}>{u.student_name}</Text> : null}
            </View>
            {joinable ? (
              <Pressable onPress={() => onStart(u)} style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12.5 }}>{t(started ? 'ag_rejoin' : 'ag_start_class')}</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => onEditLesson(u)} style={{ backgroundColor: '#eef2f7', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
                <Text style={{ color: '#55607a', fontWeight: '700', fontSize: 12.5 }}>{t('ag_edit')}</Text>
              </Pressable>
            )}
          </View>
        );
      })}

      <View style={{ height: 1, backgroundColor: '#f0f2f5', marginVertical: 14 }} />
      <Text style={{ fontSize: 14, fontWeight: '800', color: '#1a1a2e' }}>{t('ag_lessons_week')}</Text>
      <Text style={{ fontSize: 26, fontWeight: '800', color: COLORS.jiayou, marginTop: 2 }}>{weekCount}</Text>

      <Pressable onPress={onEditAvail} style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 18 }}>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14.5 }}>{t('ag_edit_avail')}</Text>
      </Pressable>
    </View>
  );
}

// ── Grille horaire (vue semaine 7 col / jour 1 col) ──────────────────────────
const GRID_HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 07:00 → 22:00
const ROW_H = 46;
function keyToDate(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function jsMon0(d) { return (d.getDay() + 6) % 7; }

function TimeGrid({ days, isOpenOn, lessonsByDay, onCancel, onEditDay, lang, week, t }) {
  const loc = lang === 'zh' ? 'zh-CN' : lang === 'fr' ? 'fr-FR' : 'en-US';
  const todayK = localKey(new Date());
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', ...SHADOW_CARD }}>
      {/* En-têtes de jours */}
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: '#eef1f5' }}>
        <View style={{ width: 38 }} />
        {days.map((d, i) => {
          const isToday = localKey(d) === todayK;
          let lab; try { lab = d.toLocaleDateString(loc, { weekday: 'short' }).replace('.', ''); } catch { lab = ''; }
          return (
            <View key={i} style={{ flex: 1, alignItems: 'center', paddingVertical: 6 }}>
              <Text style={{ fontSize: 10, fontWeight: '800', color: isToday ? COLORS.jiayou : '#8a94a3', textTransform: 'uppercase' }}>{lab}</Text>
              <Text style={{ fontSize: 13, fontWeight: '800', color: isToday ? COLORS.jiayou : '#1a1a2e', marginTop: 1 }}>{d.getDate()}</Text>
            </View>
          );
        })}
      </View>
      {/* Corps : gutter d'heures + colonnes */}
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: 38 }}>
          {GRID_HOURS.map((h) => (
            <View key={h} style={{ height: ROW_H, alignItems: 'flex-end', paddingRight: 4 }}>
              <Text style={{ fontSize: 9.5, color: COLORS.mutedLight, marginTop: -5 }}>{String(h).padStart(2, '0')}:00</Text>
            </View>
          ))}
        </View>
        {days.map((d, i) => {
          const dayLes = lessonsByDay(d);
          return (
            <View key={i} style={{ flex: 1, borderLeftWidth: 1, borderColor: '#f2f4f7', position: 'relative', height: GRID_HOURS.length * ROW_H }}>
              {/* Cellules horaires + fond bleu transparent sur les heures OUVRÉES */}
              {GRID_HOURS.map((h, idx) => (
                <View key={h} style={{ position: 'absolute', top: idx * ROW_H, left: 0, right: 0, height: ROW_H, borderTopWidth: 1, borderColor: '#f2f4f7', backgroundColor: isOpenOn(d, h) ? 'rgba(13,110,253,0.10)' : 'transparent' }} />
              ))}
              {/* Cours positionnés dans leur créneau */}
              {dayLes.map((les) => {
                const st = new Date(les.starts_at), en = new Date(les.ends_at);
                const top = Math.max(0, ((st.getHours() - 7) + st.getMinutes() / 60) * ROW_H);
                const hgt = Math.max(26, ((en - st) / 3600000) * ROW_H - 3);
                const finished = lessonFinished(les, Date.now());
                const trial = isTrial(les);
                // Carte superposée : liseré gauche (gris = terminé, orange = essai, bleu = à venir).
                const accent = finished ? '#c4ccd6' : trial ? '#f59e0b' : COLORS.jiayou;
                return (
                  <Pressable key={les.id} onPress={() => onCancel(les)}
                    style={{ position: 'absolute', top: top + 1, left: 2, right: 2, height: hgt, backgroundColor: finished ? '#f4f5f7' : '#fff', borderRadius: 8, borderWidth: 1, borderColor: finished ? '#e6e9ee' : '#e3e9f2', borderLeftWidth: 3, borderLeftColor: accent, paddingHorizontal: 6, paddingVertical: 3, overflow: 'hidden', ...SHADOW_CARD }}>
                    {les.student_name ? <Text style={{ color: finished ? COLORS.mutedLight : '#1a1a2e', fontSize: 10.5, fontWeight: '800' }} numberOfLines={1}>{les.student_name}</Text> : null}
                    <Text style={{ color: finished ? COLORS.mutedLight : accent, fontSize: 9.5, fontWeight: '700', marginTop: 1 }} numberOfLines={1}>{hhmm(st)}–{hhmm(en)}{trial ? ` · ${t('ag_trial')}` : ''}</Text>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </View>
      {/* Pied : bouton « Edit » par colonne → édite les dispos de ce jour. */}
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: '#eef1f5' }}>
        <View style={{ width: 38 }} />
        {days.map((d, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center', paddingVertical: 7, borderLeftWidth: 1, borderColor: '#f2f4f7' }}>
            <Pressable onPress={() => onEditDay(localKey(d))} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Ionicons name="create-outline" size={13} color={COLORS.jiayou} />
              <Text style={{ fontSize: 10.5, fontWeight: '800', color: COLORS.jiayou }}>Edit</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function TeacherAgendaScreen({ onVideoCall }) {
  const { t, lang } = useT();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [lessons, setLessons] = useState(null);
  const [avail, setAvail] = useState(new Set()); // "weekday:hour" ouverts (récurrent)
  const [dateHours, setDateHours] = useState(new Map()); // date YYYY-MM-DD -> Set(heures) override
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(localKey(new Date()));
  const [viewMode, setViewMode] = useState('week'); // week | day | month
  const [editingAvail, setEditingAvail] = useState(false);
  const [editingDay, setEditingDay] = useState(null); // date YYYY-MM-DD en cours d'édition

  const load = useCallback(async () => {
    setError('');
    try {
      const [r, a] = await Promise.all([getTeacherLessons(), getTeacherAvailability()]);
      setLessons(r.lessons || []);
      setAvail(new Set((a.blocks || []).map((b) => `${b.weekday}:${b.hour}`)));
      const dh = new Map();
      (a.dates || []).forEach((d) => { if (!dh.has(d.day)) dh.set(d.day, new Set()); dh.get(d.day).add(d.hour); });
      setDateHours(dh);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const now = new Date();
  // « À venir » inclut les cours encore rejoignables (jusqu'à 10 min après la fin).
  const upcomingLessons = useMemo(() => (lessons || []).filter((s) => new Date(s.ends_at).getTime() + REJOIN_MS > now.getTime()).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)), [lessons]);

  const weekCount = useMemo(() => {
    const [a, b] = weekRange(new Date());
    return upcomingLessons.filter((s) => new Date(s.starts_at) >= a && new Date(s.starts_at) < b).length;
  }, [upcomingLessons]);

  // Jours de semaine (0=lun) qui ont au moins une heure ouverte → fond bleu.
  const openWeekdays = useMemo(() => {
    const s = new Set();
    avail.forEach((k) => s.add(Number(k.split(':')[0])));
    return s;
  }, [avail]);

  const selDate = useMemo(() => keyToDate(selected), [selected]);
  const weekDaysArr = useMemo(() => { const [start] = weekRange(selDate); return Array.from({ length: 7 }, (_, i) => addDays(start, i)); }, [selDate]);
  // Ouverture EFFECTIVE pour une date+heure : override ponctuel s'il existe, sinon récurrent.
  const isOpenOn = useCallback((date, h) => {
    const k = localKey(date);
    if (dateHours.has(k)) return dateHours.get(k).has(h);
    return avail.has(`${jsMon0(date)}:${h}`);
  }, [avail, dateHours]);
  const lessonsByDay = useCallback((d) => {
    const k = localKey(d);
    return (lessons || []).filter((s) => localKey(new Date(s.starts_at)) === k).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  }, [lessons]);

  function cancelLesson(s) {
    Alert.alert(t('ag_lesson_cancel_title'), t('ag_lesson_cancel_confirm').replace('{name}', s.student_name || ''), [
      { text: t('common_back'), style: 'cancel' },
      { text: t('ag_cancel_yes'), style: 'destructive', onPress: async () => { try { await deleteTeacherLesson(s.id); await load(); } catch (e) { setError(e.message); } } },
    ]);
  }
  function editLesson(u) { cancelLesson(u); }
  function startClass(u) { if (u?.id) onVideoCall?.(u.id); }

  if (lessons === null && !error) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><CatLoader size={110} /></View>;
  }
  if (error) return <ErrorRetry onRetry={load} />;

  const ViewTabs = (
    <View style={{ flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: '#eef1f5', borderRadius: 999, padding: 4, gap: 2 }}>
      {[['week', t('ag_view_week')], ['day', t('ag_view_day')], ['month', t('ag_view_month')]].map(([k, label]) => {
        const on = viewMode === k;
        return (
          <Pressable key={k} onPress={() => setViewMode(k)}
            style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999, backgroundColor: on ? '#fff' : 'transparent' }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: on ? COLORS.jiayou : '#8a94a3' }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  const RightPanel = (
    <View style={{ flex: 1 }}>
      <View style={{ marginBottom: 12 }}>{ViewTabs}</View>
      {viewMode === 'month' && (
        <>
          <View style={{ borderRadius: 16, overflow: 'hidden', backgroundColor: '#fff', ...SHADOW_CARD }}>
            <Calendar
              current={selected}
              firstDay={1}
              theme={{ arrowColor: COLORS.jiayou, textMonthFontWeight: '800', textDayHeaderFontWeight: '700' }}
              dayComponent={({ date, state }) => {
                const d = new Date(date.year, date.month - 1, date.day);
                const hasOpen = dateHours.has(date.dateString) || openWeekdays.has(jsMon0(d));
                const dayLes = lessonsByDay(d);
                const isSel = date.dateString === selected;
                const isToday = date.dateString === localKey(new Date());
                const disabled = state === 'disabled';
                return (
                  <Pressable onPress={() => { setSelected(date.dateString); setEditingDay(date.dateString); }} style={{ width: '100%' }}>
                    {/* Bloc interne : marges = espacement entre cases. */}
                    <View style={{ minHeight: 70, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 3, marginHorizontal: 3, marginVertical: 2,
                      backgroundColor: hasOpen && !disabled ? 'rgba(13,110,253,0.10)' : 'transparent',
                      borderWidth: isSel ? 1.5 : 0, borderColor: COLORS.jiayou }}>
                      <Text style={{ fontSize: 12.5, fontWeight: isToday ? '800' : '600', textAlign: 'center', marginBottom: 2,
                        color: disabled ? '#ccd2da' : isToday ? COLORS.jiayou : '#1a1a2e' }}>{date.day}</Text>
                      {/* Cellule CTA par cours planifié (heure) */}
                      {dayLes.slice(0, 2).map((les) => {
                        const bg = lessonFinished(les, Date.now()) ? '#c4ccd6' : isTrial(les) ? '#f59e0b' : COLORS.jiayou;
                        return (
                          <Pressable key={les.id} onPress={() => cancelLesson(les)}
                            style={{ backgroundColor: bg, borderRadius: 5, paddingHorizontal: 3, paddingVertical: 1.5, marginBottom: 2 }}>
                            <Text style={{ color: '#fff', fontSize: 8.5, fontWeight: '800', textAlign: 'center' }} numberOfLines={1}>{hhmm(new Date(les.starts_at))}</Text>
                          </Pressable>
                        );
                      })}
                      {dayLes.length > 2 ? <Text style={{ fontSize: 8, color: COLORS.muted, textAlign: 'center' }}>+{dayLes.length - 2}</Text> : null}
                    </View>
                  </Pressable>
                );
              }}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: 'rgba(13,110,253,0.18)' }} />
              <Text style={{ fontSize: 11.5, color: COLORS.mutedLight }}>Open hours</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: COLORS.jiayou }} />
              <Text style={{ fontSize: 11.5, color: COLORS.mutedLight }}>Planned lesson</Text>
            </View>
          </View>
        </>
      )}
      {(viewMode === 'week' || viewMode === 'day') && (() => {
        const isWeek = viewMode === 'week';
        const days = isWeek ? weekDaysArr : [selDate];
        const shift = (n) => setSelected(localKey(addDays(selDate, (isWeek ? 7 : 1) * n)));
        const rangeLabel = isWeek ? `${weekDaysArr[0].getDate()} – ${dayLabel(weekDaysArr[6], lang)}` : dayLabel(selDate, lang);
        const navBtn = { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eef2f7' };
        return (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Pressable onPress={() => shift(-1)} hitSlop={8} style={navBtn}><Ionicons name="chevron-back" size={18} color={COLORS.jiayou} /></Pressable>
              <Text style={{ fontSize: 14, fontWeight: '800', color: '#1a1a2e', textTransform: 'capitalize' }}>{rangeLabel}</Text>
              <Pressable onPress={() => shift(1)} hitSlop={8} style={navBtn}><Ionicons name="chevron-forward" size={18} color={COLORS.jiayou} /></Pressable>
            </View>
            <View style={{ position: 'relative' }}>
              <TimeGrid days={days} isOpenOn={isOpenOn} lessonsByDay={lessonsByDay} onCancel={cancelLesson} onEditDay={setEditingDay} lang={lang} week={isWeek} t={t} />
              {/* Aucune dispo → incitation au centre du calendrier. */}
              {avail.size === 0 ? (
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(248,249,250,0.72)' }}>
                  <View style={{ backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 20, paddingVertical: 18, alignItems: 'center', maxWidth: 280, ...SHADOW_CARD }}>
                    <Ionicons name="calendar-outline" size={28} color={COLORS.jiayou} />
                    <Text style={{ fontSize: 14.5, fontWeight: '800', color: '#1a1a2e', marginTop: 8, textAlign: 'center' }}>{t('ag_no_avail_title')}</Text>
                    <Text style={{ fontSize: 12.5, color: COLORS.muted, textAlign: 'center', marginTop: 4, lineHeight: 17 }}>{t('ag_no_avail_sub')}</Text>
                    <Pressable onPress={() => setEditingAvail(true)} style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 11, marginTop: 14 }}>
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13.5 }}>{t('ag_edit_avail')}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
            {avail.size > 0 ? <Text style={{ fontSize: 11.5, color: COLORS.mutedLight, textAlign: 'center', marginTop: 10 }}>{t('ag_grid_hint')}</Text> : null}
          </>
        );
      })()}
    </View>
  );

  const Summary = (
    <SummaryCard t={t} lang={lang} lessons={upcomingLessons} weekCount={weekCount}
      onEditAvail={() => setEditingAvail(true)} onEditLesson={editLesson} onStart={startClass} />
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: TAB_CLEARANCE, width: '100%', maxWidth: wide ? 1100 : 640, alignSelf: 'center' }}>
        {wide ? (
          <View style={{ flexDirection: 'row', gap: 20, alignItems: 'flex-start' }}>
            <View style={[{ width: 320 }, Platform.OS === 'web' ? { position: 'sticky', top: 16 } : null]}>{Summary}</View>
            {RightPanel}
          </View>
        ) : (
          <>
            <View style={{ marginBottom: 16 }}>{Summary}</View>
            {RightPanel}
          </>
        )}
      </ScrollView>

      <AvailabilityEditor visible={editingAvail} onClose={() => setEditingAvail(false)} onSaved={load} t={t} lang={lang} />
      <DayEditor date={editingDay} onClose={() => setEditingDay(null)} onSaved={load} t={t} lang={lang} />
    </View>
  );
}
