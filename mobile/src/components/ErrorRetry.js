import { View, Text, Pressable } from 'react-native';
import CatLoader from './CatLoader';

// Loader plein écran générique — utilisé par la plupart des écrans.
// Rend le chat Lottie (fallback spinner géré dans CatLoader sur les vieux builds).
export function Loading() {
  return (
    <View className="flex-1 items-center justify-center">
      <CatLoader size={110} />
    </View>
  );
}

export function ErrorRetry({ error, onRetry }) {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <Text className="text-red-500 text-center">{error}</Text>
      <Pressable onPress={onRetry} className="mt-4 bg-jiayou rounded-full px-5 py-2 active:opacity-80">
        <Text className="text-white font-semibold">Retry</Text>
      </Pressable>
    </View>
  );
}
