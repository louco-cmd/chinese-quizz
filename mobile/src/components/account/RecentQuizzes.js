import { View, Text } from 'react-native';

// Coins gagnés selon le % de réussite (mêmes paliers que calcCoins EJS).
function calcCoins(pct) {
  if (pct >= 71) return 5;
  if (pct >= 51) return 3;
  if (pct >= 1) return 2;
  return 0;
}

const TYPE_COLOR = { pinyin: '#0d6efd', character: '#ffc107', mixed: '#198754' };

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Quiz';
}

// Liste des derniers quiz : pastille type + score + coins à gauche, date à droite.
export default function RecentQuizzes({ quizzes }) {
  if (!quizzes || !quizzes.length) {
    return <Text style={{ color: '#adb5bd', textAlign: 'center', fontSize: 13, paddingVertical: 8 }}>No quizzes yet</Text>;
  }
  return (
    <View>
      {quizzes.map((q, i) => {
        const pct = q.total > 0 ? (q.score / q.total) * 100 : 0;
        const coins = calcCoins(pct);
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
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{cap(q.type)}</Text>
              </View>
              <Text style={{ fontWeight: '600', fontSize: 14, color: '#1a1a2e' }}>{q.score}/{q.total}</Text>
              <Text style={{ fontSize: 13, color: '#f0a500', fontWeight: '500' }}>
                {coins > 0 ? `+${coins} coins` : '0 coins'}
              </Text>
            </View>
            <Text style={{ fontSize: 12, color: '#bbb' }}>{dateStr}</Text>
          </View>
        );
      })}
    </View>
  );
}
