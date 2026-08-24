import type { ComponentProps } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radii } from "../../theme";

type IoniconName = ComponentProps<typeof Ionicons>["name"];
type Variant = "plain" | "filled" | "floating";

interface IconButtonProps {
  icon: IoniconName;
  onPress: () => void;
  accessibilityLabel: string;
  size?: number;
  variant?: Variant;
  color?: string;
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  size = 22,
  variant = "plain",
  color,
}: IconButtonProps) {
  const iconColor = color ?? (variant === "floating" ? colors.neutral.ink : colors.neutral.inkSoft);

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        variant === "filled" && { backgroundColor: colors.neutral.surfaceAlt },
        variant === "floating" && styles.floating,
        { opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <View>
        <Ionicons name={icon} size={size} color={iconColor} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
  },
  floating: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.white,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});
