import type {
  JoltEvent,
  JoltClassification,
  LatLng,
} from "@potholeproof/shared-types";

/** Max events accepted in a single upload batch. */
export const MAX_BATCH_SIZE = 1000;
/** Sanity cap on vehicle speed (~200 mph); anything higher is a bad reading. */
export const MAX_SPEED_MPS = 90;

const CLASSIFICATIONS: readonly JoltClassification[] = [
  "pothole",
  "speed_bump",
  "rough_road",
  "other",
];

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}
function isIsoDate(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && !Number.isNaN(Date.parse(x));
}

export interface EventValidation {
  value?: JoltEvent;
  errors: string[];
}

/**
 * Structurally validate an untrusted payload as a {@link JoltEvent}. Returns a
 * clean, reconstructed event on success (never trusts extra fields), or a list
 * of human-readable errors. No exceptions — callers branch on `value`.
 */
export function validateJoltEvent(input: unknown): EventValidation {
  if (typeof input !== "object" || input === null) {
    return { errors: ["event is not an object"] };
  }
  const e = input as Record<string, unknown>;
  const errors: string[] = [];

  if (!isNonEmptyString(e.id)) errors.push("id must be a non-empty string");
  if (!isIsoDate(e.capturedAt)) {
    errors.push("capturedAt must be an ISO date string");
  }
  if (!isNonEmptyString(e.modelVersion)) {
    errors.push("modelVersion must be a non-empty string");
  }

  let location: LatLng | undefined;
  const loc = e.location;
  if (typeof loc !== "object" || loc === null) {
    errors.push("location must be an object");
  } else {
    const l = loc as Record<string, unknown>;
    const latOk = isFiniteNumber(l.lat) && l.lat >= -90 && l.lat <= 90;
    const lngOk = isFiniteNumber(l.lng) && l.lng >= -180 && l.lng <= 180;
    if (!latOk) errors.push("location.lat out of range [-90, 90]");
    if (!lngOk) errors.push("location.lng out of range [-180, 180]");
    if (latOk && lngOk) location = { lat: l.lat as number, lng: l.lng as number };
  }

  if (!isFiniteNumber(e.speedMps) || e.speedMps < 0 || e.speedMps > MAX_SPEED_MPS) {
    errors.push(`speedMps out of range [0, ${MAX_SPEED_MPS}]`);
  }
  if (!isFiniteNumber(e.severity) || e.severity < 0 || e.severity > 1) {
    errors.push("severity must be in [0, 1]");
  }
  if (!isFiniteNumber(e.confidence) || e.confidence < 0 || e.confidence > 1) {
    errors.push("confidence must be in [0, 1]");
  }
  if (
    typeof e.classification !== "string" ||
    !CLASSIFICATIONS.includes(e.classification as JoltClassification)
  ) {
    errors.push("classification is not a known value");
  }

  let heading: number | undefined;
  if (e.heading !== undefined) {
    if (!isFiniteNumber(e.heading) || e.heading < 0 || e.heading >= 360) {
      errors.push("heading must be in [0, 360)");
    } else {
      heading = e.heading;
    }
  }

  if (errors.length > 0) return { errors };

  const value: JoltEvent = {
    id: e.id as string,
    capturedAt: e.capturedAt as string,
    location: location!,
    speedMps: e.speedMps as number,
    severity: e.severity as number,
    confidence: e.confidence as number,
    classification: e.classification as JoltClassification,
    modelVersion: e.modelVersion as string,
  };
  return { value: heading !== undefined ? { ...value, heading } : value, errors: [] };
}

export interface UploadValidation {
  /** True when the envelope itself is well-formed (individual bad events are just rejected). */
  ok: boolean;
  accepted: JoltEvent[];
  rejected: { index: number; errors: string[] }[];
  envelopeErrors: string[];
}

/**
 * Validate an {@link EventUpload} envelope. Lenient by design for Phase-1
 * collect-only intake: a malformed envelope is rejected, but within a good
 * envelope, valid events are accepted and invalid ones are reported per-index
 * rather than failing the whole batch.
 */
export function validateUpload(
  input: unknown,
  maxBatch: number = MAX_BATCH_SIZE
): UploadValidation {
  const accepted: JoltEvent[] = [];
  const rejected: { index: number; errors: string[] }[] = [];
  const envelopeErrors: string[] = [];

  if (typeof input !== "object" || input === null) {
    return { ok: false, accepted, rejected, envelopeErrors: ["upload is not an object"] };
  }
  const u = input as Record<string, unknown>;

  if (!isNonEmptyString(u.anonDeviceId)) {
    envelopeErrors.push("anonDeviceId must be a non-empty string");
  }
  if (!isNonEmptyString(u.appVersion)) {
    envelopeErrors.push("appVersion must be a non-empty string");
  }
  if (!isIsoDate(u.sentAt)) {
    envelopeErrors.push("sentAt must be an ISO date string");
  }
  if (!Array.isArray(u.events)) {
    envelopeErrors.push("events must be an array");
    return { ok: false, accepted, rejected, envelopeErrors };
  }
  if (u.events.length === 0) envelopeErrors.push("events must not be empty");
  if (u.events.length > maxBatch) {
    envelopeErrors.push(`events exceeds max batch size ${maxBatch}`);
  }

  u.events.slice(0, maxBatch).forEach((ev: unknown, index: number) => {
    const r = validateJoltEvent(ev);
    if (r.value) accepted.push(r.value);
    else rejected.push({ index, errors: r.errors });
  });

  return { ok: envelopeErrors.length === 0, accepted, rejected, envelopeErrors };
}
