import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, ActivityIndicator,
  KeyboardAvoidingView,
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

export default function CreatePackScreen({ onBack, onCreated, editPack }) {
  const isEdit = !!editPack;
  const [title, setTitle] = useState(editPack?.title || '');
  const [description, setDescription] = useState(editPack?.description || '');
  const [price, setPrice] = useState(editPack?.price != null ? String(editPack.price) : '');
  // Édition : on ne pré-remplit QUE les surfaces chinoises (l'édition n'est pas
  // encore câblée pour les autres langues). `w.zh` vient du détail ; fallback
  // `w.chinese` pour les anciens clients.
  const [text, setText] = useState(
    editPack?.words?.length
      ? editPack.words.map((w) => w.zh || w.chinese).filter(Boolean).join('\n')
      : '');

  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  // Checkout d'acquisition des mots manquants.
  const [checkout, setCheckout] = useState(null); // { toBuy, needs:[{chinese,english}], owned, cost, balance }
  const [buying, setBuying] = useState(false);
  // Estimation de coût affichée sous la section Words. `null` tant que le débounce
  // n'a pas répondu → on retombe sur `lignes × 3` (borne haute) en attendant.
  const [estimate, setEstimate] = useState(null); // { cost, ownedCount, acquireCount }
  const estTimer = useRef(null);

  // Nombre de mots (lignes non vides) → estimation immédiate max (3 ₵/mot).
  const lineCount = text.split('\n').map((s) => s.trim()).filter(Boolean).length;

  // Coût réel = 3 ₵ par mot NON possédé. On interroge planPack en débounce (le
  // même endpoint que la publication) pour affiner l'estimation ligne×3.
  useEffect(() => {
    clearTimeout(estTimer.current);
    if (!lineCount) { setEstimate({ cost: 0, ownedCount: 0, acquireCount: 0 }); return undefined; }
    estTimer.current = setTimeout(async () => {
      try {
        const plan = await planPack(text);
        const acquireCount = (plan.toBuy?.length || 0) + (plan.needsTranslation?.length || 0);
        setEstimate({ cost: plan.cost || 0, ownedCount: plan.owned?.length || 0, acquireCount });
      } catch { /* on garde l'estimation ligne×3 */ }
    }, 600);
    return () => clearTimeout(estTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const estimatedCost = estimate ? estimate.cost : lineCount * 3;

  const scrollRef = useRef(null);
  // Au focus d'un champ : sur WEB mobile le viewport se réduit sous le clavier mais
  // la page ne défile pas seule → on remonte le champ focalisé au centre. Sur natif,
  // e.target n'est pas un nœud DOM → no-op (adjustResize Android / insets iOS gèrent).
  const focusScroll = (e) => {
    const node = e?.target;
    if (node && typeof node.scrollIntoView === 'function') {
      setTimeout(() => { try { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* noop */ } }, 60);
    }
  };

  const priceNum = parseInt(price, 10);
  const priceValid = price !== '' && Number.isInteger(priceNum) && priceNum >= 0 && priceNum <= 100000;
  const canPublish = title.trim() && priceValid && text.trim() && !publishing;

  // Envoie la création (avec ou sans acquisition).
  async function doCreate(acquire, translations) {
    try {
      await createPack({ title: title.trim(), description: description.trim(), price: priceNum, text, translations, acquire, packId: editPack?.id });
      onCreated?.();
    } catch (e) {
      throw e;
    }
  }

  // Clic "Publish" : on planifie d'abord (possédés / à acheter / à traduire),
  // puis on ouvre TOUJOURS la popup de validation — même si tout est déjà
  // possédé — pour que l'utilisateur puisse relire/corriger la traduction de
  // CHAQUE mot avant publication (et remplir celles qui manquent en base).
  async function onPublish() {
    if (!canPublish) return;
    setPublishing(true); setError('');
    try {
      const plan = await planPack(text);
      // Fusionne les trois catégories en une seule liste éditable, indexée par mot.
      const byWord = new Map();
      (plan.owned || []).forEach((w) => byWord.set(w.chinese, { chinese: w.chinese, pinyin: w.pinyin || '', english: w.english || '', kind: 'owned' }));
      (plan.toBuy || []).forEach((w) => byWord.set(w.chinese, { chinese: w.chinese, pinyin: w.pinyin || '', english: w.english || '', kind: 'buy' }));
      // Hors dico : pré-remplit avec la suggestion CC-CEDICT (éditable).
      (plan.needsTranslation || []).forEach((w) => byWord.set(w.chinese, { chinese: w.chinese, pinyin: w.pinyin || '', english: w.suggested || '', kind: 'buy' }));
      // Liste ordonnée selon la saisie de l'utilisateur (dédupliquée).
      const seen = new Set();
      const items = [];
      text.split('\n').map((s) => s.trim()).filter(Boolean).forEach((c) => {
        if (byWord.has(c) && !seen.has(c)) { seen.add(c); items.push(byWord.get(c)); }
      });
      setCheckout({ items, cost: plan.cost || 0, balance: plan.balance ?? 0 });
    } catch (e) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setPublishing(false);
    }
  }

  const needsFilled = checkout ? checkout.items.every((n) => n.english.trim()) : false;
  const enoughCoins = checkout ? checkout.balance >= checkout.cost : true;

  async function confirmBuy() {
    if (!checkout || !needsFilled || !enoughCoins) return;
    setBuying(true); setError('');
    try {
      // Envoie les traductions de TOUS les mots (le back applique aussi les
      // corrections aux mots déjà en base, pas seulement aux mots créés).
      const translations = {};
      checkout.items.forEach((n) => { translations[n.chinese] = n.english.trim(); });
      const acquire = checkout.items.some((n) => n.kind === 'buy');
      await doCreate(acquire, translations);
    } catch (e) {
      setError(e.message || 'Could not complete the purchase.');
      setBuying(false);
    }
  }

  function updateNeed(i, english) {
    setCheckout((c) => ({ ...c, items: c.items.map((n, idx) => (idx === i ? { ...n, english } : n)) }));
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#f8f9fa' }}
      // `padding` sur les DEUX plateformes : le composant écoute les events clavier
      // et ajoute un padding bas = hauteur du clavier, poussant le contenu vers le
      // haut. On ne peut PAS compter sur `adjustResize` côté Android : en SDK 57
      // l'edge-to-edge est activé par défaut et la fenêtre ne se redimensionne plus
      // sous le clavier → `undefined`/`height` ne poussaient rien (champs cachés).
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      {/* `style flex:1` = ScrollView bornée à la fenêtre (indispensable pour que la
          zone scrollable rétrécisse avec le clavier). `paddingBottom` = marge pour
          faire remonter le dernier champ + le bouton au-dessus du clavier. */}
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 220, width: '100%', maxWidth: 560, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        {/* Header : scrolle avec le reste (plus fixe en haut). */}
        <View style={{ marginBottom: 14 }}>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
              <Ionicons name="chevron-back" size={20} color={COLORS.jiayou} />
              <Text style={{ color: COLORS.jiayou, fontWeight: '600' }}>Back</Text>
            </Pressable>
          ) : null}
          <Text style={{ color: '#1a1a2e', fontSize: 22, fontWeight: '800' }}>{isEdit ? 'Edit pack' : 'Create a pack'}</Text>
          <Text style={{ color: COLORS.muted, fontSize: 13, marginTop: 2 }}>{isEdit ? 'Add or remove words, update the details.' : 'Sell a set of words to the community.'}</Text>
        </View>

        <Field label="Title">
          <TextInput value={title} onChangeText={setTitle} maxLength={80} onFocus={focusScroll}
            placeholder="e.g. Café & Restaurant" placeholderTextColor={COLORS.mutedLight} style={inputStyle} />
        </Field>

        <Field label="Description" hint="(optional)">
          <TextInput value={description} onChangeText={setDescription} maxLength={300} multiline onFocus={focusScroll}
            placeholder="What's inside this pack?" placeholderTextColor={COLORS.mutedLight}
            style={{ ...inputStyle, minHeight: 72, textAlignVertical: 'top' }} />
        </Field>

        <Field label="Price" hint="in coins (₵)">
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TextInput value={price} onChangeText={(t) => setPrice(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" onFocus={focusScroll}
              placeholder="0" placeholderTextColor={COLORS.mutedLight} style={{ ...inputStyle, width: 120 }} />
            <Text style={{ marginLeft: 10, fontSize: 16, color: COLORS.muted, fontWeight: '700' }}>₵</Text>
          </View>
        </Field>

        <Field label="Words" hint="One per line — only Chinese hanzi supported">
          {/* Coût estimé du pass : 3 ₵ par mot NON possédé (affiné en débounce). */}
          {lineCount > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Ionicons name="cash-outline" size={14} color={COLORS.muted} />
              <Text style={{ fontSize: 12.5, color: COLORS.muted }}>
                Estimated cost of the pack:{' '}
                <Text style={{ fontWeight: '800', color: '#1a1a2e' }}>{estimatedCost} ₵</Text>
                {estimate && estimate.ownedCount > 0 ? (
                  <Text style={{ color: COLORS.mutedLight }}>{`  ·  ${estimate.ownedCount} already owned`}</Text>
                ) : null}
              </Text>
            </View>
          ) : null}
          <TextInput value={text} onChangeText={setText} multiline autoCapitalize="none" onFocus={focusScroll}
            placeholder={'你好\n谢谢\n再见'} placeholderTextColor={COLORS.mutedLight}
            style={{ ...inputStyle, minHeight: 150, textAlignVertical: 'top', lineHeight: 22 }} />
        </Field>

        {error && !checkout ? <Text style={{ color: COLORS.danger, fontSize: 13, fontWeight: '600', marginBottom: 12 }}>{error}</Text> : null}

        <Pressable onPress={onPublish} disabled={!canPublish}
          style={{ borderRadius: 999, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, backgroundColor: canPublish ? COLORS.jiayou : '#e9ecef' }}>
          {publishing ? <ActivityIndicator color="#fff" /> : (
            <>
              <Ionicons name={isEdit ? 'save' : 'pricetag'} size={16} color={canPublish ? '#fff' : COLORS.muted} />
              <Text style={{ color: canPublish ? '#fff' : COLORS.muted, fontWeight: '700', fontSize: 15 }}>{isEdit ? 'Update pack' : 'Publish pack'}</Text>
            </>
          )}
        </Pressable>
      </ScrollView>

      {/* ── Checkout : acquérir les mots manquants ── */}
      <Popup visible={!!checkout} onClose={() => { if (!buying) setCheckout(null); }} maxWidth={440} scroll={false}>
        {checkout ? (
          <View>
            <Text style={{ fontSize: 17, fontWeight: '800', color: '#1a1a2e', marginBottom: 6 }}>
              {checkout.cost > 0 ? 'Review & buy the words' : 'Review the translations'}
            </Text>
            <Text style={{ fontSize: 13.5, color: COLORS.muted, marginBottom: 14, lineHeight: 19 }}>
              Check the translation of every word — edit any that's wrong or missing.
              {checkout.cost > 0 ? " New words are added to your collection (3 ₵ each)." : ''}
            </Text>

            <ScrollView style={{ maxHeight: 300 }}>
              {/* Une ligne éditable par mot (possédés compris). Colonne gauche à
                  largeur FIXE → tous les champs de droite s'alignent. */}
              {checkout.items.map((n, i) => (
                <View key={`item-${n.chinese}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <View style={{ width: 92 }}>
                    <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 19, fontWeight: '700', color: '#1a1a2e' }}>{n.chinese}</Text>
                    {n.pinyin ? <Text numberOfLines={1} style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 1 }}>{n.pinyin}</Text> : null}
                  </View>
                  <TextInput
                    value={n.english}
                    onChangeText={(t) => updateNeed(i, t)}
                    placeholder="translation…" placeholderTextColor={COLORS.mutedLight}
                    style={{ flex: 1, borderWidth: 1, borderColor: n.english.trim() ? COLORS.line : '#f0c36d', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 14 }}
                  />
                  {n.kind === 'owned' ? (
                    <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
                  ) : (
                    <Text style={{ fontSize: 11, color: COLORS.muted, fontWeight: '700', width: 26, textAlign: 'right' }}>3 ₵</Text>
                  )}
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
              <Pressable onPress={() => { if (!buying) setCheckout(null); }} style={{ flex: 1, paddingVertical: 13, borderRadius: 999, borderWidth: 2, borderColor: COLORS.line, alignItems: 'center' }}>
                <Text style={{ color: '#444', fontWeight: '700' }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={confirmBuy} disabled={buying || !needsFilled || !enoughCoins}
                style={{ flex: 1.4, paddingVertical: 13, borderRadius: 999, alignItems: 'center', backgroundColor: (needsFilled && enoughCoins && !buying) ? COLORS.jiayou : '#e9ecef' }}>
                {buying ? <ActivityIndicator color="#fff" size="small" /> : (
                  <Text style={{ color: (needsFilled && enoughCoins) ? '#fff' : COLORS.muted, fontWeight: '700' }}>
                    {checkout.cost > 0 ? `Buy ${checkout.cost} ₵ & ${isEdit ? 'update' : 'publish'}` : (isEdit ? 'Update pack' : 'Publish pack')}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : null}
      </Popup>
    </KeyboardAvoidingView>
  );
}
