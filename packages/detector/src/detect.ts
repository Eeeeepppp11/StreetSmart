import type {
  SensorSample,
  JoltEvent,
  LatLng,
  HeadingDegrees,
  ISODateString,
  Uuid,
} from "@potholeproof/shared-types";
import { extractFeatures, type JoltFeatures } from "./features.js";
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
  /** Swaps the classification step — defaults to the Phase-1 heuristic ({@link classify}) if omitted. */
  classify?: (
    features: JoltFeatures,
    speedMps: number,
    config: DetectorConfig
  ) => DetectionResult;
}

/** Nearest GPS fix to a given time (used to locate an event). */
export function nearestFix(gps: GpsFix[], t: number): GpsFix | undefined {
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
 * Evaluate the window around a candidate peak and return a JoltEvent, or null if
 * the window is incomplete, unlocatable, or classifies as a non-event. Shared by
 * the batch scanner and the streaming pipeline so both make identical decisions.
 */
export function emitForPeak(
  samples: SensorSample[],
  gps: GpsFix[],
  peakT: number,
  deps: PipelineDeps,
  config: DetectorConfig = DEFAULT_CONFIG
): JoltEvent | null {
  const half = config.windowHalfMs;
  const window: SensorSample[] = [];
  for (const s of samples) {
    if (s.t >= peakT - half && s.t <= peakT + half) window.push(s);
  }
  if (window.length < 5) return null;
  // Require the window to actually straddle the peak on both sides.
  const lo = window[0]!.t;
  const hi = window[window.length - 1]!.t;
  if (peakT - lo < half * 0.5 || hi - peakT < half * 0.5) return null;

  const fix = nearestFix(gps, peakT);
  if (!fix) return null;
  if (fix.speedMps < config.minEmitSpeedMps) return null; // parked/hand-held
  const classifier = deps.classify ?? classify;
  const res = classifier(extractFeatures(window), fix.speedMps, config);
  if (res.classification === "other" || res.confidence < config.minConfidence) {
    return null;
  }
  return buildEvent(fix, res, deps);
}

/** Per-sample dynamic-acceleration magnitude via a running gravity EMA. */
export function dynamicSeries(samples: SensorSample[], alpha = 0.05): number[] {
  const n = samples.length;
  const dyn = new Array<number>(n);
  if (n === 0) return dyn;
  let g = { ...samples[0]!.accel };
  for (let i = 0; i < n; i++) {
    const a = samples[i]!.accel;
    g = {
      x: g.x + alpha * (a.x - g.x),
      y: g.y + alpha * (a.y - g.y),
      z: g.z + alpha * (a.z - g.z),
    };
    dyn[i] = norm({ x: a.x - g.x, y: a.y - g.y, z: a.z - g.z });
  }
  return dyn;
}

/**
 * Batch detector: scans a recorded drive (samples + GPS fixes, both time-sorted
 * on the same clock) and returns the emitted {@link JoltEvent}s. Deterministic;
 * requires at least one GPS fix — without location a hazard can't be placed.
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

  const dyn = dynamicSeries(samples);
  const firstT = samples[0]!.t;
  const lastT = samples[n - 1]!.t;
  const half = config.windowHalfMs;
  const exit = config.triggerAccel * 0.5; // hysteresis
  let lastEmitT = -Infinity;

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
      if (ripe && peakT - lastEmitT >= config.refractoryMs) {
        const ev = emitForPeak(samples, gps, peakT, deps, config);
        if (ev) {
          events.push(ev);
          lastEmitT = peakT;
        }
      }
      i = j;
    } else {
      i++;
    }
  }
  return events;
}
