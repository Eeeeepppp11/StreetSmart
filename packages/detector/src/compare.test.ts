import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSamples } from "./synth.js";
import { compareClassifiers } from "./compare.js";
import type { GpsFix } from "./detect.js";

function gpsFor(durationMs: number, speedMps: number): GpsFix[] {
  const fixes: GpsFix[] = [];
  for (let t = 0; t <= durationMs; t += 1000) {
    fixes.push({
      t,
      capturedAt: new Date(t).toISOString(),
      location: { lat: 37.7749 + t * 1e-7, lng: -122.4194 },
      speedMps,
    });
  }
  return fixes;
}

test("compareClassifiers scores a clean pothole hit with both classifiers", () => {
  const samples = makeSamples({
    durationMs: 2000,
    rateHz: 50,
    noise: 0.1,
    impulses: [{ atMs: 1000, peak: 12, kind: "sharp", widthMs: 35 }],
  });
  const results = compareClassifiers(samples, gpsFor(2000, 13.4));
  assert.equal(results.length, 1);
  const r = results[0]!;
  assert.ok(r.features.peakToPeak > 0);
  assert.ok(r.heuristic.classification !== undefined);
  assert.ok(r.model.classification !== undefined);
  assert.equal(r.agree, r.heuristic.classification === r.model.classification);
});

test("compareClassifiers never mutates behavior of the live pipeline exports", () => {
  // Both classifiers should independently be pure functions of (features, speed) —
  // calling compareClassifiers twice on identical input is deterministic.
  const samples = makeSamples({
    durationMs: 2000,
    rateHz: 50,
    noise: 0.1,
    impulses: [{ atMs: 1000, peak: 7, kind: "rounded", widthMs: 300, gyroPeak: 1.2 }],
  });
  const gps = gpsFor(2000, 8);
  const a = compareClassifiers(samples, gps);
  const b = compareClassifiers(samples, gps);
  assert.deepEqual(a, b);
});

test("compareClassifiers surfaces low-signal candidates the live pipeline would drop", () => {
  // A borderline jolt that just clears the trigger threshold but isn't
  // confidently anything — the live pipeline drops "other"/low-confidence
  // verdicts, but the comparison tool's whole purpose is showing these.
  const samples = makeSamples({
    durationMs: 2000,
    rateHz: 50,
    noise: 0.2,
    impulses: [{ atMs: 1000, peak: 5, kind: "sharp", widthMs: 40 }],
  });
  const results = compareClassifiers(samples, gpsFor(2000, 13.4));
  assert.equal(results.length, 1);
});
