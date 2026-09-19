import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { isOpenStatus, nextCityStatuses } from "@potholeproof/civic";
import type { CivicReportStatus } from "@potholeproof/shared-types";
import { advanceCivicReport, subscribeToAllCivicReports, type CivicReportDoc } from "../civicMock";
import { CivicReportCard } from "../components/CivicReportCard";
import { Button, EmptyState, ScreenHeader, SegmentedControl } from "../components/ui";
import { colors, fontFamily, radii, space } from "../theme";

interface CityReviewScreenProps {
  reviewer: string;
  onClose: () => void;
}

const ACTION_LABEL: Partial<Record<CivicReportStatus, { label: string; variant: "primary" | "outline" | "danger" }>> = {
  acknowledged: { label: "Acknowledge", variant: "outline" },
  in_progress: { label: "Start work", variant: "outline" },
  closed: { label: "Mark complete", variant: "primary" },
  rejected: { label: "Reject", variant: "danger" },
};

type Filter = "open" | "all";

/**
 * The city's side of the loop, until a real Open311 integration replaces it:
 * a reviewer (admin) acknowledges, works, completes or rejects each report.
 * Firestore rules restrict these writes to admins.
 */
export default function CityReviewScreen({ reviewer, onClose }: CityReviewScreenProps) {
  const [reports, setReports] = useState<CivicReportDoc[]>([]);
  const [filter, setFilter] = useState<Filter>("open");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => subscribeToAllCivicReports(setReports), []);

  const shown = useMemo(() => {
    const list = filter === "open" ? reports.filter((r) => isOpenStatus(r.status)) : reports;
    // Oldest open first (they've waited longest); closed/rejected newest first.
    return [...list].sort((a, b) => {
      const ao = isOpenStatus(a.status);
      const bo = isOpenStatus(b.status);
      if (ao !== bo) return ao ? -1 : 1;
      const d = Date.parse(a.submittedAt) - Date.parse(b.submittedAt);
      return ao ? d : -d;
    });
  }, [reports, filter]);

  const openCount = reports.filter((r) => isOpenStatus(r.status)).length;

  async function move(report: CivicReportDoc, next: CivicReportStatus) {
    setBusyId(report.id);
    try {
      await advanceCivicReport(report, next, notes[report.id] ?? "", reviewer);
      setNotes((n) => ({ ...n, [report.id]: "" }));
    } catch (e) {
      const denied = (e as { code?: string }).code === "permission-denied";
      Alert.alert(
        "Couldn't update the report",
        denied
          ? "Firestore rejected the change. Only admins can move a report — check that your email is in isAdmin() in the published rules."
          : "Please try again."
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.headerWrap}>
        <ScreenHeader title="City review" onBack={onClose} />
        <SegmentedControl
          options={[
            { value: "open", label: `Open (${openCount})` },
            { value: "all", label: `All (${reports.length})` },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {shown.length === 0 && (
          <EmptyState
            icon="checkmark-done-outline"
            title={filter === "open" ? "Nothing waiting" : "No reports yet"}
            message="Reports filed by drivers show up here for review."
            tone="success"
          />
        )}
        {shown.map((r) => {
          const next = nextCityStatuses(r.status);
          return (
            <CivicReportCard key={r.id} report={r} showFiler>
              {r.description ? <Text style={styles.description}>{r.description}</Text> : null}
              {next.length > 0 && (
                <View>
                  <TextInput
                    style={styles.noteInput}
                    value={notes[r.id] ?? ""}
                    onChangeText={(t) => setNotes((n) => ({ ...n, [r.id]: t }))}
                    placeholder="Note for the reporter (optional)"
                    placeholderTextColor={colors.neutral.inkFaint}
                  />
                  <View style={styles.actions}>
                    {next.map((s) => {
                      const a = ACTION_LABEL[s];
                      if (!a) return null;
                      return (
                        <Button
                          key={s}
                          label={a.label}
                          variant={a.variant}
                          size="sm"
                          disabled={busyId !== null}
                          loading={busyId === r.id}
                          onPress={() => void move(r, s)}
                          style={styles.actionBtn}
                        />
                      );
                    })}
                  </View>
                </View>
              )}
            </CivicReportCard>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.bg, paddingTop: 56 },
  headerWrap: { paddingHorizontal: space.lg, gap: space.md },
  content: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xxl },
  description: {
    fontFamily: fontFamily.body,
    fontSize: 12,
    color: colors.neutral.inkSoft,
    marginTop: space.md,
    lineHeight: 17,
  },
  noteInput: {
    marginTop: space.md,
    borderWidth: 1,
    borderColor: colors.neutral.border,
    borderRadius: radii.sm,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontFamily: fontFamily.body,
    fontSize: 14,
    color: colors.neutral.ink,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
  actionBtn: { flexGrow: 1 },
});
