import { useMemo } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { makeSamples, compareClassifiers, type ClassifierComparison, type DetectionResult } from "@potholeproof/detector";
import type { GpsFix } from "@potholeproof/detector";
import { Badge, Card, ConfidenceBar, ScreenHeader, StatTile } from "../components/ui";
import { classify, colors, fontFamily, space } from "../theme";

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

function VerdictRow({
  label,
  icon,
  result,
}: {
  label: string;
  icon: "calculator-outline" | "hardware-chip-outline";
  result: DetectionResult;
}) {
  const pct = Math.round(result.confidence * 100);
  // Fixed mid-tier severity so the bar color reflects classification, not
  // this candidate's own severity reading — keeps the two rows comparable.
  const color = classify({ classification: result.classification, severity: 0.5 }).color;
  return (
    <View style={styles.verdictRow}>
      <View style={styles.verdictLabelWrap}>
        <Badge label={label} icon={icon} tone="neutral" />
      </View>
      <Text style={styles.verdictClass} numberOfLines={1}>
        {LABEL_DISPLAY[result.classification] ?? result.classification}
      </Text>
      <View style={styles.verdictBar}>
        <ConfidenceBar pct={result.confidence} color={color} animated={false} />
      </View>
      <Text style={styles.verdictPct}>{pct}%</Text>
    </View>
  );
}

function ComparisonCard({ item, index }: { item: ClassifierComparison; index: number }) {
  const f = item.features;
  return (
    <Card style={[styles.card, !item.agree && styles.cardDisagree]}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardIndex}>Candidate #{index + 1}</Text>
        <Badge
          label={item.agree ? "Agree" : "Disagree"}
          icon={item.agree ? "checkmark-circle" : "warning"}
          tone={item.agree ? "success" : "warning"}
        />
      </View>

      <VerdictRow label="Heuristic" icon="calculator-outline" result={item.heuristic} />
      <VerdictRow label="AI model" icon="hardware-chip-outline" result={item.model} />

      <View style={styles.featureGrid}>
        <FeatureCell label="peak-to-peak" value={f.peakToPeak.toFixed(2)} />
        <FeatureCell label="RMS" value={f.rms.toFixed(2)} />
        <FeatureCell label="max jerk" value={f.maxJerk.toFixed(0)} />
        <FeatureCell label="vert. dominance" value={f.verticalDominance.toFixed(2)} />
        <FeatureCell label="gyro RMS" value={f.gyroRms.toFixed(2)} />
        <FeatureCell label="speed" value={`${(item.fix.speedMps * 2.237).toFixed(0)} mph`} />
      </View>
    </Card>
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
      <View style={styles.headerWrap}>
        <ScreenHeader title="Heuristic vs AI Lab" onBack={onClose} />
      </View>
      <Text style={styles.subtitle}>
        The same synthetic drive, scored two ways: the hand-tuned rule thresholds vs. the trained
        model — same inputs, independent verdicts.
      </Text>

      <View style={styles.summaryRow}>
        <StatTile value={String(results.length)} label="candidates" size="sm" />
        <StatTile value={String(results.length - disagreeCount)} label="agree" size="sm" valueColor={colors.status.success} />
        <StatTile value={String(disagreeCount)} label="disagree" size="sm" valueColor={colors.status.warning} />
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
  screen: { flex: 1, backgroundColor: colors.neutral.bg, paddingTop: 56 },
  headerWrap: { paddingHorizontal: space.lg },
  subtitle: { fontFamily: fontFamily.body, fontSize: 13, color: colors.neutral.inkSoft, paddingHorizontal: space.lg, lineHeight: 18 },
  summaryRow: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, marginTop: space.md, marginBottom: space.sm },
  list: { flex: 1 },
  listContent: { paddingHorizontal: space.lg, paddingBottom: space.xxl },
  card: { marginTop: space.sm },
  cardDisagree: { borderWidth: 1.5, borderColor: colors.status.warning },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space.sm },
  cardIndex: { fontFamily: fontFamily.bodySemibold, fontSize: 12, color: colors.neutral.inkFaint },
  verdictRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm },
  verdictLabelWrap: { width: 96, flexShrink: 0 },
  verdictClass: { fontFamily: fontFamily.bodyBold, fontSize: 13, color: colors.neutral.ink, width: 78, flexShrink: 0 },
  verdictBar: { flex: 1, minWidth: 24 },
  verdictPct: { fontFamily: fontFamily.monoMedium, fontSize: 12, color: colors.neutral.inkSoft, width: 38, flexShrink: 0, textAlign: "right" },
  featureGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.neutral.bg, paddingTop: space.sm },
  featureCell: { width: "33.33%", marginBottom: 6 },
  featureValue: { fontFamily: fontFamily.monoMedium, fontSize: 13, color: colors.neutral.ink },
  featureLabel: { fontFamily: fontFamily.body, fontSize: 10, color: colors.neutral.inkFaint },
});
