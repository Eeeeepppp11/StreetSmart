# StreetSmart — Technical Architecture

> Canonical architecture for the repo. Cross-platform React Native app + backend
> + ML platform, covering all four phases of the product proposal.

## Decision log

| # | Area | Decision | Rationale | Revisit when |
|---|---|---|---|---|
| 1 | Maps / routing (MVP) | **Mapbox** (`@rnmapbox/maps` + Directions) | Fastest path to turn-by-turn + custom hazard layers | Self-host **Valhalla** for dynamic hazard costing at scale |
| 2 | Backend language | **NestJS + TypeScript** | Shares `@potholeproof/shared-types` with the app | Never for app services; `ml/` stays Python |
| 3 | Mobile base | **Bare React Native + TS** | Deep native work: custom 50–100 Hz sensing TurboModule + background services | If native surface shrinks, revisit Expo dev-build |
| 4 | Pilot civic market | **San Francisco** (SF311, Open311) | Mature, documented Open311 API with a pothole category | Adapter boundary makes new cities cheap |
| 5 | Phase-1 backend | **Minimal opt-in data-collection endpoint** | ML needs centralised labelled data; app stays offline-capable | Expands into full ingestion in Phase 2 |

---

## Context

StreetSmart turns a mounted smartphone into a passive road-condition sensor
(accelerometer, gyroscope, GPS — no extra hardware). It **warns and reroutes**
drivers around hazards (the selfish, daily-use hook) and **files and tracks**
civic repair requests (the accountability loop). Revenue: municipal data
licensing + insurance/fleet partnerships.

The hard realities shaping every decision:

- **High-rate sensor streaming (50–100 Hz) in the background** is not served by
  stock RN JS — it needs custom native modules.
- **Real-time jolt classification must run on-device** for latency and privacy.
- **The crowdsourced hazard map must self-heal** (auto-retire fixed hazards)
  without manual moderation.
- **GPS traces are sensitive** — privacy (trip-endpoint trimming, anonymisation)
  is first-class.

---

## 1. Guiding principles

1. **On-device first.** Detection/inference run locally; the network is for
   aggregation, routing, and civic sync — never in the hot path of a jolt alert.
2. **Selfish-first, civic-second.** The warn/reroute loop must stand alone
   without any backend civic features.
3. **Confidence, not truth.** Hazards are probabilistic records whose confidence
   rises on repeated detection and decays on clean passes. No manual moderation.
4. **Offline-capable client.** Region hazard data is cached locally; events queue
   and sync opportunistically.
5. **Privacy by construction.** Raw traces stay on device; uploads are trimmed
   and anonymised before they could ever reach a licensing partner.
6. **Replaceable externals.** Routing engine, map SDK, and civic backends all sit
   behind adapters.

---

## 2. System overview

```
┌──────────────────────────── MOBILE CLIENT (React Native + TS) ────────────────────────────┐
│  Native Sensing Module (Swift CoreMotion / Kotlin SensorManager)  ── batched 50–100 Hz ──┐ │
│        │ accel + gyro + GPS (via JSI/TurboModule)                                        │ │
│        ▼                                                                                  │ │
│  Signal-Processing + On-Device ML (TFLite via JSI)  ── window → features → classify ──┐  │ │
│        │ jolt events (severity, confidence, geo)                                       │  │ │
│        ▼                                                                                ▼  │ │
│  Local Event Store (SQLite/op-sqlite)  ◄──►  Sync Layer (queue + retry)  ◄──►  Backend API │
│        │                                                                                    │
│        ▼                                                                                    │
│  Map / Nav UI (Mapbox) · Proximity Alerts · Hazard-Aware Routing · Review-&-Submit · Gamify │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                          │  (HTTPS / batched)
                                          ▼
┌──────────────────────────────────── BACKEND SERVICES ─────────────────────────────────────┐
│  Ingestion API ──► Event Queue (Kafka/SQS/Redis Streams) ──► Confidence / Self-Heal Engine │
│  Hazard Tile Service (H3-indexed GeoJSON/vector tiles, Redis-cached)  ◄── PostgreSQL+PostGIS│
│  Routing Service (Valhalla/GraphHopper self-host, custom hazard costing | Mapbox for MVP)   │
│  Civic Integration Service (Open311 / SeeClickFix / city-311 adapters, status polling)      │
│  User · Auth · Gamification (leaderboards) · Scorecard & Analytics API                       │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌──────────── DATA & ML PLATFORM ────────────┐   ┌──────────── PUBLIC / PARTNER ────────────┐
│ Warehouse (BigQuery/Snowflake) · Feature   │   │ Public scorecard web dashboard (Next.js) │
│ store · Model training (Python) · Model     │   │ Municipal & insurer/fleet data-export    │
│ registry + OTA model delivery · Sensor-     │   │ APIs (anonymized, k-anonymity)           │
│ replay eval harness                         │   └──────────────────────────────────────────┘
└─────────────────────────────────────────────┘
```

---

## 3. Mobile client (React Native)

Bare RN + TypeScript. The sensing loop lives in native code and off the JS bridge.

| Concern | Choice | Notes |
|---|---|---|
| Navigation UI | `@rnmapbox/maps` | Custom hazard layers, offline tiles, turn-by-turn |
| High-rate sensors | Custom TurboModule (CoreMotion / SensorManager) | Batched delivery; stock libs can't sustain 50–100 Hz reliably |
| Background location | `react-native-background-geolocation` | Continuous GPS + geofencing; iOS/Android background handling |
| On-device ML | `react-native-fast-tflite` (JSI) | Classifier off the JS thread |
| Local store | `op-sqlite` (or WatermelonDB) | Event log + cached tiles; `react-native-mmkv` for hot KV |
| State | Zustand + TanStack Query | Sensing loop never touches React state |
| OTA JS | EAS Update / CodePush | Ship JS + tuning params without store review |

Layering: **sensing (native)** → **inference (native + TFLite)** → **store** →
**sync** → **presentation (RN/JS)**. Wire types from `@potholeproof/shared-types`.

---

## 4. On-device detection pipeline (the core IP)

1. **Acquire** — accel + gyro at 50–100 Hz, GPS at 1 Hz, batched natively.
2. **Pre-process** — reorient to vehicle frame (mount-angle independence),
   high-pass filter.
3. **Window** — ~1–2 s sliding window over a ring buffer, anchored on peaks.
4. **Feature-extract** — the "jolt-and-settle" signature (peak-to-peak, vertical
   dominance, jerk, settle time, spectral energy). **Speed-normalise** severity;
   **gyro cross-check** rejects whole-vehicle events (rail crossings, speed bumps)
   vs. single-wheel strikes.
5. **Classify** — small 1D-CNN / gradient-boosted model → **TFLite**. Grounded in
   phone-only sensing research (e.g. Nericell), ~85–90%+ accuracy.
6. **Emit** — write a `JoltEvent` locally; queue for opt-in sync.

**Cold-start breaker:** Phase 1 ships a **heuristic threshold detector** plus the
review-&-submit screen, whose confirm/reject actions generate the labelled
dataset that trains the first real model.

---

## 5. Backend services (NestJS + TypeScript)

- **Ingestion** — auth'd, batched event upload → event queue (decouples spiky
  mobile load).
- **Confidence / Self-Heal Engine** — per-cell `confidence`, `severity`,
  `passCount`, `cleanPassCount`, `first/lastSeen`. Detections raise confidence;
  clean passes lower it; scheduled decay auto-retires. No manual moderation.
- **Hazard Tile Service** — H3-indexed tiles, Redis-cached, for offline client
  proximity alerts.
- **Routing** — hazard-aware routing (§7).
- **Civic Integration** — report & verify (§9).
- **User / Auth / Gamification** — profiles, auth, Redis sorted-set leaderboards.
- **Scorecard & Analytics** — repair-time scorecards + licensing surface (§10).

---

## 6. Data stores & spatial model

| Store | Tech | Holds |
|---|---|---|
| Spatial system-of-record | PostgreSQL + PostGIS | Hazards, geometry, confidence, lifecycle |
| Spatial index | H3 (hex cells) | Aggregation, tiling, hazard lookup |
| Hot cache / tiles / leaderboards | Redis | Cached tiles, leaderboards, dedup |
| Event stream | Kafka / SQS / Redis Streams | Raw events, ingest → engine |
| Warehouse | BigQuery / Snowflake (Postgres to start) | Scorecards, training, exports |
| On-device | SQLite (op-sqlite / WatermelonDB) | Local event log + cached tiles |

Hazard record shape lives in `@potholeproof/shared-types` (`HazardRecord`).

---

## 7. Warn & reroute (Phase 2 core loop)

- **Proximity alerts** — evaluated on-device against cached tiles (offline,
  zero-latency): "Pothole ahead in 200 ft, right lane."
- **Hazard-aware routing** — hazard density/severity as an edge-cost penalty.
  Mapbox Directions for MVP; self-host Valhalla/GraphHopper for full costing
  control. Behind `RoutingAdapter`.
- **User preference** — "avoid severe road damage" toggle.

---

## 8. ML lifecycle (Python, `ml/`)

Data collection → training/eval (accuracy vs. false-positive rate) → **TFLite**
export → model registry + OTA. The **sensor-replay harness** (deterministic
replay of recorded drives) is the critical regression asset — build it first.
Every `JoltEvent` carries `modelVersion` for attribution/rollback.

---

## 9. Report & verify (Phase 3)

Adapter pattern over civic backends (Open311 → **SF311** first, SeeClickFix,
city-311). Batched auto-submission (GPS + optional photo, deduped), status
polling/webhooks, and **auto fix-verification**: when drive-through clean passes
retire a *reported* hazard, the linked report flips to `verified_fixed` — the
closed loop no existing civic tool has.

---

## 10. Scorecards & data licensing (Phase 4)

Public Next.js scorecard dashboard; municipal data-export API; anonymised
insurer/fleet data products. **Privacy pipeline precedes any export:**
trip-endpoint trimming, anonymisation, k-anonymity/aggregation minimums enforced
before data leaves the warehouse.

---

## 11. Cross-cutting

- **Privacy/security** — on-device inference; trace trimming/anonymisation;
  consent + retention; encrypted transit/at-rest; auth (Clerk/Auth0/custom JWT).
- **Observability** — structured logs, OpenTelemetry, and model-accuracy
  telemetry as a first-class dashboard.
- **CI/CD & release** — EAS/Fastlane builds; EAS Update/CodePush JS OTA; model
  registry ML OTA; feature flags to dark-launch civic features.
- **Testing** — unit + sensor-replay harness; routing correctness; civic-adapter
  contract tests vs. sandboxes; ingestion load tests.

---

## 12. Phased build order

- **Phase 1 — Sense & Log** → validated detection, pilot users, no auto-submit
  risk. RN shell + Mapbox dash UI; native sensing module; heuristic detector;
  local SQLite log; review-&-submit (= labeling tool); `ml/` v0 (replay harness +
  first training loop); optional collect-only ingestion.
- **Phase 2 — Warn & Route** → daily retention loop. Ingestion + queue + PostGIS +
  confidence engine + tiles; client hazard map, on-device proximity alerts,
  hazard-aware routing; crowd aggregation + self-cleaning; leaderboards.
- **Phase 3 — Report & Verify** → closed-loop accountability. Civic adapters,
  batched auto-submission, status polling, auto fix-verification.
- **Phase 4 — Scorecards & Data** → revenue + data moat. Warehouse +
  scorecard/analytics APIs; Next.js dashboards; municipal + insurer/fleet
  licensing behind the privacy pipeline.

---

## 13. Key risks & mitigations

| Risk | Mitigation |
|---|---|
| RN can't sustain high-rate background sensing | Custom native TurboModule + batching; validated first in Phase 1 |
| Detection false positives (speed bumps, rail crossings) | Speed normalisation + gyro cross-check + replay-harness gating |
| Cold-start empty map | Heuristic detector + own-drive history give value at 1 user |
| Battery drain | Native batching, duty-cycle when parked, foreground-service tuning |
| Vendor lock-in (routing/maps/civic) | Adapter boundaries |
| GPS-trace privacy / regulatory exposure | Endpoint trimming + anonymisation + k-anonymity before any export |

---

## 14. Validation strategy (end-to-end)

- **Detection** — replay harness early; accuracy vs. false-positive rate against
  manually-reviewed pilot drives (headline metric).
- **Daily loop** — DAU/WAU on warn+route features, independent of reporting.
- **Self-heal** — count of auto-confirmed fixes (hazards retired via passive
  re-confirmation).
- **Civic loop** — adapter integration tests vs. Open311/SeeClickFix sandboxes;
  city repair-response time before/after partnership.
- **Backend** — ingestion load tests at pilot-fleet scale; routing correctness.
