/**
 * Node.js test script: Decode the same token sequences from Python verification
 * and compare results.
 *
 * Usage: node test_decode.mjs
 */
import { readFileSync } from 'fs';

// ─── Inline the token constants and decoder (Node.js compatible) ────────────

const HDTC = {
  SOS: 0, EOS: 1, PAD: 2,
  COMM_START: 3, COMM_END: 4,
  LEDGE: 5, REDGE: 6,
  SUPER_START: 7, SUPER_END: 8,
  TYPE_RING: 9, TYPE_FUNC: 10, TYPE_SINGLETON: 11,
  IDX_OFFSET: 12,
};

const ATOM_TYPES = ['C', 'N', 'O', 'F', 'P', 'S', 'Cl', 'Br', 'I'];
const BOND_TYPE_NAMES = ['SINGLE', 'DOUBLE', 'TRIPLE', 'AROMATIC'];

const TOKEN_TO_COMMUNITY_TYPE = {
  [HDTC.TYPE_RING]: 'ring',
  [HDTC.TYPE_FUNC]: 'functional',
  [HDTC.TYPE_SINGLETON]: 'singleton',
};

function createTokenizerConfig(vocabSize, labeledGraph, numAtomTypes = 10, numBondTypes = 5) {
  const maxNumNodes = labeledGraph
    ? vocabSize - HDTC.IDX_OFFSET - numAtomTypes - numBondTypes
    : vocabSize - HDTC.IDX_OFFSET;
  return {
    vocabSize, labeledGraph, maxNumNodes, numAtomTypes, numBondTypes,
    nodeIdxOffset: HDTC.IDX_OFFSET + maxNumNodes,
    edgeIdxOffset: HDTC.IDX_OFFSET + maxNumNodes + numAtomTypes,
  };
}

// ─── Decoder (copy of tokenizer.ts logic) ───────────────────────────────────

function parseCommunity(tokens, startIdx, config, allAtoms, allEdges, nodeFeatures, edgeFeatures) {
  let idx = startIdx;
  if (tokens[idx] !== HDTC.COMM_START) return { community: null, nextIdx: idx };
  idx++;

  if (idx >= tokens.length) return { community: null, nextIdx: idx };
  const typeToken = tokens[idx];
  const communityType = TOKEN_TO_COMMUNITY_TYPE[typeToken] ?? 'singleton';
  idx++;

  if (idx >= tokens.length || tokens[idx] < HDTC.IDX_OFFSET) return { community: null, nextIdx: idx };
  const communityId = tokens[idx] - HDTC.IDX_OFFSET;
  idx++;

  const atomIndices = [];
  const internalEdges = [];
  const commNodeFeatures = [];
  let currentAtom = null;

  while (idx < tokens.length && tokens[idx] !== HDTC.COMM_END) {
    const tok = tokens[idx];

    if (tok >= HDTC.IDX_OFFSET) {
      if (config.labeledGraph && tok >= config.edgeIdxOffset) {
        idx++;
      } else if (config.labeledGraph && tok >= config.nodeIdxOffset) {
        if (currentAtom !== null) {
          const atomType = tok - config.nodeIdxOffset;
          nodeFeatures.set(currentAtom, atomType);
          commNodeFeatures.push(atomType);
        }
        idx++;
      } else {
        const atomIdx = tok - HDTC.IDX_OFFSET;
        atomIndices.push(atomIdx);
        allAtoms.add(atomIdx);
        currentAtom = atomIdx;
        idx++;
      }
    } else if (tok === HDTC.LEDGE) {
      idx++;
      while (idx < tokens.length && tokens[idx] !== HDTC.REDGE) {
        const edgeTok = tokens[idx];
        if (edgeTok >= HDTC.IDX_OFFSET) {
          if (config.labeledGraph && edgeTok >= config.edgeIdxOffset) {
            idx++;
          } else if (config.labeledGraph && edgeTok >= config.nodeIdxOffset) {
            idx++;
          } else {
            const target = edgeTok - HDTC.IDX_OFFSET;
            if (currentAtom !== null) {
              internalEdges.push([currentAtom, target]);
              internalEdges.push([target, currentAtom]);
              allEdges.push([currentAtom, target]);
              allEdges.push([target, currentAtom]);
              idx++;
              if (config.labeledGraph) {
                if (idx < tokens.length && tokens[idx] >= config.edgeIdxOffset) {
                  const bondType = tokens[idx] - config.edgeIdxOffset;
                  edgeFeatures.set(`${currentAtom}-${target}`, bondType);
                  edgeFeatures.set(`${target}-${currentAtom}`, bondType);
                  idx++;
                }
              }
            } else {
              idx++;
            }
          }
        } else {
          idx++;
        }
      }
      idx++; // Skip REDGE
    } else {
      idx++;
    }
  }

  if (idx < tokens.length && tokens[idx] === HDTC.COMM_END) idx++;

  return {
    community: { id: communityId, type: communityType, atomIndices, internalEdges },
    nextIdx: idx,
  };
}

function parseSuperGraph(tokens, startIdx, config) {
  let idx = startIdx;
  if (tokens[idx] !== HDTC.SUPER_START) return { superEdges: [], nextIdx: idx };
  idx++;

  const superEdges = [];
  while (idx + 3 < tokens.length && tokens[idx] !== HDTC.SUPER_END) {
    if (tokens[idx] >= HDTC.IDX_OFFSET) {
      superEdges.push({
        sourceCommunity: tokens[idx] - HDTC.IDX_OFFSET,
        targetCommunity: tokens[idx + 1] - HDTC.IDX_OFFSET,
        sourceAtom: tokens[idx + 2] - HDTC.IDX_OFFSET,
        targetAtom: tokens[idx + 3] - HDTC.IDX_OFFSET,
      });
      idx += 4;
    } else {
      idx++;
    }
  }
  if (idx < tokens.length && tokens[idx] === HDTC.SUPER_END) idx++;
  return { superEdges, nextIdx: idx };
}

function decodeTokens(tokens, config) {
  const filtered = tokens.filter(t => t !== HDTC.SOS && t !== HDTC.EOS && t !== HDTC.PAD);
  if (filtered.length === 0) return { atoms: [], bonds: [], communities: [], superEdges: [] };

  const communities = [];
  const superEdges = [];
  const allAtoms = new Set();
  const allEdges = [];
  const nodeFeatures = new Map();
  const edgeFeatures = new Map();

  let idx = 0;
  while (idx < filtered.length) {
    const tok = filtered[idx];
    if (tok === HDTC.COMM_START) {
      const result = parseCommunity(filtered, idx, config, allAtoms, allEdges, nodeFeatures, edgeFeatures);
      if (result.community) communities.push(result.community);
      idx = result.nextIdx;
    } else if (tok === HDTC.SUPER_START) {
      const result = parseSuperGraph(filtered, idx, config);
      superEdges.push(...result.superEdges);
      for (const se of result.superEdges) {
        allAtoms.add(se.sourceAtom);
        allAtoms.add(se.targetAtom);
        allEdges.push([se.sourceAtom, se.targetAtom]);
        allEdges.push([se.targetAtom, se.sourceAtom]);
      }
      idx = result.nextIdx;
    } else {
      idx++;
    }
  }

  // Build atom-to-community mapping
  const atomToCommunity = new Map();
  for (const comm of communities) {
    for (const atomIdx of comm.atomIndices) {
      atomToCommunity.set(atomIdx, comm.id);
    }
  }

  // Build atoms array
  const numAtoms = allAtoms.size > 0 ? Math.max(...allAtoms) + 1 : 0;
  const atoms = [];
  for (let i = 0; i < numAtoms; i++) {
    if (!allAtoms.has(i)) continue;
    const typeIdx = nodeFeatures.get(i) ?? 0;
    const element = typeIdx < ATOM_TYPES.length ? ATOM_TYPES[typeIdx] : 'Unknown';
    atoms.push({ index: i, element, typeIdx, communityId: atomToCommunity.get(i) ?? -1 });
  }

  // Build bonds (deduplicate)
  const bondSet = new Set();
  const bonds = [];
  for (const [src, dst] of allEdges) {
    const key = src < dst ? `${src}-${dst}` : `${dst}-${src}`;
    if (bondSet.has(key)) continue;
    bondSet.add(key);
    const typeIdx = edgeFeatures.get(`${src}-${dst}`) ?? edgeFeatures.get(`${dst}-${src}`) ?? 0;
    const typeName = typeIdx < BOND_TYPE_NAMES.length ? BOND_TYPE_NAMES[typeIdx] : 'Unknown';
    bonds.push({ src: Math.min(src, dst), dst: Math.max(src, dst), typeIdx, typeName });
  }

  return { atoms, bonds, communities, superEdges, numAtoms: atoms.length };
}

// ─── Main test ──────────────────────────────────────────────────────────────

const config = createTokenizerConfig(127, true, 10, 5);
console.log('Tokenizer config:', config);

// Load token dump from Python verification
const tokenDump = JSON.parse(readFileSync('../verify_hdtc_tokens.json', 'utf-8'));

for (const entry of tokenDump) {
  console.log(`\n=== Molecule ${entry.id} (${entry.tokens.length} tokens) ===`);
  console.log(`Python SMILES: ${entry.smiles}`);

  const result = decodeTokens(entry.tokens, config);
  console.log(`TS decode: ${result.atoms.length} atoms, ${result.bonds.length} bonds, ${result.communities.length} communities, ${result.superEdges.length} super-edges`);

  // Show atom details
  if (result.atoms.length > 0) {
    const atomStr = result.atoms.slice(0, 15).map(a => `${a.element}(${a.index})`).join(' ');
    console.log(`  Atoms: ${atomStr}`);
  }

  // Show bond details
  if (result.bonds.length > 0) {
    const bondStr = result.bonds.slice(0, 10).map(b => `${b.src}-${b.dst}:${b.typeName}`).join(' ');
    console.log(`  Bonds: ${bondStr}`);
  }

  // Show communities
  for (const comm of result.communities) {
    console.log(`  Community ${comm.id} (${comm.type}): atoms=[${comm.atomIndices.join(',')}], internal_edges=${comm.internalEdges.length}`);
  }
}
