/**
 * MOSAIC Live Demo - Main application.
 *
 * Wires together model inference, tokenizer decoding, RDKit validation,
 * and 3D molecule rendering into a single-page interactive demo.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import GenerationControls from './components/GenerationControls';
import ProgressBar from './components/ProgressBar';
import MoleculeGrid from './components/MoleculeGrid';

import { MosaicModel } from './engine/model';
import type { GenerationTokenIds } from './engine/model';
import { createTokenizerConfig, decodeTokens, tokenToString } from './engine/tokenizer';
import { createSentTokenizerConfig, decodeSentTokens, sentTokenToString } from './engine/sent-tokenizer';
import type { TokenizerConfig } from './engine/tokenizer';
import { initRDKit, validateAndEnrich, computeFallbackLayout, hasDegenrateLayout, normalizeMoleculeLayout } from './engine/chemistry';
import type {
  MoleculeData,
  ModelStatus,
  GenerationStatus,
  GenerationConfig,
  DemoCacheData,
  CachedMolecule,
  TokenizerType,
} from './engine/types';
import { ATOM_TYPES, BOND_TYPE_NAMES } from './engine/types';

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL;

/** Per-tokenizer model configuration. */
const MODEL_CONFIGS: Record<TokenizerType, {
  modelPath: string;
  demoCachePath: string;
  testTokensPath: string;
  tokenizerConfigPath: string;
  defaultConfig: TokenizerConfig;
  label: string;
  description: string;
}> = {
  hdtc: {
    modelPath: `${BASE}models/hdtc_coconut`,
    demoCachePath: `${BASE}data/demo_cache.json`,
    testTokensPath: `${BASE}data/test_tokens.json`,
    tokenizerConfigPath: `${BASE}models/hdtc_coconut/tokenizer_config.json`,
    defaultConfig: createTokenizerConfig(127, true, 10, 5),
    label: 'HDTC',
    description: 'using HDTC (Hierarchical Direct Tree with Communities) — a tokenization that preserves the molecule\'s hierarchical structure: rings, functional groups, and their connections.',
  },
  sent: {
    modelPath: `${BASE}models/sent_coconut`,
    demoCachePath: `${BASE}data/sent_demo_cache.json`,
    testTokensPath: `${BASE}data/sent_test_tokens.json`,
    tokenizerConfigPath: `${BASE}models/sent_coconut/tokenizer_config.json`,
    defaultConfig: createSentTokenizerConfig(121, true, 10, 5),
    label: 'SENT',
    description: 'using SENT (Sequential Edge-indicating Neighborhood Traversal) — a flat walk-based tokenization that encodes molecules as sequential node visits with back-edge brackets.',
  },
};

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [modelStatus, setModelStatus] = useState<ModelStatus>({ stage: 'idle' });
  const [genStatus, setGenStatus] = useState<GenerationStatus>({ stage: 'idle' });
  const [molecules, setMolecules] = useState<MoleculeData[]>([]);
  const [rdkitReady, setRdkitReady] = useState(false);
  const [tokenizerType, setTokenizerType] = useState<TokenizerType>('hdtc');
  const [tokenizerConfig, setTokenizerConfig] = useState<TokenizerConfig>(MODEL_CONFIGS.hdtc.defaultConfig);
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d'); // Default to 2D for verification

  const modelRef = useRef<MosaicModel | null>(null);
  const loadedModelType = useRef<TokenizerType | null>(null);

  // ─── Initialize RDKit on mount ───────────────────────────────────────────

  useEffect(() => {
    initRDKit()
      .then(() => setRdkitReady(true))
      .catch((err) => console.warn('RDKit init failed:', err));
  }, []);

  // ─── Model instance (lazy-loaded when user clicks Generate) ───────────────

  useEffect(() => {
    return () => {
      modelRef.current?.dispose();
    };
  }, []);

  const loadModel = useCallback(async (type: TokenizerType) => {
    // If we already have the right model loaded, skip
    if (modelRef.current?.isReady && loadedModelType.current === type) return;

    // Dispose previous model if switching types
    if (modelRef.current && loadedModelType.current !== type) {
      modelRef.current.dispose();
      modelRef.current = null;
      loadedModelType.current = null;
    }

    const model = new MosaicModel();
    modelRef.current = model;
    model.setStatusCallback(setModelStatus);

    await model.load(MODEL_CONFIGS[type].modelPath, { quantized: false });
    loadedModelType.current = type;
  }, []);

  // ─── Load tokenizer config (re-fetches when tokenizer type changes) ─────

  useEffect(() => {
    const cfg = MODEL_CONFIGS[tokenizerType];
    fetch(cfg.tokenizerConfigPath)
      .then((r) => r.json())
      .then((config: Record<string, unknown>) => {
        const factory = tokenizerType === 'sent' ? createSentTokenizerConfig : createTokenizerConfig;
        const newConfig = factory(
          config['vocab_size'] as number,
          config['labeled_graph'] as boolean,
          config['num_atom_types'] as number,
          config['num_bond_types'] as number,
        );
        console.log(`[MOSAIC] ${tokenizerType.toUpperCase()} tokenizer config loaded:`, newConfig);
        setTokenizerConfig(newConfig);
      })
      .catch(() => {
        // Use default config for this type
        setTokenizerConfig(cfg.defaultConfig);
      });
  }, [tokenizerType]);

  // ─── Tokenizer Type Switcher ─────────────────────────────────────────────

  const handleTypeChange = useCallback((type: TokenizerType) => {
    if (type === tokenizerType) return;
    // Reset state when switching
    setMolecules([]);
    setGenStatus({ stage: 'idle' });
    setModelStatus({ stage: 'idle' });
    setTokenizerType(type);
  }, [tokenizerType]);

  // ─── Generation Handler ──────────────────────────────────────────────────

  const handleGenerate = useCallback(
    async (config: GenerationConfig) => {
      try {
        await loadModel(tokenizerType);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setGenStatus({ stage: 'error', error: `Model load failed: ${msg}. Use the Demo button instead.` });
        return;
      }

      const model = modelRef.current;
      if (!model?.isReady) return;

      const startTime = performance.now();
      let totalTokens = 0;

      const tokenIds: GenerationTokenIds = {
        sos: tokenizerConfig.sosTokenId,
        eos: tokenizerConfig.eosTokenId,
        pad: tokenizerConfig.padTokenId,
      };

      setGenStatus({ stage: 'generating', current: 0, total: config.numMolecules, tokensGenerated: 0 });
      setMolecules([]);

      try {
        const results = await model.generateBatch(
          config,
          tokenIds,
          (index, _result) => {
            setGenStatus({
              stage: 'generating',
              current: index,
              total: config.numMolecules,
              tokensGenerated: totalTokens,
            });
          },
          (_molIdx, _token, _pos) => {
            totalTokens++;
          },
        );

        // Decode and validate
        setGenStatus({ stage: 'decoding' });

        const decoded: MoleculeData[] = results.map((result, i) => {
          // ── Token-level diagnostic ──────────────────────────────────
          const toks = result.tokens;
          const toStr = tokenizerType === 'sent' ? sentTokenToString : tokenToString;
          const readable = toks.slice(0, 60).map((t) => toStr(t, tokenizerConfig)).join(' ');
          console.log(`[MOSAIC] ── Molecule ${i} (${tokenizerType.toUpperCase()}) ──`);
          console.log(`[MOSAIC]   Total tokens: ${toks.length}`);
          console.log(`[MOSAIC]   First 60 tokens: ${readable}`);

          // ── Decode (dispatch by tokenizer type) ─────────────────────
          let mol = tokenizerType === 'sent'
            ? decodeSentTokens(toks, tokenizerConfig, i)
            : decodeTokens(toks, tokenizerConfig, i);

          console.log(`[MOSAIC]   Decoded: ${mol.atoms.length} atoms, ${mol.bonds.length} bonds, ${mol.communities.length} communities`);

          // Validate and get coordinates via RDKit
          if (rdkitReady) {
            mol = validateAndEnrich(mol);
          } else {
            mol = computeFallbackLayout(mol);
          }

          // Final safety: ensure atoms have non-degenerate positions
          if (mol.atoms.length > 1 && hasDegenrateLayout(mol)) {
            mol = computeFallbackLayout(mol);
          }

          mol.tokens = toks;
          return mol;
        });

        setMolecules(decoded);
        setGenStatus({ stage: 'complete', elapsed: performance.now() - startTime });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setGenStatus({ stage: 'error', error: msg });
      }
    },
    [tokenizerType, tokenizerConfig, rdkitReady, loadModel],
  );

  // ─── Fallback: Load pre-generated cache ──────────────────────────────────

  const handleLoadFallback = useCallback(async () => {
    setGenStatus({ stage: 'generating', current: 0, total: 1, tokensGenerated: 0 });

    const cachePath = MODEL_CONFIGS[tokenizerType].demoCachePath;

    try {
      const response = await fetch(cachePath);
      if (!response.ok) throw new Error(`Failed to load demo cache: ${response.status}`);

      const cache: DemoCacheData = await response.json();

      // Prioritize valid molecules, then fill with invalid ones
      const validCached = cache.molecules.filter((m) => m.isValid);
      const invalidCached = cache.molecules.filter((m) => !m.isValid);
      const selected = [...validCached, ...invalidCached].slice(0, 8);

      const molecules: MoleculeData[] = selected.map((cached) => {
        let mol = cachedToMolecule(cached);
        // Apply fallback layout for molecules with degenerate coordinates
        if (mol.atoms.length > 1 && hasDegenrateLayout(mol)) {
          mol = computeFallbackLayout(mol);
        } else {
          // Normalize cached coordinates to compact range
          mol = normalizeMoleculeLayout(mol);
        }
        return mol;
      });

      console.log(`[MOSAIC] Demo cache (${tokenizerType}): ${validCached.length} valid, ${invalidCached.length} invalid, showing ${molecules.length}`);
      setMolecules(molecules);
      setGenStatus({ stage: 'complete', elapsed: 0 });
    } catch (err) {
      console.warn('[MOSAIC] Failed to load demo cache:', err);
      setMolecules(generatePlaceholderMolecules());
      setGenStatus({ stage: 'complete', elapsed: 0 });
    }
  }, [tokenizerType]);

  // ─── Test Decode: Load pre-generated tokens and decode them ──────────────

  const handleTestDecode = useCallback(async () => {
    setGenStatus({ stage: 'decoding' });
    setMolecules([]);
    setViewMode('2d');

    const testPath = MODEL_CONFIGS[tokenizerType].testTokensPath;

    try {
      const response = await fetch(testPath);
      if (!response.ok) throw new Error(`Failed to load test tokens: ${response.status}`);

      const tokenEntries: { id: number; tokens: number[]; smiles: string | null }[] = await response.json();

      const decoded: MoleculeData[] = tokenEntries.map((entry, i) => {
        console.log(`[MOSAIC] Test decode (${tokenizerType}) molecule ${i}: ${entry.tokens.length} tokens, Python SMILES: ${entry.smiles}`);

        let mol = tokenizerType === 'sent'
          ? decodeSentTokens(entry.tokens, tokenizerConfig, i)
          : decodeTokens(entry.tokens, tokenizerConfig, i);
        console.log(`[MOSAIC]   Decoded: ${mol.atoms.length} atoms, ${mol.bonds.length} bonds`);

        if (rdkitReady) {
          mol = validateAndEnrich(mol);
        } else {
          mol = computeFallbackLayout(mol);
        }

        if (mol.atoms.length > 1 && hasDegenrateLayout(mol)) {
          mol = computeFallbackLayout(mol);
        }

        console.log(`[MOSAIC]   After validation: SMILES=${mol.smiles}, valid=${mol.isValid}`);

        mol.tokens = entry.tokens;
        return mol;
      });

      setMolecules(decoded);
      setGenStatus({ stage: 'complete', elapsed: 0 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGenStatus({ stage: 'error', error: msg });
    }
  }, [tokenizerType, tokenizerConfig, rdkitReady]);

  // ─── Render ──────────────────────────────────────────────────────────────

  const isGenerating = genStatus.stage === 'generating' || genStatus.stage === 'decoding';

  return (
    <div className="min-h-screen p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            MOSAIC Live Demo
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">
            Generate novel molecules with hierarchical graph tokenization, running entirely in your browser.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* RDKit status */}
          <span
            className={`text-xs ${rdkitReady ? 'text-green-600' : 'text-yellow-600'}`}
          >
            RDKit {rdkitReady ? 'Ready' : 'Loading...'}
          </span>

          {/* GitHub link */}
          <a
            href="https://github.com/KevinBian107/MOSAIC"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="View on GitHub"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
          </a>
        </div>
      </header>

      {/* How it works */}
      <div className="mb-4 p-3 bg-[var(--bg-canvas)] rounded-lg border border-[var(--border)] text-xs text-[var(--text-secondary)] leading-relaxed">
        <p>
          This demo runs a <strong className="text-[var(--text-primary)]">GPT-2 model</strong> (11.5M params)
          directly in your browser via <strong className="text-[var(--text-primary)]">ONNX Runtime Web</strong> (WebGPU/WASM).
          The model generates molecules as token sequences {MODEL_CONFIGS[tokenizerType].description}{' '}
          Generated structures are validated with <strong className="text-[var(--text-primary)]">RDKit</strong> to produce SMILES strings.
          No data leaves your device.
        </p>
      </div>

      {/* Controls */}
      <GenerationControls
        modelStatus={modelStatus}
        isGenerating={isGenerating}
        onGenerate={handleGenerate}
        onLoadFallback={handleLoadFallback}
        onTestDecode={handleTestDecode}
        tokenizerType={tokenizerType}
        onTypeChange={handleTypeChange}
      />

      {/* Progress */}
      <div className="my-4">
        <ProgressBar status={genStatus} />
      </div>

      {/* View mode toggle */}
      {molecules.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-[var(--text-secondary)]">View:</span>
          <button
            onClick={() => setViewMode('2d')}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              viewMode === '2d'
                ? 'bg-blue-600 text-white'
                : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border)]'
            }`}
          >
            2D
          </button>
          <button
            onClick={() => setViewMode('3d')}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              viewMode === '3d'
                ? 'bg-blue-600 text-white'
                : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border)]'
            }`}
          >
            3D
          </button>
        </div>
      )}

      {/* Molecule Grid */}
      <MoleculeGrid molecules={molecules} viewMode={viewMode} />
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a cached molecule (from demo_cache.json) to MoleculeData.
 */
function cachedToMolecule(cached: CachedMolecule): MoleculeData {
  const atoms = cached.atoms.map((a) => ({
    ...a,
    element: a.element ?? (a.typeIdx < ATOM_TYPES.length ? ATOM_TYPES[a.typeIdx]! : 'Unknown'),
    z: 0,
    communityId: findCommunity(a.index, cached.communities),
  }));

  const bonds = cached.bonds.map((b) => ({
    ...b,
    typeName: (b.typeIdx < BOND_TYPE_NAMES.length
      ? BOND_TYPE_NAMES[b.typeIdx]
      : 'Unknown') as MoleculeData['bonds'][number]['typeName'],
  }));

  return {
    id: cached.id,
    communities: cached.communities,
    superEdges: cached.superEdges,
    atoms: atoms as MoleculeData['atoms'],
    bonds,
    smiles: cached.smiles,
    isValid: cached.isValid,
    tokens: cached.tokens,
    numAtoms: cached.numAtoms,
  };
}

function findCommunity(atomIdx: number, communities: CachedMolecule['communities']): number {
  for (const comm of communities) {
    if (comm.atomIndices.includes(atomIdx)) return comm.id;
  }
  return -1;
}

/**
 * Generate placeholder molecules when no model or cache is available.
 */
function generatePlaceholderMolecules(): MoleculeData[] {
  // Caffeine-like structure as placeholder
  const caffeine: MoleculeData = {
    id: 0,
    communities: [
      { id: 0, type: 'ring', atomIndices: [0, 1, 2, 3, 4], internalEdges: [[0,1],[1,0],[1,2],[2,1],[2,3],[3,2],[3,4],[4,3],[4,0],[0,4]] },
      { id: 1, type: 'ring', atomIndices: [3, 5, 6, 7], internalEdges: [[3,5],[5,3],[5,6],[6,5],[6,7],[7,6],[7,3],[3,7]] },
      { id: 2, type: 'functional', atomIndices: [8, 9], internalEdges: [] },
    ],
    superEdges: [],
    atoms: [
      { index: 0, element: 'N', typeIdx: 1, x: 0, y: 1.2, z: 0, communityId: 0 },
      { index: 1, element: 'C', typeIdx: 0, x: 1, y: 0.6, z: 0, communityId: 0 },
      { index: 2, element: 'N', typeIdx: 1, x: 1, y: -0.6, z: 0, communityId: 0 },
      { index: 3, element: 'C', typeIdx: 0, x: 0, y: -1.2, z: 0, communityId: 0 },
      { index: 4, element: 'C', typeIdx: 0, x: -1, y: 0, z: 0, communityId: 0 },
      { index: 5, element: 'N', typeIdx: 1, x: -0.5, y: -2, z: 0, communityId: 1 },
      { index: 6, element: 'C', typeIdx: 0, x: 0.5, y: -2.5, z: 0, communityId: 1 },
      { index: 7, element: 'N', typeIdx: 1, x: 1.2, y: -1.8, z: 0, communityId: 1 },
      { index: 8, element: 'O', typeIdx: 2, x: 2, y: 1, z: 0, communityId: 2 },
      { index: 9, element: 'O', typeIdx: 2, x: -2, y: -0.5, z: 0, communityId: 2 },
    ],
    bonds: [
      { src: 0, dst: 1, typeIdx: 0, typeName: 'SINGLE' },
      { src: 1, dst: 2, typeIdx: 1, typeName: 'DOUBLE' },
      { src: 2, dst: 3, typeIdx: 0, typeName: 'SINGLE' },
      { src: 3, dst: 4, typeIdx: 0, typeName: 'SINGLE' },
      { src: 4, dst: 0, typeIdx: 0, typeName: 'SINGLE' },
      { src: 3, dst: 5, typeIdx: 0, typeName: 'SINGLE' },
      { src: 5, dst: 6, typeIdx: 1, typeName: 'DOUBLE' },
      { src: 6, dst: 7, typeIdx: 0, typeName: 'SINGLE' },
      { src: 7, dst: 3, typeIdx: 0, typeName: 'SINGLE' },
      { src: 1, dst: 8, typeIdx: 1, typeName: 'DOUBLE' },
      { src: 4, dst: 9, typeIdx: 1, typeName: 'DOUBLE' },
    ],
    smiles: 'Cn1c(=O)c2c(ncn2C)n1C',
    isValid: true,
    tokens: [],
    numAtoms: 10,
  };

  return [caffeine];
}
