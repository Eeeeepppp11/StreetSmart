import { ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { MODEL_METRICS } from "@potholeproof/detector";
import { Button, Card, ScreenHeader, StatTile } from "../components/ui";
import { colors, fontFamily, space, typeScale } from "../theme";

interface ModelInfoScreenProps {
  onClose: () => void;
  onOpenLab: () => void;
}

const LABEL_DISPLAY: Record<string, string> = {
  pothole: "Pothole",
  speed_bump: "Speed bump",
  rough_road: "Rough road",
  other: "Other",
};

export default function ModelInfoScreen({ onClose, onOpenLab }: ModelInfoScreenProps) {
  const m = MODEL_METRICS;

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.headerWrap}>
        <ScreenHeader title="How the AI works" onBack={onClose} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card style={styles.cardMargin}>
          <Text style={typeScale.label}>Architecture</Text>
          <Text style={styles.body}>
            A small neural network — 10 inputs → 32 → 16 → 4 outputs, ReLU activations, softmax
            classification. It runs as a pure-JS forward pass on-device (no native TFLite, so it
            works in Expo Go), reimplementing weights trained with TensorFlow.
          </Text>
          <Text style={[styles.body, styles.bodySpaced]}>
            Inputs are the same 10 numbers the on-device detector already computes for every
            candidate jolt: peak-to-peak acceleration, RMS, max jerk, settle time, vertical
            dominance, gyro RMS, sample count, sample interval, and vehicle speed.
          </Text>
        </Card>

        <View style={styles.statRow}>
          <StatTile value={`${Math.round(m.testAccuracy * 100)}%`} label="Test accuracy" valueColor={colors.status.success} />
          <StatTile value={`${(m.potholeFalsePositiveRate * 100).toFixed(1)}%`} label="Pothole false-positive rate" />
          <StatTile value={m.datasetSize.toLocaleString()} label="Training examples" />
        </View>

        <Card style={styles.cardMargin}>
          <Text style={typeScale.label}>Per-class performance</Text>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableCell, styles.tableHeaderText, styles.tableLabelCol]}>Class</Text>
            <Text style={[styles.tableCell, styles.tableHeaderText]}>Precision</Text>
            <Text style={[styles.tableCell, styles.tableHeaderText]}>Recall</Text>
            <Text style={[styles.tableCell, styles.tableHeaderText]}>F1</Text>
          </View>
          {m.labels.map((label) => {
            const c = m.perClass[label]!;
            return (
              <View key={label} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.tableLabelCol, styles.tableLabelText]}>
                  {LABEL_DISPLAY[label] ?? label}
                </Text>
                <Text style={styles.tableCellNumeric}>{Math.round(c.precision * 100)}%</Text>
                <Text style={styles.tableCellNumeric}>{Math.round(c.recall * 100)}%</Text>
                <Text style={styles.tableCellNumeric}>{Math.round(c.f1Score * 100)}%</Text>
              </View>
            );
          })}
        </Card>

        <Card style={styles.cardMargin}>
          <Text style={typeScale.label}>Confusion matrix</Text>
          <Text style={styles.tableCaption}>Rows = actual, columns = predicted</Text>
          <View style={styles.matrixHeaderRow}>
            <View style={styles.matrixCornerCell} />
            {m.labels.map((label) => (
              <Text key={label} style={styles.matrixHeaderCell}>
                {(LABEL_DISPLAY[label] ?? label).slice(0, 4)}
              </Text>
            ))}
          </View>
          {m.confusionMatrix.map((row, i) => (
            <View key={m.labels[i]} style={styles.matrixRow}>
              <Text style={styles.matrixRowLabel}>{(LABEL_DISPLAY[m.labels[i]!] ?? "").slice(0, 4)}</Text>
              {row.map((count, j) => (
                <Text
                  key={j}
                  style={[styles.matrixCell, i === j && styles.matrixCellDiagonal]}
                >
                  {count}
                </Text>
              ))}
            </View>
          ))}
        </Card>

        <Button label="Try the heuristic vs AI lab" onPress={onOpenLab} variant="dark" size="lg" icon="flask-outline" />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.bg, paddingTop: 56 },
  headerWrap: { paddingHorizontal: space.lg },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxxl },
  cardMargin: { marginBottom: space.md },
  body: { fontFamily: fontFamily.body, fontSize: 14, color: colors.neutral.ink, lineHeight: 20, marginTop: space.sm },
  bodySpaced: { marginTop: 10 },
  statRow: { flexDirection: "row", gap: space.sm, marginBottom: space.md },
  tableHeaderRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.neutral.divider, paddingBottom: space.sm, marginTop: space.sm, marginBottom: 4 },
  tableRow: { flexDirection: "row", paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.neutral.bg },
  tableCell: { flex: 1, fontFamily: fontFamily.body, fontSize: 13, color: colors.neutral.ink, textAlign: "center" },
  tableCellNumeric: { flex: 1, fontFamily: fontFamily.monoMedium, fontSize: 13, color: colors.neutral.ink, textAlign: "center" },
  tableHeaderText: { fontFamily: fontFamily.bodySemibold, color: colors.neutral.inkFaint, fontSize: 11, textTransform: "uppercase" },
  tableLabelCol: { flex: 1.4, textAlign: "left" },
  tableLabelText: { fontFamily: fontFamily.bodyBold },
  tableCaption: { fontFamily: fontFamily.bodyMedium, fontSize: 12, color: colors.neutral.inkFaint, marginBottom: space.sm, marginTop: -4 },
  matrixHeaderRow: { flexDirection: "row" },
  matrixCornerCell: { width: 44 },
  matrixHeaderCell: { flex: 1, fontFamily: fontFamily.bodySemibold, fontSize: 11, color: colors.neutral.inkFaint, textAlign: "center" },
  matrixRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  matrixRowLabel: { width: 44, fontFamily: fontFamily.bodySemibold, fontSize: 11, color: colors.neutral.inkFaint },
  matrixCell: {
    flex: 1,
    textAlign: "center",
    fontFamily: fontFamily.monoMedium,
    fontSize: 13,
    color: colors.neutral.ink,
    backgroundColor: colors.neutral.bg,
    marginHorizontal: 2,
    borderRadius: 6,
    paddingVertical: 6,
  },
  matrixCellDiagonal: { backgroundColor: colors.status.successTint, fontFamily: fontFamily.mono, color: colors.status.success },
});
