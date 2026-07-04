import type {
  HazardRecord,
  HazardTile,
  H3Index,
  LatLng,
  ISODateString,
} from "@potholeproof/shared-types";

export interface TileBundleOptions {
  /** Map a hazard location to its coarse tile cell — pass `geo.toTileCell`. */
  tileOf: (loc: LatLng) => H3Index;
  generatedAt: ISODateString;
  ttlSeconds: number;
  /** Include only active hazards (default true). */
  activeOnly?: boolean;
}

/**
 * Group hazards into per-tile bundles that clients pre-fetch and cache, so
 * proximity alerts run offline against local data. Deterministic: tiles are
 * ordered by cell and hazards within a tile by id.
 */
export function bundleTiles(
  hazards: readonly HazardRecord[],
  options: TileBundleOptions
): HazardTile[] {
  const activeOnly = options.activeOnly ?? true;
  const groups = new Map<H3Index, HazardRecord[]>();

  for (const h of hazards) {
    if (activeOnly && h.status !== "active") continue;
    const key = options.tileOf(h.location);
    const arr = groups.get(key);
    if (arr) arr.push(h);
    else groups.set(key, [h]);
  }

  const tiles: HazardTile[] = [];
  for (const [h3Cell, hs] of groups) {
    hs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    tiles.push({
      h3Cell,
      hazards: hs,
      generatedAt: options.generatedAt,
      ttlSeconds: options.ttlSeconds,
    });
  }
  tiles.sort((a, b) => (a.h3Cell < b.h3Cell ? -1 : a.h3Cell > b.h3Cell ? 1 : 0));
  return tiles;
}
