# services/routing

Hazard-aware routing behind the `RoutingAdapter` contract from
`@potholeproof/shared-types`.

- **MVP:** `MapboxRoutingAdapter` (Mapbox Directions) for speed-to-market.
- **Later:** self-hosted `ValhallaRoutingAdapter` with dynamic costing that
  injects hazard density/severity as an edge penalty for the user-controlled
  "avoid severe road damage" preference.

The adapter boundary keeps either engine swappable. **Phase 2.**

## Implemented

- `scoring.ts` — pure hazard-aware route scoring the adapter layers on top of
  whichever engine returns candidate routes:
  - `pointToSegmentMeters` / `pathLengthMeters` — planar geometry helpers.
  - `routeHazardExposure(path, hazards)` — 0..1 exposure: active hazards within
    the corridor contribute `severity × confidence × falloff`, saturated to a
    bounded score.
  - `scoreRoute` / `chooseRoute` — blend distance with exposure per
    `RoutePreferences` (`avoidSevereRoadDamage`, `hazardAvoidanceWeight`);
    avoidance-off picks the shortest, avoidance-on penalises hazardous routes.

Tested with `node --test` (5 cases). Still to come: the Mapbox/Valhalla adapter
that fetches candidate routes for these functions to rank.
