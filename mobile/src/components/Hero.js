import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// En-tête bleu partagé. `onAccount` affiche un bouton avatar en haut à droite.
export default function Hero({ title, subtitle, onAccount, right, children }) {
  return (
    <SafeAreaView edges={['top']} className="bg-jiayou">
      <View className="px-5 pt-3 pb-6">
        <View className="flex-row items-center justify-between">
          <Text className="text-white text-2xl font-extrabold">{title}</Text>
          {right
            ? right
            : onAccount
              ? (
                <Pressable
                  onPress={onAccount}
                  className="w-9 h-9 rounded-full bg-white/25 items-center justify-center active:opacity-70"
                >
                  <Text className="text-white text-base">👤</Text>
                </Pressable>
              )
              : null}
        </View>
        {subtitle ? <Text className="text-white/80 mt-1">{subtitle}</Text> : null}
        {children}
      </View>
    </SafeAreaView>
  );
}
