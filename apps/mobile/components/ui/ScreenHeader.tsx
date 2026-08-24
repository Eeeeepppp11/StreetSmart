import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fontFamily, space, typeScale } from "../../theme";

interface ScreenHeaderProps {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  right?: ReactNode;
}

export function ScreenHeader({ title, onBack, backLabel = "Back", right }: ScreenHeaderProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {onBack && (
          <Pressable onPress={onBack} accessibilityRole="button" hitSlop={8} style={styles.backRow}>
            <Ionicons name="chevron-back" size={18} color={colors.brand.primary} />
            <Text style={styles.backText}>{backLabel}</Text>
          </Pressable>
        )}
        {right && <View style={styles.right}>{right}</View>}
      </View>
      <Text style={[typeScale.h1, styles.title]}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: space.lg },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 22 },
  backRow: { flexDirection: "row", alignItems: "center" },
  backText: { fontFamily: fontFamily.bodySemibold, fontSize: 15, color: colors.brand.primary, marginLeft: 2 },
  right: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { marginTop: space.sm },
});
