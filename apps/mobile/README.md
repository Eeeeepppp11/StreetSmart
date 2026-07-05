# apps/mobile — PotholeProof Phase-1 pilot app (Expo)

The dash-mount test app: reads accelerometer + gyroscope + GPS, runs the
**real detection engine** (`@potholeproof/detector`, pure TS) live on the
phone, logs every jolt, and provides the ✓/✗ **review screen whose labels
become the ML training set**.

Runs in **Expo Go** (SDK 57) — no native build needed, works on iPhone and
Android from any dev machine.

## Run it on your phone

1. Install **Expo Go** from the App Store / Play Store.
2. On the dev machine, from `apps/mobile`:
   ```bash
   corepack pnpm@9.12.0 exec expo start
   ```
3. Scan the QR code with the phone (same Wi-Fi as the dev machine). If the LAN
   is blocked (strict firewall), retry with `expo start --tunnel`.
4. Tap **START DRIVE**, mount the phone, drive. Jolts vibrate + log live.
5. Tap **END DRIVE** → label each detection ✓ Pothole / ✗ Not → **Save**.
6. On the home screen, **Export training data** shares the labeled events as
   JSON — or better, **Upload to server**: start the ingestion server on the
   dev machine (`services/ingestion`, prints its `http://<lan-ip>:4477` URL),
   paste that URL into the app's server box, and tap Upload. Idempotent —
   re-uploading is always safe.

## What's inside

- `App.tsx` — the whole pilot: drive screen (speed, sensor Hz, live jolt
  count), review/labeling screen, AsyncStorage persistence, JSON export.
- Sensor plumbing: accelerometer at ~50 Hz (g-force → m/s², gravity included —
  the detector estimates gravity itself), gyro merged per-sample, GPS at 1 Hz
  with speed/heading feeding `DetectionPipeline` incrementally.
- `metro.config.js` — resolver fallback so Metro can consume workspace TS that
  uses NodeNext `./file.js` imports.

## Limits of the pilot (by design)

- **Foreground only** — screen stays on, like a nav app (that's Phase 1's
  dash-mount mode). The production app moves sensing into a native
  TurboModule with background operation per `docs/ARCHITECTURE.md`.
- Expo Go sensor cadence (~50 Hz requested) is enough for testing and data
  collection, below the 100 Hz production target.
