import { useRef } from 'react';
import Lottie from 'lottie-react';
import animationData from '../../assets/lottie/navbar-char.json';

// Version WEB : player pur-JS (lottie-react), animation BUNDLÉE en local (aucune
// URL distante → robuste en Chine). pointerEvents none : purement décoratif.
//
// Yoyo : au lieu de `loop` (qui repart brutalement de la frame 0 → cassure), on
// joue une fois, puis on inverse le sens à chaque fin (play → reverse → play…).
// Le chat semble ainsi bouger naturellement, sans saut de raccord.
export default function NavBarLottie({ size = 150, speed = 0.6 }) {
  const lottieRef = useRef(null);
  const dir = useRef(1);

  const handleReady = () => {
    lottieRef.current?.setSpeed(speed);
  };

  const handleComplete = () => {
    dir.current = -dir.current;
    lottieRef.current?.setDirection(dir.current);
    lottieRef.current?.play();
  };

  return (
    <Lottie
      lottieRef={lottieRef}
      animationData={animationData}
      loop={false}
      autoplay
      onDOMLoaded={handleReady}
      onComplete={handleComplete}
      style={{ width: size, height: size, pointerEvents: 'none' }}
    />
  );
}
