import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { HazardEngine } from "@potholeproof/hazard-engine";
import { DEFAULT_CROWD_REPORTING_POLICY, isOpenStatus, type CivicHazardKind } from "@potholeproof/civic";
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
import { CIVIC_REPORTS_COLLECTION, type CivicReportDoc } from "./civicMock";
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

/** The slice of a civicReports doc the map needs to overlay status. */
type CivicReportOverlay = Pick<
  CivicReportDoc,
  "id" | "hazardCell" | "status" | "submittedAt" | "closedAt" | "filedByUid"
>;

/** A hazard backed only by manual reports stays hidden until this many distinct
 *  drivers stand behind it; a sensor detection is enough on its own. */
const MIN_SOURCES_FOR_REPORT_ONLY_HAZARD = 2;
/** A driver whose past evidence was corroborated on at least this many
 *  different hazards counts as trusted (weighted higher toward the city bar). */
const TRUSTED_AFTER_CORROBORATED_CELLS = 2;

interface BuiltEngine {
  engine: HazardEngine;
  /** Cells with at least one sensor-detected pothole. */
  sensorCells: Set<H3Index>;
  /** What kind of defect each cell is — decides the city service code. */
  kindByCell: Map<H3Index, CivicHazardKind>;
  /** Distinct UTC days on which the cell got confirming evidence. */
  daysByCell: Map<H3Index, Set<string>>;
  /** Latest civic report per cell. */
  latestReportByCell: Map<string, CivicReportOverlay>;
  /** Cells with an open city report that drivers have since verified as fixed. */
  driverVerifiedFixed: Set<string>;
}

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
  const potholeCells = new Set<H3Index>();
  const roughCells = new Set<H3Index>();
  const daysByCell = new Map<H3Index, Set<string>>();

  function noteDay(cell: H3Index, iso: string) {
    const set = daysByCell.get(cell);
    const day = iso.slice(0, 10);
    if (set) set.add(day);
    else daysByCell.set(cell, new Set([day]));
  }

  function ingest(event: JoltEvent) {
    currentCell = toHazardCell(event.location);
    engine.ingestEvent(event);
    noteDay(currentCell, event.capturedAt);
  }

  for (const drive of drives) {
    for (const item of drive.items ?? []) {
      if (item.label === "pothole") {
        ingest(item.event);
        const cell = toHazardCell(item.event.location);
        sensorCells.add(cell);
        potholeCells.add(cell);
      }
    }
  }
  // Manual reports: potholes only, weaker than a detection, and one per user
  // per cell per day (older docs predate the deterministic id, so dedupe here too).
  const seenReports = new Set<string>();
  for (const r of reports) {
    if (r.retracted || !isHazardReport(r.classification, r.severity)) continue;
    const cell = toHazardCell(r.location);
    const dedupeKey = `${cell}|${r.uid}|${r.capturedAt.slice(0, 10)}`;
    if (seenReports.has(dedupeKey)) continue;
    seenReports.add(dedupeKey);
    if (r.classification === "rough_road") roughCells.add(cell);
    else potholeCells.add(cell);
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
  // confidence without shifting it).
  for (const v of votes) {
    if (v.vote !== "confirm") continue;
    potholeCells.add(toHazardCell(v.location));
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

  // Civic overlay comes BEFORE the "gone" votes so drivers' clean passes can
  // verify an open report as fixed (the engine turns reported → verified_fixed).
  // Only each cell's latest report counts — older closed ones are history.
  const latestReportByCell = new Map<string, CivicReportOverlay>();
  for (const r of [...civicReports].sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))) {
    latestReportByCell.set(r.hazardCell, r);
  }
  for (const [cell, r] of latestReportByCell) {
    if (isOpenStatus(r.status)) {
      engine.markReported(cell as H3Index, r.id);
    } else if (r.status === "closed") {
      // The city called it fixed. If drivers keep confirming it AFTER that,
      // the fix didn't hold: leave it active so it can be re-reported.
      const h = engine.get(cell as H3Index);
      const closedAt = Date.parse(r.closedAt ?? r.submittedAt);
      const reopened = h !== undefined && Date.parse(h.lastConfirmed) > closedAt;
      if (!reopened) engine.markVerifiedFixed(cell as H3Index);
    }
    // "rejected" leaves the hazard as whatever ingestion produced.
  }

  // "gone" votes are clean passes, so the same decay / auto-retire math the
  // drive-by clean passes use applies.
  for (const v of votes) {
    if (v.vote === "gone") engine.observeClean(v.location);
  }

  const driverVerifiedFixed = new Set<string>();
  for (const [cell, r] of latestReportByCell) {
    if (isOpenStatus(r.status) && engine.get(cell as H3Index)?.status === "verified_fixed") {
      driverVerifiedFixed.add(cell);
    }
  }

  const kindByCell = new Map<H3Index, CivicHazardKind>();
  for (const cell of new Set([...potholeCells, ...roughCells])) {
    kindByCell.set(cell, potholeCells.has(cell) ? "pothole" : "rough_road");
  }

  return { engine, sensorCells, kindByCell, daysByCell, latestReportByCell, driverVerifiedFixed };
}

export interface CrowdHazards {
  hazards: HazardRecord[];
  /** Distinct-uid contributor count per hazard id — powers "N users reported." */
  contributorCounts: Record<string, number>;
  /** Distinct drivers currently standing behind each hazard: contributors and
   *  "confirm" voters, minus anyone whose latest vote is "not there". */
  confirmerCounts: Record<string, number>;
  /** Confirmer count weighted by track record — what the city bar is measured in. */
  confirmerWeights: Record<string, number>;
  /** Distinct days of confirming evidence per hazard. */
  evidenceDays: Record<string, number>;
  /** Distinct "not there / fixed" voters per hazard id. */
  goneCounts: Record<string, number>;
  /** The signed-in user's own vote per hazard id. */
  myVotes: Record<string, HazardVote>;
  /** The signed-in user's own live (non-retracted) report per hazard id. */
  myReports: Record<string, string>;
  /** Hazards only visible to their reporter so far (report-only, one source). */
  pendingIds: Set<string>;
  /** Hazard ids the signed-in user currently stands behind. */
  myCells: Set<string>;
  /** Defect kind per hazard id (drives the city service code). */
  kindByCell: Record<string, CivicHazardKind>;
  /** Latest city report per hazard id, if any. */
  reportByCell: Record<string, CivicReportOverlay>;
  /** Hazard ids whose open city report drivers have verified as fixed. */
  driverVerifiedFixed: Set<string>;
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
        setCivicReports(snap.docs.map((d) => ({ ...(d.data() as CivicReportOverlay), id: d.id })));
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
    const { engine, sensorCells, kindByCell, daysByCell, latestReportByCell, driverVerifiedFixed } = buildEngine(
      drives,
      reports,
      civicReports,
      votes
    );
    const open = engine.all().filter((h) => h.status === "active" || h.status === "reported");

    const addTo = (m: Map<string, Set<string>>, key: string, u: string) => {
      const set = m.get(key);
      if (set) set.add(u);
      else m.set(key, new Set([u]));
    };

    // Everyone who ever contributed evidence to a cell (drive-bys, reports, confirms).
    const contributorsByHazard = new Map<string, Set<string>>();
    for (const c of contributions) addTo(contributorsByHazard, c.hazardId, c.uid);

    // Track record: a driver is trusted once their evidence was corroborated by
    // another driver on enough different hazards.
    const corroboratedBy = new Map<string, number>();
    for (const set of contributorsByHazard.values()) {
      if (set.size < 2) continue;
      for (const u of set) corroboratedBy.set(u, (corroboratedBy.get(u) ?? 0) + 1);
    }
    const isTrusted = (u: string) => (corroboratedBy.get(u) ?? 0) >= TRUSTED_AFTER_CORROBORATED_CELLS;

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
    const confirmerWeights: Record<string, number> = {};
    const evidenceDays: Record<string, number> = {};
    const goneCounts: Record<string, number> = {};
    const kinds: Record<string, CivicHazardKind> = {};
    const reportByCell: Record<string, CivicReportOverlay> = {};
    const hazards: HazardRecord[] = [];
    const pendingIds = new Set<string>();
    const myCells = new Set<string>();
    for (const h of open) {
      const gone = goneByHazard.get(h.id);
      const gaveUp = withdrawn.get(h.id);
      const stillIn = activeSupport.get(h.id);
      let n = 0;
      let weight = 0;
      for (const u of contributorsByHazard.get(h.id) ?? []) {
        if (gone?.has(u)) continue;
        if (gaveUp?.has(u) && !stillIn?.has(u)) continue;
        n += 1;
        weight += isTrusted(u) ? DEFAULT_CROWD_REPORTING_POLICY.trustedWeight : 1;
        if (u === uid) myCells.add(h.id);
      }
      // Report-only hazards need a second driver before others see them; the
      // reporter still sees their own, marked pending.
      const confirmedEnough =
        h.status === "reported" ||
        sensorCells.has(h.id as H3Index) ||
        n >= MIN_SOURCES_FOR_REPORT_ONLY_HAZARD;
      if (!confirmedEnough) {
        if (!myReports[h.id]) continue;
        pendingIds.add(h.id);
      }
      confirmerCounts[h.id] = n;
      confirmerWeights[h.id] = weight;
      evidenceDays[h.id] = daysByCell.get(h.id as H3Index)?.size ?? 0;
      goneCounts[h.id] = gone?.size ?? 0;
      kinds[h.id] = kindByCell.get(h.id as H3Index) ?? "pothole";
      const latest = latestReportByCell.get(h.id);
      if (latest) reportByCell[h.id] = latest;
      hazards.push(h);
    }
    const contributorCounts: Record<string, number> = {};
    for (const h of hazards) contributorCounts[h.id] = contributorsByHazard.get(h.id)?.size ?? 0;

    return {
      hazards,
      contributorCounts,
      confirmerCounts,
      confirmerWeights,
      evidenceDays,
      goneCounts,
      myVotes,
      myReports,
      pendingIds,
      myCells,
      kindByCell: kinds,
      reportByCell,
      driverVerifiedFixed,
    };
  }, [drives, reports, civicReports, contributions, votes, uid]);
}
