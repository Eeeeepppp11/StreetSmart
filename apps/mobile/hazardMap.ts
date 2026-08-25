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
  civicReports: CivicReportOverlay[]
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
}

/**
 * Live crowd hazards — everything currently broken (active or reported to
 * the city), recomputed whenever the underlying data changes. Retired and
 * verified-fixed hazards are excluded, same "open" convention as
 * services/analytics's exports (`status === "active" || "reported"`).
 */
export function useCrowdHazards(): CrowdHazards {
  const [drives, setDrives] = useState<CloudDrive[]>([]);
  const [reports, setReports] = useState<HazardReportDoc[]>([]);
  const [civicReports, setCivicReports] = useState<CivicReportOverlay[]>([]);
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
      onSnapshot(collection(db, HAZARD_CONTRIBUTIONS_COLLECTION), (snap) => {
        setContributions(snap.docs.map((d) => d.data() as { hazardId: string; uid: string }));
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  return useMemo(() => {
    const hazards = buildEngine(drives, reports, civicReports)
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

    return { hazards, contributorCounts };
  }, [drives, reports, civicReports, contributions]);
}
