import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { MODEL_METRICS } from "@potholeproof/detector";

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
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>How the AI works</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Architecture</Text>
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
        </View>

        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{Math.round(m.testAccuracy * 100)}%</Text>
            <Text style={styles.statLabel}>Test accuracy</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{(m.potholeFalsePositiveRate * 100).toFixed(1)}%</Text>
            <Text style={styles.statLabel}>Pothole false-positive rate</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{m.datasetSize.toLocaleString()}</Text>
            <Text style={styles.statLabel}>Training examples</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Per-class performance</Text>
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
                <Text style={styles.tableCell}>{Math.round(c.precision * 100)}%</Text>
                <Text style={styles.tableCell}>{Math.round(c.recall * 100)}%</Text>
                <Text style={styles.tableCell}>{Math.round(c.f1Score * 100)}%</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Confusion matrix</Text>
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
        </View>

        <Pressable style={styles.labBtn} onPress={onOpenLab}>
          <Text style={styles.labBtnText}>🔬 Try: Heuristic vs AI Lab</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f6f7f9", paddingTop: 56 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, marginBottom: 12 },
  backText: { color: "#e8442e", fontSize: 15, fontWeight: "600", marginRight: 14 },
  title: { fontSize: 20, fontWeight: "800", color: "#1a1d21" },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#1a1d21",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8a939d",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  body: { fontSize: 14, color: "#1a1d21", lineHeight: 20 },
  bodySpaced: { marginTop: 10 },
  statRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  statCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    alignItems: "center",
    shadowColor: "#1a1d21",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  statValue: { fontSize: 22, fontWeight: "800", color: "#e8442e" },
  statLabel: { fontSize: 11, color: "#5b6570", textAlign: "center", marginTop: 4 },
  tableHeaderRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#eef0f2", paddingBottom: 8, marginBottom: 4 },
  tableRow: { flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f6f7f9" },
  tableCell: { flex: 1, fontSize: 13, color: "#1a1d21", textAlign: "center" },
  tableHeaderText: { fontWeight: "700", color: "#8a939d", fontSize: 11, textTransform: "uppercase" },
  tableLabelCol: { flex: 1.4, textAlign: "left" },
  tableLabelText: { fontWeight: "700" },
  tableCaption: { fontSize: 12, color: "#8a939d", marginBottom: 10, marginTop: -4 },
  matrixHeaderRow: { flexDirection: "row" },
  matrixCornerCell: { width: 44 },
  matrixHeaderCell: { flex: 1, fontSize: 11, fontWeight: "700", color: "#8a939d", textAlign: "center" },
  matrixRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  matrixRowLabel: { width: 44, fontSize: 11, fontWeight: "700", color: "#8a939d" },
  matrixCell: {
    flex: 1,
    textAlign: "center",
    fontSize: 13,
    color: "#1a1d21",
    backgroundColor: "#f6f7f9",
    marginHorizontal: 2,
    borderRadius: 6,
    paddingVertical: 6,
  },
  matrixCellDiagonal: { backgroundColor: "#d9f2df", fontWeight: "800", color: "#1a7f37" },
  labBtn: {
    backgroundColor: "#1a1d21",
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  labBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
