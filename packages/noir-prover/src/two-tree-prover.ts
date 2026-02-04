/**
 * TwoTreeNoirProver - ZK prover for the two-tree architecture
 *
 * Proves that a user belongs to a geographic cell (Tree 1) that maps to a
 * specific set of 24 districts (Tree 2). This is the two-tree evolution of
 * the single-tree district_membership circuit.
 *
 * Uses @noir-lang/noir_js for witness generation and @aztec/bb.js for proving.
 * Supports multithreaded proving when SharedArrayBuffer is available.
 *
 * ARCHITECTURE:
 * - Tree 1 (User Tree): Standard Merkle tree.
 *   Leaf = H3(user_secret, cell_id, registration_salt)
 * - Tree 2 (Cell Map): Sparse Merkle tree.
 *   Leaf = H2(cell_id, district_commitment)
 *   where district_commitment = poseidon2_sponge_24(districts)
 *
 * CIRCUIT DEPTHS:
 * - 18: Small municipal (~260K leaves)
 * - 20: State/large municipal (~1M leaves) - DEFAULT
 * - 22: Federal (~4M leaves)
 * - 24: National (~16M leaves)
 */

import { UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import type { CompiledCircuit } from '@noir-lang/noir_js';
import { BN254_MODULUS } from '@voter-protocol/crypto';
import type {
    TwoTreeProverConfig,
    TwoTreeProofInput,
    TwoTreeProofResult,
    CircuitDepth,
} from './types';
import {
    DEFAULT_CIRCUIT_DEPTH,
    DISTRICT_SLOT_COUNT,
    TWO_TREE_PUBLIC_INPUT_COUNT,
    validateAuthorityLevel,
} from './types';

// ============================================================================
// Circuit Loaders
// ============================================================================

/**
 * Lazy circuit loaders - only imports circuit when needed.
 * This prevents loading all circuits upfront, reducing initial bundle size.
 */
const twoTreeCircuitLoaders: Record<CircuitDepth, () => Promise<CompiledCircuit>> = {
    18: async () => {
        const module = await import('../circuits/two_tree_membership_18.json');
        return module.default as unknown as CompiledCircuit;
    },
    20: async () => {
        const module = await import('../circuits/two_tree_membership_20.json');
        return module.default as unknown as CompiledCircuit;
    },
    22: async () => {
        const module = await import('../circuits/two_tree_membership_22.json');
        return module.default as unknown as CompiledCircuit;
    },
    24: async () => {
        const module = await import('../circuits/two_tree_membership_24.json');
        return module.default as unknown as CompiledCircuit;
    },
};

// ============================================================================
// Thread Detection
// ============================================================================

/**
 * Detect optimal thread count for proving.
 * Returns 1 if SharedArrayBuffer is unavailable (no multithreading support).
 */
function detectThreads(): number {
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';

    if (!hasSharedArrayBuffer) {
        console.log('[TwoTreeNoirProver] SharedArrayBuffer unavailable - using single-threaded mode');
        return 1;
    }

    const cores = typeof navigator !== 'undefined'
        ? navigator.hardwareConcurrency || 4
        : 4;

    return Math.min(cores, 8);
}

// ============================================================================
// Input Formatting
// ============================================================================

/**
 * Convert a bigint to a 0x-prefixed 64-character hex string suitable for
 * Noir circuit input.
 *
 * BR3-003 FIX: Validates that the value is within the BN254 scalar field.
 * Values >= modulus would be silently reduced by the Noir runtime, creating
 * field aliasing attacks where x and x+modulus produce identical circuit behavior.
 *
 * @throws {Error} If value is negative or >= BN254_MODULUS
 */
function toHex(value: bigint): string {
    if (value < 0n) {
        throw new Error('Field element cannot be negative');
    }
    if (value >= BN254_MODULUS) {
        throw new Error(`Field element ${value} exceeds BN254 scalar field modulus`);
    }
    return '0x' + value.toString(16).padStart(64, '0');
}

// ============================================================================
// TwoTreeNoirProver
// ============================================================================

export class TwoTreeNoirProver {
    private backend: UltraHonkBackend | null = null;
    private noir: Noir | null = null;
    private readonly threads: number;
    private readonly depth: CircuitDepth;

    constructor(config: TwoTreeProverConfig = {}) {
        this.threads = config.threads ?? detectThreads();
        this.depth = config.depth ?? DEFAULT_CIRCUIT_DEPTH;
    }

    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize the prover (must be called before generating proofs).
     * Lazily loads the circuit for the configured depth.
     */
    async init(): Promise<void> {
        if (this.backend && this.noir) return; // Already initialized

        console.log(`[TwoTreeNoirProver] Initializing depth=${this.depth} with ${this.threads} thread(s)...`);
        const start = Date.now();

        const loader = twoTreeCircuitLoaders[this.depth];
        if (!loader) {
            throw new Error(`Unsupported circuit depth: ${this.depth}. Must be 18, 20, 22, or 24.`);
        }
        const circuit = await loader();

        this.noir = new Noir(circuit);
        this.backend = new UltraHonkBackend(circuit.bytecode, { threads: this.threads });

        console.log(`[TwoTreeNoirProver] Initialized depth=${this.depth} in ${Date.now() - start}ms (${this.threads} threads)`);
    }

    /**
     * Get the circuit depth for this prover instance.
     */
    getDepth(): CircuitDepth {
        return this.depth;
    }

    /**
     * Pre-warm the prover by initializing backend.
     * Call this on app load to hide latency from user.
     */
    async warmup(): Promise<void> {
        await this.init();
        console.log('[TwoTreeNoirProver] Warmup complete (backend initialized)');
    }

    // ========================================================================
    // Input Validation
    // ========================================================================

    /** Maximum allowed Merkle depth (prevents DoS via oversized arrays) */
    private static readonly MAX_MERKLE_DEPTH = 24;

    /**
     * Validate all inputs before circuit execution.
     * Throws descriptive errors for any invalid input.
     */
    validateInputs(inputs: TwoTreeProofInput): void {
        // SA-011: Reject zero user_secret
        if (inputs.userSecret === 0n) {
            throw new Error(
                'user_secret cannot be zero (SA-011). A zero secret produces predictable nullifiers.'
            );
        }

        // BR3-005: Reject zero values for critical fields
        if (inputs.cellId === 0n) {
            throw new Error(
                'cell_id cannot be zero. A zero cell ID produces a degenerate cell map leaf.'
            );
        }
        if (inputs.actionDomain === 0n) {
            throw new Error(
                'action_domain cannot be zero. A zero action domain produces a universal nullifier ' +
                'that would be consumed across ALL elections, permanently blocking the user.'
            );
        }
        if (inputs.registrationSalt === 0n) {
            throw new Error(
                'registration_salt cannot be zero. A zero salt reduces leaf preimage entropy.'
            );
        }

        // Validate authority level range
        validateAuthorityLevel(inputs.authorityLevel);

        // Validate districts array length
        if (!Array.isArray(inputs.districts) || inputs.districts.length !== DISTRICT_SLOT_COUNT) {
            throw new Error(
                `districts array must have exactly ${DISTRICT_SLOT_COUNT} elements, got ${inputs.districts?.length ?? 'non-array'}`
            );
        }

        // Validate userPath (Tree 1 Merkle siblings)
        if (!Array.isArray(inputs.userPath)) {
            throw new Error('userPath must be an array');
        }
        if (inputs.userPath.length > TwoTreeNoirProver.MAX_MERKLE_DEPTH) {
            throw new Error(
                `userPath exceeds maximum allowed depth: ${inputs.userPath.length} > ${TwoTreeNoirProver.MAX_MERKLE_DEPTH}`
            );
        }
        if (inputs.userPath.length !== this.depth) {
            throw new Error(
                `userPath length mismatch: expected ${this.depth}, got ${inputs.userPath.length}. ` +
                `Did you initialize the prover with the wrong depth?`
            );
        }

        // Validate cellMapPath (Tree 2 SMT siblings)
        if (!Array.isArray(inputs.cellMapPath)) {
            throw new Error('cellMapPath must be an array');
        }
        if (inputs.cellMapPath.length !== this.depth) {
            throw new Error(
                `cellMapPath length mismatch: expected ${this.depth}, got ${inputs.cellMapPath.length}`
            );
        }

        // Validate cellMapPathBits (Tree 2 SMT direction bits)
        if (!Array.isArray(inputs.cellMapPathBits)) {
            throw new Error('cellMapPathBits must be an array');
        }
        if (inputs.cellMapPathBits.length !== this.depth) {
            throw new Error(
                `cellMapPathBits length mismatch: expected ${this.depth}, got ${inputs.cellMapPathBits.length}`
            );
        }
        // Validate each bit is 0 or 1
        for (let i = 0; i < inputs.cellMapPathBits.length; i++) {
            if (inputs.cellMapPathBits[i] !== 0 && inputs.cellMapPathBits[i] !== 1) {
                throw new Error(
                    `cellMapPathBits[${i}] must be 0 or 1, got ${inputs.cellMapPathBits[i]}`
                );
            }
        }

        // Validate userIndex range
        if (inputs.userIndex < 0 || inputs.userIndex >= 2 ** this.depth) {
            throw new Error(
                `userIndex out of range: must be 0 to ${2 ** this.depth - 1}, got ${inputs.userIndex}`
            );
        }
    }

    // ========================================================================
    // Input Formatting
    // ========================================================================

    /**
     * Format TypeScript inputs into the Noir circuit's expected parameter names
     * and types (snake_case, hex strings, integer arrays).
     *
     * This is exposed as a method for testing purposes.
     */
    formatInputs(inputs: TwoTreeProofInput): Record<string, unknown> {
        return {
            // Public inputs
            user_root: toHex(inputs.userRoot),
            cell_map_root: toHex(inputs.cellMapRoot),
            districts: inputs.districts.map(toHex),
            nullifier: toHex(inputs.nullifier),
            action_domain: toHex(inputs.actionDomain),
            authority_level: inputs.authorityLevel.toString(),

            // Private inputs (witnesses)
            user_secret: toHex(inputs.userSecret),
            cell_id: toHex(inputs.cellId),
            registration_salt: toHex(inputs.registrationSalt),

            // Tree 1: Standard Merkle proof
            user_path: inputs.userPath.map(toHex),
            user_index: inputs.userIndex,

            // Tree 2: SMT proof
            cell_map_path: inputs.cellMapPath.map(toHex),
            cell_map_path_bits: inputs.cellMapPathBits,
        };
    }

    // ========================================================================
    // Proof Generation
    // ========================================================================

    /**
     * Generate a ZK proof for two-tree membership.
     *
     * The circuit internally verifies:
     * 1. User leaf in Tree 1: hash3(user_secret, cell_id, registration_salt)
     * 2. District commitment: poseidon2_sponge_24(districts)
     * 3. Cell map leaf in Tree 2: hash2(cell_id, district_commitment)
     * 4. Nullifier: hash2(user_secret, action_domain)
     * 5. Authority level in [1, 5]
     *
     * @param inputs - All public and private inputs for the circuit
     * @returns Proof bytes and public inputs as hex strings
     */
    async generateProof(inputs: TwoTreeProofInput): Promise<TwoTreeProofResult> {
        // BR3-006: Validate inputs before heavy init() call
        this.validateInputs(inputs);

        await this.init();

        console.log('[TwoTreeNoirProver] Generating witness...');
        const witnessStart = Date.now();

        // Format inputs for the Noir circuit
        const noirInputs = this.formatInputs(inputs);

        const { witness } = await this.noir!.execute(noirInputs as any);
        console.log(`[TwoTreeNoirProver] Witness generated in ${Date.now() - witnessStart}ms`);

        console.log('[TwoTreeNoirProver] Generating proof...');
        const proofStart = Date.now();

        const { proof, publicInputs } = await this.backend!.generateProof(witness);

        console.log(`[TwoTreeNoirProver] Proof generated in ${Date.now() - proofStart}ms`);

        // Validate public input count
        if (publicInputs.length !== TWO_TREE_PUBLIC_INPUT_COUNT) {
            throw new Error(
                `Unexpected public input count: expected ${TWO_TREE_PUBLIC_INPUT_COUNT}, ` +
                `got ${publicInputs.length}`
            );
        }

        return {
            proof,
            publicInputs,
        };
    }

    // ========================================================================
    // Proof Verification
    // ========================================================================

    /**
     * Verify a two-tree membership proof.
     *
     * @param proofResult - The proof result from generateProof()
     * @returns true if the proof is valid
     */
    async verifyProof(proofResult: TwoTreeProofResult): Promise<boolean> {
        await this.init();
        return this.backend!.verifyProof({
            proof: proofResult.proof,
            publicInputs: proofResult.publicInputs,
        });
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Clean up resources (WASM memory, web workers).
     */
    async destroy(): Promise<void> {
        if (this.backend) {
            await this.backend.destroy();
            this.backend = null;
            this.noir = null;
        }
    }
}

// ============================================================================
// Singleton Management
// ============================================================================

/**
 * Depth-aware singleton pattern for TwoTreeNoirProver.
 * Maintains one instance per circuit depth to prevent memory leaks.
 */
const twoTreeProverInstances: Map<CircuitDepth, TwoTreeNoirProver> = new Map();
const twoTreeInitPromises: Map<CircuitDepth, Promise<TwoTreeNoirProver>> = new Map();

/**
 * Get or create a TwoTreeNoirProver instance for the specified depth.
 * Safe for concurrent calls - deduplicates initialization per depth.
 *
 * @param depth - Circuit depth (18, 20, 22, or 24). Defaults to 20.
 * @param config - Optional prover configuration (threads, etc.)
 */
export async function getTwoTreeProverForDepth(
    depth: CircuitDepth = DEFAULT_CIRCUIT_DEPTH,
    config?: Omit<TwoTreeProverConfig, 'depth'>
): Promise<TwoTreeNoirProver> {
    const existing = twoTreeProverInstances.get(depth);
    if (existing) {
        return existing;
    }

    const existingPromise = twoTreeInitPromises.get(depth);
    if (existingPromise) {
        return existingPromise;
    }

    // HIGH-003 FIX: Register promise synchronously before any async work
    let resolveInit: (prover: TwoTreeNoirProver) => void;
    let rejectInit: (error: Error) => void;

    const initPromise = new Promise<TwoTreeNoirProver>((resolve, reject) => {
        resolveInit = resolve;
        rejectInit = reject;
    });

    twoTreeInitPromises.set(depth, initPromise);

    (async () => {
        try {
            const prover = new TwoTreeNoirProver({ ...config, depth });
            await prover.init();
            twoTreeProverInstances.set(depth, prover);
            twoTreeInitPromises.delete(depth);
            resolveInit!(prover);
        } catch (err) {
            twoTreeInitPromises.delete(depth);
            rejectInit!(err instanceof Error ? err : new Error(String(err)));
        }
    })();

    return initPromise;
}

/**
 * Reset all two-tree singleton instances (for testing or page unload).
 */
export async function resetTwoTreeProverSingleton(): Promise<void> {
    const destroyPromises = Array.from(twoTreeProverInstances.values()).map(
        (prover) => prover.destroy()
    );
    await Promise.all(destroyPromises);

    twoTreeProverInstances.clear();
    twoTreeInitPromises.clear();
}

/**
 * Reset a specific depth's two-tree singleton instance.
 *
 * @param depth - Circuit depth to reset
 */
export async function resetTwoTreeProverForDepth(depth: CircuitDepth): Promise<void> {
    const prover = twoTreeProverInstances.get(depth);
    if (prover) {
        await prover.destroy();
        twoTreeProverInstances.delete(depth);
    }
    twoTreeInitPromises.delete(depth);
}
