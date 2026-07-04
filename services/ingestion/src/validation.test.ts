import { test } from "node:test";
import assert from "node:assert/strict";
import { validateJoltEvent, validateUpload } from "./validation.js";

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    capturedAt: "2026-07-03T09:00:00.000Z",
    location: { lat: 37.7749, lng: -122.4194 },
    speedMps: 13.4,
    severity: 0.4,
    confidence: 0.8,
    classification: "pothole",
    modelVersion: "heuristic-v0",
    ...overrides,
  };
}

function validUpload(events: unknown[]) {
  return {
    anonDeviceId: "anon-abc",
    appVersion: "1.0.0",
    sentAt: "2026-07-03T09:01:00.000Z",
    events,
  };
}

test("accepts a well-formed event", () => {
  const r = validateJoltEvent(validEvent());
  assert.deepEqual(r.errors, []);
  assert.ok(r.value);
  assert.equal(r.value!.classification, "pothole");
});

test("reconstructs the event (drops unknown fields)", () => {
  const r = validateJoltEvent(validEvent({ evil: "drop me", speedMps: 20 }));
  assert.ok(r.value);
  assert.ok(!("evil" in r.value!));
  assert.equal(r.value!.speedMps, 20);
});

test("optional heading: kept when valid, omitted when absent", () => {
  const withH = validateJoltEvent(validEvent({ heading: 90 }));
  assert.equal(withH.value!.heading, 90);
  const without = validateJoltEvent(validEvent());
  assert.ok(!("heading" in without.value!));
});

test("rejects out-of-range and malformed fields", () => {
  assert.ok(validateJoltEvent(validEvent({ severity: 1.5 })).errors.length > 0);
  assert.ok(validateJoltEvent(validEvent({ confidence: -0.1 })).errors.length > 0);
  assert.ok(validateJoltEvent(validEvent({ speedMps: -1 })).errors.length > 0);
  assert.ok(validateJoltEvent(validEvent({ heading: 360 })).errors.length > 0);
  assert.ok(
    validateJoltEvent(validEvent({ classification: "earthquake" })).errors.length > 0
  );
  assert.ok(
    validateJoltEvent(validEvent({ location: { lat: 200, lng: 0 } })).errors.length > 0
  );
  assert.ok(validateJoltEvent(validEvent({ capturedAt: "not-a-date" })).errors.length > 0);
  assert.equal(validateJoltEvent(null).value, undefined);
});

test("upload: keeps valid events, reports bad ones per-index", () => {
  const r = validateUpload(
    validUpload([validEvent(), validEvent({ severity: 9 }), validEvent()])
  );
  assert.equal(r.ok, true);
  assert.equal(r.accepted.length, 2);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0]!.index, 1);
});

test("upload: rejects a malformed envelope", () => {
  // missing anonDeviceId
  const noDevice = validateUpload({
    appVersion: "1.0.0",
    sentAt: "2026-07-03T09:01:00.000Z",
    events: [validEvent()],
  });
  assert.equal(noDevice.ok, false);
  assert.ok(noDevice.envelopeErrors.length > 0);

  // empty events array
  assert.equal(validateUpload(validUpload([])).ok, false);

  // non-object inputs
  assert.equal(validateUpload("nope").ok, false);
  assert.equal(validateUpload(null).ok, false);

  // events present but not an array
  const badEvents = validateUpload({ ...validUpload([]), events: 5 });
  assert.equal(badEvents.ok, false);
  assert.ok(badEvents.envelopeErrors.some((e) => e.includes("array")));
});

test("upload: flags oversize batches", () => {
  const events = Array.from({ length: 3 }, () => validEvent());
  const r = validateUpload(validUpload(events), 2);
  assert.equal(r.ok, false);
  assert.ok(r.envelopeErrors.some((e) => e.includes("max batch size")));
});
