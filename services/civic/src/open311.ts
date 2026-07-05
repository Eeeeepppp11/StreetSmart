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

export interface Open311RequestOptions {
  /** The jurisdiction's service code for a pothole / road-damage request. */
  serviceCode: string;
  /** Optional photo URL to attach. */
  mediaUrl?: string;
}

/** Build an Open311 service-request payload from a detected hazard. */
export function hazardToOpen311Request(
  hazard: HazardRecord,
  options: Open311RequestOptions
): Open311RequestPayload {
  const pct = Math.round(hazard.confidence * 100);
  const description =
    `Pothole / road-surface damage detected (${hazard.severityBand}, ` +
    `${pct}% confidence, ${hazard.passCount} passes). ` +
    `Auto-reported by PotholeProof.`;
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
