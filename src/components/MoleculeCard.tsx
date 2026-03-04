/**
 * Single molecule card with 3D viewer and info.
 *
 * Displays the molecule's 3D structure with interactive orbit controls,
 * plus SMILES string, atom count, and community composition.
 */

import { useState, useEffect } from 'react';
import MoleculeViewer3D from './MoleculeViewer3D';
import MoleculeViewer2D from './MoleculeViewer2D';
import type { MoleculeData } from '../engine/types';
import { TYPE_COLORS } from '../engine/types';
import type { AnimationState } from '../animation/phases';
import { getAnimationState, getLabelOpacity } from '../animation/phases';

const ANIMATION_DURATION = 3000; // 3 seconds

interface MoleculeCardProps {
  molecule: MoleculeData;
  /** Delay before starting animation (for staggered grid). */
  delay?: number;
  /** Render mode: '2d' for RDKit SVG, '3d' for Three.js. */
  viewMode?: '2d' | '3d';
}

export default function MoleculeCard({ molecule, delay = 0, viewMode = '3d' }: MoleculeCardProps) {
  const [animState, setAnimState] = useState<AnimationState>(
    getAnimationState(0, ANIMATION_DURATION),
  );

  useEffect(() => {
    if (viewMode === '2d') return; // No animation needed for 2D
    const startTime = performance.now() + delay;
    let rafId: number;

    const animate = (now: number) => {
      const elapsed = now - startTime;
      setAnimState(getAnimationState(elapsed, ANIMATION_DURATION));

      if (elapsed < ANIMATION_DURATION) {
        rafId = requestAnimationFrame(animate);
      }
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [molecule, delay, viewMode]);

  const labelOpacity = viewMode === '2d' ? 1 : getLabelOpacity(animState);

  // Count community types
  const commCounts = molecule.communities.reduce(
    (acc, c) => {
      acc[c.type] = (acc[c.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden hover:border-[var(--border-hover)] transition-colors shadow-sm">
      {/* Molecule Viewer */}
      <div className="w-full aspect-[4/3] bg-[var(--bg-canvas)] flex items-center justify-center">
        {viewMode === '2d' ? (
          <MoleculeViewer2D molecule={molecule} />
        ) : (
          <MoleculeViewer3D
            molecule={molecule}
            animState={animState}
            width={320}
            height={240}
          />
        )}
      </div>

      {/* Info */}
      <div
        className="p-3 space-y-1.5 transition-opacity duration-300"
        style={{ opacity: Math.max(labelOpacity, 0.3) }}
      >
        {/* SMILES */}
        {molecule.smiles && (
          <p
            className="text-xs font-mono text-[var(--text-secondary)] truncate"
            title={molecule.smiles}
          >
            {molecule.smiles}
          </p>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
          <span>{molecule.numAtoms} atoms</span>
          <span>{molecule.bonds.length} bonds</span>

          {/* Community type badges (HDTC only - SENT has no communities) */}
          {molecule.communities.length > 0 && (
            <div className="flex gap-1 ml-auto">
              {commCounts['ring'] && (
                <Badge color={TYPE_COLORS.ring} label={`${commCounts['ring']} Ring`} />
              )}
              {commCounts['functional'] && (
                <Badge color={TYPE_COLORS.functional} label={`${commCounts['functional']} Func`} />
              )}
              {commCounts['singleton'] && (
                <Badge color={TYPE_COLORS.singleton} label={`${commCounts['singleton']} Sing`} />
              )}
            </div>
          )}
        </div>

        {/* Validity indicator */}
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              molecule.isValid ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span className="text-xs text-[var(--text-secondary)]">
            {molecule.isValid ? 'Valid' : 'Invalid'}
          </span>
        </div>
      </div>
    </div>
  );
}

function Badge({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-bold"
      style={{
        backgroundColor: `${color}20`,
        color: color,
        border: `1px solid ${color}40`,
      }}
    >
      {label}
    </span>
  );
}
