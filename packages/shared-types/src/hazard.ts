import type { LatLng, H3Index } from "./geo.js";
import type { ISODateString, Uuid } from "./common.js";

export type HazardStatus =
  | "active" // confirmed, above the confidence threshold
  | "retired" // decayed below threshold / self-healed
  | "reported" // submitted to a civic backend
  | "verified_fixed"; // drive-through re-confirmation cleared a reported hazard

export type HazardSeverityBand = "minor" | "moderate" | "severe";

/**
 * Server-side, confidence-scored hazard — the system of record behind the
 * self-healing map. Confidence rises on repeated detection and decays on
 * clean passes; scheduled decay auto-retires stale hazards with no manual
 * moderation.
 */
export interface HazardRecord {
  id: Uuid;
  h3Cell: H3Index;
  location: LatLng;
  /** Aggregate severity, 0..1. */
  severity: number;
  severityBand: HazardSeverityBand;
  /** Aggregate confidence, 0..1. */
  confidence: number;
  status: HazardStatus;
  firstSeen: ISODateString;
  lastConfirmed: ISODateString;
  /** Vehicles that detected a jolt at this cell. */
  passCount: number;
  /** Vehicles that traversed the cell WITHOUT a jolt (evidence of a fix). */
  cleanPassCount: number;
  /** Linked civic report, once one has been submitted. */
  reportId?: Uuid;
  modelVersion: string;
}

/**
 * A cacheable bundle of hazards for a region, served to clients so proximity
 * alerts can run offline against local data.
 */
export interface HazardTile {
  /** Parent/coarse H3 cell used as the tile key. */
  h3Cell: H3Index;
  hazards: HazardRecord[];
  generatedAt: ISODateString;
  /** Suggested client cache lifetime, seconds. */
  ttlSeconds: number;
}
