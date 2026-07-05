import type {
  HazardRecord,
  H3Index,
  LatLng,
  ISODateString,
  Uuid,
} from "@potholeproof/shared-types";
import { meetsKAnonymity } from "@potholeproof/privacy";

/**
 * Who contributed evidence to a hazard (rotating anonymous device ids, tracked
 * by the hazard engine). Needed only to enforce k-anonymity — contributor ids
 * are never emitted in an export row.
 */
export interface HazardContribution {
  hazardId: Uuid;
  anonDeviceId: string;
}

export interface MunicipalExportOptions {
  /** Coarse aggregation cell — pass `geo.toTileCell`. */
  tileOf: (loc: LatLng) => H3Index;
  /** District/neighbourhood assignment — a boundary lookup in production. */
  districtOf: (loc: LatLng) => string;
  /** Minimum distinct contributors per emitted row (k-anonymity). */
  k: number;
}

/**
 * One aggregated, privacy-safe row of the municipal road-condition dataset.
 * Location is only ever a coarse cell + district; no event coordinates, no
 * timestamps finer than lastConfirmed, no contributor identifiers.
 */
export interface RoadConditionRow {
  h3Cell: H3Index;
  district: string;
  /** Hazards currently broken (active or reported). */
  openHazards: number;
  /** Hazards confirmed gone (retired or verified fixed). */
  fixedHazards: number;
  /** Severity stats over the OPEN hazards in the cell. */
  maxSeverity: number | null;
  meanSeverity: number | null;
  /** Distinct contributors backing this row (≥ k by construction). */
  contributorCount: number;
  lastConfirmed: ISODateString;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Build the aggregated municipal export. Hazards group by coarse cell; rows
 * whose evidence comes from fewer than `k` distinct contributors are dropped
 * entirely (suppression, not blurring). Deterministic: sorted by cell.
 */
export function buildMunicipalExport(
  hazards: readonly HazardRecord[],
  contributions: readonly HazardContribution[],
  options: MunicipalExportOptions
): RoadConditionRow[] {
  const contributorsByHazard = new Map<Uuid, string[]>();
  for (const c of contributions) {
    const arr = contributorsByHazard.get(c.hazardId);
    if (arr) arr.push(c.anonDeviceId);
    else contributorsByHazard.set(c.hazardId, [c.anonDeviceId]);
  }

  interface Acc {
    district: string;
    open: number;
    fixed: number;
    openSeverities: number[];
    contributors: string[];
    lastConfirmed: ISODateString;
  }
  const cells = new Map<H3Index, Acc>();

  for (const h of hazards) {
    const cell = options.tileOf(h.location);
    let a = cells.get(cell);
    if (!a) {
      a = {
        district: options.districtOf(h.location),
        open: 0,
        fixed: 0,
        openSeverities: [],
        contributors: [],
        lastConfirmed: h.lastConfirmed,
      };
      cells.set(cell, a);
    }

    if (h.status === "active" || h.status === "reported") {
      a.open += 1;
      a.openSeverities.push(h.severity);
    } else {
      a.fixed += 1;
    }
    const contribs = contributorsByHazard.get(h.id);
    if (contribs) a.contributors.push(...contribs);
    if (Date.parse(h.lastConfirmed) > Date.parse(a.lastConfirmed)) {
      a.lastConfirmed = h.lastConfirmed;
    }
  }

  const rows: RoadConditionRow[] = [];
  for (const [h3Cell, a] of cells) {
    if (!meetsKAnonymity(a.contributors, options.k)) continue; // suppress
    const sev = a.openSeverities;
    rows.push({
      h3Cell,
      district: a.district,
      openHazards: a.open,
      fixedHazards: a.fixed,
      maxSeverity: sev.length ? round2(Math.max(...sev)) : null,
      meanSeverity: sev.length
        ? round2(sev.reduce((s, x) => s + x, 0) / sev.length)
        : null,
      contributorCount: new Set(a.contributors).size,
      lastConfirmed: a.lastConfirmed,
    });
  }
  rows.sort((x, y) => (x.h3Cell < y.h3Cell ? -1 : x.h3Cell > y.h3Cell ? 1 : 0));
  return rows;
}
