import type {
  CivicReport,
  HazardRecord,
  LatLng,
} from "@potholeproof/shared-types";
import type { HazardContribution } from "@potholeproof/analytics";

/**
 * Deterministic DEMO dataset — stands in for the live hazard/report store until
 * the HTTP backend exists. Shaped like real engine output so the page exercises
 * the actual aggregation code paths.
 */

export const AS_OF = "2026-07-04T12:00:00.000Z";

/** Simple demo district mapper over SF-ish latitudes. */
export function districtOf(loc: LatLng): string {
  if (loc.lat >= 37.79) return "Marina / North Beach";
  if (loc.lat >= 37.77) return "SoMa / Mission Bay";
  if (loc.lat >= 37.75) return "Mission / Castro";
  return "Sunset / Excelsior";
}

export function tileOf(loc: LatLng): string {
  return `tile-${Math.round(loc.lat * 100)}`;
}

/** Which city a hazard belongs to — a jurisdiction lookup in production.
 *  Covers both this demo dataset's SF rows and the mobile app's actual
 *  Bellevue, WA demo-drive location, so the priority queue shows a real
 *  multi-city ranking rather than one city's cells sorted alphabetically. */
export function cityOf(loc: LatLng): string {
  if (loc.lat >= 47.55 && loc.lat <= 47.68) return "Bellevue, WA";
  return "San Francisco, CA";
}

function hazard(
  id: string,
  lat: number,
  severity: number,
  status: HazardRecord["status"],
  lastConfirmed: string,
  lng = -122.42
): HazardRecord {
  return {
    id,
    h3Cell: `cell-${id}`,
    location: { lat, lng },
    severity,
    severityBand: severity >= 0.67 ? "severe" : severity >= 0.34 ? "moderate" : "minor",
    confidence: 0.85,
    status,
    firstSeen: "2026-06-01T08:00:00.000Z",
    lastConfirmed,
    passCount: 6,
    cleanPassCount: status === "retired" || status === "verified_fixed" ? 4 : 0,
    modelVersion: "heuristic-v0",
  };
}

export const HAZARDS: HazardRecord[] = [
  hazard("h1", 37.795, 0.9, "reported", "2026-07-03T09:00:00.000Z"),
  hazard("h2", 37.796, 0.55, "reported", "2026-07-02T18:00:00.000Z"),
  hazard("h3", 37.775, 0.8, "reported", "2026-07-04T07:30:00.000Z"),
  hazard("h4", 37.776, 0.4, "verified_fixed", "2026-06-20T10:00:00.000Z"),
  hazard("h5", 37.755, 0.7, "reported", "2026-06-28T12:00:00.000Z"),
  hazard("h6", 37.756, 0.35, "verified_fixed", "2026-06-25T15:00:00.000Z"),
  hazard("h7", 37.74, 0.85, "reported", "2026-07-01T08:00:00.000Z"),
  hazard("h8", 37.741, 0.6, "active", "2026-07-03T20:00:00.000Z"),
  hazard("h9", 47.61, 0.95, "reported", "2026-07-04T06:00:00.000Z", -122.173),
  hazard("h10", 47.611, 0.5, "active", "2026-07-03T14:00:00.000Z", -122.174),
  hazard("h11", 47.62, 0.75, "reported", "2026-07-02T09:00:00.000Z", -122.17),
  hazard("h12", 47.621, 0.3, "verified_fixed", "2026-06-22T11:00:00.000Z", -122.171),
];

function report(
  hazardId: string,
  status: CivicReport["status"],
  submittedAt: string,
  closedAt?: string
): CivicReport {
  const base: CivicReport = {
    id: `r-${hazardId}`,
    hazardId,
    provider: "open311",
    status,
    submittedAt,
  };
  return closedAt ? { ...base, closedAt } : base;
}

export const REPORTS: CivicReport[] = [
  report("h1", "in_progress", "2026-06-25T09:00:00.000Z"),
  report("h2", "submitted", "2026-07-02T19:00:00.000Z"),
  report("h3", "acknowledged", "2026-07-01T10:00:00.000Z"),
  report("h4", "closed", "2026-06-05T09:00:00.000Z", "2026-06-20T10:00:00.000Z"),
  report("h5", "submitted", "2026-06-15T09:00:00.000Z"),
  report("h6", "closed", "2026-06-10T09:00:00.000Z", "2026-06-25T15:00:00.000Z"),
  report("h7", "submitted", "2026-07-01T09:00:00.000Z"),
  report("h9", "submitted", "2026-06-20T09:00:00.000Z"),
  report("h11", "acknowledged", "2026-06-28T09:00:00.000Z"),
  report("h12", "closed", "2026-06-08T09:00:00.000Z", "2026-06-22T11:00:00.000Z"),
];

export const CONTRIBUTIONS: HazardContribution[] = HAZARDS.flatMap((h, i) =>
  ["a", "b", "c", "d"].slice(0, 3 + (i % 2)).map((d) => ({
    hazardId: h.id,
    anonDeviceId: `anon-${d}${i % 3}`,
  }))
);
