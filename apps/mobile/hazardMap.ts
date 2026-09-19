import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { HazardEngine } from "@potholeproof/hazard-engine";
import { toHazardCell } from "@potholeproof/geo";
import type { H3Index, HazardRecord, JoltEvent } from "@potholeproof/shared-types";
import { db } from "./firebase";
import { DRIVES_COLLECTION, type CloudDrive } from "./cloudDrives";
import {
  HAZARD_CONTRIBUTIONS_COLLECTION,
  HAZARD_REPORTS_COLLECTION,
  type HazardReportDoc,
} from "./hazardReports";
import { CIVIC_REPORTS_COLLECTION } from "./civicMock";
import { HAZARD_VOTES_COLLECTION, type HazardVote } from "./hazardVotes";

/** Just enough of a hazardVotes doc to feed the engine and tally voters. */
interface HazardVoteDoc {
  hazardId: string;
  uid: string;
  vote: HazardVote;
  location: { lat: number; lng: number };
  severity: number;
  votedAt: string;
}

/** Just enough of a civicReports doc to overlay status onto the rebuilt engine. */
interface CivicReportOverlay {
  id: string;
  hazardCell: string;
  status: "draft" | "submitted" | "acknowledged" | "in_progress" | "closed" | "rejected";
}
const OPEN_REPORT_STATUSES = new Set<CivicReportOverlay["status"]>([
  "draft",
  "submitted",
  "acknowledged",
  "in_progress",
]);

/**
 * Client-side confidence engine for the crowd hazard map. Runs the real
 * HazardEngine (services/hazard-engine) against every confirmed pothole in
 * `drives`, every Waze-style tap-to-report in `hazardReports`, and overlays
 * civic-report status from `civicReports` — no backend beyond Firestore
 * exists yet, and the engine's own doc comment says a production deployment
 * persisting this to PostGIS would run identical logic, so running it here
 * is the pragmatic, still-real choice.
 *
 * The engine has no "undo" and drive labels can be edited after the fact
 * (saveDriveEdits), so a Firestore snapshot isn't safely append-only — a
 * fresh engine is rebuilt from scratch on every change rather than diffed.
 */
function buildEngine(
  drives: CloudDrive[],
  reports: HazardReportDoc[],
  civicReports: CivicReportOverlay[],
  votes: HazardVoteDoc[]
): HazardEngine {
  // nextId takes no arguments and is only called synchronously inside
  // ingestEvent, before the caller sees which cell was assigned — so this
  // ref, set immediately before each ingest call, is what gives every
  // hazard a stable, deterministic id (the cell itself) instead of a
  // fabricated new one each rebuild.
  let currentCell: H3Index = "";
  const engine = new HazardEngine({
    cellOf: toHazardCell,
    nextId: () => currentCell,
  });

  function ingest(event: JoltEvent) {
    currentCell = toHazardCell(event.location);
    engine.ingestEvent(event);
  }

  for (const drive of drives) {
    for (const item of drive.items ?? []) {
      if (item.label === "pothole") ingest(item.event);
    }
  }
  for (const r of reports) {
    ingest({
      id: r.id,
      capturedAt: r.capturedAt,
      location: r.location,
      speedMps: 0,
      severity: r.severity,
      confidence: 1,
      classification: r.classification,
      modelVersion: "user-report",
    });
  }
  // Confirms are extra sightings (at the hazard's own severity, so they raise
  // confidence without shifting it); "gone" votes are clean passes, so the same
  // decay / auto-retire math the drive-by clean passes use applies. Confirms go
  // first so a "gone" vote is never applied to a hazard that doesn't exist yet.
  for (const v of votes) {
    if (v.vote !== "confirm") continue;
    ingest({
      id: `vote-${v.hazardId}-${v.uid}`,
      capturedAt: v.votedAt,
      location: v.location,
      speedMps: 0,
      severity: v.severity,
      confidence: 1,
      classification: "pothole",
      modelVersion: "user-vote",
    });
  }
  for (const v of votes) {
    if (v.vote === "gone") engine.observeClean(v.location);
  }
  for (const r of civicReports) {
    const cell = r.hazardCell as H3Index;
    if (r.status === "closed") engine.markVerifiedFixed(cell);
    else if (OPEN_REPORT_STATUSES.has(r.status)) engine.markReported(cell, r.id);
    // "rejected" leaves the hazard's status as whatever ingestion produced.
  }
  return engine;
}

export interface CrowdHazards {
  hazards: HazardRecord[];
  /** Distinct-uid contributor count per hazard id — powers "N users reported." */
  contributorCounts: Record<string, number>;
  /** Distinct drivers currently standing behind each hazard: contributors and
   *  "confirm" voters, minus anyone whose latest vote is "not there". */
  confirmerCounts: Record<string, number>;
  /** Distinct "not there / fixed" voters per hazard id. */
  goneCounts: Record<string, number>;
  /** The signed-in user's own vote per hazard id. */
  myVotes: Record<string, HazardVote>;
}

/**
 * Live crowd hazards — everything currently broken (active or reported to
 * the city), recomputed whenever the underlying data changes. Retired and
 * verified-fixed hazards are excluded, same "open" convention as
 * services/analytics's exports (`status === "active" || "reported"`).
 */
export function useCrowdHazards(uid: string): CrowdHazards {
  const [drives, setDrives] = useState<CloudDrive[]>([]);
  const [reports, setReports] = useState<HazardReportDoc[]>([]);
  const [civicReports, setCivicReports] = useState<CivicReportOverlay[]>([]);
  const [votes, setVotes] = useState<HazardVoteDoc[]>([]);
  const [contributions, setContributions] = useState<{ hazardId: string; uid: string }[]>([]);

  useEffect(() => {
    const unsubs: Unsubscribe[] = [
      onSnapshot(collection(db, DRIVES_COLLECTION), (snap) => {
        setDrives(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CloudDrive, "id">) })));
      }),
      onSnapshot(collection(db, HAZARD_REPORTS_COLLECTION), (snap) => {
        setReports(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<HazardReportDoc, "id">) })));
      }),
      onSnapshot(collection(db, CIVIC_REPORTS_COLLECTION), (snap) => {
        setCivicReports(snap.docs.map((d) => d.data() as CivicReportOverlay));
      }),
      onSnapshot(collection(db, HAZARD_VOTES_COLLECTION), (snap) => {
        setVotes(snap.docs.map((d) => d.data() as HazardVoteDoc));
      }),
      onSnapshot(collection(db, HAZARD_CONTRIBUTIONS_COLLECTION), (snap) => {
        setContributions(snap.docs.map((d) => d.data() as { hazardId: string; uid: string }));
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  return useMemo(() => {
    const hazards = buildEngine(drives, reports, civicReports, votes)
      .all()
      .filter((h) => h.status === "active" || h.status === "reported");

    const contributorsByHazard = new Map<string, Set<string>>();
    for (const c of contributions) {
      const set = contributorsByHazard.get(c.hazardId);
      if (set) set.add(c.uid);
      else contributorsByHazard.set(c.hazardId, new Set([c.uid]));
    }
    const contributorCounts: Record<string, number> = {};
    for (const h of hazards) contributorCounts[h.id] = contributorsByHazard.get(h.id)?.size ?? 0;

    const goneByHazard = new Map<string, Set<string>>();
    const retractedByHazard = new Map<string, Set<string>>();
    const myVotes: Record<string, HazardVote> = {};
    for (const v of votes) {
      if (v.uid === uid && v.vote !== "none") myVotes[v.hazardId] = v.vote;
      if (v.vote === "none") {
        // Retracted: withdraws this user's earlier support without counting as "gone".
        retractedByHazard.set(v.hazardId, (retractedByHazard.get(v.hazardId) ?? new Set()).add(v.uid));
      } else if (v.vote === "gone") {
        const set = goneByHazard.get(v.hazardId);
        if (set) set.add(v.uid);
        else goneByHazard.set(v.hazardId, new Set([v.uid]));
      } else {
        const set = contributorsByHazard.get(v.hazardId);
        if (set) set.add(v.uid);
        else contributorsByHazard.set(v.hazardId, new Set([v.uid]));
      }
    }
    const confirmerCounts: Record<string, number> = {};
    const goneCounts: Record<string, number> = {};
    for (const h of hazards) {
      const gone = goneByHazard.get(h.id);
      goneCounts[h.id] = gone?.size ?? 0;
      let n = 0;
      const retracted = retractedByHazard.get(h.id);
      for (const u of contributorsByHazard.get(h.id) ?? []) if (!gone?.has(u) && !retracted?.has(u)) n += 1;
      confirmerCounts[h.id] = n;
    }

    return { hazards, contributorCounts, confirmerCounts, goneCounts, myVotes };
  }, [drives, reports, civicReports, contributions, votes, uid]);
}
