/**
 * 3D molecule viewer using React Three Fiber.
 *
 * Renders a complete molecule with:
 * - PBR atom spheres with CPK coloring
 * - Bond cylinders (single/double/triple/aromatic)
 * - Community hull overlays during animation
 * - SSAO post-processing for MuJoCo-quality aesthetic
 * - Interactive orbit controls
 */

import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import { EffectComposer, SSAO, SMAA } from '@react-three/postprocessing';

import Atom3D from './Atom3D';
import Bond3D from './Bond3D';
import CommunityHull from './CommunityHull';
import type { MoleculeData } from '../engine/types';
import type { AnimationState } from '../animation/phases';
import {
  getCommunityHullOpacity,
  getAtomScale,
  getAtomPositionFactor,
  getInternalBondOpacity,
  getSuperEdgeOpacity,
  getSSAOIntensity,
} from '../animation/phases';
import { centroid, lerp3 } from '../animation/spring';
import type { Vec3 } from '../animation/spring';

interface MoleculeViewer3DProps {
  molecule: MoleculeData;
  animState: AnimationState;
  /** Container width for canvas sizing. */
  width?: number;
  /** Container height for canvas sizing. */
  height?: number;
}

export default function MoleculeViewer3D({
  molecule,
  animState,
  width = 320,
  height = 280,
}: MoleculeViewer3DProps) {
  // Compute camera distance to fit the molecule (coordinates are in [-1.8, 1.8])
  const cameraZ = useMemo(() => {
    if (molecule.atoms.length === 0) return 5;
    let maxDist = 0;
    const cx = molecule.atoms.reduce((s, a) => s + a.x, 0) / molecule.atoms.length;
    const cy = molecule.atoms.reduce((s, a) => s + a.y, 0) / molecule.atoms.length;
    for (const atom of molecule.atoms) {
      const dx = atom.x - cx;
      const dy = atom.y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxDist) maxDist = d;
    }
    // Add padding and compute distance for fov=50
    const fovRad = (50 / 2) * (Math.PI / 180);
    const distance = (maxDist + 0.3) / Math.tan(fovRad);
    return Math.max(3, Math.min(distance, 15));
  }, [molecule]);

  return (
    <Canvas
      style={{ width, height }}
      camera={{ position: [0, 0, cameraZ], fov: 50 }}
      gl={{ antialias: true }}
    >
      <MoleculeScene molecule={molecule} animState={animState} />
      <OrbitControls enablePan={false} minDistance={1} maxDistance={20} />
    </Canvas>
  );
}

// ─── Scene Content ───────────────────────────────────────────────────────────

function MoleculeScene({
  molecule,
  animState,
}: {
  molecule: MoleculeData;
  animState: AnimationState;
}) {
  // Compute community centroids
  const communityCentroids = useMemo(() => {
    const centroids = new Map<number, Vec3>();
    for (const comm of molecule.communities) {
      const positions = comm.atomIndices
        .map((idx) => molecule.atoms.find((a) => a.index === idx))
        .filter((a): a is NonNullable<typeof a> => a !== undefined)
        .map((a) => ({ x: a.x, y: a.y, z: a.z }));
      centroids.set(comm.id, centroid(positions));
    }
    return centroids;
  }, [molecule]);

  // Atom index to position map
  const atomPositions = useMemo(() => {
    const map = new Map<number, Vec3>();
    for (const atom of molecule.atoms) {
      map.set(atom.index, { x: atom.x, y: atom.y, z: atom.z });
    }
    return map;
  }, [molecule]);

  // Center the molecule
  const moleculeCenter = useMemo(() => {
    if (molecule.atoms.length === 0) return { x: 0, y: 0, z: 0 };
    return centroid(molecule.atoms.map((a) => ({ x: a.x, y: a.y, z: a.z })));
  }, [molecule]);

  const hullOpacity = getCommunityHullOpacity(animState);
  const internalBondOpacity = getInternalBondOpacity(animState);
  const superEdgeOpacity = getSuperEdgeOpacity(animState);
  const ssaoIntensity = getSSAOIntensity(animState);

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 5, 5]} intensity={0.8} />
      <directionalLight position={[-3, -3, 2]} intensity={0.3} />
      <Environment preset="studio" />

      {/* Centered group */}
      <group position={[-moleculeCenter.x, -moleculeCenter.y, -moleculeCenter.z]}>
        {/* Community hulls (Phase 1) */}
        {molecule.communities.map((comm) => (
          <CommunityHull
            key={`hull-${comm.id}`}
            positions={comm.atomIndices
              .map((idx) => atomPositions.get(idx))
              .filter((p): p is Vec3 => p !== undefined)
              .map((p) => [p.x, p.y, p.z] as [number, number, number])}
            type={comm.type}
            opacity={hullOpacity}
          />
        ))}

        {/* Atoms */}
        {molecule.atoms.map((atom, i) => {
          const scale = getAtomScale(animState, i, molecule.atoms.length);
          const posFactor = getAtomPositionFactor(animState, i, molecule.atoms.length);

          const finalPos: Vec3 = { x: atom.x, y: atom.y, z: atom.z };
          const commCenter = communityCentroids.get(atom.communityId) ?? finalPos;
          const pos = lerp3(commCenter, finalPos, posFactor);

          return (
            <Atom3D
              key={`atom-${atom.index}`}
              position={[pos.x, pos.y, pos.z]}
              element={atom.element}
              scale={scale}
              opacity={scale > 0 ? 1 : 0}
            />
          );
        })}

        {/* Internal bonds */}
        {molecule.bonds.map((bond) => {
          // Check if this is an internal bond (both atoms in same community)
          const srcAtom = molecule.atoms.find((a) => a.index === bond.src);
          const dstAtom = molecule.atoms.find((a) => a.index === bond.dst);
          if (!srcAtom || !dstAtom) return null;

          const isSuperEdge = srcAtom.communityId !== dstAtom.communityId;
          const opacity = isSuperEdge ? superEdgeOpacity : internalBondOpacity;

          const srcPos = atomPositions.get(bond.src);
          const dstPos = atomPositions.get(bond.dst);
          if (!srcPos || !dstPos) return null;

          return (
            <Bond3D
              key={`bond-${bond.src}-${bond.dst}`}
              start={[srcPos.x, srcPos.y, srcPos.z]}
              end={[dstPos.x, dstPos.y, dstPos.z]}
              typeIdx={bond.typeIdx}
              opacity={opacity}
              dashed={isSuperEdge && animState.phase === 'community'}
            />
          );
        })}

        {/* Super-edge bonds (from super-graph, not internal bonds) */}
        {molecule.superEdges.map((se, i) => {
          const srcPos = atomPositions.get(se.sourceAtom);
          const dstPos = atomPositions.get(se.targetAtom);
          if (!srcPos || !dstPos) return null;

          // Check if this super-edge is already rendered as a bond
          const isBond = molecule.bonds.some(
            (b) =>
              (b.src === se.sourceAtom && b.dst === se.targetAtom) ||
              (b.src === se.targetAtom && b.dst === se.sourceAtom),
          );
          if (isBond) return null;

          return (
            <Bond3D
              key={`se-${i}`}
              start={[srcPos.x, srcPos.y, srcPos.z]}
              end={[dstPos.x, dstPos.y, dstPos.z]}
              typeIdx={0}
              opacity={superEdgeOpacity}
              dashed={animState.phase !== 'complete' && animState.phase !== 'polish'}
            />
          );
        })}
      </group>

      {/* Post-processing */}
      <EffectComposer>
        <SSAO
          intensity={ssaoIntensity * 6}
          radius={0.1}
          luminanceInfluence={0.4}
        />
        <SMAA />
      </EffectComposer>
    </>
  );
}
