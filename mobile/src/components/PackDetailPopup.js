import { useState, useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from './Popup';
import { getMarketPack, buyMarketPack } from '../api';
import { COLORS } from '../theme';

// Illustration fictive : fond bleu pâle + idéogramme du niveau HSK.
const HSK_GLYPH = { hsk1: '一', hsk2: '二', hsk3: '三', hsk4: '四', hsk5: '五', hsk6: '六' };
export const glyphOf = (k) => HSK_GLYPH[k] || '汉';
export const COVER_BG = '#e8f0ff';
export const COVER_FG = '#5b8def';

// Ligne d'un mot (chinois · anglais · pinyin).
export function WordRow({ w, last }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5, borderBottomWidth: last ? 0 : 1, borderColor: '#eceef1' }}>
      <Text style={{ fontSize: 18, fontWeight: '700', color: '#1a1a2e', minWidth: 42 }}>{w.chinese}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, color: '#1a1a2e' }} numberOfLines={1}>{w.english}</Text>
        <Text style={{ fontSize: 11.5, color: COLORS.muted }}>{w.pinyin}</Text>
      </View>
    </View>
  );
}

// Popup de détail d'un pack — modèle unique (store + packs achetés) : cover,
// titre, créateur + stats, description, liste de mots (complète si possédé,
// aperçu de 3 sinon), et action (acheter / démarrer un quiz).
//   pack        : résumé du pack sélectionné (id, title, cover_key, price…) ou null → masqué
//   balance     : solde de l'utilisateur (pour le bouton d'achat)
//   onStartQuiz : (pack) => void — affiche "Start a quiz" si possédé
//   onBought    : (packId, { newBalance, wordsAdded }) => void — après achat
export default function PackDetailPopup({ pack, balance, onClose, onStartQuiz, onBought }) {
  const [detail, setDetail] = useState(null); // { pack, words?, preview? }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [buying, setBuying] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!pack) return;
    let alive = true;
    setLoading(true); setDetail(null); setError(''); setMsg('');
    getMarketPack(pack.id)
      .then((d) => { if (alive) setDetail(d); })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [pack]);

  const p = detail?.pack || pack || {};
  const words = detail?.words;
  const preview = detail?.preview;
  const owned = !!(p.owned || p.isMine);
  const canBuy = !owned && (p.word_count || 0) > 0 && balance != null && balance >= p.price;

  async function buy() {
    setBuying(true); setError('');
    try {
      const d = await buyMarketPack(pack.id);
      setMsg(`Added to your collection — ${d.wordsAdded} new word${d.wordsAdded === 1 ? '' : 's'}!`);
      try { setDetail(await getMarketPack(pack.id)); } catch { /* noop */ }
      onBought?.(pack.id, d);
    } catch (e) { setError(e.message); } finally { setBuying(false); }
  }

  return (
    <Popup visible={!!pack} onClose={onClose} maxWidth={420}>
      {loading && !detail ? (
        <ActivityIndicator color={COLORS.jiayou} style={{ marginVertical: 30 }} />
      ) : (
        <View>
          <View style={{ height: 84, borderRadius: 14, backgroundColor: COVER_BG, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <Text style={{ fontSize: 40, fontWeight: '700', color: COVER_FG }}>{glyphOf(p.cover_key)}</Text>
          </View>
          <Text style={{ fontSize: 19, fontWeight: '800', color: '#1a1a2e' }}>{p.title}</Text>
          <Text style={{ fontSize: 13, color: COLORS.muted, marginTop: 2 }}>
            by {p.creator || '—'} · {p.word_count || 0} words · {p.sales_count || 0} bought
          </Text>
          {p.description ? (
            <Text style={{ fontSize: 13.5, color: '#444', marginTop: 10, lineHeight: 19 }}>{p.description}</Text>
          ) : null}

          {words?.length ? (
            <View style={{ marginTop: 14, backgroundColor: '#f8f9fa', borderRadius: 12, padding: 10 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.mutedLight, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Words · {words.length}</Text>
              <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled>
                {words.map((w, i) => <WordRow key={w.id} w={w} last={i === words.length - 1} />)}
              </ScrollView>
            </View>
          ) : preview?.length ? (
            <View style={{ marginTop: 14, backgroundColor: '#f8f9fa', borderRadius: 12, padding: 10 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.mutedLight, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Preview</Text>
              {preview.map((w, i) => <WordRow key={w.id} w={w} last={i === preview.length - 1} />)}
              {p.word_count > preview.length ? (
                <Text style={{ fontSize: 11.5, color: COLORS.mutedLight, marginTop: 6 }}>+ {p.word_count - preview.length} more…</Text>
              ) : null}
            </View>
          ) : null}

          {msg ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#e8f5e9', borderRadius: 12, padding: 12, marginTop: 14 }}>
              <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
              <Text style={{ flex: 1, fontSize: 13.5, color: '#1b5e20', fontWeight: '600' }}>{msg}</Text>
            </View>
          ) : null}
          {error ? <Text style={{ color: COLORS.danger, fontSize: 13, fontWeight: '600', marginTop: 12 }}>{error}</Text> : null}

          {/* ── Actions ── */}
          {owned ? (
            <View style={{ marginTop: 16, gap: 10 }}>
              {onStartQuiz ? (
                <Pressable
                  onPress={() => onStartQuiz(p)}
                  style={{ backgroundColor: COLORS.jiayou, borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                >
                  <Ionicons name="play" size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Start a quiz</Text>
                </Pressable>
              ) : null}
              <Text style={{ textAlign: 'center', color: COLORS.muted, fontWeight: '700', fontSize: 13 }}>
                {p.isMine ? 'Your pack' : '✓ In your collection'}
              </Text>
            </View>
          ) : (p.word_count || 0) === 0 ? (
            <View style={{ marginTop: 16, backgroundColor: '#e9ecef', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
              <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Coming soon</Text>
            </View>
          ) : (
            <Pressable
              onPress={buy}
              disabled={buying || !canBuy}
              style={{ marginTop: 16, borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, backgroundColor: canBuy ? COLORS.jiayou : '#e9ecef' }}
            >
              {buying ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Ionicons name="cart" size={16} color={canBuy ? '#fff' : COLORS.muted} />
                  <Text style={{ color: canBuy ? '#fff' : COLORS.muted, fontWeight: '700', fontSize: 15 }}>
                    {canBuy ? `Buy for ${p.price} ₵` : 'Not enough coins'}
                  </Text>
                </>
              )}
            </Pressable>
          )}
        </View>
      )}
    </Popup>
  );
}
