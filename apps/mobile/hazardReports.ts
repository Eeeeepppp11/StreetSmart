import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import type { JoltClassification, LatLng } from "@potholeproof/shared-types";
import { toHazardCell } from "@potholeproof/geo";
import { db } from "./firebase";

/** Waze-style "report as you go" taps — a manual sighting, not a detection. */
export interface HazardReportDoc {
  id: string;
  uid: string;
  driveId: string | null;
  location: LatLng;
  classification: JoltClassification;
  /** 0..1 — coarse tri-level pick (minor/moderate/severe), not model output. */
  severity: number;
  capturedAt: string;
  /** Set when the reporter takes the report back; the doc is kept, but ignored. */
  retracted?: boolean;
}

export const HAZARD_REPORTS_COLLECTION = "hazardReports";
export const HAZARD_CONTRIBUTIONS_COLLECTION = "hazardContributions";

/** A manual report is weaker evidence than a sensor detection (which enters the
 *  engine at the model's own confidence, up to 1). */
export const REPORT_WEIGHT = 0.65;

/** Only potholes (and clearly severe rough road) become hazards; other manual
 *  reports are stored as data but never reach the map or the city-report path. */
export function isHazardReport(classification: JoltClassification, severity: number): boolean {
  return classification === "pothole" || (classification === "rough_road" && severity >= 0.67);
}

/** One report per user per hazard cell per (UTC) day — the doc id enforces it. */
export function reportDocId(cell: string, uid: string, capturedAt: string): string {
  return `${cell}_${uid}_${capturedAt.slice(0, 10)}`;
}

export type FileReportResult = { status: "filed"; id: string } | { status: "duplicate"; id: string };

export async function fileHazardReport(
  uid: string,
  driveId: string | null,
  location: LatLng,
  classification: JoltClassification,
  severity: number
): Promise<FileReportResult> {
  const capturedAt = new Date().toISOString();
  const cell = toHazardCell(location);
  const id = reportDocId(cell, uid, capturedAt);
  const ref = doc(collection(db, HAZARD_REPORTS_COLLECTION), id);

  const existing = await getDoc(ref);
  if (existing.exists() && !(existing.data() as { retracted?: boolean }).retracted) {
    return { status: "duplicate", id };
  }

  await setDoc(ref, {
    uid,
    driveId,
    location,
    classification,
    severity,
    capturedAt,
    retracted: false,
    createdAt: serverTimestamp(),
  });
  await recordHazardContribution(cell, uid);
  return { status: "filed", id };
}

export async function updateHazardReport(
  id: string,
  patch: { classification: JoltClassification; severity: number }
): Promise<void> {
  await updateDoc(doc(db, HAZARD_REPORTS_COLLECTION, id), patch);
}

export async function retractHazardReport(id: string): Promise<void> {
  await updateDoc(doc(db, HAZARD_REPORTS_COLLECTION, id), { retracted: true });
}

/**
 * One row of "this user contributed evidence to this hazard." Doc id is
 * deterministic (`hazardId_uid`) so writes are idempotent — no read-before-write
 * race to dedupe a user reporting the same hazard twice. Contribution docs are
 * create-only (firestore.rules), so on a repeat the merge-write is a denied
 * update; the credit already exists, so that specific failure is ignored.
 */
export async function recordHazardContribution(hazardId: string, uid: string): Promise<void> {
  try {
    await setDoc(
      doc(db, HAZARD_CONTRIBUTIONS_COLLECTION, `${hazardId}_${uid}`),
      { hazardId, uid, createdAt: serverTimestamp() },
      { merge: true }
    );
  } catch (e) {
    if ((e as { code?: string }).code !== "permission-denied") throw e;
  }
}
