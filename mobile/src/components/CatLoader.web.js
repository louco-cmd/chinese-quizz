import Lottie from 'lottie-react';
import animationData from '../../assets/lottie/cat-loader.json';

// Loader chat (WEB) : player pur-JS, animation BUNDLÉE en local (aucune URL
// distante → robuste en Chine). Boucle en continu.
export default function CatLoader({ size = 120 }) {
  return (
    <Lottie
      animationData={animationData}
      loop
      autoplay
      style={{ width: size, height: size, pointerEvents: 'none' }}
    />
  );
}
