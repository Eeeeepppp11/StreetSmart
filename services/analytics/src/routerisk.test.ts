import { test } from "node:test";
import assert from "node:assert/strict";
import type { HazardRecord, LatLng } from "@potholeproof/shared-types";
import { buildRouteRiskExport } from "./routerisk.js";
import type { HazardContribution } from "./export.js";

const ASOF = "2026-07-04T12:00:00.000Z";
const FRESH = "2026-07-03T12:00:00.000Z"; // 1 day old
const STALE = "2026-01-05T12:00:00.000Z"; // ~180 days old

function haz(
  id: string,
  lat: number,
  over: Partial<HazardRecord> = {}
): HazardRecord {
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

const OPTS = {
  tileOf: (loc: LatLng) => `cell-${Math.floor(loc.lat)}`,
  k: 3,
  asOf: ASOF,
  halfLifeDays: 30,
  riskScale: 2,
};

test("fresh severe hazards produce a bounded, positive risk score", () => {
  const rows = buildRouteRiskExport(
    [haz("a", 38.1), haz("b", 38.2)],
    [...contribs("a", "d1", "d2"), ...contribs("b", "d3")],
    OPTS
  );
  assert.equal(rows.length, 1);
  const r = rows[0]!;
  assert.ok(r.riskScore > 0.3 && r.riskScore < 1, `risk ${r.riskScore}`);
  assert.equal(r.openHazards, 2);
  assert.equal(r.severeHazards, 2);
});

test("stale evidence decays: same hazards, older timestamps → lower risk", () => {
  const contributions = contribs("a", "d1", "d2", "d3");
  const fresh = buildRouteRiskExport([haz("a", 38.1)], contributions, OPTS);
  const stale = buildRouteRiskExport(
    [haz("a", 38.1, { lastConfirmed: STALE })],
    contributions,
    OPTS
  );
  assert.ok(
    stale[0]!.riskScore < fresh[0]!.riskScore / 4,
    `stale ${stale[0]!.riskScore} vs fresh ${fresh[0]!.riskScore}`
  );
});

test("retired / fixed hazards contribute nothing", () => {
  const rows = buildRouteRiskExport(
    [haz("gone", 38.1, { status: "retired" })],
    contribs("gone", "d1", "d2", "d3"),
    OPTS
  );
  assert.deepEqual(rows, []);
});

test("under-k cells are suppressed", () => {
  const rows = buildRouteRiskExport(
    [haz("a", 38.1)],
    contribs("a", "d1", "d2"),
    OPTS
  );
  assert.deepEqual(rows, []);
});

test("rows carry no contributor ids or fine coordinates", () => {
  const rows = buildRouteRiskExport(
    [haz("a", 38.1)],
    contribs("a", "d1", "d2", "d3"),
    OPTS
  );
  const row = rows[0]! as unknown as Record<string, unknown>;
  assert.ok(!("location" in row));
  assert.ok(!("contributors" in row));
  assert.equal(typeof row.contributorCount, "number");
});
