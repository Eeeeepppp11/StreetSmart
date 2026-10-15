import { test } from "node:test";
import assert from "node:assert/strict";
import type { LatLng, JoltEvent } from "@potholeproof/shared-types";
import { makeSamples, type DemoImpulse } from "./demo.js";
import { runDetection, type GpsFix, type PipelineDeps } from "./detect.js";
import { DetectionPipeline } from "./pipeline.js";

const LOC: LatLng = { lat: 37.7749, lng: -122.4194 };

function makeDeps(): PipelineDeps {
  let i = 0;
  return { nextId: () => `evt-${++i}`, modelVersion: "heuristic-v0" };
}

function gpsTrack(times: number[], speedMps: number): GpsFix[] {
  return times.map((t) => ({
    t,
    capturedAt: new Date(1_700_000_000_000 + t).toISOString(),
    location: LOC,
    speedMps,
  }));
}

function fixtureSamples() {
  const impulses: DemoImpulse[] = [
    { atMs: 600, peak: 12, kind: "sharp" },
    { atMs: 1500, peak: 7, kind: "rounded", gyroPeak: 1.2 },
    { atMs: 2400, peak: 9, kind: "sharp" },
    { atMs: 3300, peak: 11, kind: "sharp" },
  ];
  return makeSamples({
    durationMs: 4000,
    rateHz: 100,
    noise: 0.05,
    seed: 99,
    impulses,
  });
}

/** Compare events ignoring the (independently generated) ids. */
function strip(events: JoltEvent[]) {
  return events.map((e) => ({
    classification: e.classification,
    severity: e.severity,
    confidence: e.confidence,
    location: e.location,
    capturedAt: e.capturedAt,
  }));
}

function feedInChunks(chunkSize: number): JoltEvent[] {
  const samples = fixtureSamples();
  const gps = gpsTrack([0, 1000, 2000, 3000, 4000], 13.4);
  const pipe = new DetectionPipeline(makeDeps());
  for (const f of gps) pipe.pushGps(f);
  const out: JoltEvent[] = [];
  for (let i = 0; i < samples.length; i += chunkSize) {
    out.push(...pipe.push(samples.slice(i, i + chunkSize)));
  }
  out.push(...pipe.flush());
  return out;
}

test("streaming pipeline matches batch runDetection", () => {
  const samples = fixtureSamples();
  const gps = gpsTrack([0, 1000, 2000, 3000, 4000], 13.4);
  const batch = runDetection(samples, gps, makeDeps());
  const streamed = feedInChunks(20);
  assert.deepEqual(strip(streamed), strip(batch));
});

test("result is independent of chunk size", () => {
  const a = strip(feedInChunks(1));
  const b = strip(feedInChunks(7));
  const c = strip(feedInChunks(250));
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});

test("pipeline emits incrementally, never re-emitting", () => {
  const samples = fixtureSamples();
  const gps = gpsTrack([0, 1000, 2000, 3000, 4000], 13.4);
  const pipe = new DetectionPipeline(makeDeps());
  for (const f of gps) pipe.pushGps(f);

  let total = 0;
  const ids = new Set<string>();
  for (let i = 0; i < samples.length; i += 50) {
    const emitted = pipe.push(samples.slice(i, i + 50));
    for (const e of emitted) {
      assert.ok(!ids.has(e.id), `re-emitted ${e.id}`);
      ids.add(e.id);
    }
    total += emitted.length;
  }
  total += pipe.flush().length;
  // 3 sharp strikes + 1 rounded hump, all well separated.
  assert.equal(total, 4);
});
