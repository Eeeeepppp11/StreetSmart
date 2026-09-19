import type { HazardRecord, LatLng } from "@potholeproof/shared-types";
import { distanceMeters, offsetLocation } from "@potholeproof/geo";

/** Delay between passing a pothole and tapping "report" — the hazard is this
 *  many seconds behind the car when the tap lands. */
export const REPORT_LAG_S = 2.5;
/** Below this speed there's no meaningful "behind" and heading is noise. */
const MIN_BACKDATE_SPEED_MPS = 1.5;
/** Ignore manual reports made on a fix worse than this (metres). */
export const MAX_REPORT_ACCURACY_M = 35;
/** A hazard this close to the report point is treated as the same pothole. */
export const NEARBY_HAZARD_M = 30;

export interface ReportFix {
  location: LatLng;
  speedMps: number;
  /** Degrees clockwise from north, when known. */
  heading: number | null;
  /** Horizontal accuracy in metres, when the device reports it. */
  accuracy: number | null;
}

export function isFixGoodEnough(fix: ReportFix): boolean {
  return fix.accuracy === null || fix.accuracy <= MAX_REPORT_ACCURACY_M;
}

/** Where the hazard most likely was: the current fix, pushed back along the
 *  direction of travel by speed × the tap lag. */
export function backdateReportLocation(fix: ReportFix): LatLng {
  if (fix.heading === null || fix.speedMps < MIN_BACKDATE_SPEED_MPS) return fix.location;
  return offsetLocation(fix.location, (fix.heading + 180) % 360, fix.speedMps * REPORT_LAG_S);
}

/** Closest hazard within `maxM` of `at`, if any. */
export function nearestHazard(
  hazards: readonly HazardRecord[],
  at: LatLng,
  maxM: number = NEARBY_HAZARD_M
): HazardRecord | null {
  let best: HazardRecord | null = null;
  let bestD = maxM;
  for (const h of hazards) {
    const d = distanceMeters(h.location, at);
    if (d <= bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}
