"""End-to-end harness tests: golden drives through the REAL compiled detector.

Requires Node.js on PATH and a built detector
(pnpm --filter @potholeproof/detector build) — the bridge raises a clear
BridgeError otherwise; these tests are the ml/-side mirror of the TS CLI test.
"""

import pytest

from replay import bridge, metrics


@pytest.fixture(scope="module")
def demo_drive():
    return bridge.synth_drive("demo")


def test_demo_drive_perfect_on_golden(demo_drive):
    events = bridge.replay_drive(demo_drive)
    report = metrics.evaluate_drive(demo_drive, events)
    assert report.recall == 1.0, metrics.format_report(report)
    assert report.precision == 1.0, metrics.format_report(report)
    assert report.class_accuracy == 1.0, metrics.format_report(report)
    assert report.truth_count == 4


def test_clean_drive_no_false_positives():
    drive = bridge.synth_drive("clean")
    events = bridge.replay_drive(drive)
    assert events == []


def test_replay_is_deterministic(demo_drive):
    a = bridge.replay_drive(demo_drive)
    b = bridge.replay_drive(demo_drive)
    assert a == b


def test_model_version_stamped(demo_drive):
    events = bridge.replay_drive(demo_drive, model_version="rig-test")
    assert events and all(e["modelVersion"] == "rig-test" for e in events)
