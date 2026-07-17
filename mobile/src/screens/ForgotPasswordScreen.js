import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { forgotPassword } from '../api';

const cardShadow = {
  shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.12, shadowRadius: 40, elevation: 8,
};

export default function ForgotPasswordScreen({ onBack }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!email.trim()) { setError('Enter your email'); return; }
    setError(''); setLoading(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (e) { setError(e.message || 'Something went wrong'); }
    finally { setLoading(false); }
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }} keyboardShouldPersistTaps="handled">
          <View className="bg-white rounded-3xl p-6" style={{ width: '100%', maxWidth: 400, alignSelf: 'center', ...cardShadow }}>
            <Text className="text-5xl font-extrabold text-jiayou mb-2 text-center">加油!</Text>

            {sent ? (
              <View className="items-center">
                <Ionicons name="mail-open-outline" size={40} color="#0d6efd" />
                <Text className="text-ink font-bold text-[17px] mt-3 mb-1 text-center">Check your inbox</Text>
                <Text className="text-gray-500 text-center text-sm mb-5">
                  If your email is associated with an account, you'll receive a link to reset your password.
                </Text>
                <Pressable onPress={onBack} className="bg-jiayou rounded-full py-3.5 px-6 items-center w-full active:opacity-80">
                  <Text className="text-white font-bold">Back to sign in</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text className="text-ink font-bold text-[17px] mb-1 text-center">Reset your password</Text>
                <Text className="text-gray-500 text-center text-sm mb-5 px-2">
                  Enter your account email and we'll send you a reset link.
                </Text>
                <TextInput
                  className="border border-gray-200 rounded-xl px-4 py-3 mb-3 text-base"
                  autoCapitalize="none" keyboardType="email-address" autoCorrect={false}
                  value={email} onChangeText={setEmail} onSubmitEditing={submit} returnKeyType="send"
                  placeholder="Email address" placeholderTextColor="#9aa4b2" autoFocus
                />
                {error ? <Text className="text-red-500 text-sm mb-3">{error}</Text> : null}
                <Pressable onPress={submit} disabled={loading} className="bg-jiayou rounded-full py-4 items-center active:opacity-80">
                  {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-bold text-base">Send reset link</Text>}
                </Pressable>
                <Pressable onPress={onBack} className="py-2.5 items-center mt-1">
                  <Text className="text-jiayou font-semibold text-sm">← Back to sign in</Text>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
