import type { H3Index, LatLng, BoundingBox } from "@potholeproof/shared-types";

/**
 * Spatial helpers for hazard aggregation. These centralise the H3 resolution
 * so the entire system (client caching, backend aggregation, tiling) agrees
 * on cell size. Implementations wrap Uber H3 (`h3-js`) — add that dependency
 * when implementing.
 */

/** Fine resolution for hazard cells (~res 12 ≈ a few metres, road-lane scale). */
export const HAZARD_H3_RESOLUTION = 12;

/** Coarse resolution used as the hazard-tile cache key (client pre-fetch). */
export const TILE_H3_RESOLUTION = 8;

/** Map a coordinate to its fine hazard cell. TODO: wrap h3-js `latLngToCell`. */
export function toHazardCell(_location: LatLng): H3Index {
  throw new Error(
    "not implemented: wrap h3-js latLngToCell at HAZARD_H3_RESOLUTION"
  );
}

/** Map a coordinate to its coarse tile cell. TODO: wrap h3-js `latLngToCell`. */
export function toTileCell(_location: LatLng): H3Index {
  throw new Error(
    "not implemented: wrap h3-js latLngToCell at TILE_H3_RESOLUTION"
  );
}

/** All hazard cells intersecting a bounding box. TODO: wrap h3-js `polygonToCells`. */
export function cellsInBounds(
  _bounds: BoundingBox,
  _resolution: number = HAZARD_H3_RESOLUTION
): H3Index[] {
  throw new Error("not implemented: wrap h3-js polygonToCells");
}
