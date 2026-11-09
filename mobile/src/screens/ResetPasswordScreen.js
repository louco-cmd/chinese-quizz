import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { verifyResetToken, resetPassword } from '../api';
import { Button, Input } from '../ui';

const cardShadow = {
  shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.12, shadowRadius: 40, elevation: 8,
};

// `token` vient du lien email (?token=). `onDone` renvoie vers la connexion.
export default function ResetPasswordScreen({ token, onDone }) {
  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const r = await verifyResetToken(token);
      setValid(!!r.valid);
      setEmail(r.email || '');
      if (!r.valid) setError('This reset link is invalid or has expired.');
    } catch {
      setValid(false); setError('Could not verify this link.');
    } finally { setChecking(false); }
  }, [token]);

  useEffect(() => { if (token) { check(); } else { setChecking(false); setError('Missing reset token.'); } }, [token, check]);

  async function submit() {
    if (!password) { setError('Choose a new password'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setError(''); setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (e) { setError(e.message || 'Could not reset your password'); }
    finally { setLoading(false); }
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }} keyboardShouldPersistTaps="handled">
          <View className="bg-white rounded-3xl p-6" style={{ width: '100%', maxWidth: 400, alignSelf: 'center', ...cardShadow }}>
            <Text className="text-5xl font-extrabold text-jiayou mb-2 text-center">加油!</Text>

            {checking ? (
              <View className="items-center py-4"><ActivityIndicator color="#0d6efd" /><Text className="text-gray-500 text-sm mt-3">Checking your link…</Text></View>
            ) : done ? (
              <View className="items-center">
                <Ionicons name="checkmark-circle" size={44} color="#16a34a" />
                <Text className="text-ink font-bold text-[17px] mt-3 mb-1">Password updated</Text>
                <Text className="text-gray-500 text-center text-sm mb-5">You can now sign in with your new password.</Text>
                <Button title="Go to sign in" onPress={onDone} fullWidth />
              </View>
            ) : !valid ? (
              <View className="items-center">
                <Ionicons name="alert-circle-outline" size={40} color="#dc3545" />
                <Text className="text-ink font-bold text-[16px] mt-3 mb-1 text-center">Link invalid or expired</Text>
                <Text className="text-gray-500 text-center text-sm mb-5">{error || 'Please request a new reset link.'}</Text>
                <Button title="Back to sign in" onPress={onDone} fullWidth />
              </View>
            ) : (
              <>
                <Text className="text-ink font-bold text-[17px] mb-1 text-center">Set a new password</Text>
                {email ? <Text className="text-gray-500 text-center text-sm mb-5">for {email}</Text> : <View className="mb-4" />}
                <Input
                  style={{ marginBottom: 12 }}
                  secureTextEntry value={password} onChangeText={setPassword}
                  placeholder="New password" autoFocus
                />
                <Input
                  style={{ marginBottom: 4 }}
                  secureTextEntry value={confirm} onChangeText={setConfirm} onSubmitEditing={submit} returnKeyType="go"
                  placeholder="Confirm password"
                />
                <Text className="text-gray-400 text-xs mb-3 mt-1">At least 8 characters, 1 uppercase and 1 number.</Text>
                {error ? <Text className="text-red-500 text-sm mb-3">{error}</Text> : null}
                <Button title="Reset password" onPress={submit} loading={loading} size="lg" fullWidth />
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
