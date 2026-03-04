/**
 * Spring physics utilities for atom emergence animation.
 *
 * Provides smooth, physically-motivated transitions for atoms
 * appearing from community centroids to their final positions.
 */

/** 3D position vector. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Linearly interpolate between two positions.
 */
export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/**
 * Compute the centroid of a set of positions.
 */
export function centroid(positions: Vec3[]): Vec3 {
  if (positions.length === 0) return { x: 0, y: 0, z: 0 };

  let sx = 0, sy = 0, sz = 0;
  for (const p of positions) {
    sx += p.x;
    sy += p.y;
    sz += p.z;
  }
  return {
    x: sx / positions.length,
    y: sy / positions.length,
    z: sz / positions.length,
  };
}

/**
 * Compute the bounding radius of positions around a center.
 */
export function boundingRadius(positions: Vec3[], center: Vec3): number {
  let maxR = 0;
  for (const p of positions) {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const dz = p.z - center.z;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r > maxR) maxR = r;
  }
  return maxR;
}

/**
 * Add small z-jitter to ring atoms for subtle 3D effect.
 *
 * Atoms in rings get slight z displacement to hint at 3D structure
 * while keeping the molecule mostly planar.
 */
export function addRingJitter(
  positions: Vec3[],
  isRingAtom: boolean[],
  amplitude = 0.1,
): Vec3[] {
  return positions.map((pos, i) => {
    if (!isRingAtom[i]) return pos;
    // Alternate up/down around the ring
    const jitter = (i % 2 === 0 ? 1 : -1) * amplitude;
    return { ...pos, z: pos.z + jitter };
  });
}

/**
 * Distance between two 3D points.
 */
export function distance3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Midpoint between two 3D points.
 */
export function midpoint3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

/**
 * Direction vector from a to b (normalized).
 */
export function direction3(a: Vec3, b: Vec3): Vec3 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-8) return { x: 0, y: 1, z: 0 };
  return { x: dx / len, y: dy / len, z: dz / len };
}
