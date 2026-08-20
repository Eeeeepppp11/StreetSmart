import { distanceMeters } from "@potholeproof/geo";
import type { LatLng } from "@potholeproof/shared-types";
import type { NavRoute } from "./types.js";

/**
 * Pure turn-by-turn guidance math — no clocks, no I/O, no engine types.
 * The GPS callback feeds fixes in; NavProgress comes out.
 */

/** Consider the driver arrived within this range of the destination, metres. */
const ARRIVE_METERS = 30;

export interface NavProgress {
  /** Distance from the fix to the nearest point on the route, metres. */
  offRouteMeters: number;
  /** Progress along the route, metres from the start. */
  metersFromStart: number;
  metersRemaining: number;
  /** Index into route.steps of the next upcoming maneuver. */
  nextStepIndex: number;
  metersToNextManeuver: number;
  arrived: boolean;
}

/** Cumulative distance profile of a path: cum[i] = metres from start to point i. */
export function cumulativePathMeters(path: readonly LatLng[]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1]! + distanceMeters(path[i - 1]!, path[i]!));
  }
  return cum;
}

const M_PER_DEG_LAT = 111320;
function mPerDegLng(lat: number): number {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

/**
 * Project a fix onto the route: nearest point across all segments (local
 * planar approximation, same maths as services/routing's corridor test).
 */
function projectOntoPath(
  path: readonly LatLng[],
  cum: readonly number[],
  p: LatLng
): { offMeters: number; alongMeters: number } {
  let best = { offMeters: Infinity, alongMeters: 0 };
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const kx = mPerDegLng(a.lat);
    const bx = (b.lng - a.lng) * kx;
    const by = (b.lat - a.lat) * M_PER_DEG_LAT;
    const px = (p.lng - a.lng) * kx;
    const py = (p.lat - a.lat) * M_PER_DEG_LAT;
    const segLen2 = bx * bx + by * by;
    const t =
      segLen2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / segLen2)) : 0;
    const off = Math.hypot(px - t * bx, py - t * by);
    if (off < best.offMeters) {
      const segLen = cum[i + 1]! - cum[i]!;
      best = { offMeters: off, alongMeters: cum[i]! + t * segLen };
    }
  }
  return best;
}

/** Where the driver is relative to the route, and what comes next. */
export function routeProgress(
  route: NavRoute,
  cum: readonly number[],
  pos: LatLng
): NavProgress {
  const total = cum[cum.length - 1] ?? 0;
  const { offMeters, alongMeters } = projectOntoPath(route.path, cum, pos);
  const remaining = Math.max(0, total - alongMeters);

  // Next maneuver: first step still ahead of us (small grace so we don't
  // re-announce the one we're passing through).
  let nextStepIndex = route.steps.length - 1;
  for (let i = 0; i < route.steps.length; i++) {
    if (route.steps[i]!.metersFromStart > alongMeters + 8) {
      nextStepIndex = i;
      break;
    }
  }
  const metersToNextManeuver = Math.max(
    0,
    route.steps[nextStepIndex]!.metersFromStart - alongMeters
  );

  const destination = route.path[route.path.length - 1]!;
  const arrived =
    distanceMeters(pos, destination) <= ARRIVE_METERS ||
    (remaining <= ARRIVE_METERS && offMeters <= 40);

  return {
    offRouteMeters: offMeters,
    metersFromStart: alongMeters,
    metersRemaining: remaining,
    nextStepIndex,
    metersToNextManeuver,
    arrived,
  };
}

/** "450 ft" under ~1000 ft, otherwise "1.2 mi" — matches the app's mph HUD. */
export function formatDistanceImperial(meters: number): string {
  const feet = meters * 3.28084;
  if (feet < 1000) return `${Math.max(0, Math.round(feet / 10) * 10)} ft`;
  return `${(meters / 1609.34).toFixed(1)} mi`;
}
