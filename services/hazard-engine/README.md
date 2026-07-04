# services/hazard-engine

The self-healing map's brain. Consumes `JoltEvent`s from the queue and, per H3
cell, maintains `confidence`, `severity`, `passCount`, `cleanPassCount`,
`firstSeen`, `lastConfirmed`.

- Detections raise confidence (Bayesian-style update).
- **Clean passes** (traversing a known hazard cell without a jolt) lower it.
- Scheduled decay jobs **auto-retire** hazards below threshold — no manual
  moderation.

Serves `HazardTile`s (H3-indexed GeoJSON/vector tiles, Redis-cached) so clients
run proximity alerts offline. **Phase 2.**

## Implemented

- `engine.ts` — `HazardEngine`, the in-memory confidence / self-heal core (pure,
  deterministic; a production deploy persists the same logic to PostGIS):
  - `ingestEvent(JoltEvent)` — aggregate a detection into its H3 cell; raise
    confidence (Beta-smoothed: `(hitScore + α) / (hitScore + missWeight·cleanPasses
    + α + β)`), aggregate confidence-weighted severity, track first/last seen.
  - `ingestCleanPass(cell)` / `observeClean(loc)` — lower confidence; auto-retire
    once it collapses past the threshold with enough clean passes.
  - `active()` / `all()` / `get(cell)` — the map the client + alerts consume.
  - Cell assignment is injected (`cellOf`); wire `geo.toHazardCell` in production.

Tested with `node --test` (9 cases: creation, aggregation, retire, reactivation,
severity banding, timestamp tracking, no internal-field leakage). Still to come:
the queue consumer, PostGIS persistence, and the hazard-tile service.
