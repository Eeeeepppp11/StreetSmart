import type { LatLng } from "./geo.js";

export interface RoutePreferences {
  /** Enable the user-facing "avoid severe road damage" costing. */
  avoidSevereRoadDamage: boolean;
  /**
   * Relative weight on hazard exposure when avoidance is on.
   * 0 = ignore hazards, 1 = default balance, higher = detour harder to avoid damage.
   */
  hazardAvoidanceWeight?: number;
}

export interface RouteRequest {
  origin: LatLng;
  destination: LatLng;
  preferences: RoutePreferences;
}

export interface RouteLeg {
  /** Encoded polyline (or GeoJSON, per adapter) of the leg geometry. */
  geometry: string;
  distanceMeters: number;
  durationSeconds: number;
  /** Hazard exposure along this leg, 0..1 (lower is safer). */
  hazardExposureScore: number;
}

export interface RouteResponse {
  legs: RouteLeg[];
  distanceMeters: number;
  durationSeconds: number;
  /** Aggregate hazard exposure for the whole route, 0..1. */
  hazardExposureScore: number;
}

/**
 * Contract for a routing engine in `services/routing`. MVP adapter wraps
 * Mapbox Directions; a self-hosted Valhalla adapter with dynamic hazard
 * costing swaps in behind the same interface.
 */
export interface RoutingAdapter {
  route(request: RouteRequest): Promise<RouteResponse>;
}
