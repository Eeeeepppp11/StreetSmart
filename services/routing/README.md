# services/routing

Hazard-aware routing behind the `RoutingAdapter` contract from
`@potholeproof/shared-types`.

- **MVP:** `MapboxRoutingAdapter` (Mapbox Directions) for speed-to-market.
- **Later:** self-hosted `ValhallaRoutingAdapter` with dynamic costing that
  injects hazard density/severity as an edge penalty for the user-controlled
  "avoid severe road damage" preference.

The adapter boundary keeps either engine swappable. **Phase 2.**
