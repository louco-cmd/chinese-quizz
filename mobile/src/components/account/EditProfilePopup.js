import { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from '../Popup';
import { COLORS } from '../../theme';
import { COUNTRIES } from '../../data/countries';
import { updateAccount } from '../../api';

// Drapeau emoji à partir d'un code pays ISO alpha-2.
export function flagEmoji(code) {
  if (!code || !code.trim()) return '🏳️';
  try {
    return String.fromCodePoint(...code.toUpperCase().split('').map((c) => 127397 + c.charCodeAt(0)));
  } catch {
    return '🏳️';
  }
}

function Label({ children }) {
  return (
    <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
      {children}
    </Text>
  );
}

const inputStyle = {
  backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#e3e8f7', borderRadius: 12,
  paddingVertical: 12, paddingHorizontal: 14, fontSize: 15, color: '#1a1a2e',
};

// Popup d'édition du profil (nom / tagline / pays), basée sur le composant Popup
// standard de l'app. `onSaved({name, tagline, country})` remonte les valeurs.
export default function EditProfilePopup({ visible, initial, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [country, setCountry] = useState(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Réinitialise les champs à chaque ouverture
  useEffect(() => {
    if (visible) {
      setName(initial?.name || '');
      setTagline(initial?.tagline || '');
      setCountry(initial?.country || null);
      setPicking(false);
      setQuery('');
      setError('');
    }
  }, [visible, initial]);

  async function save() {
    if (!name.trim()) return setError('Name is required.');
    setSaving(true);
    setError('');
    try {
      const d = await updateAccount({ name: name.trim(), tagline: tagline.trim(), country });
      onSaved({ name: d.name, tagline: d.tagline, country: d.country });
      onClose();
    } catch (e) {
      setError(e.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  const filtered = query.trim()
    ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
    : COUNTRIES;
  const currentCountry = COUNTRIES.find((c) => c.code === country);

  return (
    <Popup visible={visible} onClose={onClose} maxWidth={420}>
      {/* En-tête */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e' }}>
          {picking ? 'Select your country' : 'Edit personal info'}
        </Text>
        <Pressable onPress={picking ? () => setPicking(false) : onClose} hitSlop={10}>
          <Ionicons name={picking ? 'arrow-back' : 'close'} size={22} color={COLORS.muted} />
        </Pressable>
      </View>

      {picking ? (
        // ── Sélecteur de pays (recherche + liste) ──
        <View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search a country…"
            placeholderTextColor="#adb5bd"
            autoFocus
            style={{ ...inputStyle, marginBottom: 10 }}
          />
          <FlatList
            data={filtered}
            keyExtractor={(c) => c.code}
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 280 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => { setCountry(item.code); setPicking(false); setQuery(''); }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11,
                  borderBottomWidth: 1, borderColor: '#f5f5f5',
                }}
              >
                <Text style={{ fontSize: 20 }}>{flagEmoji(item.code)}</Text>
                <Text style={{ fontSize: 15, color: '#1a1a2e', flex: 1 }}>{item.name}</Text>
                {country === item.code && <Ionicons name="checkmark" size={18} color={COLORS.jiayou} />}
              </Pressable>
            )}
          />
        </View>
      ) : (
        // ── Formulaire ──
        <View>
          <Label>Name</Label>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor="#adb5bd"
            maxLength={50}
            style={{ ...inputStyle, marginBottom: 16 }}
          />

          <Label>Tagline</Label>
          <TextInput
            value={tagline}
            onChangeText={setTagline}
            placeholder="Your learning motto…"
            placeholderTextColor="#adb5bd"
            maxLength={100}
            multiline
            style={{ ...inputStyle, marginBottom: 16, minHeight: 64, textAlignVertical: 'top' }}
          />

          <Label>Country</Label>
          <Pressable
            onPress={() => setPicking(true)}
            style={{ ...inputStyle, marginBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ fontSize: 20 }}>{flagEmoji(country)}</Text>
              <Text style={{ fontSize: 15, color: currentCountry ? '#1a1a2e' : '#adb5bd' }}>
                {currentCountry ? currentCountry.name : 'Select your country'}
              </Text>
            </View>
            <Ionicons name="chevron-down" size={18} color={COLORS.muted} />
          </Pressable>

          {error ? <Text style={{ color: COLORS.danger, fontSize: 13, marginBottom: 10, fontWeight: '600' }}>{error}</Text> : null}

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
              <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={save} disabled={saving} style={{ flex: 1, backgroundColor: COLORS.jiayou, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Save</Text>}
            </Pressable>
          </View>
        </View>
      )}
    </Popup>
  );
}
