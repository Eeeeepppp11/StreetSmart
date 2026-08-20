import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { makeSamples, compareClassifiers, type ClassifierComparison } from "@potholeproof/detector";
import type { GpsFix } from "@potholeproof/detector";

interface CompareScreenProps {
  onClose: () => void;
}

const LABEL_DISPLAY: Record<string, string> = {
  pothole: "Pothole",
  speed_bump: "Speed bump",
  rough_road: "Rough road",
  other: "Other",
};

/** Piecewise-linear speed profile, m/s, keyframes as [ms, speed]. */
function speedAtKeyframes(tMs: number, keyframes: [number, number][]): number {
  for (let i = 0; i < keyframes.length - 1; i++) {
    const [t0, s0] = keyframes[i]!;
    const [t1, s1] = keyframes[i + 1]!;
    if (tMs >= t0 && tMs <= t1) {
      const f = t1 === t0 ? 0 : (tMs - t0) / (t1 - t0);
      return s0 + (s1 - s0) * f;
    }
  }
  return keyframes[keyframes.length - 1]![1];
}

/** Deliberately covers a broad speed range (~4-54 mph) — severity normalises
 *  against speed, so this stresses the heuristic/model boundary differently
 *  at low, cruising, and highway-ish speeds, not just one fixed speed. */
const LAB_SPEED_KEYFRAMES: [number, number][] = [
  [0, 2],
  [3000, 6], // slow residential
  [9000, 6],
  [12000, 14], // accelerating
  [18000, 14], // suburban cruise, ~31 mph
  [22000, 3], // slowing for a turn
  [26000, 14], // resuming
  [34000, 24], // ramping onto the highway, ~54 mph
  [44000, 24], // highway cruise
  [48000, 8], // slowing to arrival
];

function labSpeedAt(tMs: number): number {
  const wobble = Math.sin(tMs / 900) * 0.5;
  return Math.max(0.5, speedAtKeyframes(tMs, LAB_SPEED_KEYFRAMES) + wobble);
}

/** A ~48s synthetic drive through Bellevue, WA 98005, with deliberately
 *  varied/borderline hits across a broad speed range, so the heuristic and
 *  the trained model are likely to actually disagree somewhere — that's the
 *  interesting case this lab exists to surface. */
function buildLabDrive(): { samples: ReturnType<typeof makeSamples>; gps: GpsFix[] } {
  const DURATION_MS = 48000;
  const samples = makeSamples({
    durationMs: DURATION_MS,
    rateHz: 50,
    noise: 0.3,
    gyroNoise: 0.04,
    seed: 42,
    impulses: [
      { atMs: 3500, peak: 8, kind: "sharp", widthMs: 35 }, // clean pothole, slow residential
      { atMs: 7000, peak: 6.5, kind: "rounded", widthMs: 300, gyroPeak: 1.4 }, // clean speed bump, slow
      { atMs: 10500, peak: 6, kind: "sharp", widthMs: 60, gyroPeak: 0.3 }, // borderline: sharp but some rotation
      { atMs: 15000, peak: 16, kind: "sharp", widthMs: 30 }, // severe pothole, cruising
      { atMs: 19500, peak: 5, kind: "rounded", widthMs: 130, gyroPeak: 0.4 }, // borderline: short rounded hump, slowing for a turn
      { atMs: 24000, peak: 9, kind: "rounded", widthMs: 380, gyroPeak: 2.1 }, // clean speed bump, resuming
      { atMs: 30000, peak: 5.5, kind: "sharp", widthMs: 90 }, // borderline: soft/wide "sharp", cruising
      { atMs: 37000, peak: 20, kind: "sharp", widthMs: 28 }, // severe pothole at highway-ish speed
      { atMs: 41000, peak: 8, kind: "rounded", widthMs: 300, gyroPeak: 1.7 }, // speed bump, still fast
      { atMs: 46000, peak: 6, kind: "sharp", widthMs: 45 }, // pothole, slowing to arrival
    ],
  });
  // West Bellevue, WA (zip 98005).
  const base = { lat: 47.6101, lng: -122.173 };
  const gps: GpsFix[] = [];
  let lat = base.lat;
  for (let t = 0; t <= DURATION_MS; t += 1000) {
    const speedMps = labSpeedAt(t);
    gps.push({
      t,
      capturedAt: new Date(1_760_000_000_000 + t).toISOString(),
      location: { lat, lng: base.lng },
      speedMps,
      heading: 0,
    });
    lat += speedMps / 111320;
  }
  return { samples, gps };
}

function pinColor(classification: string, severity: number): string {
  if (classification === "pothole") {
    return severity >= 0.67 ? "#d92616" : severity >= 0.34 ? "#e8812e" : "#e6b91e";
  }
  if (classification === "speed_bump") return "#4a72da";
  return "#8a939d";
}

function ConfidenceBar({ pct, color }: { pct: number; color: string }) {
  return (
    <View style={styles.confBarTrack}>
      <View style={[styles.confBarFill, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

function VerdictRow({
  label,
  icon,
  result,
}: {
  label: string;
  icon: string;
  result: { classification: string; confidence: number };
}) {
  const pct = Math.round(result.confidence * 100);
  return (
    <View style={styles.verdictRow}>
      <Text style={styles.verdictLabel}>
        {icon} {label}
      </Text>
      <Text style={styles.verdictClass}>{LABEL_DISPLAY[result.classification] ?? result.classification}</Text>
      <ConfidenceBar pct={pct} color={pinColor(result.classification, 0.5)} />
      <Text style={styles.verdictPct}>{pct}%</Text>
    </View>
  );
}

function ComparisonCard({ item, index }: { item: ClassifierComparison; index: number }) {
  const f = item.features;
  return (
    <View style={[styles.card, !item.agree && styles.cardDisagree]}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardIndex}>Candidate #{index + 1}</Text>
        <View style={[styles.agreeBadge, item.agree ? styles.agreeBadgeYes : styles.agreeBadgeNo]}>
          <Text style={styles.agreeBadgeText}>{item.agree ? "✅ Agree" : "⚠️ Disagree"}</Text>
        </View>
      </View>

      <VerdictRow label="Heuristic" icon="📏" result={item.heuristic} />
      <VerdictRow label="AI Model" icon="🤖" result={item.model} />

      <View style={styles.featureGrid}>
        <FeatureCell label="peak-to-peak" value={f.peakToPeak.toFixed(2)} />
        <FeatureCell label="RMS" value={f.rms.toFixed(2)} />
        <FeatureCell label="max jerk" value={f.maxJerk.toFixed(0)} />
        <FeatureCell label="vert. dominance" value={f.verticalDominance.toFixed(2)} />
        <FeatureCell label="gyro RMS" value={f.gyroRms.toFixed(2)} />
        <FeatureCell label="speed" value={`${(item.fix.speedMps * 2.237).toFixed(0)} mph`} />
      </View>
    </View>
  );
}

function FeatureCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.featureCell}>
      <Text style={styles.featureValue}>{value}</Text>
      <Text style={styles.featureLabel}>{label}</Text>
    </View>
  );
}

export default function CompareScreen({ onClose }: CompareScreenProps) {
  const results = useMemo(() => {
    const { samples, gps } = buildLabDrive();
    const all = compareClassifiers(samples, gps);
    // Disagreements are the interesting part — surface them first.
    return [...all].sort((a, b) => Number(a.agree) - Number(b.agree));
  }, []);

  const disagreeCount = results.filter((r) => !r.agree).length;

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Heuristic vs AI Lab</Text>
      </View>
      <Text style={styles.subtitle}>
        The same synthetic drive, scored two ways: the hand-tuned rule thresholds vs. the trained
        model — same inputs, independent verdicts.
      </Text>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{results.length}</Text>
          <Text style={styles.summaryLabel}>candidates</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={[styles.summaryValue, { color: "#2e9e4f" }]}>{results.length - disagreeCount}</Text>
          <Text style={styles.summaryLabel}>agree</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={[styles.summaryValue, { color: "#e8812e" }]}>{disagreeCount}</Text>
          <Text style={styles.summaryLabel}>disagree</Text>
        </View>
      </View>

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={results}
        keyExtractor={(item) => String(item.peakT)}
        renderItem={({ item, index }) => <ComparisonCard item={item} index={index} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f6f7f9", paddingTop: 56 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, marginBottom: 6 },
  backText: { color: "#e8442e", fontSize: 15, fontWeight: "600", marginRight: 14 },
  title: { fontSize: 20, fontWeight: "800", color: "#1a1d21" },
  subtitle: { fontSize: 13, color: "#5b6570", paddingHorizontal: 16, lineHeight: 18 },
  summaryRow: { flexDirection: "row", gap: 10, paddingHorizontal: 16, marginTop: 12, marginBottom: 8 },
  summaryCard: { flex: 1, backgroundColor: "#fff", borderRadius: 12, paddingVertical: 10, alignItems: "center" },
  summaryValue: { fontSize: 20, fontWeight: "800", color: "#1a1d21" },
  summaryLabel: { fontSize: 11, color: "#8a939d", marginTop: 2 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
    shadowColor: "#1a1d21",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardDisagree: { borderWidth: 1.5, borderColor: "#f0c37a" },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  cardIndex: { fontSize: 12, fontWeight: "700", color: "#8a939d" },
  agreeBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  agreeBadgeYes: { backgroundColor: "#d9f2df" },
  agreeBadgeNo: { backgroundColor: "#fbe7c8" },
  agreeBadgeText: { fontSize: 11, fontWeight: "800", color: "#1a1d21" },
  verdictRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  verdictLabel: { fontSize: 12, color: "#5b6570", width: 82 },
  verdictClass: { fontSize: 13, fontWeight: "700", color: "#1a1d21", width: 78 },
  confBarTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: "#eef0f2", overflow: "hidden" },
  confBarFill: { height: "100%", borderRadius: 3 },
  verdictPct: { fontSize: 12, fontWeight: "700", color: "#5b6570", width: 34, textAlign: "right" },
  featureGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 10, borderTopWidth: 1, borderTopColor: "#f6f7f9", paddingTop: 10 },
  featureCell: { width: "33.33%", marginBottom: 6 },
  featureValue: { fontSize: 13, fontWeight: "700", color: "#1a1d21" },
  featureLabel: { fontSize: 10, color: "#8a939d" },
});
