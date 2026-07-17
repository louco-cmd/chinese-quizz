import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { LEGAL_BLOCKS, LEGAL_UPDATED, LEGAL_CONTACT } from '../data/legalContent';

function Block({ block }) {
  switch (block.t) {
    case 'label':
      return <Text className="text-jiayou font-bold text-[11px] uppercase tracking-[1px] mt-6 mb-1">{block.text}</Text>;
    case 'h2':
      return <Text className="text-ink font-extrabold text-[22px] mb-3">{block.text}</Text>;
    case 'h3':
      return <Text className="text-ink font-bold text-[15.5px] mt-4 mb-1.5">{block.text}</Text>;
    case 'p':
      return <Text className="text-[#3f4654] text-[14px] leading-[21px] mb-2.5">{block.text}</Text>;
    case 'ul':
      return (
        <View className="mb-2.5">
          {block.items.map((it, i) => (
            <View key={i} className="flex-row mb-1.5">
              <Text className="text-jiayou text-[14px] leading-[21px] mr-2">•</Text>
              <Text className="text-[#3f4654] text-[14px] leading-[21px] flex-1">{it}</Text>
            </View>
          ))}
        </View>
      );
    case 'note':
      return (
        <View className="bg-jiayou-soft border-l-4 border-jiayou rounded-lg px-3.5 py-3 my-3">
          <Text className="text-[#2a3242] text-[13.5px] leading-[20px]">{block.text}</Text>
        </View>
      );
    case 'table':
      return (
        <View className="my-2.5" style={{ rowGap: 8 }}>
          {block.rows.map((row, i) => (
            <View key={i} className="bg-surface border border-line-soft rounded-xl p-3">
              {row.map((cell, j) => (
                <View key={j} className={j === row.length - 1 ? '' : 'mb-1.5'}>
                  <Text className="text-muted-light text-[10.5px] uppercase tracking-wide">{block.head[j]}</Text>
                  <Text className="text-[#3f4654] text-[13.5px] leading-[19px] mt-0.5">{cell}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    default:
      return null;
  }
}

// Page Legal & Privacy — reproduction native de views/legal.ejs (texte intégral).
export default function LegalScreen({ onBack }) {
  return (
    <View className="flex-1 bg-surface-page">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Hero */}
        <View className="bg-jiayou px-4 pt-4 pb-10">
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={10} className="flex-row items-center gap-1 mb-2">
              <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.9)" />
              <Text className="text-white/90 font-semibold">Back</Text>
            </Pressable>
          ) : null}
          <Text className="text-white font-extrabold text-[24px]">加油！ Legal & Privacy</Text>
          <Text className="text-white/80 text-[12.5px] mt-1">Last updated: {LEGAL_UPDATED}</Text>
        </View>

        <View style={{ width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 18, marginTop: 10 }}>
          {LEGAL_BLOCKS.map((b, i) => <Block key={i} block={b} />)}

          {/* Contact */}
          <Pressable
            onPress={() => Linking.openURL(`mailto:${LEGAL_CONTACT}`)}
            className="flex-row items-center justify-center gap-2 bg-jiayou rounded-full py-3.5 mt-6"
          >
            <Ionicons name="mail" size={16} color="#fff" />
            <Text className="text-white font-bold">Contact {LEGAL_CONTACT}</Text>
          </Pressable>
          <Text className="text-muted-light text-[12px] text-center mt-4">© 2026 Jiayou · jiayou.fr</Text>
        </View>
      </ScrollView>
    </View>
  );
}
