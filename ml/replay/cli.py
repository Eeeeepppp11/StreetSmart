"""Replay-harness CLI. Run from ml/:

  uv run python -m replay.cli eval                 # golden-drive regression check
  uv run python -m replay.cli replay --drive d.json
  uv run python -m replay.cli synth --preset demo --out d.json
  uv run python -m replay.cli pull --server http://192.168.x.x:8787
  uv run python -m replay.cli stats                # class balance / agreement
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import bridge, dataset, metrics, stats


def cmd_synth(args: argparse.Namespace) -> int:
    drive = bridge.synth_drive(args.preset, args.seed)
    text = json.dumps(drive)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"wrote {args.out} ({len(drive['samples'])} samples, "
              f"{len(drive['truth'])} truth events)")
    else:
        print(text)
    return 0


def cmd_replay(args: argparse.Namespace) -> int:
    drive = json.loads(Path(args.drive).read_text(encoding="utf-8"))
    events = bridge.replay_drive(drive, args.model_version)
    if args.json:
        print(json.dumps({"events": events}, indent=1))
    else:
        for e in events:
            print(f"{e['capturedAt']}  {e['classification']:<11} "
                  f"sev {e['severity']:.2f}  conf {e['confidence']:.2f}")
        print(f"{len(events)} events")
    if "truth" in drive:
        report = metrics.evaluate_drive(drive, events)
        print()
        print(metrics.format_report(report))
    return 0


def cmd_eval(args: argparse.Namespace) -> int:
    """Replay golden presets (or given fixtures) and fail on any regression."""
    reports = []
    if args.drive:
        for p in args.drive:
            drive = json.loads(Path(p).read_text(encoding="utf-8"))
            reports.append(
                metrics.evaluate_drive(drive, bridge.replay_drive(drive))
            )
    else:
        for preset in ("demo", "clean"):
            drive = bridge.synth_drive(preset, args.seed)
            reports.append(
                metrics.evaluate_drive(drive, bridge.replay_drive(drive))
            )
    ok = True
    for r in reports:
        print(metrics.format_report(r))
        print()
        if r.recall < 1.0 or r.precision < 1.0 or r.class_accuracy < 1.0:
            ok = False
    print("PASS" if ok else "FAIL: detector regressed on golden drives")
    return 0 if ok else 1


def cmd_pull(args: argparse.Namespace) -> int:
    events = dataset.fetch_training_data(args.server)
    path = dataset.save_labeled(
        events, Path(args.out) if args.out else dataset.DEFAULT_LABELED_PATH
    )
    print(f"pulled {len(events)} labeled events -> {path}")
    return 0


def cmd_stats(args: argparse.Namespace) -> int:
    if args.server:
        events = dataset.fetch_training_data(args.server)
    else:
        events = dataset.load_labeled(
            Path(args.file) if args.file else dataset.DEFAULT_LABELED_PATH
        )
    print(stats.format_stats(stats.summarize(events)))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="replay", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("synth", help="generate a golden drive via the TS CLI")
    p.add_argument("--preset", choices=["demo", "clean"], default="demo")
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--out", help="write drive JSON here instead of stdout")
    p.set_defaults(fn=cmd_synth)

    p = sub.add_parser("replay", help="replay a RecordedDrive through the detector")
    p.add_argument("--drive", required=True, help="path to RecordedDrive JSON")
    p.add_argument("--model-version", default="heuristic-v0")
    p.add_argument("--json", action="store_true", help="dump raw JoltEvent JSON")
    p.set_defaults(fn=cmd_replay)

    p = sub.add_parser("eval", help="golden-drive regression check (exit 1 on fail)")
    p.add_argument("--drive", nargs="*", help="fixture paths (default: synth presets)")
    p.add_argument("--seed", type=int, default=None)
    p.set_defaults(fn=cmd_eval)

    p = sub.add_parser("pull", help="fetch labeled events from the ingestion server")
    p.add_argument("--server", required=True, help="e.g. http://192.168.1.10:8787")
    p.add_argument("--out", help=f"output path (default {dataset.DEFAULT_LABELED_PATH})")
    p.set_defaults(fn=cmd_pull)

    p = sub.add_parser("stats", help="labeled-dataset stats (balance, agreement)")
    p.add_argument("--file", help="labeled JSON path (default: last pull)")
    p.add_argument("--server", help="pull live from the server instead of a file")
    p.set_defaults(fn=cmd_stats)

    args = parser.parse_args(argv)
    try:
        return args.fn(args)
    except (bridge.BridgeError, FileNotFoundError, ValueError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
