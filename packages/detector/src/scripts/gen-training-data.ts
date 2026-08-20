/**
 * Generates a labelled training dataset for ml/training by running the SAME
 * production `extractFeatures` code the app uses on-device against physically
 * parameterised synthetic sensor windows (the same generator that powers
 * Demo Drive mode, `synth.ts`). The waveforms are synthetic — we don't yet
 * have real recorded drives with ground-truth labels — but the feature
 * VECTORS are genuinely computed by the real detector code, not fabricated.
 *
 * Run after `pnpm --filter @potholeproof/detector build`:
 *   node dist/scripts/gen-training-data.js
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { SensorSample } from "@potholeproof/shared-types";
import { makeSamples } from "../synth.js";
import { extractFeatures, type JoltFeatures } from "../features.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../../../ml/data");
const OUT_PATH = path.join(OUT_DIR, "synthetic_dataset.json");

type Label = "pothole" | "speed_bump" | "rough_road" | "other";

interface Row {
  features: JoltFeatures;
  speedMps: number;
  label: Label;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** ~600ms window, 50Hz — matches windowHalfMs=300 in DEFAULT_CONFIG. */
const RATE_HZ = 50;
const DURATION_MS = 600;
const CENTER_MS = DURATION_MS / 2;

/** Fraction of samples drawn from a wider, overlapping "messy" parameter range instead of the clean one. */
const MESSY_FRACTION = 0.28;

function windowFor(label: Label): { window: SensorSample[]; speedMps: number } {
  const speedMps = rand(4.5, 30);
  const seed = Math.floor(Math.random() * 1_000_000);
  const messy = Math.random() < MESSY_FRACTION;

  if (label === "pothole") {
    const samples = makeSamples({
      durationMs: DURATION_MS,
      rateHz: RATE_HZ,
      seed,
      noise: messy ? rand(0.4, 1.1) : rand(0.15, 0.55),
      gyroNoise: messy ? rand(0.03, 0.12) : rand(0.01, 0.05),
      impulses: [
        {
          atMs: CENTER_MS,
          peak: messy ? rand(3.5, 8) : rand(5, 18),
          kind: "sharp",
          widthMs: messy ? rand(45, 120) : rand(25, 55),
          gyroPeak: messy ? rand(0.15, 0.55) : rand(0, 0.12),
        },
      ],
    });
    return { window: samples, speedMps };
  }

  if (label === "speed_bump") {
    const samples = makeSamples({
      durationMs: DURATION_MS,
      rateHz: RATE_HZ,
      seed,
      noise: messy ? rand(0.35, 0.9) : rand(0.1, 0.4),
      gyroNoise: messy ? rand(0.05, 0.15) : rand(0.02, 0.08),
      impulses: [
        {
          atMs: CENTER_MS,
          peak: messy ? rand(6, 14) : rand(3, 10),
          kind: "rounded",
          widthMs: messy ? rand(90, 220) : rand(200, 450),
          gyroPeak: messy ? rand(0.2, 0.7) : rand(0.6, 2.5),
        },
      ],
    });
    return { window: samples, speedMps };
  }

  if (label === "rough_road") {
    // Sustained elevated noise, no discrete impulse — chattery pavement.
    // A minority carry a mild residual bump/jolt on top (patched-but-uneven road).
    const samples = makeSamples({
      durationMs: DURATION_MS,
      rateHz: RATE_HZ,
      seed,
      noise: messy ? rand(0.5, 1.3) : rand(0.9, 2.2),
      gyroNoise: messy ? rand(0.15, 0.4) : rand(0.05, 0.25),
      impulses: messy
        ? [{ atMs: CENTER_MS, peak: rand(2, 5), kind: pick(["sharp", "rounded"]), widthMs: rand(60, 250) }]
        : [],
    });
    return { window: samples, speedMps };
  }

  // "other": low-level ambiguous jiggle — the false-positive class.
  const samples = makeSamples({
    durationMs: DURATION_MS,
    rateHz: RATE_HZ,
    seed,
    noise: messy ? rand(0.6, 1.4) : rand(0.3, 0.9),
    gyroNoise: messy ? rand(0.08, 0.2) : rand(0.02, 0.1),
    impulses: Math.random() < 0.35
      ? [{ atMs: CENTER_MS, peak: rand(2, 5.5), kind: pick(["sharp", "rounded"]), widthMs: rand(30, 220) }]
      : [],
  });
  return { window: samples, speedMps };
}

const OTHER_LABELS: Record<Label, Label[]> = {
  pothole: ["speed_bump", "rough_road"],
  speed_bump: ["pothole", "rough_road"],
  rough_road: ["other", "speed_bump"],
  other: ["rough_road"],
};

function generate(label: Label, count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    const { window, speedMps } = windowFor(label);
    // ~4% ground-truth label noise — real driver-confirmed labels aren't perfectly clean either.
    const noisyLabel = Math.random() < 0.04 ? pick(OTHER_LABELS[label]) : label;
    rows.push({ features: extractFeatures(window), speedMps, label: noisyLabel });
  }
  return rows;
}

const COUNTS: Record<Label, number> = {
  pothole: 2400,
  speed_bump: 2400,
  rough_road: 2000,
  other: 1600,
};

function main() {
  const rows: Row[] = [];
  for (const [label, count] of Object.entries(COUNTS) as [Label, number][]) {
    rows.push(...generate(label, count));
  }
  // Shuffle (Fisher-Yates) so train/val splits aren't class-ordered.
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j]!, rows[i]!];
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(rows));
  console.log(`Wrote ${rows.length} rows to ${OUT_PATH}`);
  console.log("Class counts:", COUNTS);
}

main();
