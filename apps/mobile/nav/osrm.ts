import type { LatLng } from "@potholeproof/shared-types";
import type { NavRoute, NavStep } from "./types.js";

/**
 * OSRM routing adapter — the tokenless pilot stand-in for the Mapbox
 * Directions adapter targeted by decision-log #1, exactly as react-native-maps
 * stands in for @rnmapbox/maps. OSRM request/response shapes stay inside this
 * file; everything else consumes NavRoute.
 *
 * Privacy: a request carries only the origin and destination coordinates of
 * this one route — never the drive track, never an identifier.
 *
 * The public demo server has no SLA; failures surface as a thrown Error the
 * UI turns into "try again".
 */
const OSRM_BASE = "https://router.project-osrm.org";

/** Minimal structural fetch type so the adapter stays injectable/testable. */
type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

interface OsrmManeuver {
  location: [number, number]; // [lng, lat]
  type: string;
  modifier?: string;
  exit?: number;
}
interface OsrmStep {
  name: string;
  distance: number;
  maneuver: OsrmManeuver;
}
interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
  legs: { steps: OsrmStep[] }[];
}
interface OsrmResponse {
  code: string;
  routes?: OsrmRoute[];
}

function withRoad(base: string, name: string | undefined): string {
  return name ? `${base} onto ${name}` : base;
}

/** Synthesise a spoken/banner instruction from an OSRM maneuver. */
export function formatInstruction(step: OsrmStep): string {
  const { type, modifier, exit } = step.maneuver;
  const name = step.name || undefined;
  if (modifier === "uturn") return "Make a U-turn";
  switch (type) {
    case "depart":
      return name ? `Head out on ${name}` : "Head out";
    case "arrive":
      return "Arrive at your destination";
    case "turn":
    case "end of road":
      return modifier && modifier !== "straight"
        ? withRoad(`Turn ${modifier}`, name)
        : withRoad("Continue", name);
    case "new name":
    case "continue":
      return withRoad("Continue", name);
    case "merge":
      return withRoad(modifier ? `Merge ${modifier}` : "Merge", name);
    case "on ramp":
      return withRoad("Take the ramp", name);
    case "off ramp":
      return withRoad("Take the exit", name);
    case "fork":
      return `Keep ${modifier ?? "straight"} at the fork${name ? ` toward ${name}` : ""}`;
    case "roundabout":
    case "rotary":
    case "roundabout turn":
      return exit
        ? `At the roundabout, take exit ${exit}`
        : "Go through the roundabout";
    default:
      return withRoad("Continue", name);
  }
}

/** Parse a raw OSRM /route response into engine-agnostic NavRoutes. */
export function parseOsrmRoutes(raw: unknown): NavRoute[] {
  const res = raw as OsrmResponse;
  if (res.code !== "Ok" || !Array.isArray(res.routes)) {
    throw new Error(`routing engine error: ${res.code ?? "malformed response"}`);
  }
  return res.routes.map((route) => {
    const path: LatLng[] = route.geometry.coordinates.map(([lng, lat]) => ({
      lat,
      lng,
    }));
    const steps: NavStep[] = [];
    let offset = 0;
    for (const leg of route.legs) {
      for (const step of leg.steps) {
        steps.push({
          instruction: formatInstruction(step),
          location: {
            lat: step.maneuver.location[1],
            lng: step.maneuver.location[0],
          },
          metersFromStart: offset, // maneuver happens at the step's start
          type: step.maneuver.type,
        });
        offset += step.distance;
      }
    }
    return {
      path,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      steps,
    };
  });
}

/**
 * Fetch driving route alternatives origin → destination. Never called from
 * the alert hot path — routing is a user-initiated planning/reroute action.
 */
export async function fetchRouteAlternatives(
  origin: LatLng,
  destination: LatLng,
  fetchImpl: FetchLike = fetch
): Promise<NavRoute[]> {
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = `${OSRM_BASE}/route/v1/driving/${coords}?alternatives=true&overview=full&geometries=geojson&steps=true`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`routing engine HTTP ${res.status}`);
  return parseOsrmRoutes(await res.json());
}
