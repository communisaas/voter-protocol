/**
 * @voter-protocol/noir-prover
 *
 * Browser-native ZK prover using Barretenberg/Noir backend.
 *
 * PRIMARY: ThreeTreeNoirProver — three-tree architecture (user + cell map + engagement).
 * DEPRECATED: TwoTreeNoirProver — two-tree architecture (user + cell map only).
 * DEPRECATED: NoirProver — legacy single-tree prover (NUL-001 violation).
 *
 * Dev-only code (profiler, test fixtures, orchestrator) is kept internal.
 */

// Polyfill Node.js Buffer for browser compatibility (required by @aztec/bb.js)
import { Buffer } from 'buffer';
if (typeof globalThis !== 'undefined' && !globalThis.Buffer) {
    (globalThis as any).Buffer = Buffer;
}

// ── Three-tree prover API (PRIMARY) ─────────────────────────────────────
// Three-tree architecture: user tree + cell map tree + engagement tree
export {
    ThreeTreeNoirProver,
    getThreeTreeProverForDepth,
    resetThreeTreeProverSingleton,
    resetThreeTreeProverForDepth,
} from './three-tree-prover';

// Types - three-tree (primary)
export type {
    ThreeTreeProverConfig,
    ThreeTreeProofInput,
    ThreeTreeProofResult,
    EngagementTier,
} from './types';
export { THREE_TREE_PUBLIC_INPUT_COUNT, validateEngagementTier } from './types';

// ── Shared types and constants ──────────────────────────────────────────
export type { CircuitDepth, AuthorityLevel, ProofOptions } from './types';
export { DEFAULT_CIRCUIT_DEPTH, DISTRICT_SLOT_COUNT, validateAuthorityLevel } from './types';

// Re-export BN254_MODULUS from @voter-protocol/crypto for downstream consumers
export { BN254_MODULUS } from '@voter-protocol/crypto';

// ── Legacy single-tree prover (DEPRECATED) ──────────────────────────────
/**
 * @deprecated Legacy single-tree prover. Use ThreeTreeNoirProver.
 * SECURITY: This prover derives nullifiers from user_secret, violating NUL-001.
 * The three-tree prover uses identity_commitment for Sybil resistance.
 */
export {
    NoirProver,
    getProver,
    getProverForDepth,
    resetProverSingleton,
    resetProverForDepth,
} from './prover';

// Types - single-tree (legacy)
export type { ProverConfig, ProofResult, CircuitInputs } from './types';

// ── Two-tree prover API (DEPRECATED) ────────────────────────────────────
/**
 * @deprecated Two-tree prover. Use ThreeTreeNoirProver from three-tree-prover.ts.
 * The two-tree architecture lacks engagement tree support. Migrate to three-tree.
 */
export {
    TwoTreeNoirProver,
    getTwoTreeProverForDepth,
    resetTwoTreeProverSingleton,
    resetTwoTreeProverForDepth,
} from './two-tree-prover';

// Types - two-tree (deprecated)
/** @deprecated Use ThreeTreeProofInput, ThreeTreeProofResult, ThreeTreeProverConfig. */
export type {
    TwoTreeProverConfig,
    TwoTreeProofInput,
    TwoTreeProofResult,
} from './types';
/** @deprecated Use THREE_TREE_PUBLIC_INPUT_COUNT (31). */
export { TWO_TREE_PUBLIC_INPUT_COUNT } from './types';

// ── Debate weight prover (Position Privacy) ──────────────────────────────
export {
    DebateWeightNoirProver,
    getDebateWeightProver,
    resetDebateWeightProverSingleton,
    bigintSqrt,
} from './debate-weight-prover';
export type {
    DebateWeightProverConfig,
} from './debate-weight-prover';
export type { DebateWeightProofInput, DebateWeightProofResult } from './types';
export { DEBATE_WEIGHT_PUBLIC_INPUT_COUNT } from './types';

// ── Position note prover (Debate Settlement) ─────────────────────────────
export {
    PositionNoteNoirProver,
    getPositionNoteProver,
    resetPositionNoteProverSingleton,
} from './position-note-prover';
export type {
    PositionNoteProverConfig,
} from './position-note-prover';
export type { PositionNoteProofInput, PositionNoteProofResult } from './types';
export {
    POSITION_NOTE_PUBLIC_INPUT_COUNT,
    POSITION_TREE_DEPTH,
    DOMAIN_POS_COMMIT,
    DOMAIN_POS_NUL,
} from './types';

// Cross-origin isolation utilities (needed for SharedArrayBuffer support)
export { checkCrossOriginIsolation, requireCrossOriginIsolation } from './cross-origin-isolation';

