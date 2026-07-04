import type { JoltClassification } from "@potholeproof/shared-types";
import type { JoltFeatures } from "./features.js";
import type { DetectorConfig } from "./config.js";
import { DEFAULT_CONFIG } from "./config.js";
import { clamp01 } from "./util.js";

export interface DetectionResult {
  classification: JoltClassification;
  /** Speed-normalised peak-to-peak used for scoring, m/s^2. */
  normalizedPeak: number;
  /** Severity 0..1. */
  severity: number;
  /** Confidence 0..1. */
  confidence: number;
}

function scoreConfidence(
  f: JoltFeatures,
  normalizedPeak: number,
  c: DetectorConfig
): number {
  const peakScore = clamp01(
    (normalizedPeak - c.potholePeak) / (c.severityMax - c.potholePeak)
  );
  const jerkScore = clamp01((f.maxJerk - c.minJerk) / (c.minJerk * 3));
  const vertScore = clamp01(
    (f.verticalDominance - c.minVerticalDominance) /
      (1 - c.minVerticalDominance)
  );
  const rotScore = clamp01(1 - f.gyroRms / c.maxGyroRmsForPothole);
  const raw =
    0.4 * peakScore + 0.25 * jerkScore + 0.2 * vertScore + 0.15 * rotScore;
  return Math.min(c.heuristicConfidenceCeiling, 0.5 + 0.5 * raw);
}

/**
 * Phase-1 heuristic classifier. Turns a window's {@link JoltFeatures} + the
 * vehicle speed into a {@link DetectionResult}. Speed-normalises severity so the
 * same pothole scores similarly at 20 and 50 mph, and uses jerk / vertical
 * dominance / gyro rotation to separate potholes from speed bumps, cornering,
 * and rough pavement.
 */
export function classify(
  features: JoltFeatures,
  speedMps: number,
  config: DetectorConfig = DEFAULT_CONFIG
): DetectionResult {
  const clampedSpeed = Math.min(
    Math.max(speedMps, config.minSpeedMps),
    config.maxSpeedMps
  );
  const speedScale = config.refSpeedMps / clampedSpeed;
  const normalizedPeak = features.peakToPeak * speedScale;

  const severity = clamp01(
    (normalizedPeak - config.severityMin) /
      (config.severityMax - config.severityMin)
  );

  const isSharp = features.maxJerk >= config.minJerk;
  const isVertical = features.verticalDominance >= config.minVerticalDominance;
  const lowRotation = features.gyroRms <= config.maxGyroRmsForPothole;

  let classification: JoltClassification;
  let confidence: number;

  if (
    normalizedPeak >= config.potholePeak &&
    isSharp &&
    isVertical &&
    lowRotation
  ) {
    classification = "pothole";
    confidence = scoreConfidence(features, normalizedPeak, config);
  } else if (normalizedPeak >= config.bumpPeak && !lowRotation) {
    classification = "speed_bump";
    confidence = Math.min(
      config.heuristicConfidenceCeiling,
      0.5 + 0.3 * severity
    );
  } else if (features.rms >= config.roughRms) {
    classification = "rough_road";
    confidence = Math.min(
      config.heuristicConfidenceCeiling,
      0.4 + 0.2 * severity
    );
  } else {
    classification = "other";
    confidence = 0.2;
  }

  return { classification, normalizedPeak, severity, confidence };
}
