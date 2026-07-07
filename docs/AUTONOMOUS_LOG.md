# Autonomous work log

Running autonomously from ~00:04 Fri 2026-07-03 until the 10:00 AM check-in (I
read "10 AM tomorrow", sent just after midnight, as this same morning — the
nearer, safer boundary). All decisions made without asking, per instruction.
Newest entry first.

---

## Cycle 18 — Mon Jul 6 (user-directed) · Demo frontend + map

User asked for frontend help + a demo-recording plan (branch `demo-frontend`).

- **Review-screen map** — react-native-maps 1.27.2 (bundled in Expo Go, no
  tokens): detections as severity-colored pins (severe red / moderate orange /
  minor yellow; speed bumps blue), tap for severity/confidence.
- **Demo Drive mode** — "▶ Demo drive (simulated)": a ~35 s synthetic road
  (via the detector's own `makeSamples`) replayed through the REAL
  `DetectionPipeline` in real time — 3 potholes + 1 speed bump, vibration,
  auto-ends on the map review. Badged SIMULATED; demo events are never saved
  to training data (guard in `saveLabels`).
- Home/review polish (colored dots, badges); `docs/DEMO.md` — the recording
  playbook (screen-record + 75-second script + editing notes).

**Verification:** mobile typecheck clean; `expo export` bundle clean (SDK 54).

User's phone (via a fresh-machine setup) timed out in Expo Go; their Go build
supports SDK 54, so downgraded the app on `live-backend`.

- `expo@54.0.35`, aligned via `expo install --fix`: RN 0.81.5, react 19.1.0,
  expo-sensors ~15.0.8, expo-location ~19.0.8, expo-status-bar ~3.0.9,
  @types/react ~19.1.17, TS ~5.9.3. App code unchanged (APIs identical).
- Also installed pnpm globally (user-level) on this machine — `pnpm` +
  `expo install` now work directly; the corepack workaround is obsolete.

**Verification:** mobile typecheck clean; `expo export` bundle clean on 54;
92/92 tests unaffected.

User asked to make things live. Built the first running piece of the system
on branch `live-backend`.

- **`services/ingestion` server** — `node:http` + `node:sqlite` (zero runtime
  deps): `POST /v1/uploads` (validated, labels sanitised, idempotent via
  INSERT OR IGNORE), `GET /v1/health`, `GET /v1/training-data` (labeled set
  for the ML rig). `main.ts` prints the phone-facing LAN URL.
- **Contract** — `EventUpload.labels?: Record<eventId, TrainingLabel>`.
- **`apps/mobile`** — "Upload to server" on the home screen: persisted server
  URL + anonymous device id, builds the EventUpload from stored labels,
  POSTs, reports new/duplicate counts. Local copy kept (server dedups).

**Verification:** **92/92 tests pass** (+5 server, hitting a real HTTP server
on an in-memory DB); mobile typecheck + `expo export` bundle clean; live curl
smoke test of the compiled binary (health → upload → training-data) green.

**User setup provided:** Expo Go steps, Vercel account for dashboard deploy,
Python install deferred until training starts.

User: put it on my phone + start training. Built the Expo pilot app.

- **`apps/mobile`** — Expo SDK 57 app (runs in Expo Go, iPhone + Android, no
  native build): drive screen (speed, sensor Hz, live jolt count + vibration),
  accelerometer ~50 Hz (g→m/s²) merged with gyro per-sample, GPS 1 Hz with
  speed/heading, all feeding the real `DetectionPipeline` incrementally;
  review screen labels ✓/✗ per detection (AsyncStorage persistence) and
  exports labeled JSON via the share sheet — the ML training data path.
- `metro.config.js` — resolver fallback so Metro consumes workspace TS using
  NodeNext `./file.js` imports (tries as-is, retries stripped).
- Verified SDK-57 APIs against the versioned Expo docs before coding
  (accelerometer = g-force incl. gravity; location speed/heading present).

**Build sagas resolved:**
- `expo install` spawns `pnpm` (not on PATH) → resolved versions from
  `expo/bundledNativeModules.json` instead.
- Tried `node-linker=hoisted` for Metro → broke Next.js (dup/mismatched React,
  useContext-null in `_error` prerender even after forcing one React). Metro
  handles pnpm's default symlinked layout fine, so reverted the hoist —
  both builds green on the stock layout.

**Verification:** mobile typecheck clean; `expo export` produced the Hermes
bundle (detector included, 1.5 MB) on the default layout; dashboard
`next build` green; **87/87 tests pass**.

Built the last verifiable Phase-4 piece: the Next.js scorecard site.

- **`apps/dashboard`** — App Router, server-rendered, no client JS. The page
  calls `buildScorecard` + `buildRouteRiskExport` from
  `@potholeproof/analytics` over a labelled demo dataset shaped like real
  engine output. Static prerender means the aggregation engine executes at
  build time — `next build` is a real end-to-end check.
- `services/analytics` package.json now points at compiled `dist` (runtime
  consumer exists); `.gitignore` covers `.next/`.

**Verification:** `next build` clean (Next 15.5, 4 static pages, types
validated); prerendered HTML confirmed to contain the district tables;
**87/87 tests still pass**.

Phase-4 status: scorecards, privacy, municipal + route-risk exports, dashboard
— all built. Remaining across the project: live HTTP layers, the RN mobile
app, ML training rig (all need external tooling/services).

User: "go" — built the insurer/fleet data product.

- **`services/analytics/routerisk.ts`** — `buildRouteRiskExport`: per-cell risk
  score = severity × confidence × half-life recency decay (30-day default),
  saturated to 0..1; open/severe counts; only open hazards count. Same privacy
  contract as the municipal export: under-k cells suppressed, no contributor
  ids, no fine coordinates.

**Verification:** **87/87 tests pass** (+5). Pushed to `phase-3-civic` → PR #3.

Phase-4 remaining: the public dashboard app (Next.js) and the HTTP layers.

---

## Cycle 12 — Sat Jul 4 ~12:20 (user-directed) · Municipal data export

User asked to start Phase 4 proper. (Note: machine slept ~01:10–12:15, so the
overnight loop never fired; resumed on request.)

- **`services/analytics/export.ts`** — `buildMunicipalExport`: the sellable
  aggregated road-condition dataset. Per-coarse-cell open/fixed counts +
  severity stats; k-anonymity enforced by **suppressing** under-k cells; rows
  carry no contributor ids or fine coordinates. Uses `@potholeproof/privacy`.
- Fixed `packages/privacy` package.json to point at compiled `dist` (it has
  runtime code, unlike types-only packages).

**Verification:** **82/82 tests pass** (+5 export). Pushed to `phase-3-civic`
→ PR #3.

Phase-4 remaining: insurer/fleet route-risk product, dashboard app (needs
Next.js tooling), HTTP layers.

User: "keep building" — two pieces this cycle, both on `phase-3-civic`.

- **`services/analytics`** — `buildScorecard(reports, hazards, {districtOf,
  asOf})`: per-district repair-time scorecards (counts, median/mean repair days,
  oldest-open age). Deterministic (district mapper + "now" injected). Supporting
  contract additions: `CivicReport.closedAt`, `reconcileReport(..., closedAt?)`
  stamps closure time.
- **`packages/privacy`** — `trimTraceEndpoints` (along-path endpoint trimming so
  home/work never leaves the device; short trips vanish entirely) and
  `meetsKAnonymity` (≥k distinct contributors gate for exports).

One test-fixture fix along the way: the trim boundary test used a nominal
m/degree constant vs the haversine's actual — rewrote to margin-based
assertions (code was correct).

**Verification:** all 10 packages typecheck; **77/77 tests pass** (+5 scorecard,
+5 privacy). Pushed to `phase-3-civic` → PR #3.

User asked to keep going until 10 AM (read as Sat 10:00, the nearer boundary).
Continued Phase 3 on `phase-3-civic`.

- **`services/civic/reporting.ts`**:
  - `hazardsToReport(hazards, existingReports, policy?)` — which hazards warrant
    a new report (active + confident + severe + not already open-reported: dedup).
  - `reconcileReport(report, hazard)` — **auto fix-verification**, the closed
    loop: closes an open civic report once its hazard has self-healed (retired
    via clean passes). Terminal reports untouched.

**Verification:** typecheck clean; **67/67 tests pass** (+5). No regressions.

Pushed to `phase-3-civic` → PR #3.

After PR #2 merged, started Phase 3 (Report & Verify) on `phase-3-civic`.

- **`services/civic`** — the pure, HTTP-free mapping core:
  `hazardToOpen311Request` (HazardRecord → Open311 GeoReport v2 payload),
  `normalizeOpen311Status` (provider status → our `CivicReportStatus`,
  case-insensitive superset of Open311 + SeeClickFix), and `draftCivicReport`.
  Targets SF311 (Open311) as the pilot.

**Verification:** typecheck clean; **62/62 tests pass** (+4 civic). No regressions.

Opened as a new PR off `main`. Next: the HTTP adapter (POST + status poll),
batching/dedup, and auto fix-verification against the hazard engine.

Reviewed the Phase-2 code (proximity + routing) — no bugs. Then built the piece
that connects the backend to the warn feature.

- **`services/hazard-engine`** — `bundleTiles(hazards, {tileOf, generatedAt,
  ttlSeconds})`: groups active hazards into per-tile `HazardTile` bundles
  (deterministic order) that clients cache for offline proximity alerts. Closes
  the loop hazard-engine → tiles → `packages/proximity`.

**Verification:** typecheck clean; **58/58 tests pass** (+4 tiles). No regressions.

Pushed to `phase-2-proximity` → PR #2.

User asked to keep working until 10 PM. Continued on `phase-2-proximity` (it
carries the geo distance/bearing helpers) with the "reroute" half of the loop.

- **`services/routing`** — pure hazard-aware route scoring:
  `routeHazardExposure` (0..1, active hazards within a corridor contribute
  severity×confidence×falloff, saturated), plus `scoreRoute` / `chooseRoute`
  that blend distance with exposure per `RoutePreferences` — avoidance-off picks
  the shortest, avoidance-on penalises hazardous routes. Planar `pointToSegment`
  / `pathLength` helpers included.

**Verification:** typecheck clean; **54/54 tests pass** across all packages
(+5 routing). No regressions.

Pushed to `phase-2-proximity` → updates PR #2 (rescoped to the full Phase-2
daily-use loop: warn + reroute).

After PR #1 merged to `main`, branched `phase-2-proximity` and built the "warn"
half of the daily-use loop.

- **`packages/geo`** — added `distanceMeters` (haversine) + `bearingDegrees`
  (initial bearing), with tests.
- **`packages/proximity`** — `upcomingHazards(vehicle, hazards, config?)`: the
  on-device "pothole ahead" engine. Returns active hazards that are ahead
  (along-track > 0), within the path corridor (cross-track), within a
  speed-scaled lookahead, and above confidence/severity floors — nearest-first,
  with ETA and side (ahead/left/right). Pure geometry; runs every GPS tick with
  no network.

**Verification:** typecheck clean; **49/49 tests pass** across all packages
(+8 proximity, +2 geo). No regressions.

Opened as a new PR off `main`.

User asked to continue after the PR was opened. Built the next two verifiable
pieces.

- **`packages/geo`** — implemented for real with `h3-js` (v4), replacing the
  throwing stubs: `toHazardCell` / `toTileCell` / `cellCenter` / `resolutionOf`
  / `cellsInBounds` / `neighbors`. Package now builds to `dist` and is consumed
  as compiled JS.
- **`services/hazard-engine`** — `HazardEngine`, the confidence / self-heal core
  (a headline feature): folds `JoltEvent`s into per-H3-cell `HazardRecord`s,
  Beta-smoothed confidence that rises on detections and decays on clean passes,
  auto-retire + reactivation, confidence-weighted severity aggregation. Pure and
  deterministic; cell assignment injected so tests are hermetic.

**Verification:** typecheck clean; **39/39 tests pass** across all packages
(17 detector + 6 geo + 7 ingestion + 9 hazard-engine). No regressions.

Pushed to the branch → updates PR #1.

**Still deliberately out** (unverifiable here): NestJS HTTP layer, `apps/mobile`
RN app + native module, Python `ml/` harness.

Stewardship pass over the branch instead of new modules (Phase-1's remaining
pieces aren't verifiable in this environment).

- Re-read detector + ingestion critically. **No correctness bugs found.**
  Hand-traced the pipeline trim bounds: undecided candidates are always recent
  (`peakT > latestT − half`), so their leading windows are never trimmed — and
  the chunk-size-independence tests (1/7/250) already exercise this.
- Fixed two quality issues:
  - `ingestion/validation.test.ts` — removed confusing dead code
    (`void notArray`) and a mislabeled case; added explicit null / not-an-array
    assertions.
  - `synth.ts` — corrected the `peak` doc comment (it's an amplitude *scale*,
    ≈0.74× the literal lobe after the derivative-of-Gaussian normalisation; the
    constant is deliberately left as-is since thresholds/tests are calibrated to
    it).

**Verification:** 24/24 tests still pass.

**Status:** Phase-1 buildable+testable work is complete and clean. Further ticks
will likely be quiet — I'll do a quick check and taper unless something new
appears.

Started `services/ingestion` (Phase-1 collect-only) with the piece that's
testable without a NestJS runtime: intake validation.

- Added `EventUpload` wire contract to `shared-types` (anonymous batch envelope).
- `services/ingestion/validation.ts`:
  - `validateJoltEvent` — structural validation → reconstructed event (drops
    unknown fields) or per-field errors; no exceptions.
  - `validateUpload` — envelope validation; lenient per collect-only intent
    (keep valid events, report bad ones per-index, reject malformed/oversize
    envelopes). Sanity caps: MAX_BATCH_SIZE=1000, MAX_SPEED_MPS=90.

**Verification:** typecheck clean (shared-types + ingestion); **24/24 tests pass**
(17 detector + 7 new ingestion). Confirmed the shared-types change didn't
regress the detector.

**Next cycles:** the NestJS HTTP layer + auth + rate-limit + queue publish
(needs @nestjs deps — heavier); or wire `DetectionPipeline` into `apps/mobile`.
Approaching a good stopping point for autonomous building — later ticks may
taper to a review/bug-hunt sweep rather than new modules.

Continued the Phase-1 detector (queued last cycle).

- Refactored `detect.ts` to extract shared `emitForPeak` + `dynamicSeries`
  helpers, so the batch and streaming paths make **identical** decisions
  (no risk of drift). `runDetection` now routes through `emitForPeak`; its
  original 14 tests stayed green.
- Added `DetectionPipeline` (`pipeline.ts`) — streaming, cursor-based
  incremental emission for live drives. Buffers samples/GPS, decides a
  candidate only once its full ±windowHalfMs window has arrived, never
  re-emits, and self-trims old history. Refractory de-bounce carries across
  chunk boundaries.

**Verification:** typecheck clean; **17/17 tests pass** (14 prior + 3 new).
New tests prove: streaming ≡ batch on the same drive; result is independent
of chunk size (1 / 7 / 250); incremental emission never re-emits an id.

Deferred the Turbo/pnpm PATH item — it's an environment quirk (pnpm not on
PATH), not a repo defect; `tsc`/`node --test` work directly. Not worth a
repo change; the fix is `npm i -g pnpm` on the host.

**Next cycles:** wire `DetectionPipeline` into `apps/mobile`'s (planned)
native sample stream; begin `services/ingestion` JoltEvent validation module
(pure TS, testable) against the shared contract.

---

## Cycle 1 — 00:04–~01:00 Fri Jul 3 · Phase-1 detection core

**Branch:** `phase-1-detector` (off `main`; nothing pushed).

**Decisions locked** (revisit at check-in): Mapbox · NestJS+TS · bare RN · SF311
pilot · Phase-1 collect-only backend. Recorded in `README.md` / `docs/ARCHITECTURE.md`.

**Toolchain:** `corepack enable` can't write shims into Program Files (EPERM), so
pnpm runs via `corepack pnpm@9.12.0 …`. Node 24 + tsc + node:test all work; deps
installed; `pnpm-lock.yaml` committed. **Known gap:** `pnpm typecheck`/`test`
fail because Turbo can't find the `pnpm` binary on PATH — will resolve once pnpm
is installed globally (`npm i -g pnpm`) or corepack is enabled with admin. Until
then, run tsc/node directly (see commands below).

**Built — `packages/detector` (pure TS, no RN/native), fully tested:**
- `features.ts` — gravity-projection feature extraction (mount-angle independent):
  peak-to-peak, RMS, jerk, settle time, vertical dominance, gyro RMS.
- `classify.ts` — Phase-1 heuristic classifier; speed-normalised severity;
  separates pothole / speed_bump / rough_road / other. Emits `DetectionResult`,
  the **same shape the future ML model will emit** (drop-in swap).
- `detect.ts` — `runDetection` batch scanner (trigger → window → classify →
  located, de-bounced `JoltEvent`s). Deterministic: no wall-clock, ids/time
  injected.
- `replay.ts` — `RecordedDrive` fixture format + `replayDrive` (the sensor-replay
  harness core; `ml/` will reuse the shape).
- `synth.ts` — deterministic synthetic-drive generator (sharp/rounded impulses on
  a configurable gravity axis) for tests + fixtures.
- `config.ts` — thresholds as data (Phase-1 exists to tune these).

**Verification:** typecheck clean; build clean; **14/14 unit tests pass** —
feature extraction, classification, mount independence, speed normalisation,
refractory de-bouncing, and replay determinism. Empirically confirmed a tilted
mount (`gravity {3,0,9.3}`) classifies identically to a level mount.

**Reproduce:**
```bash
corepack pnpm@9.12.0 install
node node_modules/typescript/bin/tsc -p packages/detector/tsconfig.json
node --test "packages/detector/dist/**/*.test.js"
```

**Next cycles (planned):** (1) fix the Turbo/pnpm PATH friction so `pnpm test`
works out of the box; (2) streaming/cursor emitter for low-latency live
detection; (3) begin `services/ingestion` NestJS collect-only skeleton against
the `JoltEvent` contract; (4) `ml/` replay-harness scaffold in Python.
