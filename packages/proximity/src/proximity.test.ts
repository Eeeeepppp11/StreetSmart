import { test } from "node:test";
import assert from "node:assert/strict";
import type { HazardRecord, LatLng } from "@potholeproof/shared-types";
import { upcomingHazards, type VehicleState } from "./index.js";

const BASE: LatLng = { lat: 37.7749, lng: -122.4194 };
const ISO = "2026-07-03T09:00:00.000Z";

/** A point `northM` metres north and `eastM` metres east of `base`. */
function offset(base: LatLng, northM: number, eastM: number): LatLng {
  return {
    lat: base.lat + northM / 111320,
    lng: base.lng + eastM / (111320 * Math.cos((base.lat * Math.PI) / 180)),
  };
}

function haz(location: LatLng, over: Partial<HazardRecord> = {}): HazardRecord {
  return {
    id: "h",
    h3Cell: "c",
    location,
    severity: 0.5,
    severityBand: "moderate",
    confidence: 0.8,
    status: "active",
    firstSeen: ISO,
    lastConfirmed: ISO,
    passCount: 3,
    cleanPassCount: 0,
    modelVersion: "v0",
    ...over,
  };
}

// Driving due north at 20 m/s (lookahead = 20*12 = 240 m).
const NORTHBOUND: VehicleState = {
  position: BASE,
  headingDegrees: 0,
  speedMps: 20,
};

test("hazard straight ahead → one alert, side 'ahead', sensible ETA", () => {
  const alerts = upcomingHazards(NORTHBOUND, [haz(offset(BASE, 100, 0))]);
  assert.equal(alerts.length, 1);
  const a = alerts[0]!;
  assert.equal(a.side, "ahead");
  assert.ok(Math.abs(a.alongTrackMeters - 100) < 2, `along ${a.alongTrackMeters}`);
  assert.ok(Math.abs(a.etaSeconds - 5) < 0.3, `eta ${a.etaSeconds}`);
});

test("hazard behind the vehicle → no alert", () => {
  const alerts = upcomingHazards(NORTHBOUND, [haz(offset(BASE, -100, 0))]);
  assert.equal(alerts.length, 0);
});

test("hazard off to the side beyond the corridor → no alert", () => {
  const alerts = upcomingHazards(NORTHBOUND, [haz(offset(BASE, 100, 50))]);
  assert.equal(alerts.length, 0);
});

test("hazard slightly right but within the corridor → side 'right'", () => {
  const alerts = upcomingHazards(NORTHBOUND, [haz(offset(BASE, 100, 8))]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.side, "right");
});

test("hazard beyond lookahead range → no alert", () => {
  const alerts = upcomingHazards(NORTHBOUND, [haz(offset(BASE, 600, 0))]);
  assert.equal(alerts.length, 0);
});

test("low-confidence and retired hazards are filtered out", () => {
  const lowConf = upcomingHazards(NORTHBOUND, [
    haz(offset(BASE, 100, 0), { confidence: 0.2 }),
  ]);
  assert.equal(lowConf.length, 0);
  const retired = upcomingHazards(NORTHBOUND, [
    haz(offset(BASE, 100, 0), { status: "retired" }),
  ]);
  assert.equal(retired.length, 0);
});

test("multiple hazards ahead are returned nearest-first", () => {
  const alerts = upcomingHazards(NORTHBOUND, [
    haz(offset(BASE, 150, 0), { id: "far" }),
    haz(offset(BASE, 50, 0), { id: "near" }),
  ]);
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0]!.hazard.id, "near");
  assert.equal(alerts[1]!.hazard.id, "far");
});

test("stopped vehicle still gets a min-range warning, ETA is Infinity", () => {
  const stopped: VehicleState = { position: BASE, headingDegrees: 0, speedMps: 0 };
  const alerts = upcomingHazards(stopped, [haz(offset(BASE, 50, 0))]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.etaSeconds, Infinity);
});
