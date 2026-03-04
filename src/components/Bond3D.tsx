/**
 * 3D bond cylinder between two atoms.
 *
 * Renders bonds as matte gray cylinders connecting atom centers.
 * Bond type affects cylinder radius (double/triple bonds are thicker).
 */

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Mesh } from 'three';

/** Bond color by type. */
const BOND_COLORS: Record<number, string> = {
  0: '#666666', // SINGLE
  1: '#888888', // DOUBLE
  2: '#999999', // TRIPLE
  3: '#7777AA', // AROMATIC
  4: '#666666', // Unknown
};

/** Bond radius by type (scaled for normalized coordinates). */
const BOND_RADII: Record<number, number> = {
  0: 0.025,  // SINGLE
  1: 0.020,  // DOUBLE
  2: 0.018,  // TRIPLE
  3: 0.022,  // AROMATIC
  4: 0.025,  // Unknown
};

interface Bond3DProps {
  start: [number, number, number];
  end: [number, number, number];
  typeIdx: number;
  opacity?: number;
  /** If true, render as dashed (for super-edge preview). */
  dashed?: boolean;
}

export default function Bond3D({
  start,
  end,
  typeIdx,
  opacity = 1,
  dashed = false,
}: Bond3DProps) {
  const meshRef = useRef<Mesh>(null);

  const { position, quaternion, length } = useMemo(() => {
    const startVec = new THREE.Vector3(...start);
    const endVec = new THREE.Vector3(...end);
    const mid = new THREE.Vector3().addVectors(startVec, endVec).multiplyScalar(0.5);
    const dir = new THREE.Vector3().subVectors(endVec, startVec);
    const len = dir.length();

    // Quaternion to rotate cylinder from Y-axis to bond direction
    const quat = new THREE.Quaternion();
    if (len > 1e-6) {
      const up = new THREE.Vector3(0, 1, 0);
      quat.setFromUnitVectors(up, dir.normalize());
    }

    return {
      position: [mid.x, mid.y, mid.z] as [number, number, number],
      quaternion: quat,
      length: len,
    };
  }, [start, end]);

  if (opacity <= 0 || length < 1e-6) return null;

  const radius = BOND_RADII[typeIdx] ?? 0.06;
  const color = BOND_COLORS[typeIdx] ?? '#666666';

  // For double/triple bonds, render multiple cylinders offset slightly
  if (typeIdx === 1) {
    // Double bond: two parallel cylinders
    return (
      <DoubleBond
        position={position}
        quaternion={quaternion}
        length={length}
        radius={radius}
        color={color}
        opacity={opacity}
        start={start}
        end={end}
      />
    );
  }

  if (typeIdx === 2) {
    // Triple bond: three parallel cylinders
    return (
      <TripleBond
        position={position}
        quaternion={quaternion}
        length={length}
        radius={radius}
        color={color}
        opacity={opacity}
        start={start}
        end={end}
      />
    );
  }

  // Single / aromatic / unknown: one cylinder
  return (
    <mesh
      ref={meshRef}
      position={position}
      quaternion={quaternion}
    >
      <cylinderGeometry args={[radius, radius, length, 8]} />
      <meshStandardMaterial
        color={color}
        metalness={0.0}
        roughness={0.6}
        transparent={opacity < 1}
        opacity={opacity}
        {...(dashed ? { wireframe: true } : {})}
      />
    </mesh>
  );
}

// ─── Multi-bond Components ───────────────────────────────────────────────────

interface MultiBondProps {
  position: [number, number, number];
  quaternion: THREE.Quaternion;
  length: number;
  radius: number;
  color: string;
  opacity: number;
  start: [number, number, number];
  end: [number, number, number];
}

function DoubleBond({ position, quaternion, length, radius, color, opacity, start, end }: MultiBondProps) {
  const offset = useMemo(() => {
    const dir = new THREE.Vector3(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    const perp = new THREE.Vector3(0, 0, 1).cross(dir).normalize().multiplyScalar(0.02);
    if (perp.length() < 1e-6) {
      perp.set(0.02, 0, 0);
    }
    return perp;
  }, [start, end]);

  return (
    <group>
      <mesh
        position={[position[0] + offset.x, position[1] + offset.y, position[2] + offset.z]}
        quaternion={quaternion}
      >
        <cylinderGeometry args={[radius, radius, length, 8]} />
        <meshStandardMaterial color={color} metalness={0} roughness={0.6} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      <mesh
        position={[position[0] - offset.x, position[1] - offset.y, position[2] - offset.z]}
        quaternion={quaternion}
      >
        <cylinderGeometry args={[radius, radius, length, 8]} />
        <meshStandardMaterial color={color} metalness={0} roughness={0.6} transparent={opacity < 1} opacity={opacity} />
      </mesh>
    </group>
  );
}

function TripleBond({ position, quaternion, length, radius, color, opacity, start, end }: MultiBondProps) {
  const offset = useMemo(() => {
    const dir = new THREE.Vector3(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    const perp = new THREE.Vector3(0, 0, 1).cross(dir).normalize().multiplyScalar(0.03);
    if (perp.length() < 1e-6) {
      perp.set(0.03, 0, 0);
    }
    return perp;
  }, [start, end]);

  return (
    <group>
      <mesh position={position} quaternion={quaternion}>
        <cylinderGeometry args={[radius, radius, length, 8]} />
        <meshStandardMaterial color={color} metalness={0} roughness={0.6} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      <mesh
        position={[position[0] + offset.x, position[1] + offset.y, position[2] + offset.z]}
        quaternion={quaternion}
      >
        <cylinderGeometry args={[radius, radius, length, 8]} />
        <meshStandardMaterial color={color} metalness={0} roughness={0.6} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      <mesh
        position={[position[0] - offset.x, position[1] - offset.y, position[2] - offset.z]}
        quaternion={quaternion}
      >
        <cylinderGeometry args={[radius, radius, length, 8]} />
        <meshStandardMaterial color={color} metalness={0} roughness={0.6} transparent={opacity < 1} opacity={opacity} />
      </mesh>
    </group>
  );
}
