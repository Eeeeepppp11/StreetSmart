import type { LatLng } from "@potholeproof/shared-types";
import type { GpsFix } from "./detect.js";
import type { RecordedDrive } from "./replay.js";
import { makeSamples, type SynthImpulse } from "./synth.js";

/**
 * Ground truth for one injected disturbance in a golden drive. `kind` mirrors
 * {@link SynthImpulse.kind}: "sharp" should classify as a pothole, "rounded"
 * (with gyro content) as a speed bump.
 */
export interface TruthEvent {
  atMs: number;
  kind: "sharp" | "rounded";
  peak: number;
}

/**
 * A {@link RecordedDrive} bundled with the ground truth that produced it — the
 * fixture format the `ml/` replay harness evaluates against. Consumers that
 * only replay (e.g. `replayDrive`) ignore the extra `truth` key.
 */
export interface GoldenDrive extends RecordedDrive {
  truth: TruthEvent[];
}

export type GoldenPreset = "demo" | "clean";

const BASE_EPOCH_MS = 1_760_000_000_000;
const ORIGIN: LatLng = { lat: 37.7749, lng: -122.4194 };
const SPEED_MPS = 13.4; // ~30 mph
const METERS_PER_DEG_LAT = 111_320;

/** Straight northbound 1 Hz GPS track at constant speed, same clock as samples. */
function makeGpsTrack(durationMs: number): GpsFix[] {
  const gps: GpsFix[] = [];
  for (let t = 0; t <= durationMs; t += 1000) {
    gps.push({
      t,
      capturedAt: new Date(BASE_EPOCH_MS + t).toISOString(),
      location: {
        lat: ORIGIN.lat + (SPEED_MPS * (t / 1000)) / METERS_PER_DEG_LAT,
        lng: ORIGIN.lng,
      },
      speedMps: SPEED_MPS,
      heading: 0,
    });
  }
  return gps;
}

// The demo-drive road recipe (3 potholes + 1 speed bump) — the same impulse
// mix the app's Demo Drive mode uses, known to be cleanly detectable at the
// default thresholds.
const DEMO_IMPULSES: SynthImpulse[] = [
  { atMs: 6000, peak: 11, kind: "sharp" },
  { atMs: 13000, peak: 7, kind: "rounded", gyroPeak: 1.2 },
  { atMs: 20000, peak: 8.5, kind: "sharp" },
  { atMs: 29000, peak: 14, kind: "sharp" },
];

/**
 * Build a deterministic golden drive for the replay harness. "demo" is the
 * mixed road above; "clean" is the same road with no disturbances (any event
 * it yields is a false positive).
 */
export function makeGoldenDrive(
  preset: GoldenPreset,
  seed = 7
): GoldenDrive {
  const durationMs = 35_000;
  const impulses = preset === "demo" ? DEMO_IMPULSES : [];
  const samples = makeSamples({
    durationMs,
    rateHz: 50,
    noise: 0.35,
    gyroNoise: 0.03,
    seed,
    impulses,
  });
  return {
    rateHz: 50,
    samples,
    gps: makeGpsTrack(durationMs),
    label: `golden-${preset}`,
    truth: impulses.map(({ atMs, kind, peak }) => ({ atMs, kind, peak })),
  };
}
