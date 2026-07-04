import type { LatLng, HeadingDegrees } from "./geo.js";
import type { ISODateString, Uuid } from "./common.js";

/** A tri-axial vector (device frame). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A single raw sensor reading (accelerometer m/s^2, gyroscope rad/s).
 * Raw sample streams stay ON DEVICE — they are never uploaded. Only the
 * classified {@link JoltEvent} leaves the phone.
 */
export interface SensorSample {
  /** Monotonic device timestamp, milliseconds. */
  t: number;
  accel: Vec3;
  gyro: Vec3;
}

/** What the on-device detector decided a candidate jolt actually was. */
export type JoltClassification =
  | "pothole"
  | "speed_bump"
  | "rough_road"
  | "other";

/**
 * A classified road-surface event produced on-device by the heuristic
 * detector (Phase 1) or the ML model (Phase 2+). This is the unit that is
 * persisted locally and, opt-in, synced to the backend.
 */
export interface JoltEvent {
  id: Uuid;
  capturedAt: ISODateString;
  location: LatLng;
  heading?: HeadingDegrees;
  /** Vehicle speed at capture, metres per second — used to normalise severity. */
  speedMps: number;
  /** Speed-normalised severity, 0..1. */
  severity: number;
  /** Detector confidence, 0..1. */
  confidence: number;
  classification: JoltClassification;
  /** Version of the model/heuristic that produced this event (for attribution + rollback). */
  modelVersion: string;
}

/**
 * A contiguous drive. Drives are the unit over which "clean passes" are
 * derived: traversing a known hazard cell without a jolt is evidence a fix
 * happened, feeding the self-heal engine.
 */
export interface DriveSession {
  id: Uuid;
  startedAt: ISODateString;
  endedAt?: ISODateString;
  distanceMeters: number;
  /** Rotating, anonymous device/session id — never a stable user identifier. */
  anonDeviceId: string;
}
