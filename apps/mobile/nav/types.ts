import type { LatLng } from "@potholeproof/shared-types";

/** A single upcoming maneuver along a navigation route. */
export interface NavStep {
  /** Human instruction, e.g. "Turn left onto Valencia Street". */
  instruction: string;
  /** Where the maneuver happens. */
  location: LatLng;
  /** Route offset of the maneuver point, metres from the route start. */
  metersFromStart: number;
  /** Raw maneuver type from the routing engine ("arrive", "turn", …). */
  type: string;
}

/**
 * A drivable route as the app consumes it — engine-agnostic. Produced by the
 * routing adapter (OSRM for the pilot, Mapbox Directions per decision-log #1
 * once a token/dev-build lands); nothing outside the adapter sees engine
 * response shapes.
 */
export interface NavRoute {
  /** Full route geometry, ordered origin → destination. */
  path: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  /** Maneuvers ordered by metersFromStart; the last is always "arrive". */
  steps: NavStep[];
}
