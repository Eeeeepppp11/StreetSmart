import { test } from "node:test";
import assert from "node:assert/strict";
import type { HazardRecord, CivicReport } from "@potholeproof/shared-types";
import { hazardsToReport, reconcileReport } from "./reporting.js";

const ISO = "2026-07-04T00:30:00.000Z";

function haz(id: string, over: Partial<HazardRecord> = {}): HazardRecord {
  return {
    id,
    h3Cell: "c",
    location: { lat: 37.7749, lng: -122.4194 },
    severity: 0.7,
    severityBand: "severe",
    confidence: 0.8,
    status: "active",
    firstSeen: ISO,
    lastConfirmed: ISO,
    passCount: 5,
    cleanPassCount: 0,
    modelVersion: "v0",
    ...over,
  };
}

function report(hazardId: string, status: CivicReport["status"]): CivicReport {
  return { id: `rep-${hazardId}`, hazardId, provider: "open311", status };
}

test("hazardsToReport picks confident, severe, active, un-reported hazards", () => {
  const hazards = [
    haz("ok"),
    haz("lowconf", { confidence: 0.3 }),
    haz("lowsev", { severity: 0.1, severityBand: "minor" }),
    haz("retired", { status: "retired" }),
    haz("already"),
  ];
  const existing = [report("already", "submitted")];
  const picked = hazardsToReport(hazards, existing).map((h) => h.id);
  assert.deepEqual(picked, ["ok"]);
});

test("a hazard whose prior report was closed can be reported again", () => {
  const picked = hazardsToReport([haz("returned")], [report("returned", "closed")]);
  assert.equal(picked.length, 1);
  assert.equal(picked[0]!.id, "returned");
});

test("reconcileReport closes an open report when the hazard self-heals", () => {
  const r = reconcileReport(report("h", "submitted"), haz("h", { status: "retired" }));
  assert.equal(r.status, "closed");
});

test("reconcileReport leaves an open report alone while the hazard is active", () => {
  const r = reconcileReport(report("h", "in_progress"), haz("h", { status: "active" }));
  assert.equal(r.status, "in_progress");
});

test("reconcileReport does not touch already-terminal reports", () => {
  const closed = reconcileReport(report("h", "closed"), haz("h", { status: "retired" }));
  assert.equal(closed.status, "closed");
  const rejected = reconcileReport(report("h", "rejected"), haz("h", { status: "retired" }));
  assert.equal(rejected.status, "rejected");
});
