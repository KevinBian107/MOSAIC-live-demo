/**
 * ONNX model loading and autoregressive generation using Transformers.js.
 *
 * Runs GPT-2 (~11.5M params) entirely in the browser via WebGPU or WASM fallback.
 * Uses a custom forward loop since the ONNX export doesn't include KV cache.
 */

import type { GenerationConfig, ModelStatus } from './types';
import { HDTC } from './tokenizer';
import { SeededRNG, sampleTopK } from './sampling';

// Transformers.js types (dynamic import)
type TransformersModule = typeof import('@huggingface/transformers');

let transformersModule: TransformersModule | null = null;

async function getTransformers(): Promise<TransformersModule> {
  if (!transformersModule) {
    transformersModule = await import('@huggingface/transformers');
  }
  return transformersModule;
}

/** Result of generating a single molecule. */
export interface GenerationResult {
  tokens: number[];
  length: number;
}

/**
 * MOSAIC model wrapper for browser-based inference.
 *
 * Uses Transformers.js which wraps ONNX Runtime Web for cross-browser
 * model inference with WebGPU acceleration (WASM fallback).
 */
export class MosaicModel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private model: any = null;
  private _status: ModelStatus = { stage: 'idle' };
  private onStatusChange: ((status: ModelStatus) => void) | null = null;

  get status(): ModelStatus {
    return this._status;
  }

  setStatusCallback(cb: (status: ModelStatus) => void): void {
    this.onStatusChange = cb;
  }

  private updateStatus(status: ModelStatus): void {
    this._status = status;
    this.onStatusChange?.(status);
  }

  /**
   * Load the ONNX model from a local or remote path.
   *
   * @param modelPath - Path to model directory (containing config.json + onnx/)
   * @param options - Loading options
   */
  async load(
    modelPath: string,
    options: { quantized?: boolean; device?: 'webgpu' | 'wasm' | 'auto' } = {},
  ): Promise<void> {
    this.updateStatus({ stage: 'loading', progress: 0, message: 'Loading Transformers.js...' });

    const { AutoModelForCausalLM, env } = await getTransformers();

    // Configure Transformers.js
    env.allowLocalModels = true;
    env.useBrowserCache = false; // Disable cache to ensure fresh model loads during development

    this.updateStatus({ stage: 'loading', progress: 0.2, message: 'Loading ONNX model...' });

    // Determine device
    let device = options.device ?? 'auto';
    if (device === 'auto') {
      // Check for WebGPU support
      if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const adapter = await (navigator as any).gpu.requestAdapter();
          device = adapter ? 'webgpu' : 'wasm';
        } catch {
          device = 'wasm';
        }
      } else {
        device = 'wasm';
      }
    }

    this.updateStatus({
      stage: 'loading',
      progress: 0.3,
      message: `Loading model (${device})...`,
    });

    try {
      this.model = await AutoModelForCausalLM.from_pretrained(modelPath, {
        dtype: options.quantized !== false ? 'q8' : 'fp32',
        device,
      } as Record<string, unknown>);

      console.log('[MOSAIC] Model loaded successfully');
      console.log('[MOSAIC] Vocab size:', this.model.config?.vocab_size);

      this.updateStatus({ stage: 'ready' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[MOSAIC] Model load failed:', error);
      this.updateStatus({ stage: 'error', error: msg });
      throw error;
    }
  }

  /**
   * Check if the model is loaded and ready for generation.
   */
  get isReady(): boolean {
    return this.model !== null && this._status.stage === 'ready';
  }

  /**
   * Generate a single molecule token sequence autoregressively.
   *
   * Uses a custom forward loop since the ONNX model doesn't include
   * KV cache (Transformers.js generate() requires it).
   *
   * @param config - Generation configuration.
   * @param onToken - Optional callback invoked after each token is generated.
   * @returns Generated token sequence.
   */
  async generateOne(
    config: GenerationConfig,
    onToken?: (token: number, position: number) => void,
  ): Promise<GenerationResult> {
    if (!this.model) {
      throw new Error('Model not loaded. Call load() first.');
    }

    const { Tensor } = await getTransformers();
    const rng = new SeededRNG(config.seed);

    const tokens: number[] = [HDTC.SOS];
    const maxLen = config.maxLength || 2048;

    console.log(`[MOSAIC] Generating (seed=${config.seed}, temp=${config.temperature}, topK=${config.topK})`);

    for (let pos = 1; pos < maxLen; pos++) {
      // Create input tensor with full sequence
      const inputIds = new Tensor(
        'int64',
        BigInt64Array.from(tokens.map(BigInt)),
        [1, tokens.length],
      );

      // Forward pass
      let output;
      try {
        output = await this.model.forward({ input_ids: inputIds });
      } catch (fwdErr) {
        console.error(`[MOSAIC] forward() failed at pos ${pos}:`, fwdErr);
        break;
      }

      if (!output?.logits) {
        console.error('[MOSAIC] No logits in output:', Object.keys(output ?? {}));
        break;
      }

      // Get logits for last position
      const logitsData = output.logits.data as Float32Array;
      const vocabSize = output.logits.dims[2] as number;
      const lastPosOffset = (tokens.length - 1) * vocabSize;
      const lastLogits = logitsData.slice(lastPosOffset, lastPosOffset + vocabSize);

      // Mask PAD token (should never be generated)
      lastLogits[HDTC.PAD] = -Infinity;

      // Sample next token
      const nextToken = sampleTopK(lastLogits, config.topK, config.temperature, rng);
      tokens.push(nextToken);

      onToken?.(nextToken, pos);

      // Stop at EOS
      if (nextToken === HDTC.EOS) break;
    }

    console.log(`[MOSAIC] Generated ${tokens.length} tokens`);

    return {
      tokens,
      length: tokens.length,
    };
  }

  /**
   * Generate multiple molecules.
   *
   * @param config - Generation configuration.
   * @param onMoleculeComplete - Callback after each molecule is done.
   * @param onToken - Optional per-token callback.
   * @returns Array of generation results.
   */
  async generateBatch(
    config: GenerationConfig,
    onMoleculeComplete?: (index: number, result: GenerationResult) => void,
    onToken?: (moleculeIndex: number, token: number, position: number) => void,
  ): Promise<GenerationResult[]> {
    const results: GenerationResult[] = [];

    for (let i = 0; i < config.numMolecules; i++) {
      // Use different seed for each molecule
      const molConfig = { ...config, seed: config.seed + i };
      const result = await this.generateOne(
        molConfig,
        onToken ? (token, pos) => onToken(i, token, pos) : undefined,
      );
      results.push(result);
      onMoleculeComplete?.(i, result);
    }

    return results;
  }

  /**
   * Free model resources.
   */
  dispose(): void {
    this.model = null;
    this.updateStatus({ stage: 'idle' });
  }
}
