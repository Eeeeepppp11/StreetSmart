import type { LatLng } from "@potholeproof/shared-types";
import { distanceMeters } from "@potholeproof/geo";

/** Anything carrying a location — GPS fixes, jolt events, trace points. */
export interface Located {
  location: LatLng;
}

/**
 * Privacy by construction: trim the ends of a drive trace so trip endpoints
 * (home, work) never leave the device. Points within `trimMeters` of the
 * start or end of the path — measured **along the path**, not straight-line —
 * are dropped. A trace shorter than the two trim zones combined vanishes
 * entirely (a short trip reveals both endpoints; safest is to keep none of it).
 */
export function trimTraceEndpoints<T extends Located>(
  points: readonly T[],
  trimMeters: number
): T[] {
  if (trimMeters <= 0) return [...points];
  const n = points.length;
  if (n === 0) return [];

  // Cumulative along-path distance from the start.
  const cum = new Array<number>(n);
  cum[0] = 0;
  for (let i = 1; i < n; i++) {
    cum[i] =
      cum[i - 1]! + distanceMeters(points[i - 1]!.location, points[i]!.location);
  }
  const total = cum[n - 1]!;
  if (total <= 2 * trimMeters) return [];

  return points.filter(
    (_, i) => cum[i]! >= trimMeters && total - cum[i]! >= trimMeters
  );
}

/**
 * k-anonymity gate for aggregate exports: a group of records is releasable
 * only when it aggregates at least `k` distinct contributors.
 */
export function meetsKAnonymity(
  contributorIds: readonly string[],
  k: number
): boolean {
  return new Set(contributorIds).size >= k;
}
