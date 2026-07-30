import { UIManager } from 'react-native';

// Version NATIVE : lottie-react-native est un module NATIF absent des builds ≤ 10.
// Comme pour le blur, require() réussit (JS bundlé) mais le RENDU crasherait si le
// natif est absent. On ne rend donc QUE si le view manager `LottieAnimationView`
// est enregistré → rien en OTA sur les vieux builds, activé au prochain AAB.
function hasNativeLottie() {
  try {
    return !!(UIManager.getViewManagerConfig && UIManager.getViewManagerConfig('LottieAnimationView'));
  } catch { return false; }
}

let LottieView;
export default function NavBarLottie({ size = 150, speed = 0.6 }) {
  if (!hasNativeLottie()) return null;
  if (LottieView === undefined) {
    try { LottieView = require('lottie-react-native').default; } catch { LottieView = null; }
  }
  if (!LottieView) return null;
  return (
    <LottieView
      source={require('../../assets/lottie/navbar-char.json')}
      autoPlay
      loop
      speed={speed}
      style={{ width: size, height: size }}
    />
  );
}
