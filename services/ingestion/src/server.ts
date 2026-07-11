import { createServer, type Server } from "node:http";
import { DatabaseSync } from "node:sqlite";
import type { JoltEvent, TrainingLabel } from "@potholeproof/shared-types";
import { validateUpload } from "./validation.js";

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export interface IngestionServerOptions {
  /** SQLite file path, or ":memory:" for tests. */
  dbPath: string;
}

export interface StoredEventRow {
  id: string;
  capturedAt: string;
  lat: number;
  lng: number;
  heading: number | null;
  speedMps: number;
  severity: number;
  confidence: number;
  classification: string;
  modelVersion: string;
  anonDeviceId: string;
  label: TrainingLabel | null;
  receivedAt: string;
}

function initDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      captured_at TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      heading REAL,
      speed_mps REAL NOT NULL,
      severity REAL NOT NULL,
      confidence REAL NOT NULL,
      classification TEXT NOT NULL,
      model_version TEXT NOT NULL,
      anon_device_id TEXT NOT NULL,
      label TEXT,
      received_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_label ON events(label);
  `);
  return db;
}

function insertEvents(
  db: DatabaseSync,
  events: JoltEvent[],
  labels: Record<string, TrainingLabel>,
  anonDeviceId: string,
  receivedAt: string
): { stored: number; duplicates: number } {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO events
     (id, captured_at, lat, lng, heading, speed_mps, severity, confidence,
      classification, model_version, anon_device_id, label, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let stored = 0;
  for (const e of events) {
    const res = stmt.run(
      e.id,
      e.capturedAt,
      e.location.lat,
      e.location.lng,
      e.heading ?? null,
      e.speedMps,
      e.severity,
      e.confidence,
      e.classification,
      e.modelVersion,
      anonDeviceId,
      labels[e.id] ?? null,
      receivedAt
    );
    stored += Number(res.changes);
  }
  return { stored, duplicates: events.length - stored };
}

/** Default/max size for a `GET /v1/review-queue` page. */
export const DEFAULT_REVIEW_QUEUE_LIMIT = 50;
export const MAX_REVIEW_QUEUE_LIMIT = 500;

export interface ReviewQueueItem extends Omit<StoredEventRow, "label"> {
  /** Higher = more useful for a human to label next. Not persisted. */
  priorityScore: number;
}

/**
 * Ranking for the human review queue (no model retraining or scoring here —
 * just a heuristic over already-stored confidence/severity to order unlabeled
 * events for a human reviewer).
 *
 * Two independent signals are summed:
 *  - Borderline confidence (0.35–0.65): these are the events the *current*
 *    detector is least sure about, so a label here teaches it the most.
 *    Score peaks at 1 when confidence == 0.5 and falls linearly to 0 at the
 *    band edges; outside the band it's 0.
 *  - High severity: an unlabeled high-severity event is the ones most likely
 *    to reach a civic report before any human has ever confirmed it's real,
 *    so severity itself (0..1) is added as a priority signal.
 * The two scores are just added (range 0..2) and sorted descending — this is
 * a simple, explainable ordering, not a calibrated model.
 */
const BORDERLINE_LOW = 0.35;
const BORDERLINE_HIGH = 0.65;
const BORDERLINE_CENTER = 0.5;
const BORDERLINE_HALF_WIDTH = BORDERLINE_CENTER - BORDERLINE_LOW;

function borderlineScore(confidence: number): number {
  if (confidence < BORDERLINE_LOW || confidence > BORDERLINE_HIGH) return 0;
  return 1 - Math.abs(confidence - BORDERLINE_CENTER) / BORDERLINE_HALF_WIDTH;
}

function reviewPriority(confidence: number, severity: number): number {
  return borderlineScore(confidence) + severity;
}

function listReviewQueue(db: DatabaseSync, limit: number): ReviewQueueItem[] {
  const rows = db
    .prepare(
      `SELECT id, captured_at, lat, lng, heading, speed_mps, severity,
              confidence, classification, model_version, anon_device_id,
              received_at
       FROM events WHERE label IS NULL`
    )
    .all() as Record<string, unknown>[];

  return rows
    .map((r) => ({
      id: r.id as string,
      capturedAt: r.captured_at as string,
      lat: r.lat as number,
      lng: r.lng as number,
      heading: (r.heading as number | null) ?? null,
      speedMps: r.speed_mps as number,
      severity: r.severity as number,
      confidence: r.confidence as number,
      classification: r.classification as string,
      modelVersion: r.model_version as string,
      anonDeviceId: r.anon_device_id as string,
      receivedAt: r.received_at as string,
      priorityScore: reviewPriority(r.confidence as number, r.severity as number),
    }))
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, limit);
}

function listTrainingData(db: DatabaseSync): StoredEventRow[] {
  const rows = db
    .prepare(
      `SELECT id, captured_at, lat, lng, heading, speed_mps, severity,
              confidence, classification, model_version, anon_device_id,
              label, received_at
       FROM events WHERE label IS NOT NULL ORDER BY captured_at`
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    capturedAt: r.captured_at as string,
    lat: r.lat as number,
    lng: r.lng as number,
    heading: (r.heading as number | null) ?? null,
    speedMps: r.speed_mps as number,
    severity: r.severity as number,
    confidence: r.confidence as number,
    classification: r.classification as string,
    modelVersion: r.model_version as string,
    anonDeviceId: r.anon_device_id as string,
    label: (r.label as TrainingLabel | null) ?? null,
    receivedAt: r.received_at as string,
  }));
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * The Phase-1 collect-only ingestion server: accepts labeled drive uploads
 * from the pilot app into SQLite and hands the labeled set to the ML rig.
 * Plain node:http + node:sqlite — zero runtime dependencies.
 */
export function createIngestionServer(options: IngestionServerOptions): Server {
  const db = initDb(options.dbPath);

  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      const json = JSON.stringify(body);
      res.writeHead(status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(json),
      });
      res.end(json);
    };

    try {
      if (req.method === "GET" && req.url === "/v1/health") {
        const total = (
          db.prepare("SELECT count(*) AS c FROM events").get() as { c: number }
        ).c;
        const labeled = (
          db
            .prepare("SELECT count(*) AS c FROM events WHERE label IS NOT NULL")
            .get() as { c: number }
        ).c;
        send(200, { ok: true, events: total, labeled });
        return;
      }

      if (req.method === "GET" && req.url === "/v1/training-data") {
        send(200, { events: listTrainingData(db) });
        return;
      }

      if (req.method === "GET" && req.url?.startsWith("/v1/review-queue")) {
        const url = new URL(req.url, "http://localhost");
        const rawLimit = url.searchParams.get("limit");
        const parsedLimit = rawLimit === null ? DEFAULT_REVIEW_QUEUE_LIMIT : Number(rawLimit);
        if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
          send(400, { ok: false, error: "limit must be a positive number" });
          return;
        }
        const limit = Math.min(Math.floor(parsedLimit), MAX_REVIEW_QUEUE_LIMIT);
        send(200, { events: listReviewQueue(db, limit) });
        return;
      }

      if (req.method === "POST" && req.url === "/v1/uploads") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readBody(req));
        } catch {
          send(400, { ok: false, error: "invalid JSON" });
          return;
        }
        const result = validateUpload(parsed);
        if (!result.ok) {
          send(400, { ok: false, errors: result.envelopeErrors });
          return;
        }
        const upload = parsed as {
          anonDeviceId: string;
          labels?: Record<string, unknown>;
        };
        const labels: Record<string, TrainingLabel> = {};
        if (upload.labels && typeof upload.labels === "object") {
          for (const [id, v] of Object.entries(upload.labels)) {
            if (v === "pothole" || v === "not_pothole") labels[id] = v;
          }
        }
        const { stored, duplicates } = insertEvents(
          db,
          result.accepted,
          labels,
          upload.anonDeviceId,
          new Date().toISOString()
        );
        send(200, {
          ok: true,
          accepted: result.accepted.length,
          rejected: result.rejected,
          stored,
          duplicates,
        });
        return;
      }

      send(404, { ok: false, error: "not found" });
    } catch (err) {
      send(500, { ok: false, error: String(err) });
    }
  });

  server.on("close", () => db.close());
  return server;
}
