import {
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import {
  draftCivicReport,
  hazardToOpen311Request,
  hazardsToReport,
  normalizeOpen311Status,
} from "@potholeproof/civic";
import type { CivicReport, CivicReportStatus, HazardRecord } from "@potholeproof/shared-types";
import { db } from "./firebase";
import { cityOf } from "./nav/city";

/**
 * Mocked civic filing — real payload/eligibility/status logic from
 * services/civic, no real HTTP to a real city. "Submitting" writes a
 * CivicReport doc; the city's side of the conversation is a scripted status
 * advance, not a polling loop against a live endpoint (no real endpoint
 * exists to poll for a demo).
 */
export const CIVIC_REPORTS_COLLECTION = "civicReports";

const ACK_DELAY_MS = 15_000;
/** Second scripted step — "the city confirmed the fix." See App.tsx's
 *  fix-verification notification, which watches for this transition. */
const FIX_DELAY_MS = 45_000;

/** A hazard only gets the "report to city" affordance once it clears the
 *  same eligibility bar services/civic itself would use to decide a hazard
 *  is worth filing — reuses real logic instead of a UI-only threshold. */
export function isEligibleForCivicReport(hazard: HazardRecord): boolean {
  return hazardsToReport([hazard], []).length > 0;
}

export async function fileMockCivicReport(hazard: HazardRecord, filedByUid: string): Promise<void> {
  const draft = draftCivicReport(hazard, "open311", () => `report-${hazard.id}-${Date.now()}`);
  const payload = hazardToOpen311Request(hazard, { serviceCode: "pothole-repair" });
  const docRef = doc(db, CIVIC_REPORTS_COLLECTION, draft.id);

  await setDoc(docRef, {
    ...draft,
    city: cityOf(hazard.location),
    filedByUid,
    serviceCode: payload.service_code,
    status: "submitted" satisfies CivicReportStatus,
    submittedAt: new Date().toISOString(),
    hazardCell: hazard.h3Cell,
  });

  setTimeout(() => {
    void updateDoc(docRef, {
      status: normalizeOpen311Status("acknowledged"),
      lastCheckedAt: new Date().toISOString(),
    });
  }, ACK_DELAY_MS);

  setTimeout(() => {
    void updateDoc(docRef, {
      status: "closed" satisfies CivicReportStatus,
      closedAt: new Date().toISOString(),
      lastCheckedAt: new Date().toISOString(),
    });
  }, FIX_DELAY_MS);
}

/** Live view of one account's own filed reports — powers the in-app
 *  "your report got fixed" notification. */
export function subscribeToMyCivicReports(
  uid: string,
  onChange: (reports: CivicReport[]) => void
): Unsubscribe {
  const q = query(collection(db, CIVIC_REPORTS_COLLECTION), where("filedByUid", "==", uid));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => d.data() as CivicReport));
  });
}
