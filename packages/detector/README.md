# @potholeproof/detector

The **Phase-1 on-device detection core** — pure TypeScript, no React Native or
native dependencies, so it runs and is unit-tested on plain Node. This is the
make-or-break IP: turning a raw sensor stream into located, classified
`JoltEvent`s.

## Pipeline

```
SensorSample[] ──► gravity projection (mount-independent)
              ──► candidate trigger (dynamic-accel threshold + hysteresis)
              ──► window (±windowHalfMs) ──► extractFeatures()
              ──► classify() (speed-normalised heuristic)
              ──► JoltEvent (located via nearest GPS fix, de-bounced)
```

- **`extractFeatures`** — projects acceleration onto the estimated gravity axis
  (so mount angle doesn't matter) and computes peak-to-peak, RMS, jerk, settle
  time, vertical dominance, and gyro RMS.
- **`classify`** — Phase-1 heuristic: speed-normalises severity and separates
  potholes (sharp, vertical, low-rotation) from speed bumps (rounded, high pitch)
  and rough road. Emits a `DetectionResult` — the **same shape the ML model will
  emit**, so swapping in the trained model later is a drop-in.
- **`runDetection`** — batch scan of a drive → `JoltEvent[]`. Deterministic (no
  wall-clock; ids and time come from injected `PipelineDeps` + GPS fixes).
- **`DetectionPipeline`** — streaming wrapper over the same `emitForPeak`
  decision, for live, incremental emission (never re-emits). Feeding a drive in
  chunks yields the same events as the batch path — verified in tests.
- **`replayDrive`** / **`RecordedDrive`** — the sensor-replay harness fixture
  format. Golden drives replay identically, so detector changes are
  regression-tested without re-driving. The Python `ml/` platform consumes the
  same shape.
- **`makeSamples`** (`synth.ts`) — deterministic synthetic drives for tests and
  fixtures; injects sharp/rounded impulses along a configurable gravity axis.

Thresholds live in `config.ts` as data — Phase 1 exists to tune them against
labelled pilot drives.

## Develop

```bash
# from repo root (pnpm via corepack until it's on PATH):
corepack pnpm@9.12.0 install
# typecheck + build + test this package:
node node_modules/typescript/bin/tsc -p packages/detector/tsconfig.json
node --test "packages/detector/dist/**/*.test.js"
```

14 tests cover feature extraction, classification, mount independence, speed
normalisation, event de-bouncing (refractory), and replay determinism.

## Next steps

- **Wire into `apps/mobile`** — drive `DetectionPipeline` from the native sensing
  module's batched sample stream + the GPS stream.
- **ML swap** — replace the `classify` heuristic with the TFLite model behind the
  same `DetectionResult` interface once Phase-1 data is collected.
