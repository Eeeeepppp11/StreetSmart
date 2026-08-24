import { useEffect, useRef } from "react";
import { Animated } from "react-native";
import { durations, useReducedMotion } from "./motion";

/**
 * Additive fade-in for phase/screen transitions — does NOT replace the
 * app's manual Phase-enum routing, just softens the hard cut between
 * screens. Wrap a screen's root View: <Animated.View style={{opacity: fade}}>.
 */
export function usePhaseFade(key: unknown): Animated.Value {
  const fade = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      fade.setValue(1);
      return;
    }
    fade.setValue(0);
    Animated.timing(fade, {
      toValue: 1,
      duration: durations.base,
      useNativeDriver: true,
    }).start();
  }, [key, reducedMotion]);

  return fade;
}
