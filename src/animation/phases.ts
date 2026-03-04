/**
 * 4-Phase Animation State Machine for molecule visualization.
 *
 * Phase 1: Community Assembly (0-30%)
 *   - Translucent colored blobs fade in at community centroids
 *   - Super-edges appear as dashed lines between blobs
 *
 * Phase 2: Atom Population (30-70%)
 *   - Hulls shrink, individual atoms spring-animate from centroid to final position
 *   - Internal bonds draw in, element colors appear
 *
 * Phase 3: Connection (70-90%)
 *   - Inter-community bonds appear (super-edges become solid bonds)
 *   - Full molecule structure visible
 *
 * Phase 4: Final Polish (90-100%)
 *   - SSAO fades in, camera settles
 *   - SMILES label appears below
 */

export type AnimationPhase = 'idle' | 'community' | 'atoms' | 'connection' | 'polish' | 'complete';

export interface AnimationState {
  /** Current phase */
  phase: AnimationPhase;
  /** Overall progress [0, 1] */
  progress: number;
  /** Progress within current phase [0, 1] */
  phaseProgress: number;
  /** Time elapsed since animation start (ms) */
  elapsed: number;
  /** Total animation duration (ms) */
  duration: number;
}

/** Phase boundaries as fractions of total duration. */
const PHASE_BOUNDS = {
  community: { start: 0.0, end: 0.3 },
  atoms: { start: 0.3, end: 0.7 },
  connection: { start: 0.7, end: 0.9 },
  polish: { start: 0.9, end: 1.0 },
} as const;

/**
 * Get the animation state for a given time.
 *
 * @param elapsed - Milliseconds since animation start.
 * @param duration - Total animation duration in milliseconds.
 * @returns Current animation state.
 */
export function getAnimationState(elapsed: number, duration: number): AnimationState {
  if (elapsed <= 0) {
    return { phase: 'idle', progress: 0, phaseProgress: 0, elapsed: 0, duration };
  }

  const progress = Math.min(elapsed / duration, 1);

  if (progress >= 1) {
    return { phase: 'complete', progress: 1, phaseProgress: 1, elapsed, duration };
  }

  // Determine current phase
  let phase: AnimationPhase;
  let phaseProgress: number;

  if (progress < PHASE_BOUNDS.community.end) {
    phase = 'community';
    phaseProgress = progress / PHASE_BOUNDS.community.end;
  } else if (progress < PHASE_BOUNDS.atoms.end) {
    phase = 'atoms';
    phaseProgress =
      (progress - PHASE_BOUNDS.atoms.start) /
      (PHASE_BOUNDS.atoms.end - PHASE_BOUNDS.atoms.start);
  } else if (progress < PHASE_BOUNDS.connection.end) {
    phase = 'connection';
    phaseProgress =
      (progress - PHASE_BOUNDS.connection.start) /
      (PHASE_BOUNDS.connection.end - PHASE_BOUNDS.connection.start);
  } else {
    phase = 'polish';
    phaseProgress =
      (progress - PHASE_BOUNDS.polish.start) /
      (PHASE_BOUNDS.polish.end - PHASE_BOUNDS.polish.start);
  }

  return {
    phase,
    progress,
    phaseProgress: Math.min(Math.max(phaseProgress, 0), 1),
    elapsed,
    duration,
  };
}

// ─── Per-Element Animation Values ────────────────────────────────────────────

/**
 * Get opacity for a community hull at current animation state.
 */
export function getCommunityHullOpacity(state: AnimationState): number {
  switch (state.phase) {
    case 'idle':
      return 0;
    case 'community':
      // Fade in
      return easeOutCubic(state.phaseProgress) * 0.4;
    case 'atoms':
      // Fade out as atoms appear
      return 0.4 * (1 - easeInCubic(state.phaseProgress));
    case 'connection':
    case 'polish':
    case 'complete':
      return 0;
  }
}

/**
 * Get opacity for a community hull border/outline.
 */
export function getCommunityOutlineOpacity(state: AnimationState): number {
  switch (state.phase) {
    case 'idle':
      return 0;
    case 'community':
      return easeOutCubic(state.phaseProgress) * 0.6;
    case 'atoms':
      return 0.6 * (1 - easeInQuad(state.phaseProgress) * 0.5);
    case 'connection':
      return 0.3 * (1 - easeInQuad(state.phaseProgress));
    case 'polish':
    case 'complete':
      return 0;
  }
}

/**
 * Get scale factor for an atom at a given index during animation.
 *
 * Atoms appear staggered within the atom phase, springing from 0 to 1.
 */
export function getAtomScale(
  state: AnimationState,
  atomIndex: number,
  totalAtoms: number,
): number {
  if (state.phase === 'idle' || state.phase === 'community') return 0;
  if (state.phase === 'connection' || state.phase === 'polish' || state.phase === 'complete') return 1;

  // Stagger atoms within the phase
  const stagger = totalAtoms > 1 ? atomIndex / (totalAtoms - 1) : 0;
  const atomProgress = Math.max(0, (state.phaseProgress - stagger * 0.5) / (1 - stagger * 0.5));

  return springEase(atomProgress);
}

/**
 * Get position interpolation factor for an atom.
 *
 * 0 = at community centroid, 1 = at final position.
 */
export function getAtomPositionFactor(
  state: AnimationState,
  atomIndex: number,
  totalAtoms: number,
): number {
  if (state.phase === 'idle' || state.phase === 'community') return 0;
  if (state.phase === 'connection' || state.phase === 'polish' || state.phase === 'complete') return 1;

  const stagger = totalAtoms > 1 ? atomIndex / (totalAtoms - 1) : 0;
  const atomProgress = Math.max(0, (state.phaseProgress - stagger * 0.3) / (1 - stagger * 0.3));

  return easeOutBack(atomProgress);
}

/**
 * Get opacity for internal bonds.
 */
export function getInternalBondOpacity(state: AnimationState): number {
  switch (state.phase) {
    case 'idle':
    case 'community':
      return 0;
    case 'atoms':
      return easeOutCubic(Math.max(0, state.phaseProgress - 0.3) / 0.7);
    case 'connection':
    case 'polish':
    case 'complete':
      return 1;
  }
}

/**
 * Get opacity for super-edges (inter-community bonds).
 */
export function getSuperEdgeOpacity(state: AnimationState): number {
  switch (state.phase) {
    case 'idle':
      return 0;
    case 'community':
      // Appear as dashed lines
      return easeOutCubic(Math.max(0, state.phaseProgress - 0.5) / 0.5) * 0.3;
    case 'atoms':
      return 0.3;
    case 'connection':
      // Solidify
      return 0.3 + 0.7 * easeOutCubic(state.phaseProgress);
    case 'polish':
    case 'complete':
      return 1;
  }
}

/**
 * Get SSAO intensity.
 */
export function getSSAOIntensity(state: AnimationState): number {
  if (state.phase === 'polish') {
    return easeOutCubic(state.phaseProgress);
  }
  return state.phase === 'complete' ? 1 : 0;
}

/**
 * Get label (SMILES) opacity.
 */
export function getLabelOpacity(state: AnimationState): number {
  if (state.phase === 'polish') {
    return easeOutCubic(Math.max(0, state.phaseProgress - 0.3) / 0.7);
  }
  return state.phase === 'complete' ? 1 : 0;
}

// ─── Easing Functions ────────────────────────────────────────────────────────

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t: number): number {
  return t * t * t;
}

function easeInQuad(t: number): number {
  return t * t;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Spring-like ease for atom emergence.
 * Overshoots slightly then settles.
 */
function springEase(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const w = 8; // frequency
  const d = 0.4; // damping
  return 1 - Math.exp(-d * w * t) * Math.cos(w * Math.sqrt(1 - d * d) * t);
}
