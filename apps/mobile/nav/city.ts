import type { LatLng } from "@potholeproof/shared-types";

/**
 * Demo-scoped city lookup — a small hardcoded bounding-box table, not a real
 * geocoder call. `nav/geocode.ts`'s `reverseGeocode` returns a full address
 * string, not a clean jurisdiction field, and this app's civic-reporting
 * story only needs "which city do we mock-file this with." Covers both this
 * app's actual demo-drive location (Bellevue, WA) and services/civic's
 * documented SF311 pilot target.
 */
interface CityBounds {
  name: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const CITIES: CityBounds[] = [
  { name: "Bellevue, WA", minLat: 47.55, maxLat: 47.68, minLng: -122.24, maxLng: -122.1 },
  { name: "San Francisco, CA", minLat: 37.7, maxLat: 37.83, minLng: -122.52, maxLng: -122.35 },
];

export function cityOf(loc: LatLng): string {
  for (const c of CITIES) {
    if (loc.lat >= c.minLat && loc.lat <= c.maxLat && loc.lng >= c.minLng && loc.lng <= c.maxLng) {
      return c.name;
    }
  }
  return "Unincorporated area";
}
