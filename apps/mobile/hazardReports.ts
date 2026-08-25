import {
  addDoc,
  collection,
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import type { JoltClassification, LatLng } from "@potholeproof/shared-types";
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
}

export const HAZARD_REPORTS_COLLECTION = "hazardReports";
export const HAZARD_CONTRIBUTIONS_COLLECTION = "hazardContributions";

export async function fileHazardReport(
  uid: string,
  driveId: string | null,
  location: LatLng,
  classification: JoltClassification,
  severity: number
): Promise<void> {
  await addDoc(collection(db, HAZARD_REPORTS_COLLECTION), {
    uid,
    driveId,
    location,
    classification,
    severity,
    capturedAt: new Date().toISOString(),
    createdAt: serverTimestamp(),
  });
}

/**
 * One row of "this user contributed evidence to this hazard." Doc id is
 * deterministic (`hazardId_uid`) so writes are idempotent — no read-before-write
 * race to dedupe a user reporting the same hazard twice.
 */
export async function recordHazardContribution(hazardId: string, uid: string): Promise<void> {
  await setDoc(
    doc(db, HAZARD_CONTRIBUTIONS_COLLECTION, `${hazardId}_${uid}`),
    { hazardId, uid, createdAt: serverTimestamp() },
    { merge: true }
  );
}
