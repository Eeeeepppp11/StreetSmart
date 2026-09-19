import type { HazardRecord, CivicReport } from "@potholeproof/shared-types";

export interface ReportingPolicy {
  /** Don't file a report below this confidence. */
  minConfidence: number;
  /** Don't file a report below this severity (0..1). */
  minSeverity: number;
}

export const DEFAULT_REPORTING_POLICY: ReportingPolicy = {
  minConfidence: 0.6,
  minSeverity: 0.34,
};

/**
 * Choose which hazards warrant a NEW civic report: active, confident, and
 * severe enough, and without an already-open report (dedup — one pothole should
 * not become many reports). A hazard whose previous report was closed/rejected
 * may be reported again if it has come back.
 */
export function hazardsToReport(
  hazards: readonly HazardRecord[],
  existingReports: readonly CivicReport[],
  policy: ReportingPolicy = DEFAULT_REPORTING_POLICY
): HazardRecord[] {
  const openReported = new Set(
    existingReports
      .filter((r) => r.status !== "closed" && r.status !== "rejected")
      .map((r) => r.hazardId)
  );
  return hazards.filter(
    (h) =>
      h.status === "active" &&
      h.confidence >= policy.minConfidence &&
      h.severity >= policy.minSeverity &&
      !openReported.has(h.id)
  );
}

/**
 * Auto fix-verification — the closed loop. When the hazard engine has retired a
 * reported hazard (enough clean drive-throughs ⇒ the pothole is gone), close its
 * still-open civic report, stamping `closedAt` when a timestamp is supplied.
 * Terminal reports are returned unchanged.
 */
export function reconcileReport(
  report: CivicReport,
  hazard: HazardRecord,
  closedAt?: string
): CivicReport {
  if (report.status === "closed" || report.status === "rejected") return report;
  if (hazard.status === "retired" || hazard.status === "verified_fixed") {
    const next: CivicReport = { ...report, status: "closed" };
    return closedAt !== undefined ? { ...next, closedAt } : next;
  }
  return report;
}

/**
 * Crowd-confirmation gate for the "report to city" affordance. Any hazard can
 * be confirmed by drivers; it only becomes fileable once enough *distinct*
 * drivers stand behind it, and severe hazards get a lower bar because they are
 * the ones worth escalating fastest.
 */
export interface CrowdReportingPolicy {
  /** Distinct confirming drivers needed for a non-severe hazard. */
  minConfirmers: number;
  /** Distinct confirming drivers needed for a severe-band hazard. */
  minConfirmersSevere: number;
  /** Still refuse below this confidence (heavy "not there" votes drag it down). */
  minConfidence: number;
}

export const DEFAULT_CROWD_REPORTING_POLICY: CrowdReportingPolicy = {
  minConfirmers: 3,
  minConfirmersSevere: 2,
  minConfidence: 0.6,
};

export function confirmersNeeded(
  hazard: HazardRecord,
  policy: CrowdReportingPolicy = DEFAULT_CROWD_REPORTING_POLICY
): number {
  return hazard.severityBand === "severe" ? policy.minConfirmersSevere : policy.minConfirmers;
}

/** True when an active, un-filed hazard has enough distinct confirmers to report to the city. */
export function isCrowdReportable(
  hazard: HazardRecord,
  confirmerCount: number,
  policy: CrowdReportingPolicy = DEFAULT_CROWD_REPORTING_POLICY
): boolean {
  return (
    hazard.status === "active" &&
    hazard.confidence >= policy.minConfidence &&
    confirmerCount >= confirmersNeeded(hazard, policy)
  );
}
