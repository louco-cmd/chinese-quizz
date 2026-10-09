import { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from './BottomSheet';
import { searchUsers, sendRedEnvelope } from '../api';
import { COLORS } from '../theme';

// Les red envelopes passent au format DRAWER (comme les trophées), sobre : pas de
// fond rouge, palette de l'app. L'emoji 🧧 suffit à porter la symbolique.
const inputStyle = {
  backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.line,
  paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: '#1a1a2e',
};
const GOLD_BG = '#fff8e1', GOLD_FG = '#856404';

// ── Composer & envoyer une red envelope (drawer) ──
export function SendRedEnvelopePopup({ visible, onClose, balance, onSent }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    if (selected || !query.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try { const d = await searchUsers(query.trim()); setResults(d.users || []); } catch { /* noop */ }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [query, selected]);

  function reset() {
    setQuery(''); setResults([]); setSelected(null); setAmount(''); setMessage('');
    setSending(false); setError(''); setDone(false);
  }
  function close() { if (!sending) { reset(); onClose?.(); } }

  const amountNum = parseInt(amount, 10);
  const amountValid = Number.isInteger(amountNum) && amountNum > 0 && amountNum <= (balance ?? 0);
  const canSend = selected && amountValid && !sending;

  async function send() {
    if (!canSend) return;
    setSending(true); setError('');
    try {
      const d = await sendRedEnvelope({ recipientId: selected.id, amount: amountNum, message: message.trim() });
      onSent?.(d.newBalance);
      setSending(false);
      setDone(true);
    } catch (e) { setError(e.message || 'Could not send.'); setSending(false); }
  }

  return (
    <BottomSheet visible={visible} onClose={close} avoidKeyboard dismissable={!sending}>
      {done ? (
        <View style={{ alignItems: 'center', paddingVertical: 6 }}>
          <Text style={{ fontSize: 52 }}>🧧</Text>
          <Text style={{ fontSize: 20, fontWeight: '800', color: '#1a1a2e', marginTop: 10 }}>Red envelope sent!</Text>
          <Text style={{ fontSize: 14, color: COLORS.muted, marginTop: 6, textAlign: 'center' }}>
            {selected?.name} will see it on their next visit.
          </Text>
          <Pressable onPress={close} style={{ marginTop: 22, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 40 }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Done</Text>
          </Pressable>
        </View>
      ) : (
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Text style={{ fontSize: 26 }}>🧧</Text>
            <Text style={{ fontSize: 19, fontWeight: '800', color: '#1a1a2e' }}>Send a red envelope</Text>
          </View>

          {/* Destinataire */}
          <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.muted, marginBottom: 4 }}>To</Text>
          {selected ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#eef4ff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.jiayou }}>{selected.name}</Text>
              <Pressable onPress={() => setSelected(null)} hitSlop={8}><Ionicons name="close-circle" size={18} color={COLORS.jiayou} /></Pressable>
            </View>
          ) : (
            <View style={{ marginBottom: 12 }}>
              <TextInput value={query} onChangeText={setQuery} placeholder="Search a friend by name…" placeholderTextColor={COLORS.mutedLight} autoCapitalize="none" style={inputStyle} />
              {results.length ? (
                <View style={{ borderWidth: 1, borderColor: COLORS.line, borderRadius: 12, marginTop: 6, overflow: 'hidden' }}>
                  {results.map((u, i) => (
                    <Pressable key={u.id} onPress={() => { setSelected(u); setQuery(''); }}
                      style={{ paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: i === results.length - 1 ? 0 : 1, borderColor: '#f2f2f4' }}>
                      <Text style={{ fontSize: 15, color: '#1a1a2e' }}>{u.name}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          )}

          {/* Montant */}
          <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.muted, marginBottom: 4 }}>Amount</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <TextInput value={amount} onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad"
              placeholder="0" placeholderTextColor={COLORS.mutedLight} style={{ ...inputStyle, width: 130 }} />
            <Text style={{ marginLeft: 10, fontSize: 16, color: COLORS.muted, fontWeight: '700' }}>₵</Text>
          </View>
          <Text style={{ fontSize: 12, color: COLORS.mutedLight, marginBottom: 12 }}>Your balance: {balance ?? '…'} ₵</Text>

          {/* Message optionnel */}
          <TextInput value={message} onChangeText={setMessage} maxLength={140}
            placeholder="Add a message (optional)" placeholderTextColor={COLORS.mutedLight}
            style={{ ...inputStyle, marginBottom: 12 }} />

          {error ? <Text style={{ color: COLORS.danger, fontSize: 13, fontWeight: '600', marginBottom: 10 }}>{error}</Text> : null}

          <Pressable onPress={send} disabled={!canSend}
            style={{ borderRadius: 999, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, backgroundColor: canSend ? COLORS.jiayou : '#e9ecef' }}>
            {sending ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="gift" size={16} color={canSend ? '#fff' : COLORS.muted} />
                <Text style={{ color: canSend ? '#fff' : COLORS.muted, fontWeight: '700', fontSize: 15 }}>
                  Send{amountValid ? ` ${amountNum} ₵` : ''}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      )}
    </BottomSheet>
  );
}

// ── Réception : drawer sobre (révélé à l'ouverture / au retour au premier plan) ──
export function RedEnvelopeReceivedPopup({ visible, envelopes = [], onClose }) {
  const total = envelopes.reduce((s, e) => s + Number(e.amount || 0), 0);
  const first = envelopes[0];
  const multiple = envelopes.length > 1;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ alignItems: 'center', marginBottom: 6 }}>
        <Text style={{ fontSize: 56 }}>🧧</Text>
        <Text style={{ fontSize: 12, fontWeight: '800', color: GOLD_FG, letterSpacing: 1, textTransform: 'uppercase', marginTop: 12, textAlign: 'center' }}>
          {multiple ? `${envelopes.length} red envelopes` : 'A red envelope'}
        </Text>
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a1a2e', textAlign: 'center', marginTop: 6 }}>
          {multiple
            ? 'Your friends sent you gifts!'
            : `${first?.sender_name || 'A friend'} sent you a red envelope!`}
        </Text>
        {!multiple && first?.message ? (
          <Text style={{ color: COLORS.muted, fontSize: 14, fontStyle: 'italic', textAlign: 'center', marginTop: 8 }}>
            “{first.message}”
          </Text>
        ) : null}

        {/* Récompense (pastille dorée sobre, même langage que le drawer trophée) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: GOLD_BG, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10, marginTop: 18 }}>
          <Ionicons name="add-circle" size={18} color="#d97706" />
          <Text style={{ color: GOLD_FG, fontWeight: '800', fontSize: 18 }}>{total.toLocaleString()} ₵</Text>
        </View>
      </View>

      <Pressable onPress={onClose} style={{ marginTop: 22, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 14, alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Awesome! 🎉</Text>
      </Pressable>
    </BottomSheet>
  );
}
