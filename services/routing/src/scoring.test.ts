import { test } from "node:test";
import assert from "node:assert/strict";
import type { HazardRecord, LatLng, RoutePreferences } from "@potholeproof/shared-types";
import {
  pointToSegmentMeters,
  pathLengthMeters,
  routeHazardExposure,
  chooseRoute,
} from "./scoring.js";

const BASE: LatLng = { lat: 37.7749, lng: -122.4194 };
const ISO = "2026-07-03T09:00:00.000Z";

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
    severity: 0.9,
    severityBand: "severe",
    confidence: 0.9,
    status: "active",
    firstSeen: ISO,
    lastConfirmed: ISO,
    passCount: 5,
    cleanPassCount: 0,
    modelVersion: "v0",
    ...over,
  };
}

const AVOID_OFF: RoutePreferences = { avoidSevereRoadDamage: false };
const AVOID_STRONG: RoutePreferences = {
  avoidSevereRoadDamage: true,
  hazardAvoidanceWeight: 10,
};

test("pointToSegmentMeters: on-segment ≈ 0, perpendicular, past-endpoint", () => {
  const a = BASE;
  const b = offset(BASE, 200, 0);
  assert.ok(pointToSegmentMeters(offset(BASE, 100, 0), a, b) < 1);
  assert.ok(Math.abs(pointToSegmentMeters(offset(BASE, 100, 10), a, b) - 10) < 1);
  // 50 m past the far endpoint → distance to that endpoint (~50 m)
  assert.ok(Math.abs(pointToSegmentMeters(offset(BASE, 250, 0), a, b) - 50) < 1);
});

test("pathLengthMeters sums segment lengths", () => {
  const len = pathLengthMeters([BASE, offset(BASE, 200, 0), offset(BASE, 200, 60)]);
  assert.ok(Math.abs(len - 260) < 3, `len ${len}`);
});

test("exposure rises for hazards on the path, ~0 for far ones, and is bounded", () => {
  const path = [BASE, offset(BASE, 300, 0)];
  const onPath = routeHazardExposure(path, [haz(offset(BASE, 150, 0))]);
  const farOff = routeHazardExposure(path, [haz(offset(BASE, 150, 100))]);
  assert.ok(onPath > 0.1, `onPath ${onPath}`);
  assert.equal(farOff, 0);
  const many = routeHazardExposure(path, [
    haz(offset(BASE, 100, 0)),
    haz(offset(BASE, 150, 0)),
    haz(offset(BASE, 200, 0)),
  ]);
  assert.ok(many > onPath); // monotonic
  assert.ok(many < 1); // bounded
});

test("retired hazards don't affect exposure", () => {
  const path = [BASE, offset(BASE, 300, 0)];
  const exposure = routeHazardExposure(path, [
    haz(offset(BASE, 150, 0), { status: "retired" }),
  ]);
  assert.equal(exposure, 0);
});

test("chooseRoute: shortest when avoidance off, cleaner when strongly on", () => {
  // Route A: short + straight, but a severe hazard sits on it.
  const routeA = [BASE, offset(BASE, 200, 0)];
  // Route B: a longer detour 60 m to the side, clear of the hazard.
  const routeB = [
    BASE,
    offset(BASE, 0, 60),
    offset(BASE, 200, 60),
    offset(BASE, 200, 0),
  ];
  const hazards = [haz(offset(BASE, 100, 0))];

  const off = chooseRoute([routeA, routeB], hazards, AVOID_OFF);
  assert.equal(off.index, 0); // A is shorter

  const on = chooseRoute([routeA, routeB], hazards, AVOID_STRONG);
  assert.equal(on.index, 1); // avoid the hazardous short route
  assert.ok(on.scores[0]!.hazardExposureScore > on.scores[1]!.hazardExposureScore);
});
