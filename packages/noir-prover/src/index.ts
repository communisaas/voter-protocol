/**
 * @voter-protocol/noir-prover
 * 
 * Browser-native ZK prover using Barretenberg/Noir backend.
 */

// Polyfill Node.js Buffer for browser compatibility (required by @aztec/bb.js)
import { Buffer } from 'buffer';
if (typeof globalThis !== 'undefined' && !globalThis.Buffer) {
    (globalThis as any).Buffer = Buffer;
}

export { NoirProver } from './prover';
export type { ProverConfig, ProofResult, CircuitInputs } from './types';
export { checkCrossOriginIsolation, requireCrossOriginIsolation } from './cross-origin-isolation';

