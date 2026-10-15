import type { Vec3 } from "@potholeproof/shared-types";

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function norm(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Clamp to the closed interval [0, 1]. */
export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Deterministic linear-congruential PRNG in [0, 1). Seeded so demo drives
 * and tests are perfectly reproducible.
 */
export function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
