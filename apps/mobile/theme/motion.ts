import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export const durations = {
  fast: 120,
  base: 200,
  slow: 320,
} as const;

/** Gate new animations behind the OS "reduce motion" setting. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduced;
}
