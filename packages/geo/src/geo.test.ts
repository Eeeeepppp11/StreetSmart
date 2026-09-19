import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toHazardCell,
  toTileCell,
  cellCenter,
  resolutionOf,
  cellsInBounds,
  neighbors,
  distanceMeters,
  bearingDegrees,
  offsetLocation,
  HAZARD_H3_RESOLUTION,
  TILE_H3_RESOLUTION,
} from "./index.js";

const SF = { lat: 37.7749, lng: -122.4194 };

test("hazard cell is deterministic and at the hazard resolution", () => {
  const c = toHazardCell(SF);
  assert.equal(typeof c, "string");
  assert.equal(toHazardCell(SF), c);
  assert.equal(resolutionOf(c), HAZARD_H3_RESOLUTION);
});

test("far-apart points map to different hazard cells", () => {
  assert.notEqual(toHazardCell(SF), toHazardCell({ lat: SF.lat + 0.1, lng: SF.lng }));
});

test("tile cell is coarser than the hazard cell", () => {
  assert.equal(resolutionOf(toTileCell(SF)), TILE_H3_RESOLUTION);
  assert.ok(TILE_H3_RESOLUTION < HAZARD_H3_RESOLUTION);
});

test("cellCenter round-trips back into the same cell", () => {
  const c = toHazardCell(SF);
  assert.equal(toHazardCell(cellCenter(c)), c);
});

test("neighbors(k=1) returns the cell plus its ring of 6", () => {
  const c = toHazardCell(SF);
  const ns = neighbors(c, 1);
  assert.ok(ns.includes(c));
  assert.equal(ns.length, 7);
});

test("cellsInBounds covers a small box at the requested resolution", () => {
  const cells = cellsInBounds(
    { south: 37.77, west: -122.42, north: 37.78, east: -122.41 },
    10
  );
  assert.ok(cells.length > 0);
  for (const c of cells) assert.equal(resolutionOf(c), 10);
});

test("distanceMeters: zero for same point, ~111 km per degree of latitude", () => {
  assert.equal(distanceMeters(SF, SF), 0);
  const oneDegNorth = distanceMeters(SF, { lat: SF.lat + 1, lng: SF.lng });
  assert.ok(Math.abs(oneDegNorth - 111195) < 500, `got ${oneDegNorth}`);
});

test("bearingDegrees: north ≈ 0, east ≈ 90", () => {
  const north = bearingDegrees(SF, { lat: SF.lat + 0.1, lng: SF.lng });
  const east = bearingDegrees(SF, { lat: SF.lat, lng: SF.lng + 0.1 });
  assert.ok(north < 1 || north > 359, `north bearing ${north}`);
  assert.ok(Math.abs(east - 90) < 1, `east bearing ${east}`);
});

test("offsetLocation moves the requested distance along the bearing", () => {
  const a = { lat: 37.7749, lng: -122.4194 };
  const b = offsetLocation(a, 90, 100);
  assert.ok(Math.abs(distanceMeters(a, b) - 100) < 0.5);
  assert.ok(Math.abs(bearingDegrees(a, b) - 90) < 0.5);
  const c = offsetLocation(a, 0, 50);
  assert.ok(c.lat > a.lat && Math.abs(c.lng - a.lng) < 1e-9);
});

test("offsetLocation with zero distance is the same point", () => {
  const a = { lat: 37.7749, lng: -122.4194 };
  const b = offsetLocation(a, 123, 0);
  assert.ok(distanceMeters(a, b) < 1e-6);
});
