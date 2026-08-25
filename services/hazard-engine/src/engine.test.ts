import { test } from "node:test";
import assert from "node:assert/strict";
import type { JoltEvent, LatLng } from "@potholeproof/shared-types";
import { HazardEngine, type HazardEngineDeps } from "./engine.js";

/** Simple deterministic grid cell (~100 m) so tests don't depend on H3. */
function gridCell(loc: LatLng): string {
  return `${Math.round(loc.lat * 1000)}:${Math.round(loc.lng * 1000)}`;
}

function makeDeps(): HazardEngineDeps {
  let i = 0;
  return { nextId: () => `haz-${++i}`, cellOf: gridCell };
}

const A: LatLng = { lat: 37.7749, lng: -122.4194 };
const B: LatLng = { lat: 37.8, lng: -122.4 };

function event(loc: LatLng, over: Partial<JoltEvent> = {}): JoltEvent {
  return {
    id: "evt",
    capturedAt: "2026-07-03T09:00:00.000Z",
    location: loc,
    speedMps: 13.4,
    severity: 0.5,
    confidence: 0.8,
    classification: "pothole",
    modelVersion: "heuristic-v0",
    ...over,
  };
}

test("a detection creates an active, located, confident hazard", () => {
  const e = new HazardEngine(makeDeps());
  const h = e.ingestEvent(event(A));
  assert.equal(h.status, "active");
  assert.equal(h.h3Cell, gridCell(A));
  assert.equal(h.passCount, 1);
  assert.ok(h.confidence > 0 && h.confidence < 1);
  assert.equal(e.all().length, 1);
});

test("repeat detections in a cell aggregate into one rising-confidence hazard", () => {
  const e = new HazardEngine(makeDeps());
  const c1 = e.ingestEvent(event(A)).confidence;
  e.ingestEvent(event(A));
  const c3 = e.ingestEvent(event(A)).confidence;
  assert.equal(e.all().length, 1);
  assert.equal(e.get(gridCell(A))!.passCount, 3);
  assert.ok(c3 > c1, `confidence should rise: ${c1} -> ${c3}`);
});

test("detections in different cells are separate hazards", () => {
  const e = new HazardEngine(makeDeps());
  e.ingestEvent(event(A));
  e.ingestEvent(event(B));
  assert.equal(e.all().length, 2);
  assert.equal(e.active().length, 2);
});

test("clean passes lower confidence and eventually retire the hazard", () => {
  const e = new HazardEngine(makeDeps());
  const cell = gridCell(A);
  e.ingestEvent(event(A)); // active
  e.ingestCleanPass(cell);
  const after2 = e.ingestCleanPass(cell);
  assert.equal(after2!.status, "active"); // not enough clean passes yet
  const after3 = e.ingestCleanPass(cell);
  assert.equal(after3!.status, "retired");
  assert.ok(after3!.confidence < 0.35);
  assert.equal(e.active().length, 0);
});

test("a retired hazard reactivates once detections outweigh clean passes", () => {
  const e = new HazardEngine(makeDeps());
  const cell = gridCell(A);
  e.ingestEvent(event(A));
  for (let i = 0; i < 3; i++) e.ingestCleanPass(cell);
  assert.equal(e.get(cell)!.status, "retired");
  let last = e.get(cell)!;
  for (let i = 0; i < 5; i++) last = e.ingestEvent(event(A, { confidence: 0.9 }));
  assert.equal(last.status, "active");
});

test("markReported flips status and stamps reportId", () => {
  const e = new HazardEngine(makeDeps());
  const cell = gridCell(A);
  e.ingestEvent(event(A));
  const h = e.markReported(cell, "report-1")!;
  assert.equal(h.status, "reported");
  assert.equal(h.reportId, "report-1");
});

test("markReported on an unknown cell is a no-op", () => {
  const e = new HazardEngine(makeDeps());
  assert.equal(e.markReported("nowhere", "report-1"), undefined);
});

test("clean passes verify a reported hazard fixed instead of just retiring it", () => {
  const e = new HazardEngine(makeDeps());
  const cell = gridCell(A);
  e.ingestEvent(event(A));
  e.markReported(cell, "report-1");
  e.ingestCleanPass(cell);
  const after2 = e.ingestCleanPass(cell);
  assert.equal(after2!.status, "reported"); // not enough clean passes yet
  const after3 = e.ingestCleanPass(cell);
  assert.equal(after3!.status, "verified_fixed");
  assert.equal(after3!.reportId, "report-1");
});

test("markVerifiedFixed stamps status directly, no clean-pass evidence needed", () => {
  const e = new HazardEngine(makeDeps());
  const cell = gridCell(A);
  e.ingestEvent(event(A));
  const h = e.markVerifiedFixed(cell)!;
  assert.equal(h.status, "verified_fixed");
});

test("markVerifiedFixed on an unknown cell is a no-op", () => {
  const e = new HazardEngine(makeDeps());
  assert.equal(e.markVerifiedFixed("nowhere"), undefined);
});

test("clean pass on an unknown cell is a no-op", () => {
  const e = new HazardEngine(makeDeps());
  assert.equal(e.ingestCleanPass("nowhere"), undefined);
  assert.equal(e.observeClean(A), undefined);
});

test("severity aggregates and bands; high-severity hits read as severe", () => {
  const e = new HazardEngine(makeDeps());
  let h = e.ingestEvent(event(A, { severity: 0.9, confidence: 0.9 }));
  h = e.ingestEvent(event(A, { severity: 0.85, confidence: 0.9 }));
  assert.ok(h.severity > 0.67);
  assert.equal(h.severityBand, "severe");
});

test("earliest firstSeen and latest lastConfirmed are tracked", () => {
  const e = new HazardEngine(makeDeps());
  e.ingestEvent(event(A, { capturedAt: "2026-07-03T09:00:00.000Z" }));
  e.ingestEvent(event(A, { capturedAt: "2026-07-03T08:00:00.000Z" }));
  const h = e.ingestEvent(event(A, { capturedAt: "2026-07-03T10:00:00.000Z" }));
  assert.equal(h.firstSeen, "2026-07-03T08:00:00.000Z");
  assert.equal(h.lastConfirmed, "2026-07-03T10:00:00.000Z");
});

test("public records don't leak internal accumulators", () => {
  const e = new HazardEngine(makeDeps());
  const h = e.ingestEvent(event(A));
  assert.ok(!("hitScore" in h));
  assert.ok(!("weightSum" in h));
  assert.ok(!("sevWeightedSum" in h));
});
