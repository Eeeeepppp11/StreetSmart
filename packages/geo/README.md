# @potholeproof/geo

Shared spatial helpers built on **Uber H3** (`h3-js`). Centralises the H3
resolutions so the client, hazard engine, and tile service all agree on cell size.

- `HAZARD_H3_RESOLUTION` (res 12) — fine cells for individual hazards.
- `TILE_H3_RESOLUTION` (res 8) — coarse cells used as offline tile cache keys.

## API

- `toHazardCell(loc)` / `toTileCell(loc)` — coordinate → H3 cell.
- `cellCenter(cell)` — cell → centre `LatLng`.
- `resolutionOf(cell)` — cell resolution (0–15).
- `cellsInBounds(bbox, res?)` — all cells covering a bounding box.
- `neighbors(cell, k?)` — a cell plus its ring(s) out to radius `k`.

Tested with `node --test` (6 cases: determinism, resolution, round-trip,
neighbours, bounds coverage).
