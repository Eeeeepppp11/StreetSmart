# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

PotholeProof: an ordinary mounted smartphone becomes a passive road-condition
sensor (accelerometer, gyroscope, GPS — no extra hardware). It detects
potholes in real time to (1) warn and reroute drivers and (2) file/track civic
repair requests. Canonical design doc: **`docs/ARCHITECTURE.md`** — read it
before making cross-cutting decisions. `docs/AUTONOMOUS_LOG.md` has a
cycle-by-cycle build history (useful for "why does this exist" context).
`docs/DEMO.md` covers the demo-recording flow (Demo Drive mode).

## Commands

This is a pnpm + Turborepo monorepo (TS workspaces only — `ml/` is a separate,
standalone Python platform, not part of the pnpm workspace).

```bash
corepack enable            # provides pnpm@9 (pnpm 9.12.0 pinned in package.json)
pnpm install
pnpm build                 # turbo run build, all workspaces
pnpm typecheck              # turbo run typecheck, all workspaces
pnpm test                   # turbo run test, all workspaces
```

**Build before test.** Each TS package's `test` script runs compiled output
(`node --test "dist/**/*.test.js"`), but turbo's `test` task only depends on
*upstream* package builds (`^build` in `turbo.json`), not the package's own
build. Run `pnpm build` first, or `pnpm build && pnpm test` in one go, or the
test files simply won't exist yet.

`pnpm lint` exists in `turbo.json`/root `package.json` as a scaffold — no
lint tool is configured in any package yet.

**Single package**, e.g. `packages/detector`:
```bash
pnpm --filter @potholeproof/detector build
pnpm --filter @potholeproof/detector test
pnpm --filter @potholeproof/detector typecheck
```

**Single test file** (after building that package):
```bash
node --test packages/detector/dist/classify.test.js
node --test --test-name-pattern="mount" packages/detector/dist/features.test.js
```

**Mobile app** (Expo SDK 54, `apps/mobile` — see its own `CLAUDE.md`/`AGENTS.md`
before touching it):
```bash
pnpm --filter @potholeproof/mobile typecheck
cd apps/mobile && pnpm exec expo start        # scan QR with Expo Go
```

**Dashboard** (`apps/dashboard`, Next.js):
```bash
pnpm --filter @potholeproof/dashboard dev     # or: build / start
```

**Ingestion server** (`services/ingestion` — plain `node:http` + `node:sqlite`,
zero runtime deps, collect-only Phase-1 backend):
```bash
pnpm --filter @potholeproof/ingestion build
pnpm --filter @potholeproof/ingestion serve   # prints the LAN URL for the phone app
```

## Architecture

### Layout

```
apps/mobile        React Native (Expo) — sensing, detection, map/nav, alerts
apps/dashboard      Next.js public scorecard site (static prerender)
services/ingestion   batched JoltEvent intake → queue (Phase 1: collect-only, running today)
services/hazard-engine  confidence / self-heal engine + hazard tiles
services/routing     hazard-aware routing (Mapbox → Valhalla), pure scoring
services/civic       Open311/SeeClickFix adapters + auto fix-verification
services/analytics   scorecards + municipal/insurer data-licensing exports
ml/                  Python: replay harness, training, TFLite export (scaffold only so far)
packages/shared-types  wire/domain types shared client ↔ backend (JoltEvent, HazardRecord, ...)
packages/geo         H3 spatial helpers + haversine distance/bearing
packages/detector    Phase-1 on-device detection core (pure TS, most heavily tested package)
packages/proximity   on-device "pothole ahead" proximity-alert engine
packages/privacy     trip-endpoint trimming + k-anonymity gates
infra/               Postgres+PostGIS, Redis, event queue (IaC, not yet stood up)
```

Dependency direction: `shared-types` ← everything; `geo` ← `proximity`,
`routing`; `privacy` ← `analytics`. Services with `"main": "./src/index.ts"`
(detector, proximity, civic, hazard-engine, ingestion, routing) are consumed
as source; services with `"main": "./dist/index.js"` (geo, privacy, analytics)
have real runtime dependents and must be built to be consumed.

### Core design patterns (apply these when extending any package)

- **Pure core, injected non-determinism.** Business logic packages
  (`detector`, `hazard-engine`, `proximity`, `routing`, `civic`, `analytics`)
  are pure TS with no I/O. Wall-clock time, ids, and cell-assignment functions
  are always injected parameters, never read directly — this is what makes
  `node --test` deterministic and is treated as non-negotiable in code review.
  Look at any `*.test.ts` for the pattern before adding new logic.
- **Detection pipeline** (`packages/detector`): acquire → pre-process
  (reorient to vehicle frame, mount-angle independent) → window (ring buffer,
  peak-anchored) → feature-extract (jolt-and-settle signature, speed-normalized) →
  classify → emit `JoltEvent`. `detect.ts` (batch) and `pipeline.ts` (streaming,
  cursor-based) share `emitForPeak`/`dynamicSeries` so both paths make
  identical decisions — don't let them drift back apart.
  `DetectionPipeline` is what `apps/mobile` drives live, sample-by-sample.
  Same detector code path also powers **Demo Drive mode** (`makeSamples` in
  `synth.ts` generates a synthetic drive replayed through the real pipeline —
  see `docs/DEMO.md`). Demo-generated events must never be persisted as
  training data (guarded in the mobile app's save path).
- **Confidence, not truth** (`services/hazard-engine`): hazards are
  probabilistic per-H3-cell records; confidence rises on repeated detection
  and decays on clean passes; no manual moderation, no delete — just
  auto-retire/reactivate.
- **Adapter boundaries** for anything externally replaceable: routing engine
  (`RoutingAdapter`, Mapbox now → Valhalla later), civic backends
  (`CivicAdapter`, Open311/SF311 first), map SDK. Never call a vendor SDK
  directly from business logic — go through the adapter.
- **Privacy pipeline precedes any export**: `packages/privacy` (trace
  trimming, k-anonymity) sits between raw hazard/report data and every
  `services/analytics` export. Don't add a new export path that skips it.

### Locked decisions (don't relitigate without checking `docs/ARCHITECTURE.md` first)

| Area | Choice |
|---|---|
| Maps / routing (MVP) | Mapbox (`@rnmapbox/maps` + Directions); Valhalla later |
| Backend language | NestJS + TypeScript (type-sharing via `shared-types`); Python only in `ml/` |
| Mobile base | Bare React Native + TypeScript (production); current pilot runs in Expo Go, SDK 54 pinned |
| Pilot civic market | San Francisco (SF311, Open311) |
| Phase-1 backend | Minimal opt-in data-collection endpoint; app fully offline-capable |

Note: `services/ingestion`'s actual Phase-1 implementation is a minimal
`node:http`/`node:sqlite` server, not yet the NestJS service described as the
target in `services/README.md` — that's an intentional, documented gap, not
a bug.
