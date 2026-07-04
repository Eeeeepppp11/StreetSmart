import { test } from "node:test";
import assert from "node:assert/strict";
import type { HazardRecord } from "@potholeproof/shared-types";
import {
  hazardToOpen311Request,
  normalizeOpen311Status,
  draftCivicReport,
} from "./open311.js";

const ISO = "2026-07-03T22:00:00.000Z";

function haz(over: Partial<HazardRecord> = {}): HazardRecord {
  return {
    id: "haz-1",
    h3Cell: "c",
    location: { lat: 37.7749, lng: -122.4194 },
    severity: 0.8,
    severityBand: "severe",
    confidence: 0.82,
    status: "active",
    firstSeen: ISO,
    lastConfirmed: ISO,
    passCount: 5,
    cleanPassCount: 0,
    modelVersion: "v0",
    ...over,
  };
}

test("hazardToOpen311Request maps location + service code + description", () => {
  const p = hazardToOpen311Request(haz(), { serviceCode: "POTHOLE-01" });
  assert.equal(p.service_code, "POTHOLE-01");
  assert.equal(p.lat, 37.7749);
  assert.equal(p.long, -122.4194);
  assert.match(p.description, /severe/);
  assert.match(p.description, /82% confidence/);
  assert.equal("media_url" in p, false);
});

test("photo is attached only when provided", () => {
  const withPhoto = hazardToOpen311Request(haz(), {
    serviceCode: "X",
    mediaUrl: "https://cdn/x.jpg",
  });
  assert.equal(withPhoto.media_url, "https://cdn/x.jpg");
});

test("normalizeOpen311Status maps a case-insensitive superset", () => {
  assert.equal(normalizeOpen311Status("open"), "submitted");
  assert.equal(normalizeOpen311Status("Acknowledged"), "acknowledged");
  assert.equal(normalizeOpen311Status("in progress"), "in_progress");
  assert.equal(normalizeOpen311Status("CLOSED"), "closed");
  assert.equal(normalizeOpen311Status("resolved"), "closed");
  assert.equal(normalizeOpen311Status("duplicate"), "rejected");
  assert.equal(normalizeOpen311Status("something-weird"), "submitted");
});

test("draftCivicReport links the hazard and starts as a draft", () => {
  let n = 0;
  const r = draftCivicReport(haz({ id: "haz-9" }), "open311", () => `rep-${++n}`);
  assert.equal(r.id, "rep-1");
  assert.equal(r.hazardId, "haz-9");
  assert.equal(r.provider, "open311");
  assert.equal(r.status, "draft");
  assert.equal("externalId" in r, false);
});
