import type { ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fontFamily, radii, space } from "../../theme";

type IoniconName = ComponentProps<typeof Ionicons>["name"];
type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "dark";

interface BadgeProps {
  label: string;
  icon?: IoniconName;
  tone?: Tone;
  /** Overrides tone with an arbitrary color (e.g. per-severity) — bg is a light tint of it. */
  color?: string;
}

const TONE_STYLES: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: colors.neutral.surfaceAlt, fg: colors.neutral.inkSoft },
  success: { bg: colors.status.successTint, fg: colors.status.success },
  warning: { bg: colors.status.warningTint, fg: colors.status.warning },
  danger: { bg: colors.status.dangerTint, fg: colors.status.danger },
  info: { bg: colors.status.infoTint, fg: colors.status.info },
  dark: { bg: "rgba(255,255,255,0.14)", fg: colors.white },
};

export function Badge({ label, icon, tone = "neutral", color }: BadgeProps) {
  const t = color ? { bg: `${color}1f`, fg: color } : TONE_STYLES[tone];
  return (
    <View style={[styles.wrap, { backgroundColor: t.bg }]}>
      {icon && <Ionicons name={icon} size={13} color={t.fg} style={styles.icon} />}
      <Text style={[styles.label, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingVertical: 5,
    paddingHorizontal: space.md,
    borderRadius: radii.pill,
  },
  icon: { marginRight: 5 },
  label: { fontFamily: fontFamily.bodySemibold, fontSize: 12 },
});
