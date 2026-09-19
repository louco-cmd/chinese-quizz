import { useState, useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from './Popup';
import { captureWord } from '../api';
import { useT } from '../i18n';
import { COLORS } from '../theme';

// Popup léger de capture d'UN mot rencontré (ex. depuis l'écran de résultat d'un
// duel aléatoire). Même esprit que la carte de résultat de la recherche home :
// mot + pinyin + traduction, puis bouton Capturer (ou « déjà dans ta collection »).
// `word` : { id, meaning_id, chinese, pinyin, english, hsk, owned } | null → masqué.
export default function WordCapturePopup({ word, isZh = true, onClose, onCaptured, onBalanceChanged }) {
  const { t } = useT();
  const [capturing, setCapturing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (word) { setCapturing(false); setDone(false); setError(''); } }, [word]);
  if (!word) return null;
  const owned = word.owned || done;

  async function capture() {
    setCapturing(true); setError('');
    try {
      await captureWord(word.id, word.meaning_id);
      setDone(true);
      onCaptured?.(word);
      onBalanceChanged?.();
    } catch (e) {
      // Solde insuffisant → la popup « gagner des pièces » est gérée globalement.
      if (e?.status === 402 || e?.data?.insufficient) { onClose?.(); return; }
      setError(e.message || t('wc_error'));
    } finally {
      setCapturing(false);
    }
  }

  return (
    <Popup visible={!!word} onClose={onClose} maxWidth={340}>
      <View style={{ alignItems: 'center', paddingVertical: 6 }}>
        <Text style={{ fontSize: isZh ? 44 : 28, fontWeight: '800', color: COLORS.jiayou, textAlign: 'center' }}>{word.chinese}</Text>
        {isZh && word.pinyin ? <Text style={{ color: '#6c757d', fontSize: 16, marginTop: 8 }}>{word.pinyin}</Text> : null}
        {word.english ? <Text style={{ color: '#1a1a2e', fontWeight: '700', fontSize: 16, marginTop: 6, textAlign: 'center' }}>{word.english}</Text> : null}
        {word.hsk ? (
          <View style={{ backgroundColor: '#e8f0fe', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginTop: 10 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.jiayou }}>HSK {word.hsk}</Text>
          </View>
        ) : null}
      </View>

      {error ? <Text style={{ color: COLORS.danger, fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 8 }}>{error}</Text> : null}

      <View style={{ marginTop: 16 }}>
        {owned ? (
          <View style={{ backgroundColor: '#d4edda', borderRadius: 999, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Ionicons name="checkmark-circle" size={18} color="#198754" />
            <Text style={{ color: '#198754', fontWeight: '800' }}>{t('wc_in_collection')}</Text>
          </View>
        ) : (
          <Pressable onPress={capture} disabled={capturing}
            style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: capturing ? 0.7 : 1 }}>
            {capturing ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="add-circle" size={18} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{t('wc_capture')}</Text>
              </>
            )}
          </Pressable>
        )}
      </View>
    </Popup>
  );
}
