import type { ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "./Button";
import { colors, fontFamily, space } from "../../theme";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

interface EmptyStateProps {
  icon: IoniconName;
  title: string;
  message: string;
  tone?: "neutral" | "success";
  action?: { label: string; onPress: () => void };
}

export function EmptyState({ icon, title, message, tone = "neutral", action }: EmptyStateProps) {
  const iconColor = tone === "success" ? colors.status.success : colors.neutral.inkFaint;
  const iconBg = tone === "success" ? colors.status.successTint : colors.neutral.surfaceAlt;

  return (
    <View style={styles.wrap}>
      <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={28} color={iconColor} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {action && (
        <View style={styles.action}>
          <Button label={action.label} onPress={action.onPress} variant="outline" size="sm" fullWidth={false} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: space.xxxl, paddingHorizontal: space.xl },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.lg,
  },
  title: { fontFamily: fontFamily.bodyBold, fontSize: 16, color: colors.neutral.ink, marginBottom: space.xs },
  message: {
    fontFamily: fontFamily.body,
    fontSize: 14,
    color: colors.neutral.inkSoft,
    textAlign: "center",
    lineHeight: 20,
  },
  action: { marginTop: space.lg },
});
