/**
 * RDKit.js WASM wrapper for molecular validation and coordinate generation.
 *
 * Provides SMILES validation, 2D coordinate generation, and
 * atom/bond type mapping for the MOSAIC live demo.
 *
 * Port of src/data/molecular.py graph_to_smiles() logic.
 */

import type { AtomInfo, BondInfo, MoleculeData } from './types';
import { ATOM_TYPES, BOND_TYPE_NAMES, ELEMENT_COLORS } from './types';

// ─── RDKit.js Types ──────────────────────────────────────────────────────────

/** Minimal RDKit.js WASM module interface. */
interface RDKitModule {
  get_mol: (smiles: string) => RDKitMol | null;
  get_mol_from_molblock: (molblock: string) => RDKitMol | null;
  version: () => string;
}

interface RDKitMol {
  is_valid: () => boolean;
  get_smiles: () => string;
  get_molblock: () => string;
  get_new_coords: (useCoordGen?: boolean) => string;
  get_svg: (width?: number, height?: number) => string;
  get_svg_with_highlights: (details: string) => string;
  get_num_atoms: () => number;
  delete: () => void;
}

// ─── Module State ────────────────────────────────────────────────────────────

let rdkit: RDKitModule | null = null;
let loadingPromise: Promise<RDKitModule> | null = null;

/**
 * Initialize the RDKit WASM module.
 * Safe to call multiple times - will return cached instance.
 */
export async function initRDKit(): Promise<RDKitModule> {
  if (rdkit) return rdkit;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    // @rdkit/rdkit exposes initRDKitModule globally when loaded
    const { default: initRDKitModule } = await import('@rdkit/rdkit');
    rdkit = await (initRDKitModule as () => Promise<RDKitModule>)();
    return rdkit;
  })();

  return loadingPromise;
}

/**
 * Check if RDKit is initialized.
 */
export function isRDKitReady(): boolean {
  return rdkit !== null;
}

// ─── Bond Type Mapping ──────────────────────────────────────────────────────

/** RDKit bond type strings in the mol block. */
const BOND_TYPE_TO_MOLBLOCK: Record<number, number> = {
  0: 1, // SINGLE
  1: 2, // DOUBLE
  2: 3, // TRIPLE
  3: 4, // AROMATIC
  4: 1, // Unknown -> SINGLE
};

// ─── SMILES Reconstruction ──────────────────────────────────────────────────

/**
 * Reconstruct a molecule from atom/bond data and attempt SMILES generation.
 *
 * Port of graph_to_smiles() from src/data/molecular.py.
 * Builds an RDKit molecule from atoms and bonds, sanitizes, and returns SMILES.
 *
 * @param molecule - MoleculeData with atoms and bonds.
 * @returns Updated molecule with SMILES and validity status.
 */
export function validateAndEnrich(molecule: MoleculeData): MoleculeData {
  if (!rdkit) {
    console.warn('[MOSAIC] RDKit not ready, using fallback layout');
    return computeFallbackLayout({ ...molecule, smiles: null, isValid: false });
  }

  if (molecule.atoms.length === 0) {
    return { ...molecule, smiles: null, isValid: false };
  }

  try {
    // Build mol block from atoms and bonds
    const molblock = buildMolBlock(molecule.atoms, molecule.bonds);
    const mol = rdkit.get_mol_from_molblock(molblock);

    if (!mol || !mol.is_valid()) {
      mol?.delete();
      console.warn(`[MOSAIC] RDKit validation failed (${molecule.atoms.length} atoms, ${molecule.bonds.length} bonds), using fallback layout`);
      return computeFallbackLayout({ ...molecule, smiles: null, isValid: false });
    }

    const smiles = mol.get_smiles();

    // Generate 2D coordinates
    const coordMolblock = mol.get_new_coords();
    const coords = parseMolBlockCoords(coordMolblock);

    mol.delete();

    // Normalize coordinates to a compact range (matching pipeline_overview.py coord_scale)
    const normalizedCoords = normalizeCoordinates(coords, 1.8);

    // Update atom positions with normalized 2D coordinates
    const updatedAtoms = molecule.atoms.map((atom, i) => ({
      ...atom,
      x: normalizedCoords[i]?.[0] ?? 0,
      y: normalizedCoords[i]?.[1] ?? 0,
      z: 0,
    }));

    let result: MoleculeData = {
      ...molecule,
      atoms: updatedAtoms,
      smiles,
      isValid: true,
    };

    // Safety check: if RDKit returned degenerate coordinates, use fallback
    if (hasDegenrateLayout(result)) {
      console.warn('[MOSAIC] RDKit returned degenerate coordinates, using fallback layout');
      result = computeFallbackLayout(result);
    }

    return result;
  } catch (err) {
    console.warn('[MOSAIC] validateAndEnrich error, using fallback layout:', err);
    return computeFallbackLayout({ ...molecule, smiles: null, isValid: false });
  }
}

/**
 * Validate a SMILES string and return canonical form.
 */
export function validateSmiles(smiles: string): string | null {
  if (!rdkit) return null;

  try {
    const mol = rdkit.get_mol(smiles);
    if (!mol || !mol.is_valid()) {
      mol?.delete();
      return null;
    }
    const canonical = mol.get_smiles();
    mol.delete();
    return canonical;
  } catch {
    return null;
  }
}

/**
 * Generate 2D coordinates for a valid molecule.
 */
export function generate2DCoords(molecule: MoleculeData): MoleculeData {
  if (!rdkit || !molecule.smiles) return molecule;

  try {
    const mol = rdkit.get_mol(molecule.smiles);
    if (!mol) return molecule;

    const molblock = mol.get_new_coords();
    const coords = parseMolBlockCoords(molblock);
    mol.delete();

    const normalizedCoords = normalizeCoordinates(coords, 1.8);

    const updatedAtoms = molecule.atoms.map((atom, i) => ({
      ...atom,
      x: normalizedCoords[i]?.[0] ?? atom.x,
      y: normalizedCoords[i]?.[1] ?? atom.y,
    }));

    return { ...molecule, atoms: updatedAtoms };
  } catch {
    return molecule;
  }
}

// ─── Mol Block Construction ─────────────────────────────────────────────────

/**
 * Build a V2000 mol block from atom/bond arrays.
 *
 * This is used when we need to go from decoded token structure
 * (atom types + bond adjacency) to an RDKit molecule for SMILES.
 */
function buildMolBlock(atoms: AtomInfo[], bonds: BondInfo[]): string {
  const numAtoms = atoms.length;

  // Build index mapping (atom indices may not be contiguous)
  const idxMap = new Map<number, number>();
  atoms.forEach((atom, i) => idxMap.set(atom.index, i));

  // Pre-filter bonds to only those with valid atom references
  // This ensures the counts line matches the actual bond block
  const validBonds = bonds.filter(
    (b) => idxMap.has(b.src) && idxMap.has(b.dst),
  );
  const numBonds = validBonds.length;

  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push('     RDKit          ');
  lines.push('');

  // Counts line
  lines.push(
    `${pad(numAtoms, 3)}${pad(numBonds, 3)}  0  0  0  0  0  0  0  0999 V2000`,
  );

  // Atom block
  for (const atom of atoms) {
    const symbol = atom.element === 'Unknown' ? 'C' : atom.element;
    lines.push(
      `    0.0000    0.0000    0.0000 ${padRight(symbol, 3)} 0  0  0  0  0  0  0  0  0  0  0  0`,
    );
  }

  // Bond block
  for (const bond of validBonds) {
    const src = idxMap.get(bond.src)!;
    const dst = idxMap.get(bond.dst)!;
    const molBondType = BOND_TYPE_TO_MOLBLOCK[bond.typeIdx] ?? 1;
    lines.push(
      `${pad(src + 1, 3)}${pad(dst + 1, 3)}${pad(molBondType, 3)}  0`,
    );
  }

  lines.push('M  END');

  return lines.join('\n');
}

/**
 * Parse 2D coordinates from a V2000 mol block.
 */
function parseMolBlockCoords(molblock: string): [number, number][] {
  const lines = molblock.split('\n');
  const coords: [number, number][] = [];

  // Find counts line (line 3, 0-indexed)
  if (lines.length < 4) return coords;

  const countsLine = lines[3]!;
  const numAtoms = parseInt(countsLine.substring(0, 3).trim(), 10);
  if (isNaN(numAtoms)) return coords;

  // Parse atom block (starts at line 4)
  for (let i = 4; i < 4 + numAtoms && i < lines.length; i++) {
    const line = lines[i]!;
    const x = parseFloat(line.substring(0, 10).trim());
    const y = parseFloat(line.substring(10, 20).trim());
    if (!isNaN(x) && !isNaN(y)) {
      coords.push([x, y]);
    }
  }

  return coords;
}

// ─── Coordinate Normalization ────────────────────────────────────────────────

/**
 * Normalize 2D coordinates to a fixed range centered at origin.
 *
 * Matches pipeline_overview.py's compact layout: coordinates are scaled
 * so the molecule fits within [-coordScale, coordScale] in the larger axis.
 *
 * @param coords - Raw coordinates from RDKit.
 * @param coordScale - Target half-range (default 1.8 matches pipeline_overview.py).
 * @returns Normalized coordinates centered at origin.
 */
export function normalizeCoordinates(
  coords: [number, number][],
  coordScale = 1.8,
): [number, number][] {
  if (coords.length === 0) return [];
  if (coords.length === 1) return [[0, 0]];

  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xRange = xMax - xMin;
  const yRange = yMax - yMin;
  const scale = Math.max(xRange, yRange, 1e-6);
  const xCenter = (xMax + xMin) / 2;
  const yCenter = (yMax + yMin) / 2;

  return coords.map(([x, y]) => [
    ((x - xCenter) / scale) * coordScale,
    ((y - yCenter) / scale) * coordScale,
  ]);
}

/**
 * Normalize a molecule's atom coordinates to the compact range.
 */
export function normalizeMoleculeLayout(molecule: MoleculeData): MoleculeData {
  if (molecule.atoms.length <= 1) return molecule;
  const coords: [number, number][] = molecule.atoms.map((a) => [a.x, a.y]);
  const normalized = normalizeCoordinates(coords, 1.8);
  const updatedAtoms = molecule.atoms.map((atom, i) => ({
    ...atom,
    x: normalized[i]![0],
    y: normalized[i]![1],
  }));
  return { ...molecule, atoms: updatedAtoms };
}

// ─── String Utilities ────────────────────────────────────────────────────────

function pad(n: number, width: number): string {
  return n.toString().padStart(width);
}

function padRight(s: string, width: number): string {
  return s.padEnd(width);
}

// ─── Fallback Graph Layout ───────────────────────────────────────────────────

/**
 * Compute a fallback 2D layout when RDKit validation fails.
 *
 * Uses a community-aware approach:
 * 1. Place each community at a position on a circle
 * 2. Arrange atoms within each community on a smaller circle
 * 3. Refine with a few iterations of force-directed simulation
 *
 * This ensures molecules are always visible even when chemically invalid.
 */
export function computeFallbackLayout(molecule: MoleculeData): MoleculeData {
  if (molecule.atoms.length === 0) return molecule;

  // Single atom - just center it
  if (molecule.atoms.length === 1) {
    return {
      ...molecule,
      atoms: [{ ...molecule.atoms[0]!, x: 0, y: 0, z: 0 }],
    };
  }

  // Group atoms by community
  const communityAtoms = new Map<number, number[]>();
  for (const atom of molecule.atoms) {
    const commId = atom.communityId;
    if (!communityAtoms.has(commId)) {
      communityAtoms.set(commId, []);
    }
    communityAtoms.get(commId)!.push(atom.index);
  }

  const numCommunities = communityAtoms.size;
  const communityRadius = numCommunities > 1 ? 1.5 + numCommunities * 0.3 : 0;

  // Position communities on a circle
  const commCenters = new Map<number, { x: number; y: number }>();
  let commIdx = 0;
  for (const [commId] of communityAtoms) {
    const angle = (2 * Math.PI * commIdx) / numCommunities - Math.PI / 2;
    commCenters.set(commId, {
      x: communityRadius * Math.cos(angle),
      y: communityRadius * Math.sin(angle),
    });
    commIdx++;
  }

  // Position atoms within each community on smaller circles
  const positions = new Map<number, { x: number; y: number }>();
  for (const [commId, atomIndices] of communityAtoms) {
    const center = commCenters.get(commId)!;
    const n = atomIndices.length;
    const innerRadius = n > 1 ? Math.max(0.5, n * 0.2) : 0;

    for (let i = 0; i < n; i++) {
      const angle = (2 * Math.PI * i) / n;
      positions.set(atomIndices[i]!, {
        x: center.x + innerRadius * Math.cos(angle),
        y: center.y + innerRadius * Math.sin(angle),
      });
    }
  }

  // Refine with force-directed iterations
  forceDirectedRefine(positions, molecule.bonds, 80);

  // Normalize to compact range matching RDKit-derived coordinates
  const coordScale = 1.8;
  const rawCoords: [number, number][] = [];
  const indexOrder: number[] = [];
  for (const [idx, p] of positions) {
    indexOrder.push(idx);
    rawCoords.push([p.x, p.y]);
  }
  const normCoords = normalizeCoordinates(rawCoords, coordScale);
  for (let i = 0; i < indexOrder.length; i++) {
    const p = positions.get(indexOrder[i]!)!;
    p.x = normCoords[i]![0];
    p.y = normCoords[i]![1];
  }

  // Update atoms with computed positions
  const updatedAtoms = molecule.atoms.map((atom) => {
    const pos = positions.get(atom.index);
    return {
      ...atom,
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
      z: 0,
    };
  });

  return { ...molecule, atoms: updatedAtoms };
}

/**
 * Simple force-directed layout refinement.
 *
 * Applies repulsive forces between all atom pairs and
 * attractive spring forces along bonds to produce a
 * readable graph layout.
 */
function forceDirectedRefine(
  positions: Map<number, { x: number; y: number }>,
  bonds: BondInfo[],
  iterations: number,
): void {
  const idealBondLength = 1.2;
  const repulsionStrength = 1.5;
  const dt = 0.03;

  const indices = [...positions.keys()];

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsive forces between all pairs
    for (let a = 0; a < indices.length; a++) {
      const pi = positions.get(indices[a]!)!;
      for (let b = a + 1; b < indices.length; b++) {
        const pj = positions.get(indices[b]!)!;
        const dx = pi.x - pj.x;
        const dy = pi.y - pj.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const force = repulsionStrength / (dist * dist);
        const fx = (force * dx) / dist;
        const fy = (force * dy) / dist;
        pi.x += fx * dt;
        pi.y += fy * dt;
        pj.x -= fx * dt;
        pj.y -= fy * dt;
      }
    }

    // Attractive forces along bonds
    for (const bond of bonds) {
      const pi = positions.get(bond.src);
      const pj = positions.get(bond.dst);
      if (!pi || !pj) continue;
      const dx = pj.x - pi.x;
      const dy = pj.y - pi.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const force = 0.5 * (dist - idealBondLength);
      const fx = (force * dx) / dist;
      const fy = (force * dy) / dist;
      pi.x += fx * dt;
      pi.y += fy * dt;
      pj.x -= fx * dt;
      pj.y -= fy * dt;
    }
  }
}

/**
 * Check if all atoms in a molecule are at the same position (degenerate layout).
 */
export function hasDegenrateLayout(molecule: MoleculeData): boolean {
  if (molecule.atoms.length <= 1) return false;
  const first = molecule.atoms[0]!;
  return molecule.atoms.every(
    (a) => Math.abs(a.x - first.x) < 0.001 && Math.abs(a.y - first.y) < 0.001,
  );
}

// ─── SVG Rendering ──────────────────────────────────────────────────────────

/**
 * Generate an SVG depiction of a molecule.
 *
 * Uses RDKit's built-in 2D depiction engine.
 * Falls back to building from SMILES or mol block.
 *
 * @param molecule - MoleculeData with atoms and bonds.
 * @param width - SVG width in pixels.
 * @param height - SVG height in pixels.
 * @returns SVG string or null if rendering fails.
 */
export function getMoleculeSvg(
  molecule: MoleculeData,
  width = 300,
  height = 250,
): string | null {
  if (molecule.atoms.length === 0) return null;

  // Try RDKit rendering first
  if (rdkit) {
    try {
      // Try from SMILES first (cleaner depiction)
      if (molecule.smiles) {
        const mol = rdkit.get_mol(molecule.smiles);
        if (mol && mol.is_valid()) {
          const svg = mol.get_svg(width, height);
          mol.delete();
          return svg;
        }
        mol?.delete();
      }

      // Fall back to mol block (only if it produces a valid molecule)
      const molblock = buildMolBlock(molecule.atoms, molecule.bonds);
      const mol = rdkit.get_mol_from_molblock(molblock);
      if (mol && mol.is_valid()) {
        const svg = mol.get_svg(width, height);
        mol.delete();
        return svg;
      }
      mol?.delete();
    } catch {
      // Fall through to custom renderer
    }
  }

  // Custom SVG fallback: render from decoded atom coordinates and bonds
  // This ensures all molecules get a visual representation, even invalid ones
  return renderFallbackSvg(molecule, width, height);
}

// ─── Custom SVG Fallback Renderer ─────────────────────────────────────────

/**
 * Render a molecule as SVG using atom coordinates and bonds directly.
 *
 * Used when RDKit validation/rendering fails (e.g., invalid valence).
 * Draws all decoded bonds and atoms without chemical sanitization,
 * so the user can see the full structure the model generated.
 */
function renderFallbackSvg(
  molecule: MoleculeData,
  width: number,
  height: number,
): string {
  if (molecule.atoms.length === 0) return '';

  const padding = 30;
  const w = width - 2 * padding;
  const h = height - 2 * padding;

  // Build position lookup
  const posMap = new Map<number, { x: number; y: number }>();
  for (const atom of molecule.atoms) {
    posMap.set(atom.index, { x: atom.x, y: atom.y });
  }

  // Compute coordinate bounds
  const xs = molecule.atoms.map((a) => a.x);
  const ys = molecule.atoms.map((a) => a.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const scale = Math.min(w / xRange, h / yRange);
  const xCenter = (xMax + xMin) / 2;
  const yCenter = (yMax + yMin) / 2;

  const toSvg = (x: number, y: number): [number, number] => [
    width / 2 + (x - xCenter) * scale,
    height / 2 - (y - yCenter) * scale,
  ];

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
  );
  parts.push(`<rect width="${width}" height="${height}" fill="white"/>`);

  // Draw bonds
  for (const bond of molecule.bonds) {
    const src = posMap.get(bond.src);
    const dst = posMap.get(bond.dst);
    if (!src || !dst) continue;

    const [x1, y1] = toSvg(src.x, src.y);
    const [x2, y2] = toSvg(dst.x, dst.y);
    const color = '#555';

    if (bond.typeIdx === 1) {
      // Double bond
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const off = 2;
      const nx = (-dy / len) * off;
      const ny = (dx / len) * off;
      parts.push(
        `<line x1="${x1 + nx}" y1="${y1 + ny}" x2="${x2 + nx}" y2="${y2 + ny}" stroke="${color}" stroke-width="1.5"/>`,
      );
      parts.push(
        `<line x1="${x1 - nx}" y1="${y1 - ny}" x2="${x2 - nx}" y2="${y2 - ny}" stroke="${color}" stroke-width="1.5"/>`,
      );
    } else if (bond.typeIdx === 2) {
      // Triple bond
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const off = 2.5;
      const nx = (-dy / len) * off;
      const ny = (dx / len) * off;
      parts.push(
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5"/>`,
      );
      parts.push(
        `<line x1="${x1 + nx}" y1="${y1 + ny}" x2="${x2 + nx}" y2="${y2 + ny}" stroke="${color}" stroke-width="1"/>`,
      );
      parts.push(
        `<line x1="${x1 - nx}" y1="${y1 - ny}" x2="${x2 - nx}" y2="${y2 - ny}" stroke="${color}" stroke-width="1"/>`,
      );
    } else if (bond.typeIdx === 3) {
      // Aromatic
      parts.push(
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" stroke-dasharray="4,2"/>`,
      );
    } else {
      // Single bond
      parts.push(
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2"/>`,
      );
    }
  }

  // Draw atoms (with white background to cover bond lines)
  const r = Math.max(5, Math.min(8, 120 / molecule.atoms.length));
  for (const atom of molecule.atoms) {
    const [cx, cy] = toSvg(atom.x, atom.y);
    const color = ELEMENT_COLORS[atom.element] ?? ELEMENT_COLORS['Unknown']!;

    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r + 1}" fill="white"/>`);
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="0.9"/>`,
    );

    // Label non-carbon atoms
    if (atom.element !== 'C') {
      const fontSize = Math.max(7, r);
      parts.push(
        `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}" font-family="Arial,sans-serif" fill="white" font-weight="bold">${atom.element}</text>`,
      );
    }
  }

  parts.push('</svg>');
  return parts.join('\n');
}

// ─── Alternative: Build SMILES Directly ─────────────────────────────────────

/**
 * Build a SMILES string directly from atom types and bond adjacency.
 *
 * This is a simpler approach than mol block construction, but less robust.
 * Used as fallback when mol block approach fails.
 *
 * Uses RDKit to validate the constructed molecule.
 */
export function buildSmilesFromGraph(
  atomTypeIndices: number[],
  bonds: { src: number; dst: number; typeIdx: number }[],
): string | null {
  if (!rdkit || atomTypeIndices.length === 0) return null;

  try {
    // Build mol block and let RDKit parse it
    const atoms: AtomInfo[] = atomTypeIndices.map((typeIdx, i) => ({
      index: i,
      element: (typeIdx < ATOM_TYPES.length ? ATOM_TYPES[typeIdx] : 'C') as AtomInfo['element'],
      typeIdx,
      x: 0, y: 0, z: 0,
      communityId: -1,
    }));

    const bondInfos: BondInfo[] = bonds.map((b) => ({
      src: b.src,
      dst: b.dst,
      typeIdx: b.typeIdx,
      typeName: (b.typeIdx < BOND_TYPE_NAMES.length
        ? BOND_TYPE_NAMES[b.typeIdx]
        : 'SINGLE') as BondInfo['typeName'],
    }));

    const molblock = buildMolBlock(atoms, bondInfos);
    const mol = rdkit.get_mol_from_molblock(molblock);

    if (!mol || !mol.is_valid()) {
      mol?.delete();
      return null;
    }

    const smiles = mol.get_smiles();
    mol.delete();
    return smiles;
  } catch {
    return null;
  }
}
