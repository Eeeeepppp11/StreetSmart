import type {
  JoltEvent,
  HazardRecord,
  HazardSeverityBand,
  H3Index,
  LatLng,
  ISODateString,
  Uuid,
} from "@potholeproof/shared-types";
import type { HazardEngineConfig } from "./config.js";
import { DEFAULT_HAZARD_CONFIG } from "./config.js";

/** HazardRecord plus the accumulators the engine needs but doesn't expose. */
interface InternalHazard extends HazardRecord {
  /** Sum of detection confidences (evidence the hazard is present). */
  hitScore: number;
  /** Confidence-weighted sum of severities, for the aggregate severity. */
  sevWeightedSum: number;
  weightSum: number;
}

export interface HazardEngineDeps {
  nextId: () => Uuid;
  /** Maps a coordinate to a hazard cell — pass `geo.toHazardCell` in production. */
  cellOf: (loc: LatLng) => H3Index;
}

function band(sev: number, c: HazardEngineConfig): HazardSeverityBand {
  return sev >= c.severeAt ? "severe" : sev >= c.moderateAt ? "moderate" : "minor";
}
function laterIso(a: ISODateString, b: ISODateString): ISODateString {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}
function earlierIso(a: ISODateString, b: ISODateString): ISODateString {
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

/**
 * In-memory confidence / self-heal engine. Aggregates {@link JoltEvent}s into
 * per-cell {@link HazardRecord}s, raising confidence on detections and lowering
 * it on clean passes, auto-retiring stale hazards. Deterministic: all time comes
 * from event/observation timestamps, ids from injected deps — no wall-clock. A
 * production deployment would persist this to PostGIS; the logic is identical.
 */
export class HazardEngine {
  private readonly cells = new Map<H3Index, InternalHazard>();

  constructor(
    private readonly deps: HazardEngineDeps,
    private readonly config: HazardEngineConfig = DEFAULT_HAZARD_CONFIG
  ) {}

  private confidenceOf(h: InternalHazard): number {
    const miss = h.cleanPassCount * this.config.missWeight;
    return (
      (h.hitScore + this.config.priorAlpha) /
      (h.hitScore + miss + this.config.priorAlpha + this.config.priorBeta)
    );
  }

  /** Fold a detected jolt into the map; returns the updated hazard. */
  ingestEvent(event: JoltEvent): HazardRecord {
    const cell = this.deps.cellOf(event.location);
    let h = this.cells.get(cell);
    if (!h) {
      h = {
        id: this.deps.nextId(),
        h3Cell: cell,
        location: event.location,
        severity: event.severity,
        severityBand: band(event.severity, this.config),
        confidence: 0,
        status: "active",
        firstSeen: event.capturedAt,
        lastConfirmed: event.capturedAt,
        passCount: 0,
        cleanPassCount: 0,
        modelVersion: event.modelVersion,
        hitScore: 0,
        sevWeightedSum: 0,
        weightSum: 0,
      };
      this.cells.set(cell, h);
    }

    h.passCount += 1;
    h.hitScore += event.confidence;
    h.sevWeightedSum += event.severity * event.confidence;
    h.weightSum += event.confidence;
    h.severity = h.weightSum > 0 ? h.sevWeightedSum / h.weightSum : event.severity;
    h.severityBand = band(h.severity, this.config);
    h.firstSeen = earlierIso(h.firstSeen, event.capturedAt);
    h.lastConfirmed = laterIso(h.lastConfirmed, event.capturedAt);
    h.modelVersion = event.modelVersion;
    h.confidence = this.confidenceOf(h);
    if (h.confidence >= this.config.activateThreshold) h.status = "active";
    return this.toPublic(h);
  }

  /**
   * Register a clean pass over a cell. Collapses the hazard once confidence
   * drops far enough: a previously-reported hazard is verified fixed (the
   * civic loop closing), anything else just retires.
   */
  ingestCleanPass(cell: H3Index): HazardRecord | undefined {
    const h = this.cells.get(cell);
    if (!h) return undefined;
    h.cleanPassCount += 1;
    h.confidence = this.confidenceOf(h);
    if (
      h.confidence < this.config.retireThreshold &&
      h.cleanPassCount >= this.config.minCleanToRetire
    ) {
      h.status = h.status === "reported" ? "verified_fixed" : "retired";
    }
    return this.toPublic(h);
  }

  /** Marks a hazard as filed with a civic report — the reporting layer's transition. */
  markReported(cell: H3Index, reportId: Uuid): HazardRecord | undefined {
    const h = this.cells.get(cell);
    if (!h) return undefined;
    h.status = "reported";
    h.reportId = reportId;
    return this.toPublic(h);
  }

  /**
   * Marks a hazard fixed on external confirmation (the city closed the
   * report) rather than clean-pass evidence — a direct status stamp, no
   * confidence math involved. Sibling to `ingestCleanPass`'s own
   * `"reported"→"verified_fixed"` transition for when a client can't collect
   * clean-pass evidence itself but has an authoritative "it's fixed" signal.
   */
  markVerifiedFixed(cell: H3Index): HazardRecord | undefined {
    const h = this.cells.get(cell);
    if (!h) return undefined;
    h.status = "verified_fixed";
    return this.toPublic(h);
  }

  /** Clean pass by location — applies only if a hazard already exists at that cell. */
  observeClean(location: LatLng): HazardRecord | undefined {
    return this.ingestCleanPass(this.deps.cellOf(location));
  }

  get(cell: H3Index): HazardRecord | undefined {
    const h = this.cells.get(cell);
    return h ? this.toPublic(h) : undefined;
  }

  /** All hazards (any status). */
  all(): HazardRecord[] {
    return [...this.cells.values()].map((h) => this.toPublic(h));
  }

  /** Active hazards — what the client map and proximity alerts consume. */
  active(): HazardRecord[] {
    return this.all().filter((h) => h.status === "active");
  }

  private toPublic(h: InternalHazard): HazardRecord {
    const { hitScore, sevWeightedSum, weightSum, ...pub } = h;
    void hitScore;
    void sevWeightedSum;
    void weightSum;
    return { ...pub };
  }
}
