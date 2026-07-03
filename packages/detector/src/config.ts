/**
 * Tunable parameters for the Phase-1 heuristic detector. These are deliberately
 * exposed as data: the whole point of Phase 1 is to collect labelled drives and
 * tune these thresholds (and later replace the heuristic entirely with an ML
 * model that emits the same {@link DetectionResult}).
 */
export interface DetectorConfig {
  /** |dynamic accel| (m/s^2) that flags a candidate jolt for windowed analysis. */
  triggerAccel: number;
  /** Half-window extracted either side of a candidate peak, milliseconds. */
  windowHalfMs: number;
  /** Minimum gap between two emitted events, milliseconds (de-bounces one strike). */
  refractoryMs: number;

  /** Reference speed for severity normalisation, m/s (~30 mph). */
  refSpeedMps: number;
  /** Speed is clamped into [min, max] before normalising (avoids divide-by-zero). */
  minSpeedMps: number;
  maxSpeedMps: number;

  /** Speed-normalised peak-to-peak (m/s^2) required to call a pothole. */
  potholePeak: number;
  /** Speed-normalised peak-to-peak required to call a speed bump. */
  bumpPeak: number;
  /** Vertical RMS (m/s^2) required to call sustained rough road. */
  roughRms: number;
  /** Minimum vertical jerk (m/s^3) — potholes are sharp, bumps are rounded. */
  minJerk: number;
  /** Minimum vertical-energy fraction — rejects cornering/braking. */
  minVerticalDominance: number;
  /** Max gyro RMS (rad/s) for a pothole — high sustained rotation ⇒ speed bump. */
  maxGyroRmsForPothole: number;

  /** Normalised-peak range mapped onto severity 0..1. */
  severityMin: number;
  severityMax: number;

  /** The heuristic never claims more confidence than this (it is not an ML model). */
  heuristicConfidenceCeiling: number;
  /** Events below this confidence are not emitted. */
  minConfidence: number;
}

/**
 * Starting thresholds, tuned against the synthetic signal generator in
 * `synth.ts`. Re-tune against real labelled pilot drives.
 */
export const DEFAULT_CONFIG: DetectorConfig = {
  triggerAccel: 3.0,
  windowHalfMs: 300,
  refractoryMs: 800,

  refSpeedMps: 13.4,
  minSpeedMps: 5,
  maxSpeedMps: 35,

  potholePeak: 6,
  bumpPeak: 3,
  roughRms: 1.2,
  minJerk: 300,
  minVerticalDominance: 0.55,
  maxGyroRmsForPothole: 0.35,

  severityMin: 4,
  severityMax: 30,

  heuristicConfidenceCeiling: 0.85,
  minConfidence: 0.3,
};
