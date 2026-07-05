import type {
  CivicReport,
  HazardRecord,
  LatLng,
  ISODateString,
} from "@potholeproof/shared-types";

/**
 * Public repair-time scorecards by district — the civic-pressure surface.
 * Pure aggregation over civic reports joined to their hazards; district
 * assignment is injected (a boundary lookup in production).
 */
export interface ScorecardOptions {
  /** Map a hazard location to a district/neighbourhood name. */
  districtOf: (loc: LatLng) => string;
  /** "Now" for open-report ages — injected so output is deterministic. */
  asOf: ISODateString;
}

export interface DistrictScorecard {
  district: string;
  /** Total reports filed. */
  reported: number;
  /** Reports still awaiting a fix (not closed/rejected). */
  open: number;
  closed: number;
  rejected: number;
  /** Median days from submission to closure (closed reports with both stamps). */
  medianRepairDays: number | null;
  meanRepairDays: number | null;
  /** Age in days of the oldest still-open report. */
  oldestOpenDays: number | null;
}

const MS_PER_DAY = 86_400_000;

function daysBetween(a: ISODateString, b: ISODateString): number {
  return (Date.parse(b) - Date.parse(a)) / MS_PER_DAY;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Aggregate reports into per-district scorecards, sorted by district name.
 * Reports whose hazard is unknown are bucketed under "unknown".
 */
export function buildScorecard(
  reports: readonly CivicReport[],
  hazards: readonly HazardRecord[],
  options: ScorecardOptions
): DistrictScorecard[] {
  const hazardById = new Map(hazards.map((h) => [h.id, h]));

  interface Acc {
    reported: number;
    open: number;
    closed: number;
    rejected: number;
    repairDays: number[];
    oldestOpenDays: number | null;
  }
  const acc = new Map<string, Acc>();

  for (const r of reports) {
    const hazard = hazardById.get(r.hazardId);
    const district = hazard ? options.districtOf(hazard.location) : "unknown";
    let a = acc.get(district);
    if (!a) {
      a = {
        reported: 0,
        open: 0,
        closed: 0,
        rejected: 0,
        repairDays: [],
        oldestOpenDays: null,
      };
      acc.set(district, a);
    }

    a.reported += 1;
    if (r.status === "closed") {
      a.closed += 1;
      if (r.submittedAt && r.closedAt) {
        a.repairDays.push(daysBetween(r.submittedAt, r.closedAt));
      }
    } else if (r.status === "rejected") {
      a.rejected += 1;
    } else {
      a.open += 1;
      if (r.submittedAt) {
        const age = daysBetween(r.submittedAt, options.asOf);
        if (a.oldestOpenDays === null || age > a.oldestOpenDays) {
          a.oldestOpenDays = age;
        }
      }
    }
  }

  const rows: DistrictScorecard[] = [];
  for (const [district, a] of acc) {
    const sorted = [...a.repairDays].sort((x, y) => x - y);
    rows.push({
      district,
      reported: a.reported,
      open: a.open,
      closed: a.closed,
      rejected: a.rejected,
      medianRepairDays: sorted.length ? round2(median(sorted)) : null,
      meanRepairDays: sorted.length
        ? round2(sorted.reduce((s, x) => s + x, 0) / sorted.length)
        : null,
      oldestOpenDays:
        a.oldestOpenDays === null ? null : round2(a.oldestOpenDays),
    });
  }
  rows.sort((x, y) =>
    x.district < y.district ? -1 : x.district > y.district ? 1 : 0
  );
  return rows;
}
