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

// Core prover API
export {
    NoirProver,
    getProver,
    getProverForDepth,
    resetProverSingleton,
    resetProverForDepth,
} from './prover';
export type { ProverConfig, ProofResult, CircuitInputs, CircuitDepth, AuthorityLevel } from './types';
export { DEFAULT_CIRCUIT_DEPTH, validateAuthorityLevel } from './types';

// Cross-origin isolation utilities (needed for SharedArrayBuffer support)
export { checkCrossOriginIsolation, requireCrossOriginIsolation } from './cross-origin-isolation';

