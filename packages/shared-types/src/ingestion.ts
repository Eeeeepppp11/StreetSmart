import type { ISODateString } from "./common.js";
import type { JoltEvent } from "./sensing.js";

/**
 * Batched event-upload envelope (mobile client → services/ingestion). Phase 1 is
 * collect-only: these batches exist to build the ML training set, not to drive a
 * live hazard map. Carries only anonymous identifiers — never a stable user id.
 */
export interface EventUpload {
  /** Rotating, anonymous device/session id. */
  anonDeviceId: string;
  appVersion: string;
  /** Client-side batch creation time. */
  sentAt: ISODateString;
  events: JoltEvent[];
  /**
   * Optional user labels from the Phase-1 review screen, keyed by event id —
   * the raw material of the ML training set.
   */
  labels?: Record<string, TrainingLabel>;
}

export type TrainingLabel = "pothole" | "not_pothole";
