import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radii, space } from "../../theme";

interface CardProps {
  children: ReactNode;
  padded?: boolean;
  dark?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, padded = true, dark = false, style }: CardProps) {
  return (
    <View
      style={[
        styles.base,
        { backgroundColor: dark ? colors.dark.bg : colors.neutral.surface },
        padded && styles.padded,
        !dark && styles.border,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radii.lg },
  padded: { padding: space.lg },
  border: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.neutral.border },
});
