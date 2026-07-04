import { test } from "node:test";
import assert from "node:assert/strict";
import type { CivicReport, HazardRecord, LatLng } from "@potholeproof/shared-types";
import { buildScorecard } from "./scorecard.js";

const ISO0 = "2026-07-01T00:00:00.000Z";

function haz(id: string, lat: number): HazardRecord {
  return {
    id,
    h3Cell: "c",
    location: { lat, lng: -122.4 },
    severity: 0.7,
    severityBand: "severe",
    confidence: 0.8,
    status: "reported",
    firstSeen: ISO0,
    lastConfirmed: ISO0,
    passCount: 5,
    cleanPassCount: 0,
    modelVersion: "v0",
  };
}

function rep(
  hazardId: string,
  status: CivicReport["status"],
  over: Partial<CivicReport> = {}
): CivicReport {
  return { id: `r-${hazardId}`, hazardId, provider: "open311", status, ...over };
}

// North of 37.9 → "Northside", else "Southside".
const districtOf = (loc: LatLng) => (loc.lat > 37.9 ? "Northside" : "Southside");
const OPTS = { districtOf, asOf: "2026-07-11T00:00:00.000Z" };

test("groups by district with correct counts and repair stats", () => {
  const hazards = [haz("n1", 38.0), haz("n2", 38.1), haz("n3", 38.2), haz("s1", 37.7)];
  const reports = [
    // Northside: closed in 2 days, closed in 6 days, open for 10 days.
    rep("n1", "closed", { submittedAt: ISO0, closedAt: "2026-07-03T00:00:00.000Z" }),
    rep("n2", "closed", { submittedAt: ISO0, closedAt: "2026-07-07T00:00:00.000Z" }),
    rep("n3", "submitted", { submittedAt: ISO0 }),
    // Southside: rejected.
    rep("s1", "rejected", { submittedAt: ISO0 }),
  ];
  const rows = buildScorecard(reports, hazards, OPTS);
  assert.deepEqual(rows.map((r) => r.district), ["Northside", "Southside"]);

  const north = rows[0]!;
  assert.equal(north.reported, 3);
  assert.equal(north.open, 1);
  assert.equal(north.closed, 2);
  assert.equal(north.medianRepairDays, 4); // (2+6)/2
  assert.equal(north.meanRepairDays, 4);
  assert.equal(north.oldestOpenDays, 10);

  const south = rows[1]!;
  assert.equal(south.rejected, 1);
  assert.equal(south.open, 0);
  assert.equal(south.medianRepairDays, null);
});

test("odd count uses the true median", () => {
  const hazards = [haz("a", 38), haz("b", 38), haz("c", 38)];
  const reports = [
    rep("a", "closed", { submittedAt: ISO0, closedAt: "2026-07-02T00:00:00.000Z" }), // 1d
    rep("b", "closed", { submittedAt: ISO0, closedAt: "2026-07-04T00:00:00.000Z" }), // 3d
    rep("c", "closed", { submittedAt: ISO0, closedAt: "2026-07-31T00:00:00.000Z" }), // 30d
  ];
  const rows = buildScorecard(reports, hazards, OPTS);
  assert.equal(rows[0]!.medianRepairDays, 3);
  assert.ok(rows[0]!.meanRepairDays! > 10); // mean dragged by the outlier
});

test("reports with unknown hazards land in the 'unknown' bucket", () => {
  const rows = buildScorecard([rep("ghost", "submitted")], [], OPTS);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.district, "unknown");
  assert.equal(rows[0]!.open, 1);
});

test("acknowledged / in_progress count as open", () => {
  const hazards = [haz("a", 38), haz("b", 38)];
  const rows = buildScorecard(
    [rep("a", "acknowledged", { submittedAt: ISO0 }), rep("b", "in_progress")],
    hazards,
    OPTS
  );
  assert.equal(rows[0]!.open, 2);
});

test("empty input yields no rows", () => {
  assert.deepEqual(buildScorecard([], [], OPTS), []);
});
