# @potholeproof/alert-settings

The **on-device voice/haptic alert policy** — decides *whether* a detection is
worth interrupting the driver for, *how many* detections get folded into one
interruption, and *what* gets said. Pure, deterministic decision logic
consumed by the (impure) mobile app's drain loop; no `expo-speech` or
`Vibration` calls live here.

## API

`shouldAlert(event, settings) → boolean`

Filters a single `JoltEvent` against the driver's chosen `AlertSensitivity`:

- `"all"` — every classified event.
- `"moderate"` — severity ≥ 0.34, or any `pothole` regardless of severity.
- `"severe_only"` — potholes only, severity ≥ 0.67.

(0.34 / 0.67 match the moderate/severe severity bands already used elsewhere
in the app, e.g. hazard pin coloring.)

`new AlertBundler(deps, settings?)`

Buffers events that passed `shouldAlert` and releases them as one bundle per
`settings.bundleWindowMs`, so a rough stretch of road becomes a single spoken
alert instead of one per jolt:

- `add(event)` — buffer an event; starts a new window if none is open.
- `drain()` — call on every drain tick. Returns the buffered `AlertBundle`
  once `bundleWindowMs` has elapsed since the first event of the current
  window (and resets), otherwise `null`.

Time is injected via `deps.now: () => number` (mirrors `PipelineDeps` /
`DetectionPipeline` in `@potholeproof/detector`) — no ambient `Date.now()`, so
bundling is fully deterministic under test.

`phraseForBundle(bundle) → string`

Spoken text for a drained bundle:

- 1 event → names its classification: `"Pothole ahead"`.
- >1 event, same classification → `"3 potholes detected"`.
- >1 event, mixed classifications → `"4 hazards detected"`.

`AlertMode` (`"voice_haptic" | "haptic_only" | "silent"`) isn't consumed here
— the app reads it directly to decide whether to call `Speech.speak` /
`Vibration.vibrate` when a bundle drains; this package only decides *whether*
and *what*, not the I/O.

Tested with `node --test` (13 cases: sensitivity filtering at each level,
bundler window timing — nothing before the window elapses, drains at/after
it, resets after draining, independent sequential windows, no-op with nothing
buffered — and phrase wording for single/same-classification/mixed bundles).
