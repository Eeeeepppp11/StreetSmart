import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSamples } from "./demo.js";
import { extractFeatures } from "./features.js";
import { classify } from "./classify.js";

function classifyDrive(
  opts: Parameters<typeof makeSamples>[0],
  speedMps: number
) {
  return classify(extractFeatures(makeSamples(opts)), speedMps);
}

test("sharp low-rotation strike → pothole", () => {
  const r = classifyDrive(
    {
      durationMs: 800,
      rateHz: 100,
      noise: 0.05,
      impulses: [{ atMs: 400, peak: 10, kind: "sharp" }],
    },
    13.4
  );
  assert.equal(r.classification, "pothole");
  assert.ok(r.confidence > 0.6, `confidence ${r.confidence}`);
  assert.ok(r.severity > 0, `severity ${r.severity}`);
});

test("rounded high-rotation hump → speed bump, not pothole", () => {
  const r = classifyDrive(
    {
      durationMs: 1000,
      rateHz: 100,
      noise: 0.05,
      gyroNoise: 0.02,
      impulses: [{ atMs: 500, peak: 7, kind: "rounded", gyroPeak: 1.2 }],
    },
    8
  );
  assert.equal(r.classification, "speed_bump");
});

test("flat noise → not a discrete event", () => {
  const r = classifyDrive({ durationMs: 800, rateHz: 100, noise: 0.1 }, 13.4);
  assert.notEqual(r.classification, "pothole");
  assert.notEqual(r.classification, "speed_bump");
});

test("tilted mount still classifies pothole", () => {
  const r = classifyDrive(
    {
      durationMs: 800,
      rateHz: 100,
      noise: 0.05,
      gravity: { x: 3, y: 0, z: 9.3 },
      impulses: [{ atMs: 400, peak: 10, kind: "sharp" }],
    },
    13.4
  );
  assert.equal(r.classification, "pothole");
});

test("severity is speed-normalised (same pothole, different speeds)", () => {
  // A real pothole hit harder at speed: raw peak scales with speed.
  const base = 8;
  const sharpAt = (speed: number) =>
    classifyDrive(
      {
        durationMs: 800,
        rateHz: 100,
        noise: 0.02,
        impulses: [
          { atMs: 400, peak: base * (speed / 13.4), kind: "sharp" },
        ],
      },
      speed
    );
  const slow = sharpAt(13.4);
  const fast = sharpAt(26.8);
  assert.equal(slow.classification, "pothole");
  assert.equal(fast.classification, "pothole");
  assert.ok(
    Math.abs(slow.severity - fast.severity) < 0.05,
    `severity drift slow=${slow.severity} fast=${fast.severity}`
  );
});
