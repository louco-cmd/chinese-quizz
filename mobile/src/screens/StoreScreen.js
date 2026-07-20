import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PackMarket from '../components/PackMarket';
import { COLORS } from '../theme';

// JiaStore : hero + marketplace de packs (grille + achat via PackMarket).
export default function StoreScreen({ onBack, onCreate, onStartQuiz }) {
  const Hero = (
    <View style={{ paddingTop: 14, paddingBottom: 8, paddingHorizontal: 16 }}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
          <Ionicons name="chevron-back" size={20} color={COLORS.jiayou} />
          <Text style={{ color: COLORS.jiayou, fontWeight: '600' }}>Back</Text>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#1a1a2e', fontSize: 22, fontWeight: '800' }}>JiaStore</Text>
          <Text style={{ color: COLORS.muted, fontSize: 13, marginTop: 2 }}>Word packs to grow your vocabulary</Text>
        </View>
        {onCreate ? (
          <Pressable
            onPress={onCreate}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 }}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Sell a pack</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      {Hero}
      <PackMarket onStartQuiz={onStartQuiz} />
    </View>
  );
}
