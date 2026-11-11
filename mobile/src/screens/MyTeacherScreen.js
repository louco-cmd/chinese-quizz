import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, Alert, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CatLoader from '../components/CatLoader';
import { ErrorRetry } from '../components/ErrorRetry';
import BottomSheet from '../ui/BottomSheet';
import CoursePage from './CoursePage';
import StudentLessonRows from '../components/teachers/StudentLessonRows';
import { getStudentMentor, getStudentSlots, getRecurringSlots, bookSlot, bookRecurringSlots, rateMentor, leaveMentor } from '../api';
import { useT } from '../i18n';
import { Button, Input, Chip, SegmentedControl } from '../ui';
import { COLORS, SHADOW_CARD, TAB_CLEARANCE } from '../theme';
import useAndroidBack from '../useAndroidBack';

const CURRENCY = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', CNY: '¥', JPY: '¥', CAD: 'C$', AUD: 'A$', SGD: 'S$', HKD: 'HK$' };
function money(p, c) {
  if (p == null) return null;
  const sym = CURRENCY[c] || c || '€';
  const amount = Number.isInteger(Number(p)) ? String(p) : Number(p).toFixed(2);
  return sym.length > 1 ? `${sym} ${amount}` : `${sym}${amount}`;
}
function initials(name) {
  return (name || 'T').trim().split(/\s+/).slice(0, 2).map((s) => s[0] || '').join('').toUpperCase() || 'T';
}
function fmtSession(iso) {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

function StatTile({ icon, value, label, accent }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: '#f6f8fb', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 4 }}>
      <Ionicons name={icon} size={18} color={accent || COLORS.jiayou} />
      <Text style={{ fontSize: 19, fontWeight: '800', color: '#1a1a2e', marginTop: 4 }}>{value}</Text>
      <Text style={{ fontSize: 10, color: COLORS.mutedLight, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 1, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

// ── BottomSheet : réserver un cours (créneaux dérivés de la semaine type) ─────
const WEEK_CHOICES = [4, 8, 12];
const WD_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Calendrier semaine pour l'onglet « Recurring classes ». N'affiche que les
// créneaux hebdo libres sur toute la durée (renvoyés par le backend), en zones
// cliquables. Mobile : scroll horizontal ; desktop : s'adapte à la largeur.
function RecurringWeekPicker({ teacherId, weeks, selected, onToggle }) {
  const { width } = useWindowDimensions();
  const [slots, setSlots] = useState(null);
  const [err, setErr] = useState('');

  const reload = useCallback(() => {
    setErr(''); setSlots(null);
    getRecurringSlots(teacherId, weeks).then((r) => setSlots(r.slots || [])).catch((e) => setErr(e.message));
  }, [teacherId, weeks]);
  useEffect(() => { reload(); }, [reload]);

  // Groupe les séries par jour de semaine (heure murale de l'ÉLÈVE) → colonnes,
  // heures → lignes.
  const { days, hours } = useMemo(() => {
    const dayMap = new Map(); // wd(Mon0) -> { wd, date, byHour: Map(hour -> iso) }
    const hourSet = new Set();
    (slots || []).forEach((s) => {
      const d = new Date(s.first_starts_at);
      const wd = (d.getDay() + 6) % 7;
      const hour = d.getHours();
      hourSet.add(hour);
      if (!dayMap.has(wd)) dayMap.set(wd, { wd, date: d, byHour: new Map() });
      const o = dayMap.get(wd);
      if (d < o.date) o.date = d;
      o.byHour.set(hour, s.first_starts_at);
    });
    return {
      days: [...dayMap.values()].sort((a, b) => a.wd - b.wd),
      hours: [...hourSet].sort((a, b) => a - b),
    };
  }, [slots]);

  if (err) return <ErrorRetry error={err} onRetry={reload} />;
  if (!slots) return <View style={{ paddingVertical: 30, alignItems: 'center' }}><CatLoader size={80} /></View>;
  if (days.length === 0) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 28 }}>
        <Ionicons name="calendar-clear-outline" size={30} color={COLORS.mutedLight} />
        <Text style={{ fontSize: 13.5, color: COLORS.mutedLight, textAlign: 'center', marginTop: 10 }}>No weekly slot free for {weeks} weeks straight.{'\n'}Try fewer weeks.</Text>
      </View>
    );
  }

  const wide = width >= 900;
  const hourColW = 46;
  const HEADER_H = 40; // hauteur de l'en-tête (jour + date), pour aligner la colonne heures
  const ROW_H = 42;
  const avail = Math.min(width - 72, 560) - hourColW;
  const dayW = wide ? Math.max(68, Math.floor(avail / days.length)) : 70;
  const fmtHour = (h) => `${String(h).padStart(2, '0')}:00`;

  // Colonne des heures : FIGÉE à gauche (hors du scroll horizontal).
  const leftCol = (
    <View style={{ width: hourColW }}>
      <View style={{ height: HEADER_H }} />
      {hours.map((h) => (
        <View key={h} style={{ height: ROW_H, marginBottom: 8, justifyContent: 'center' }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.muted }}>{fmtHour(h)}</Text>
        </View>
      ))}
    </View>
  );

  // Colonnes des jours : défilent horizontalement (mobile) / remplissent (desktop).
  const daysGrid = (
    <View>
      <View style={{ flexDirection: 'row', height: HEADER_H }}>
        {days.map((d) => (
          <View key={d.wd} style={{ width: dayW, alignItems: 'center' }}>
            <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#1a1a2e' }}>{WD_SHORT[d.wd]}</Text>
            <Text style={{ fontSize: 10.5, color: COLORS.mutedLight }}>{d.date.getDate()}/{d.date.getMonth() + 1}</Text>
          </View>
        ))}
      </View>
      {hours.map((h) => (
        <View key={h} style={{ flexDirection: 'row', height: ROW_H, marginBottom: 8 }}>
          {days.map((d) => {
            const iso = d.byHour.get(h);
            if (!iso) return <View key={d.wd} style={{ width: dayW, paddingHorizontal: 3 }}><View style={{ flex: 1, borderRadius: 10, backgroundColor: '#f2f4f8' }} /></View>;
            const sel = selected.includes(iso);
            return (
              <View key={d.wd} style={{ width: dayW, paddingHorizontal: 3 }}>
                <Pressable
                  onPress={() => onToggle(iso)}
                  style={{ flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: sel ? COLORS.jiayou : '#e8f1ff', borderWidth: sel ? 0 : 1, borderColor: '#cfe0ff' }}
                >
                  <Ionicons name={sel ? 'checkmark' : 'time-outline'} size={sel ? 18 : 16} color={sel ? '#fff' : COLORS.jiayou} />
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );

  // Padding bas : évite que la dernière ligne passe sous le bouton flottant.
  // La colonne heures reste fixe, seules les colonnes jours défilent.
  return (
    <View style={{ paddingBottom: 12, flexDirection: 'row' }}>
      {leftCol}
      {wide
        ? <View style={{ flex: 1 }}>{daysGrid}</View>
        : <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>{daysGrid}</ScrollView>}
    </View>
  );
}

// Phrase récap d'un créneau récurrent sélectionné (heure locale de l'élève).
function recurSentence(iso, weeks) {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'long' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `Every ${day} at ${time} · ${weeks} weeks`;
}

function BookLessonSheet({ teacherId, teacherName, visible, onClose, onBooked }) {
  const [slots, setSlots] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(null);
  const [repeat, setRepeat] = useState(false);   // réserver chaque semaine
  const [weeks, setWeeks] = useState(8);          // nb d'occurrences hebdo
  const [recurSel, setRecurSel] = useState([]);   // créneaux récurrents sélectionnés (multi)
  const localTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })();

  const reload = useCallback(() => {
    setErr('');
    getStudentSlots(teacherId).then((r) => setSlots(r.slots || [])).catch((e) => setErr(e.message));
  }, [teacherId]);
  useEffect(() => { if (visible) { setSlots(null); setRepeat(false); setWeeks(8); setRecurSel([]); reload(); } }, [visible, reload]);
  // La dispo « libre sur la durée » change avec le nb de semaines / l'onglet → on
  // repart d'une sélection vide (les anciens créneaux peuvent ne plus être valides).
  useEffect(() => { setRecurSel([]); }, [weeks, repeat]);
  const toggleRecur = (iso) => setRecurSel((cur) => (cur.includes(iso) ? cur.filter((x) => x !== iso) : [...cur, iso]));

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


  // Onglet « One time class » : réserve un seul créneau.
  async function bookOnce(iso) {
    setBusy(iso);
    try {
      await bookSlot(teacherId, iso);
      onBooked?.(); onClose?.();
      Alert.alert('', "Lesson booked! You'll find it in your upcoming sessions.");
    } catch (e) {
      Alert.alert('', e.taken || /available|taken/i.test(e.message || '') ? 'This slot was just taken — pick another.' : (e.message || 'Error'));
      reload();
    } finally { setBusy(null); }
  }

  // Onglet « Recurring classes » : réserve toutes les séries hebdo sélectionnées.
  async function bookSelected() {
    if (!recurSel.length) return;
    setBusy('recur');
    try {
      let total = 0, miss = 0;
      for (const iso of recurSel) {
        const r = await bookRecurringSlots(teacherId, iso, weeks);
        total += r.booked_count || 0;
        miss += (r.requested || weeks) - (r.booked_count || 0);
      }
      onBooked?.(); onClose?.();
      Alert.alert(
        total ? 'Weekly lessons booked!' : 'Nothing booked',
        total
          ? `${total} lesson${total > 1 ? 's' : ''} booked across ${recurSel.length} weekly slot${recurSel.length > 1 ? 's' : ''}.` +
            (miss > 0 ? `\n\n${miss} occurrence${miss > 1 ? 's were' : ' was'} skipped (teacher not available or already taken).` : '')
          : 'Those slots are no longer available — pick others.'
      );
    } catch (e) {
      Alert.alert('', e.message || 'Error');
    } finally { setBusy(null); }
  }

  const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      maxHeightRatio={0.88}
      footer={repeat && recurSel.length ? (
        <View style={{ paddingTop: 12, marginTop: 4, borderTopWidth: 1, borderColor: '#eef1f5' }}>
          {recurSel.map((iso) => (
            <Text key={iso} style={{ fontSize: 12.5, fontWeight: '700', color: COLORS.muted, marginBottom: 4 }} numberOfLines={1}>
              <Ionicons name="repeat" size={12} color={COLORS.jiayou} />  {recurSentence(iso, weeks)}
            </Text>
          ))}
          <Button
            title={`Book ${recurSel.length} recurring class${recurSel.length > 1 ? 'es' : ''}`}
            icon="calendar"
            disabled={busy === 'recur'}
            onPress={bookSelected}
            fullWidth
            style={{ marginTop: 8 }}
          />
        </View>
      ) : null}
    >
      <View style={{ alignItems: 'center', marginBottom: 16 }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#e3f0ff', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: COLORS.jiayou, fontWeight: '800', fontSize: 18 }}>{initials(teacherName)}</Text>
        </View>
        <Text style={{ fontSize: 17, fontWeight: '800', color: '#1a1a2e', marginTop: 10 }}>Book a class</Text>
        {localTz ? <Text style={{ fontSize: 11.5, color: COLORS.mutedLight, marginTop: 3 }}>Shown in your timezone · {localTz}</Text> : null}
      </View>

      {/* 2 onglets : cours récurrent (chaque semaine) vs cours ponctuel. */}
      <SegmentedControl
        style={{ marginBottom: 12 }}
        value={repeat}
        onChange={setRepeat}
        options={[{ label: 'One time class', value: false }, { label: 'Recurring classes', value: true }]}
      />
      {repeat ? (
        <>
          {/* Durée de la série : on ne montre que les créneaux libres sur toute la durée. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Text style={{ fontSize: 12.5, fontWeight: '700', color: COLORS.muted }}>For</Text>
            {WEEK_CHOICES.map((n) => (
              <Chip key={n} variant="solid" label={`${n} weeks`} selected={weeks === n} onPress={() => setWeeks(n)} />
            ))}
          </View>
          <RecurringWeekPicker teacherId={teacherId} weeks={weeks} selected={recurSel} onToggle={toggleRecur} />
        </>
      ) : (
        <>
          <Text style={{ fontSize: 11.5, color: COLORS.mutedLight, marginBottom: 14, textAlign: 'center' }}>Pick a time below for a single class.</Text>
          {err ? <ErrorRetry error={err} onRetry={reload} />
            : !slots ? <View style={{ paddingVertical: 30, alignItems: 'center' }}><CatLoader size={80} /></View>
              : groups.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: 28 }}>
                  <Ionicons name="calendar-clear-outline" size={30} color={COLORS.mutedLight} />
                  <Text style={{ fontSize: 13.5, color: COLORS.mutedLight, textAlign: 'center', marginTop: 10 }}>No open slot right now.{'\n'}Check back later.</Text>
                </View>
              ) : (
                <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
                  {groups.map((g, i) => (
                    <View key={i} style={{ marginBottom: 16 }}>
                      <Text style={{ fontSize: 12.5, fontWeight: '800', color: COLORS.mutedLight, marginBottom: 9, textTransform: 'uppercase', letterSpacing: 0.4 }}>{fmtDay(g.date)}</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {g.items.map((s) => (
                          <Pressable key={s.starts_at} onPress={() => bookOnce(s.starts_at)} disabled={busy === s.starts_at}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 999, backgroundColor: COLORS.jiayouSoft, borderWidth: 1, borderColor: '#cfe0ff', opacity: busy === s.starts_at ? 0.6 : 1 }}>
                            <Ionicons name="time" size={13} color={COLORS.jiayou} />
                            <Text style={{ fontSize: 13.5, fontWeight: '800', color: COLORS.jiayou }}>{fmtTime(s.starts_at)}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}
        </>
      )}
    </BottomSheet>
  );
}

// ── BottomSheet : noter le prof (1-5 étoiles + commentaire) ───────────────────
function RateSheet({ teacherId, teacherName, initial, visible, onClose, onSaved }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) { setStars(initial?.rating || 0); setComment(initial?.comment || ''); setBusy(false); }
  }, [visible, initial]);

  async function save() {
    if (!stars) { Alert.alert('', 'Pick a rating first.'); return; }
    setBusy(true);
    try { await rateMentor(teacherId, stars, comment.trim()); onSaved?.(); onClose?.(); }
    catch (e) { Alert.alert('', e.message || 'Error'); }
    finally { setBusy(false); }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeightRatio={0.7} avoidKeyboard>
      <View style={{ alignItems: 'center', marginBottom: 16 }}>
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a1a2e' }}>Rate {teacherName || 'your teacher'}</Text>
        <Text style={{ fontSize: 13, color: COLORS.muted, marginTop: 4, textAlign: 'center' }}>Your feedback stays anonymous to other students.</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 18 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setStars(n)} hitSlop={6}>
            <Ionicons name={n <= stars ? 'star' : 'star-outline'} size={36} color={n <= stars ? '#f5b301' : '#d6dbe3'} />
          </Pressable>
        ))}
      </View>
      <Input
        value={comment}
        onChangeText={setComment}
        placeholder="Add a comment (optional)"
        multiline
        maxLength={500}
        inputStyle={{ minHeight: 80, textAlignVertical: 'top' }}
        style={{ marginBottom: 16 }}
      />
      <Button onPress={save} loading={busy} icon="checkmark-circle" title="Submit rating" fullWidth />
    </BottomSheet>
  );
}

// Page « mon prof » : accessible en tapant le nom du prof dans « My mentor ».
export default function MyTeacherScreen({ teacherId, teacherName, onBack, onVideoCall }) {
  const { t: tr } = useT();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [booking, setBooking] = useState(false);
  const [rating, setRating] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [course, setCourse] = useState(null); // { id, readOnly } cours ouvert

  useAndroidBack(() => {
    if (course) { setCourse(null); return true; }
    onBack?.(); return true;
  }, true, [onBack, course]);

  const load = useCallback(async () => {
    setError('');
    try { setData(await getStudentMentor(teacherId)); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [teacherId]);
  useEffect(() => { load(); }, [load]);

  if (course) {
    return <CoursePage lessonId={course.id} readOnly={course.readOnly} onBack={() => { setCourse(null); load(); }} />;
  }

  async function confirmLeave() {
    setLeaveBusy(true);
    try { await leaveMentor(teacherId); setLeaving(false); onBack?.(true); }
    catch (e) { Alert.alert('', e.message || 'Error'); }
    finally { setLeaveBusy(false); }
  }

  const Back = (
    <Pressable onPress={() => onBack?.()} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 14 }}>
      <Ionicons name="chevron-back" size={20} color={COLORS.jiayou} />
      <Text style={{ color: COLORS.jiayou, fontWeight: '600' }}>Back</Text>
    </Pressable>
  );

  if (loading && !data) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.page }}><CatLoader size={110} /></View>;
  if (error && !data) return <View style={{ flex: 1, backgroundColor: COLORS.page, padding: 16 }}>{Back}<ErrorRetry error={error} onRetry={load} /></View>;

  const t = data.teacher;
  const name = t.name || teacherName || 'Your teacher';
  const teaches = (t.teaching_languages || []).join(', ');
  const lessons = data.lessons || [];
  const upcoming = data.upcoming_lessons || [];
  const canBook = data.is_active;

  const BookBtn = canBook ? (
    <Button onPress={() => setBooking(true)} icon="calendar" title="Book a class" fullWidth />
  ) : null;

  // ── Carte identité + stats (colonne gauche sur desktop) ────────────────────
  // Sur desktop, le CTA « Book a lesson » vit dans cette carte ; sur mobile il
  // reste collé en bas (sticky).
  const teacherCard = (
    <View style={{ backgroundColor: '#fff', borderRadius: 18, padding: 20, ...SHADOW_CARD }}>
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#e3f0ff', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: COLORS.jiayou, fontWeight: '800', fontSize: 24 }}>{initials(name)}</Text>
        </View>
        <Text style={{ fontSize: 20, fontWeight: '800', color: '#1a1a2e', marginTop: 12, textAlign: 'center' }}>{name}</Text>
        {teaches ? (
          <Text style={{ fontSize: 13, color: '#7a8aa8', marginTop: 3, textAlign: 'center' }}>
            <Ionicons name="language" size={12} color="#7a8aa8" />  Teaches {teaches}
          </Text>
        ) : null}
        {t.session_price != null ? (
          <View style={{ backgroundColor: '#e8f0ff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginTop: 10 }}>
            <Text style={{ color: COLORS.jiayou, fontSize: 13, fontWeight: '800' }}>{money(t.session_price, t.session_currency)} / session</Text>
          </View>
        ) : null}
        {/* Action principale « Book a class », juste sous le nom. */}
        {BookBtn ? <View style={{ alignSelf: 'stretch', marginTop: 16 }}>{BookBtn}</View> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 18 }}>
        <StatTile icon="people" value={t.student_count ?? 0} label="Students" />
        <StatTile icon="school" value={t.courses_given ?? 0} label="Courses given" />
        <StatTile icon="star" accent="#f5b301" value={t.rating != null ? t.rating : '—'} label={t.rating_count ? `Rating (${t.rating_count})` : 'Rating'} />
      </View>
    </View>
  );

  // ── Colonne droite : cours à venir + classes + actions ─────────────────────
  const rightColumn = (
    <>
      {/* Cours à venir */}
      <View style={{ backgroundColor: '#fff', borderRadius: 18, padding: 20, ...SHADOW_CARD }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Ionicons name="videocam" size={18} color={COLORS.jiayou} />
          <Text style={{ fontSize: 16, fontWeight: '800', color: '#1a1a2e' }}>Upcoming lessons</Text>
        </View>
        {upcoming.length === 0 ? (
          <Text style={{ fontSize: 13.5, color: COLORS.mutedLight, paddingVertical: 4 }}>No upcoming lesson.{canBook ? ' Book one below.' : ''}</Text>
        ) : upcoming.map((u) => {
          const joinable = Date.now() >= new Date(u.starts_at).getTime() - 15 * 60 * 1000 && Date.now() <= new Date(u.ends_at).getTime() + 10 * 60 * 1000;
          return (
            <View key={u.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f0f7ff', borderRadius: 14, padding: 12, marginBottom: 8 }}>
              <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#dbeeff', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="calendar" size={19} color={COLORS.jiayou} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13.5, fontWeight: '800', color: '#1a1a2e' }}>{fmtSession(u.starts_at)}</Text>
                {u.note === 'trial' ? <Text style={{ fontSize: 12, color: COLORS.muted, marginTop: 1 }}>Trial</Text> : null}
              </View>
              {joinable ? (
                <Pressable onPress={() => onVideoCall?.(u.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: COLORS.jiayou }}>
                  <Ionicons name="videocam" size={13} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12.5 }}>Join</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>

      {/* Cours reçus de ce prof (même composant que la page « Mes cours ») */}
      <View style={{ backgroundColor: '#fff', borderRadius: 18, padding: 20, marginTop: 16, ...SHADOW_CARD }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Ionicons name="people-circle" size={19} color={COLORS.jiayou} />
          <Text style={{ fontSize: 16, fontWeight: '800', color: '#1a1a2e' }}>Classes</Text>
        </View>
        {lessons.length === 0 ? (
          <Text style={{ fontSize: 13.5, color: COLORS.mutedLight, paddingVertical: 8 }}>No class with this teacher.</Text>
        ) : (
          <StudentLessonRows lessons={lessons} onOpen={(l, readOnly) => setCourse({ id: l.id, readOnly })} t={tr} />
        )}
      </View>

      {/* Actions bas de page : noter + quitter */}
      <View style={{ marginTop: 20, gap: 10 }}>
        <Pressable onPress={() => setRating(true)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#ffe3a3' }}>
          <Ionicons name="star" size={17} color="#f5b301" />
          <Text style={{ color: '#b5820b', fontWeight: '800', fontSize: 14.5 }}>{data.my_rating ? 'Update my rating' : 'Rate the teacher'}</Text>
        </Pressable>
        <Pressable onPress={() => setLeaving(true)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#fecaca' }}>
          <Ionicons name="exit-outline" size={17} color={COLORS.danger} />
          <Text style={{ color: COLORS.danger, fontWeight: '800', fontSize: 14.5 }}>Leave the teacher</Text>
        </Pressable>
      </View>
    </>
  );

  // Le CTA « Book a class » vit maintenant dans la carte identité (top section),
  // plus besoin de barre sticky.
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.page }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: TAB_CLEARANCE }}>
        <View style={{ width: '100%', maxWidth: wide ? 1000 : 640, alignSelf: 'center' }}>
          {Back}
          {wide ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 24 }}>
              <View style={[{ width: 320 }, Platform.OS === 'web' ? { position: 'sticky', top: 16 } : null]}>{teacherCard}</View>
              <View style={{ flex: 1 }}>{rightColumn}</View>
            </View>
          ) : (
            <>
              <View style={{ marginBottom: 16 }}>{teacherCard}</View>
              {rightColumn}
            </>
          )}
        </View>
      </ScrollView>

      <BookLessonSheet teacherId={teacherId} teacherName={name} visible={booking} onClose={() => setBooking(false)} onBooked={load} />
      <RateSheet teacherId={teacherId} teacherName={name} initial={data.my_rating} visible={rating} onClose={() => setRating(false)} onSaved={load} />

      <BottomSheet visible={leaving} onClose={() => setLeaving(false)} maxHeightRatio={0.5}>
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#fef2f2', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
            <Ionicons name="exit-outline" size={28} color={COLORS.danger} />
          </View>
          <Text style={{ fontSize: 17, fontWeight: '800', color: '#1a1a2e', textAlign: 'center' }}>Leave {name}?</Text>
          <Text style={{ fontSize: 13, color: COLORS.muted, textAlign: 'center', marginTop: 6, lineHeight: 19 }}>
            You'll keep access to your past courses in read-only, but won't receive new tasks.
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title="Cancel" variant="secondary" onPress={() => setLeaving(false)} style={{ flex: 1, justifyContent: 'center' }} />
          <Button title="Leave" variant="danger" loading={leaveBusy} onPress={confirmLeave} style={{ flex: 1, justifyContent: 'center' }} />
        </View>
      </BottomSheet>
    </View>
  );
}
