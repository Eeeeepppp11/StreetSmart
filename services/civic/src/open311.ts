import type {
  HazardRecord,
  CivicReport,
  CivicReportStatus,
  CivicProvider,
  Uuid,
} from "@potholeproof/shared-types";

/**
 * The subset of an Open311 GeoReport v2 `POST /requests` payload we submit.
 * Open311 is the open standard behind SF311 (our pilot) and many city 311 APIs.
 */
export interface Open311RequestPayload {
  service_code: string;
  lat: number;
  long: number;
  description: string;
  media_url?: string;
}

/** What kind of road defect the hazard is — picks the service code and wording. */
export type CivicHazardKind = "pothole" | "rough_road";

/** Jurisdiction service code per hazard kind (SF311 pilot placeholders). */
export function serviceCodeFor(kind: CivicHazardKind): string {
  return kind === "rough_road" ? "road-surface-repair" : "pothole-repair";
}

/** Extra context a filer can attach to make the ticket actionable. */
export interface ReportContext {
  kind?: CivicHazardKind;
  /** Street address (reverse-geocoded) — cities route by address, not lat/long. */
  address?: string;
  /** Distinct drivers who confirmed the hazard. */
  confirmers?: number;
  /** Free-text note from the person filing. */
  notes?: string;
}

export interface Open311RequestOptions {
  /** The jurisdiction's service code for a pothole / road-damage request. */
  serviceCode: string;
  /** Optional photo URL to attach. */
  mediaUrl?: string;
  /** Richer description inputs; without them the legacy one-line text is used. */
  context?: ReportContext;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.max(1, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000) + 1);
}

/** The human-readable body of the ticket: what, where, and how well-evidenced. */
export function describeHazardForCity(hazard: HazardRecord, context: ReportContext = {}): string {
  const kind = context.kind ?? "pothole";
  const what = kind === "rough_road" ? "Severely rough road surface" : "Pothole";
  const pct = Math.round(hazard.confidence * 100);
  const parts = [`${what} (${hazard.severityBand} severity, ${pct}% confidence).`];
  if (context.address) parts.push(`Location: ${context.address}.`);
  const evidence: string[] = [];
  if (context.confirmers !== undefined && context.confirmers > 0) {
    evidence.push(`confirmed by ${context.confirmers} driver${context.confirmers === 1 ? "" : "s"}`);
  }
  if (hazard.passCount > 0) evidence.push(`${hazard.passCount} detection${hazard.passCount === 1 ? "" : "s"}`);
  const span = daysBetween(hazard.firstSeen, hazard.lastConfirmed);
  evidence.push(span > 1 ? `seen over ${span} days` : "first seen recently");
  parts.push(`Evidence: ${evidence.join(", ")}.`);
  if (context.notes?.trim()) parts.push(`Reporter notes: ${context.notes.trim()}`);
  parts.push("Auto-reported by StreetSmart.");
  return parts.join(" ");
}

/** Build an Open311 service-request payload from a detected hazard. */
export function hazardToOpen311Request(
  hazard: HazardRecord,
  options: Open311RequestOptions
): Open311RequestPayload {
  const pct = Math.round(hazard.confidence * 100);
  const description = options.context
    ? describeHazardForCity(hazard, options.context)
    : `Pothole / road-surface damage detected (${hazard.severityBand}, ` +
      `${pct}% confidence, ${hazard.passCount} passes). ` +
      `Auto-reported by StreetSmart.`;
  const payload: Open311RequestPayload = {
    service_code: options.serviceCode,
    lat: hazard.location.lat,
    long: hazard.location.lng,
    description,
  };
  return options.mediaUrl !== undefined
    ? { ...payload, media_url: options.mediaUrl }
    : payload;
}

/**
 * Replace (or add, or remove) the "Reporter notes" sentence in a description
 * built by {@link describeHazardForCity}, leaving the rest untouched — used when
 * the person who filed a report edits their note afterwards.
 */
export function withReporterNotes(description: string, notes: string): string {
  const sign = "Auto-reported by StreetSmart.";
  const withoutNotes = description.replace(/ ?Reporter notes: .*?(?= ?Auto-reported by StreetSmart\.$)/, "");
  const trimmed = notes.trim();
  if (!trimmed) return withoutNotes;
  const at = withoutNotes.lastIndexOf(sign);
  if (at < 0) return `${withoutNotes} Reporter notes: ${trimmed}`;
  return `${withoutNotes.slice(0, at).trimEnd()} Reporter notes: ${trimmed} ${sign}`;
}

/**
 * Normalise a provider's request status into our {@link CivicReportStatus}.
 * Open311 itself only defines "open"/"closed"; real jurisdictions and
 * SeeClickFix add sub-statuses, so we map a case-insensitive superset and fall
 * back to "submitted" for anything still open-shaped/unknown.
 */
export function normalizeOpen311Status(raw: string): CivicReportStatus {
  switch (raw.trim().toLowerCase()) {
    case "open":
      return "submitted";
    case "acknowledged":
    case "received":
      return "acknowledged";
    case "in_progress":
    case "in progress":
    case "investigating":
    case "assigned":
      return "in_progress";
    case "closed":
    case "resolved":
    case "fixed":
    case "completed":
    case "done":
      return "closed";
    case "rejected":
    case "declined":
    case "invalid":
    case "duplicate":
      return "rejected";
    default:
      return "submitted";
  }
}

/** Create a draft {@link CivicReport} linked to a hazard (pre-submission). */
export function draftCivicReport(
  hazard: HazardRecord,
  provider: CivicProvider,
  nextId: () => Uuid
): CivicReport {
  return {
    id: nextId(),
    hazardId: hazard.id,
    provider,
    status: "draft",
  };
}
