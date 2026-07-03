import type { SensorSample, JoltEvent, Vec3 } from "@potholeproof/shared-types";
import { emitForPeak, type GpsFix, type PipelineDeps } from "./detect.js";
import type { DetectorConfig } from "./config.js";
import { DEFAULT_CONFIG } from "./config.js";
import { norm } from "./util.js";

/**
 * Streaming, incremental detector for live drives. Feed samples and GPS fixes as
 * they arrive; `push` returns any events that became decidable with the new data
 * and never re-emits. Uses the same {@link emitForPeak} decision as the batch
 * {@link runDetection}, so feeding a drive in chunks yields the same events as
 * processing it whole (verified in tests).
 *
 * A candidate is decided only once its full ±windowHalfMs window has arrived and
 * its run has ended, so emission lags a live strike by ~windowHalfMs — the price
 * of not emitting on a half-seen jolt. Call `flush()` at end-of-drive to process
 * any last ripe candidates.
 */
export class DetectionPipeline {
  private readonly samples: SensorSample[] = [];
  private readonly dyn: number[] = [];
  private readonly gps: GpsFix[] = [];
  private grav: Vec3 | null = null;
  private cursorT = -Infinity; // peaks at t <= cursorT already decided
  private lastEmitT = -Infinity; // refractory across chunks
  private readonly alpha = 0.05;

  constructor(
    private readonly deps: PipelineDeps,
    private readonly config: DetectorConfig = DEFAULT_CONFIG
  ) {}

  pushGps(fix: GpsFix): void {
    this.gps.push(fix);
  }

  /** Ingest samples (assumed time-sorted). Returns newly decided events. */
  push(samples: readonly SensorSample[]): JoltEvent[] {
    for (const s of samples) {
      if (this.grav === null) {
        this.grav = { ...s.accel };
      } else {
        const g = this.grav;
        this.grav = {
          x: g.x + this.alpha * (s.accel.x - g.x),
          y: g.y + this.alpha * (s.accel.y - g.y),
          z: g.z + this.alpha * (s.accel.z - g.z),
        };
      }
      const g = this.grav;
      this.samples.push(s);
      this.dyn.push(
        norm({ x: s.accel.x - g.x, y: s.accel.y - g.y, z: s.accel.z - g.z })
      );
    }
    return this.drain(false);
  }

  /** Process any remaining ripe candidates at end-of-drive. */
  flush(): JoltEvent[] {
    return this.drain(true);
  }

  private drain(finalize: boolean): JoltEvent[] {
    const out: JoltEvent[] = [];
    const n = this.samples.length;
    if (n < 5 || this.gps.length === 0) return out;

    const half = this.config.windowHalfMs;
    const exit = this.config.triggerAccel * 0.5;
    const latestT = this.samples[n - 1]!.t;

    let i = 0;
    while (i < n && this.samples[i]!.t <= this.cursorT) i++;

    while (i < n) {
      if (this.dyn[i]! >= this.config.triggerAccel) {
        let j = i;
        let peakIdx = i;
        let peakVal = this.dyn[i]!;
        while (j < n && this.dyn[j]! >= exit) {
          if (this.dyn[j]! > peakVal) {
            peakVal = this.dyn[j]!;
            peakIdx = j;
          }
          j++;
        }
        const runEndedInBuffer = j < n;
        const peakT = this.samples[peakIdx]!.t;
        const windowComplete = peakT + half <= latestT;

        // Not ripe yet: wait for more data. Don't advance the cursor past it.
        if (!windowComplete || (!finalize && !runEndedInBuffer)) break;

        if (peakT - this.lastEmitT >= this.config.refractoryMs) {
          const ev = emitForPeak(this.samples, this.gps, peakT, this.deps, this.config);
          if (ev) {
            out.push(ev);
            this.lastEmitT = peakT;
          }
        }
        this.cursorT = peakT;
        i = j;
      } else {
        i++;
      }
    }

    this.trim(latestT);
    return out;
  }

  /** Drop history that can no longer contribute to a future window. */
  private trim(latestT: number): void {
    const keepMs =
      2 * this.config.windowHalfMs + this.config.refractoryMs + 200;
    const minKeepT = latestT - keepMs;
    let drop = 0;
    while (
      drop < this.samples.length - 1 &&
      this.samples[drop]!.t < minKeepT &&
      this.samples[drop]!.t <= this.cursorT
    ) {
      drop++;
    }
    if (drop > 0) {
      this.samples.splice(0, drop);
      this.dyn.splice(0, drop);
    }
    // Keep at least one GPS fix before the retained window for interpolation.
    let gdrop = 0;
    while (
      gdrop < this.gps.length - 1 &&
      this.gps[gdrop + 1]!.t < minKeepT
    ) {
      gdrop++;
    }
    if (gdrop > 0) this.gps.splice(0, gdrop);
  }
}
