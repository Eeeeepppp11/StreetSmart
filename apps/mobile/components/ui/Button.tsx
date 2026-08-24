import { useRef } from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { colors, fontFamily, radii, space, useReducedMotion } from "../../theme";

type IoniconName = ComponentProps<typeof Ionicons>["name"];
type Variant = "primary" | "outline" | "ghost" | "danger" | "dark";
type Size = "lg" | "md" | "sm";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  icon?: IoniconName;
  iconPosition?: "left" | "right";
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

const SIZE_STYLES: Record<Size, { paddingVertical: number; fontSize: number; iconSize: number }> = {
  lg: { paddingVertical: 16, fontSize: 16, iconSize: 18 },
  md: { paddingVertical: 12, fontSize: 15, iconSize: 16 },
  sm: { paddingVertical: 9, fontSize: 13, iconSize: 14 },
};

const VARIANT_STYLES: Record<Variant, { bg: string; border?: string; text: string }> = {
  primary: { bg: colors.brand.primary, text: colors.white },
  dark: { bg: colors.dark.bg, text: colors.white },
  danger: { bg: colors.status.danger, text: colors.white },
  outline: { bg: "transparent", border: colors.neutral.border, text: colors.neutral.ink },
  ghost: { bg: "transparent", text: colors.brand.primary },
};

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon,
  iconPosition = "left",
  loading = false,
  disabled = false,
  fullWidth = true,
  style,
}: ButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();
  const sizeStyle = SIZE_STYLES[size];
  const variantStyle = VARIANT_STYLES[variant];
  const isDisabled = disabled || loading;

  function pressIn() {
    if (reducedMotion || size === "sm") return;
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 40 }).start();
  }
  function pressOut() {
    if (reducedMotion || size === "sm") return;
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40 }).start();
  }

  return (
    <Animated.View style={[fullWidth && styles.fullWidth, { transform: [{ scale }] }]}>
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={isDisabled}
        style={({ pressed }) => [
          styles.base,
          {
            backgroundColor: variantStyle.bg,
            borderColor: variantStyle.border,
            borderWidth: variantStyle.border ? 1.5 : 0,
            paddingVertical: sizeStyle.paddingVertical,
            borderRadius: size === "sm" ? radii.md : radii.pill,
            opacity: isDisabled ? 0.55 : pressed ? 0.85 : 1,
          },
          style,
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={variantStyle.text} />
        ) : (
          <>
            {icon && iconPosition === "left" && (
              <Ionicons name={icon} size={sizeStyle.iconSize} color={variantStyle.text} style={styles.iconLeft} />
            )}
            <Text style={{ color: variantStyle.text, fontFamily: fontFamily.bodyBold, fontSize: sizeStyle.fontSize }}>
              {label}
            </Text>
            {icon && iconPosition === "right" && (
              <Ionicons name={icon} size={sizeStyle.iconSize} color={variantStyle.text} style={styles.iconRight} />
            )}
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fullWidth: { width: "100%" },
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.sm,
  },
  iconLeft: { marginRight: space.sm },
  iconRight: { marginLeft: space.sm },
});
