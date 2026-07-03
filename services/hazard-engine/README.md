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
