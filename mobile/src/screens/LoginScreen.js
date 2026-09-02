import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFonts, LaBelleAurore_400Regular } from '@expo-google-fonts/la-belle-aurore';
import GoogleSignIn from '../components/GoogleSignIn';
import AppleSignIn from '../components/AppleSignIn';
import LegalScreen from './LegalScreen';
import { TERMS_BLOCKS, PRIVACY_BLOCKS } from '../data/legalContent';
import { login, register, checkEmail, loginWithGoogle, loginWithApple, setToken } from '../api';

// Style explicite (et pas seulement className) : sur natif, NativeWind n'applique
// pas de façon fiable la couleur du texte d'un TextInput → texte invisible. On fixe
// donc color/fontSize/bordure en dur, identique web + natif.
const inputStyle = {
  borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12,
  paddingHorizontal: 16, paddingVertical: 12, marginBottom: 12,
  fontSize: 16, color: '#1a1a2e', backgroundColor: '#fff',
};
const inputLocked = { backgroundColor: '#f9fafb', color: '#6b7280' };

// Message d'échec Google : la cause n°1 pour notre public est le blocage de
// Google en Chine → on oriente vers le VPN. Bilingue (en + zh) car l'écran de
// login est en anglais par défaut mais l'utilisateur concerné lit le chinois.
const GOOGLE_FAIL_MSG =
  "Google sign-in failed. If you're in China, you may need a VPN to reach Google.\nGoogle 登录失败。如果你在中国，可能需要 VPN 才能连接 Google。";

// Login email-first (miroir de l'EJS) :
//  1) email → check-email → 'login' | 'signup' | 'google_only'
//  2) mot de passe → connexion ou création de compte.
export default function LoginScreen({ onLoggedIn, onForgot }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false); // afficher/masquer le mot de passe
  const [fontsLoaded] = useFonts({ LaBelleAurore_400Regular }); // police cursive du sous-titre
  const [step, setStep] = useState('email'); // 'email' | 'login' | 'signup' | 'google_only'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [legalDoc, setLegalDoc] = useState(null); // 'terms' | 'privacy' | null (overlay pré-login)

  async function exchangeGoogle(idToken) {
    setError('');
    try {
      const { token } = await loginWithGoogle(idToken);
      await setToken(token);
      onLoggedIn();
    } catch { setError(GOOGLE_FAIL_MSG); }
  }

  async function exchangeApple(identityToken, name) {
    setError('');
    try {
      const { token } = await loginWithApple(identityToken, name);
      await setToken(token);
      onLoggedIn();
    } catch (e) { setError(e.message || 'Apple sign-in failed'); }
  }

  // Étape 1 : détermine si l'email existe.
  async function continueEmail() {
    const e = email.trim();
    if (!e) { setError('Enter your email'); return; }
    setError(''); setLoading(true);
    try {
      const { step: next } = await checkEmail(e);
      setStep(next);
    } catch (err) { setError(err.message || 'Could not check this email'); }
    finally { setLoading(false); }
  }

  // Étape 2 : connexion (compte existant).
  async function doLogin() {
    if (!password) { setError('Enter your password'); return; }
    setError(''); setLoading(true);
    try {
      const { token } = await login(email.trim(), password);
      await setToken(token);
      onLoggedIn();
    } catch (e) { setError(e.message || 'Login failed'); }
    finally { setLoading(false); }
  }

  // Étape 2 : création de compte (email inconnu).
  async function doSignup() {
    if (!password) { setError('Choose a password'); return; }
    setError(''); setLoading(true);
    try {
      const { token } = await register(email.trim(), password);
      await setToken(token);
      onLoggedIn();
    } catch (e) { setError(e.message || 'Could not create account'); }
    finally { setLoading(false); }
  }

  function resetEmail() {
    setStep('email'); setPassword(''); setError(''); setShowPw(false);
  }

  const onEmailKey = () => { if (step === 'email') continueEmail(); };

  // Overlay CGU / Confidentialité accessible SANS être connecté (requis review Apple).
  if (legalDoc) {
    return (
      <LegalScreen
        onBack={() => setLegalDoc(null)}
        title={legalDoc === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
        blocks={legalDoc === 'terms' ? TERMS_BLOCKS : PRIVACY_BLOCKS}
      />
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }} keyboardShouldPersistTaps="handled">
          <View
            className="bg-white rounded-3xl p-6"
            style={{
              width: '100%', maxWidth: 400, alignSelf: 'center',
              shadowColor: '#000', shadowOffset: { width: 0, height: 20 },
              shadowOpacity: 0.12, shadowRadius: 40, elevation: 8,
            }}
          >
            {/* Header */}
            <View className="items-center mb-6">
              <Text className="text-5xl font-extrabold text-jiayou mb-2">加油!</Text>
              <Text
                className="text-center px-2 text-jiayou"
                style={{
                  fontFamily: fontsLoaded ? 'LaBelleAurore_400Regular' : undefined,
                  fontStyle: fontsLoaded ? 'normal' : 'italic',
                  fontSize: 28, lineHeight: 34,
                }}
              >
                Boost your vocabulary
              </Text>
            </View>

            {/* Apple (iOS only) — requis par la règle 4.8 dès qu'on offre Google.
                Le composant se masque tout seul hors iOS. */}
            <View className="mb-3">
              <AppleSignIn onSuccess={exchangeApple} onError={(m) => setError(m)} />
            </View>

            {/* Google */}
            <GoogleSignIn onSuccess={exchangeGoogle} onError={() => setError(GOOGLE_FAIL_MSG)} />

            {/* Divider */}
            <View className="flex-row items-center my-5">
              <View className="flex-1 h-px bg-gray-200" />
              <Text className="mx-3 text-gray-400 text-xs">or</Text>
              <View className="flex-1 h-px bg-gray-200" />
            </View>

            {/* Email (verrouillé après l'étape 1) */}
            <TextInput
              style={[inputStyle, step !== 'email' ? inputLocked : null]}
              autoCapitalize="none" keyboardType="email-address" autoCorrect={false}
              value={email} onChangeText={setEmail}
              editable={step === 'email'}
              onSubmitEditing={onEmailKey} returnKeyType="next"
              placeholder="Email address" placeholderTextColor="#9aa4b2"
            />

            {/* Étape 1 : Continue */}
            {step === 'email' && (
              <Pressable onPress={continueEmail} disabled={loading} className="bg-jiayou rounded-full py-4 items-center active:opacity-80 mt-1">
                {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-base">Continue</Text>}
              </Pressable>
            )}

            {/* Compte Google seulement */}
            {step === 'google_only' && (
              <>
                <Text className="text-gray-600 text-sm mb-3">This email is linked to a Google account. Use “Continue with Google” above.</Text>
                <Pressable onPress={resetEmail} className="py-2 items-center"><Text className="text-jiayou font-semibold text-sm">← Use a different email</Text></Pressable>
              </>
            )}

            {/* Étape 2 : mot de passe (login ou signup) */}
            {(step === 'login' || step === 'signup') && (
              <>
                <View style={{ position: 'relative' }}>
                  <TextInput
                    style={[inputStyle, { paddingRight: 46 }]}
                    secureTextEntry={!showPw} value={password} onChangeText={setPassword}
                    autoFocus onSubmitEditing={step === 'login' ? doLogin : doSignup} returnKeyType="go"
                    placeholder={step === 'signup' ? 'Choose a password' : 'Password'} placeholderTextColor="#9aa4b2"
                  />
                  {/* Toggle œil : afficher/masquer le mot de passe. */}
                  <Pressable
                    onPress={() => setShowPw((v) => !v)} hitSlop={8}
                    style={{ position: 'absolute', right: 14, top: 0, bottom: 12, justifyContent: 'center' }}
                  >
                    <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={21} color="#9aa4b2" />
                  </Pressable>
                </View>
                {step === 'signup' && (
                  <Text className="text-gray-400 text-xs mb-3 -mt-1">At least 8 characters, 1 uppercase and 1 number.</Text>
                )}

                {error ? <Text className="text-red-500 text-sm mb-3">{error}</Text> : null}

                <Pressable onPress={step === 'login' ? doLogin : doSignup} disabled={loading} className="bg-jiayou rounded-full py-4 items-center active:opacity-80">
                  {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-base">{step === 'signup' ? 'Create account' : 'Sign in'}</Text>}
                </Pressable>
                {step === 'login' && onForgot ? (
                  <Pressable onPress={onForgot} className="py-2 items-center mt-1"><Text className="text-gray-500 text-sm">Forgot password?</Text></Pressable>
                ) : null}
                <Pressable onPress={resetEmail} className="py-2 items-center mt-0.5"><Text className="text-jiayou font-semibold text-sm">← Use a different email</Text></Pressable>
              </>
            )}

            {/* Erreur (étape email / google_only) */}
            {(step === 'email' || step === 'google_only') && error ? <Text className="text-red-500 text-sm mt-3">{error}</Text> : null}
          </View>

          {/* Pied de page légal — accessible avant toute création de compte. */}
          <View className="flex-row flex-wrap items-center justify-center mt-5" style={{ width: '100%', maxWidth: 400, alignSelf: 'center' }}>
            <Text className="text-gray-400 text-xs text-center">By continuing you agree to our </Text>
            <Pressable onPress={() => setLegalDoc('terms')} hitSlop={6}><Text className="text-jiayou text-xs font-semibold">Terms</Text></Pressable>
            <Text className="text-gray-400 text-xs"> · </Text>
            <Pressable onPress={() => setLegalDoc('privacy')} hitSlop={6}><Text className="text-jiayou text-xs font-semibold">Privacy Policy</Text></Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
