import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import GoogleSignIn from '../components/GoogleSignIn';
import { login, register, checkEmail, loginWithGoogle, setToken } from '../api';

const inputCls = 'border border-gray-200 rounded-xl px-4 py-3 mb-3 text-base';

// Login email-first (miroir de l'EJS) :
//  1) email → check-email → 'login' | 'signup' | 'google_only'
//  2) mot de passe → connexion ou création de compte.
export default function LoginScreen({ onLoggedIn, onForgot }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState('email'); // 'email' | 'login' | 'signup' | 'google_only'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function exchangeGoogle(idToken) {
    setError('');
    try {
      const { token } = await loginWithGoogle(idToken);
      await setToken(token);
      onLoggedIn();
    } catch (e) { setError(e.message || 'Google sign-in failed'); }
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
    setStep('email'); setPassword(''); setError('');
  }

  const onEmailKey = () => { if (step === 'email') continueEmail(); };

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
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
              <Text className="text-gray-500 text-center text-sm px-2">
                Learn Chinese in the real world. Collect your words, test yourself,
                challenge your friends and much more.
              </Text>
            </View>

            {/* Google */}
            <GoogleSignIn onSuccess={exchangeGoogle} onError={setError} />

            {/* Divider */}
            <View className="flex-row items-center my-5">
              <View className="flex-1 h-px bg-gray-200" />
              <Text className="mx-3 text-gray-400 text-xs">or</Text>
              <View className="flex-1 h-px bg-gray-200" />
            </View>

            {/* Email (verrouillé après l'étape 1) */}
            <TextInput
              className={`${inputCls} ${step !== 'email' ? 'bg-gray-50 text-gray-500' : ''}`}
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
                <TextInput
                  className={inputCls}
                  secureTextEntry value={password} onChangeText={setPassword}
                  autoFocus onSubmitEditing={step === 'login' ? doLogin : doSignup} returnKeyType="go"
                  placeholder={step === 'signup' ? 'Choose a password' : 'Password'} placeholderTextColor="#9aa4b2"
                />
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
