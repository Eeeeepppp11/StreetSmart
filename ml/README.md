# ml/ — Detection model platform (Python)

Standalone Python platform, decoupled from the TS backend. Owns the detection
model lifecycle.

- **`replay/`** — the **sensor-replay harness**: recorded real drives replay
  deterministically through the pipeline so model changes are regression-tested
  without re-driving. The single most important test asset in the project;
  build it first.
- **`training/`** — feature extraction + model training (TensorFlow/PyTorch),
  evaluated on **detection accuracy vs. false-positive rate**.
- **`export/`** — convert trained models to **TFLite** for `react-native-fast-tflite`.
- **`registry/`** — versioned model registry + OTA delivery metadata; every
  `JoltEvent` carries its `modelVersion` for attribution and safe rollback.
- **`data/`** — labelled events from the Phase-1 review-&-submit screen land here
  (raw drives are git-ignored; see `.gitignore`).

Suggested tooling: Python 3.11+, `uv`/`poetry`, `ruff`, `pytest`.

**Phase 1** bootstraps this with the replay harness + the first training loop on
data the heuristic detector + review screen produce.
