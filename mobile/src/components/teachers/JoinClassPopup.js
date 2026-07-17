import { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from '../Popup';
import { COLORS } from '../../theme';
import { joinClass } from '../../api';

// Popup "Join a class" : saisie du code fourni par le prof.
export default function JoinClassPopup({ visible, onClose, onJoined }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (visible) { setCode(''); setError(''); setDone(null); setLoading(false); }
  }, [visible]);

  async function submit() {
    const c = code.trim().toUpperCase();
    if (!c) return setError('Enter the code your teacher gave you.');
    setLoading(true); setError('');
    try {
      const d = await joinClass(c);
      setDone(d.classroom?.name || 'your class');
      onJoined?.();
    } catch (e) {
      setError(e.message || 'Could not join the class.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Popup visible={visible} onClose={onClose} maxWidth={360}>
      <View style={{ alignItems: 'center', marginBottom: 8 }}>
        <Ionicons name="school" size={30} color={COLORS.jiayou} />
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginTop: 8 }}>Join a class</Text>
      </View>

      {done ? (
        <>
          <Text style={{ textAlign: 'center', color: COLORS.success, fontWeight: '600', marginVertical: 16 }}>
            ✓ You joined {done}!
          </Text>
          <Pressable onPress={onClose} style={{ backgroundColor: COLORS.jiayou, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Done</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={{ textAlign: 'center', color: COLORS.muted, fontSize: 13.5, marginBottom: 14 }}>
            Enter the code your teacher gave you.
          </Text>
          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="CODE"
            placeholderTextColor="#adb5bd"
            autoCapitalize="characters"
            autoCorrect={false}
            style={{ backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#e3e8f7', borderRadius: 12, paddingVertical: 13, textAlign: 'center', fontSize: 18, fontWeight: '700', letterSpacing: 2, color: '#1a1a2e', marginBottom: 12 }}
          />
          {error ? <Text style={{ color: COLORS.danger, fontSize: 13, marginBottom: 10, fontWeight: '600', textAlign: 'center' }}>{error}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
              <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} disabled={loading} style={{ flex: 1, backgroundColor: COLORS.jiayou, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
              {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Join</Text>}
            </Pressable>
          </View>
        </>
      )}
    </Popup>
  );
}
