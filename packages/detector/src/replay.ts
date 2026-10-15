import type { JoltEvent, SensorSample } from "@potholeproof/shared-types";
import type { GpsFix, PipelineDeps } from "./detect.js";
import { runDetection } from "./detect.js";
import type { DetectorConfig } from "./config.js";
import { DEFAULT_CONFIG } from "./config.js";

/**
 * A recorded drive — the fixture format for the sensor-replay harness. Golden
 * drives (real or demo) replay deterministically so detector changes are
 * regression-tested without re-driving. The Python `ml/` platform consumes the
 * same shape for model training/eval.
 */
export interface RecordedDrive {
  rateHz: number;
  samples: SensorSample[];
  gps: GpsFix[];
  label?: string;
}

/** Replay a recorded drive through the detector. Pure and deterministic. */
export function replayDrive(
  drive: RecordedDrive,
  deps: PipelineDeps,
  config: DetectorConfig = DEFAULT_CONFIG
): JoltEvent[] {
  return runDetection(drive.samples, drive.gps, deps, config);
}
