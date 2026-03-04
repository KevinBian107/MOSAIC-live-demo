/**
 * Translucent convex hull visualization for a community.
 *
 * During animation Phase 1, communities appear as colored blobs.
 * The hull shrinks and fades as atoms populate in Phase 2.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import type { CommunityType } from '../engine/types';
import { TYPE_COLORS } from '../engine/types';

interface CommunityHullProps {
  /** Atom positions within this community. */
  positions: [number, number, number][];
  /** Community type determines color. */
  type: CommunityType;
  /** Hull opacity (controlled by animation phase). */
  opacity: number;
  /** Scale factor (1 = encompass all atoms, < 1 = shrinking). */
  scale?: number;
}

export default function CommunityHull({
  positions,
  type,
  opacity,
  scale = 1,
}: CommunityHullProps) {
  const color = TYPE_COLORS[type];

  const { center, radius } = useMemo(() => {
    if (positions.length === 0) {
      return { center: new THREE.Vector3(), radius: 0.5 };
    }

    // Compute centroid
    const cx = positions.reduce((s, p) => s + p[0], 0) / positions.length;
    const cy = positions.reduce((s, p) => s + p[1], 0) / positions.length;
    const cz = positions.reduce((s, p) => s + p[2], 0) / positions.length;
    const c = new THREE.Vector3(cx, cy, cz);

    // Compute bounding radius
    let maxR = 0.08; // Minimum radius
    for (const p of positions) {
      const d = c.distanceTo(new THREE.Vector3(...p));
      if (d > maxR) maxR = d;
    }

    return { center: c, radius: maxR + 0.1 }; // Add padding
  }, [positions]);

  if (opacity <= 0 || positions.length === 0) return null;

  const scaledRadius = radius * scale;

  return (
    <mesh position={[center.x, center.y, center.z]}>
      <sphereGeometry args={[scaledRadius, 24, 24]} />
      <meshStandardMaterial
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
