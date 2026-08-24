import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, FlatList, ActivityIndicator, useWindowDimensions, Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts, LaBelleAurore_400Regular } from '@expo-google-fonts/la-belle-aurore';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COUNTRIES } from '../data/countries';
import { flagEmoji } from '../components/account/EditProfilePopup';
import SegmentedPicker from '../components/settings/SegmentedPicker';
import Toggle from '../components/Toggle';
import CtaCard from '../components/duels/CtaCard';
import PackMarket from '../components/PackMarket';
import ImportWordsScreen from './ImportWordsScreen';
import { completeOnboarding, teacherGetProfile, teacherSaveProfile } from '../api';
import { COLORS } from '../theme';
import { useT, makeT } from '../i18n';
import { LANG_META, LEARNABLE } from '../langs';

// Toggle de langue compact (EN / 中) pour la barre du haut de l'onboarding.
function LangToggle({ lang, onChange }) {
  const opts = [{ v: 'en', l: 'EN' }, { v: 'zh', l: '中' }];
  return (
    <View style={{ flexDirection: 'row', backgroundColor: '#eef1f5', borderRadius: 999, padding: 3 }}>
      {opts.map((o) => {
        const on = lang === o.v;
        return (
          <Pressable key={o.v} onPress={() => onChange(o.v)} style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: on ? '#fff' : 'transparent' }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: on ? COLORS.jiayou : '#8a94a3' }}>{o.l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Langues proposées en sélection pour les profs (le champ reste stocké en CSV).
const LANGUAGE_OPTIONS = ['English', 'Chinese', 'French', 'Spanish', 'German', 'Japanese', 'Korean', 'Cantonese', 'Russian', 'Arabic', 'Portuguese', 'Italian', 'Vietnamese', 'Thai'];

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

// Grande tuile de rôle en dégradé, icône blanche. Pleine largeur (empilées) en
// mobile, côte à côte en desktop. Utilisée à l'étape 'role' de l'onboarding.
function RoleTile({ colors, icon, title, sub, onPress }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1 }} className="active:opacity-90">
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ borderRadius: 22, paddingVertical: 26, paddingHorizontal: 20, minHeight: 150, justifyContent: 'center' }}
      >
        <Ionicons name="arrow-forward-circle" size={22} color="rgba(255,255,255,0.7)" style={{ position: 'absolute', top: 12, right: 14 }} />
        <View style={{ alignItems: 'center' }}>
          <Ionicons name={icon} size={40} color="#fff" style={{ marginBottom: 10 }} />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 18, textAlign: 'center' }}>{title}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13.5, marginTop: 4, textAlign: 'center', lineHeight: 18 }}>{sub}</Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

// Tagline manuscrite qui bascule (Chinese ↔ English) avec un petit fondu + slide.
function AnimatedTagline({ text, style }) {
  const anim = useRef(new Animated.Value(1)).current;
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (text === shown) return;
    Animated.timing(anim, { toValue: 0, duration: 130, useNativeDriver: false }).start(() => {
      setShown(text);
      Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: false }).start();
    });
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.Text
      style={[{ width: '100%', includeFontPadding: false }, style, { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}
    >
      {shown}
    </Animated.Text>
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
// Slots latéraux en flex:1 pour centrer le stepper sans contraindre la balance.
function TopBar({ onBack, index, total, right, backLabel = 'Back' }) {
  return (
    <View className="flex-row items-center mb-4" style={{ minHeight: 34 }}>
      <View style={{ flex: 1 }}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={10} className="flex-row items-center gap-1 self-start">
            <Ionicons name="chevron-back" size={20} color={COLORS.jiayou} />
            <Text className="text-jiayou font-semibold text-[14px]">{backLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      <Stepper index={index} total={total} />
      <View style={{ flex: 1, alignItems: 'flex-end' }}>{right || null}</View>
    </View>
  );
}

// Pastille de solde — même composant que le Header (label « balance : » + montant),
// décliné en bleu pour le fond clair de l'onboarding.
function BalanceChip({ balance, label = 'balance :' }) {
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: '#eef4ff', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
      }}
    >
      <Text style={{ color: COLORS.jiayou, fontSize: 12, opacity: 0.9 }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: COLORS.jiayou, fontSize: 15, fontWeight: '800' }}>
        {balance == null ? '…' : `${balance}₵`}
      </Text>
    </View>
  );
}

// Onboarding — miroir de views/onboarding.ejs, restylé NativeWind.
// `initial` = { name } pré-rempli ; `refCode` = code de parrainage éventuel ;
// `onDone(role)` appelé après enregistrement ; `onClose` si rejoué depuis réglages.
export default function OnboardingScreen({ initial, refCode, onDone, onClose }) {
  const [step, setStep] = useState('role'); // 'role' | 'teacher' | 'learner'
  const { width } = useWindowDimensions();
  const isDesktop = width >= 700;
  const [fontsLoaded] = useFonts({ LaBelleAurore_400Regular });
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');

  // Langue de l'interface : état local (bascule LIVE via le toggle du haut) ; on
  // l'initialise depuis le contexte global et on le répercute au global à chaque
  // changement pour que le reste de l'app (et le tutoriel) suive immédiatement.
  const { lang: globalLang, setLang: setGlobalLang } = useT();
  const [lang, setLang] = useState(globalLang || 'en');
  const t = makeT(lang);
  const changeLang = (l) => { setLang(l); setGlobalLang?.(l); };

  const [name, setName] = useState(initial?.name || '');
  const [country, setCountry] = useState(null);
  const [tagline, setTagline] = useState('');
  // Langue apprise ; la langue de base (native) = la langue d'interface (`lang`).
  const [learnLang, setLearnLang] = useState('zh');

  // Champs du profil prof (étape 'teacher').
  const [bio, setBio] = useState('');
  const [years, setYears] = useState('');
  const [spoken, setSpoken] = useState([]);      // langues parlées (multi-select)
  const [links, setLinks] = useState([]);        // {label,url}
  const [listed, setListed] = useState(true);    // "list me" préselectionné
  const [teach, setTeach] = useState([]);        // langues enseignées (préservé)
  const [price, setPrice] = useState('');        // prix/session (préservé)
  const [currency, setCurrency] = useState('EUR'); // devise (préservée)
  const [teacherLoaded, setTeacherLoaded] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [balance, setBalance] = useState(null);

  // Prénom live : suit le champ "name" (candy : "Welcome, learner!" → "Welcome, John!").
  const firstName = (name || '').trim().split(' ')[0] || 'learner';
  // Tagline selon la langue apprise.
  const taglineText = `Unlock your ${LANG_META[learnLang]?.label || 'Chinese'}`;

  // Header figé, identique sur les 3 étapes : même padding + même conteneur
  // (maxWidth 1120) → Back, stepper et balance restent toujours à la même place.
  const fixedTopBar = ({ onBack, index, total, right = null }) => (
    <View style={{ paddingHorizontal: isDesktop ? 24 : 20, paddingTop: isDesktop ? 18 : 12, paddingBottom: 4 }}>
      <View style={{ width: '100%', maxWidth: 1120, alignSelf: 'center' }}>
        <TopBar onBack={onBack} index={index} total={total} right={right} backLabel={t('ob_back')} />
      </View>
    </View>
  );

  // Enregistre le profil. Renvoie true en cas de succès (sans naviguer).
  async function saveProfile(role) {
    if (!name.trim()) { setError(t('ob_name_required')); return false; }
    setSaving(true); setError('');
    try {
      await completeOnboarding({
        role,
        name: name.trim(),
        tagline: role === 'teacher' ? '' : tagline.trim(),
        country: role === 'teacher' ? null : country,
        learning_lang: role === 'teacher' ? undefined : learnLang,
        native_lang: role === 'teacher' ? undefined : lang, // langue de base = interface
        interface_lang: lang, // langue choisie au picker, persistée pour les 2 rôles
        ref: refCode || undefined,
      });
      setSaving(false);
      return true;
    } catch (e) {
      setError(e.message || t('ob_error_generic'));
      setSaving(false);
      return false;
    }
  }

  // Entrée dans l'étape prof : précharge le profil existant (redo depuis les
  // réglages). Pour un nouveau compte, requireTeacher renvoie 403 → on garde les
  // valeurs par défaut, silencieusement.
  async function enterTeacher() {
    setStep('teacher'); setError('');
    if (teacherLoaded) return;
    setTeacherLoaded(true);
    try {
      const { profile } = await teacherGetProfile();
      if (profile) {
        if (profile.mentor_bio) setBio(profile.mentor_bio);
        if (profile.years_experience != null) setYears(String(profile.years_experience));
        const sp = (profile.languages_spoken || '').split(',').map((s) => s.trim()).filter(Boolean);
        if (sp.length) setSpoken(sp);
        if (Array.isArray(profile.mentor_links) && profile.mentor_links.length) setLinks(profile.mentor_links);
        setTeach((profile.teaching_languages || '').split(',').map((s) => s.trim()).filter(Boolean));
        if (profile.session_price != null) setPrice(String(profile.session_price));
        if (profile.session_currency) setCurrency(profile.session_currency);
        // "List me" reste préselectionné (ON) ; on ne le rétrograde jamais.
        if (profile.mentor_listed) setListed(true);
      }
    } catch { /* nouveau prof : valeurs par défaut */ }
  }

  function toggleSpoken(l) { setSpoken((s) => (s.includes(l) ? s.filter((x) => x !== l) : [...s, l])); }
  function setLink(i, patch) { setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); }

  // Prof → enregistre le rôle/nom (onboarding), puis le profil mentor, puis
  // ouvre l'espace prof. Les champs non demandés ici (langues enseignées, prix)
  // sont préservés tels quels.
  async function submitTeacher() {
    if (!(await saveProfile('teacher'))) return;
    setSaving(true);
    try {
      await teacherSaveProfile({
        name: name.trim(), bio: bio.trim(), languages: spoken.join(', '),
        years_experience: years, teaching_languages: teach,
        session_price: price, session_currency: currency,
        links: links.filter((l) => (l.url || '').trim()), mentor_listed: listed,
      });
    } catch (e) { /* profil complémentaire non bloquant */ }
    finally { setSaving(false); }
    onDone?.('teacher');
  }
  // Élève → on NE sauvegarde PAS ici : on valide juste le nom et on passe au
  // dernier chapitre. Tout est enregistré d'un coup à la fin (finishLearner).
  function submitLearner() {
    if (!name.trim()) { setError(t('ob_name_required')); return; }
    setError('');
    setStep('words');
  }
  // Fin de l'onboarding élève : un seul appel base, puis on entre dans le jeu.
  async function finishLearner() { if (await saveProfile('student')) onDone?.('student'); }

  // ── Dernier chapitre (élève, optionnel) : remplis ta collection ──
  // Grille de packs JiaStore + une tuile "upload" (bleue, style action) en 2e
  // position (haut de la colonne droite). Optionnel → "Start playing" termine.
  if (step === 'words') {
    if (importing) {
      return <ImportWordsScreen direction={learnLang === 'zh' ? 'en→zh' : 'zh→en'} embedded={false} onBack={() => setImporting(false)} onDone={finishLearner} />;
    }
    // Les packs couvrent la paire zh↔en dans les DEUX sens (apprendre le chinois
    // depuis l'anglais ET l'anglais depuis le chinois). Toute paire impliquant une
    // langue sans traductions complètes (fr pour l'instant) → pas encore de packs :
    // on masque la grille du store ET l'import en masse, remplacés par « bientôt ».
    const noPacks = !(['zh', 'en'].includes(learnLang) && ['zh', 'en'].includes(lang));
    const comingSoon = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48 }}>
        <Text style={{ fontSize: 46, marginBottom: 16 }}>🚀</Text>
        <Text style={{ textAlign: 'center', color: COLORS.ink, fontSize: 19, fontWeight: '700', marginBottom: 8, paddingHorizontal: 24 }}>
          {t('st_packs_soon_title')}
        </Text>
        <Text style={{ textAlign: 'center', color: COLORS.muted, fontSize: 14, lineHeight: 20, paddingHorizontal: 28, maxWidth: 400 }}>
          {t('st_packs_soon_sub')}
        </Text>
      </View>
    );
    // Tuile upload : même design que les tuiles d'action (CtaCard bleue) et
    // `fill` pour épouser la hauteur des cartes du store dans la même rangée.
    const uploadTile = (
      <View style={{ flex: 1, marginBottom: 18 }}>
        <CtaCard
          fill
          colors={['#0d6efd', '#0a4fcf']}
          icon="cloud-upload"
          title={t('ob_upload_title')}
          text={t('ob_upload_text')}
          onPress={() => setImporting(true)}
        />
      </View>
    );
    // Bloc branding réutilisé (logo + tagline manuscrite + titre d'étape).
    const wordsBranding = (
      <>
        <Text className="text-jiayou font-extrabold" style={{ fontSize: isDesktop ? 58 : 44 }}>加油!</Text>
        <AnimatedTagline
          text={taglineText}
          style={{ fontFamily: fontsLoaded ? 'LaBelleAurore_400Regular' : undefined, fontStyle: fontsLoaded ? 'normal' : 'italic', fontSize: isDesktop ? 36 : 27, lineHeight: isDesktop ? 46 : 36, color: COLORS.jiayou, marginTop: 6, textAlign: 'center' }}
        />
        <Text className="text-[20px] font-bold text-ink mt-4 text-center">{t('ob_words_title')}</Text>
        <Text className="text-muted text-[14px] mt-1 text-center">{t(noPacks ? 'ob_words_sub_soon' : 'ob_words_sub')}</Text>
      </>
    );
    const stickyBar = (
      <View style={{ borderTopWidth: 1, borderTopColor: COLORS.line, backgroundColor: '#f8f9fa', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 }}>
        <View style={{ width: '100%', maxWidth: 520, alignSelf: 'center' }}>
          {error ? <Text className="text-danger text-[13px] font-semibold mb-2 text-center">{error}</Text> : null}
          <PrimaryButton label={t('ob_lets_start')} onPress={finishLearner} saving={saving} />
          <Text className="text-muted text-[14px] text-center mt-2.5">{t('ob_buy_later')}</Text>
        </View>
      </View>
    );

    // ── Desktop : 2 colonnes (branding à gauche, grille de packs à droite en grand) ──
    if (isDesktop) {
      return (
        <SafeAreaView className="flex-1 bg-surface-page">
          {fixedTopBar({ onBack: () => setStep('learner'), index: 2, total: 3, right: <BalanceChip balance={balance} label={t('ob_balance')} /> })}
          <View style={{ flex: 1, width: '100%', maxWidth: 1120, alignSelf: 'center', paddingHorizontal: 24 }}>
            <View style={{ flex: 1, flexDirection: 'row', gap: 40 }}>
              <View style={{ width: 300, alignItems: 'center', justifyContent: 'center' }}>
                {wordsBranding}
              </View>
              <View style={{ flex: 1 }}>
                {noPacks ? comingSoon : (
                  <PackMarket
                    extraTile={uploadTile}
                    extraTileAt={1}
                    maxPrice={200}
                    columns={2}
                    learningLang={learnLang}
                    baseLang={lang}
                    onBalance={setBalance}
                    contentContainerStyle={{ width: '100%', paddingVertical: 12, paddingBottom: 20 }}
                  />
                )}
                {stickyBar}
              </View>
            </View>
          </View>
        </SafeAreaView>
      );
    }

    // ── Mobile : une seule colonne. Header figé en haut, branding dans la liste. ──
    const header = (
      <View className="items-center mb-7 mt-2">{wordsBranding}</View>
    );
    return (
      <SafeAreaView className="flex-1 bg-surface-page">
        {fixedTopBar({ onBack: () => setStep('learner'), index: 2, total: 3, right: <BalanceChip balance={balance} label={t('ob_balance')} /> })}
        {noPacks ? (
          <ScrollView contentContainerStyle={{ flexGrow: 1, width: '100%', maxWidth: 520, alignSelf: 'center', padding: 20 }}>
            {header}
            {comingSoon}
          </ScrollView>
        ) : (
          <PackMarket
            extraTile={uploadTile}
            extraTileAt={1}
            maxPrice={200}
            learningLang={learnLang}
            baseLang={lang}
            onBalance={setBalance}
            ListHeaderComponent={header}
            contentContainerStyle={{ width: '100%', maxWidth: 520, alignSelf: 'center', padding: 20, paddingBottom: 24 }}
          />
        )}
        {stickyBar}
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
        {/* Desktop : carte centrée à hauteur limitée. Mobile : plein écran. */}
        <View style={{ flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 20, paddingTop: isDesktop ? 28 : 12, paddingBottom: isDesktop ? 28 : 0, justifyContent: isDesktop ? 'center' : 'flex-start' }}>
          <View style={{ backgroundColor: '#fff', borderRadius: isDesktop ? 24 : 0, overflow: 'hidden', flexGrow: isDesktop ? 0 : 1, flexShrink: 1, maxHeight: isDesktop ? 560 : undefined, ...(isDesktop ? cardShadow : {}) }}>
            <View style={{ paddingHorizontal: isDesktop ? 20 : 0, paddingTop: isDesktop ? 20 : 4 }}>
              <View className="flex-row items-center gap-2.5 mb-3">
                <Pressable onPress={() => { setPicking(false); setQuery(''); }} hitSlop={10}>
                  <Ionicons name="arrow-back" size={22} color={COLORS.ink} />
                </Pressable>
                <Text className="text-[17px] font-bold text-ink">{t('ob_select_country')}</Text>
              </View>
              <TextInput
                value={query} onChangeText={setQuery} placeholder={t('ob_search_country')}
                placeholderTextColor={COLORS.mutedLight} autoFocus className={`${inputClass} mb-2.5`}
              />
            </View>
            <FlatList
              data={filtered} keyExtractor={(c) => c.code} keyboardShouldPersistTaps="handled"
              style={{ flexGrow: 1, flexShrink: 1 }}
              contentContainerStyle={{ paddingHorizontal: isDesktop ? 20 : 0, paddingBottom: 12 }}
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

  // Desktop + étape formulaire (learner/teacher) → 2 colonnes (branding à gauche,
  // formulaire à droite, sans scroll). L'étape 'role' garde le logo en tête +
  // les tuiles côte à côte.
  const twoCol = isDesktop && step !== 'role';
  const branding = (
    <>
      <Text className="text-jiayou font-extrabold" style={{ fontSize: twoCol ? 58 : 44 }}>加油!</Text>
      <AnimatedTagline
        text={taglineText}
        style={{ fontFamily: fontsLoaded ? 'LaBelleAurore_400Regular' : undefined, fontStyle: fontsLoaded ? 'normal' : 'italic', fontSize: twoCol ? 36 : 27, lineHeight: twoCol ? 46 : 36, color: COLORS.jiayou, marginTop: 6, textAlign: 'center' }}
      />
      <Text className="text-[20px] font-bold text-ink mt-4">{t('ob_welcome').replace('{name}', firstName)}</Text>
      <Text className="text-muted text-[14px] mt-1 text-center">{t('ob_welcome_sub')}</Text>
    </>
  );

  return (
    <SafeAreaView className="flex-1 bg-surface-page">
      {/* Header figé en haut (identique sur toutes les étapes) — toggle de langue
          à droite, dispo dès l'écran de choix du rôle. */}
      {fixedTopBar({ onBack: stepMeta.back, index: stepMeta.index, total: stepMeta.total, right: <LangToggle lang={lang} onChange={changeLang} /> })}
      <ScrollView
        contentContainerStyle={twoCol ? { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 28 } : { padding: 20, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ width: '100%', maxWidth: twoCol ? 940 : 480, alignSelf: 'center' }}>

          {/* Corps : 2 colonnes en desktop-formulaire, empilé sinon */}
          <View style={twoCol ? { flexDirection: 'row', alignItems: 'center', gap: 56, marginTop: 8 } : undefined}>

            {/* Branding : logo + tagline (à gauche en desktop, en tête sinon) */}
            <View style={twoCol ? { flex: 1, alignItems: 'center' } : { alignItems: 'center', marginBottom: 28, marginTop: onClose ? 0 : 12 }}>
              {branding}
            </View>

            {/* Colonne contenu (formulaire / tuiles) */}
            <View style={twoCol ? { flex: 1, maxWidth: 460 } : undefined}>

          {/* Étape rôle : tuiles colorées désencapsulées (empilées en mobile,
              côte à côte en desktop). Les autres étapes restent dans la carte. */}
          {step === 'role' && (
            <View style={{ flexDirection: isDesktop ? 'row' : 'column', gap: 14 }}>
              <RoleTile
                colors={['#0d6efd', '#0a4fcf']}
                icon="school"
                title={t('ob_role_learner_title')}
                sub={t('ob_role_learner_sub')}
                onPress={() => setStep('learner')}
              />
              <RoleTile
                colors={['#7c3aed', '#5b21b6']}
                icon="easel"
                title={t('ob_role_teacher_title')}
                sub={t('ob_role_teacher_sub')}
                onPress={enterTeacher}
              />
            </View>
          )}

          {/* Carte (étapes teacher / learner) */}
          {step !== 'role' && (
          <View className="bg-white rounded-3xl p-6" style={cardShadow}>

            {step === 'teacher' && (
              <>
                <StepLabel icon="person">{t('ob_teacher_profile')}</StepLabel>

                <FieldLabel>{t('ob_your_name')}</FieldLabel>
                <TextInput
                  value={name} onChangeText={setName} maxLength={50}
                  placeholder={t('ob_name_ph_teacher')} placeholderTextColor={COLORS.mutedLight}
                  className={`${inputClass} mb-4`}
                />

                <FieldLabel hint={t('ob_optional')}>{t('ob_intro')}</FieldLabel>
                <TextInput
                  value={bio} onChangeText={setBio} maxLength={500} multiline
                  placeholder={t('ob_intro_ph')} placeholderTextColor={COLORS.mutedLight}
                  className="bg-white border-[1.5px] border-line rounded-xl px-3.5 py-3 text-[15px] text-ink mb-4"
                  style={{ minHeight: 88, textAlignVertical: 'top' }}
                />

                <FieldLabel hint={t('ob_optional')}>{t('ob_years')}</FieldLabel>
                <TextInput
                  value={years} onChangeText={(v) => setYears(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad"
                  placeholder={t('ob_years_ph')} placeholderTextColor={COLORS.mutedLight}
                  className={`${inputClass} mb-4`}
                />

                <FieldLabel>{t('ob_langs_spoken')}</FieldLabel>
                <View className="flex-row flex-wrap gap-2 mb-4">
                  {[...new Set([...LANGUAGE_OPTIONS, ...spoken])].map((l) => {
                    const on = spoken.includes(l);
                    return (
                      <Pressable key={l} onPress={() => toggleSpoken(l)} className={`rounded-full px-4 py-2 border ${on ? 'bg-jiayou-soft border-jiayou' : 'bg-white border-line'}`}>
                        <Text className={`${on ? 'text-jiayou font-bold' : 'text-muted'} text-[13.5px]`}>{l}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <FieldLabel hint={t('ob_optional')}>{t('ob_links')}</FieldLabel>
                {links.map((l, i) => (
                  <View key={i} className="flex-row gap-2 mb-2">
                    <TextInput value={l.label} onChangeText={(v) => setLink(i, { label: v })} maxLength={30} placeholder={t('ob_link_label')} placeholderTextColor={COLORS.mutedLight} className="bg-white border-[1.5px] border-line rounded-lg px-2.5 h-11 text-[14px] text-ink" style={{ width: 92 }} />
                    <TextInput value={l.url} onChangeText={(v) => setLink(i, { url: v })} autoCapitalize="none" placeholder="https://…" placeholderTextColor={COLORS.mutedLight} className="flex-1 bg-white border-[1.5px] border-line rounded-lg px-2.5 h-11 text-[14px] text-ink" />
                    <Pressable onPress={() => setLinks((ls) => ls.filter((_, j) => j !== i))} hitSlop={6} className="w-11 h-11 items-center justify-center"><Ionicons name="close" size={18} color={COLORS.danger} /></Pressable>
                  </View>
                ))}
                <Pressable onPress={() => setLinks((ls) => [...ls, { label: '', url: '' }])} className="flex-row items-center gap-1.5 self-start border border-line rounded-lg px-3 py-2 mt-1 mb-5">
                  <Ionicons name="add" size={15} color={COLORS.muted} /><Text className="text-muted text-[13px] font-semibold">{t('ob_add_link')}</Text>
                </Pressable>

                <View className="flex-row items-center justify-between bg-surface-page rounded-xl px-3.5 py-3">
                  <View className="flex-1 pr-3">
                    <Text className="text-jiayou font-semibold text-[14px]">{t('ob_list_me')}</Text>
                    <Text className="text-muted text-[12px] mt-0.5">{t('ob_list_me_sub')}</Text>
                  </View>
                  <Toggle value={listed} onValueChange={setListed} />
                </View>

                {error ? <Text className="text-danger text-[13px] font-semibold mt-2">{error}</Text> : null}
                <PrimaryButton label={t('ob_open_teacher')} onPress={submitTeacher} saving={saving} />
              </>
            )}

            {step === 'learner' && (
              <>
                {/* Name */}
                <FieldLabel>{t('ob_your_name')}</FieldLabel>
                <TextInput
                  value={name} onChangeText={setName} maxLength={50}
                  placeholder={t('ob_name_ph_learner')} placeholderTextColor={COLORS.mutedLight}
                  className={`${inputClass} mb-4`}
                />

                {/* Country */}
                <FieldLabel>{t('ob_your_country')}</FieldLabel>
                <Pressable onPress={() => setPicking(true)} className={`${inputClass} mb-4 flex-row items-center justify-between`}>
                  <View className="flex-row items-center gap-2.5">
                    <Text className="text-[20px]">{flagEmoji(country)}</Text>
                    <Text className={`text-[15px] ${currentCountry ? 'text-ink' : 'text-muted-light'}`}>
                      {currentCountry ? currentCountry.name : t('ob_select_country')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-down" size={18} color={COLORS.muted} />
                </Pressable>

                {/* Tagline */}
                <FieldLabel hint={t('ob_optional')}>{t('ob_tagline')}</FieldLabel>
                <Text className="text-[12px] text-muted mb-2">{t('ob_tagline_hint')}</Text>
                <TextInput
                  value={tagline} onChangeText={setTagline} maxLength={100}
                  placeholder={t('ob_tagline_ph')} placeholderTextColor={COLORS.mutedLight}
                  className={`${inputClass} mb-5`}
                />

                <View className="h-px bg-line-soft mb-4" />

                {/* Langue de l'interface = langue de BASE (native = depuis quoi on
                    apprend). On la choisit EN PREMIER : elle définit native_lang et
                    filtre la langue apprise juste en dessous. */}
                <StepLabel icon="language">{t('ob_interface_lang')}</StepLabel>
                <View className="mb-5">
                  <SegmentedPicker
                    value={lang}
                    onChange={(v) => { changeLang(v); if (v === learnLang) setLearnLang(LEARNABLE.find((c) => c !== v)); }}
                    options={[
                      { value: 'en', label: 'English' },
                      { value: 'zh', label: '中文' },
                      { value: 'fr', label: 'Français' },
                    ]}
                  />
                </View>

                <View className="h-px bg-line-soft mb-4" />

                {/* Langue apprise (exclut la langue de base = interface) */}
                <StepLabel icon="school">{t('ob_learn_lang_q')}</StepLabel>
                <View className="mb-2">
                  <SegmentedPicker
                    value={learnLang}
                    onChange={setLearnLang}
                    options={LEARNABLE.filter((c) => c !== lang).map((c) => ({ value: c, label: LANG_META[c].endonym }))}
                  />
                </View>

                {error ? <Text className="text-danger text-[13px] font-semibold mt-2">{error}</Text> : null}
                <PrimaryButton label={t('ob_continue')} onPress={submitLearner} saving={saving} />
              </>
            )}
          </View>
          )}

            </View>{/* fin colonne contenu */}
          </View>{/* fin corps (row/colonne) */}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
