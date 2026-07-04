import type {
  HazardRecord,
  LatLng,
  HeadingDegrees,
} from "@potholeproof/shared-types";
import { distanceMeters, bearingDegrees } from "@potholeproof/geo";

/**
 * Tunables for the on-device proximity-alert engine. Alerts fire only for
 * hazards ahead of the vehicle, within its path corridor, and close enough to
 * react — the "pothole ahead in 200 ft, right lane" experience.
 */
export interface ProximityConfig {
  /** How many seconds ahead to look (× speed → lookahead distance). */
  leadSeconds: number;
  /** Floor on lookahead so slow/stopped vehicles still get a warning. */
  minLeadMeters: number;
  /** Hard cap on lookahead distance. */
  maxRangeMeters: number;
  /** Lateral tolerance from the heading line (roughly a lane or two). */
  corridorHalfWidthMeters: number;
  /** Ignore hazards below this confidence. */
  minConfidence: number;
  /** Ignore hazards below this severity (0..1). */
  minSeverity: number;
}

export const DEFAULT_PROXIMITY_CONFIG: ProximityConfig = {
  leadSeconds: 12,
  minLeadMeters: 60,
  maxRangeMeters: 500,
  corridorHalfWidthMeters: 12,
  minConfidence: 0.4,
  minSeverity: 0,
};

export interface VehicleState {
  position: LatLng;
  headingDegrees: HeadingDegrees;
  speedMps: number;
}

export type AlertSide = "ahead" | "left" | "right";

export interface ProximityAlert {
  hazard: HazardRecord;
  /** Straight-line distance to the hazard, metres. */
  distanceMeters: number;
  /** Distance ahead along the heading, metres (always > 0 for an alert). */
  alongTrackMeters: number;
  /** Lateral offset from the heading line, metres (+ = right, − = left). */
  crossTrackMeters: number;
  /** Seconds until reaching it at current speed (Infinity if stopped). */
  etaSeconds: number;
  side: AlertSide;
}

/** Smallest signed angle a→b, in degrees, within (−180, 180]. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/**
 * Return active hazards ahead of the vehicle and within its path, nearest
 * first. Pure and deterministic — this is what the client evaluates against its
 * cached hazard tiles every GPS tick, entirely on-device.
 */
export function upcomingHazards(
  vehicle: VehicleState,
  hazards: readonly HazardRecord[],
  config: ProximityConfig = DEFAULT_PROXIMITY_CONFIG
): ProximityAlert[] {
  const lookahead = Math.min(
    config.maxRangeMeters,
    Math.max(config.minLeadMeters, vehicle.speedMps * config.leadSeconds)
  );

  const alerts: ProximityAlert[] = [];
  for (const h of hazards) {
    if (h.status !== "active") continue;
    if (h.confidence < config.minConfidence) continue;
    if (h.severity < config.minSeverity) continue;

    const dist = distanceMeters(vehicle.position, h.location);
    if (dist > lookahead) continue;

    const delta = angleDiff(
      bearingDegrees(vehicle.position, h.location),
      vehicle.headingDegrees
    );
    const rad = (delta * Math.PI) / 180;
    const alongTrack = dist * Math.cos(rad);
    const crossTrack = dist * Math.sin(rad);

    if (alongTrack <= 0) continue; // behind us
    if (Math.abs(crossTrack) > config.corridorHalfWidthMeters) continue; // off our path

    const etaSeconds =
      vehicle.speedMps > 0.5 ? alongTrack / vehicle.speedMps : Infinity;
    const side: AlertSide =
      Math.abs(crossTrack) < 2 ? "ahead" : crossTrack > 0 ? "right" : "left";

    alerts.push({
      hazard: h,
      distanceMeters: dist,
      alongTrackMeters: alongTrack,
      crossTrackMeters: crossTrack,
      etaSeconds,
      side,
    });
  }

  alerts.sort((a, b) => a.alongTrackMeters - b.alongTrackMeters);
  return alerts;
}
