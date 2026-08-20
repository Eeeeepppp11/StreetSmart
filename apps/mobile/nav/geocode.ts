import type { LatLng } from "@potholeproof/shared-types";

/**
 * Nominatim (OpenStreetMap) geocoding adapter — the tokenless pilot stand-in
 * for a paid geocoder, exactly as osrm.ts stands in for Mapbox Directions.
 * Vendor request/response shapes stay inside this file; everything else
 * consumes GeocodeResult.
 *
 * Privacy: a search request carries only the typed query text or a single
 * lat/lng pair — never the drive track, never an identifier.
 *
 * The public instance has no SLA and requires a custom User-Agent per its
 * usage policy (https://operations.osmfoundation.org/policies/nominatim/);
 * failures surface as a thrown Error the UI turns into an inline message.
 */
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const USER_AGENT = "PotholeProof-Warning-App";

/** Minimal structural fetch type so the adapter stays injectable/testable. */
type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> }
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

interface NominatimSearchResult {
  display_name: string;
  lat: string;
  lon: string;
}

interface NominatimReverseResult {
  display_name?: string;
  error?: string;
}

/** An address match, engine-agnostic. */
export interface GeocodeResult {
  label: string;
  location: LatLng;
}

function headers(): { headers: Record<string, string> } {
  return { headers: { "User-Agent": USER_AGENT } };
}

/** Parse a raw Nominatim /search response into engine-agnostic results. */
export function parseSearchResults(raw: unknown): GeocodeResult[] {
  if (!Array.isArray(raw)) {
    throw new Error("geocoder error: malformed response");
  }
  return (raw as NominatimSearchResult[]).map((r) => ({
    label: r.display_name,
    location: { lat: Number(r.lat), lng: Number(r.lon) },
  }));
}

/** Parse a raw Nominatim /reverse response into a display label. */
export function parseReverseResult(raw: unknown): string {
  const res = raw as NominatimReverseResult;
  if (!res.display_name) {
    throw new Error(res.error ?? "geocoder error: no match for this location");
  }
  return res.display_name;
}

/**
 * Search for addresses matching free-text `query`. One-shot — debouncing
 * while the user types is a UI concern, not this adapter's.
 */
export async function searchAddress(
  query: string,
  fetchImpl: FetchLike = fetch
): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(trimmed)}&format=json&limit=5`;
  const res = await fetchImpl(url, headers());
  if (!res.ok) throw new Error(`geocoder HTTP ${res.status}`);
  return parseSearchResults(await res.json());
}

/** Reverse-geocode a coordinate into a human-readable label. */
export async function reverseGeocode(
  location: LatLng,
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const url = `${NOMINATIM_BASE}/reverse?lat=${location.lat}&lon=${location.lng}&format=json`;
  const res = await fetchImpl(url, headers());
  if (!res.ok) throw new Error(`geocoder HTTP ${res.status}`);
  return parseReverseResult(await res.json());
}
