import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, ActivityIndicator, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Toggle from '../../components/Toggle';
import Popup from '../../components/Popup';
import { ErrorRetry } from '../../components/ErrorRetry';
import MentorCard from '../../components/teachers/MentorCard';
import MentorFilters from '../../components/teachers/MentorFilters';
import { teacherGetProfile, teacherSaveProfile, getMentors, getTeacherStats } from '../../api';
import { COLORS, SHADOW_CARD } from '../../theme';
import CatLoader from '../../components/CatLoader';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CNY', 'JPY', 'CAD', 'AUD', 'SGD', 'HKD'];
const TEACH_LANGS = ['English', 'Chinese'];
const inputCls = 'bg-surface-page border border-line rounded-xl px-3.5 h-12 text-[15px] text-ink';

function Card({ children }) {
  return <View className="bg-white rounded-2xl p-5 mb-4" style={SHADOW_CARD}>{children}</View>;
}
function Label({ children }) {
  return <Text className="text-[13px] font-semibold text-muted mb-1.5">{children}</Text>;
}
function StatTile({ icon, value, label, accent }) {
  return (
    <View className="flex-1 items-center bg-surface-page border border-line-soft rounded-xl py-3 px-1.5">
      <Ionicons name={icon} size={18} color={accent || COLORS.jiayou} />
      <Text className="font-extrabold text-ink text-[20px] leading-none mt-1.5">{value}</Text>
      <Text className="text-muted-light text-[10px] uppercase tracking-wide mt-1 text-center">{label}</Text>
    </View>
  );
}
// Frame téléphone RÉALISTE. Le contenu est rendu à la largeur LOGIQUE d'un vrai
// téléphone (375px) puis mis à l'échelle pour tenir dans le frame → proportions
// correctes (sinon les composants pleine taille sont écrasés/« zoomés »).
const PHONE_W = 300, PHONE_H = 620, BEZEL = 10;
const INNER_W = PHONE_W - 2 * BEZEL;            // 280
const INNER_H = PHONE_H - 2 * BEZEL;            // 600
const LOGICAL_W = 375;                          // largeur logique iPhone
const SCALE = INNER_W / LOGICAL_W;              // ≈ 0.747
const LOGICAL_H = Math.round(INNER_H / SCALE);  // hauteur logique correspondante

function PhonePreview({ mentor, others }) {
  const [fl, setFl] = useState('');   // filtre langue (preview, non fonctionnel)
  const [fp, setFp] = useState('any');
  return (
    <View style={{ width: PHONE_W, alignSelf: 'center' }}>
      <View style={{ width: PHONE_W, height: PHONE_H, borderRadius: 46, backgroundColor: '#0b0e12', padding: BEZEL, shadowColor: '#000', shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.22, shadowRadius: 34, elevation: 10 }}>
        <View style={{ flex: 1, borderRadius: 38, backgroundColor: '#f1f3f7', overflow: 'hidden' }}>
          {/* Contenu rendu en 375px logiques puis scalé depuis le coin haut-gauche. */}
          <View style={{ width: LOGICAL_W, height: LOGICAL_H, transform: [{ scale: SCALE }], transformOrigin: 'top left' }}>
            {/* Header app (bleu) — 加油! + avatar */}
            <View style={{ backgroundColor: COLORS.jiayou, paddingTop: 26, paddingBottom: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 24 }}>加油!</Text>
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.9)' }} />
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
              <MentorFilters languages={['English', 'Chinese']} activeLang={fl} onLang={setFl} activePrice={fp} onPrice={setFp} />
              {/* Carte LIVE (évolue avec les inputs), mise en avant — le liseré hugge
                  la carte (on annule sa marge interne pour ne pas déborder). */}
              <View style={{ borderWidth: 2, borderColor: COLORS.jiayou, borderRadius: 18, overflow: 'hidden', marginBottom: 12 }}>
                <View style={{ marginBottom: -12 }}><MentorCard mentor={mentor} /></View>
              </View>
              {others.map((m) => <MentorCard key={m.id} mentor={m} />)}
            </ScrollView>
          </View>
        </View>
      </View>
      {/* Encoche (Dynamic-Island) */}
      <View style={{ position: 'absolute', top: BEZEL + 8, alignSelf: 'center', width: 96, height: 24, borderRadius: 14, backgroundColor: '#0b0e12' }} />
    </View>
  );
}

export default function TeacherProfileScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 992;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [years, setYears] = useState('');
  const [langs, setLangs] = useState('');
  const [teach, setTeach] = useState([]);
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [links, setLinks] = useState([]);
  const [video, setVideo] = useState('');
  const [listed, setListed] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [others, setOthers] = useState([]); // autres mentors pour la preview
  const [stats, setStats] = useState(null);  // { students, courses_given, rating, rating_count }

  const load = useCallback(async () => {
    setError('');
    try {
      const { profile } = await teacherGetProfile();
      setName(profile.name || '');
      setBio(profile.mentor_bio || '');
      setYears(profile.years_experience == null ? '' : String(profile.years_experience));
      setLangs(profile.languages_spoken || '');
      setTeach((profile.teaching_languages || '').split(',').map((s) => s.trim()).filter(Boolean));
      setPrice(profile.session_price == null ? '' : String(profile.session_price));
      setCurrency(profile.session_currency || 'EUR');
      setLinks(Array.isArray(profile.mentor_links) ? profile.mentor_links : []);
      setVideo(profile.presentation_video || '');
      setListed(!!profile.mentor_listed);
      // Preview : quelques autres mentors de l'annuaire (hors soi).
      try {
        const md = await getMentors();
        const list = (md.mentors || md || []).filter((m) => (m.name || '') !== (profile.name || '')).slice(0, 3);
        setOthers(list);
      } catch { /* preview facultative */ }
      try { setStats(await getTeacherStats()); } catch { /* stats facultatives */ }
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function toggleLang(l) { setTeach((t) => (t.includes(l) ? t.filter((x) => x !== l) : [...t, l])); }
  function setLink(i, patch) { setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); }

  async function save() {
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');
    try {
      await teacherSaveProfile({
        name: name.trim(), bio: bio.trim(), languages: langs.trim(),
        years_experience: years, teaching_languages: teach,
        session_price: price, session_currency: currency,
        links: links.filter((l) => (l.url || '').trim()), mentor_listed: listed,
        presentation_video: video.trim(),
      });
      setSaved(true); setTimeout(() => setSaved(false), 1600);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  if (loading) return <View className="flex-1 items-center justify-center bg-surface-page"><CatLoader size={110} /></View>;
  if (error && !name) return <View className="flex-1 bg-surface-page"><ErrorRetry error={error} onRetry={load} /></View>;

  // Objet mentor dérivé des inputs → carte live.
  const firstLink = links.find((l) => (l.url || '').trim());
  const previewMentor = {
    id: 'me',
    name: name || 'Your name',
    teaching_languages: teach,
    languages_spoken: langs,
    mentor_bio: bio,
    session_price: price ? Number(price) : null,
    session_currency: currency,
    student_count: 0,
    task_count: 0,
    years_experience: years ? Number(years) : null,
    link: firstLink ? { label: firstLink.label || 'Contact', url: firstLink.url } : null,
  };

  const saveBtn = (
    <Pressable onPress={save} disabled={saving} className="bg-jiayou rounded-full py-4 items-center active:opacity-80">
      {saving ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-[16px]">{saved ? 'Published ✓' : 'Publish changes'}</Text>}
    </Pressable>
  );

  const form = (
    <>
      {/* Statistiques (tout en haut) */}
      <Card>
        <Text className="text-ink font-extrabold text-[18px] mb-3">Statistics</Text>
        <View className="flex-row gap-2.5">
          <StatTile icon="people" value={stats ? stats.students : '…'} label="Students" />
          <StatTile icon="school" value={stats ? stats.courses_given : '…'} label="Courses given" />
          <StatTile icon="star" accent="#f5b301" value={stats && stats.rating != null ? stats.rating : '—'} label={stats && stats.rating_count ? `Rating (${stats.rating_count})` : 'Rating'} />
        </View>
      </Card>

      <Card>
        <Text className="text-ink font-extrabold text-[20px] mb-4">Edit your informations</Text>
        <Label>Name</Label>
        <TextInput value={name} onChangeText={setName} maxLength={50} placeholder="Your display name" placeholderTextColor={COLORS.mutedLight} className={`${inputCls} mb-4`} />
        <Label>Description</Label>
        <TextInput value={bio} onChangeText={setBio} maxLength={500} multiline placeholder="Tell students about your teaching style…" placeholderTextColor={COLORS.mutedLight} className="bg-surface-page border border-line rounded-xl px-3.5 py-3 text-[15px] text-ink mb-4"
          style={{ minHeight: 90, textAlignVertical: 'top', ...(Platform.OS === 'web' ? { resize: 'vertical' } : null) }} />
        <View className="flex-row gap-3">
          <View className="flex-1"><Label>Experience</Label><TextInput value={years} onChangeText={(t) => setYears(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder="e.g. 5" placeholderTextColor={COLORS.mutedLight} className={inputCls} /></View>
          <View className="flex-1"><Label>Language spoken</Label><TextInput value={langs} onChangeText={setLangs} maxLength={200} placeholder="English, 中文…" placeholderTextColor={COLORS.mutedLight} className={inputCls} /></View>
        </View>
      </Card>

      <Card>
        <Text className="text-ink font-extrabold text-[18px] mb-4">What you teach</Text>
        <Label>Languages you teach</Label>
        <View className="flex-row gap-2 mb-4">
          {TEACH_LANGS.map((l) => {
            const on = teach.includes(l);
            return (
              <Pressable key={l} onPress={() => toggleLang(l)} className={`rounded-full px-4 py-2 border ${on ? 'bg-jiayou-soft border-jiayou' : 'bg-white border-line'}`}>
                <Text className={`${on ? 'text-jiayou font-bold' : 'text-muted'} text-[13.5px]`}>{l}</Text>
              </Pressable>
            );
          })}
        </View>
        <Label>Price per session</Label>
        <View className="flex-row gap-2 items-center">
          <Pressable onPress={() => setCurrencyOpen(true)} className="flex-row items-center justify-between bg-surface-page border border-line rounded-xl px-3 h-12" style={{ width: 96 }}>
            <Text className="text-ink text-[14px] font-semibold">{currency}</Text>
            <Ionicons name="chevron-down" size={16} color={COLORS.muted} />
          </Pressable>
          <TextInput value={price} onChangeText={(t) => setPrice(t.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="e.g. 25" placeholderTextColor={COLORS.mutedLight} className={`flex-1 ${inputCls}`} />
        </View>
        <Text className="text-muted-light text-[12px] mt-2">Indicative price for one lesson. Leave empty to hide it.</Text>

        <View className="h-px bg-line-soft my-4" />
        <Label>Presentation video</Label>
        <TextInput value={video} onChangeText={setVideo} autoCapitalize="none" placeholder="https://youtube.com/… · bilibili.com/… · vimeo.com/…" placeholderTextColor={COLORS.mutedLight} className={inputCls} />
        <Text className="text-muted-light text-[12px] mt-2">YouTube, Bilibili or Vimeo (https). Shown as a player on your public profile.</Text>
      </Card>

      <Card>
        <Label>Where to find me</Label>
        {links.map((l, i) => (
          <View key={i} className="flex-row gap-2 mb-2">
            <TextInput value={l.label} onChangeText={(t) => setLink(i, { label: t })} maxLength={30} placeholder="Label" placeholderTextColor={COLORS.mutedLight} className="bg-surface-page border border-line rounded-lg px-2.5 h-11 text-[14px] text-ink" style={{ width: 96 }} />
            <TextInput value={l.url} onChangeText={(t) => setLink(i, { url: t })} autoCapitalize="none" placeholder="https://…" placeholderTextColor={COLORS.mutedLight} className="flex-1 bg-surface-page border border-line rounded-lg px-2.5 h-11 text-[14px] text-ink" />
            <Pressable onPress={() => setLinks((ls) => ls.filter((_, j) => j !== i))} hitSlop={6} className="w-11 h-11 items-center justify-center"><Ionicons name="close" size={18} color={COLORS.danger} /></Pressable>
          </View>
        ))}
        <Pressable onPress={() => setLinks((ls) => [...ls, { label: '', url: '' }])} className="flex-row items-center gap-1.5 self-start border border-line rounded-lg px-3 py-2 mt-1">
          <Ionicons name="add" size={15} color={COLORS.muted} /><Text className="text-muted text-[13px] font-semibold">Add a link</Text>
        </Pressable>
        <Text className="text-muted-light text-[12px] mt-2">Accepted: Preply, iTalki, Superprof, Calendly, Linktree, YouTube, Instagram… (https only)</Text>
      </Card>

      <Card>
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-jiayou font-semibold text-[14.5px]">List me in the mentor directory</Text>
            <Text className="text-muted text-[12.5px] mt-0.5">Students can discover you and your stats</Text>
          </View>
          <Toggle value={listed} onValueChange={setListed} />
        </View>
      </Card>

      {error ? <Text className="text-danger text-[13px] font-semibold mb-2">{error}</Text> : null}
      {!isDesktop ? saveBtn : null}
    </>
  );

  return (
    <View className="flex-1 bg-surface-page">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: isDesktop ? 1000 : 560, alignSelf: 'center' }}>
          {isDesktop ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 36 }}>
              <View style={{ flex: 1, maxWidth: 600 }}>{form}</View>
              {/* Colonne droite STICKY : téléphone + Publish */}
              <View style={[{ width: PHONE_W }, Platform.OS === 'web' ? { position: 'sticky', top: 16 } : null]}>
                <PhonePreview mentor={previewMentor} others={others} />
                <View className="mt-4">{saveBtn}</View>
              </View>
            </View>
          ) : form}
        </View>
      </ScrollView>

      <Popup visible={currencyOpen} onClose={() => setCurrencyOpen(false)} maxWidth={300}>
        <Text className="text-[16px] font-bold text-ink mb-2">Currency</Text>
        {CURRENCIES.map((c, i) => (
          <Pressable key={c} onPress={() => { setCurrency(c); setCurrencyOpen(false); }}
            className={`flex-row items-center justify-between py-3 ${i === CURRENCIES.length - 1 ? '' : 'border-b border-line-soft'}`}>
            <Text className={`text-[15px] ${currency === c ? 'text-jiayou font-bold' : 'text-ink'}`}>{c}</Text>
            {currency === c ? <Ionicons name="checkmark" size={18} color={COLORS.jiayou} /> : null}
          </Pressable>
        ))}
      </Popup>
    </View>
  );
}
