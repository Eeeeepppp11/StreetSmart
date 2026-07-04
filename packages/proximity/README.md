# @potholeproof/proximity

The **on-device proximity-alert engine** — the "pothole ahead in 200 ft, right
lane" warning that gives the app a reason to be open every drive. Pure,
deterministic geometry, so it runs on every GPS tick against the client's cached
hazard tiles with no network.

## API

`upcomingHazards(vehicle, hazards, config?) → ProximityAlert[]`

Given the vehicle's `position` / `headingDegrees` / `speedMps` and a set of
`HazardRecord`s, returns the active hazards that are:

- **ahead** (positive along-track distance in the heading direction),
- **in the path corridor** (small lateral / cross-track offset),
- **within lookahead range** (`speed × leadSeconds`, floored/capped), and
- above the confidence/severity thresholds,

sorted nearest-first, each with along/cross-track distance, ETA, and which
`side` (ahead / left / right). Uses `@potholeproof/geo` for distance + bearing.

Tested with `node --test` (8 cases: ahead/behind/side, corridor, range,
confidence + status filtering, nearest-first ordering, stopped vehicle).
