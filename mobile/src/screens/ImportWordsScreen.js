import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, ActivityIndicator, FlatList, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { importPreview, importCommit } from '../api';
import { COLORS, SHADOW_CARD } from '../theme';

const STATUS = {
  new: { label: 'New', color: COLORS.jiayou, bg: '#e8f0ff' },
  known: { label: 'In dictionary', color: COLORS.success, bg: '#e8f5e9' },
  needs_translation: { label: 'Add translation', color: '#b8860b', bg: '#fff3cd' },
  owned: { label: 'In collection', color: COLORS.muted, bg: '#eceef1' },
};

const PLACEHOLDER = `你好, hello
谢谢, thank you
再见
学习, xué xí, to study`;

export default function ImportWordsScreen({ onBack, onDone }) {
  const [step, setStep] = useState('paste'); // paste | preview | done
  const [text, setText] = useState('');
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [direction, setDirection] = useState('en→zh');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const learningChinese = direction !== 'zh→en';
  // Le champ « traduction » (éditable) dépend de la langue apprise.
  const transKey = learningChinese ? 'english' : 'chinese';

  async function runPreview() {
    setBusy(true); setError('');
    try {
      const d = await importPreview(text);
      if (!d.rows.length) {
        setError((d.direction || 'en→zh') !== 'zh→en'
          ? 'No Chinese words found in your text.'
          : 'No words found. Put one entry per line.');
        setBusy(false); return;
      }
      setDirection(d.direction || 'en→zh');
      setRows(d.rows);
      setStats(d.stats);
      setStep('preview');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const importable = rows.filter((r) => r.status !== 'owned' && (r[transKey] || '').trim());

  async function runCommit() {
    setBusy(true); setError('');
    try {
      const d = await importCommit(importable.map((r) => ({ chinese: r.chinese, pinyin: r.pinyin, english: r.english })));
      setResult(d);
      setStep('done');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  function updateRow(i, patch) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function deleteRow(i) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }

  const Hero = (
    <View style={{ paddingTop: 14, paddingHorizontal: 16, paddingBottom: 6 }}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
          <Ionicons name="chevron-back" size={20} color={COLORS.jiayou} />
          <Text style={{ color: COLORS.jiayou, fontWeight: '600' }}>Back</Text>
        </Pressable>
      ) : null}
      <Text style={{ color: '#1a1a2e', fontSize: 22, fontWeight: '800' }}>Import words</Text>
    </View>
  );

  // ── Étape 1 : coller ──
  if (step === 'paste') {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
        {Hero}
        <ScrollView contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          <View style={{ backgroundColor: '#eef4ff', borderRadius: 12, padding: 12, marginBottom: 14, flexDirection: 'row', gap: 8 }}>
            <Ionicons name="information-circle" size={18} color={COLORS.jiayou} />
            <Text style={{ flex: 1, fontSize: 12.5, color: '#33415c', lineHeight: 18 }}>
              One entry per line. Just the Chinese, or <Text style={{ fontWeight: '700' }}>Chinese, English</Text>, or{' '}
              <Text style={{ fontWeight: '700' }}>Chinese, pinyin, English</Text>. Commas, tabs or semicolons all work.
              Pinyin is auto-filled; you'll review everything before importing.
            </Text>
          </View>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={PLACEHOLDER}
            placeholderTextColor={COLORS.mutedLight}
            multiline
            autoCapitalize="none"
            style={{
              minHeight: 220, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.line,
              padding: 14, fontSize: 15, lineHeight: 22, textAlignVertical: 'top',
            }}
          />
          {error ? <Text style={{ color: COLORS.danger, fontSize: 13, marginTop: 10, fontWeight: '600' }}>{error}</Text> : null}
          <Pressable
            onPress={runPreview}
            disabled={busy || !text.trim()}
            style={{ marginTop: 16, borderRadius: 14, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, backgroundColor: text.trim() ? COLORS.jiayou : '#e9ecef' }}
          >
            {busy ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="eye" size={17} color={text.trim() ? '#fff' : COLORS.muted} />
                <Text style={{ color: text.trim() ? '#fff' : COLORS.muted, fontWeight: '700', fontSize: 15 }}>Preview</Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── Étape 3 : résultat ──
  if (step === 'done') {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8f9fa', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Ionicons name="checkmark-circle" size={56} color={COLORS.success} />
        <Text style={{ fontSize: 20, fontWeight: '800', color: '#1a1a2e', marginTop: 12 }}>
          {result?.added || 0} word{result?.added === 1 ? '' : 's'} imported
        </Text>
        {result?.skippedOwned ? (
          <Text style={{ fontSize: 13.5, color: COLORS.muted, marginTop: 6, textAlign: 'center' }}>
            {result.skippedOwned} already in your collection were skipped.
          </Text>
        ) : null}
        {result?.limitReached ? (
          <Text style={{ fontSize: 13.5, color: '#b8860b', marginTop: 6, textAlign: 'center', fontWeight: '600' }}>
            You reached the free limit ({result.maxWords} words). Go Premium for unlimited.
          </Text>
        ) : null}
        <Pressable onPress={() => (onDone || onBack)?.()}
          style={{ marginTop: 24, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 40, backgroundColor: COLORS.jiayou }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Done</Text>
        </Pressable>
      </View>
    );
  }

  // ── Étape 2 : preview éditable ──
  const StatsBar = (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
        <Text style={{ fontSize: 13, color: COLORS.muted }}>
          <Text style={{ fontWeight: '800', color: '#1a1a2e' }}>{stats?.total || 0}</Text> found ·{' '}
          <Text style={{ fontWeight: '700', color: COLORS.success }}>{stats?.known || 0}</Text> recognized ·{' '}
          <Text style={{ fontWeight: '700', color: '#b8860b' }}>{stats?.needsTranslation || 0}</Text> to translate ·{' '}
          <Text style={{ fontWeight: '700', color: COLORS.muted }}>{stats?.owned || 0}</Text> already owned
        </Text>
      </View>
      <Text style={{ fontSize: 12, color: COLORS.mutedLight }}>
        Fill missing translations, delete lines you don't want. Rows without a translation are skipped.
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      {Hero}
      <FlatList
        data={rows}
        keyExtractor={(r, i) => `${r.chinese}-${i}`}
        contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: 100 }}
        ListHeaderComponent={StatsBar}
        renderItem={({ item, index }) => {
          const st = STATUS[item.status] || STATUS.new;
          const owned = item.status === 'owned';
          const keyText = learningChinese ? item.chinese : item.english;   // le mot appris
          const transVal = item[transKey] || '';                          // la traduction
          // Éditable seulement pour les mots CRÉÉS (new / à traduire) : pour un mot
          // connu (known) ou déjà à toi (owned), la traduction du dico est gardée
          // telle quelle — pas d'écrasement, donc champ en lecture seule.
          const editable = item.status === 'new' || item.status === 'needs_translation';
          const missing = item.status === 'needs_translation';
          return (
            <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10, opacity: owned ? 0.6 : 1, ...SHADOW_CARD }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ minWidth: 54 }}>
                  <Text style={{ fontSize: 20, fontWeight: '700', color: '#1a1a2e' }}>{keyText}</Text>
                  {learningChinese && item.pinyin ? <Text style={{ fontSize: 11.5, color: COLORS.muted }}>{item.pinyin}</Text> : null}
                </View>
                <View style={{ flex: 1 }}>
                  {editable ? (
                    <TextInput
                      value={transVal}
                      onChangeText={(t) => updateRow(index, {
                        [transKey]: t,
                        status: t.trim() ? 'new' : 'needs_translation',
                      })}
                      placeholder={learningChinese ? 'English…' : '中文…'}
                      placeholderTextColor={COLORS.mutedLight}
                      style={{
                        borderWidth: 1, borderColor: missing ? '#f0c36d' : COLORS.line,
                        borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 14, backgroundColor: '#fff',
                      }}
                    />
                  ) : (
                    <Text numberOfLines={2} style={{ fontSize: 14, color: COLORS.muted, paddingVertical: 4 }}>{transVal}</Text>
                  )}
                </View>
                <View style={{ backgroundColor: st.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: st.color }}>{st.label}</Text>
                </View>
                {/* Supprimer la ligne */}
                <Pressable onPress={() => deleteRow(index)} hitSlop={6}>
                  <Ionicons name="trash-outline" size={19} color={COLORS.mutedLight} />
                </Pressable>
              </View>
            </View>
          );
        }}
      />

      {/* Barre d'action fixe : bouton Importer centré + lien Edit à gauche */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: COLORS.line, paddingVertical: 12, justifyContent: 'center', alignItems: 'center' }}>
        <Pressable onPress={() => setStep('paste')} hitSlop={8} style={{ position: 'absolute', left: 16, top: 0, bottom: 0, justifyContent: 'center' }}>
          <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Edit</Text>
        </Pressable>
        <Pressable
          onPress={runCommit}
          disabled={busy || !importable.length}
          style={{ borderRadius: 10, paddingVertical: 11, paddingHorizontal: 28, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 7, backgroundColor: importable.length ? COLORS.jiayou : '#e9ecef' }}
        >
          {busy ? <ActivityIndicator color="#fff" size="small" /> : (
            <>
              <Ionicons name="download" size={15} color={importable.length ? '#fff' : COLORS.muted} />
              <Text style={{ color: importable.length ? '#fff' : COLORS.muted, fontWeight: '700', fontSize: 14 }}>
                Import {importable.length} word{importable.length === 1 ? '' : 's'}
              </Text>
            </>
          )}
        </Pressable>
      </View>
      {error ? (
        <Text style={{ position: 'absolute', bottom: 70, alignSelf: 'center', color: COLORS.danger, fontSize: 13, fontWeight: '600' }}>{error}</Text>
      ) : null}
    </View>
  );
}
