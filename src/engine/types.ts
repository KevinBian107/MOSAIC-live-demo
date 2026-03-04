/** Shared TypeScript types for the MOSAIC live demo engine. */

/** Atom element types supported by MOSAIC (matching molecular.py ATOM_TYPES). */
export const ATOM_TYPES = ['C', 'N', 'O', 'F', 'P', 'S', 'Cl', 'Br', 'I'] as const;
export type AtomElement = (typeof ATOM_TYPES)[number] | 'Unknown';

/** Bond type names (matching molecular.py BOND_TYPES order). */
export const BOND_TYPE_NAMES = ['SINGLE', 'DOUBLE', 'TRIPLE', 'AROMATIC'] as const;
export type BondTypeName = (typeof BOND_TYPE_NAMES)[number] | 'Unknown';

export const NUM_ATOM_TYPES = ATOM_TYPES.length + 1; // +1 for unknown
export const NUM_BOND_TYPES = BOND_TYPE_NAMES.length + 1; // +1 for unknown

/** Community type from HDTC tokenizer. */
export type CommunityType = 'ring' | 'functional' | 'singleton';

/** Community type colors (from pipeline_overview.py). */
export const TYPE_COLORS: Record<CommunityType, string> = {
  ring: '#FF6B6B',
  functional: '#4ECDC4',
  singleton: '#95A5A6',
};

/** CPK-inspired element colors (from pipeline_overview.py). */
export const ELEMENT_COLORS: Record<string, string> = {
  C: '#404040',
  N: '#3050F8',
  O: '#FF0D0D',
  F: '#90E050',
  P: '#FF8000',
  S: '#FFFF30',
  Cl: '#1FF01F',
  Br: '#A62929',
  I: '#940094',
  Unknown: '#808080',
};

/** Element radii scaled for normalized coordinates (coord_scale=1.8). */
export const ELEMENT_RADII: Record<string, number> = {
  C: 0.07,
  N: 0.065,
  O: 0.06,
  F: 0.055,
  P: 0.08,
  S: 0.08,
  Cl: 0.07,
  Br: 0.08,
  I: 0.085,
  Unknown: 0.07,
};

/** A single atom in the molecule. */
export interface AtomInfo {
  index: number;
  element: AtomElement;
  typeIdx: number;
  x: number;
  y: number;
  z: number;
  communityId: number;
}

/** A bond between two atoms. */
export interface BondInfo {
  src: number;
  dst: number;
  typeIdx: number;
  typeName: BondTypeName;
}

/** A community (functional group / ring / singleton). */
export interface Community {
  id: number;
  type: CommunityType;
  atomIndices: number[];
  internalEdges: [number, number][];
  nodeFeatures?: number[];
}

/** A super-edge connecting two communities. */
export interface SuperEdge {
  sourceCommunity: number;
  targetCommunity: number;
  sourceAtom: number;
  targetAtom: number;
}

/** Complete molecule data for rendering. */
export interface MoleculeData {
  id: number;
  communities: Community[];
  superEdges: SuperEdge[];
  atoms: AtomInfo[];
  bonds: BondInfo[];
  smiles: string | null;
  isValid: boolean;
  tokens: number[];
  numAtoms: number;
}

/** Generation configuration. */
export interface GenerationConfig {
  numMolecules: number;
  topK: number;
  temperature: number;
  seed: number;
  maxLength: number;
}

/** Cached demo data format (from generate_demo_cache.py). */
export interface DemoCacheData {
  version: number;
  model: string;
  numMolecules: number;
  generationParams: {
    topK: number;
    temperature: number;
    seed: number;
  };
  molecules: CachedMolecule[];
}

/** A molecule from the pre-generated cache. */
export interface CachedMolecule {
  id: number;
  smiles: string;
  isValid: boolean;
  numAtoms: number;
  communities: Community[];
  superEdges: SuperEdge[];
  atoms: (Omit<AtomInfo, 'z' | 'communityId' | 'element'> & { element?: AtomElement })[];
  bonds: Omit<BondInfo, 'typeName'>[];
  tokens: number[];
  coords2D: [number, number][];
}

/** Model loading status. */
export type ModelStatus =
  | { stage: 'idle' }
  | { stage: 'loading'; progress: number; message: string }
  | { stage: 'ready' }
  | { stage: 'error'; error: string };

/** Generation status. */
export type GenerationStatus =
  | { stage: 'idle' }
  | { stage: 'generating'; current: number; total: number; tokensGenerated: number }
  | { stage: 'decoding' }
  | { stage: 'complete'; elapsed: number }
  | { stage: 'error'; error: string };
