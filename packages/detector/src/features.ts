import type { SensorSample } from "@potholeproof/shared-types";

/**
 * Scalar features extracted from a window of samples. All "vertical" quantities
 * are measured along the estimated gravity direction (mean acceleration over the
 * window), which makes them approximately independent of how the phone is
 * mounted — the "reorient to a vehicle frame" step from the architecture.
 */
export interface JoltFeatures {
  sampleCount: number;
  /** Mean inter-sample interval, milliseconds. */
  dtMs: number;
  /** Peak-to-peak dynamic vertical acceleration, m/s^2. */
  peakToPeak: number;
  /** RMS of dynamic vertical acceleration, m/s^2. */
  rms: number;
  /** Max absolute dynamic vertical acceleration, m/s^2. */
  maxAbsVert: number;
  /** Max absolute vertical jerk, m/s^3 (sharpness of the event). */
  maxJerk: number;
  /** Time from the vertical peak until the signal settles, milliseconds. */
  settleMs: number;
  /** Fraction of dynamic energy on the vertical axis, 0..1. */
  verticalDominance: number;
  /** RMS gyroscope magnitude over the window, rad/s. */
  gyroRms: number;
}

function zeroFeatures(n: number): JoltFeatures {
  return {
    sampleCount: n,
    dtMs: 0,
    peakToPeak: 0,
    rms: 0,
    maxAbsVert: 0,
    maxJerk: 0,
    settleMs: 0,
    verticalDominance: 0,
    gyroRms: 0,
  };
}

export function extractFeatures(window: SensorSample[]): JoltFeatures {
  const n = window.length;
  if (n < 3) return zeroFeatures(n);

  // Gravity estimate = mean acceleration over the window.
  let gx = 0;
  let gy = 0;
  let gz = 0;
  for (const s of window) {
    gx += s.accel.x;
    gy += s.accel.y;
    gz += s.accel.z;
  }
  gx /= n;
  gy /= n;
  gz /= n;
  const gMag = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
  const gux = gx / gMag;
  const guy = gy / gMag;
  const guz = gz / gMag;

  const first = window[0]!;
  const last = window[n - 1]!;
  const dtMs = (last.t - first.t) / (n - 1) || 10;
  const dt = dtMs / 1000;

  const vert = new Array<number>(n);
  let sumVert2 = 0;
  let sumHoriz2 = 0;
  let sumGyro2 = 0;
  let maxV = -Infinity;
  let minV = Infinity;
  let maxAbs = 0;

  for (let i = 0; i < n; i++) {
    const s = window[i]!;
    const vAll = s.accel.x * gux + s.accel.y * guy + s.accel.z * guz;
    const vDyn = vAll - gMag; // remove gravity magnitude → dynamic vertical
    vert[i] = vDyn;

    const hx = s.accel.x - vAll * gux;
    const hy = s.accel.y - vAll * guy;
    const hz = s.accel.z - vAll * guz;
    sumHoriz2 += hx * hx + hy * hy + hz * hz;
    sumVert2 += vDyn * vDyn;

    if (vDyn > maxV) maxV = vDyn;
    if (vDyn < minV) minV = vDyn;
    const a = Math.abs(vDyn);
    if (a > maxAbs) maxAbs = a;

    sumGyro2 += s.gyro.x * s.gyro.x + s.gyro.y * s.gyro.y + s.gyro.z * s.gyro.z;
  }

  const peakToPeak = maxV - minV;
  const rms = Math.sqrt(sumVert2 / n);
  const gyroRms = Math.sqrt(sumGyro2 / n);
  const verticalDominance = sumVert2 / (sumVert2 + sumHoriz2 + 1e-9);

  let maxJerk = 0;
  for (let i = 1; i < n; i++) {
    const j = Math.abs((vert[i]! - vert[i - 1]!) / dt);
    if (j > maxJerk) maxJerk = j;
  }

  // Settle time: from the vertical peak until |vert| stays within a band for 3 samples.
  let peakIdx = 0;
  let peakMag = -1;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(vert[i]!);
    if (a > peakMag) {
      peakMag = a;
      peakIdx = i;
    }
  }
  const settleBand = 0.2 * maxAbs;
  let settleIdx = n - 1;
  let below = 0;
  for (let i = peakIdx; i < n; i++) {
    if (Math.abs(vert[i]!) < settleBand) {
      below++;
      if (below >= 3) {
        settleIdx = i - 2;
        break;
      }
    } else {
      below = 0;
    }
  }
  const settleMs = Math.max(0, settleIdx - peakIdx) * dtMs;

  return {
    sampleCount: n,
    dtMs,
    peakToPeak,
    rms,
    maxAbsVert: maxAbs,
    maxJerk,
    settleMs,
    verticalDominance,
    gyroRms,
  };
}
