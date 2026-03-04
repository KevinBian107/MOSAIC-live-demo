/**
 * Generation progress bar.
 *
 * Shows during generation phase, hidden during visualization.
 */

import type { GenerationStatus } from '../engine/types';

interface ProgressBarProps {
  status: GenerationStatus;
}

export default function ProgressBar({ status }: ProgressBarProps) {
  if (status.stage === 'idle') return null;

  const getMessage = (): string => {
    switch (status.stage) {
      case 'generating':
        return `Generating molecule ${status.current + 1}/${status.total} (${status.tokensGenerated} tokens)`;
      case 'decoding':
        return 'Validating molecules with RDKit...';
      case 'complete':
        return `Complete in ${(status.elapsed / 1000).toFixed(1)}s`;
      case 'error':
        return `Error: ${status.error}`;
    }
  };

  const getProgress = (): number => {
    switch (status.stage) {
      case 'generating':
        return ((status.current + 1) / status.total) * 0.8;
      case 'decoding':
        return 0.9;
      case 'complete':
        return 1;
      case 'error':
        return 0;
    }
  };

  const progress = getProgress();

  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-[var(--text-secondary)] mb-1">
        <span>{getMessage()}</span>
        <span>{Math.round(progress * 100)}%</span>
      </div>
      <div className="w-full h-2 bg-zinc-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            status.stage === 'error'
              ? 'bg-red-500'
              : status.stage === 'complete'
                ? 'bg-green-500'
                : 'bg-[var(--accent)]'
          }`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
