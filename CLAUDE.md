# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**StreetSmart** turns a dash-mounted smartphone into a passive road-condition
sensor. The phone's accelerometer + gyroscope + GPS (no extra hardware) detect
potholes in real time on-device, then the system (1) warns and reroutes drivers
around hazards and (2) files and tracks civic repair requests, auto-verifying
fixes when later drives pass the spot cleanly.

The build is organized into four phases: **1 Sense & Log** → **2 Warn & Route**
→ **3 Report & Verify** → **4 Scorecards & Data**. Most pure-logic packages
across all four phases exist and are tested; the HTTP/native/Python glue is
partial. `docs/AUTONOMOUS_LOG.md` is the running build journal (newest first) —
read it to understand *why* a given piece exists or is deliberately absent.

**`docs/ARCHITECTURE.md` is canonical.** Read it before any cross-cutting or
design decision — it carries the decision log and the intended end state.

## Repository shape

pnpm + Turborepo monorepo. Only `apps/*`, `services/*`, `packages/*` are pnpm
workspaces (see `pnpm-workspace.yaml`). `ml/` is a **standalone Python
platform, intentionally outside the workspace** with its own tooling.

| Path | Role | Phase | State |
|---|---|---|---|
| `packages/shared-types` | Wire/domain types shared client ↔ backend | all | types only |
| `packages/detector` | On-device detection core (pure TS) — the core IP | 1 | built, most tested |
| `packages/geo` | H3 cells (`h3-js`) + haversine distance/bearing | 2 | built |
| `packages/proximity` | On-device "pothole ahead" alert engine | 2 | built |
| `packages/privacy` | Trip-endpoint trimming + k-anonymity gates | 4 | built |
| `services/ingestion` | Batched `JoltEvent` intake (collect-only) | 1→2 | **runs** (node:http) |
| `services/hazard-engine` | Confidence / self-heal engine + hazard tiles | 2 | pure core built |
| `services/routing` | Hazard-aware route scoring | 2 | pure core built |
| `services/civic` | Open311/SeeClickFix mapping + fix-verification | 3 | pure core built |
| `services/analytics` | Scorecards + municipal/insurer exports | 4 | pure core built |
| `apps/mobile` | React Native (Expo) pilot app | 1 | **runs** in Expo Go |
| `apps/dashboard` | Next.js public scorecard site | 4 | builds |
| `infra/` | Postgres+PostGIS, Redis, queue (IaC) | — | docs only |
| `ml/` | Python: training + TFLite/pure-JS export, model registry | 1+ | training/export built; replay harness + real drive data not yet |

## Commands

```bash
pnpm install                # pnpm 9.12.0 (via corepack enable if not installed)
pnpm build                  # turbo run build across all TS workspaces
pnpm typecheck              # turbo run typecheck
pnpm test                   # turbo run test
```

**Always `pnpm build` before `pnpm test` (or run `pnpm build && pnpm test`).**
Each package's test script runs *compiled* output — `node --test
"dist/**/*.test.js"` — but turbo's `test` task only depends on `^build`
(upstream packages), not the package's own build. Skip the build and the test
globs match nothing.

`pnpm lint` is wired in `turbo.json` but **no linter is configured** in any
package yet — it's a no-op scaffold.

Per-package / single-test (turbo caches, so `--filter` is the fast inner loop):

```bash
pnpm --filter @potholeproof/detector build         # then test/typecheck
pnpm --filter @potholeproof/detector test
node --test packages/detector/dist/classify.test.js               # one file
node --test --test-name-pattern="mount" packages/detector/dist/features.test.js
```

App-specific:

```bash
# mobile (Expo SDK 54 — pinned; read apps/mobile/AGENTS.md first)
pnpm --filter @potholeproof/mobile typecheck
cd apps/mobile && pnpm exec expo start             # QR into Expo Go

# dashboard (Next.js) — `next build` statically prerenders, so it's a real
# end-to-end check of the analytics aggregation
pnpm --filter @potholeproof/dashboard build

# ingestion collect-only server (prints the LAN URL for the phone's upload box)
pnpm --filter @potholeproof/ingestion build && pnpm --filter @potholeproof/ingestion serve
```

## Architecture

### Data flow (the whole loop)

```
phone sensors ──▶ DetectionPipeline (packages/detector, on-device)
                    └─▶ JoltEvent ──▶ ingestion ──▶ hazard-engine
                                                      ├─▶ HazardRecord (confidence-scored, self-healing)
                                                      ├─▶ HazardTile ──▶ proximity alerts (back on-device, offline)
                                                      ├─▶ routing (hazard-aware route scoring)
                                                      ├─▶ civic (Open311 report + auto fix-verify)
                                                      └─▶ analytics ──▶ privacy gate ──▶ dashboard / exports
```

The shared vocabulary for this flow lives in `packages/shared-types`
(`JoltEvent`, `HazardRecord`, `HazardTile`, `CivicReport`, routing/ingestion
envelopes). Change a wire shape there, not in a consumer.

### Conventions that are load-bearing (not stylistic)

- **Pure core, injected non-determinism.** Every logic package (`detector`,
  `hazard-engine`, `proximity`, `routing`, `civic`, `analytics`) is pure TS
  with no I/O and no ambient `Date.now()`/`Math.random()`. Time, ids, and
  cell-assignment functions are **injected parameters** (see `PipelineDeps` in
  the detector, or the `{ asOf, districtOf }`-style deps in analytics). This is
  what makes `node --test` fully deterministic — mirror it in any new logic.
- **NodeNext ESM imports.** Source uses explicit `./file.js` suffixes in
  relative imports even though the files are `.ts` (tsc ESM convention). This
  is why `apps/mobile/metro.config.js` has a custom `resolveRequest` that
  retries with `.js` stripped — don't "fix" those import suffixes.
- **`src` vs `dist` as the package entry.** Most packages expose
  `"main": "./src/index.ts"` and are consumed as source (fine for tsc/Metro).
  The three with real runtime dependents — **`geo`, `privacy`, `analytics`** —
  expose `"main": "./dist/index.js"` and **must be built** before a consumer
  (e.g. the dashboard, or a running server) can import them.

### Package-specific design

- **`packages/detector`** — acquire → reorient to vehicle frame (mount-angle
  independent) → peak-anchored window → extract the "jolt-and-settle" feature
  vector (speed-normalized) → `classify` (`pothole` / `speed_bump` /
  `rough_road` / `other`) → emit `JoltEvent`. `runDetection` (batch) and
  `DetectionPipeline` (streaming, cursor-based, what the app drives live) share
  the same decision helpers so they can't diverge — keep it that way. The
  heuristic `classify` and the trained `classifyWithModel` (`model.ts`) both
  emit the same `DetectionResult` shape and are swapped via the optional
  `PipelineDeps.classify` — the app currently passes `classifyWithModel`
  (`mlp-v1-synthetic`, see `ml/README.md`). `makeSamples` (`synth.ts`)
  generates synthetic drives — used by tests, the app's **Demo Drive mode**
  (`docs/DEMO.md`), and `scripts/gen-training-data.ts`'s training-data
  generation; demo events must never be saved as training data.
- **`services/hazard-engine`** — "confidence, not truth": per-H3-cell
  `HazardRecord`s whose `confidence` rises on `passCount` and decays on
  `cleanPassCount`; scheduled decay auto-retires (`status: retired`) with no
  manual moderation and no deletes. `verified_fixed` is set when clean passes
  clear a previously `reported` hazard — the closed civic loop.
- **`services/civic`** — pure mapping (`HazardRecord` → Open311 GeoReport v2)
  behind an adapter boundary; SF311 is the pilot target.
- **`packages/privacy` + `services/analytics`** — every export path runs
  through the privacy gate (endpoint trimming, k-anonymity suppression of
  under-k cells) *before* data leaves the warehouse. Don't add an export that
  bypasses it.

### Replaceable externals sit behind adapters

Routing engine (Mapbox now → self-hosted Valhalla later), civic backends
(Open311/SF311 → SeeClickFix/others), and the map SDK are all meant to be
swappable. Never call a vendor SDK from business logic — go through the adapter.

## Locked decisions

From `docs/ARCHITECTURE.md`'s decision log — don't relitigate without checking
there first:

| Area | Choice |
|---|---|
| Maps / routing (MVP) | Mapbox (`@rnmapbox/maps` + Directions); Valhalla later |
| Backend language | NestJS + TypeScript (shares `shared-types`); Python only in `ml/` |
| Mobile base | Bare RN + TS is the production target; the current **pilot runs in Expo Go (SDK 54, pinned)** |
| Pilot civic market | San Francisco (SF311, Open311) |
| Phase-1 backend | Minimal opt-in collect-only endpoint; client stays fully offline-capable |

## Known intentional gaps (don't file these as bugs)

- `services/ingestion` currently runs on plain `node:http` + `node:sqlite`
  (zero runtime deps), **not** the NestJS service its README describes as the
  end state. Deliberate for the pilot.
- The mobile app is Expo Go (foreground-only, ~50 Hz), not the bare-RN native
  TurboModule (background, 100 Hz) that `docs/ARCHITECTURE.md` targets.
- `infra/` is documentation/scaffold only — needs external services not
  available in this repo. `ml/` now has a working training/export pipeline
  (see `ml/README.md`), but its only model (`mlp-v1-synthetic`) is trained on
  synthetic, physically-parameterised sensor windows, not real recorded
  drives — `ml/replay/` (the real-drive regression harness) doesn't exist
  yet. The app runs this model via a pure-JS forward pass
  (`packages/detector/src/model.ts`), not native TFLite — `react-native-fast-tflite`
  can't run in Expo Go.
- **Expo SDK 54 is pinned deliberately** (the pilot phone's Expo Go). Never
  hand-bump Expo/RN versions; use `expo install --fix`. See
  `apps/mobile/AGENTS.md`.
