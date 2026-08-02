import { Component, useRef, useState } from 'react';

// Version NATIVE du chat de la nav-bar (lottie-react-native).
//
// lottie-react-native 7.x expose son composant via `codegenNativeComponent`
// (Fabric pur). Sur la New Architecture — activée par défaut en SDK 57 —
// `UIManager.getViewManagerConfig('LottieAnimationView')` renvoie TOUJOURS null
// pour ce type de composant : l'ancien garde masquait donc le chat même quand
// le natif était bien présent (build ≥ 14).
//
// Détection fiable et agnostique de l'archi : on tente de RENDRE Lottie dans un
// ErrorBoundary. Build qui contient le natif → le chat s'affiche ; vieux build
// sans le natif → le rendu échoue et on retombe silencieusement sur null.

let LottieView; // résolu paresseusement (require peut échouer si natif absent)
function getLottie() {
  if (LottieView !== undefined) return LottieView;
  try { LottieView = require('lottie-react-native').default; } catch { LottieView = null; }
  return LottieView;
}

class LottieBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* natif absent : on masque, sans remonter l'erreur */ }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function NavBarLottie({ size = 150, speed = 0.6 }) {
  const ref = useRef(null);
  const dir = useRef(1);
  // Yoyo : on inverse le signe de la vitesse à chaque fin plutôt que de boucler
  // (le loop repart de la frame 0 → cassure). play → reverse → play à l'infini.
  const [spd, setSpd] = useState(speed);

  const Lottie = getLottie();
  if (!Lottie) return null;

  const onFinish = () => {
    dir.current = -dir.current;
    setSpd(speed * dir.current);
    requestAnimationFrame(() => ref.current?.play());
  };

  return (
    <LottieBoundary>
      <Lottie
        ref={ref}
        source={require('../../assets/lottie/navbar-char.json')}
        autoPlay
        loop={false}
        speed={spd}
        onAnimationFinish={onFinish}
        style={{ width: size, height: size }}
      />
    </LottieBoundary>
  );
}
