import type { ISODateString, Uuid } from "./common.js";

export type CivicProvider = "open311" | "seeclickfix" | "custom";

/** Normalised civic report lifecycle (superset mapped from each provider). */
export type CivicReportStatus =
  | "draft"
  | "submitted"
  | "acknowledged"
  | "in_progress"
  | "closed"
  | "rejected";

export interface CivicReport {
  id: Uuid;
  hazardId: Uuid;
  provider: CivicProvider;
  /** Identifier returned by the city's system. */
  externalId?: string;
  status: CivicReportStatus;
  submittedAt?: ISODateString;
  /** When the report reached a closed state (city fix or auto-verification). */
  closedAt?: ISODateString;
  lastCheckedAt?: ISODateString;
  photoUrl?: string;
}

/**
 * Contract implemented per civic backend in `services/civic`. Adding a city
 * means adding an adapter, not touching core code. First target: SF311
 * (Open311-compliant).
 */
export interface CivicAdapter {
  readonly provider: CivicProvider;
  submit(
    report: CivicReport
  ): Promise<{ externalId: string; status: CivicReportStatus }>;
  getStatus(externalId: string): Promise<CivicReportStatus>;
}
