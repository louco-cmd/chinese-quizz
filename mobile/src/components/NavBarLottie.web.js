import Lottie from 'lottie-react';
import animationData from '../../assets/lottie/navbar-char.json';

// Version WEB : player pur-JS (lottie-react), animation BUNDLÉE en local (aucune
// URL distante → robuste en Chine). pointerEvents none : purement décoratif.
export default function NavBarLottie({ size = 150, speed = 0.6 }) {
  const ref = (el) => { if (el && el.setSpeed) el.setSpeed(speed); };
  return (
    <Lottie
      lottieRef={ref}
      animationData={animationData}
      loop
      autoplay
      style={{ width: size, height: size, pointerEvents: 'none' }}
    />
  );
}
