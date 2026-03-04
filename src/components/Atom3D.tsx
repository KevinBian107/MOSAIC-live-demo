/**
 * 3D atom sphere with PBR material.
 *
 * Renders a single atom as a shiny CPK-colored sphere with
 * MuJoCo-quality physically-based materials.
 */

import { useRef } from 'react';
import type { Mesh } from 'three';
import { ELEMENT_COLORS, ELEMENT_RADII } from '../engine/types';
import type { AtomElement } from '../engine/types';

interface Atom3DProps {
  position: [number, number, number];
  element: AtomElement;
  scale?: number;
  opacity?: number;
}

export default function Atom3D({ position, element, scale = 1, opacity = 1 }: Atom3DProps) {
  const meshRef = useRef<Mesh>(null);
  const color = ELEMENT_COLORS[element] ?? ELEMENT_COLORS['Unknown']!;
  const radius = (ELEMENT_RADII[element] ?? 0.3) * scale;

  if (opacity <= 0) return null;

  return (
    <mesh ref={meshRef} position={position}>
      <sphereGeometry args={[radius, 32, 32]} />
      <meshPhysicalMaterial
        color={color}
        metalness={0.1}
        roughness={0.25}
        clearcoat={0.8}
        clearcoatRoughness={0.2}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  );
}
