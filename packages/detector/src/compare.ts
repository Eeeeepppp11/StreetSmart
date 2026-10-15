import type { SensorSample } from "@potholeproof/shared-types";
import { extractFeatures, type JoltFeatures } from "./features.js";
import { classify, type DetectionResult } from "./classify.js";
import type { DetectorConfig } from "./config.js";
import { DEFAULT_CONFIG } from "./config.js";
import { dynamicSeries, nearestFix, type GpsFix } from "./detect.js";
import { classifyWithModel } from "./model.js";

/**
 * One candidate jolt window scored by BOTH classifiers side by side. Built
 * for the in-app "heuristic vs AI" comparison lab — deliberately separate
 * from {@link emitForPeak}/{@link runDetection} (the live pipeline) so this
 * never risks changing what real drives detect. Unlike the live pipeline,
 * candidates aren't dropped for low confidence or an "other" verdict — those
 * are exactly the interesting disagreement cases this tool exists to show.
 */
export interface ClassifierComparison {
  peakT: number;
  fix: GpsFix;
  features: JoltFeatures;
  heuristic: DetectionResult;
  model: DetectionResult;
  agree: boolean;
}

/**
 * Scans a recorded (or demo) drive exactly like {@link runDetection}'s
 * peak-finding pass, but instead of emitting one classifier's verdict as a
 * JoltEvent, runs the heuristic and the trained model against the same
 * extracted features and returns both.
 */
export function compareClassifiers(
  samples: SensorSample[],
  gps: GpsFix[],
  config: DetectorConfig = DEFAULT_CONFIG
): ClassifierComparison[] {
  const n = samples.length;
  const out: ClassifierComparison[] = [];
  if (n < 5 || gps.length === 0) return out;

  const dyn = dynamicSeries(samples);
  const firstT = samples[0]!.t;
  const lastT = samples[n - 1]!.t;
  const half = config.windowHalfMs;
  const exit = config.triggerAccel * 0.5;
  let lastPeakT = -Infinity;

  let i = 0;
  while (i < n) {
    if (dyn[i]! >= config.triggerAccel) {
      let j = i;
      let peakIdx = i;
      let peakVal = dyn[i]!;
      while (j < n && dyn[j]! >= exit) {
        if (dyn[j]! > peakVal) {
          peakVal = dyn[j]!;
          peakIdx = j;
        }
        j++;
      }
      const peakT = samples[peakIdx]!.t;
      const ripe = peakT - half >= firstT && peakT + half <= lastT;
      if (ripe && peakT - lastPeakT >= config.refractoryMs) {
        const window = samples.filter((s) => s.t >= peakT - half && s.t <= peakT + half);
        const fix = nearestFix(gps, peakT);
        if (window.length >= 5 && fix && fix.speedMps >= config.minEmitSpeedMps) {
          const features = extractFeatures(window);
          const heuristic = classify(features, fix.speedMps, config);
          const model = classifyWithModel(features, fix.speedMps, config);
          out.push({
            peakT,
            fix,
            features,
            heuristic,
            model,
            agree: heuristic.classification === model.classification,
          });
        }
        lastPeakT = peakT;
      }
      i = j;
    } else {
      i++;
    }
  }
  return out;
}
