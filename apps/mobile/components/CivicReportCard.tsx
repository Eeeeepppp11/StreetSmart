import type { ComponentProps, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CIVIC_STATUS_LABEL } from "@potholeproof/civic";
import type { CivicReportStatus } from "@potholeproof/shared-types";
import type { CivicReportDoc } from "../civicMock";
import { Badge, Card } from "./ui";
import { FullPhoto } from "./FullPhoto";
import { colors, fontFamily, space } from "../theme";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

const STATUS_PRESENTATION: Record<
  CivicReportStatus,
  { tone: "neutral" | "success" | "warning" | "danger" | "info"; icon: IoniconName }
> = {
  draft: { tone: "neutral", icon: "create-outline" },
  submitted: { tone: "warning", icon: "hourglass-outline" },
  acknowledged: { tone: "info", icon: "mail-open-outline" },
  in_progress: { tone: "info", icon: "construct-outline" },
  closed: { tone: "success", icon: "checkmark-circle-outline" },
  rejected: { tone: "danger", icon: "close-circle-outline" },
};

export function CivicStatusBadge({ status }: { status: CivicReportStatus }) {
  const p = STATUS_PRESENTATION[status];
  return <Badge label={CIVIC_STATUS_LABEL[status]} tone={p.tone} icon={p.icon} />;
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

interface CivicReportCardProps {
  report: CivicReportDoc;
  /** Shown above the timeline, e.g. "Verified fixed by drivers". */
  banner?: string;
  /** Show who filed it (the city-review queue). */
  showFiler?: boolean;
  /** Controls under the timeline (the city's action buttons). */
  children?: ReactNode;
}

/** One city report: what/where, its evidence, and its status timeline. */
export function CivicReportCard({ report, banner, showFiler, children }: CivicReportCardProps) {
  const history = report.history ?? [{ status: report.status, at: report.submittedAt }];
  const title = report.address ?? (report.kind === "rough_road" ? "Rough road" : "Pothole");
  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <CivicStatusBadge status={report.status} />
      </View>
      <Text style={styles.meta}>
        Filed {fmt(report.submittedAt)}
        {report.confirmerCount ? ` · ${report.confirmerCount} driver${report.confirmerCount === 1 ? "" : "s"} confirmed` : ""}
        {report.filings && report.filings > 1 ? ` · filing #${report.filings}` : ""}
        {report.editedAt ? " · edited" : ""}
      </Text>
      {showFiler && (
        <Text style={styles.meta}>By {report.filedByName ?? report.filedByUid.slice(0, 6)}</Text>
      )}
      {banner && <Text style={styles.banner}>{banner}</Text>}
      {report.notes ? <Text style={styles.notes}>“{report.notes}”</Text> : null}
      {report.photoUrl ? <FullPhoto uri={report.photoUrl} style={styles.photo} /> : null}

      <View style={styles.timeline}>
        {history.map((e, i) => (
          <View key={`${e.status}-${e.at}-${i}`} style={styles.timelineRow}>
            <View style={styles.dot} />
            <View style={styles.timelineText}>
              <Text style={styles.timelineStatus}>{CIVIC_STATUS_LABEL[e.status]}</Text>
              <Text style={styles.timelineMeta}>
                {fmt(e.at)}
                {e.by ? ` · ${e.by}` : ""}
              </Text>
              {e.note ? <Text style={styles.timelineNote}>{e.note}</Text> : null}
            </View>
          </View>
        ))}
      </View>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space.md },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.sm },
  title: { flex: 1, fontFamily: fontFamily.bodyBold, fontSize: 15, color: colors.neutral.ink },
  meta: { fontFamily: fontFamily.body, fontSize: 12, color: colors.neutral.inkSoft, marginTop: 4 },
  banner: {
    fontFamily: fontFamily.bodySemibold,
    fontSize: 12,
    color: colors.status.success,
    marginTop: space.sm,
  },
  notes: {
    fontFamily: fontFamily.body,
    fontSize: 13,
    fontStyle: "italic",
    color: colors.neutral.ink,
    marginTop: space.sm,
  },
  photo: { marginTop: space.sm },
  timeline: { marginTop: space.md, gap: space.sm },
  timelineRow: { flexDirection: "row", gap: space.sm },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand.primary,
    marginTop: 5,
  },
  timelineText: { flex: 1 },
  timelineStatus: { fontFamily: fontFamily.bodySemibold, fontSize: 13, color: colors.neutral.ink },
  timelineMeta: { fontFamily: fontFamily.body, fontSize: 11, color: colors.neutral.inkFaint },
  timelineNote: { fontFamily: fontFamily.body, fontSize: 12, color: colors.neutral.inkSoft, marginTop: 2 },
});
