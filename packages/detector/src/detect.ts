import type {
  SensorSample,
  JoltEvent,
  LatLng,
  HeadingDegrees,
  ISODateString,
  Uuid,
} from "@potholeproof/shared-types";
import { extractFeatures } from "./features.js";
import { classify, type DetectionResult } from "./classify.js";
import type { DetectorConfig } from "./config.js";
import { DEFAULT_CONFIG } from "./config.js";
import { norm } from "./util.js";

/**
 * A GPS fix on the SAME monotonic clock as {@link SensorSample.t}. Carries the
 * wall-clock ISO time + location so emitted events are fully determined by the
 * recorded drive (no `Date.now()` in the pipeline → deterministic replay).
 */
export interface GpsFix {
  t: number;
  capturedAt: ISODateString;
  location: LatLng;
  speedMps: number;
  heading?: HeadingDegrees;
}

/** Injected side-effects so detection stays pure and deterministic. */
export interface PipelineDeps {
  nextId: () => Uuid;
  modelVersion: string;
}

function nearestFix(gps: GpsFix[], t: number): GpsFix | undefined {
  if (gps.length === 0) return undefined;
  let best = gps[0]!;
  let bestD = Math.abs(best.t - t);
  for (let i = 1; i < gps.length; i++) {
    const f = gps[i]!;
    const d = Math.abs(f.t - t);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

function buildEvent(
  fix: GpsFix,
  res: DetectionResult,
  deps: PipelineDeps
): JoltEvent {
  const base: JoltEvent = {
    id: deps.nextId(),
    capturedAt: fix.capturedAt,
    location: fix.location,
    speedMps: fix.speedMps,
    severity: res.severity,
    confidence: res.confidence,
    classification: res.classification,
    modelVersion: deps.modelVersion,
  };
  return fix.heading !== undefined ? { ...base, heading: fix.heading } : base;
}

/**
 * Batch detector: scans a recorded drive (samples + GPS fixes, both time-sorted
 * on the same clock) and returns the emitted {@link JoltEvent}s. This is the
 * deterministic core that both the replay harness and the on-device pipeline
 * run. Requires at least one GPS fix — without location a hazard can't be placed.
 */
export function runDetection(
  samples: SensorSample[],
  gps: GpsFix[],
  deps: PipelineDeps,
  config: DetectorConfig = DEFAULT_CONFIG
): JoltEvent[] {
  const n = samples.length;
  const events: JoltEvent[] = [];
  if (n < 5 || gps.length === 0) return events;

  // Running gravity estimate (EMA) → per-sample dynamic-acceleration magnitude.
  let g = { ...samples[0]!.accel };
  const alpha = 0.05;
  const dyn = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = samples[i]!.accel;
    g = {
      x: g.x + alpha * (a.x - g.x),
      y: g.y + alpha * (a.y - g.y),
      z: g.z + alpha * (a.z - g.z),
    };
    dyn[i] = norm({ x: a.x - g.x, y: a.y - g.y, z: a.z - g.z });
  }

  const firstT = samples[0]!.t;
  const lastT = samples[n - 1]!.t;
  const half = config.windowHalfMs;
  const exit = config.triggerAccel * 0.5; // hysteresis
  let lastEmitT = -Infinity;

  let i = 0;
  while (i < n) {
    if (dyn[i]! >= config.triggerAccel) {
      // Walk the run above the exit threshold; find its peak sample.
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
      if (ripe && peakT - lastEmitT >= config.refractoryMs) {
        const window: SensorSample[] = [];
        for (let k = 0; k < n; k++) {
          const tk = samples[k]!.t;
          if (tk >= peakT - half && tk <= peakT + half) window.push(samples[k]!);
        }
        if (window.length >= 5) {
          const f = extractFeatures(window);
          const fix = nearestFix(gps, peakT)!;
          const res = classify(f, fix.speedMps, config);
          if (
            res.classification !== "other" &&
            res.confidence >= config.minConfidence
          ) {
            events.push(buildEvent(fix, res, deps));
            lastEmitT = peakT;
          }
        }
      }
      i = j;
    } else {
      i++;
    }
  }
  return events;
}
