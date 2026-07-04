import type { SensorSample, Vec3 } from "@potholeproof/shared-types";
import { cross, norm, lcg } from "./util.js";

export interface SynthImpulse {
  /** Centre time of the event, milliseconds. */
  atMs: number;
  /** Nominal amplitude scale for the impulse, m/s^2 (approximate peak). */
  peak: number;
  /**
   * "sharp" ⇒ bipolar, high-jerk strike (pothole-like).
   * "rounded" ⇒ smooth symmetric hump (speed-bump-like).
   */
  kind: "sharp" | "rounded";
  /** Optional rotational (pitch) content, rad/s — speed bumps have this. */
  gyroPeak?: number;
  /** Characteristic width, milliseconds (defaults: sharp 40, rounded 300). */
  widthMs?: number;
}

export interface SynthOptions {
  durationMs: number;
  rateHz: number;
  /** Gravity vector (device frame). Default straight down the z-axis. */
  gravity?: Vec3;
  /** Uniform accelerometer noise amplitude, m/s^2. */
  noise?: number;
  /** Uniform gyroscope noise amplitude, rad/s. */
  gyroNoise?: number;
  impulses?: SynthImpulse[];
  seed?: number;
}

/**
 * Generate a deterministic synthetic sensor stream for tests and fixture
 * authoring. Impulses are injected along the gravity ("vertical") axis, so
 * changing `gravity` simulates a differently-mounted phone and exercises the
 * detector's mount-angle independence.
 */
export function makeSamples(opts: SynthOptions): SensorSample[] {
  const rate = opts.rateHz;
  const dtMs = 1000 / rate;
  const count = Math.floor(opts.durationMs / dtMs) + 1;
  const gravity = opts.gravity ?? { x: 0, y: 0, z: 9.81 };
  const gMag = Math.hypot(gravity.x, gravity.y, gravity.z) || 1;
  const gu: Vec3 = {
    x: gravity.x / gMag,
    y: gravity.y / gMag,
    z: gravity.z / gMag,
  };

  // A pitch axis orthogonal to gravity, for injecting gyro content.
  const ref: Vec3 =
    Math.abs(gu.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const pRaw = cross(gu, ref);
  const pMag = norm(pRaw) || 1;
  const pitch: Vec3 = { x: pRaw.x / pMag, y: pRaw.y / pMag, z: pRaw.z / pMag };

  const rnd = lcg(opts.seed ?? 1);
  const noise = opts.noise ?? 0;
  const gyroNoise = opts.gyroNoise ?? 0;
  const impulses = opts.impulses ?? [];

  const out: SensorSample[] = [];
  for (let i = 0; i < count; i++) {
    const t = Math.round(i * dtMs);
    let dyn = 0;
    let gyroPitch = 0;

    for (const imp of impulses) {
      const w = imp.widthMs ?? (imp.kind === "sharp" ? 40 : 300);
      const x = t - imp.atMs;
      if (imp.kind === "sharp") {
        // Scaled derivative-of-Gaussian: bipolar, ±peak near x = ±w/2, high jerk.
        const s = w / 2;
        dyn +=
          -imp.peak * (x / s) * Math.exp(-(x * x) / (2 * s * s)) * Math.SQRT2 *
          0.8574; // 1 / (e^-0.5) normalisation so the extremum ≈ peak
      } else if (Math.abs(x) <= w / 2) {
        // Half-cosine hump: 0 → peak → 0, unipolar, low jerk.
        dyn += imp.peak * Math.cos((Math.PI * x) / w);
      }
      if (imp.gyroPeak && Math.abs(x) <= w / 2) {
        gyroPitch += imp.gyroPeak * Math.cos((Math.PI * x) / w);
      }
    }

    const an = () => (rnd() * 2 - 1) * noise;
    const gn = () => (rnd() * 2 - 1) * gyroNoise;
    out.push({
      t,
      accel: {
        x: gravity.x + gu.x * dyn + an(),
        y: gravity.y + gu.y * dyn + an(),
        z: gravity.z + gu.z * dyn + an(),
      },
      gyro: {
        x: pitch.x * gyroPitch + gn(),
        y: pitch.y * gyroPitch + gn(),
        z: pitch.z * gyroPitch + gn(),
      },
    });
  }
  return out;
}
