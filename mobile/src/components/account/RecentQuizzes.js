import { View, Text } from 'react-native';
import { useT } from '../../i18n';

// Couleurs par type de quiz réellement enregistré (pinyin/character/reading pour
// le chinois, word=écriture pour les autres langues). Alignées sur les anneaux
// de connaissance de la page compte.
const TYPE_COLOR = { pinyin: '#0d6efd', character: '#6f42c1', reading: '#20c997', word: '#fd7e14' };

// Liste des derniers quiz : pastille type + score + coins à gauche, date à droite.
export default function RecentQuizzes({ quizzes }) {
  const { t } = useT();
  const typeLabel = (type) => (type === 'pinyin' ? t('qz_pinyin')
    : type === 'character' ? t('qz_characters')
      : type === 'reading' ? t('qz_reading')
        : type === 'word' ? t('qz_mode_write') : t('ac_quiz'));
  if (!quizzes || !quizzes.length) {
    return <Text style={{ color: '#adb5bd', textAlign: 'center', fontSize: 13, paddingVertical: 8 }}>{t('ac_no_quizzes')}</Text>;
  }
  return (
    <View>
      {quizzes.map((q, i) => {
        const coins = q.coins; // vrai montant serveur ; null pour les quiz d'avant le suivi
        const date = new Date(q.date);
        const dateStr = isNaN(date) ? '' : date.toLocaleDateString('fr-FR');
        return (
          <View
            key={i}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingVertical: 9,
              borderBottomWidth: i === quizzes.length - 1 ? 0 : 1, borderColor: '#f5f5f5',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: TYPE_COLOR[q.type] || '#6c757d' }}>
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{typeLabel(q.type)}</Text>
              </View>
              <Text style={{ fontWeight: '600', fontSize: 14, color: '#1a1a2e' }}>{q.score}/{q.total}</Text>
              <Text style={{ fontSize: 13, color: '#f0a500', fontWeight: '500' }}>
                {coins == null ? '—' : coins > 0 ? `+${coins} ${t('ac_coins')}` : `0 ${t('ac_coins')}`}
              </Text>
            </View>
            <Text style={{ fontSize: 12, color: '#bbb' }}>{dateStr}</Text>
          </View>
        );
      })}
    </View>
  );
}
