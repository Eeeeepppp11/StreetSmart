# services/ — Backend (NestJS + TypeScript)

All app-facing services are **NestJS + TypeScript**, sharing wire types with the
mobile app via `@potholeproof/shared-types`. Python is reserved for `ml/`.

| Service | Responsibility | Phase |
|---|---|---|
| `ingestion` | Authenticated, batched `JoltEvent` intake → event queue. Phase 1 runs in **collect-only** mode for model training data. | 1 → 2 |
| `hazard-engine` | Confidence / self-heal stream processor: raises confidence on detections, decays on clean passes, auto-retires stale hazards. Serves `HazardTile`s (H3-indexed, Redis-cached). | 2 |
| `routing` | Hazard-aware routing behind `RoutingAdapter`. MVP wraps Mapbox Directions; self-hosted Valhalla with dynamic costing later. | 2 |
| `civic` | `CivicAdapter` implementations (Open311 → **SF311** first, SeeClickFix, city-311). Batched auto-submission, status polling, auto fix-verification. | 3 |
| `analytics` | Scorecards + municipal/insurer data-export APIs behind the privacy/anonymisation pipeline. | 4 |

Shared infrastructure (Postgres+PostGIS, Redis, event queue) is defined in
`infra/`.
