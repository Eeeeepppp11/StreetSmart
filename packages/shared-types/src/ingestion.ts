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
}
