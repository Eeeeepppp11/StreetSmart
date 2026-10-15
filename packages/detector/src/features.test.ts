import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSamples } from "./demo.js";
import { extractFeatures } from "./features.js";

test("flat road → tiny vertical dynamics", () => {
  const f = extractFeatures(
    makeSamples({ durationMs: 800, rateHz: 100, noise: 0.1, seed: 7 })
  );
  assert.ok(f.peakToPeak < 0.5, `peakToPeak ${f.peakToPeak}`);
  assert.ok(f.rms < 0.2, `rms ${f.rms}`);
});

test("sharp pothole → large, sharp, vertical", () => {
  const f = extractFeatures(
    makeSamples({
      durationMs: 800,
      rateHz: 100,
      noise: 0.05,
      impulses: [{ atMs: 400, peak: 10, kind: "sharp" }],
    })
  );
  assert.ok(f.peakToPeak > 8, `peakToPeak ${f.peakToPeak}`);
  assert.ok(f.maxJerk > 300, `maxJerk ${f.maxJerk}`);
  assert.ok(f.verticalDominance > 0.9, `vDom ${f.verticalDominance}`);
  assert.ok(f.settleMs > 0, `settleMs ${f.settleMs}`);
});

test("mount angle does not change features (gravity projection)", () => {
  const level = extractFeatures(
    makeSamples({
      durationMs: 800,
      rateHz: 100,
      noise: 0.02,
      impulses: [{ atMs: 400, peak: 10, kind: "sharp" }],
    })
  );
  const tilted = extractFeatures(
    makeSamples({
      durationMs: 800,
      rateHz: 100,
      noise: 0.02,
      gravity: { x: 3, y: 0, z: 9.3 },
      impulses: [{ atMs: 400, peak: 10, kind: "sharp" }],
    })
  );
  const rel = Math.abs(level.peakToPeak - tilted.peakToPeak) / level.peakToPeak;
  assert.ok(rel < 0.05, `relative peakToPeak diff ${rel}`);
});
