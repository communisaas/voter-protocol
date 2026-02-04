/**
 * NoirProver - Browser-native ZK prover using Barretenberg
 *
 * Uses @noir-lang/noir_js for witness generation and @aztec/bb.js for proving.
 * Supports multithreaded proving when SharedArrayBuffer is available.
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
import type { ProverConfig, CircuitInputs, ProofResult, CircuitDepth, AuthorityLevel } from './types';
import { DEFAULT_CIRCUIT_DEPTH, PUBLIC_INPUT_COUNT, validateAuthorityLevel } from './types';

/**
 * Lazy circuit loaders - only imports circuit when needed
 * This prevents loading all circuits upfront, reducing initial bundle size
 */
const circuitLoaders: Record<CircuitDepth, () => Promise<CompiledCircuit>> = {
    18: async () => {
        const module = await import('../circuits/district_membership_18.json');
        return module.default as unknown as CompiledCircuit;
    },
    20: async () => {
        const module = await import('../circuits/district_membership_20.json');
        return module.default as unknown as CompiledCircuit;
    },
    22: async () => {
        const module = await import('../circuits/district_membership_22.json');
        return module.default as unknown as CompiledCircuit;
    },
    24: async () => {
        const module = await import('../circuits/district_membership_24.json');
        return module.default as unknown as CompiledCircuit;
    },
};

/**
 * Detect optimal thread count for proving
 * Returns 1 if SharedArrayBuffer is unavailable (no multithreading support)
 */
function detectThreads(): number {
    // Check for SharedArrayBuffer support (required for multithreading)
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';

    if (!hasSharedArrayBuffer) {
        console.log('[NoirProver] SharedArrayBuffer unavailable - using single-threaded mode');
        return 1;
    }

    // Use hardware concurrency, capped at reasonable limits
    const cores = typeof navigator !== 'undefined'
        ? navigator.hardwareConcurrency || 4
        : 4;

    // Cap at 8 threads - diminishing returns beyond this for ZK proving
    return Math.min(cores, 8);
}

export class NoirProver {
    private backend: UltraHonkBackend | null = null;
    private noir: Noir | null = null;
    private config: ProverConfig;
    private threads: number;
    private readonly depth: CircuitDepth;

    constructor(config: ProverConfig = {}) {
        this.config = {
            circuitName: 'district_membership',
            ...config,
        };
        // Determine thread count: explicit config > auto-detect
        this.threads = config.threads ?? detectThreads();
        // Set circuit depth with default fallback
        this.depth = config.depth ?? DEFAULT_CIRCUIT_DEPTH;
    }

    /**
     * Initialize the prover (must be called before generating proofs)
     * Lazily loads the circuit for the configured depth
     */
    async init(): Promise<void> {
        if (this.backend && this.noir) return; // Already initialized

        console.log(`[NoirProver] Initializing depth=${this.depth} with ${this.threads} thread(s)...`);
        const start = Date.now();

        // Lazy-load circuit for configured depth
        const loader = circuitLoaders[this.depth];
        if (!loader) {
            throw new Error(`Unsupported circuit depth: ${this.depth}. Must be 18, 20, 22, or 24.`);
        }
        const circuit = await loader();

        // Initialize Noir for witness generation
        this.noir = new Noir(circuit);

        // Initialize UltraHonk backend for proving with thread configuration
        // threads > 1 enables parallel proving using Web Workers internally
        this.backend = new UltraHonkBackend(circuit.bytecode, { threads: this.threads });

        console.log(`[NoirProver] Initialized depth=${this.depth} in ${Date.now() - start}ms (${this.threads} threads)`);
    }

    /**
     * Get the circuit depth for this prover instance
     */
    getDepth(): CircuitDepth {
        return this.depth;
    }

    /**
     * Pre-warm the prover by initializing backend
     * Call this on app load to hide latency from user
     */
    async warmup(): Promise<void> {
        await this.init();
        console.log('[NoirProver] Warmup complete (backend initialized)');
    }

    /** Maximum allowed Merkle depth (prevents DoS via oversized arrays) */
    private static readonly MAX_MERKLE_DEPTH = 24;

    /**
     * Generate a ZK proof for district membership
     *
     * The new secure circuit computes leaf and nullifier internally:
     * - leaf = hash(userSecret, districtId, authorityLevel, registrationSalt)
     * - nullifier = hash(userSecret, actionDomain)
     *
     * This prevents attackers from submitting arbitrary leaves or nullifiers.
     */
    async prove(inputs: CircuitInputs): Promise<ProofResult> {
        await this.init();

        // HIGH-005 FIX: Upfront check to prevent DoS via oversized merkle_path arrays
        // Must happen BEFORE any processing to prevent memory exhaustion attacks
        if (!Array.isArray(inputs.merklePath)) {
            throw new Error('merklePath must be an array');
        }
        if (inputs.merklePath.length > NoirProver.MAX_MERKLE_DEPTH) {
            throw new Error(
                `merklePath exceeds maximum allowed depth: ${inputs.merklePath.length} > ${NoirProver.MAX_MERKLE_DEPTH}`
            );
        }
        // Validate path length matches configured depth
        if (inputs.merklePath.length !== this.depth) {
            throw new Error(
                `merklePath length mismatch: expected ${this.depth}, got ${inputs.merklePath.length}. ` +
                `Did you initialize the prover with the wrong depth?`
            );
        }

        // Validate authority level before proving
        validateAuthorityLevel(inputs.authorityLevel);

        console.log('[NoirProver] Generating witness...');
        const witnessStart = Date.now();

        // Map TypeScript inputs to Noir circuit parameter names (snake_case)
        // The circuit computes leaf and nullifier internally for security:
        // - leaf = hash(user_secret, district_id, authority_level, registration_salt)
        // - nullifier = hash(user_secret, action_domain)
        const noirInputs = {
            // Public inputs (contract-controlled)
            merkle_root: inputs.merkleRoot,
            action_domain: inputs.actionDomain,

            // Private inputs (user secrets - never revealed)
            user_secret: inputs.userSecret,
            district_id: inputs.districtId,
            authority_level: inputs.authorityLevel.toString(),
            registration_salt: inputs.registrationSalt,

            // Merkle proof data
            merkle_path: inputs.merklePath,
            leaf_index: inputs.leafIndex,
        };

        const { witness } = await this.noir!.execute(noirInputs);
        console.log(`[NoirProver] Witness generated in ${Date.now() - witnessStart}ms`);

        console.log('[NoirProver] Generating proof...');
        const proofStart = Date.now();

        // Generate proof using UltraHonk backend
        const { proof, publicInputs } = await this.backend!.generateProof(witness);

        console.log(`[NoirProver] Proof generated in ${Date.now() - proofStart}ms`);

        // BR3-002 FIX: Validate public input count before extraction
        // Prevents silent fallback to caller-provided values when circuit returns wrong count
        if (publicInputs.length !== PUBLIC_INPUT_COUNT) {
            throw new Error(
                `Expected ${PUBLIC_INPUT_COUNT} public inputs from circuit, got ${publicInputs.length}`
            );
        }

        // Extract public inputs from proof result
        // The order matches the circuit's return statement:
        // pub (merkle_root, nullifier, authority_level, action_domain, district_id)
        //
        // Note: nullifier is COMPUTED by the circuit, not passed in
        // publicInputs[2] guaranteed to exist after count check above
        const rawAuthorityLevel = parseInt(publicInputs[2], 16) || parseInt(publicInputs[2], 10);

        return {
            proof,
            publicInputs: {
                merkleRoot: publicInputs[0],
                nullifier: publicInputs[1],
                authorityLevel: validateAuthorityLevel(rawAuthorityLevel),
                actionDomain: publicInputs[3],
                districtId: publicInputs[4],
            },
        };
    }

    /**
     * Verify a proof
     */
    async verify(proof: Uint8Array, publicInputs: string[]): Promise<boolean> {
        await this.init();
        return this.backend!.verifyProof({ proof, publicInputs });
    }

    /**
     * Clean up resources
     */
    async destroy(): Promise<void> {
        if (this.backend) {
            await this.backend.destroy();
            this.backend = null;
            this.noir = null;
        }
    }
}

/**
 * Depth-aware singleton pattern for NoirProver
 * Maintains one instance per circuit depth to prevent memory leaks
 */
const proverInstances: Map<CircuitDepth, NoirProver> = new Map();
const initializationPromises: Map<CircuitDepth, Promise<NoirProver>> = new Map();

/**
 * Get or create a NoirProver instance for the specified depth
 * Safe for concurrent calls - deduplicates initialization per depth
 *
 * @param depth - Circuit depth (18, 20, 22, or 24). Defaults to 20.
 * @param config - Optional prover configuration (threads, etc.)
 */
export async function getProverForDepth(
    depth: CircuitDepth = DEFAULT_CIRCUIT_DEPTH,
    config?: Omit<ProverConfig, 'depth'>
): Promise<NoirProver> {
    // Return existing instance if already initialized for this depth
    const existingInstance = proverInstances.get(depth);
    if (existingInstance) {
        return existingInstance;
    }

    // Return in-progress initialization if concurrent call for same depth
    const existingPromise = initializationPromises.get(depth);
    if (existingPromise) {
        return existingPromise;
    }

    // HIGH-003 FIX: Create promise wrapper BEFORE starting async initialization
    // Previous code had a race condition where the IIFE started executing before
    // initializationPromises.set() was called, allowing concurrent calls to start
    // duplicate initializations in the window between IIFE start and set() call.
    //
    // Solution: Use promise resolve/reject callbacks to register promise synchronously
    // BEFORE any async work begins, eliminating the race window.
    let resolveInit: (prover: NoirProver) => void;
    let rejectInit: (error: Error) => void;

    const initPromise = new Promise<NoirProver>((resolve, reject) => {
        resolveInit = resolve;
        rejectInit = reject;
    });

    // Register promise SYNCHRONOUSLY before any async work
    initializationPromises.set(depth, initPromise);

    // Now start async initialization - concurrent calls will await initPromise above
    (async () => {
        try {
            const prover = new NoirProver({ ...config, depth });
            await prover.init();
            proverInstances.set(depth, prover);
            initializationPromises.delete(depth); // Clear promise after success
            resolveInit!(prover);
        } catch (err) {
            // SA-006: Clear failed promise so subsequent calls can retry
            initializationPromises.delete(depth);
            rejectInit!(err instanceof Error ? err : new Error(String(err)));
        }
    })();

    return initPromise;
}

/**
 * Get or create the default NoirProver instance (depth=20)
 * Backward-compatible API - equivalent to getProverForDepth(20)
 *
 * @param config - Optional prover configuration
 * @deprecated Use getProverForDepth() for explicit depth control
 */
export async function getProver(config?: ProverConfig): Promise<NoirProver> {
    const depth = config?.depth ?? DEFAULT_CIRCUIT_DEPTH;
    return getProverForDepth(depth, config);
}

/**
 * Reset all singleton instances (for testing or page unload)
 */
export async function resetProverSingleton(): Promise<void> {
    // Destroy all instances
    const destroyPromises = Array.from(proverInstances.values()).map(
        (prover) => prover.destroy()
    );
    await Promise.all(destroyPromises);

    proverInstances.clear();
    initializationPromises.clear();
}

/**
 * Reset a specific depth's singleton instance
 *
 * @param depth - Circuit depth to reset
 */
export async function resetProverForDepth(depth: CircuitDepth): Promise<void> {
    const prover = proverInstances.get(depth);
    if (prover) {
        await prover.destroy();
        proverInstances.delete(depth);
    }
    initializationPromises.delete(depth);
}
