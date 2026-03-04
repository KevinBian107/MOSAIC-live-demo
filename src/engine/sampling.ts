/**
 * Sampling utilities for autoregressive token generation.
 *
 * Implements top-k sampling with temperature scaling, matching
 * the HuggingFace generate() behavior used during MOSAIC training.
 */

/**
 * Seeded pseudo-random number generator (Mulberry32).
 * Deterministic generation for reproducible demos.
 */
export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/**
 * Top-k sampling from logits.
 *
 * 1. Sort logits descending
 * 2. Keep only top-k
 * 3. Softmax over top-k
 * 4. Sample from categorical distribution
 *
 * @param logits - Raw logits (will not be modified).
 * @param topK - Number of top tokens to consider.
 * @param temperature - Sampling temperature.
 * @param rng - Random number generator.
 * @returns Sampled token index.
 */
export function sampleTopK(
  logits: Float32Array,
  topK: number,
  temperature: number,
  rng: SeededRNG,
): number {
  const n = logits.length;

  // Apply temperature
  const scaled = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    scaled[i] = logits[i]! / temperature;
  }

  // Find top-k indices
  const indices = new Array<number>(n);
  for (let i = 0; i < n; i++) indices[i] = i;

  // Partial sort: move top-k elements to front
  const k = Math.min(topK, n);
  for (let i = 0; i < k; i++) {
    let maxIdx = i;
    for (let j = i + 1; j < n; j++) {
      if (scaled[indices[j]!]! > scaled[indices[maxIdx]!]!) {
        maxIdx = j;
      }
    }
    if (maxIdx !== i) {
      const tmp = indices[i]!;
      indices[i] = indices[maxIdx]!;
      indices[maxIdx] = tmp;
    }
  }

  // Softmax over top-k
  const topIndices = indices.slice(0, k);
  let maxLogit = -Infinity;
  for (const idx of topIndices) {
    if (scaled[idx]! > maxLogit) maxLogit = scaled[idx]!;
  }

  const probs = new Float32Array(k);
  let sumExp = 0;
  for (let i = 0; i < k; i++) {
    probs[i] = Math.exp(scaled[topIndices[i]!]! - maxLogit);
    sumExp += probs[i]!;
  }
  for (let i = 0; i < k; i++) {
    probs[i]! /= sumExp;
  }

  // Sample from categorical distribution
  const r = rng.next();
  let cumulative = 0;
  for (let i = 0; i < k; i++) {
    cumulative += probs[i]!;
    if (r < cumulative) {
      return topIndices[i]!;
    }
  }

  // Fallback (should not reach here)
  return topIndices[k - 1]!;
}
