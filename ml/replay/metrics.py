"""Score replayed detections against a golden drive's ground truth.

Events carry wall-clock `capturedAt` (copied from the nearest GPS fix, so up
to ±half the fix interval off the impulse time); truth carries the drive's
monotonic `atMs`. Times are put on the same axis via the drive's GPS track,
then truth and events are greedily matched within a tolerance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

# What each injected impulse kind should classify as (see golden.ts).
EXPECTED_CLASS = {"sharp": "pothole", "rounded": "speed_bump"}

DEFAULT_TOLERANCE_MS = 1500


def _iso_ms(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000


def event_time_ms(event: dict[str, Any], gps: list[dict[str, Any]]) -> float:
    """Monotonic drive time of an event, derived from the GPS track's clock."""
    if not gps:
        raise ValueError("drive has no GPS fixes to anchor the clock")
    base_epoch_ms = _iso_ms(gps[0]["capturedAt"]) - gps[0]["t"]
    return _iso_ms(event["capturedAt"]) - base_epoch_ms


@dataclass
class Match:
    truth: dict[str, Any]
    event: dict[str, Any]
    offset_ms: float

    @property
    def class_ok(self) -> bool:
        return self.event["classification"] == EXPECTED_CLASS[self.truth["kind"]]


@dataclass
class MatchReport:
    label: str
    matches: list[Match] = field(default_factory=list)
    missed: list[dict[str, Any]] = field(default_factory=list)
    false_positives: list[dict[str, Any]] = field(default_factory=list)

    @property
    def truth_count(self) -> int:
        return len(self.matches) + len(self.missed)

    @property
    def event_count(self) -> int:
        return len(self.matches) + len(self.false_positives)

    @property
    def recall(self) -> float:
        return len(self.matches) / self.truth_count if self.truth_count else 1.0

    @property
    def precision(self) -> float:
        return len(self.matches) / self.event_count if self.event_count else 1.0

    @property
    def class_accuracy(self) -> float:
        if not self.matches:
            return 1.0
        return sum(m.class_ok for m in self.matches) / len(self.matches)


def match_events(
    truth: list[dict[str, Any]],
    events: list[dict[str, Any]],
    gps: list[dict[str, Any]],
    tolerance_ms: float = DEFAULT_TOLERANCE_MS,
    label: str = "drive",
) -> MatchReport:
    """Greedily pair each ground-truth impulse with the closest unclaimed event."""
    report = MatchReport(label=label)
    timed = [(event_time_ms(e, gps), e) for e in events]
    claimed: set[int] = set()

    for t in sorted(truth, key=lambda x: x["atMs"]):
        best_i, best_dt = -1, tolerance_ms + 1
        for i, (et, _) in enumerate(timed):
            dt = abs(et - t["atMs"])
            if i not in claimed and dt < best_dt:
                best_i, best_dt = i, dt
        if best_i >= 0 and best_dt <= tolerance_ms:
            claimed.add(best_i)
            report.matches.append(Match(t, timed[best_i][1], best_dt))
        else:
            report.missed.append(t)

    report.false_positives = [e for i, (_, e) in enumerate(timed) if i not in claimed]
    return report


def evaluate_drive(
    drive: dict[str, Any],
    events: list[dict[str, Any]],
    tolerance_ms: float = DEFAULT_TOLERANCE_MS,
) -> MatchReport:
    """Score events replayed from a golden drive (must carry a `truth` array)."""
    if "truth" not in drive:
        raise ValueError("drive has no `truth` — not a golden fixture")
    return match_events(
        drive["truth"],
        events,
        drive["gps"],
        tolerance_ms,
        label=drive.get("label", "drive"),
    )


def format_report(report: MatchReport) -> str:
    lines = [
        f"{report.label}: {report.truth_count} truth, {report.event_count} detected",
        f"  recall {report.recall:.0%}   precision {report.precision:.0%}"
        f"   class accuracy {report.class_accuracy:.0%}",
    ]
    for m in report.matches:
        mark = "ok " if m.class_ok else "MIS"
        lines.append(
            f"  [{mark}] truth {m.truth['kind']}@{m.truth['atMs']}ms -> "
            f"{m.event['classification']} (sev {m.event['severity']:.2f}, "
            f"conf {m.event['confidence']:.2f}, offset {m.offset_ms:.0f}ms)"
        )
    for t in report.missed:
        lines.append(f"  [MISSED] {t['kind']}@{t['atMs']}ms (peak {t['peak']})")
    for e in report.false_positives:
        lines.append(
            f"  [FALSE+] {e['classification']} at {e['capturedAt']} "
            f"(sev {e['severity']:.2f})"
        )
    return "\n".join(lines)
