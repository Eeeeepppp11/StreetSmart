import type { JoltFeatures } from "./features.js";
import type { DetectionResult } from "./classify.js";
import type { DetectorConfig } from "./config.js";
import { DEFAULT_CONFIG } from "./config.js";
import { clamp01 } from "./util.js";
import { MODEL_WEIGHTS, type ModelDenseLayer } from "./model.weights.js";

/**
 * Pure-JS reimplementation of the trained MLP's forward pass (Normalization →
 * Dense/ReLU ×2 → Dense/softmax). No native TFLite binding — this runs in
 * Expo Go, where `react-native-fast-tflite` cannot (it needs a custom dev
 * client). The exact same weights are also exported as .tflite
 * (ml/export/artifacts/) for whenever the app leaves Expo Go.
 *
 * Training input: ml/data/training_dataset.json.
 */

function relu(x: number): number {
  return x > 0 ? x : 0;
}

function softmax(xs: number[]): number[] {
  const max = Math.max(...xs);
  const exps = xs.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function denseForward(input: number[], layer: ModelDenseLayer): number[] {
  const outDim = layer.bias.length;
  const out = new Array<number>(outDim).fill(0);
  for (let i = 0; i < input.length; i++) {
    const row = layer.weights[i]!;
    const xi = input[i]!;
    for (let j = 0; j < outDim; j++) out[j]! += xi * row[j]!;
  }
  for (let j = 0; j < outDim; j++) out[j] = out[j]! + layer.bias[j]!;
  return layer.activation === "relu" ? out.map(relu) : softmax(out);
}

function featureVector(features: JoltFeatures, speedMps: number): number[] {
  const byName: Record<string, number> = { ...features, speedMps };
  return MODEL_WEIGHTS.featureOrder.map((name) => byName[name] ?? 0);
}

/** Runs the trained model on one window's features + speed. */
export function runModel(features: JoltFeatures, speedMps: number): { label: string; probs: number[] } {
  const raw = featureVector(features, speedMps);
  const { mean, variance, epsilon } = MODEL_WEIGHTS.normalization;
  let x = raw.map((v, i) => (v - mean[i]!) / Math.sqrt(variance[i]! + epsilon));
  for (const layer of MODEL_WEIGHTS.layers) x = denseForward(x, layer);

  let bestIdx = 0;
  for (let i = 1; i < x.length; i++) if (x[i]! > x[bestIdx]!) bestIdx = i;
  return { label: MODEL_WEIGHTS.labels[bestIdx]!, probs: x };
}

/**
 * Model-based drop-in replacement for the heuristic {@link classify} — same
 * signature, same {@link DetectionResult} shape. `severity` stays the
 * physically-grounded speed-normalised-peak formula (a continuous quantity
 * a 4-way classifier isn't the right tool for); the model replaces
 * classification + confidence.
 */
export function classifyWithModel(
  features: JoltFeatures,
  speedMps: number,
  config: DetectorConfig = DEFAULT_CONFIG
): DetectionResult {
  const clampedSpeed = Math.min(Math.max(speedMps, config.minSpeedMps), config.maxSpeedMps);
  const speedScale = config.refSpeedMps / clampedSpeed;
  const normalizedPeak = features.peakToPeak * speedScale;
  const severity = clamp01(
    (normalizedPeak - config.severityMin) / (config.severityMax - config.severityMin)
  );

  const { label, probs } = runModel(features, speedMps);
  const confidence = Math.max(...probs);

  return {
    classification: label as DetectionResult["classification"],
    normalizedPeak,
    severity,
    confidence,
  };
}

export const MODEL_VERSION = MODEL_WEIGHTS.modelVersion;
