import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import {
  canFileReport,
  daysNeeded,
  hazardToOpen311Request,
  isCrowdReportable,
  isOpenStatus,
  nextCityStatuses,
  serviceCodeFor,
  withReporterNotes,
  type CivicHazardKind,
} from "@potholeproof/civic";
import type { CivicProvider, CivicReportStatus, HazardRecord, LatLng } from "@potholeproof/shared-types";
import { db } from "./firebase";
import { cityOf } from "./nav/city";
import { HAZARD_CONTRIBUTIONS_COLLECTION } from "./hazardReports";

/**
 * Civic filing with a real lifecycle and a mocked city. Filing writes a
 * `civicReports` doc in `submitted` ("pending city review"); it then sits there
 * until the city moves it — today a reviewer on the City review screen (admin),
 * later an Open311 poller against SF311 writing the same fields. There are no
 * timers: nothing advances on its own.
 *
 * One doc per hazard cell (the doc id IS the cell), which is what stops two
 * drivers from both filing the same hazard — see firestore.rules.
 */
export const CIVIC_REPORTS_COLLECTION = "civicReports";

export interface CivicStatusEvent {
  status: CivicReportStatus;
  at: string;
  note?: string | null;
  by?: string | null;
}

export interface CivicReportDoc {
  /** Doc id — equal to `hazardCell`. */
  id: string;
  hazardCell: string;
  hazardId?: string;
  provider?: CivicProvider;
  status: CivicReportStatus;
  filedByUid: string;
  filedByName?: string | null;
  city?: string;
  serviceCode?: string;
  kind?: CivicHazardKind;
  description?: string;
  address?: string | null;
  notes?: string | null;
  /** A small JPEG as a data URI (no Storage bucket in the pilot). */
  photoUrl?: string | null;
  confirmerCount?: number;
  location?: LatLng;
  submittedAt: string;
  closedAt?: string | null;
  lastCheckedAt?: string | null;
  statusNote?: string | null;
  /** Set when the filer edits their note/photo after filing. */
  editedAt?: string | null;
  /** How many times this cell has been filed (re-filing after a close/reject). */
  filings?: number;
  history?: CivicStatusEvent[];
}

export interface CivicEvidence {
  /** Weighted confirmers (trusted drivers count more). */
  weight: number;
  /** Distinct days of confirming evidence. */
  days: number;
}

/** A hazard only gets the "report to city" affordance once enough distinct
 *  drivers confirm it, over enough days (fewer if severe) — the gate lives in
 *  services/civic. */
export function isEligibleForCivicReport(hazard: HazardRecord, evidence: CivicEvidence): boolean {
  return isCrowdReportable(hazard, evidence.weight, evidence.days);
}

export { daysNeeded };

export interface FileCivicReportInput {
  hazard: HazardRecord;
  kind: CivicHazardKind;
  filedByUid: string;
  filedByName: string | null;
  address: string | null;
  notes: string;
  photoDataUri: string | null;
  confirmerCount: number;
}

export type FileCivicReportResult = { status: "filed" } | { status: "blocked"; reason: string };

export async function fileCivicReport(input: FileCivicReportInput): Promise<FileCivicReportResult> {
  const { hazard, kind } = input;
  const ref = doc(db, CIVIC_REPORTS_COLLECTION, hazard.id);
  const existing = await getDoc(ref);
  const prev = existing.exists() ? (existing.data() as CivicReportDoc) : undefined;

  const check = canFileReport(
    prev
      ? { status: prev.status, submittedAt: prev.submittedAt, ...(prev.closedAt ? { closedAt: prev.closedAt } : {}) }
      : undefined,
    Date.now()
  );
  if (!check.ok) return { status: "blocked", reason: check.reason ?? "This hazard can't be filed right now." };

  const notes = input.notes.trim();
  const payload = hazardToOpen311Request(hazard, {
    serviceCode: serviceCodeFor(kind),
    context: {
      kind,
      confirmers: input.confirmerCount,
      ...(input.address ? { address: input.address } : {}),
      ...(notes ? { notes } : {}),
    },
  });
  const now = new Date().toISOString();
  const event: CivicStatusEvent = { status: "submitted", at: now, by: input.filedByName };

  const fields = {
    hazardCell: hazard.id,
    hazardId: hazard.id,
    provider: "open311" as CivicProvider,
    status: "submitted" as CivicReportStatus,
    filedByUid: input.filedByUid,
    filedByName: input.filedByName,
    city: cityOf(hazard.location),
    serviceCode: payload.service_code,
    kind,
    description: payload.description,
    address: input.address,
    notes: notes || null,
    photoUrl: input.photoDataUri,
    confirmerCount: input.confirmerCount,
    location: hazard.location,
    submittedAt: now,
    closedAt: null,
    lastCheckedAt: null,
    statusNote: null,
  };

  try {
    if (prev) {
      await updateDoc(ref, {
        ...fields,
        filings: (prev.filings ?? 1) + 1,
        history: [...(prev.history ?? []), event],
      });
    } else {
      await setDoc(ref, { ...fields, filings: 1, history: [event] });
    }
  } catch (e) {
    // The create/update rules reject a second filer racing this one.
    if ((e as { code?: string }).code === "permission-denied") {
      return { status: "blocked", reason: "Someone just filed this hazard — check My reports." };
    }
    throw e;
  }
  return { status: "filed" };
}

/**
 * The filer's edit: change the note and/or photo while the report is still
 * open. Firestore rules allow exactly these fields (notes, photoUrl,
 * description, editedAt) and only for the filer.
 */
export async function editCivicReport(
  report: CivicReportDoc,
  changes: { notes: string; photoDataUri: string | null }
): Promise<void> {
  if (!isOpenStatus(report.status)) throw new Error("This report is closed and can't be edited.");
  const notes = changes.notes.trim();
  await updateDoc(doc(db, CIVIC_REPORTS_COLLECTION, report.id), {
    notes: notes || null,
    photoUrl: changes.photoDataUri,
    description: withReporterNotes(report.description ?? "", notes),
    editedAt: new Date().toISOString(),
  });
}

/**
 * The city's side: move a report along. Firestore rules allow this for admins
 * only. `note` is shown to the reporter and the drivers who confirmed it.
 */
export async function advanceCivicReport(
  report: CivicReportDoc,
  next: CivicReportStatus,
  note: string,
  reviewer: string
): Promise<void> {
  if (!nextCityStatuses(report.status).includes(next)) {
    throw new Error(`Can't move a ${report.status} report to ${next}.`);
  }
  const now = new Date().toISOString();
  const trimmed = note.trim();
  const terminal = next === "closed" || next === "rejected";
  await updateDoc(doc(db, CIVIC_REPORTS_COLLECTION, report.id), {
    status: next,
    lastCheckedAt: now,
    statusNote: trimmed || null,
    closedAt: terminal ? now : null,
    history: arrayUnion({ status: next, at: now, note: trimmed || null, by: reviewer } satisfies CivicStatusEvent),
  });
}

function toDocs(snap: { docs: { id: string; data: () => unknown }[] }): CivicReportDoc[] {
  return snap.docs.map((d) => ({ ...(d.data() as CivicReportDoc), id: d.id }));
}

/** Live view of one account's own filed reports. */
export function subscribeToMyCivicReports(
  uid: string,
  onChange: (reports: CivicReportDoc[]) => void
): Unsubscribe {
  const q = query(collection(db, CIVIC_REPORTS_COLLECTION), where("filedByUid", "==", uid));
  return onSnapshot(q, (snap) => onChange(toDocs(snap)));
}

/** Every report — the city-review queue (admin). */
export function subscribeToAllCivicReports(onChange: (reports: CivicReportDoc[]) => void): Unsubscribe {
  return onSnapshot(collection(db, CIVIC_REPORTS_COLLECTION), (snap) => onChange(toDocs(snap)));
}

/**
 * Reports this account cares about: the ones it filed, plus reports on
 * hazards it helped confirm — so confirmers see the status too.
 */
export function subscribeToRelevantCivicReports(
  uid: string,
  onChange: (mine: CivicReportDoc[], confirmed: CivicReportDoc[]) => void
): Unsubscribe {
  let all: CivicReportDoc[] = [];
  let cells = new Set<string>();
  const emit = () => {
    const mine = all.filter((r) => r.filedByUid === uid);
    const confirmed = all.filter((r) => r.filedByUid !== uid && cells.has(r.hazardCell));
    onChange(mine, confirmed);
  };
  const unsubReports = onSnapshot(collection(db, CIVIC_REPORTS_COLLECTION), (snap) => {
    all = toDocs(snap);
    emit();
  });
  const unsubContribs = onSnapshot(
    query(collection(db, HAZARD_CONTRIBUTIONS_COLLECTION), where("uid", "==", uid)),
    (snap) => {
      cells = new Set(snap.docs.map((d) => (d.data() as { hazardId: string }).hazardId));
      emit();
    }
  );
  return () => {
    unsubReports();
    unsubContribs();
  };
}
