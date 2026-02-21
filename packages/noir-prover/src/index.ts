/**
 * @voter-protocol/noir-prover
 *
 * Browser-native ZK prover using Barretenberg/Noir backend.
 *
 * Public API exports for production use.
 * Dev-only code (profiler, test fixtures, orchestrator) is kept internal.
 */

// Polyfill Node.js Buffer for browser compatibility (required by @aztec/bb.js)
import { Buffer } from 'buffer';
if (typeof globalThis !== 'undefined' && !globalThis.Buffer) {
    (globalThis as any).Buffer = Buffer;
}

// Core prover API (single-tree district membership)
export {
    NoirProver,
    getProver,
    getProverForDepth,
    resetProverSingleton,
    resetProverForDepth,
} from './prover';

// Two-tree prover API (two-tree architecture: user tree + cell map tree)
export {
    TwoTreeNoirProver,
    getTwoTreeProverForDepth,
    resetTwoTreeProverSingleton,
    resetTwoTreeProverForDepth,
} from './two-tree-prover';

// Types - single-tree
export type { ProverConfig, ProofResult, CircuitInputs, CircuitDepth, AuthorityLevel } from './types';
export { DEFAULT_CIRCUIT_DEPTH, validateAuthorityLevel } from './types';

// Types - two-tree
export type {
    TwoTreeProverConfig,
    TwoTreeProofInput,
    TwoTreeProofResult,
    ProofOptions,
} from './types';
export { DISTRICT_SLOT_COUNT, TWO_TREE_PUBLIC_INPUT_COUNT } from './types';

// Three-tree prover API (three-tree architecture: user tree + cell map tree + engagement tree)
export {
    ThreeTreeNoirProver,
    getThreeTreeProverForDepth,
    resetThreeTreeProverSingleton,
    resetThreeTreeProverForDepth,
} from './three-tree-prover';

// Types - three-tree
export type {
    ThreeTreeProverConfig,
    ThreeTreeProofInput,
    ThreeTreeProofResult,
    EngagementTier,
} from './types';
export { THREE_TREE_PUBLIC_INPUT_COUNT, validateEngagementTier } from './types';

// Cross-origin isolation utilities (needed for SharedArrayBuffer support)
export { checkCrossOriginIsolation, requireCrossOriginIsolation } from './cross-origin-isolation';

