import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MarkdownText from './MarkdownText';
import { COLORS } from '../theme';

// Champ texte « enrichi » markdown-light : gras **, italique *, souligné __,
// titre ## , liste « - ». Barre de format ÉPANDABLE + bascule Aperçu. Pas de
// dépendance native → OTA-safe, fonctionne natif + web.
//
// État texte INTERNE (synchro remontée via onChange) pour éviter la course
// classique « valeur contrôlée + sélection contrôlée » qui fait sauter le curseur.
export default function RichTextArea({ value, onChange, placeholder, placeholderTextColor, minHeight = 150, maxLength = 4000 }) {
  const [text, setText] = useState(value || '');
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState(false);
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);

  // Synchro descendante (ex. préremplissage IA) quand on ne tape pas.
  useEffect(() => {
    if (!focused && value != null && value !== text) setText(value);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const push = (next, nextSel) => {
    setText(next);
    onChange?.(next);
    if (nextSel) setSel(nextSel);
  };

  // Entoure la sélection (ou le curseur) de marqueurs.
  const wrap = (mark) => {
    const { start, end } = sel;
    const inner = text.slice(start, end);
    const next = text.slice(0, start) + mark + inner + mark + text.slice(end);
    const caret = start + mark.length + inner.length + (inner ? mark.length : 0);
    push(next, { start: inner ? start + mark.length : caret, end: inner ? end + mark.length : caret });
  };

  // Préfixe la/les ligne(s) de la sélection (titre, puce).
  const linePrefix = (prefix) => {
    const { start } = sel;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const next = text.slice(0, lineStart) + prefix + text.slice(lineStart);
    const caret = sel.end + prefix.length;
    push(next, { start: caret, end: caret });
  };

  const Btn = ({ icon, label, onPress, active }) => (
    <Pressable onPress={onPress} hitSlop={6}
      style={{ minWidth: 34, height: 32, paddingHorizontal: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? COLORS.jiayouSoft : 'transparent' }}>
      {icon ? <Ionicons name={icon} size={17} color={COLORS.muted} /> : <Text style={{ fontWeight: '800', fontSize: 15, color: COLORS.muted }}>{label}</Text>}
    </Pressable>
  );

  return (
    <View style={{ borderWidth: 1, borderColor: focused ? COLORS.jiayou : '#e0e0e0', borderRadius: 12, backgroundColor: '#fff', overflow: 'hidden' }}>
      {/* Barre d'outils */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 4, borderBottomWidth: 1, borderColor: '#f0f0f0', backgroundColor: '#fafbfc' }}>
        <Btn label="B" onPress={() => wrap('**')} />
        <Btn icon="text" label="I" onPress={() => wrap('*')} />
        <Btn label="U" onPress={() => wrap('__')} />
        {expanded ? (
          <>
            <View style={{ width: 1, height: 18, backgroundColor: '#e6e8eb', marginHorizontal: 4 }} />
            <Btn label="H" onPress={() => linePrefix('## ')} />
            <Btn icon="list" onPress={() => linePrefix('- ')} />
          </>
        ) : null}
        <View style={{ flex: 1 }} />
        <Btn icon={expanded ? 'chevron-up' : 'ellipsis-horizontal'} onPress={() => setExpanded((e) => !e)} />
        <Pressable onPress={() => setPreview((p) => !p)} hitSlop={6}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 8, borderRadius: 8, backgroundColor: preview ? COLORS.jiayouSoft : 'transparent' }}>
          <Ionicons name={preview ? 'create-outline' : 'eye-outline'} size={16} color={preview ? COLORS.jiayou : COLORS.muted} />
          <Text style={{ fontSize: 12.5, fontWeight: '700', color: preview ? COLORS.jiayou : COLORS.muted }}>{preview ? 'Edit' : 'Preview'}</Text>
        </Pressable>
      </View>

      {/* Zone */}
      {preview ? (
        <View style={{ minHeight, padding: 14 }}>
          {text.trim() ? <MarkdownText value={text} /> : <Text style={{ color: COLORS.mutedLight, fontSize: 14.5 }}>Nothing to preview yet.</Text>}
        </View>
      ) : (
        <TextInput
          ref={ref}
          value={text}
          onChangeText={(t) => push(t)}
          selection={sel}
          onSelectionChange={(e) => setSel(e.nativeEvent.selection)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          multiline
          maxLength={maxLength}
          placeholder={placeholder}
          placeholderTextColor={placeholderTextColor || COLORS.mutedLight}
          textAlignVertical="top"
          style={{ minHeight, padding: 14, fontSize: 14.5, lineHeight: 21, color: '#1a1a2e' }}
        />
      )}
    </View>
  );
}
