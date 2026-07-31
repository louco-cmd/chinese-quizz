import { useRef, useState } from 'react';
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
  const ref = useRef(null);
  const dir = useRef(1);
  // Yoyo : on inverse le signe de la vitesse à chaque fin plutôt que de boucler
  // (le loop repart de la frame 0 → cassure). play → reverse → play à l'infini.
  const [spd, setSpd] = useState(speed);

  if (!hasNativeLottie()) return null;
  if (LottieView === undefined) {
    try { LottieView = require('lottie-react-native').default; } catch { LottieView = null; }
  }
  if (!LottieView) return null;

  const onFinish = () => {
    dir.current = -dir.current;
    setSpd(speed * dir.current);
    requestAnimationFrame(() => ref.current?.play());
  };

  return (
    <LottieView
      ref={ref}
      source={require('../../assets/lottie/navbar-char.json')}
      autoPlay
      loop={false}
      speed={spd}
      onAnimationFinish={onFinish}
      style={{ width: size, height: size }}
    />
  );
}
