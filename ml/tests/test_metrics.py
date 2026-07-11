"""Pure-Python metrics tests — no Node bridge required."""

from replay import metrics


def gps_track():
    # 1 Hz fixes on the golden-drive clock: t=0 corresponds to BASE_ISO.
    from datetime import datetime, timedelta, timezone

    base = datetime.fromtimestamp(1_760_000_000, tz=timezone.utc)
    return [
        {
            "t": t,
            "capturedAt": (base + timedelta(milliseconds=t)).isoformat()
            .replace("+00:00", "Z"),
        }
        for t in range(0, 11_000, 1000)
    ]


def event(at_ms, classification="pothole", severity=0.5, confidence=0.7):
    from datetime import datetime, timedelta, timezone

    base = datetime.fromtimestamp(1_760_000_000, tz=timezone.utc)
    iso = (base + timedelta(milliseconds=at_ms)).isoformat().replace("+00:00", "Z")
    return {
        "capturedAt": iso,
        "classification": classification,
        "severity": severity,
        "confidence": confidence,
    }


def truth(at_ms, kind="sharp"):
    return {"atMs": at_ms, "kind": kind, "peak": 10}


def test_event_time_recovers_monotonic_clock():
    gps = gps_track()
    assert metrics.event_time_ms(event(4000), gps) == 4000.0


def test_perfect_match():
    gps = gps_track()
    r = metrics.match_events(
        [truth(2000), truth(6000, "rounded")],
        [event(2000), event(6000, "speed_bump")],
        gps,
    )
    assert r.recall == 1.0 and r.precision == 1.0 and r.class_accuracy == 1.0


def test_missed_truth_lowers_recall():
    gps = gps_track()
    r = metrics.match_events([truth(2000), truth(8000)], [event(2000)], gps)
    assert r.recall == 0.5 and r.precision == 1.0
    assert r.missed[0]["atMs"] == 8000


def test_unmatched_event_is_false_positive():
    gps = gps_track()
    r = metrics.match_events([truth(2000)], [event(2000), event(9000)], gps)
    assert r.precision == 0.5 and r.recall == 1.0
    assert len(r.false_positives) == 1


def test_wrong_class_counts_against_class_accuracy():
    gps = gps_track()
    r = metrics.match_events([truth(2000, "sharp")], [event(2000, "speed_bump")], gps)
    assert r.recall == 1.0
    assert r.class_accuracy == 0.0


def test_match_outside_tolerance_rejected():
    gps = gps_track()
    r = metrics.match_events([truth(2000)], [event(5000)], gps, tolerance_ms=1500)
    assert r.recall == 0.0 and len(r.false_positives) == 1


def test_each_event_claimed_once():
    gps = gps_track()
    # two truths near one event: only one may claim it
    r = metrics.match_events([truth(1800), truth(2200)], [event(2000)], gps)
    assert len(r.matches) == 1 and len(r.missed) == 1


def test_empty_cases():
    gps = gps_track()
    r = metrics.match_events([], [], gps)
    assert r.recall == 1.0 and r.precision == 1.0
