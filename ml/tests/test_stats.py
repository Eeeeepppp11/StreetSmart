"""Pure-Python dataset-stats tests over server-shaped labeled rows."""

from replay import stats


def row(classification="pothole", label="pothole", severity=0.5,
        device="dev-1", captured="2026-07-05T18:00:00.000Z", model="heuristic-v0"):
    return {
        "id": "x",
        "capturedAt": captured,
        "lat": 37.77,
        "lng": -122.41,
        "heading": None,
        "speedMps": 13.4,
        "severity": severity,
        "confidence": 0.7,
        "classification": classification,
        "modelVersion": model,
        "anonDeviceId": device,
        "label": label,
        "receivedAt": captured,
    }


def test_counts_and_confusion():
    s = stats.summarize(
        [
            row(),  # detector pothole, human pothole
            row(label="not_pothole"),  # detector pothole, human says no
            row(classification="speed_bump", label="not_pothole"),
            row(classification="rough_road", label="pothole"),
        ]
    )
    assert s.total == 4
    assert s.by_label["pothole"] == 2
    assert s.by_label["not_pothole"] == 2
    assert s.confusion["pothole"]["pothole"] == 1
    assert s.confusion["pothole"]["not_pothole"] == 1
    assert s.detector_pothole_precision == 0.5
    assert s.detector_pothole_recall == 0.5  # 1 of 2 human potholes


def test_progress_grouping():
    s = stats.summarize(
        [
            row(captured="2026-07-05T18:00:00.000Z"),
            row(captured="2026-07-05T19:00:00.000Z", device="dev-2"),
            row(captured="2026-07-06T08:00:00.000Z"),
        ]
    )
    assert s.by_day["2026-07-05"] == 2
    assert s.by_day["2026-07-06"] == 1
    assert len(s.by_device) == 2


def test_severity_histogram_buckets():
    s = stats.summarize([row(severity=0.05), row(severity=0.95), row(severity=1.0)])
    assert s.severity_hist["pothole"]["0.0-0.2"] == 1
    assert s.severity_hist["pothole"]["0.8-1.0"] == 2


def test_format_smoke():
    text = stats.format_stats(stats.summarize([row()]))
    assert "Labeled training set: 1 events" in text
    assert "pothole precision vs humans: 100%" in text
    assert stats.format_stats(stats.summarize([])) == "No labeled events yet."
