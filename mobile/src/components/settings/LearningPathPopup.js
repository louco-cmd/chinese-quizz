import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import Popup from '../Popup';
import SegmentedPicker from './SegmentedPicker';
import { LANG_META, LEARNABLE } from '../../langs';
import { useT } from '../../i18n';
import { COLORS } from '../../theme';
import { createLearningPath, updateLearningPath } from '../../api';

// Popup de création / édition d'un parcours d'apprentissage.
// - create : on choisit la base (langue de l'app) + la langue apprise + un titre.
// - edit   : la langue apprise est VERROUILLÉE (clé de la collection) ; on ne peut
//   changer que la base et le titre.
// `path` (edit) = { id, learning_lang, native_lang, title }.
export default function LearningPathPopup({ visible, mode = 'create', path = null, onClose, onSaved }) {
  const { t, setLang } = useT();
  const isEdit = mode === 'edit';

  const [base, setBase] = useState('en');      // native_lang = langue de l'interface
  const [learn, setLearn] = useState('zh');    // learning_lang
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // (Ré)initialise à l'ouverture selon le mode.
  useEffect(() => {
    if (!visible) return;
    setError(''); setSaving(false);
    if (isEdit && path) {
      setBase(path.native_lang || 'en');
      setLearn(path.learning_lang || 'zh');
      setTitle(path.title || '');
    } else {
      setBase('en'); setLearn('zh'); setTitle('');
    }
  }, [visible, isEdit, path]);

  const endonym = (c) => (LANG_META[c] || {}).endonym || c;
  // La langue apprise ne peut pas égaler la base ; en création on décale.
  const learnOptions = LEARNABLE.filter((c) => c !== base).map((c) => ({ value: c, label: endonym(c) }));
  const baseOptions = LEARNABLE.map((c) => ({ value: c, label: endonym(c) }));

  function onChangeBase(v) {
    setBase(v);
    if (!isEdit && v === learn) setLearn(LEARNABLE.find((c) => c !== v));
  }

  async function onSave() {
    setSaving(true); setError('');
    try {
      if (isEdit) {
        const d = await updateLearningPath(path.id, { title, native_lang: base });
        if (d?.active?.interface_lang) setLang(d.active.interface_lang);
        onSaved?.();
      } else {
        const d = await createLearningPath({ learning_lang: learn, native_lang: base, title });
        if (d?.active?.interface_lang) setLang(d.active.interface_lang);
        onSaved?.(d);
      }
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Error');
      setSaving(false);
    }
  }

  const label = (s) => <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.muted, marginBottom: 8, marginTop: 16 }}>{s}</Text>;

  return (
    <Popup visible={visible} onClose={onClose} maxWidth={440}>
      <Text style={{ fontSize: 19, fontWeight: '800', color: COLORS.ink }}>
        {t(isEdit ? 'lp_edit_title' : 'lp_new_title')}
      </Text>

      {/* Base / langue de l'interface (éditable dans les 2 modes) */}
      {label(t('lp_base_lang'))}
      <SegmentedPicker options={baseOptions} value={base} onChange={onChangeBase} />

      {/* Langue apprise : éditable en création, verrouillée en édition */}
      {label(t('lp_i_learn'))}
      {isEdit ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ borderRadius: 999, paddingVertical: 10, paddingHorizontal: 18, borderWidth: 1.5, borderColor: '#e2e6ea', backgroundColor: '#f2f4f6' }}>
            <Text style={{ fontSize: 13.5, fontWeight: '700', color: COLORS.muted }}>{endonym(learn)} 🔒</Text>
          </View>
        </View>
      ) : (
        <SegmentedPicker options={learnOptions} value={learn} onChange={setLearn} />
      )}
      {isEdit ? (
        <Text style={{ fontSize: 12, color: COLORS.mutedLight, marginTop: 6 }}>{t('lp_base_locked_note')}</Text>
      ) : null}

      {/* Titre custom (optionnel) */}
      {label(t('lp_title_label'))}
      <TextInput
        value={title}
        onChangeText={setTitle}
        maxLength={60}
        placeholder={t('lp_title_ph')}
        placeholderTextColor={COLORS.mutedLight}
        style={{ borderWidth: 1.5, borderColor: '#e2e6ea', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: COLORS.ink }}
      />

      {error ? <Text style={{ color: COLORS.danger, fontWeight: '600', fontSize: 13, marginTop: 12 }}>{error}</Text> : null}

      <Pressable
        onPress={onSave}
        disabled={saving}
        style={{ marginTop: 22, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 14, alignItems: 'center', opacity: saving ? 0.7 : 1 }}
      >
        {saving ? <ActivityIndicator color="#fff" /> : (
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{t(isEdit ? 'lp_save' : 'lp_create')}</Text>
        )}
      </Pressable>
    </Popup>
  );
}
