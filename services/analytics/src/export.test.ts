import { test } from "node:test";
import assert from "node:assert/strict";
import type { HazardRecord, LatLng } from "@potholeproof/shared-types";
import { buildMunicipalExport, type HazardContribution } from "./export.js";

const ISO = "2026-07-04T10:00:00.000Z";
const LATER = "2026-07-04T12:00:00.000Z";

function haz(
  id: string,
  lat: number,
  over: Partial<HazardRecord> = {}
): HazardRecord {
  return {
    id,
    h3Cell: "fine",
    location: { lat, lng: -122.4 },
    severity: 0.5,
    severityBand: "moderate",
    confidence: 0.8,
    status: "active",
    firstSeen: ISO,
    lastConfirmed: ISO,
    passCount: 4,
    cleanPassCount: 0,
    modelVersion: "v0",
    ...over,
  };
}

function contribs(hazardId: string, ...devices: string[]): HazardContribution[] {
  return devices.map((anonDeviceId) => ({ hazardId, anonDeviceId }));
}

// Cell = whole-degree latitude band; district mirrors it.
const OPTS = {
  tileOf: (loc: LatLng) => `cell-${Math.floor(loc.lat)}`,
  districtOf: (loc: LatLng) => (loc.lat >= 38 ? "North" : "South"),
  k: 3,
};

test("aggregates per cell with severity stats and open/fixed counts", () => {
  const hazards = [
    haz("a", 38.1, { severity: 0.9 }),
    haz("b", 38.2, { severity: 0.5, status: "reported", lastConfirmed: LATER }),
    haz("c", 38.3, { severity: 0.2, status: "retired" }),
  ];
  const contributions = [
    ...contribs("a", "d1", "d2"),
    ...contribs("b", "d3"),
    ...contribs("c", "d4"),
  ];
  const rows = buildMunicipalExport(hazards, contributions, OPTS);
  assert.equal(rows.length, 1);
  const r = rows[0]!;
  assert.equal(r.h3Cell, "cell-38");
  assert.equal(r.district, "North");
  assert.equal(r.openHazards, 2); // active + reported
  assert.equal(r.fixedHazards, 1); // retired
  assert.equal(r.maxSeverity, 0.9);
  assert.equal(r.meanSeverity, 0.7); // (0.9+0.5)/2
  assert.equal(r.contributorCount, 4);
  assert.equal(r.lastConfirmed, LATER);
});

test("suppresses cells with fewer than k distinct contributors", () => {
  // 3 contributions but only 2 distinct devices → suppressed at k=3.
  const rows = buildMunicipalExport(
    [haz("a", 38.1)],
    contribs("a", "d1", "d1", "d2"),
    OPTS
  );
  assert.deepEqual(rows, []);
});

test("suppression is per cell — safe cells still export", () => {
  const hazards = [haz("thin", 37.1), haz("rich", 38.1)];
  const contributions = [
    ...contribs("thin", "d1"),
    ...contribs("rich", "d1", "d2", "d3"),
  ];
  const rows = buildMunicipalExport(hazards, contributions, OPTS);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.h3Cell, "cell-38");
});

test("rows never contain contributor ids or fine coordinates", () => {
  const rows = buildMunicipalExport(
    [haz("a", 38.1)],
    contribs("a", "d1", "d2", "d3"),
    OPTS
  );
  const row = rows[0]! as unknown as Record<string, unknown>;
  assert.ok(!("location" in row));
  assert.ok(!("anonDeviceId" in row));
  assert.ok(!("contributors" in row));
  assert.equal(typeof row.contributorCount, "number");
});

test("a cell of only fixed hazards exports with null severity stats", () => {
  const rows = buildMunicipalExport(
    [haz("f", 38.1, { status: "verified_fixed" })],
    contribs("f", "d1", "d2", "d3"),
    OPTS
  );
  assert.equal(rows[0]!.openHazards, 0);
  assert.equal(rows[0]!.fixedHazards, 1);
  assert.equal(rows[0]!.maxSeverity, null);
  assert.equal(rows[0]!.meanSeverity, null);
});
