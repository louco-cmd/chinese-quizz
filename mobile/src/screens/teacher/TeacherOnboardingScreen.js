import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, ActivityIndicator, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Toggle from '../../components/Toggle';
import { teacherGetProfile, teacherSaveProfile } from '../../api';
import { COLORS, SHADOW_CARD } from '../../theme';

// Langues proposées en sélection (le champ "languages_spoken" reste stocké en
// chaîne CSV). On ajoute les langues déjà saisies mais hors liste.
const LANGUAGE_OPTIONS = ['English', 'Chinese', 'French', 'Spanish', 'German', 'Japanese', 'Korean', 'Cantonese', 'Russian', 'Arabic', 'Portuguese', 'Italian', 'Vietnamese', 'Thai'];

const inputCls = 'bg-surface-page border border-line rounded-xl px-3.5 h-12 text-[15px] text-ink';

function Card({ children }) {
  return <View className="bg-white rounded-2xl p-5 mb-4" style={SHADOW_CARD}>{children}</View>;
}
function Label({ children }) {
  return <Text className="text-[13px] font-semibold text-muted mb-1.5">{children}</Text>;
}

// Onboarding dédié aux professeurs : reprend les champs clés de la page profil
// (name, intro, années d'expérience, langues parlées, liens) + "list me" coché
// par défaut. `onDone` termine ; `onClose` (optionnel) quitte sans enregistrer.
export default function TeacherOnboardingScreen({ onDone, onClose }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [years, setYears] = useState('');
  const [spoken, setSpoken] = useState([]); // langues parlées (multi-select)
  const [langOptions, setLangOptions] = useState(LANGUAGE_OPTIONS);
  const [links, setLinks] = useState([]); // {label,url}
  const [listed, setListed] = useState(true); // préselectionné

  // Champs non montrés ici mais préservés au save (page profil complète).
  const [teach, setTeach] = useState([]);
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('EUR');

  const load = useCallback(async () => {
    setError('');
    try {
      const { profile } = await teacherGetProfile();
      setName(profile.name || '');
      setBio(profile.mentor_bio || '');
      setYears(profile.years_experience == null ? '' : String(profile.years_experience));
      const sp = (profile.languages_spoken || '').split(',').map((s) => s.trim()).filter(Boolean);
      setSpoken(sp);
      // Intègre les langues déjà saisies hors liste par défaut.
      const extra = sp.filter((l) => !LANGUAGE_OPTIONS.includes(l));
      if (extra.length) setLangOptions([...LANGUAGE_OPTIONS, ...extra]);
      setLinks(Array.isArray(profile.mentor_links) ? profile.mentor_links : []);
      setTeach((profile.teaching_languages || '').split(',').map((s) => s.trim()).filter(Boolean));
      setPrice(profile.session_price == null ? '' : String(profile.session_price));
      setCurrency(profile.session_currency || 'EUR');
    } catch (e) { /* profil vide (nouveau prof) : on garde les valeurs par défaut */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function toggleSpoken(l) { setSpoken((s) => (s.includes(l) ? s.filter((x) => x !== l) : [...s, l])); }
  function setLink(i, patch) { setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); }

  async function finish() {
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');
    try {
      await teacherSaveProfile({
        name: name.trim(), bio: bio.trim(), languages: spoken.join(', '),
        years_experience: years, teaching_languages: teach,
        session_price: price, session_currency: currency,
        links: links.filter((l) => (l.url || '').trim()), mentor_listed: listed,
      });
      onDone?.();
    } catch (e) { setError(e.message); setSaving(false); }
  }

  if (loading) {
    return <SafeAreaView style={{ flex: 1, backgroundColor: '#f8f9fa', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={COLORS.jiayou} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 pt-2 pb-1">
          <View style={{ flex: 1 }}>
            <Text className="text-[20px] font-extrabold text-ink">Set up your teacher profile</Text>
            <Text className="text-[13px] text-muted mt-0.5">Students will see this on the mentor directory.</Text>
          </View>
          {onClose ? (
            <Pressable onPress={onClose} hitSlop={10} className="ml-2"><Ionicons name="close" size={24} color={COLORS.muted} /></Pressable>
          ) : (
            <Pressable onPress={() => onDone?.()} hitSlop={10} className="ml-2"><Text className="text-muted text-[14px] font-semibold">Skip</Text></Pressable>
          )}
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center' }}>

            <Card>
              <Label>Name</Label>
              <TextInput value={name} onChangeText={setName} maxLength={50} placeholder="Your display name" placeholderTextColor={COLORS.mutedLight} className={`${inputCls} mb-4`} />
              <Label>Intro</Label>
              <TextInput value={bio} onChangeText={setBio} maxLength={500} multiline placeholder="Tell students about your teaching style…" placeholderTextColor={COLORS.mutedLight}
                className="bg-surface-page border border-line rounded-xl px-3.5 py-3 text-[15px] text-ink mb-4"
                style={{ minHeight: 90, textAlignVertical: 'top', ...(Platform.OS === 'web' ? { resize: 'vertical' } : null) }} />
              <Label>Years of experience</Label>
              <TextInput value={years} onChangeText={(t) => setYears(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder="e.g. 5" placeholderTextColor={COLORS.mutedLight} className={inputCls} />
            </Card>

            <Card>
              <Label>Languages you speak</Label>
              <View className="flex-row flex-wrap gap-2">
                {langOptions.map((l) => {
                  const on = spoken.includes(l);
                  return (
                    <Pressable key={l} onPress={() => toggleSpoken(l)} className={`rounded-full px-4 py-2 border ${on ? 'bg-jiayou-soft border-jiayou' : 'bg-white border-line'}`}>
                      <Text className={`${on ? 'text-jiayou font-bold' : 'text-muted'} text-[13.5px]`}>{l}</Text>
                    </Pressable>
                  );
                })}
              </View>
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
            <Pressable onPress={finish} disabled={saving} className="bg-jiayou rounded-full py-4 items-center active:opacity-80">
              {saving ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-[16px]">Finish</Text>}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
