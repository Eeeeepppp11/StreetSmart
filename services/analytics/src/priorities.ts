import type {
  CivicReport,
  HazardRecord,
  H3Index,
  LatLng,
  ISODateString,
} from "@potholeproof/shared-types";
import { meetsKAnonymity } from "@potholeproof/privacy";
import type { HazardContribution } from "./export.js";

/**
 * City ops product: which repairs to prioritise first. Same decayed-evidence
 * scoring as the route-risk export (severity × confidence × recency, Beta
 * decay), but grouped by city as well as cell, and — the whole point of a
 * priority queue — sorted by urgency instead of by cell id. Same privacy
 * contract: under-k cells are suppressed, rows carry no contributor ids.
 */
export interface PriorityOptions {
  /** Coarse aggregation cell — pass `geo.toTileCell`. */
  tileOf: (loc: LatLng) => H3Index;
  /** Which city a hazard belongs to — a jurisdiction lookup in production. */
  cityOf: (loc: LatLng) => string;
  /** Minimum distinct contributors per emitted row (k-anonymity). */
  k: number;
  /** "Now" for recency decay — injected so output is deterministic. */
  asOf: ISODateString;
  /** Evidence half-life in days: a hazard this old counts half. */
  halfLifeDays: number;
  /** Saturation scale mapping summed decayed evidence → score in (0,1). */
  riskScale: number;
}

export const DEFAULT_PRIORITY_OPTIONS: Omit<
  PriorityOptions,
  "tileOf" | "cityOf" | "asOf"
> = {
  k: 3,
  halfLifeDays: 30,
  riskScale: 2,
};

export interface PriorityRow {
  h3Cell: H3Index;
  city: string;
  /** Decayed, saturated urgency score, 0..1 (higher = fix sooner). */
  urgencyScore: number;
  openHazards: number;
  severeHazards: number;
  contributorCount: number;
  /** Civic reports filed at this cell that haven't closed or been rejected. */
  openReports: number;
  /** All civic reports ever filed at this cell, any status. */
  reportedCount: number;
  oldestOpenReportDays: number | null;
  lastConfirmed: ISODateString;
}

const MS_PER_DAY = 86_400_000;
const OPEN_REPORT_STATUSES = new Set<CivicReport["status"]>([
  "draft",
  "submitted",
  "acknowledged",
  "in_progress",
]);

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Build the repair-priority queue, sorted most-urgent first. */
export function buildPriorityQueue(
  hazards: readonly HazardRecord[],
  reports: readonly CivicReport[],
  contributions: readonly HazardContribution[],
  options: PriorityOptions
): PriorityRow[] {
  const contributorsByHazard = new Map<string, string[]>();
  for (const c of contributions) {
    const arr = contributorsByHazard.get(c.hazardId);
    if (arr) arr.push(c.anonDeviceId);
    else contributorsByHazard.set(c.hazardId, [c.anonDeviceId]);
  }

  const hazardById = new Map<string, HazardRecord>();
  for (const h of hazards) hazardById.set(h.id, h);

  interface Acc {
    city: string;
    evidence: number;
    open: number;
    severe: number;
    contributors: string[];
    openReports: number;
    reportedCount: number;
    oldestOpenReportMs: number | null;
    lastConfirmed: ISODateString;
  }
  const cells = new Map<H3Index, Acc>();
  const asOfMs = Date.parse(options.asOf);

  for (const h of hazards) {
    if (h.status !== "active" && h.status !== "reported") continue;
    const cell = options.tileOf(h.location);
    let a = cells.get(cell);
    if (!a) {
      a = {
        city: options.cityOf(h.location),
        evidence: 0,
        open: 0,
        severe: 0,
        contributors: [],
        openReports: 0,
        reportedCount: 0,
        oldestOpenReportMs: null,
        lastConfirmed: h.lastConfirmed,
      };
      cells.set(cell, a);
    }

    const ageDays = Math.max(0, (asOfMs - Date.parse(h.lastConfirmed)) / MS_PER_DAY);
    const recency = Math.pow(0.5, ageDays / options.halfLifeDays);
    a.evidence += h.severity * h.confidence * recency;
    a.open += 1;
    if (h.severityBand === "severe") a.severe += 1;
    const contribs = contributorsByHazard.get(h.id);
    if (contribs) a.contributors.push(...contribs);
    if (Date.parse(h.lastConfirmed) > Date.parse(a.lastConfirmed)) {
      a.lastConfirmed = h.lastConfirmed;
    }
  }

  for (const r of reports) {
    const hazard = hazardById.get(r.hazardId);
    if (!hazard) continue;
    const cell = options.tileOf(hazard.location);
    const a = cells.get(cell);
    if (!a) continue; // hazard isn't open/reported this cycle — report predates a fix
    a.reportedCount += 1;
    if (OPEN_REPORT_STATUSES.has(r.status) && r.submittedAt) {
      const ms = Date.parse(r.submittedAt);
      a.openReports += 1;
      if (a.oldestOpenReportMs === null || ms < a.oldestOpenReportMs) {
        a.oldestOpenReportMs = ms;
      }
    }
  }

  const rows: PriorityRow[] = [];
  for (const [h3Cell, a] of cells) {
    if (!meetsKAnonymity(a.contributors, options.k)) continue; // suppress
    rows.push({
      h3Cell,
      city: a.city,
      urgencyScore: round3(1 - Math.exp(-a.evidence / options.riskScale)),
      openHazards: a.open,
      severeHazards: a.severe,
      contributorCount: new Set(a.contributors).size,
      openReports: a.openReports,
      reportedCount: a.reportedCount,
      oldestOpenReportDays:
        a.oldestOpenReportMs === null
          ? null
          : Math.floor((asOfMs - a.oldestOpenReportMs) / MS_PER_DAY),
      lastConfirmed: a.lastConfirmed,
    });
  }
  rows.sort((x, y) => {
    if (y.urgencyScore !== x.urgencyScore) return y.urgencyScore - x.urgencyScore;
    return (y.oldestOpenReportDays ?? -1) - (x.oldestOpenReportDays ?? -1);
  });
  return rows;
}
