import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, Linking, Alert, AppState, useWindowDimensions, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CatLoader from '../components/CatLoader';
import { ErrorRetry } from '../components/ErrorRetry';
import BottomSheet from '../ui/BottomSheet';
import { getMentor, getMentorSlots, bookTrial, bookSlot, joinTeacher, getTeacherCredits } from '../api';
import { Button } from '../ui';
import { COLORS, SHADOW_CARD, TAB_CLEARANCE } from '../theme';
import BuyLessonsSheet from '../components/teachers/BuyLessonsSheet';

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

// URL d'embed pour YouTube / Bilibili / Vimeo (sinon null → fallback bouton).
function toEmbedUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const yt = (id) => `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`;
    if (host.includes('youtu.be')) { const id = u.pathname.slice(1); return id ? yt(id) : null; }
    if (host.includes('youtube.com')) {
      const v = u.searchParams.get('v'); if (v) return yt(v);
      const sh = u.pathname.match(/\/shorts\/([^/?]+)/); if (sh) return yt(sh[1]);
      const em = u.pathname.match(/\/embed\/([^/?]+)/); if (em) return yt(em[1]);
      return null;
    }
    if (host.includes('bilibili.com')) { const m = u.pathname.match(/\/video\/(BV[\w]+)/i); return m ? `https://player.bilibili.com/player.html?bvid=${m[1]}&autoplay=0` : null; }
    if (host.includes('vimeo.com')) { const m = u.pathname.match(/\/(\d+)/); return m ? `https://player.vimeo.com/video/${m[1]}` : null; }
    return null;
  } catch { return null; }
}

// Player : iframe sur le web ; sinon bouton d'ouverture (natif ou hôte non embeddable).
function VideoEmbed({ url }) {
  const embed = toEmbedUrl(url);
  if (Platform.OS === 'web' && embed) {
    return React.createElement('iframe', {
      src: embed, title: 'Presentation', loading: 'lazy',
      allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen',
      allowFullScreen: true, referrerPolicy: 'strict-origin-when-cross-origin',
      style: { width: '100%', aspectRatio: '16 / 9', minHeight: 200, border: 'none', borderRadius: 12, display: 'block' },
    });
  }
  return (
    <Pressable onPress={() => Linking.openURL(url)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1a1a2e', borderRadius: 12, paddingVertical: 15 }}>
      <Ionicons name="play-circle" size={20} color="#fff" />
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>Watch presentation video</Text>
    </Pressable>
  );
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

// Popup de réservation d'essai : créneaux du prof affichés dans le fuseau de l'ÉLÈVE
// (le device formate les instants UTC en heure locale), groupés par jour.
function TrialBookingSheet({ mentorId, mentorName, visible, onClose, onBooked, onNeedCredits, credits, onBuy, mode = 'trial' }) {
  const isTrial = mode === 'trial';
  const paidLesson = !isTrial && credits?.paidEnabled;
  const balance = credits?.balance || 0;
  const noCredits = paidLesson && balance <= 0;
  const [state, setState] = useState(null); // { slots, timezone, teacher_name }
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(null);
  const localTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })();

  const reload = useCallback(() => { setErr(''); getMentorSlots(mentorId).then(setState).catch((e) => setErr(e.message)); }, [mentorId]);
  useEffect(() => { if (visible) { setState(null); reload(); } }, [visible, reload]);

  const groups = useMemo(() => {
    const m = new Map();
    (state?.slots || []).forEach((s) => {
      const d = new Date(s.starts_at);
      const key = d.toDateString();
      if (!m.has(key)) m.set(key, { date: d, items: [] });
      m.get(key).items.push(s);
    });
    return [...m.values()];
  }, [state]);

  const [selected, setSelected] = useState(null); // créneau sélectionné → étape de confirmation

  async function confirm() {
    if (!selected) return;
    setBusy(selected.starts_at);
    try {
      if (isTrial) await bookTrial(mentorId, selected.starts_at);
      else await bookSlot(mentorId, selected.starts_at);
      setSelected(null);
      onBooked?.(); onClose?.();
      Alert.alert('', isTrial ? "Trial booked! You'll find it in your upcoming sessions."
        : "Lesson booked! You'll find it in your upcoming sessions.");
    } catch (e) {
      if (e.data?.needCredits) {
        setSelected(null); onClose?.();
        Alert.alert('', 'You have no lesson credits left. Buy lessons to book.');
        onNeedCredits?.();
        return;
      }
      const taken = e.data?.taken || e.taken;
      const already = e.data?.already || e.already;
      const msg = (already || /already/i.test(e.message || '')) ? 'You already have an upcoming lesson with this teacher.'
        : taken ? 'This slot was just taken — pick another.' : (e.message || 'Error');
      Alert.alert('', msg); setSelected(null); reload();
    } finally { setBusy(null); }
  }

  const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtDayShort = (d) => d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  // En-tête épuré : avatar à gauche + nom + pastille (crédits ou essai) + fuseau.
  const name = mentorName || state?.teacher_name || 'Teacher';
  const pill = isTrial ? 'Free trial' : (paidLesson ? `${balance} lesson${balance !== 1 ? 's' : ''}` : null);
  const MentorHeader = (
    <View style={{ marginBottom: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: '#e3f0ff', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: COLORS.jiayou, fontWeight: '800', fontSize: 18 }}>{initials(name)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: '#1a1a2e' }} numberOfLines={1}>{name}</Text>
          {pill ? (
            <View style={{ alignSelf: 'flex-start', backgroundColor: COLORS.jiayouSoft, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 4, marginTop: 5 }}>
              <Text style={{ color: COLORS.jiayou, fontSize: 12.5, fontWeight: '800' }}>{pill}</Text>
            </View>
          ) : null}
        </View>
      </View>
      {localTz ? <Text style={{ fontSize: 13, color: '#8a93a5', marginTop: 14 }}>Time zone - {localTz}</Text> : null}
    </View>
  );

  // Étape 2 : écran de confirmation
  if (selected) {
    const d = new Date(selected.starts_at);
    return (
      <BottomSheet visible={visible} onClose={() => { setSelected(null); onClose?.(); }} maxHeightRatio={0.62}>
        {MentorHeader}
        <View style={{ backgroundColor: COLORS.jiayouSoft, borderRadius: 18, padding: 20, alignItems: 'center' }}>
          <Ionicons name="calendar-outline" size={26} color={COLORS.jiayou} style={{ marginBottom: 8 }} />
          <Text style={{ fontSize: 17, fontWeight: '800', color: '#1a1a2e', textTransform: 'capitalize', textAlign: 'center' }}>{fmtDay(d)}</Text>
          <Text style={{ fontSize: 24, fontWeight: '800', color: COLORS.jiayou, marginTop: 2 }}>{fmtTime(selected.starts_at)}</Text>
          {localTz ? <Text style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 4 }}>{localTz}</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
          <Button title="Back" variant="outline" onPress={() => setSelected(null)} style={{ flex: 1, justifyContent: 'center' }} />
          <Button title="Confirm booking" icon="checkmark-circle" loading={!!busy} onPress={confirm} style={{ flex: 2, justifyContent: 'center' }} />
        </View>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeightRatio={0.88}>
      {MentorHeader}
      {noCredits ? (
        <View style={{ marginBottom: 6, backgroundColor: '#fdeef0', borderRadius: 14, padding: 16, alignItems: 'center' }}>
          <Text style={{ fontSize: 13, color: '#c0392b', fontWeight: '700', textAlign: 'center', marginBottom: 12 }}>
            You need a credit to book a class.
          </Text>
          <Button icon="card" title="Buy credits to book a class" fullWidth onPress={() => { onClose?.(); onBuy?.(); }} />
        </View>
      ) : null}
      <View>
        {err ? <ErrorRetry error={err} onRetry={reload} />
          : !state ? <View style={{ paddingVertical: 30, alignItems: 'center' }}><CatLoader size={80} /></View>
            : groups.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 28 }}>
                <Ionicons name="calendar-clear-outline" size={30} color={COLORS.mutedLight} />
                <Text style={{ fontSize: 13.5, color: COLORS.mutedLight, textAlign: 'center', marginTop: 10 }}>No open slot right now.{'\n'}Check back later.</Text>
              </View>
            )
              : (
                <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                  {groups.map((g, i) => (
                    <View key={i} style={{ marginBottom: 18 }}>
                      <Text style={{ fontSize: 15, fontWeight: '800', color: '#1a1a2e', marginBottom: 10 }}>{fmtDayShort(g.date)}</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
                        {g.items.map((s) => (
                          <Pressable key={s.starts_at} onPress={() => { if (!noCredits) setSelected(s); }} disabled={busy === s.starts_at || noCredits}
                            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, width: 96, paddingVertical: 11, borderRadius: 999, backgroundColor: noCredits ? '#f0f2f5' : '#eef4ff', opacity: noCredits ? 0.55 : 1 }}>
                            <Ionicons name="time" size={14} color={noCredits ? COLORS.mutedLight : COLORS.jiayou} />
                            <Text style={{ fontSize: 14, fontWeight: '700', color: noCredits ? COLORS.mutedLight : '#1a1a2e' }}>{fmtTime(s.starts_at)}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}
      </View>
    </BottomSheet>
  );
}


export default function MentorProfileScreen({ id, initial, onBack }) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [m, setM] = useState(initial || null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const [booking, setBooking] = useState(false);
  const [rel, setRel] = useState('none'); // none | trial_booked | trial_done | joined
  const [joining, setJoining] = useState(false);
  const [credits, setCredits] = useState(null); // { paidEnabled, unitPrice, balance, packSizes, nextExpiry }
  const [buyOpen, setBuyOpen] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try { const r = await getMentor(id); setM(r.mentor); setRel(r.relationship || 'none'); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Rail B : charge le solde de crédits une fois l'élève rattaché, et le rafraîchit
  // au retour au premier plan (retour du checkout Stripe).
  const refreshCredits = useCallback(() => { getTeacherCredits(id).then(setCredits).catch(() => {}); }, [id]);
  useEffect(() => {
    if (rel !== 'joined') { setCredits(null); return; }
    refreshCredits();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refreshCredits(); });
    return () => sub.remove();
  }, [rel, refreshCredits]);

  async function onJoin() {
    setJoining(true);
    try {
      await joinTeacher(id);
      setRel('joined');
      Alert.alert('', `You're now ${m?.name || 'this teacher'}'s student! Book your next lesson anytime.`);
    } catch (e) {
      if (e.needTrial) { setRel('trial_done'); Alert.alert('', 'Book a trial lesson first.'); }
      else Alert.alert('', e.message || 'Could not join. Try again.');
    } finally { setJoining(false); }
  }

  const Back = (
    <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 14 }}>
      <Ionicons name="chevron-back" size={20} color={COLORS.jiayou} />
      <Text style={{ color: COLORS.jiayou, fontWeight: '600' }}>Teachers</Text>
    </Pressable>
  );

  if (loading && !m) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f9fa' }}><CatLoader size={110} /></View>;
  if (error && !m) return <View style={{ flex: 1, backgroundColor: '#f8f9fa', padding: 16 }}>{Back}<ErrorRetry error={error} onRetry={load} /></View>;

  const teaches = (m.teaching_languages || []).join(', ');
  const links = m.links || (m.link ? [m.link] : []);

  // ── Colonne gauche : identité + stats + CTA ─────────────────────────────────
  const left = (
    <View style={{ backgroundColor: '#fff', borderRadius: 18, padding: 20, ...SHADOW_CARD }}>
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#e3f0ff', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: COLORS.jiayou, fontWeight: '800', fontSize: 24 }}>{initials(m.name)}</Text>
        </View>
        <Text style={{ fontSize: 20, fontWeight: '800', color: '#1a1a2e', marginTop: 12, textAlign: 'center' }}>{m.name || 'Teacher'}</Text>
        {teaches ? (
          <Text style={{ fontSize: 13, color: '#7a8aa8', marginTop: 3, textAlign: 'center' }}>
            <Ionicons name="language" size={12} color="#7a8aa8" />  Teaches {teaches}
          </Text>
        ) : null}
        {m.session_price != null ? (
          <View style={{ backgroundColor: '#e8f0ff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginTop: 10 }}>
            <Text style={{ color: COLORS.jiayou, fontSize: 13, fontWeight: '800' }}>{money(m.session_price, m.session_currency)} / session</Text>
          </View>
        ) : null}
      </View>

      {/* Stats */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 18 }}>
        <StatTile icon="people" value={m.student_count ?? 0} label="Students" />
        <StatTile icon="school" value={m.courses_given ?? 0} label="Courses given" />
        <StatTile icon="star" accent="#f5b301" value={m.rating != null ? m.rating : '—'} label={m.rating_count ? `Rating (${m.rating_count})` : 'Rating'} />
      </View>

      {/* CTA selon l'état de la relation : trial → join → book a lesson */}
      {rel === 'joined' ? (
        <>
          {credits?.paidEnabled ? (
            <View style={{ marginTop: 16, backgroundColor: credits.balance > 0 ? '#eaf6ef' : '#fdeef0', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center' }}>
              <Text style={{ fontSize: 13.5, fontWeight: '800', color: credits.balance > 0 ? '#1a9e5c' : '#c0392b' }}>
                {credits.balance > 0 ? `${credits.balance} lesson${credits.balance > 1 ? 's' : ''} left` : 'No lessons left'}
              </Text>
              {credits.balance > 0 && credits.nextExpiry ? (
                <Text style={{ fontSize: 11, color: COLORS.mutedLight, marginTop: 2 }}>Expires {new Date(credits.nextExpiry).toLocaleDateString()}</Text>
              ) : null}
            </View>
          ) : null}
          <Button onPress={() => setBooking(true)} icon="calendar" title="Book a lesson" fullWidth style={{ marginTop: credits?.paidEnabled ? 10 : 16 }} />
          {credits?.paidEnabled ? (
            <Button onPress={() => setBuyOpen(true)} variant="outline" icon="card" title="Buy lessons" fullWidth style={{ marginTop: 8 }} />
          ) : null}
        </>
      ) : rel === 'trial_done' ? (
        <>
          <Button onPress={onJoin} loading={joining} icon="person-add" title="Join the teacher" fullWidth style={{ marginTop: 18 }} />
          <Text style={{ fontSize: 11.5, color: COLORS.mutedLight, textAlign: 'center', marginTop: 8 }}>
            Join to book regular lessons with {m.name || 'this teacher'}.
          </Text>
        </>
      ) : rel === 'trial_booked' ? (
        <Button onPress={() => {}} disabled icon="checkmark-circle" title="Trial booked" fullWidth style={{ marginTop: 18 }} />
      ) : (
        <Button onPress={() => setBooking(true)} icon="calendar" title="Book a trial class" fullWidth style={{ marginTop: 18 }} />
      )}
    </View>
  );

  // ── Colonne droite : description + détails ──────────────────────────────────
  const right = (
    <View style={{ backgroundColor: '#fff', borderRadius: 18, padding: 20, ...SHADOW_CARD }}>
      {m.presentation_video ? (
        <View style={{ marginBottom: 18 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: '#1a1a2e', marginBottom: 8 }}>Presentation</Text>
          <VideoEmbed url={m.presentation_video} />
        </View>
      ) : null}
      <Text style={{ fontSize: 16, fontWeight: '800', color: '#1a1a2e', marginBottom: 8 }}>About</Text>
      <Text style={{ fontSize: 14.5, color: '#495267', lineHeight: 21 }}>{m.mentor_bio || "This teacher hasn't written a description yet."}</Text>

      {m.languages_spoken ? (
        <View style={{ marginTop: 18 }}>
          <Text style={{ fontSize: 13, fontWeight: '800', color: '#1a1a2e', marginBottom: 4 }}>Languages spoken</Text>
          <Text style={{ fontSize: 14, color: '#495267' }}>{m.languages_spoken}</Text>
        </View>
      ) : null}
      {m.years_experience != null ? (
        <View style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: '800', color: '#1a1a2e', marginBottom: 4 }}>Experience</Text>
          <Text style={{ fontSize: 14, color: '#495267' }}>{m.years_experience} year{m.years_experience === 1 ? '' : 's'}</Text>
        </View>
      ) : null}
      {links.length ? (
        <View style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: '800', color: '#1a1a2e', marginBottom: 6 }}>Where to find me</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {links.filter((l) => l && l.url).map((l, i) => (
              <Pressable key={i} onPress={() => Linking.openURL(l.url)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#f6f8fb', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}>
                <Text style={{ color: '#495057', fontWeight: '700', fontSize: 13 }}>{l.label || 'Link'}</Text>
                <Ionicons name="open-outline" size={13} color="#495057" />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: TAB_CLEARANCE }}>
        <View style={{ width: '100%', maxWidth: wide ? 1000 : 640, alignSelf: 'center' }}>
          {Back}
          {wide ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 24 }}>
              <View style={[{ width: 320 }, Platform.OS === 'web' ? { position: 'sticky', top: 16 } : null]}>{left}</View>
              <View style={{ flex: 1 }}>{right}</View>
            </View>
          ) : (
            <>
              <View style={{ marginBottom: 16 }}>{left}</View>
              {right}
            </>
          )}
        </View>
      </ScrollView>
      <TrialBookingSheet
        mentorId={m.id} mentorName={m.name} visible={booking}
        onClose={() => setBooking(false)}
        onBooked={() => { load(); refreshCredits(); }}
        onNeedCredits={() => setBuyOpen(true)}
        credits={credits}
        onBuy={() => setBuyOpen(true)}
        mode={rel === 'joined' ? 'lesson' : 'trial'}
      />
      <BuyLessonsSheet
        teacherId={m.id} teacherName={m.name} info={credits}
        visible={buyOpen} onClose={() => setBuyOpen(false)}
        onBought={refreshCredits}
      />
    </View>
  );
}
