# ml/ — Detection model platform (Python)

Standalone Python platform, decoupled from the TS backend. Owns the detection
model lifecycle.

- **`replay/`** — not yet built. The **sensor-replay harness**: recorded real
  drives replay deterministically through the pipeline so model changes are
  regression-tested without re-driving. Build this once real drives exist.
- **`training/`** — **built**. `train.py` trains a small MLP (10 → 32 → 16 → 4,
  `Normalization` → `Dense/ReLU` ×2 → `Dense/softmax`) on
  `ml/data/training_dataset.json`, evaluated on accuracy + the pothole
  false-positive rate.
- **`export/`** — **built**. `export_model.py` converts the trained Keras model
  to both a `.tflite` file (for `react-native-fast-tflite`, once the app moves
  off Expo Go to a custom dev client — native TFLite modules can't run in Expo
  Go) and a portable weights JSON. `sync_to_app.mjs` turns that JSON into
  `packages/detector/src/model.weights.ts`, consumed by the pure-JS forward
  pass in `packages/detector/src/model.ts` (`classifyWithModel`) — that's what
  actually runs in the app today, swapped in via `PipelineDeps.classify` in
  `apps/mobile/App.tsx`. `verify_parity_python.py` + `model.test.ts` check the
  JS reimplementation numerically matches the TensorFlow model.
- **`registry/`** — **built**. `models.json` — one entry per model version,
  matching the `modelVersion` every `JoltEvent` carries.
- **`data/`** — `training_dataset.json` is the input read by training and
  parity verification.
  Raw drives are git-ignored (`ml/data/raw/`) for size/privacy.

Suggested tooling: Python 3.11+, `uv`/`poetry`, `ruff`, `pytest`.
