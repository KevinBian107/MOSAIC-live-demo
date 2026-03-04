/**
 * Responsive grid of molecule cards.
 *
 * Auto-fills columns based on container width.
 * Each card gets a staggered animation delay.
 */

import MoleculeCard from './MoleculeCard';
import type { MoleculeData, MoleculeGroup } from '../engine/types';

interface MoleculeGridProps {
  molecules: MoleculeData[];
  groups?: MoleculeGroup[];
  viewMode?: '2d' | '3d';
}

const STAGGER_DELAY = 150; // ms between each card's animation start

export default function MoleculeGrid({ molecules, groups, viewMode = '3d' }: MoleculeGridProps) {
  // Sweep mode: render grouped display
  if (groups && groups.length > 0) {
    let globalIndex = 0;
    return (
      <div className="flex flex-col gap-6">
        {groups.map((group, gi) => {
          const startIndex = globalIndex;
          globalIndex += group.molecules.length;
          return (
            <div key={`group-${gi}`}>
              {/* Divider with centered label */}
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-[var(--border)]" />
                <span className="px-3 py-1 text-xs font-semibold text-[var(--text-secondary)] bg-[var(--bg-canvas)] border border-[var(--border)] rounded-full whitespace-nowrap">
                  {group.label}
                </span>
                <div className="flex-1 h-px bg-[var(--border)]" />
              </div>
              {/* Molecule grid for this group */}
              <div className="grid gap-4" style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              }}>
                {group.molecules.map((mol, mi) => (
                  <MoleculeCard
                    key={`mol-${group.topK}-${group.temperature}-${mol.id}-${mi}`}
                    molecule={mol}
                    delay={(startIndex + mi) * STAGGER_DELAY}
                    viewMode={viewMode}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Single mode: flat list
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
