"""Node bridge to the real TS detector.

Evaluation must run the exact detector that ships on the phone, so instead of
porting it, the harness shells out to `packages/detector/dist/cli.js`
(`synth` emits golden drives, `replay` runs the batch detector). Drives cross
the boundary as the `RecordedDrive` JSON defined in
packages/detector/src/replay.ts.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

ML_ROOT = Path(__file__).resolve().parents[1]


class BridgeError(RuntimeError):
    """The Node bridge is unavailable or the detector CLI failed."""


def find_repo_root(start: Path = ML_ROOT) -> Path:
    for candidate in (start, *start.parents):
        if (candidate / "pnpm-workspace.yaml").exists():
            return candidate
    raise BridgeError(
        f"could not find the repo root (pnpm-workspace.yaml) above {start}"
    )


def detector_cli_path() -> Path:
    cli = find_repo_root() / "packages" / "detector" / "dist" / "cli.js"
    if not cli.exists():
        raise BridgeError(
            "detector CLI not built — run: pnpm --filter @potholeproof/detector build"
        )
    return cli


def _run_cli(args: list[str], stdin_text: str | None = None) -> str:
    cmd = ["node", str(detector_cli_path()), *args]
    try:
        proc = subprocess.run(
            cmd,
            input=stdin_text,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=120,
        )
    except FileNotFoundError as err:
        raise BridgeError("Node.js not found on PATH (needed for the bridge)") from err
    if proc.returncode != 0:
        raise BridgeError(
            f"detector CLI failed ({' '.join(args)}): {proc.stderr.strip()}"
        )
    return proc.stdout


def synth_drive(preset: str = "demo", seed: int | None = None) -> dict[str, Any]:
    """Generate a golden RecordedDrive (with embedded `truth`) via the TS CLI."""
    args = ["synth", "--preset", preset]
    if seed is not None:
        args += ["--seed", str(seed)]
    return json.loads(_run_cli(args))


def replay_drive(
    drive: dict[str, Any], model_version: str = "heuristic-v0"
) -> list[dict[str, Any]]:
    """Run a RecordedDrive through the real detector; returns raw JoltEvent dicts."""
    out = _run_cli(
        ["replay", "--model-version", model_version], stdin_text=json.dumps(drive)
    )
    return json.loads(out)["events"]
