import { test } from "node:test";
import assert from "node:assert/strict";
import type { CivicReport, HazardRecord, LatLng } from "@potholeproof/shared-types";
import { buildPriorityQueue } from "./priorities.js";
import type { HazardContribution } from "./export.js";

const ASOF = "2026-07-04T12:00:00.000Z";
const FRESH = "2026-07-03T12:00:00.000Z"; // 1 day old

function haz(id: string, lat: number, over: Partial<HazardRecord> = {}): HazardRecord {
  return {
    id,
    h3Cell: "fine",
    location: { lat, lng: -122.4 },
    severity: 0.8,
    severityBand: "severe",
    confidence: 0.9,
    status: "active",
    firstSeen: FRESH,
    lastConfirmed: FRESH,
    passCount: 4,
    cleanPassCount: 0,
    modelVersion: "v0",
    ...over,
  };
}

function contribs(hazardId: string, ...devices: string[]): HazardContribution[] {
  return devices.map((anonDeviceId) => ({ hazardId, anonDeviceId }));
}

function report(hazardId: string, over: Partial<CivicReport> = {}): CivicReport {
  return {
    id: `report-${hazardId}`,
    hazardId,
    provider: "open311",
    status: "submitted",
    submittedAt: FRESH,
    ...over,
  };
}

const OPTS = {
  tileOf: (loc: LatLng) => `cell-${Math.floor(loc.lat)}`,
  cityOf: () => "Bellevue, WA",
  k: 3,
  asOf: ASOF,
  halfLifeDays: 30,
  riskScale: 2,
};

test("rows are sorted most-urgent first, not by cell id", () => {
  const rows = buildPriorityQueue(
    [haz("a", 38.1, { severity: 0.3, confidence: 0.5 }), haz("b", 39.1, { severity: 0.9, confidence: 0.95 })],
    [],
    [...contribs("a", "d1", "d2", "d3"), ...contribs("b", "d1", "d2", "d3")],
    OPTS
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.h3Cell, "cell-39"); // higher severity/confidence hazard first
  assert.ok(rows[0]!.urgencyScore > rows[1]!.urgencyScore);
});

test("open vs. closed civic reports are counted separately", () => {
  const rows = buildPriorityQueue(
    [haz("a", 38.1)],
    [report("a", { status: "acknowledged" }), report("a", { id: "r2", status: "closed" })],
    contribs("a", "d1", "d2", "d3"),
    OPTS
  );
  assert.equal(rows[0]!.reportedCount, 2);
  assert.equal(rows[0]!.openReports, 1);
  assert.equal(rows[0]!.oldestOpenReportDays, 1);
});

test("under-k cells are suppressed, same as the route-risk export", () => {
  const rows = buildPriorityQueue([haz("a", 38.1)], [], contribs("a", "d1", "d2"), OPTS);
  assert.deepEqual(rows, []);
});

test("retired / fixed hazards contribute nothing", () => {
  const rows = buildPriorityQueue(
    [haz("gone", 38.1, { status: "retired" })],
    [],
    contribs("gone", "d1", "d2", "d3"),
    OPTS
  );
  assert.deepEqual(rows, []);
});

test("rows carry the city and no contributor ids", () => {
  const rows = buildPriorityQueue([haz("a", 38.1)], [], contribs("a", "d1", "d2", "d3"), OPTS);
  const row = rows[0]! as unknown as Record<string, unknown>;
  assert.equal(row.city, "Bellevue, WA");
  assert.ok(!("contributors" in row));
  assert.equal(typeof row.contributorCount, "number");
});
