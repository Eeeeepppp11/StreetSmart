# services/civic

Report & verify. `CivicAdapter` implementations over civic backends:

- **Open311** (the open standard) — first target **SF311** (San Francisco).
- **SeeClickFix** API.
- City-specific 311 APIs.

Batched auto-submission (GPS + optional photo, deduped so one pothole ≠ many
reports), status polling/webhooks, and **auto fix-verification**: when the
hazard-engine retires a *reported* hazard via drive-through clean passes, the
linked `CivicReport` is marked `verified_fixed` — the closed loop. **Phase 3.**

## Implemented

- `open311.ts` — the pure, dependency-free mapping core (no live HTTP):
  - `hazardToOpen311Request(hazard, { serviceCode, mediaUrl? })` — build an
    Open311 GeoReport v2 request payload from a `HazardRecord`.
  - `normalizeOpen311Status(raw)` — map a provider's status (case-insensitive
    superset of Open311 + SeeClickFix) into our `CivicReportStatus`.
  - `draftCivicReport(hazard, provider, nextId)` — a pre-submission draft report.

Tested with `node --test` (4 cases). Still to come: the HTTP adapter that POSTs
these payloads + polls status, batching/dedup, and auto fix-verification against
the hazard engine.
