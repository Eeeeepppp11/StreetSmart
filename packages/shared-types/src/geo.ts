/** WGS84 latitude/longitude in decimal degrees. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Compass heading in degrees clockwise from true north (0–360). */
export type HeadingDegrees = number;

/**
 * H3 cell index (Uber H3) in hex-string form, e.g. "8a2a1072b59ffff".
 * The canonical unit of spatial aggregation, tiling, and hazard lookup.
 * Resolution is centralised in `@potholeproof/geo`.
 */
export type H3Index = string;

/** Axis-aligned geographic bounding box. */
export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}
