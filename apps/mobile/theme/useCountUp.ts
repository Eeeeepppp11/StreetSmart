import { useEffect, useRef, useState } from "react";
import { Animated } from "react-native";
import { useReducedMotion } from "./motion";

/** Animates a displayed integer from its previous value up to `target`. */
export function useCountUp(target: number, durationMs = 600): number {
  const [display, setDisplay] = useState(target);
  const anim = useRef(new Animated.Value(target)).current;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      setDisplay(target);
      return;
    }
    const id = anim.addListener(({ value }) => setDisplay(Math.round(value)));
    Animated.timing(anim, {
      toValue: target,
      duration: durationMs,
      useNativeDriver: false,
    }).start();
    return () => anim.removeListener(id);
  }, [target, durationMs, reducedMotion]);

  return display;
}
