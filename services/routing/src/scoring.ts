import type {
  HazardRecord,
  LatLng,
  RoutePreferences,
} from "@potholeproof/shared-types";
import { distanceMeters } from "@potholeproof/geo";

/** Tunables for hazard-aware route scoring. */
export interface ScoringConfig {
  /** A hazard within this distance of the path contributes to exposure, metres. */
  corridorMeters: number;
  /** Saturation scale mapping summed weighted-severity → exposure in (0,1). */
  exposureScale: number;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  corridorMeters: 15,
  exposureScale: 3,
};

export interface RouteScore {
  distanceMeters: number;
  /** Aggregate hazard exposure along the route, 0..1 (higher = worse). */
  hazardExposureScore: number;
  /** Blended cost the router minimises (distance penalised by exposure). */
  cost: number;
}

const M_PER_DEG_LAT = 111320;
function mPerDegLng(lat: number): number {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

/** Shortest distance from point `p` to segment `a`–`b`, metres (local planar approx). */
export function pointToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const kx = mPerDegLng(a.lat);
  const bx = (b.lng - a.lng) * kx;
  const by = (b.lat - a.lat) * M_PER_DEG_LAT;
  const px = (p.lng - a.lng) * kx;
  const py = (p.lat - a.lat) * M_PER_DEG_LAT;
  const segLen2 = bx * bx + by * by;
  const t = segLen2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / segLen2)) : 0;
  const cx = t * bx;
  const cy = t * by;
  return Math.hypot(px - cx, py - cy);
}

/** Total length of a polyline path, metres. */
export function pathLengthMeters(path: readonly LatLng[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += distanceMeters(path[i]!, path[i + 1]!);
  }
  return total;
}

/**
 * Hazard exposure of a route, 0..1. Each active hazard within the corridor
 * contributes `severity × confidence × linear-falloff(distance)`; the summed
 * contributions saturate through `1 − e^(−sum/scale)` so the score is bounded.
 */
export function routeHazardExposure(
  path: readonly LatLng[],
  hazards: readonly HazardRecord[],
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): number {
  if (path.length < 2) return 0;
  let total = 0;
  for (const h of hazards) {
    if (h.status !== "active") continue;
    let minD = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
      const d = pointToSegmentMeters(h.location, path[i]!, path[i + 1]!);
      if (d < minD) minD = d;
    }
    if (minD <= config.corridorMeters) {
      const falloff = 1 - minD / config.corridorMeters;
      total += h.severity * h.confidence * falloff;
    }
  }
  return 1 - Math.exp(-total / config.exposureScale);
}

/** Score a single candidate route under the user's preferences. */
export function scoreRoute(
  path: readonly LatLng[],
  hazards: readonly HazardRecord[],
  preferences: RoutePreferences,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): RouteScore {
  const distance = pathLengthMeters(path);
  const exposure = routeHazardExposure(path, hazards, config);
  const weight = preferences.avoidSevereRoadDamage
    ? preferences.hazardAvoidanceWeight ?? 1
    : 0;
  return {
    distanceMeters: distance,
    hazardExposureScore: exposure,
    cost: distance * (1 + weight * exposure),
  };
}

/**
 * Pick the best route among candidates (lowest blended cost). With
 * `avoidSevereRoadDamage` off this is just the shortest; with it on, hazardous
 * routes are penalised in proportion to `hazardAvoidanceWeight`.
 */
export function chooseRoute(
  routes: readonly (readonly LatLng[])[],
  hazards: readonly HazardRecord[],
  preferences: RoutePreferences,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): { index: number; scores: RouteScore[] } {
  const scores = routes.map((r) => scoreRoute(r, hazards, preferences, config));
  let index = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i]!.cost < scores[index]!.cost) index = i;
  }
  return { index, scores };
}
