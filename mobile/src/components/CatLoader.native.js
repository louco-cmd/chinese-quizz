import { Component } from 'react';
import { ActivityIndicator } from 'react-native';
import { COLORS } from '../theme';

// Loader chat (NATIF) : joue la Lottie bundlée en boucle. Comme lottie-react-native
// est un module natif, on garde le rendu dans un ErrorBoundary + require paresseux
// (cf. NavBarLottie) → sur un build sans le natif, on retombe sur un ActivityIndicator
// (un loader DOIT rester visible, donc fallback spinner et non null).
let LottieView;
function getLottie() {
  if (LottieView !== undefined) return LottieView;
  try { LottieView = require('lottie-react-native').default; } catch { LottieView = null; }
  return LottieView;
}

class LottieBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* natif absent : on affiche le fallback */ }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function CatLoader({ size = 120 }) {
  const fallback = <ActivityIndicator color={COLORS.jiayou} size="large" />;
  const Lottie = getLottie();
  if (!Lottie) return fallback;

  return (
    <LottieBoundary fallback={fallback}>
      <Lottie
        source={require('../../assets/lottie/cat-loader.json')}
        autoPlay
        loop
        style={{ width: size, height: size }}
      />
    </LottieBoundary>
  );
}
