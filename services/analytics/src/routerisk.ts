import type {
  HazardRecord,
  H3Index,
  LatLng,
  ISODateString,
} from "@potholeproof/shared-types";
import { meetsKAnonymity } from "@potholeproof/privacy";
import type { HazardContribution } from "./export.js";

/**
 * Insurer / fleet data product: per-cell route-risk scores. Differs from the
 * municipal export in orientation — a single decayed risk score per cell (what
 * usage-based-insurance and fleet-routing systems consume) rather than a
 * condition inventory. Same privacy contract: under-k cells are suppressed,
 * rows carry no contributor ids and no fine coordinates.
 */
export interface RouteRiskOptions {
  /** Coarse aggregation cell — pass `geo.toTileCell`. */
  tileOf: (loc: LatLng) => H3Index;
  /** Minimum distinct contributors per emitted row (k-anonymity). */
  k: number;
  /** "Now" for recency decay — injected so output is deterministic. */
  asOf: ISODateString;
  /** Evidence half-life in days: a hazard this old counts half. */
  halfLifeDays: number;
  /** Saturation scale mapping summed decayed evidence → score in (0,1). */
  riskScale: number;
}

export const DEFAULT_ROUTE_RISK_OPTIONS: Omit<RouteRiskOptions, "tileOf" | "asOf"> = {
  k: 3,
  halfLifeDays: 30,
  riskScale: 2,
};

export interface RouteRiskRow {
  h3Cell: H3Index;
  /** Decayed, saturated risk score, 0..1 (higher = riskier). */
  riskScore: number;
  /** Open (active/reported) hazards in the cell. */
  openHazards: number;
  /** Of those, how many are severity-banded severe. */
  severeHazards: number;
  contributorCount: number;
  lastConfirmed: ISODateString;
}

const MS_PER_DAY = 86_400_000;

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Build the per-cell route-risk export, sorted by cell. */
export function buildRouteRiskExport(
  hazards: readonly HazardRecord[],
  contributions: readonly HazardContribution[],
  options: RouteRiskOptions
): RouteRiskRow[] {
  const contributorsByHazard = new Map<string, string[]>();
  for (const c of contributions) {
    const arr = contributorsByHazard.get(c.hazardId);
    if (arr) arr.push(c.anonDeviceId);
    else contributorsByHazard.set(c.hazardId, [c.anonDeviceId]);
  }

  interface Acc {
    evidence: number;
    open: number;
    severe: number;
    contributors: string[];
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
        evidence: 0,
        open: 0,
        severe: 0,
        contributors: [],
        lastConfirmed: h.lastConfirmed,
      };
      cells.set(cell, a);
    }

    const ageDays = Math.max(
      0,
      (asOfMs - Date.parse(h.lastConfirmed)) / MS_PER_DAY
    );
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

  const rows: RouteRiskRow[] = [];
  for (const [h3Cell, a] of cells) {
    if (!meetsKAnonymity(a.contributors, options.k)) continue; // suppress
    rows.push({
      h3Cell,
      riskScore: round3(1 - Math.exp(-a.evidence / options.riskScale)),
      openHazards: a.open,
      severeHazards: a.severe,
      contributorCount: new Set(a.contributors).size,
      lastConfirmed: a.lastConfirmed,
    });
  }
  rows.sort((x, y) => (x.h3Cell < y.h3Cell ? -1 : x.h3Cell > y.h3Cell ? 1 : 0));
  return rows;
}
