# ml/ — Detection model platform (Python)

Standalone Python platform, decoupled from the TS backend. Owns the detection
model lifecycle.

- **`replay/`** — not yet built. The **sensor-replay harness**: recorded real
  drives replay deterministically through the pipeline so model changes are
  regression-tested without re-driving. Build this once real drives exist.
- **`training/`** — **built**. `train.py` trains a small MLP (10 → 32 → 16 → 4,
  `Normalization` → `Dense/ReLU` ×2 → `Dense/softmax`) on
  `ml/data/synthetic_dataset.json`, evaluated on accuracy + the pothole
  false-positive rate. `pip install -r requirements.txt && python train.py`.
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
- **`data/`** — **built, but synthetic.** `synthetic_dataset.json` is generated
  by `packages/detector/src/scripts/gen-training-data.ts`, which runs the
  REAL `extractFeatures` function against physically-parameterised synthetic
  sensor windows (the same generator behind Demo Drive). The feature vectors
  are genuine production code output; the underlying waveforms are not real
  recorded drives. Labelled events from the review screen (real drives) will
  land here once collected at volume — raw drives are git-ignored
  (`ml/data/raw/`; see `.gitignore`) for size/privacy.

Suggested tooling: Python 3.11+, `uv`/`poetry`, `ruff`, `pytest`.

**Full pipeline, end to end:**
```bash
pnpm --filter @potholeproof/detector build
node packages/detector/dist/scripts/gen-training-data.js   # → ml/data/synthetic_dataset.json
cd ml/training && pip install -r requirements.txt && python train.py
cd ../export && python export_model.py && node sync_to_app.mjs
```

**Known gap:** the current model (`mlp-v1-synthetic`) is trained entirely on
synthetic data — no real pothole/road-surface recordings exist yet. Treat its
accuracy numbers as a pipeline validation, not a real-world performance claim.
Retraining on real labelled drives (once `replay/` and real data collection
exist) is the next step before relying on it operationally.
