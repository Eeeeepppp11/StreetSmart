import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { JoltClassification } from "@potholeproof/shared-types";
import { Button, Card } from "./ui";
import { colors, fontFamily, radii, space } from "../theme";

interface ReportSheetProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (classification: JoltClassification, severity: number) => void;
}

const CLASSIFICATIONS: { value: JoltClassification; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "pothole", label: "Pothole", icon: "alert-circle-outline" },
  { value: "speed_bump", label: "Speed bump", icon: "swap-vertical-outline" },
  { value: "rough_road", label: "Rough road", icon: "trail-sign-outline" },
  { value: "other", label: "Other", icon: "help-circle-outline" },
];

const SEVERITIES: { value: number; label: string }[] = [
  { value: 0.2, label: "Minor" },
  { value: 0.5, label: "Moderate" },
  { value: 0.85, label: "Severe" },
];

export function ReportSheet({ visible, onClose, onSubmit }: ReportSheetProps) {
  const [classification, setClassification] = useState<JoltClassification>("pothole");
  const [severity, setSeverity] = useState(0.5);

  function submit() {
    onSubmit(classification, severity);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Card style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Report a hazard</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.neutral.inkSoft} />
            </Pressable>
          </View>
          <Text style={styles.label}>What did you see?</Text>
          <View style={styles.optionRow}>
            {CLASSIFICATIONS.map((c) => {
              const active = c.value === classification;
              return (
                <Pressable
                  key={c.value}
                  style={[styles.optionBtn, active && styles.optionBtnActive]}
                  onPress={() => setClassification(c.value)}
                >
                  <Ionicons name={c.icon} size={18} color={active ? colors.white : colors.neutral.ink} />
                  <Text style={[styles.optionText, active && styles.optionTextActive]}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.label, styles.labelSpaced]}>How bad?</Text>
          <View style={styles.severityRow}>
            {SEVERITIES.map((s) => {
              const active = s.value === severity;
              return (
                <Pressable
                  key={s.value}
                  style={[styles.severityChip, active && styles.severityChipActive]}
                  onPress={() => setSeverity(s.value)}
                >
                  <Text style={[styles.severityText, active && styles.severityTextActive]}>{s.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Button label="Submit report" onPress={submit} variant="primary" size="lg" icon="checkmark" style={styles.submitBtn} />
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(16,19,23,0.5)" },
  sheet: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: space.xl },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.md },
  title: { fontFamily: fontFamily.display, fontSize: 20, color: colors.neutral.ink },
  label: { fontFamily: fontFamily.bodyBold, fontSize: 13, color: colors.neutral.inkSoft },
  labelSpaced: { marginTop: space.lg },
  optionRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
  optionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: space.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.neutral.border,
  },
  optionBtnActive: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  optionText: { fontFamily: fontFamily.bodySemibold, fontSize: 13, color: colors.neutral.ink },
  optionTextActive: { color: colors.white },
  severityRow: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
  severityChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.neutral.border,
  },
  severityChipActive: { backgroundColor: colors.status.warningTint, borderColor: colors.status.warning },
  severityText: { fontFamily: fontFamily.bodySemibold, fontSize: 13, color: colors.neutral.ink },
  severityTextActive: { color: colors.status.warning },
  submitBtn: { marginTop: space.xl },
});
