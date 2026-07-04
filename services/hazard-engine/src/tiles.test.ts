import { test } from "node:test";
import assert from "node:assert/strict";
import type { HazardRecord, LatLng } from "@potholeproof/shared-types";
import { bundleTiles } from "./tiles.js";

const ISO = "2026-07-03T21:00:00.000Z";

/** Coarse ~5 km grid so nearby points share a tile. */
function tileOf(loc: LatLng): string {
  return `${Math.round(loc.lat * 20)}:${Math.round(loc.lng * 20)}`;
}

function haz(
  lat: number,
  lng: number,
  over: Partial<HazardRecord> = {}
): HazardRecord {
  return {
    id: "h",
    h3Cell: "c",
    location: { lat, lng },
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

const OPTS = { tileOf, generatedAt: ISO, ttlSeconds: 300 };

test("hazards in the same tile bundle together, sorted by id", () => {
  const tiles = bundleTiles(
    [haz(37.775, -122.419, { id: "b" }), haz(37.7752, -122.4188, { id: "a" })],
    OPTS
  );
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0]!.hazards.length, 2);
  assert.deepEqual(tiles[0]!.hazards.map((h) => h.id), ["a", "b"]);
  assert.equal(tiles[0]!.ttlSeconds, 300);
  assert.equal(tiles[0]!.generatedAt, ISO);
});

test("hazards in different tiles produce separate, cell-sorted bundles", () => {
  const tiles = bundleTiles(
    [haz(38.0, -122.0, { id: "x" }), haz(37.7749, -122.4194, { id: "y" })],
    OPTS
  );
  assert.equal(tiles.length, 2);
  const cells = tiles.map((t) => t.h3Cell);
  assert.deepEqual([...cells].sort(), cells); // already sorted
});

test("retired hazards are excluded by default, included on request", () => {
  const input = [
    haz(37.7749, -122.4194, { id: "act" }),
    haz(37.7749, -122.4194, { id: "ret", status: "retired" }),
  ];
  const active = bundleTiles(input, OPTS);
  assert.equal(active.reduce((n, t) => n + t.hazards.length, 0), 1);
  const all = bundleTiles(input, { ...OPTS, activeOnly: false });
  assert.equal(all.reduce((n, t) => n + t.hazards.length, 0), 2);
});

test("empty input yields no tiles", () => {
  assert.deepEqual(bundleTiles([], OPTS), []);
});
