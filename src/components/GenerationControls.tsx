/**
 * Generation controls panel.
 *
 * Provides sliders for molecule count, seed, temperature, and top-k,
 * plus the main "Generate Molecules" button.
 */

import { useState } from 'react';
import type { GenerationConfig, ModelStatus } from '../engine/types';

interface GenerationControlsProps {
  modelStatus: ModelStatus;
  isGenerating: boolean;
  onGenerate: (config: GenerationConfig) => void;
  onLoadFallback: () => void;
  onTestDecode?: () => void;
}

export default function GenerationControls({
  modelStatus,
  isGenerating,
  onGenerate,
  onLoadFallback,
  onTestDecode,
}: GenerationControlsProps) {
  const [numMolecules, setNumMolecules] = useState(4);
  const [seed, setSeed] = useState(42);
  const [temperature, setTemperature] = useState(1.0);
  const [topK, setTopK] = useState(10);

  const canGenerate = !isGenerating && modelStatus.stage !== 'loading';

  const handleGenerate = () => {
    onGenerate({
      numMolecules,
      topK,
      temperature,
      seed,
      maxLength: 2048,
    });
  };

  return (
    <div className="flex flex-col gap-4 p-4 bg-[var(--bg-card)] rounded-xl border border-[var(--border)]">
      <div className="flex flex-wrap items-end gap-4">
        {/* Molecule count */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--text-secondary)] font-medium">
            Molecules
          </label>
          <input
            type="range"
            min={1}
            max={12}
            value={numMolecules}
            onChange={(e) => setNumMolecules(parseInt(e.target.value))}
            className="w-24 accent-[var(--accent)]"
            disabled={isGenerating}
          />
          <span className="text-xs text-center text-[var(--text-secondary)]">
            {numMolecules}
          </span>
        </div>

        {/* Seed */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--text-secondary)] font-medium">
            Seed
          </label>
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
            className="w-20 px-2 py-1 text-sm bg-white border border-[var(--border)] rounded text-[var(--text-primary)]"
            disabled={isGenerating}
          />
        </div>

        {/* Temperature */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--text-secondary)] font-medium">
            Temperature
          </label>
          <input
            type="range"
            min={0.1}
            max={2.0}
            step={0.1}
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-24 accent-[var(--accent)]"
            disabled={isGenerating}
          />
          <span className="text-xs text-center text-[var(--text-secondary)]">
            {temperature.toFixed(1)}
          </span>
        </div>

        {/* Top-K */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--text-secondary)] font-medium">
            Top-K
          </label>
          <input
            type="range"
            min={1}
            max={50}
            value={topK}
            onChange={(e) => setTopK(parseInt(e.target.value))}
            className="w-24 accent-[var(--accent)]"
            disabled={isGenerating}
          />
          <span className="text-xs text-center text-[var(--text-secondary)]">
            {topK}
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className={`
            flex-1 px-6 py-2.5 rounded-lg font-semibold text-sm transition-all
            ${canGenerate
              ? 'bg-[var(--accent)] text-white hover:brightness-110 active:scale-[0.98] cursor-pointer'
              : 'bg-zinc-300 text-zinc-500 cursor-not-allowed'
            }
          `}
        >
          {isGenerating
            ? 'Generating...'
            : modelStatus.stage === 'loading'
              ? `Loading Model (${Math.round((modelStatus.progress ?? 0) * 100)}%)`
              : 'Generate Molecules'}
        </button>

        <button
          onClick={onLoadFallback}
          disabled={isGenerating}
          className={`
            px-4 py-2.5 rounded-lg text-sm transition-all border border-[var(--border)]
            ${!isGenerating
              ? 'text-[var(--text-secondary)] hover:bg-zinc-100 cursor-pointer'
              : 'text-zinc-400 cursor-not-allowed'
            }
          `}
          title="Load pre-generated molecules (no model needed)"
        >
          Demo
        </button>

        {onTestDecode && (
          <button
            onClick={onTestDecode}
            disabled={isGenerating}
            className={`
              px-4 py-2.5 rounded-lg text-sm transition-all border border-green-300 bg-green-50
              ${!isGenerating
                ? 'text-green-700 hover:bg-green-100 cursor-pointer'
                : 'text-green-400 cursor-not-allowed'
              }
            `}
            title="Decode pre-generated tokens (verifies decode pipeline)"
          >
            Test Decode
          </button>
        )}
      </div>
    </div>
  );
}
