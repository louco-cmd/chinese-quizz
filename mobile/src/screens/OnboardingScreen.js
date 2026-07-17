import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, FlatList, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COUNTRIES } from '../data/countries';
import { flagEmoji } from '../components/account/EditProfilePopup';
import SegmentedPicker from '../components/settings/SegmentedPicker';
import CtaCard from '../components/duels/CtaCard';
import PackMarket from '../components/PackMarket';
import ImportWordsScreen from './ImportWordsScreen';
import { completeOnboarding } from '../api';
import { COLORS } from '../theme';

// Ombre diffuse cohérente avec la carte de login.
const cardShadow = {
  shadowColor: '#000', shadowOffset: { width: 0, height: 14 },
  shadowOpacity: 0.08, shadowRadius: 30, elevation: 4,
};

// Carte d'option sélectionnable (rôle / direction / langue).
function OptionCard({ emoji, title, sub, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 items-center px-3 py-4 rounded-2xl border-2 active:opacity-90 ${active ? 'border-jiayou bg-jiayou-soft' : 'border-line bg-white'}`}
    >
      <Text className="text-[26px] mb-1.5">{emoji}</Text>
      <Text className={`text-[13px] font-bold text-center ${active ? 'text-jiayou' : 'text-ink'}`}>{title}</Text>
      {sub ? <Text className="text-[11.5px] text-muted mt-0.5 text-center leading-4">{sub}</Text> : null}
    </Pressable>
  );
}

function StepLabel({ icon, children }) {
  return (
    <View className="flex-row items-center gap-1.5 mb-3.5">
      <Ionicons name={icon} size={14} color={COLORS.jiayou} />
      <Text className="text-[12px] font-bold uppercase tracking-[0.6px] text-jiayou">{children}</Text>
    </View>
  );
}

function FieldLabel({ children, hint }) {
  return (
    <Text className="text-[13.5px] font-semibold text-ink mb-1.5">
      {children}{hint ? <Text className="text-muted font-normal"> {hint}</Text> : null}
    </Text>
  );
}

const inputClass = 'bg-white border-[1.5px] border-line rounded-xl px-3.5 h-12 text-[15px] text-ink';

function PrimaryButton({ label, onPress, saving }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={saving}
      className={`mt-6 rounded-full py-4 items-center bg-jiayou active:opacity-80 ${saving ? 'opacity-70' : ''}`}
    >
      {saving ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-[16px]">{label}</Text>}
    </Pressable>
  );
}

// (Le retour se fait via TopBar en haut ; l'ancien BackLink du bas a été retiré.)

// Stepper à points ; le point courant est allongé.
function Stepper({ index, total }) {
  return (
    <View className="flex-row items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={{ width: i === index ? 20 : 7, height: 7, borderRadius: 4, backgroundColor: i <= index ? COLORS.jiayou : '#dfe3e8' }} />
      ))}
    </View>
  );
}

// Barre du haut : retour à gauche, stepper au centre, slot à droite (balance).
function TopBar({ onBack, index, total, right }) {
  return (
    <View className="flex-row items-center justify-between mb-4" style={{ minHeight: 30 }}>
      <View style={{ width: 72 }}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={10} className="flex-row items-center gap-1">
            <Ionicons name="chevron-back" size={20} color={COLORS.jiayou} />
            <Text className="text-jiayou font-semibold text-[14px]">Back</Text>
          </Pressable>
        ) : null}
      </View>
      <Stepper index={index} total={total} />
      <View style={{ width: 72, alignItems: 'flex-end' }}>{right || null}</View>
    </View>
  );
}

// Pastille de solde (coins).
function BalanceChip({ balance }) {
  return (
    <View className="flex-row items-center gap-1" style={{ backgroundColor: '#eef4ff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
      <Ionicons name="wallet" size={13} color={COLORS.jiayou} />
      <Text style={{ color: COLORS.jiayou, fontWeight: '700', fontSize: 12.5 }}>{balance == null ? '…' : `${balance} ₵`}</Text>
    </View>
  );
}

// Onboarding — miroir de views/onboarding.ejs, restylé NativeWind.
// `initial` = { name } pré-rempli ; `refCode` = code de parrainage éventuel ;
// `onDone(role)` appelé après enregistrement ; `onClose` si rejoué depuis réglages.
export default function OnboardingScreen({ initial, refCode, onDone, onClose }) {
  const [step, setStep] = useState('role'); // 'role' | 'teacher' | 'learner'
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');

  const [name, setName] = useState(initial?.name || '');
  const [country, setCountry] = useState(null);
  const [tagline, setTagline] = useState('');
  const [dir, setDir] = useState('en→zh');
  const [lang, setLang] = useState('en');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [balance, setBalance] = useState(null);

  const firstName = (initial?.name || '').split(' ')[0] || 'learner';

  // Enregistre le profil. Renvoie true en cas de succès (sans naviguer).
  async function saveProfile(role) {
    if (!name.trim()) { setError('Name is required.'); return false; }
    setSaving(true); setError('');
    try {
      await completeOnboarding({
        role,
        name: name.trim(),
        tagline: role === 'teacher' ? '' : tagline.trim(),
        country: role === 'teacher' ? null : country,
        quiz_direction: role === 'teacher' ? undefined : dir,
        interface_lang: role === 'teacher' ? undefined : lang,
        ref: refCode || undefined,
      });
      setSaving(false);
      return true;
    } catch (e) {
      setError(e.message || 'Something went wrong. Please try again.');
      setSaving(false);
      return false;
    }
  }

  // Prof → espace prof direct. Élève → étape "remplis ta collection".
  async function submitTeacher() { if (await saveProfile('teacher')) onDone?.('teacher'); }
  async function submitLearner() { if (await saveProfile('student')) setStep('words'); }

  // ── Dernier chapitre (élève, optionnel) : remplis ta collection ──
  // Grille de packs JiaStore + une tuile "upload" (bleue, style action) en 2e
  // position (haut de la colonne droite). Optionnel → "Start playing" termine.
  if (step === 'words') {
    if (importing) {
      return <ImportWordsScreen onBack={() => setImporting(false)} onDone={() => onDone?.('student')} />;
    }
    // Tuile upload : même design que les tuiles d'action (CtaCard bleue) et
    // `fill` pour épouser la hauteur des cartes du store dans la même rangée.
    const uploadTile = (
      <View style={{ flex: 1, marginBottom: 18 }}>
        <CtaCard
          fill
          colors={['#0d6efd', '#0a4fcf']}
          icon="cloud-upload"
          title="Manual bulk upload"
          text="Upload up to 600 words from your personal base"
          onPress={() => setImporting(true)}
        />
      </View>
    );
    const header = (
      <View style={{ paddingBottom: 6 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.jiayou, letterSpacing: 0.5 }}>LAST STEP</Text>
        <Text style={{ fontSize: 23, fontWeight: '800', color: COLORS.ink, marginTop: 4 }}>Fill your collection</Text>
        <Text style={{ fontSize: 13.5, color: COLORS.muted, marginTop: 4, marginBottom: 14 }}>
          Optional — grab a pack or import your own list. You can always add more words later.
        </Text>
      </View>
    );
    const footer = (
      <View style={{ marginTop: 6 }}>
        <PrimaryButton label="Start playing 加油！🚀" onPress={() => onDone?.('student')} />
      </View>
    );
    return (
      <SafeAreaView className="flex-1 bg-surface-page">
        <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 8 }}>
          <TopBar
            onBack={() => setStep('learner')}
            index={2}
            total={3}
            right={<BalanceChip balance={balance} />}
          />
        </View>
        <PackMarket
          extraTile={uploadTile}
          extraTileAt={1}
          onBalance={setBalance}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          contentContainerStyle={{ width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 4, paddingBottom: 40 }}
        />
      </SafeAreaView>
    );
  }

  // ── Sélecteur de pays ──
  if (picking) {
    const filtered = query.trim()
      ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
      : COUNTRIES;
    return (
      <SafeAreaView className="flex-1 bg-surface-page">
        <View className="w-full max-w-[480px] self-center flex-1 px-5 pt-4">
          <View className="flex-row items-center gap-2.5 mb-3">
            <Pressable onPress={() => { setPicking(false); setQuery(''); }} hitSlop={10}>
              <Ionicons name="arrow-back" size={22} color={COLORS.ink} />
            </Pressable>
            <Text className="text-[17px] font-bold text-ink">Select your country</Text>
          </View>
          <TextInput
            value={query} onChangeText={setQuery} placeholder="Search a country…"
            placeholderTextColor={COLORS.mutedLight} autoFocus className={`${inputClass} mb-2.5`}
          />
          <FlatList
            data={filtered} keyExtractor={(c) => c.code} keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => { setCountry(item.code); setPicking(false); setQuery(''); }}
                className="flex-row items-center gap-2.5 py-3 border-b border-line-soft"
              >
                <Text className="text-[20px]">{flagEmoji(item.code)}</Text>
                <Text className="text-[15px] text-ink flex-1">{item.name}</Text>
                {country === item.code && <Ionicons name="checkmark" size={18} color={COLORS.jiayou} />}
              </Pressable>
            )}
          />
        </View>
      </SafeAreaView>
    );
  }

  const currentCountry = COUNTRIES.find((c) => c.code === country);

  // Retour + position dans le stepper selon l'étape. À l'étape 'role', le retour
  // ferme (si rejoué depuis les réglages), sinon rien (c'est la 1re étape).
  const stepMeta = {
    role: { index: 0, total: 3, back: onClose || null },
    learner: { index: 1, total: 3, back: () => { setStep('role'); setError(''); } },
    teacher: { index: 1, total: 2, back: () => { setStep('role'); setError(''); } },
  }[step] || { index: 0, total: 3, back: null };

  return (
    <SafeAreaView className="flex-1 bg-surface-page">
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View className="w-full max-w-[480px] self-center">

          {/* Barre du haut : retour + stepper */}
          <TopBar onBack={stepMeta.back} index={stepMeta.index} total={stepMeta.total} />

          {/* Header */}
          <View className={`items-center mb-7 ${onClose ? '' : 'mt-3'}`}>
            <Text className="text-[44px] font-extrabold text-jiayou">加油！</Text>
            <Text className="text-[22px] font-bold text-ink mt-1.5">Welcome, {firstName}!</Text>
            <Text className="text-muted text-[14.5px] mt-1">Let's set up your profile before you start.</Text>
          </View>

          {/* Carte */}
          <View className="bg-white rounded-3xl p-6" style={cardShadow}>

            {step === 'role' && (
              <>
                <StepLabel icon="people">How will you use Jiayou?</StepLabel>
                <View className="flex-row gap-3">
                  <OptionCard emoji="🎓" title="I'm a learner" sub="Build vocabulary & practice with quizzes" onPress={() => setStep('learner')} />
                  <OptionCard emoji="🧑‍🏫" title="I'm a teacher" sub="Create classes & follow students" onPress={() => setStep('teacher')} />
                </View>
              </>
            )}

            {step === 'teacher' && (
              <>
                <StepLabel icon="person">Your teacher profile</StepLabel>
                <FieldLabel>Your name *</FieldLabel>
                <TextInput
                  value={name} onChangeText={setName} maxLength={50}
                  placeholder="How should your students see you?" placeholderTextColor={COLORS.mutedLight}
                  className={inputClass}
                />
                {error ? <Text className="text-danger text-[13px] font-semibold mt-2">{error}</Text> : null}
                <PrimaryButton label="Open my teacher space 🧑‍🏫" onPress={submitTeacher} saving={saving} />
              </>
            )}

            {step === 'learner' && (
              <>
                {/* Name */}
                <FieldLabel>Your name *</FieldLabel>
                <TextInput
                  value={name} onChangeText={setName} maxLength={50}
                  placeholder="How should we call you?" placeholderTextColor={COLORS.mutedLight}
                  className={`${inputClass} mb-4`}
                />

                {/* Country */}
                <FieldLabel>Your country</FieldLabel>
                <Pressable onPress={() => setPicking(true)} className={`${inputClass} mb-4 flex-row items-center justify-between`}>
                  <View className="flex-row items-center gap-2.5">
                    <Text className="text-[20px]">{flagEmoji(country)}</Text>
                    <Text className={`text-[15px] ${currentCountry ? 'text-ink' : 'text-muted-light'}`}>
                      {currentCountry ? currentCountry.name : 'Select your country'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-down" size={18} color={COLORS.muted} />
                </Pressable>

                {/* Tagline */}
                <FieldLabel hint="(optional)">Your tagline</FieldLabel>
                <Text className="text-[12px] text-muted mb-2">A short line about you, shown on your profile and the leaderboard.</Text>
                <TextInput
                  value={tagline} onChangeText={setTagline} maxLength={100}
                  placeholder="e.g. Learning Chinese for work!" placeholderTextColor={COLORS.mutedLight}
                  className={`${inputClass} mb-5`}
                />

                <View className="h-px bg-line-soft mb-4" />

                {/* Quiz direction */}
                <StepLabel icon="swap-horizontal">What are you learning?</StepLabel>
                <View className="mb-5">
                  <SegmentedPicker
                    value={dir}
                    onChange={setDir}
                    options={[
                      { value: 'en→zh', label: 'I learn Chinese' },
                      { value: 'zh→en', label: 'I learn English' },
                    ]}
                  />
                </View>

                <View className="h-px bg-line-soft mb-4" />

                {/* Interface language */}
                <StepLabel icon="language">Interface language</StepLabel>
                <View className="mb-2">
                  <SegmentedPicker
                    value={lang}
                    onChange={setLang}
                    options={[
                      { value: 'en', label: 'English' },
                      { value: 'zh', label: '中文' },
                    ]}
                  />
                </View>

                {error ? <Text className="text-danger text-[13px] font-semibold mt-2">{error}</Text> : null}
                <PrimaryButton label="Continue 加油！🚀" onPress={submitLearner} saving={saving} />
              </>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
