import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { colors, durations, radii, useReducedMotion } from "../../theme";

interface ConfidenceBarProps {
  pct: number;
  color?: string;
  height?: number;
  animated?: boolean;
  delayMs?: number;
}

export function ConfidenceBar({
  pct,
  color = colors.brand.primary,
  height = 6,
  animated = true,
  delayMs = 0,
}: ConfidenceBarProps) {
  const width = useRef(new Animated.Value(animated ? 0 : pct)).current;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!animated || reducedMotion) {
      width.setValue(pct);
      return;
    }
    Animated.timing(width, {
      toValue: pct,
      duration: durations.slow,
      delay: delayMs,
      useNativeDriver: false,
    }).start();
  }, [pct, animated, reducedMotion]);

  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <Animated.View
        style={[
          styles.fill,
          {
            height,
            borderRadius: height / 2,
            backgroundColor: color,
            width: width.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"], extrapolate: "clamp" }),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: "100%", backgroundColor: colors.neutral.surfaceAlt, overflow: "hidden" },
  fill: { borderRadius: radii.sm },
});
