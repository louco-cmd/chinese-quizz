import { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from '../Popup';
import SegmentedPicker from '../settings/SegmentedPicker';
import { COLORS } from '../../theme';
import { searchDuelPlayers, createDuel, getRecentOpponents } from '../../api';

function Label({ children }) {
  return (
    <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
      {children}
    </Text>
  );
}

// Popup "Start a duel" : recherche d'adversaire + type + nombre de mots + mise.
// `presetOpponent` = { id, name } pour pré-remplir (défi depuis la liste des rivaux).
export default function StartDuelPopup({ visible, presetOpponent, onClose, onCreated }) {
  const [opponent, setOpponent] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [recent, setRecent] = useState([]); // adversaires déjà affrontés
  const [searching, setSearching] = useState(false);
  const [duelType, setDuelType] = useState('classic');
  const [wordCount, setWordCount] = useState('20');
  const [bet, setBet] = useState('0');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const debounce = useRef(null);

  useEffect(() => {
    if (visible) {
      setOpponent(presetOpponent || null);
      setQuery('');
      setResults([]);
      setDuelType('classic');
      setWordCount('20');
      setBet('0');
      setError('');
      // Charge les adversaires précédents (suggestions).
      getRecentOpponents().then((d) => setRecent(d.players || [])).catch(() => setRecent([]));
    }
  }, [visible, presetOpponent]);

  // Recherche débouncée
  useEffect(() => {
    if (!query.trim() || opponent) { setResults([]); return; }
    setSearching(true);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        const d = await searchDuelPlayers(query.trim());
        setResults(d.players || []);
      } catch { setResults([]); } finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(debounce.current);
  }, [query, opponent]);

  async function create() {
    if (!opponent) return setError('Pick an opponent first.');
    setCreating(true);
    setError('');
    try {
      await createDuel({
        opponent_id: opponent.id,
        duel_type: duelType,
        word_count: parseInt(wordCount, 10),
        quiz_type: 'pinyin',
        bet_amount: Math.max(0, parseInt(bet, 10) || 0),
      });
      onCreated?.();
      onClose();
    } catch (e) {
      setError(e.message || 'Could not create the duel.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Popup visible={visible} onClose={onClose} maxWidth={420}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e' }}>
          Challenge {opponent ? opponent.name : 'a player'}
        </Text>
        <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={COLORS.muted} /></Pressable>
      </View>

      {/* Adversaire */}
      <Label>Opponent</Label>
      {opponent ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#e8f0ff', borderRadius: 12, padding: 12, marginBottom: 16 }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.jiayou, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>{opponent.name.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={{ flex: 1, fontWeight: '600', color: '#1a1a2e' }}>{opponent.name}</Text>
          <Pressable onPress={() => setOpponent(null)} hitSlop={8}><Ionicons name="close-circle" size={20} color={COLORS.muted} /></Pressable>
        </View>
      ) : (
        <View style={{ marginBottom: 16 }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search a player…"
            placeholderTextColor="#adb5bd"
            autoCapitalize="none"
            style={{ backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#e3e8f7', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, fontSize: 15, color: '#1a1a2e' }}
          />
          {searching ? <ActivityIndicator style={{ marginTop: 8 }} color={COLORS.jiayou} /> : null}
          {results.map((p, i) => (
            <Pressable
              key={p.id}
              onPress={() => { setOpponent(p); setResults([]); setQuery(''); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: i === results.length - 1 ? 0 : 1, borderColor: '#f5f5f5' }}
            >
              <Ionicons name="person-circle-outline" size={26} color={COLORS.muted} />
              <Text style={{ fontSize: 15, color: '#1a1a2e' }}>{p.name}</Text>
            </Pressable>
          ))}

          {/* Suggestions : adversaires précédents en cellules scrollables (horizontal) */}
          {!query.trim() && !searching && recent.length > 0 ? (
            <View style={{ marginTop: 10 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Recent opponents
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingRight: 4 }}
              >
                {recent.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => { setOpponent(p); setResults([]); setQuery(''); }}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 7,
                      backgroundColor: '#f0f5ff',
                      borderWidth: 1, borderColor: '#dbe4f7', borderRadius: 999,
                      paddingVertical: 7, paddingHorizontal: 12,
                    }}
                  >
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: COLORS.jiayou, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 11 }}>{(p.name || '?').charAt(0).toUpperCase()}</Text>
                    </View>
                    <Text style={{ fontSize: 14, color: '#1a1a2e', fontWeight: '500' }} numberOfLines={1}>{p.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      )}

      {/* Type de duel */}
      <Label>Duel type</Label>
      <View style={{ marginBottom: 16 }}>
        <SegmentedPicker
          value={duelType}
          onChange={setDuelType}
          options={[{ value: 'classic', label: '🎲 Random' }, { value: 'match_aa', label: '🤝 AA' }]}
        />
      </View>

      {/* Nombre de mots */}
      <Label>Word count</Label>
      <View style={{ marginBottom: 16 }}>
        <SegmentedPicker
          value={wordCount}
          onChange={setWordCount}
          options={[{ value: '10', label: '10' }, { value: '20', label: '20' }, { value: '30', label: '30' }]}
        />
      </View>

      {/* Mise */}
      <Label>Bet (coins)</Label>
      <TextInput
        value={bet}
        onChangeText={(v) => setBet(v.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor="#adb5bd"
        style={{ backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#e3e8f7', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, fontSize: 15, color: '#1a1a2e', marginBottom: 16 }}
      />

      {error ? <Text style={{ color: COLORS.danger, fontSize: 13, marginBottom: 12, fontWeight: '600' }}>{error}</Text> : null}

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
          <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Cancel</Text>
        </Pressable>
        <Pressable onPress={create} disabled={creating} style={{ flex: 1, backgroundColor: COLORS.jiayou, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
          {creating ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Create duel</Text>}
        </Pressable>
      </View>
    </Popup>
  );
}
