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
