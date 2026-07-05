import { test } from "node:test";
import assert from "node:assert/strict";
import type { LatLng } from "@potholeproof/shared-types";
import { trimTraceEndpoints, meetsKAnonymity } from "./index.js";

const BASE: LatLng = { lat: 37.7749, lng: -122.4194 };

/** A straight northbound trace: one point every `stepM` metres. */
function trace(count: number, stepM: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    location: { lat: BASE.lat + (i * stepM) / 111320, lng: BASE.lng },
  }));
}

test("trims points within trimMeters of both ends (along-path)", () => {
  // 11 points, 100 m apart → 1000 m path. Trim 250 m each end.
  const kept = trimTraceEndpoints(trace(11, 100), 250);
  // Points at cumulative 0,100,200 (start) and 800,900,1000 (end) drop.
  assert.deepEqual(kept.map((p) => p.id), [3, 4, 5, 6, 7]);
});

test("a short trip vanishes entirely", () => {
  // 400 m path, 250 m trim each end → nothing safely publishable.
  assert.deepEqual(trimTraceEndpoints(trace(5, 100), 250), []);
});

test("zero trim keeps everything; empty input stays empty", () => {
  assert.equal(trimTraceEndpoints(trace(5, 100), 0).length, 5);
  assert.deepEqual(trimTraceEndpoints([], 100), []);
});

test("points just past the trim distance are kept, just inside are dropped", () => {
  // Steps are ~99.89 m by haversine (fixture uses a nominal constant), so use a
  // trim between one and two steps: point 1 (~99.9 m) drops, point 2 (~199.8 m)
  // stays — and symmetrically at the far end.
  const kept = trimTraceEndpoints(trace(11, 100), 150);
  assert.deepEqual(kept.map((p) => p.id), [2, 3, 4, 5, 6, 7, 8]);
});

test("meetsKAnonymity counts distinct contributors", () => {
  assert.equal(meetsKAnonymity(["a", "b", "c"], 3), true);
  assert.equal(meetsKAnonymity(["a", "a", "a", "b"], 3), false);
  assert.equal(meetsKAnonymity([], 1), false);
});
