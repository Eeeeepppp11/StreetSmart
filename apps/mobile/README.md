# apps/mobile — PotholeProof app (React Native)

**Stack:** Bare React Native + TypeScript · `@rnmapbox/maps` (Mapbox) ·
`react-native-background-geolocation` · `react-native-fast-tflite` (on-device
model) · `op-sqlite` (local event log) · Zustand + TanStack Query.

**Responsibility:** the driver-facing client and the core IP host — the custom
native sensing module, on-device detection pipeline, local event log, map/nav
UI, proximity alerts, hazard-aware routing, review-&-submit, and leaderboards.

## Layering (keep the sensing loop native, off the JS bridge)

1. **Sensing (native)** — `native/ios` (Swift CoreMotion) + `native/android`
   (Kotlin SensorManager) TurboModule; batches 50–100 Hz accel/gyro + 1 Hz GPS,
   emits *events*, not raw samples.
2. **Inference (native + TFLite)** — window → features → classify on-device.
3. **Store** — `op-sqlite` local event log + cached hazard tiles.
4. **Sync** — batches `JoltEvent`s up, reconciles `HazardTile`s down.
5. **Presentation (RN/JS)** — Mapbox UI, alerts, routing, review/submit, gamify.

All wire types come from `@potholeproof/shared-types`.

## Getting started (planned)

```bash
# From repo root — initialise the bare RN app in place, then wire packages:
npx @react-native-community/cli init PotholeProof --directory apps/mobile
# add: @rnmapbox/maps, react-native-background-geolocation,
#      react-native-fast-tflite, @op-engineering/op-sqlite, zustand,
#      @tanstack/react-query, @potholeproof/shared-types (workspace:*)
```

**Phase 1** delivers this app with a heuristic detector (no ML yet) + the
review-&-submit screen that doubles as the labeling tool.
