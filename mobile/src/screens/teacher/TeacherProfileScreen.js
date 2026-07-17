import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Toggle from '../../components/Toggle';
import Popup from '../../components/Popup';
import { ErrorRetry } from '../../components/ErrorRetry';
import { teacherGetProfile, teacherSaveProfile } from '../../api';
import { COLORS, SHADOW_CARD } from '../../theme';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CNY', 'JPY', 'CAD', 'AUD', 'SGD', 'HKD'];
const TEACH_LANGS = ['English', 'Chinese'];
const inputCls = 'bg-surface-page border border-line rounded-xl px-3.5 h-12 text-[15px] text-ink';

function Card({ children }) {
  return <View className="bg-white rounded-2xl p-5 mb-4" style={SHADOW_CARD}>{children}</View>;
}
function Label({ children }) {
  return <Text className="text-[13px] font-semibold text-muted mb-1.5">{children}</Text>;
}

export default function TeacherProfileScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [years, setYears] = useState('');
  const [langs, setLangs] = useState('');
  const [teach, setTeach] = useState([]); // ['English','Chinese']
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [links, setLinks] = useState([]); // {label,url}
  const [listed, setListed] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);

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
      setListed(!!profile.mentor_listed);
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
      });
      setSaved(true); setTimeout(() => setSaved(false), 1600);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  if (loading) return <View className="flex-1 items-center justify-center bg-surface-page"><ActivityIndicator color={COLORS.jiayou} /></View>;
  if (error && !name) return <View className="flex-1 bg-surface-page"><ErrorRetry error={error} onRetry={load} /></View>;

  return (
    <View className="flex-1 bg-surface-page">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center' }}>

          <Card>
            <Label>Name</Label>
            <TextInput value={name} onChangeText={setName} maxLength={50} placeholder="Your display name" placeholderTextColor={COLORS.mutedLight} className={`${inputCls} mb-4`} />
            <Label>Intro</Label>
            <TextInput value={bio} onChangeText={setBio} maxLength={500} multiline placeholder="Tell students about your teaching style…" placeholderTextColor={COLORS.mutedLight} className="bg-surface-page border border-line rounded-xl px-3.5 py-3 text-[15px] text-ink mb-4"
              style={{ minHeight: 90, textAlignVertical: 'top', ...(Platform.OS === 'web' ? { resize: 'vertical' } : null) }} />
            <View className="flex-row gap-3">
              <View className="flex-1"><Label>Years of experience</Label><TextInput value={years} onChangeText={(t) => setYears(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder="e.g. 5" placeholderTextColor={COLORS.mutedLight} className={inputCls} /></View>
              <View className="flex-1"><Label>Languages spoken</Label><TextInput value={langs} onChangeText={setLangs} maxLength={200} placeholder="English, 中文…" placeholderTextColor={COLORS.mutedLight} className={inputCls} /></View>
            </View>
          </Card>

          <Card>
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
          <Pressable onPress={save} disabled={saving} className="bg-jiayou rounded-full py-4 items-center active:opacity-80">
            {saving ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-[16px]">{saved ? 'Saved ✓' : 'Save profile'}</Text>}
          </Pressable>
        </View>
      </ScrollView>

      {/* Sélecteur de devise (dropdown) */}
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
