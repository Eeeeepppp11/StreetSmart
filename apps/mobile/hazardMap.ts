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
  REPORT_WEIGHT,
  isHazardReport,
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
/** A hazard backed only by manual reports stays hidden until this many distinct
 *  drivers stand behind it; a sensor detection is enough on its own. */
const MIN_SOURCES_FOR_REPORT_ONLY_HAZARD = 2;

interface BuiltEngine {
  engine: HazardEngine;
  /** Cells with at least one sensor-detected pothole. */
  sensorCells: Set<H3Index>;
}

function buildEngine(
  drives: CloudDrive[],
  reports: HazardReportDoc[],
  civicReports: CivicReportOverlay[],
  votes: HazardVoteDoc[]
): BuiltEngine {
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

  const sensorCells = new Set<H3Index>();

  function ingest(event: JoltEvent) {
    currentCell = toHazardCell(event.location);
    engine.ingestEvent(event);
  }

  for (const drive of drives) {
    for (const item of drive.items ?? []) {
      if (item.label === "pothole") {
        ingest(item.event);
        sensorCells.add(toHazardCell(item.event.location));
      }
    }
  }
  // Manual reports: potholes only, weaker than a detection, and one per user
  // per cell per day (older docs predate the deterministic id, so dedupe here too).
  const seenReports = new Set<string>();
  for (const r of reports) {
    if (r.retracted || !isHazardReport(r.classification, r.severity)) continue;
    const dedupeKey = `${toHazardCell(r.location)}|${r.uid}|${r.capturedAt.slice(0, 10)}`;
    if (seenReports.has(dedupeKey)) continue;
    seenReports.add(dedupeKey);
    ingest({
      id: r.id,
      capturedAt: r.capturedAt,
      location: r.location,
      speedMps: 0,
      severity: r.severity,
      confidence: REPORT_WEIGHT,
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
  return { engine, sensorCells };
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
  /** The signed-in user's own live (non-retracted) report per hazard id. */
  myReports: Record<string, string>;
  /** Hazards only visible to their reporter so far (report-only, one source). */
  pendingIds: Set<string>;
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
    const { engine, sensorCells } = buildEngine(drives, reports, civicReports, votes);
    const open = engine.all().filter((h) => h.status === "active" || h.status === "reported");

    const addTo = (m: Map<string, Set<string>>, key: string, u: string) => {
      const set = m.get(key);
      if (set) set.add(u);
      else m.set(key, new Set([u]));
    };

    // Everyone who ever contributed evidence to a cell (drive-bys, reports, confirms).
    const contributorsByHazard = new Map<string, Set<string>>();
    for (const c of contributions) addTo(contributorsByHazard, c.hazardId, c.uid);

    // Who currently stands behind a cell vs. who has withdrawn.
    const activeSupport = new Map<string, Set<string>>();
    const withdrawn = new Map<string, Set<string>>();
    const goneByHazard = new Map<string, Set<string>>();
    const myVotes: Record<string, HazardVote> = {};
    const myReports: Record<string, string> = {};

    for (const r of reports) {
      const cell = toHazardCell(r.location);
      // A report reclassified to a non-hazard type (speed bump, other, mild rough
      // road) is a withdrawal too — the reporter no longer says it's a pothole.
      if (r.retracted || !isHazardReport(r.classification, r.severity)) {
        addTo(withdrawn, cell, r.uid);
      } else {
        addTo(activeSupport, cell, r.uid);
        if (r.uid === uid) myReports[cell] = r.id;
      }
    }
    for (const v of votes) {
      if (v.uid === uid && v.vote !== "none") myVotes[v.hazardId] = v.vote;
      if (v.vote === "none") addTo(withdrawn, v.hazardId, v.uid);
      else if (v.vote === "gone") addTo(goneByHazard, v.hazardId, v.uid);
      else {
        addTo(contributorsByHazard, v.hazardId, v.uid);
        addTo(activeSupport, v.hazardId, v.uid);
      }
    }

    const confirmerCounts: Record<string, number> = {};
    const goneCounts: Record<string, number> = {};
    const hazards: HazardRecord[] = [];
    const pendingIds = new Set<string>();
    for (const h of open) {
      const gone = goneByHazard.get(h.id);
      const gaveUp = withdrawn.get(h.id);
      const stillIn = activeSupport.get(h.id);
      let n = 0;
      for (const u of contributorsByHazard.get(h.id) ?? []) {
        if (gone?.has(u)) continue;
        if (gaveUp?.has(u) && !stillIn?.has(u)) continue;
        n += 1;
      }
      // Report-only hazards need a second driver before others see them; the
      // reporter still sees their own, marked pending.
      const confirmedEnough =
        h.status === "reported" ||
        sensorCells.has(h.id) ||
        n >= MIN_SOURCES_FOR_REPORT_ONLY_HAZARD;
      if (!confirmedEnough) {
        if (!myReports[h.id]) continue;
        pendingIds.add(h.id);
      }
      confirmerCounts[h.id] = n;
      goneCounts[h.id] = gone?.size ?? 0;
      hazards.push(h);
    }
    const contributorCounts: Record<string, number> = {};
    for (const h of hazards) contributorCounts[h.id] = contributorsByHazard.get(h.id)?.size ?? 0;

    return { hazards, contributorCounts, confirmerCounts, goneCounts, myVotes, myReports, pendingIds };
  }, [drives, reports, civicReports, contributions, votes, uid]);
}
