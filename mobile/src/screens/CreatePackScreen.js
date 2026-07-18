import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { checkMyWords, createPack } from '../api';
import { COLORS, SHADOW_CARD } from '../theme';

function Field({ label, hint, children }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: '#1a1a2e', marginBottom: 6 }}>
        {label}{hint ? <Text style={{ color: COLORS.mutedLight, fontWeight: '500' }}>  {hint}</Text> : null}
      </Text>
      {children}
    </View>
  );
}
const inputStyle = {
  backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.line,
  paddingHorizontal: 14, paddingVertical: 11, fontSize: 15,
};

export default function CreatePackScreen({ onBack, onCreated }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [text, setText] = useState('');

  const [owned, setOwned] = useState([]);
  const [missing, setMissing] = useState([]);
  const [checking, setChecking] = useState(false);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Vérification live des mots (possédés / manquants), debouncée.
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!text.trim()) { setOwned([]); setMissing([]); setChecking(false); return; }
    setChecking(true);
    timer.current = setTimeout(async () => {
      try {
        const d = await checkMyWords(text);
        setOwned(d.owned || []);
        setMissing(d.missing || []);
      } catch { /* silencieux */ } finally { setChecking(false); }
    }, 450);
    return () => clearTimeout(timer.current);
  }, [text]);

  const priceNum = parseInt(price, 10);
  const priceValid = price !== '' && Number.isInteger(priceNum) && priceNum >= 0 && priceNum <= 100000;
  const canCreate = title.trim() && priceValid && owned.length > 0 && missing.length === 0 && !creating;

  async function submit() {
    if (!canCreate) return;
    setCreating(true); setError('');
    try {
      await createPack({ title: title.trim(), description: description.trim(), price: priceNum, text });
      onCreated?.();
    } catch (e) {
      // Le serveur peut renvoyer la liste des mots manquants.
      if (e.data?.missing) setMissing(e.data.missing);
      setError(e.message || 'Could not create the pack.');
      setCreating(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      {/* Header façon Settings */}
      <View style={{ paddingTop: 14, paddingHorizontal: 16, paddingBottom: 6 }}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
            <Ionicons name="chevron-back" size={20} color={COLORS.jiayou} />
            <Text style={{ color: COLORS.jiayou, fontWeight: '600' }}>Back</Text>
          </Pressable>
        ) : null}
        <Text style={{ color: '#1a1a2e', fontSize: 22, fontWeight: '800' }}>Create a pack</Text>
        <Text style={{ color: COLORS.muted, fontSize: 13, marginTop: 2 }}>Sell a set of words from your collection.</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        <Field label="Title">
          <TextInput value={title} onChangeText={setTitle} maxLength={80}
            placeholder="e.g. Café & Restaurant" placeholderTextColor={COLORS.mutedLight} style={inputStyle} />
        </Field>

        <Field label="Description" hint="(optional)">
          <TextInput value={description} onChangeText={setDescription} maxLength={300} multiline
            placeholder="What's inside this pack?" placeholderTextColor={COLORS.mutedLight}
            style={{ ...inputStyle, minHeight: 72, textAlignVertical: 'top' }} />
        </Field>

        <Field label="Price" hint="in coins (₵)">
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TextInput value={price} onChangeText={(t) => setPrice(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad"
              placeholder="0" placeholderTextColor={COLORS.mutedLight} style={{ ...inputStyle, width: 120 }} />
            <Text style={{ marginLeft: 10, fontSize: 16, color: COLORS.muted, fontWeight: '700' }}>₵</Text>
          </View>
        </Field>

        <Field label="Words" hint="one per line — you must own them">
          <TextInput value={text} onChangeText={setText} multiline autoCapitalize="none"
            placeholder={'你好\n谢谢\n再见'} placeholderTextColor={COLORS.mutedLight}
            style={{ ...inputStyle, minHeight: 130, textAlignVertical: 'top', lineHeight: 22 }} />
        </Field>

        {/* Récap possédés / manquants */}
        {text.trim() ? (
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 16, ...SHADOW_CARD }}>
            {checking ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={COLORS.jiayou} />
                <Text style={{ color: COLORS.muted, fontSize: 13 }}>Checking your collection…</Text>
              </View>
            ) : (
              <>
                <Text style={{ fontSize: 13, color: COLORS.muted }}>
                  <Text style={{ fontWeight: '800', color: COLORS.success }}>{owned.length}</Text> in your collection ·{' '}
                  <Text style={{ fontWeight: '800', color: missing.length ? COLORS.danger : COLORS.mutedLight }}>{missing.length}</Text> missing
                </Text>
                {missing.length ? (
                  <View style={{ marginTop: 10, backgroundColor: '#fff3cd', borderRadius: 10, padding: 10 }}>
                    <Text style={{ fontSize: 12.5, color: '#7c5800', fontWeight: '600', marginBottom: 6 }}>
                      You don't own these yet — add them to your collection first:
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {missing.map((w, i) => (
                        <View key={`${w}-${i}`} style={{ backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#ffe082' }}>
                          <Text style={{ fontSize: 14, color: '#1a1a2e' }}>{w}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}
              </>
            )}
          </View>
        ) : null}

        {error ? <Text style={{ color: COLORS.danger, fontSize: 13, fontWeight: '600', marginBottom: 12 }}>{error}</Text> : null}

        <Pressable onPress={submit} disabled={!canCreate}
          style={{ borderRadius: 14, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, backgroundColor: canCreate ? COLORS.jiayou : '#e9ecef' }}>
          {creating ? <ActivityIndicator color="#fff" /> : (
            <>
              <Ionicons name="pricetag" size={16} color={canCreate ? '#fff' : COLORS.muted} />
              <Text style={{ color: canCreate ? '#fff' : COLORS.muted, fontWeight: '700', fontSize: 15 }}>
                Publish pack{owned.length ? ` · ${owned.length} word${owned.length === 1 ? '' : 's'}` : ''}
              </Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}
