import type { H3Index, LatLng, BoundingBox } from "@potholeproof/shared-types";
import {
  latLngToCell,
  cellToLatLng,
  polygonToCells,
  gridDisk,
  getResolution,
} from "h3-js";

/**
 * Spatial helpers built on Uber H3. Centralises the H3 resolutions so the whole
 * system (client tile caching, hazard aggregation, tiling) agrees on cell size.
 */

/** Fine resolution for hazard cells (~res 12 ≈ a few metres, road-lane scale). */
export const HAZARD_H3_RESOLUTION = 12;

/** Coarse resolution used as the hazard-tile cache key (client pre-fetch). */
export const TILE_H3_RESOLUTION = 8;

/** Map a coordinate to its fine hazard cell. */
export function toHazardCell(location: LatLng): H3Index {
  return latLngToCell(location.lat, location.lng, HAZARD_H3_RESOLUTION);
}

/** Map a coordinate to its coarse tile cell. */
export function toTileCell(location: LatLng): H3Index {
  return latLngToCell(location.lat, location.lng, TILE_H3_RESOLUTION);
}

/** Centre point of a cell. */
export function cellCenter(cell: H3Index): LatLng {
  const [lat, lng] = cellToLatLng(cell);
  return { lat, lng };
}

/** Resolution (0–15) of a cell. */
export function resolutionOf(cell: H3Index): number {
  return getResolution(cell);
}

/** All cells intersecting an axis-aligned bounding box. */
export function cellsInBounds(
  bounds: BoundingBox,
  resolution: number = HAZARD_H3_RESOLUTION
): H3Index[] {
  const ring: [number, number][] = [
    [bounds.north, bounds.west],
    [bounds.north, bounds.east],
    [bounds.south, bounds.east],
    [bounds.south, bounds.west],
  ];
  return polygonToCells(ring, resolution);
}

/** A cell plus its neighbours out to radius `k` (k=1 → the cell + its ring). */
export function neighbors(cell: H3Index, k: number = 1): H3Index[] {
  return gridDisk(cell, k);
}

const EARTH_RADIUS_M = 6371008.8; // IUGG mean radius

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Great-circle distance between two coordinates, in metres (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, degrees clockwise from north (0–360). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(la2);
  const x =
    Math.cos(la1) * Math.sin(la2) -
    Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * The point `meters` away from `from` along `bearing` (degrees clockwise from
 * north) — the inverse of {@link distanceMeters} / {@link bearingDegrees}. Used
 * to back-date a manual report to where the hazard actually was, behind the car.
 */
export function offsetLocation(from: LatLng, bearing: number, meters: number): LatLng {
  const ang = meters / EARTH_RADIUS_M;
  const brg = toRad(bearing);
  const la1 = toRad(from.lat);
  const lo1 = toRad(from.lng);
  const la2 = Math.asin(
    Math.sin(la1) * Math.cos(ang) + Math.cos(la1) * Math.sin(ang) * Math.cos(brg)
  );
  const lo2 =
    lo1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(ang) * Math.cos(la1),
      Math.cos(ang) - Math.sin(la1) * Math.sin(la2)
    );
  return { lat: toDeg(la2), lng: ((toDeg(lo2) + 540) % 360) - 180 };
}
