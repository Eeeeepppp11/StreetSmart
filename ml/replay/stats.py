"""Labeled-dataset statistics — the "do we have enough data yet?" view.

Consumes the labeled rows the ingestion server returns (heuristic-classified
JoltEvents plus the human pothole / not_pothole label from the review screen)
and summarizes class balance, heuristic-vs-human agreement, severity spread,
and collection progress per device and per day.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any

CLASSIFICATIONS = ["pothole", "speed_bump", "rough_road", "other"]
LABELS = ["pothole", "not_pothole"]
SEVERITY_BUCKETS = [(0.0, 0.2), (0.2, 0.4), (0.4, 0.6), (0.6, 0.8), (0.8, 1.01)]


@dataclass
class DatasetStats:
    total: int = 0
    by_label: Counter = field(default_factory=Counter)
    # confusion[classification][label] -> count
    confusion: dict[str, Counter] = field(
        default_factory=lambda: defaultdict(Counter)
    )
    severity_hist: dict[str, Counter] = field(
        default_factory=lambda: defaultdict(Counter)
    )
    by_device: Counter = field(default_factory=Counter)
    by_day: Counter = field(default_factory=Counter)
    by_model: Counter = field(default_factory=Counter)

    @property
    def detector_pothole_precision(self) -> float | None:
        """Of events the heuristic called pothole, share humans confirmed."""
        row = self.confusion.get("pothole")
        if not row or sum(row.values()) == 0:
            return None
        return row["pothole"] / sum(row.values())

    @property
    def detector_pothole_recall(self) -> float | None:
        """Of human-confirmed potholes, share the heuristic also called pothole.

        Only proxies true recall: potholes the detector never emitted were
        never shown on the review screen, so they can't appear here.
        """
        confirmed = sum(row["pothole"] for row in self.confusion.values())
        if confirmed == 0:
            return None
        return self.confusion["pothole"]["pothole"] / confirmed


def _bucket(severity: float) -> str:
    for lo, hi in SEVERITY_BUCKETS:
        if lo <= severity < hi:
            return f"{lo:.1f}-{min(hi, 1.0):.1f}"
    return "?"


def summarize(events: list[dict[str, Any]]) -> DatasetStats:
    s = DatasetStats(total=len(events))
    for e in events:
        label = e.get("label") or "unlabeled"
        s.by_label[label] += 1
        s.confusion[e["classification"]][label] += 1
        s.severity_hist[label][_bucket(e["severity"])] += 1
        s.by_device[e["anonDeviceId"]] += 1
        s.by_day[e["capturedAt"][:10]] += 1
        s.by_model[e["modelVersion"]] += 1
    return s


def format_stats(s: DatasetStats) -> str:
    if s.total == 0:
        return "No labeled events yet."

    lines = [f"Labeled training set: {s.total} events"]
    lines.append(
        "  " + "   ".join(f"{lb}: {s.by_label[lb]}" for lb in LABELS if s.by_label[lb])
    )

    lines.append("")
    lines.append("Heuristic classification x human label")
    header = f"  {'detector said':<14}" + "".join(f"{lb:>13}" for lb in LABELS)
    lines.append(header)
    for cls in CLASSIFICATIONS:
        row = s.confusion.get(cls)
        if not row:
            continue
        lines.append(
            f"  {cls:<14}" + "".join(f"{row[lb]:>13}" for lb in LABELS)
        )
    if (p := s.detector_pothole_precision) is not None:
        lines.append(f"  pothole precision vs humans: {p:.0%}")
    if (r := s.detector_pothole_recall) is not None:
        lines.append(f"  pothole recall vs humans (proxy): {r:.0%}")

    lines.append("")
    lines.append("Severity distribution (by human label)")
    buckets = [f"{lo:.1f}-{min(hi, 1.0):.1f}" for lo, hi in SEVERITY_BUCKETS]
    lines.append(f"  {'label':<14}" + "".join(f"{b:>10}" for b in buckets))
    for lb, hist in sorted(s.severity_hist.items()):
        lines.append(f"  {lb:<14}" + "".join(f"{hist[b]:>10}" for b in buckets))

    lines.append("")
    lines.append("Collection progress")
    for day, n in sorted(s.by_day.items()):
        lines.append(f"  {day}: {n}")
    lines.append(f"  devices: {len(s.by_device)}   models: " +
                 ", ".join(f"{m} ({n})" for m, n in sorted(s.by_model.items())))
    return "\n".join(lines)
