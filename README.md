# PotholeProof

> Passive infrastructure-sensing and routing for drivers and cities.

An ordinary mounted smartphone becomes a passive road-condition sensor. Using
the phone's accelerometer, gyroscope, and GPS — no extra hardware — PotholeProof
detects potholes in real time, then (1) **warns and reroutes** drivers around
hazards and (2) **files and tracks civic repair requests**, closing the loop
between citizen and city.

Full design: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Monorepo layout

```
apps/
  mobile/        React Native app — sensing, detection, map/nav, alerts, routing
  dashboard/     Next.js public scorecard site (Phase 4)
services/        NestJS backend (TypeScript)
  ingestion/     batched JoltEvent intake → queue (Phase 1: collect-only)
  hazard-engine/ confidence / self-heal engine + hazard tiles
  routing/       hazard-aware routing (Mapbox → Valhalla)
  civic/         Open311 / SeeClickFix adapters + auto fix-verification
  analytics/     scorecards + data-licensing exports
ml/              Python: replay harness, training, TFLite export, model registry
packages/
  shared-types/  wire/domain types shared client ↔ backend
  geo/           H3 spatial helpers + distance/bearing (h3-js)
  detector/      Phase-1 on-device detection core (pure TS, tested)
  proximity/     on-device "pothole ahead" proximity-alert engine
  privacy/       trip-endpoint trimming + k-anonymity gates
infra/           Postgres+PostGIS, Redis, event queue, warehouse (IaC)
```

## Locked decisions

| Area | Choice |
|---|---|
| Maps / routing (MVP) | Mapbox (`@rnmapbox/maps` + Directions); Valhalla later |
| Backend language | NestJS + TypeScript (type-sharing); Python only for `ml/` |
| Mobile base | Bare React Native + TypeScript |
| Pilot civic market | San Francisco (SF311, Open311) |
| Phase-1 backend | Minimal opt-in data-collection endpoint; app fully offline-capable |

## Build order (proposal's four phases)

1. **Sense & Log** — on-device detection (heuristic first) + local log + review/submit labeling tool.
2. **Warn & Route** — backend, self-healing hazard map, proximity alerts, hazard-aware routing.
3. **Report & Verify** — civic auto-submission + drive-through fix verification.
4. **Scorecards & Data** — public dashboards + municipal/insurer data licensing.

## Getting started

```bash
corepack enable            # provides pnpm@9
pnpm install               # installs the TS workspaces
pnpm typecheck             # runs across packages via turbo
```

The `ml/` Python platform has its own tooling — see [ml/README.md](ml/README.md).
See each package's README for setup specifics. This is an early scaffold: the
shared types and workspace wiring are real; apps/services are documented
placeholders to be filled in per phase.
