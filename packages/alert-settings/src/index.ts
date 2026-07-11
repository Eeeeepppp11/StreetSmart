import type { JoltEvent, JoltClassification } from "@potholeproof/shared-types";

/**
 * How much the driver wants to be interrupted. Mirrors the severity bands
 * already used for hazard coloring/reporting (0.34 moderate, 0.67 severe) so
 * the thresholds line up with what the rest of the app calls "moderate" or
 * "severe".
 */
export type AlertSensitivity = "all" | "moderate" | "severe_only";

/** Whether alerts are spoken, vibration-only, or fully suppressed. */
export type AlertMode = "voice_haptic" | "haptic_only" | "silent";

export interface AlertSettings {
  sensitivity: AlertSensitivity;
  mode: AlertMode;
  /** How long to buffer alert-worthy detections before speaking one bundled alert, ms. */
  bundleWindowMs: number;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  sensitivity: "all",
  mode: "voice_haptic",
  bundleWindowMs: 4000,
};

const MODERATE_SEVERITY = 0.34;
const SEVERE_SEVERITY = 0.67;

/**
 * Filter deciding whether a single detection is worth interrupting the driver
 * for, independent of bundling/mode. Pure — no I/O, no clock.
 */
export function shouldAlert(event: JoltEvent, settings: AlertSettings): boolean {
  switch (settings.sensitivity) {
    case "all":
      return true;
    case "moderate":
      return event.severity >= MODERATE_SEVERITY || event.classification === "pothole";
    case "severe_only":
      return event.classification === "pothole" && event.severity >= SEVERE_SEVERITY;
  }
}

export interface AlertBundle {
  events: JoltEvent[];
  /** How many events of each classification are in this bundle. */
  classificationCounts: Partial<Record<JoltClassification, number>>;
  highestSeverity: number;
}

function toBundle(events: readonly JoltEvent[]): AlertBundle {
  const classificationCounts: Partial<Record<JoltClassification, number>> = {};
  let highestSeverity = 0;
  for (const e of events) {
    classificationCounts[e.classification] = (classificationCounts[e.classification] ?? 0) + 1;
    if (e.severity > highestSeverity) highestSeverity = e.severity;
  }
  return { events: [...events], classificationCounts, highestSeverity };
}

export interface AlertBundlerDeps {
  now: () => number;
}

/**
 * Buffers detections that passed {@link shouldAlert} and releases them as one
 * bundle per `bundleWindowMs` window, so several jolts in a short stretch of
 * bad road become a single spoken alert instead of one per jolt. Stateful but
 * pure otherwise — time is injected (mirrors `PipelineDeps`/`DetectionPipeline`
 * in `@potholeproof/detector`), so it's fully deterministic under test.
 */
export class AlertBundler {
  private buffered: JoltEvent[] = [];
  private windowStartMs: number | null = null;

  constructor(
    private readonly deps: AlertBundlerDeps,
    private readonly settings: AlertSettings = DEFAULT_ALERT_SETTINGS
  ) {}

  /** Buffer an already-filtered event into the current window. */
  add(event: JoltEvent): void {
    if (this.windowStartMs === null) this.windowStartMs = this.deps.now();
    this.buffered.push(event);
  }

  /**
   * Call on every drain tick. Returns the buffered bundle once `bundleWindowMs`
   * has elapsed since the first event of the current window, and resets —
   * otherwise returns `null` and keeps buffering.
   */
  drain(): AlertBundle | null {
    if (this.windowStartMs === null || this.buffered.length === 0) return null;
    if (this.deps.now() - this.windowStartMs < this.settings.bundleWindowMs) return null;

    const bundle = toBundle(this.buffered);
    this.buffered = [];
    this.windowStartMs = null;
    return bundle;
  }
}

const CLASSIFICATION_WORDS: Record<JoltClassification, { singular: string; plural: string }> = {
  pothole: { singular: "Pothole", plural: "potholes" },
  speed_bump: { singular: "Speed bump", plural: "speed bumps" },
  rough_road: { singular: "Rough road", plural: "rough roads" },
  other: { singular: "Hazard", plural: "hazards" },
};

/**
 * Spoken text for a bundle: a single event names its classification ("Pothole
 * ahead"); multiple events of the same classification are counted ("3
 * potholes detected"); a mixed bundle falls back to a generic count ("4
 * hazards detected").
 */
export function phraseForBundle(bundle: AlertBundle): string {
  const { events } = bundle;
  if (events.length === 1) {
    return `${CLASSIFICATION_WORDS[events[0]!.classification].singular} ahead`;
  }
  const classifications = Object.keys(bundle.classificationCounts) as JoltClassification[];
  if (classifications.length === 1) {
    return `${events.length} ${CLASSIFICATION_WORDS[classifications[0]!].plural} detected`;
  }
  return `${events.length} hazards detected`;
}
