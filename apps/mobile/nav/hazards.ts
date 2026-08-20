import type { HazardRecord, JoltEvent } from "@potholeproof/shared-types";

/**
 * Bridge this session's live detections into HazardRecords so route scoring
 * (services/routing) can penalise routes past potholes the phone has already
 * felt — e.g. the return leg of a drive, or a mid-drive reroute.
 *
 * These records are EPHEMERAL: built on demand from in-memory events, never
 * persisted, never sent anywhere. When crowd hazard tiles land (Phase-2),
 * they replace this as the scoring input.
 */
export function hazardsFromJolts(
  events: readonly JoltEvent[]
): HazardRecord[] {
  return events
    .filter((e) => e.classification === "pothole")
    .map((e) => ({
      id: e.id,
      h3Cell: `session-${e.id}`,
      location: e.location,
      severity: e.severity,
      severityBand:
        e.severity >= 0.67
          ? ("severe" as const)
          : e.severity >= 0.34
            ? ("moderate" as const)
            : ("minor" as const),
      confidence: e.confidence,
      status: "active" as const,
      firstSeen: e.capturedAt,
      lastConfirmed: e.capturedAt,
      passCount: 1,
      cleanPassCount: 0,
      modelVersion: e.modelVersion,
    }));
}
