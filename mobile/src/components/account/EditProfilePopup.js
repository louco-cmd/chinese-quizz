import { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from '../Popup';
import { COLORS } from '../../theme';
import { useT } from '../../i18n';
import { COUNTRIES } from '../../data/countries';
import { updateAccount } from '../../api';
import Avatar, { AVATAR_ICONS, AVATAR_COLORS } from '../Avatar';

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
  const { t } = useT();
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [country, setCountry] = useState(null);
  const [avatarIcon, setAvatarIcon] = useState(null);
  const [avatarColor, setAvatarColor] = useState(null);
  const [openField, setOpenField] = useState(null); // 'icon' | 'color' | null
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
      setAvatarIcon(initial?.avatar_icon || null);
      setAvatarColor(initial?.avatar_color || null);
      setOpenField(null);
      setPicking(false);
      setQuery('');
      setError('');
    }
  }, [visible, initial]);

  // Choisir un picto : par défaut on lui donne la 1re couleur si aucune choisie ;
  // re-cliquer le picto sélectionné le retire (repli sur l'initiale).
  function pickIcon(ic) {
    if (avatarIcon === ic) { setAvatarIcon(null); return; }
    setAvatarIcon(ic);
    if (!avatarColor) setAvatarColor(AVATAR_COLORS[0]);
  }

  async function save() {
    if (!name.trim()) return setError(t('ep_name_required'));
    setSaving(true);
    setError('');
    try {
      const d = await updateAccount({ name: name.trim(), tagline: tagline.trim(), country, avatar_icon: avatarIcon, avatar_color: avatarColor });
      onSaved({ name: d.name, tagline: d.tagline, country: d.country, avatar_icon: d.avatar_icon, avatar_color: d.avatar_color });
      onClose();
    } catch (e) {
      setError(e.message || t('ep_could_not_save'));
    } finally {
      setSaving(false);
    }
  }

  const filtered = query.trim()
    ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
    : COUNTRIES;
  const currentCountry = COUNTRIES.find((c) => c.code === country);

  return (
    <Popup visible={visible} onClose={onClose} maxWidth={420} scroll={false}>
      {/* En-tête */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e' }}>
          {picking ? t('ep_select_country') : t('ep_edit_info')}
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
            placeholder={t('ep_search_country')}
            placeholderTextColor="#adb5bd"
            autoFocus
            style={{ ...inputStyle, marginBottom: 10 }}
          />
          {/* ScrollView + map (pas FlatList) : une VirtualizedList dans un Modal
              se mesure mal sur web → liste non scrollable/cliquable. */}
          <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {filtered.map((item) => (
              <Pressable
                key={item.code}
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
            ))}
          </ScrollView>
        </View>
      ) : (
        // ── Formulaire ── (pas de scroll : la popup grandit avec son contenu)
        <View>
          {/* Avatar : aperçu + deux menus déroulants (picto / couleur) */}
          <Label>{t('ep_avatar')}</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10 }}>
            <Avatar icon={avatarIcon} color={avatarColor} name={name} size={56} />
            <View style={{ flex: 1, gap: 8 }}>
              {/* Menu picto */}
              <Pressable
                onPress={() => setOpenField((f) => (f === 'icon' ? null : 'icon'))}
                style={{ ...inputStyle, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name={avatarIcon || 'happy-outline'} size={18} color={avatarIcon ? '#1a1a2e' : '#adb5bd'} />
                  <Text style={{ fontSize: 14, color: avatarIcon ? '#1a1a2e' : '#adb5bd' }}>{avatarIcon ? t('ep_icon') : t('ep_pick_icon')}</Text>
                </View>
                <Ionicons name={openField === 'icon' ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.muted} />
              </Pressable>
              {/* Menu couleur */}
              <Pressable
                onPress={() => setOpenField((f) => (f === 'color' ? null : 'color'))}
                style={{ ...inputStyle, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: avatarColor || '#e3e8f7' }} />
                  <Text style={{ fontSize: 14, color: avatarColor ? '#1a1a2e' : '#adb5bd' }}>{avatarColor ? t('ep_background') : t('ep_pick_color')}</Text>
                </View>
                <Ionicons name={openField === 'color' ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.muted} />
              </Pressable>
            </View>
          </View>

          {/* Panneau déroulé : grille de pictos */}
          {openField === 'icon' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, backgroundColor: '#f8f9fa', borderRadius: 12, padding: 10, marginBottom: 16 }}>
              {AVATAR_ICONS.map((ic) => {
                const on = avatarIcon === ic;
                return (
                  <Pressable
                    key={ic}
                    onPress={() => pickIcon(ic)}
                    style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? COLORS.jiayou : '#fff' }}
                  >
                    <Ionicons name={ic} size={20} color={on ? '#fff' : COLORS.muted} />
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {/* Panneau déroulé : palette de couleurs */}
          {openField === 'color' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, backgroundColor: '#f8f9fa', borderRadius: 12, padding: 12, marginBottom: 16 }}>
              {AVATAR_COLORS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => { setAvatarColor(c); if (!avatarIcon) setAvatarIcon(AVATAR_ICONS[0]); }}
                  style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c, borderWidth: avatarColor === c ? 3 : 0, borderColor: '#1a1a2e' }}
                />
              ))}
            </View>
          ) : null}

          {!openField ? <View style={{ marginBottom: 6 }} /> : null}

          <Label>{t('ep_name')}</Label>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t('ep_your_name')}
            placeholderTextColor="#adb5bd"
            maxLength={50}
            style={{ ...inputStyle, marginBottom: 16 }}
          />

          <Label>{t('ep_tagline')}</Label>
          <TextInput
            value={tagline}
            onChangeText={setTagline}
            placeholder={t('ep_your_motto')}
            placeholderTextColor="#adb5bd"
            maxLength={100}
            multiline
            style={{ ...inputStyle, marginBottom: 16, minHeight: 64, textAlignVertical: 'top' }}
          />

          <Label>{t('ep_country')}</Label>
          <Pressable
            onPress={() => setPicking(true)}
            style={{ ...inputStyle, marginBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ fontSize: 20 }}>{flagEmoji(country)}</Text>
              <Text style={{ fontSize: 15, color: currentCountry ? '#1a1a2e' : '#adb5bd' }}>
                {currentCountry ? currentCountry.name : t('ep_select_country')}
              </Text>
            </View>
            <Ionicons name="chevron-down" size={18} color={COLORS.muted} />
          </Pressable>

          {error ? <Text style={{ color: COLORS.danger, fontSize: 13, marginBottom: 10, fontWeight: '600' }}>{error}</Text> : null}

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
              <Text style={{ color: COLORS.muted, fontWeight: '700' }}>{t('common_cancel')}</Text>
            </Pressable>
            <Pressable onPress={save} disabled={saving} style={{ flex: 1, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>{t('common_save')}</Text>}
            </Pressable>
          </View>
        </View>
      )}
    </Popup>
  );
}
