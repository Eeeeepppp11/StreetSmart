import { StyleSheet, Text, View } from "react-native";
import { Card } from "./Card";
import { colors, fontFamily, space } from "../../theme";

type Size = "sm" | "md" | "lg";

interface StatTileProps {
  value: string;
  label: string;
  valueColor?: string;
  size?: Size;
}

const VALUE_SIZE: Record<Size, number> = { sm: 18, md: 22, lg: 32 };

export function StatTile({ value, label, valueColor = colors.neutral.ink, size = "md" }: StatTileProps) {
  return (
    <Card style={styles.tile}>
      <Text style={[styles.value, { color: valueColor, fontSize: VALUE_SIZE[size] }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.label} numberOfLines={2}>
        {label}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, minWidth: 96 },
  value: { fontFamily: fontFamily.mono },
  label: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
    color: colors.neutral.inkFaint,
    marginTop: space.xs,
  },
});
