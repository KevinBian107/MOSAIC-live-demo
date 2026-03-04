/**
 * Simple 2D molecule viewer using RDKit SVG rendering.
 *
 * Renders a standard 2D chemical structure depiction.
 * Used for verification that decoding produces valid molecules.
 */

import { useMemo } from 'react';
import type { MoleculeData } from '../engine/types';
import { getMoleculeSvg } from '../engine/chemistry';

interface MoleculeViewer2DProps {
  molecule: MoleculeData;
  width?: number;
  height?: number;
}

export default function MoleculeViewer2D({
  molecule,
  width = 300,
  height = 250,
}: MoleculeViewer2DProps) {
  const svg = useMemo(
    () => getMoleculeSvg(molecule, width, height),
    [molecule, width, height],
  );

  if (!svg) {
    // Fallback: simple text representation
    return (
      <div className="flex flex-col items-center justify-center w-full h-full text-[var(--text-secondary)] text-xs gap-1">
        <span>{molecule.numAtoms} atoms, {molecule.bonds.length} bonds</span>
        <span>{molecule.communities.length} communities</span>
        {molecule.smiles && (
          <span className="font-mono text-[10px] max-w-full truncate px-2">
            {molecule.smiles}
          </span>
        )}
        {!molecule.isValid && <span className="text-red-400">Invalid structure</span>}
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-center w-full h-full bg-white"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
