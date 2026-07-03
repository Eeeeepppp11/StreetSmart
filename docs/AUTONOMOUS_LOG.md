# Autonomous work log

Running autonomously from ~00:04 Fri 2026-07-03 until the 10:00 AM check-in (I
read "10 AM tomorrow", sent just after midnight, as this same morning — the
nearer, safer boundary). All decisions made without asking, per instruction.
Newest entry first.

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
