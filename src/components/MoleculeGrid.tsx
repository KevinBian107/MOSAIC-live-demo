/**
 * Responsive grid of molecule cards.
 *
 * Auto-fills columns based on container width.
 * Each card gets a staggered animation delay.
 */

import MoleculeCard from './MoleculeCard';
import type { MoleculeData } from '../engine/types';

interface MoleculeGridProps {
  molecules: MoleculeData[];
  viewMode?: '2d' | '3d';
}

const STAGGER_DELAY = 150; // ms between each card's animation start

export default function MoleculeGrid({ molecules, viewMode = '3d' }: MoleculeGridProps) {
  if (molecules.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--text-secondary)]">
        <p className="text-sm">
          Click "Generate Molecules" or "Demo" to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4" style={{
      gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    }}>
      {molecules.map((mol, i) => (
        <MoleculeCard
          key={`mol-${mol.id}-${i}`}
          molecule={mol}
          delay={i * STAGGER_DELAY}
          viewMode={viewMode}
        />
      ))}
    </div>
  );
}
