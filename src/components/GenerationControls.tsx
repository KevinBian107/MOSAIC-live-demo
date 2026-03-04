/**
 * Generation controls panel.
 *
 * Provides sliders for molecule count, seed, temperature, and top-k,
 * plus the main "Generate Molecules" button.
 */

import { useState, useMemo } from 'react';
import type { GenerationConfig, GenerationMode, ModelStatus, TokenizerType } from '../engine/types';

interface SweepConfig {
  topKValues: number[];
  temperatureValues: number[];
  numMolecules: number;
  seed: number;
  maxLength: number;
}

interface GenerationControlsProps {
  modelStatus: ModelStatus;
  isGenerating: boolean;
  onGenerate: (config: GenerationConfig) => void;
  onSweepGenerate: (config: SweepConfig) => void;
  onLoadFallback: () => void;
  onTestDecode?: () => void;
  tokenizerType: TokenizerType;
  onTypeChange: (type: TokenizerType) => void;
  generationMode: GenerationMode;
  onModeChange: (mode: GenerationMode) => void;
}

/** Parse a comma-separated string into an array of positive numbers. */
function parseValues(input: string): number[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => !isNaN(n) && n > 0);
}

export default function GenerationControls({
  modelStatus,
  isGenerating,
  onGenerate,
  onSweepGenerate,
  onLoadFallback,
  onTestDecode,
  tokenizerType,
  onTypeChange,
  generationMode,
  onModeChange,
}: GenerationControlsProps) {
  const [numMolecules, setNumMolecules] = useState(4);
  const [seed, setSeed] = useState(42);
  const [temperature, setTemperature] = useState(1.0);
  const [topK, setTopK] = useState(10);

  // Sweep mode inputs
  const [topKInput, setTopKInput] = useState('5, 10, 20');
  const [tempInput, setTempInput] = useState('0.5, 1.0, 1.5');

  const canGenerate = !isGenerating && modelStatus.stage !== 'loading';

  // Parse sweep values and compute preview
  const topKValues = useMemo(() => parseValues(topKInput), [topKInput]);
  const tempValues = useMemo(() => parseValues(tempInput), [tempInput]);
  const sweepValid = generationMode === 'sweep' && topKValues.length > 0 && tempValues.length > 0;
  const totalCombos = topKValues.length * tempValues.length;
  const totalMolecules = totalCombos * numMolecules;

  const handleGenerate = () => {
    if (generationMode === 'sweep') {
      if (!sweepValid) return;
      onSweepGenerate({
        topKValues,
        temperatureValues: tempValues,
        numMolecules,
        seed,
        maxLength: 2048,
      });
    } else {
      onGenerate({
        numMolecules,
        topK,
        temperature,
        seed,
        maxLength: 2048,
      });
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 bg-[var(--bg-card)] rounded-xl border border-[var(--border)]">
      {/* Tokenizer type + mode selector row */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-[var(--text-secondary)] font-medium">Tokenizer:</span>
        <div className="flex gap-1 bg-[var(--bg-canvas)] rounded-lg p-0.5">
          {(['hdtc', 'sent'] as const).map((type) => (
            <button
              key={type}
              onClick={() => onTypeChange(type)}
              disabled={isGenerating}
              className={`
                px-3 py-1 text-xs font-semibold rounded-md transition-all
                ${tokenizerType === type
                  ? 'bg-white text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }
                ${isGenerating ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
              `}
            >
              {type.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-[var(--border)]" />

        <span className="text-xs text-[var(--text-secondary)] font-medium">Mode:</span>
        <div className="flex gap-1 bg-[var(--bg-canvas)] rounded-lg p-0.5">
          {(['single', 'sweep'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onModeChange(mode)}
              disabled={isGenerating}
              className={`
                px-3 py-1 text-xs font-semibold rounded-md transition-all
                ${generationMode === mode
                  ? 'bg-white text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }
                ${isGenerating ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
              `}
            >
              {mode === 'single' ? 'Single' : 'Sweep'}
            </button>
          ))}
        </div>

        <span className="text-[10px] text-[var(--text-secondary)] opacity-60">
          {tokenizerType === 'hdtc' ? 'Hierarchical communities' : 'Flat walk-based'}
          {generationMode === 'sweep' ? ' · Parameter sweep' : ''}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-6">
        {/* Molecule count (per combo in sweep mode) */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--text-secondary)] font-medium">
            {generationMode === 'sweep' ? 'Per Combo' : 'Molecules'}
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

        {generationMode === 'single' ? (
          <>
            {/* Temperature slider */}
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

            {/* Top-K slider */}
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

            {/* Descriptions */}
            <div className="flex items-center text-[10px] text-[var(--text-secondary)] opacity-60 ml-auto gap-1.5">
              <span>Temperature: low = safe, high = creative</span>
              <span>·</span>
              <span>Top-K: fewer = focused, more = diverse</span>
            </div>
          </>
        ) : (
          <>
            {/* Sweep: Temperature text input (matches single-mode order: Temp before Top-K) */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--text-secondary)] font-medium">
                Temperature values
              </label>
              <input
                type="text"
                value={tempInput}
                onChange={(e) => setTempInput(e.target.value)}
                placeholder="0.5, 1.0, 1.5"
                className="w-36 px-2 py-1 text-sm bg-white border border-[var(--border)] rounded text-[var(--text-primary)]"
                disabled={isGenerating}
              />
              <span className="text-[10px] text-[var(--text-secondary)]">
                {tempValues.length > 0 ? tempValues.join(', ') : 'none'}
              </span>
            </div>

            {/* Sweep: Top-K text input */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--text-secondary)] font-medium">
                Top-K values
              </label>
              <input
                type="text"
                value={topKInput}
                onChange={(e) => setTopKInput(e.target.value)}
                placeholder="5, 10, 20"
                className="w-36 px-2 py-1 text-sm bg-white border border-[var(--border)] rounded text-[var(--text-primary)]"
                disabled={isGenerating}
              />
              <span className="text-[10px] text-[var(--text-secondary)]">
                {topKValues.length > 0 ? topKValues.join(', ') : 'none'}
              </span>
            </div>

            {/* Sweep preview */}
            <div className="flex items-center text-[10px] text-[var(--text-secondary)] opacity-60 ml-auto gap-1.5">
              {sweepValid ? (
                <span>{totalCombos} combos × {numMolecules} molecules = {totalMolecules} total</span>
              ) : (
                <span className="text-amber-600">Enter valid positive values for both fields</span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleGenerate}
          disabled={!canGenerate || (generationMode === 'sweep' && !sweepValid)}
          className={`
            flex-1 px-6 py-2.5 rounded-lg font-semibold text-sm transition-all
            ${canGenerate && (generationMode !== 'sweep' || sweepValid)
              ? 'bg-[var(--accent)] text-white hover:brightness-110 active:scale-[0.98] cursor-pointer'
              : 'bg-zinc-300 text-zinc-500 cursor-not-allowed'
            }
          `}
        >
          {isGenerating
            ? 'Generating...'
            : modelStatus.stage === 'loading'
              ? `Loading Model (${Math.round((modelStatus.progress ?? 0) * 100)}%)`
              : generationMode === 'sweep'
                ? `Sweep Generate (${totalMolecules})`
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
