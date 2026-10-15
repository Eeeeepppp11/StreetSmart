import { test } from "node:test";
import assert from "node:assert/strict";
import type { LatLng } from "@potholeproof/shared-types";
import { makeSamples } from "./demo.js";
import { replayDrive, type RecordedDrive } from "./replay.js";
import type { GpsFix, PipelineDeps } from "./detect.js";

const LOC: LatLng = { lat: 37.78, lng: -122.41 };

function makeDeps(): PipelineDeps {
  let i = 0;
  return { nextId: () => `evt-${++i}`, modelVersion: "heuristic-v0" };
}

function fixtureDrive(): RecordedDrive {
  const samples = makeSamples({
    durationMs: 3000,
    rateHz: 100,
    noise: 0.05,
    seed: 42,
    impulses: [
      { atMs: 600, peak: 12, kind: "sharp" },
      { atMs: 1500, peak: 7, kind: "rounded", gyroPeak: 1.2 },
      { atMs: 2400, peak: 9, kind: "sharp" },
    ],
  });
  const gps: GpsFix[] = [0, 750, 1500, 2250, 3000].map((t) => ({
    t,
    capturedAt: new Date(1_700_000_000_000 + t).toISOString(),
    location: LOC,
    speedMps: 13.4,
  }));
  return { rateHz: 100, samples, gps, label: "fixture-mixed" };
}

test("replay is deterministic (identical across runs)", () => {
  const drive = fixtureDrive();
  const a = replayDrive(drive, makeDeps());
  const b = replayDrive(drive, makeDeps());
  assert.equal(a.length, b.length);
  const strip = (e: (typeof a)[number]) => ({
    classification: e.classification,
    severity: e.severity,
    confidence: e.confidence,
    location: e.location,
  });
  assert.deepEqual(a.map(strip), b.map(strip));
});

test("mixed fixture yields the expected event mix", () => {
  const events = replayDrive(fixtureDrive(), makeDeps());
  // two sharp strikes + one rounded hump, all well separated.
  assert.equal(events.length, 3);
  const kinds = events.map((e) => e.classification).sort();
  assert.deepEqual(kinds, ["pothole", "pothole", "speed_bump"]);
});
