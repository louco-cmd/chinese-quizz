import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme';

// Lignes de cours (lessons) d'un élève — partagées entre la page « Mes cours »
// et la page « Mon prof ». Chaque ligne : titre + classe·mots + statut (terminé /
// % de maîtrise) + chevron. onOpen(lesson, readOnly) ouvre le cours (CoursePage).
export default function StudentLessonRows({ lessons = [], onOpen, t }) {
  return (
    <>
      {lessons.map((l, i) => {
        const readOnly = l.membership !== 'active';
        return (
          <Pressable
            key={l.id}
            onPress={() => onOpen?.(l, readOnly)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: i === lessons.length - 1 ? 0 : 1, borderColor: '#f2f4f7' }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#1a1a2e' }} numberOfLines={1}>{l.title}</Text>
              <Text style={{ fontSize: 12, color: COLORS.mutedLight, marginTop: 2 }}>
                {l.class_name || ''} · {l.word_count} {t('mc_words')}
              </Text>
            </View>
            {l.completed ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#e7f6ec', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Ionicons name="checkmark-circle" size={13} color={COLORS.success} />
                <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.success }}>{t('mc_completed')}</Text>
              </View>
            ) : (
              <View style={{ backgroundColor: '#eef2f7', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{ fontSize: 12, fontWeight: '800', color: '#6c7785' }}>{l.knowledge}%</Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={16} color="#c7ced6" />
          </Pressable>
        );
      })}
    </>
  );
}
