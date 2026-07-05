import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createIngestionServer } from "./server.js";

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

function startServer(): Promise<string> {
  const server = createIngestionServer({ dbPath: ":memory:" });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function event(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    capturedAt: "2026-07-04T13:00:00.000Z",
    location: { lat: 37.7749, lng: -122.4194 },
    speedMps: 13.4,
    severity: 0.5,
    confidence: 0.8,
    classification: "pothole",
    modelVersion: "heuristic-v0-expo",
    ...over,
  };
}

function upload(events: unknown[], labels?: Record<string, unknown>) {
  return {
    anonDeviceId: "anon-1",
    appVersion: "0.1.0",
    sentAt: "2026-07-04T13:05:00.000Z",
    events,
    ...(labels ? { labels } : {}),
  };
}

async function post(base: string, path: string, body: unknown) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

test("health starts empty and counts stored events", async () => {
  const base = await startServer();
  let health = await (await fetch(base + "/v1/health")).json();
  assert.deepEqual(health, { ok: true, events: 0, labeled: 0 });

  await post(base, "/v1/uploads", upload([event("e1")], { e1: "pothole" }));
  health = await (await fetch(base + "/v1/health")).json();
  assert.deepEqual(health, { ok: true, events: 1, labeled: 1 });
});

test("stores events, dedups on re-upload", async () => {
  const base = await startServer();
  const first = await post(base, "/v1/uploads", upload([event("a"), event("b")]));
  assert.equal(first.status, 200);
  assert.equal(first.body.stored, 2);
  assert.equal(first.body.duplicates, 0);

  const again = await post(base, "/v1/uploads", upload([event("a"), event("b")]));
  assert.equal(again.body.stored, 0);
  assert.equal(again.body.duplicates, 2);
});

test("bad envelope → 400; bad event within a good envelope → rejected per-index", async () => {
  const base = await startServer();
  const bad = await post(base, "/v1/uploads", { nope: true });
  assert.equal(bad.status, 400);

  const mixed = await post(
    base,
    "/v1/uploads",
    upload([event("ok"), event("bad", { severity: 99 })])
  );
  assert.equal(mixed.status, 200);
  assert.equal(mixed.body.stored, 1);
  assert.equal(mixed.body.rejected.length, 1);
});

test("training-data returns only labeled events; junk labels are dropped", async () => {
  const base = await startServer();
  await post(
    base,
    "/v1/uploads",
    upload([event("lab"), event("unlab"), event("junk")], {
      lab: "pothole",
      junk: "DROP TABLE events;",
    })
  );
  const data = (await (await fetch(base + "/v1/training-data")).json()) as {
    events: Record<string, unknown>[];
  };
  assert.equal(data.events.length, 1);
  assert.equal(data.events[0]!.id, "lab");
  assert.equal(data.events[0]!.label, "pothole");
  assert.equal(data.events[0]!.anonDeviceId, "anon-1");
});

test("invalid JSON body → 400, unknown route → 404", async () => {
  const base = await startServer();
  const res = await fetch(base + "/v1/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  assert.equal(res.status, 400);
  assert.equal((await fetch(base + "/v1/nope")).status, 404);
});
