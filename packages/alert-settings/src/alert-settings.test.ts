import { test } from "node:test";
import assert from "node:assert/strict";
import type { JoltEvent } from "@potholeproof/shared-types";
import {
  AlertBundler,
  DEFAULT_ALERT_SETTINGS,
  phraseForBundle,
  shouldAlert,
  type AlertSettings,
} from "./index.js";

let seq = 0;
function joltEvent(over: Partial<JoltEvent> = {}): JoltEvent {
  seq += 1;
  return {
    id: `evt-${seq}`,
    capturedAt: "2026-07-10T09:00:00.000Z",
    location: { lat: 37.7749, lng: -122.4194 },
    speedMps: 13.4,
    severity: 0.5,
    confidence: 0.8,
    classification: "pothole",
    modelVersion: "v0",
    ...over,
  };
}

function settings(over: Partial<AlertSettings> = {}): AlertSettings {
  return { ...DEFAULT_ALERT_SETTINGS, ...over };
}

// --- shouldAlert -----------------------------------------------------------

test("sensitivity 'all' announces every classification regardless of severity", () => {
  const s = settings({ sensitivity: "all" });
  assert.equal(shouldAlert(joltEvent({ classification: "pothole", severity: 0.01 }), s), true);
  assert.equal(shouldAlert(joltEvent({ classification: "speed_bump", severity: 0.01 }), s), true);
  assert.equal(shouldAlert(joltEvent({ classification: "rough_road", severity: 0.01 }), s), true);
  assert.equal(shouldAlert(joltEvent({ classification: "other", severity: 0.01 }), s), true);
});

test("sensitivity 'moderate' announces severity >= 0.34 or any pothole", () => {
  const s = settings({ sensitivity: "moderate" });
  assert.equal(
    shouldAlert(joltEvent({ classification: "rough_road", severity: 0.34 }), s),
    true
  );
  assert.equal(
    shouldAlert(joltEvent({ classification: "rough_road", severity: 0.33 }), s),
    false
  );
  // Potholes always pass 'moderate', even at low severity.
  assert.equal(shouldAlert(joltEvent({ classification: "pothole", severity: 0.01 }), s), true);
});

test("sensitivity 'severe_only' announces only potholes with severity >= 0.67", () => {
  const s = settings({ sensitivity: "severe_only" });
  assert.equal(shouldAlert(joltEvent({ classification: "pothole", severity: 0.67 }), s), true);
  assert.equal(shouldAlert(joltEvent({ classification: "pothole", severity: 0.66 }), s), false);
  // Even a severe non-pothole is filtered out.
  assert.equal(
    shouldAlert(joltEvent({ classification: "rough_road", severity: 0.99 }), s),
    false
  );
});

// --- AlertBundler ------------------------------------------------------------

function clock(startMs: number) {
  let t = startMs;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("bundler drains null until bundleWindowMs has elapsed since the first buffered event", () => {
  const c = clock(0);
  const bundler = new AlertBundler({ now: c.now }, settings({ bundleWindowMs: 1000 }));
  bundler.add(joltEvent());
  assert.equal(bundler.drain(), null);
  c.advance(500);
  assert.equal(bundler.drain(), null);
});

test("bundler drains exactly at and after the window elapses", () => {
  const c = clock(0);
  const bundler = new AlertBundler({ now: c.now }, settings({ bundleWindowMs: 1000 }));
  bundler.add(joltEvent());
  c.advance(1000);
  const bundle = bundler.drain();
  assert.ok(bundle);
  assert.equal(bundle!.events.length, 1);
});

test("bundler resets after draining — a later add starts a fresh window", () => {
  const c = clock(0);
  const bundler = new AlertBundler({ now: c.now }, settings({ bundleWindowMs: 1000 }));
  bundler.add(joltEvent());
  c.advance(1000);
  assert.ok(bundler.drain());
  assert.equal(bundler.drain(), null, "nothing left to drain right after draining");

  bundler.add(joltEvent());
  assert.equal(bundler.drain(), null, "new window hasn't elapsed yet");
  c.advance(1000);
  assert.ok(bundler.drain());
});

test("bundler accumulates multiple sequential windows independently", () => {
  const c = clock(0);
  const bundler = new AlertBundler({ now: c.now }, settings({ bundleWindowMs: 500 }));

  bundler.add(joltEvent({ id: "a" }));
  c.advance(200);
  bundler.add(joltEvent({ id: "b" }));
  c.advance(300); // 500ms since "a", the window anchor
  const first = bundler.drain();
  assert.ok(first);
  assert.deepEqual(first!.events.map((e) => e.id), ["a", "b"]);

  bundler.add(joltEvent({ id: "c" }));
  c.advance(500);
  const second = bundler.drain();
  assert.ok(second);
  assert.deepEqual(second!.events.map((e) => e.id), ["c"]);
});

test("bundler with no buffered events drains null and does not start a window", () => {
  const c = clock(0);
  const bundler = new AlertBundler({ now: c.now }, settings({ bundleWindowMs: 1000 }));
  assert.equal(bundler.drain(), null);
  c.advance(10_000);
  assert.equal(bundler.drain(), null);
});

// --- phraseForBundle ---------------------------------------------------------

function bundleOf(events: JoltEvent[]) {
  const bundler = new AlertBundler({ now: () => 1000 }, settings({ bundleWindowMs: 0 }));
  for (const e of events) bundler.add(e);
  return bundler.drain()!;
}

test("phraseForBundle: single event names its classification", () => {
  assert.equal(
    phraseForBundle(bundleOf([joltEvent({ classification: "pothole" })])),
    "Pothole ahead"
  );
  assert.equal(
    phraseForBundle(bundleOf([joltEvent({ classification: "speed_bump" })])),
    "Speed bump ahead"
  );
  assert.equal(
    phraseForBundle(bundleOf([joltEvent({ classification: "rough_road" })])),
    "Rough road ahead"
  );
});

test("phraseForBundle: multiple events, same classification, are counted", () => {
  const bundle = bundleOf([
    joltEvent({ classification: "pothole" }),
    joltEvent({ classification: "pothole" }),
    joltEvent({ classification: "pothole" }),
  ]);
  assert.equal(phraseForBundle(bundle), "3 potholes detected");
});

test("phraseForBundle: mixed classifications fall back to a generic hazard count", () => {
  const bundle = bundleOf([
    joltEvent({ classification: "pothole" }),
    joltEvent({ classification: "speed_bump" }),
    joltEvent({ classification: "rough_road" }),
    joltEvent({ classification: "pothole" }),
  ]);
  assert.equal(phraseForBundle(bundle), "4 hazards detected");
});
