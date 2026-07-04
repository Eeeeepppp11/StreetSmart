# services/civic

Report & verify. `CivicAdapter` implementations over civic backends:

- **Open311** (the open standard) — first target **SF311** (San Francisco).
- **SeeClickFix** API.
- City-specific 311 APIs.

Batched auto-submission (GPS + optional photo, deduped so one pothole ≠ many
reports), status polling/webhooks, and **auto fix-verification**: when the
hazard-engine retires a *reported* hazard via drive-through clean passes, the
linked `CivicReport` is marked `verified_fixed` — the closed loop. **Phase 3.**
