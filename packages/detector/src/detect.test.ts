import { test } from "node:test";
import assert from "node:assert/strict";
import type { LatLng } from "@potholeproof/shared-types";
import { makeSamples } from "./demo.js";
import { runDetection, type GpsFix, type PipelineDeps } from "./detect.js";
import type { DemoImpulse } from "./demo.js";

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

function drive(durationMs: number, impulses: DemoImpulse[]) {
  return makeSamples({ durationMs, rateHz: 100, noise: 0.05, impulses });
}

test("one strike → exactly one located pothole event", () => {
  const samples = drive(900, [{ atMs: 450, peak: 10, kind: "sharp" }]);
  const events = runDetection(samples, gpsTrack([0, 450, 900], 13.4), makeDeps());
  assert.equal(events.length, 1);
  const e = events[0]!;
  assert.equal(e.classification, "pothole");
  assert.deepEqual(e.location, LOC);
  assert.equal(e.modelVersion, "heuristic-v0");
  assert.equal(e.id, "evt-1");
});

test("two well-separated strikes → two events", () => {
  const samples = drive(2500, [
    { atMs: 500, peak: 10, kind: "sharp" },
    { atMs: 2000, peak: 10, kind: "sharp" },
  ]);
  const events = runDetection(
    samples,
    gpsTrack([0, 1250, 2500], 13.4),
    makeDeps()
  );
  assert.equal(events.length, 2);
});

test("two strikes within the refractory window → one event", () => {
  const samples = drive(1800, [
    { atMs: 600, peak: 10, kind: "sharp" },
    { atMs: 1100, peak: 10, kind: "sharp" }, // 500 ms < 800 ms refractory
  ]);
  const events = runDetection(samples, gpsTrack([0, 900, 1800], 13.4), makeDeps());
  assert.equal(events.length, 1);
});

test("no GPS → no events (cannot localise a hazard)", () => {
  const samples = drive(900, [{ atMs: 450, peak: 10, kind: "sharp" }]);
  assert.equal(runDetection(samples, [], makeDeps()).length, 0);
});

test("stationary shaking → no events (below minEmitSpeed)", () => {
  const samples = drive(900, [{ atMs: 450, peak: 12, kind: "sharp" }]);
  const parked = runDetection(samples, gpsTrack([0, 450, 900], 0), makeDeps());
  assert.equal(parked.length, 0);
  const crawling = runDetection(samples, gpsTrack([0, 450, 900], 2), makeDeps());
  assert.equal(crawling.length, 0);
});
