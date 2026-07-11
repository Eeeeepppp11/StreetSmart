# ml/ — Detection model platform (Python)

Standalone Python platform, decoupled from the TS backend (not a pnpm
workspace). Owns the detection model lifecycle. Tooling: Python 3.11+ managed
by [uv](https://docs.astral.sh/uv/) (`.python-version` pins 3.12; `uv run`
bootstraps everything), `pytest`, `ruff`.

## What exists

- **`replay/`** — the **sensor-replay harness** (built): recorded drives
  replay deterministically through the **real compiled TS detector** via a
  Node bridge (`packages/detector/dist/cli.js`), so evaluation can never
  drift from what ships on the phone. Includes ground-truth matching metrics
  (recall / precision / class accuracy), labeled-dataset pull from the
  ingestion server, and dataset stats.
- **`data/`** — labelled events pulled from the ingestion server land in
  `data/labeled/` (git-ignored: rows carry precise pilot GPS). Raw drives, if
  ever exported, go to `data/raw/` (also git-ignored).
- **`training/`** — feature extraction + model training (TensorFlow/PyTorch),
  evaluated on **detection accuracy vs. false-positive rate**. *Not built.*
- **`export/`** — trained models → **TFLite** for `react-native-fast-tflite`.
  *Not built.*
- **`registry/`** — versioned model registry + OTA delivery metadata; every
  `JoltEvent` carries its `modelVersion` for attribution and safe rollback.
  *Not built.*

## Commands (run from `ml/`)

The bridge needs a built detector first:
`pnpm --filter @potholeproof/detector build` (from the repo root).

```bash
uv run pytest                                  # 16 tests, incl. end-to-end bridge
uv run ruff check .

uv run python -m replay.cli eval               # golden-drive regression check
                                               # (exit 1 if the detector regressed)
uv run python -m replay.cli synth --preset demo --out drive.json
uv run python -m replay.cli replay --drive drive.json

# collection-day loop: pull the labeled set off the LAN server, see progress
uv run python -m replay.cli pull --server http://192.168.x.x:4477
uv run python -m replay.cli stats              # class balance, heuristic-vs-human
                                               # agreement, severity spread, per-day
```

## Fixture format

Golden drives are the TS `RecordedDrive` shape (`packages/detector/src/replay.ts`)
plus a `truth` array of injected impulses (`packages/detector/src/golden.ts`).
`"sharp"` truth should classify as `pothole`, `"rounded"` as `speed_bump`.
Real recorded raw drives (when the app can export them) use the same shape
with hand-labelled `truth`.

## Next

Training bootstraps on the labeled `JoltEvent` set the `stats` command
summarizes (heuristic features + human pothole / not_pothole labels), then
graduates to raw-window training once the app exports raw sensor drives.
