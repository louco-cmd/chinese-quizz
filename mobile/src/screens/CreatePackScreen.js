import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from '../components/Popup';
import { planPack, createPack } from '../api';
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

  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  // Checkout d'acquisition des mots manquants.
  const [checkout, setCheckout] = useState(null); // { toBuy, needs:[{chinese,english}], cost, balance }
  const [buying, setBuying] = useState(false);

  const priceNum = parseInt(price, 10);
  const priceValid = price !== '' && Number.isInteger(priceNum) && priceNum >= 0 && priceNum <= 100000;
  const canPublish = title.trim() && priceValid && text.trim() && !publishing;

  // Envoie la création (avec ou sans acquisition).
  async function doCreate(acquire, translations) {
    try {
      await createPack({ title: title.trim(), description: description.trim(), price: priceNum, text, translations, acquire });
      onCreated?.();
    } catch (e) {
      throw e;
    }
  }

  // Clic "Publish" : on planifie d'abord (possédés / à acheter / à traduire).
  async function onPublish() {
    if (!canPublish) return;
    setPublishing(true); setError('');
    try {
      const plan = await planPack(text);
      const missingCount = (plan.toBuy?.length || 0) + (plan.needsTranslation?.length || 0);
      if (missingCount === 0) {
        await doCreate(false, {}); // tout possédé → publication directe
        return;
      }
      // Ouvre le checkout d'acquisition.
      setCheckout({
        toBuy: plan.toBuy || [],
        needs: (plan.needsTranslation || []).map((w) => ({ chinese: w.chinese, english: '' })),
        cost: plan.cost || 0,
        balance: plan.balance ?? 0,
      });
    } catch (e) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setPublishing(false);
    }
  }

  const needsFilled = checkout ? checkout.needs.every((n) => n.english.trim()) : false;
  const enoughCoins = checkout ? checkout.balance >= checkout.cost : true;

  async function confirmBuy() {
    if (!checkout || !needsFilled || !enoughCoins) return;
    setBuying(true); setError('');
    try {
      const translations = {};
      checkout.needs.forEach((n) => { translations[n.chinese] = n.english.trim(); });
      await doCreate(true, translations);
    } catch (e) {
      setError(e.message || 'Could not complete the purchase.');
      setBuying(false);
    }
  }

  function updateNeed(i, english) {
    setCheckout((c) => ({ ...c, needs: c.needs.map((n, idx) => (idx === i ? { ...n, english } : n)) }));
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
        <Text style={{ color: COLORS.muted, fontSize: 13, marginTop: 2 }}>Sell a set of words to the community.</Text>
      </View>

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, width: '100%', maxWidth: 560, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
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

        <Field label="Words" hint="one per line">
          <TextInput value={text} onChangeText={setText} multiline autoCapitalize="none"
            placeholder={'你好\n谢谢\n再见'} placeholderTextColor={COLORS.mutedLight}
            style={{ ...inputStyle, minHeight: 150, textAlignVertical: 'top', lineHeight: 22 }} />
        </Field>

        {error && !checkout ? <Text style={{ color: COLORS.danger, fontSize: 13, fontWeight: '600', marginBottom: 12 }}>{error}</Text> : null}

        <Pressable onPress={onPublish} disabled={!canPublish}
          style={{ borderRadius: 14, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, backgroundColor: canPublish ? COLORS.jiayou : '#e9ecef' }}>
          {publishing ? <ActivityIndicator color="#fff" /> : (
            <>
              <Ionicons name="pricetag" size={16} color={canPublish ? '#fff' : COLORS.muted} />
              <Text style={{ color: canPublish ? '#fff' : COLORS.muted, fontWeight: '700', fontSize: 15 }}>Publish pack</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Checkout : acquérir les mots manquants ── */}
      <Popup visible={!!checkout} onClose={() => { if (!buying) setCheckout(null); }} maxWidth={440}>
        {checkout ? (
          <View>
            <Text style={{ fontSize: 17, fontWeight: '800', color: '#1a1a2e', marginBottom: 6 }}>Buy the missing words</Text>
            <Text style={{ fontSize: 13.5, color: COLORS.muted, marginBottom: 14, lineHeight: 19 }}>
              You cannot sell words you don't own yourself. Buy them now to continue — they're added to your collection.
            </Text>

            <ScrollView style={{ maxHeight: 300 }}>
              {/* À traduire : l'user doit fournir l'anglais */}
              {checkout.needs.map((n, i) => (
                <View key={`need-${n.chinese}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <Text style={{ fontSize: 20, fontWeight: '700', color: '#1a1a2e', minWidth: 48 }}>{n.chinese}</Text>
                  <TextInput
                    value={n.english}
                    onChangeText={(t) => updateNeed(i, t)}
                    placeholder="translation…" placeholderTextColor={COLORS.mutedLight}
                    style={{ flex: 1, borderWidth: 1, borderColor: n.english.trim() ? COLORS.line : '#f0c36d', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 14 }}
                  />
                </View>
              ))}
              {/* À acheter : déjà dans le dico */}
              {checkout.toBuy.map((w, i) => (
                <View key={`buy-${w.chinese}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: i === checkout.toBuy.length - 1 ? 0 : 1, borderColor: '#f2f2f4' }}>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: '#1a1a2e', minWidth: 48 }}>{w.chinese}</Text>
                  <Text style={{ flex: 1, fontSize: 13.5, color: COLORS.muted }} numberOfLines={1}>{w.english}</Text>
                </View>
              ))}
            </ScrollView>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 4 }}>
              <Text style={{ fontSize: 13, color: COLORS.muted }}>Balance: {checkout.balance} ₵</Text>
              <Text style={{ fontSize: 15, fontWeight: '800', color: '#1a1a2e' }}>Total: {checkout.cost} ₵</Text>
            </View>
            {!enoughCoins ? <Text style={{ color: COLORS.danger, fontSize: 12.5, fontWeight: '600', marginBottom: 8 }}>Not enough coins.</Text> : null}
            {error ? <Text style={{ color: COLORS.danger, fontSize: 12.5, fontWeight: '600', marginBottom: 8 }}>{error}</Text> : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <Pressable onPress={() => { if (!buying) setCheckout(null); }} style={{ flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 2, borderColor: COLORS.line, alignItems: 'center' }}>
                <Text style={{ color: '#444', fontWeight: '700' }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={confirmBuy} disabled={buying || !needsFilled || !enoughCoins}
                style={{ flex: 1.4, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: (needsFilled && enoughCoins && !buying) ? COLORS.jiayou : '#e9ecef' }}>
                {buying ? <ActivityIndicator color="#fff" size="small" /> : (
                  <Text style={{ color: (needsFilled && enoughCoins) ? '#fff' : COLORS.muted, fontWeight: '700' }}>
                    Buy {checkout.cost} ₵ & publish
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : null}
      </Popup>
    </View>
  );
}
