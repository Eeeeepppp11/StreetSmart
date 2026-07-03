# @potholeproof/geo

Shared spatial helpers built on **Uber H3**. Centralises the H3 resolutions so
the client, hazard engine, and tile service all agree on cell size.

- `HAZARD_H3_RESOLUTION` (~res 12) — fine cells for individual hazards.
- `TILE_H3_RESOLUTION` (~res 8) — coarse cells used as offline tile cache keys.

Implement the stubs in `src/index.ts` by adding `h3-js` as a dependency.
