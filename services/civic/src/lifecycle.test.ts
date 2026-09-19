import { test } from "node:test";
import assert from "node:assert/strict";
import type { HazardRecord } from "@potholeproof/shared-types";
import {
  canFileReport,
  isOpenStatus,
  nextCityStatuses,
  CIVIC_STATUS_LABEL,
} from "./lifecycle.js";
import { describeHazardForCity, hazardToOpen311Request, serviceCodeFor, withReporterNotes } from "./open311.js";
import { isCrowdReportable } from "./reporting.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-20T12:00:00.000Z");

function haz(over: Partial<HazardRecord> = {}): HazardRecord {
  return {
    id: "c",
    h3Cell: "c",
    location: { lat: 37.7749, lng: -122.4194 },
    severity: 0.5,
    severityBand: "moderate",
    confidence: 0.8,
    status: "active",
    firstSeen: "2026-09-14T12:00:00.000Z",
    lastConfirmed: "2026-09-19T12:00:00.000Z",
    passCount: 4,
    cleanPassCount: 0,
    modelVersion: "v0",
    ...over,
  };
}

test("a report moves submitted → acknowledged → in_progress → closed, with reject while open", () => {
  assert.deepEqual(nextCityStatuses("submitted"), ["acknowledged", "rejected"]);
  assert.deepEqual(nextCityStatuses("acknowledged"), ["in_progress", "closed", "rejected"]);
  assert.deepEqual(nextCityStatuses("in_progress"), ["closed", "rejected"]);
  assert.deepEqual(nextCityStatuses("closed"), []);
  assert.deepEqual(nextCityStatuses("rejected"), []);
});

test("submitted reads as pending city review; closed reads as complete", () => {
  assert.equal(CIVIC_STATUS_LABEL.submitted, "Pending city review");
  assert.equal(CIVIC_STATUS_LABEL.closed, "Complete");
  assert.equal(isOpenStatus("in_progress"), true);
  assert.equal(isOpenStatus("closed"), false);
});

test("canFileReport blocks while a report is open", () => {
  const r = canFileReport({ status: "submitted", submittedAt: new Date(NOW).toISOString() }, NOW);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /open report/);
});

test("canFileReport enforces a cooldown after close/reject, then allows re-filing", () => {
  const closedAt = new Date(NOW - 2 * DAY).toISOString();
  const early = canFileReport({ status: "closed", closedAt }, NOW);
  assert.equal(early.ok, false);
  assert.match(early.reason ?? "", /5 days/);
  const later = canFileReport({ status: "rejected", closedAt: new Date(NOW - 8 * DAY).toISOString() }, NOW);
  assert.equal(later.ok, true);
  assert.equal(canFileReport(undefined, NOW).ok, true);
});

test("non-severe hazards need 2 distinct days of evidence; severe needs 1", () => {
  assert.equal(isCrowdReportable(haz(), 3, 1), false);
  assert.equal(isCrowdReportable(haz(), 3, 2), true);
  const severe = haz({ severity: 0.8, severityBand: "severe" });
  assert.equal(isCrowdReportable(severe, 2, 1), true);
});

test("trusted-driver weight can reach the bar with fewer people", () => {
  // two trusted drivers = 3.0 weight
  assert.equal(isCrowdReportable(haz(), 3.0, 2), true);
  assert.equal(isCrowdReportable(haz(), 2.5, 2), false);
});

test("description includes address, evidence, notes and the right hazard kind", () => {
  const text = describeHazardForCity(haz(), {
    kind: "pothole",
    address: "100 Market St, San Francisco",
    confirmers: 4,
    notes: "  Deep, by the bus stop  ",
  });
  assert.match(text, /^Pothole \(moderate severity, 80% confidence\)\./);
  assert.match(text, /Location: 100 Market St, San Francisco\./);
  assert.match(text, /confirmed by 4 drivers/);
  assert.match(text, /seen over 6 days/);
  assert.match(text, /Reporter notes: Deep, by the bus stop/);
  const rough = describeHazardForCity(haz(), { kind: "rough_road" });
  assert.match(rough, /^Severely rough road surface/);
});

test("service code follows the hazard kind", () => {
  assert.equal(serviceCodeFor("pothole"), "pothole-repair");
  assert.equal(serviceCodeFor("rough_road"), "road-surface-repair");
  const p = hazardToOpen311Request(haz(), {
    serviceCode: serviceCodeFor("rough_road"),
    context: { kind: "rough_road" },
  });
  assert.equal(p.service_code, "road-surface-repair");
  assert.match(p.description, /Severely rough road/);
});

test("withReporterNotes adds, replaces and removes the notes sentence", () => {
  const base = describeHazardForCity(haz(), { address: "1 Main St" });
  assert.doesNotMatch(base, /Reporter notes/);

  const added = withReporterNotes(base, "  Deep hole  ");
  assert.match(added, /Reporter notes: Deep hole Auto-reported by StreetSmart\.$/);

  const replaced = withReporterNotes(added, "Near the bus stop");
  assert.match(replaced, /Reporter notes: Near the bus stop Auto-reported/);
  assert.doesNotMatch(replaced, /Deep hole/);

  assert.equal(withReporterNotes(replaced, "   "), base);
  // Same as building it with the note from the start.
  assert.equal(added, describeHazardForCity(haz(), { address: "1 Main St", notes: "Deep hole" }));
});
