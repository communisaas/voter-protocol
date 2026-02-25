/**
 * PositionNoteNoirProver - ZK prover for debate settlement position notes
 *
 * Proves that a user owns a specific position commitment inside the position
 * Merkle tree and that position is on the winning argument, without revealing
 * WHICH commitment in the tree is theirs.
 *
 * SETTLEMENT FLOW:
 *   1. User called revealTrade; DebateMarket created a position commitment:
 *        commitment = H_PCM(argument_index, weighted_amount, randomness)
 *   2. Shadow-atlas inserted the commitment into the position Merkle tree;
 *      the root was stored on-chain.
 *   3. Debate resolved; user now calls settleTrade with this circuit's proof.
 *
 * CIRCUIT:
 *   - Single variant (depth=20, no depth parameter)
 *   - Artifact: circuits/position_note.json
 *   - Public inputs: 5 (POSITION_NOTE_PUBLIC_INPUT_COUNT)
 *     [0] position_root, [1] nullifier, [2] debate_id,
 *     [3] winning_argument_index, [4] claimed_weighted_amount
 *
 * DOMAIN SEPARATION (critical — no cross-circuit collision):
 *   DOMAIN_POS_COMMIT = 0x50434d ("PCM") — position commitment hash
 *   DOMAIN_POS_NUL    = 0x504e4c ("PNL") — position nullifier hash
 *   DOMAIN_HASH2      = 0x48324d ("H2M") — Merkle node hash (shared)
 *
 * SECURITY:
 *   - randomness must be non-zero (prevents predictable commitments)
 *   - nullifierKey must be non-zero (prevents predictable nullifiers)
 *   - All field inputs validated against BN254_MODULUS
 *   - positionPath length must be exactly POSITION_TREE_DEPTH (20)
 *   - positionIndex must be < 2^20 (range-checked in circuit)
 */

import { UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import type { CompiledCircuit } from '@noir-lang/noir_js';
import { Poseidon2Hasher } from '@voter-protocol/crypto';
import { BN254_MODULUS } from '@voter-protocol/crypto';
import type {
    PositionNoteProofInput,
    PositionNoteProofResult,
    ProofOptions,
} from './types';
import {
    POSITION_NOTE_PUBLIC_INPUT_COUNT,
    DOMAIN_POS_COMMIT,
    DOMAIN_POS_NUL,
    POSITION_TREE_DEPTH,
} from './types';

// ============================================================================
// Circuit Loader
// ============================================================================

function detectThreads(): number {
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
    if (!hasSharedArrayBuffer) {
        console.log('[PositionNoteNoirProver] SharedArrayBuffer unavailable - using single-threaded mode');
        return 1;
    }
    const cores = typeof navigator !== 'undefined'
        ? navigator.hardwareConcurrency || 4
        : 4;
    return Math.min(cores, 8);
}

async function loadPositionNoteCircuit(): Promise<CompiledCircuit> {
    const module = await import('../circuits/position_note.json');
    return module.default as unknown as CompiledCircuit;
}

// ============================================================================
// Poseidon2 Custom Domain Hash Helpers
// ============================================================================

/**
 * Compute position commitment using PCM domain tag.
 *
 * commitment = permute([argument_index, weighted_amount, randomness, DOMAIN_POS_COMMIT])[0]
 *
 * CRITICAL: Must match the Noir circuit's poseidon2_pos_commit function exactly:
 *   state: [Field; 4] = [argument_index, weighted_amount, randomness, DOMAIN_POS_COMMIT]
 *   out = poseidon2_permutation(state, 4)
 *   out[0]
 *
 * DOMAIN_POS_COMMIT = 0x50434d ("PCM") — distinct from H3M (0x48334d) used in
 * note_commitment by the debate_weight circuit. This prevents aliasing attacks
 * where a position commitment preimage could serve as an engagement hash preimage.
 *
 * Implementation uses Poseidon2Hasher.hash3WithDomain() — a raw 4-element
 * permutation call that accepts any domain tag, unlike hash3() which always
 * uses DOMAIN_HASH3 (0x48334d).
 */
async function computePositionCommitment(
    hasher: Poseidon2Hasher,
    argumentIndex: bigint,
    weightedAmount: bigint,
    randomness: bigint,
): Promise<bigint> {
    return hasher.hashWithCustomDomain3(argumentIndex, weightedAmount, randomness, DOMAIN_POS_COMMIT);
}

/**
 * Compute position nullifier using PNL domain tag.
 *
 * nullifier = permute([nullifier_key, commitment, debate_id, DOMAIN_POS_NUL])[0]
 *
 * CRITICAL: Must match the Noir circuit's poseidon2_pos_nullifier function exactly.
 * DOMAIN_POS_NUL = 0x504e4c ("PNL") — distinct from all other domain tags.
 */
async function computePositionNullifier(
    hasher: Poseidon2Hasher,
    nullifierKey: bigint,
    commitment: bigint,
    debateId: bigint,
): Promise<bigint> {
    return hasher.hashWithCustomDomain3(nullifierKey, commitment, debateId, DOMAIN_POS_NUL);
}

// ============================================================================
// Input Formatting Helpers
// ============================================================================

function toHex(value: bigint): string {
    if (value < 0n) {
        throw new Error('Field element cannot be negative');
    }
    if (value >= BN254_MODULUS) {
        throw new Error(`Field element ${value} exceeds BN254 scalar field modulus`);
    }
    return '0x' + value.toString(16).padStart(64, '0');
}

function parsePublicInput(hex: string, label: string): bigint {
    if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]+$/.test(hex)) {
        throw new Error(
            `BR5-006: Invalid public input format for ${label}: expected 0x-prefixed hex string, ` +
            `got ${typeof hex === 'string' ? `"${hex.slice(0, 20)}"` : typeof hex}`
        );
    }
    const val = BigInt(hex);
    if (val >= BN254_MODULUS) {
        throw new Error(
            `BR5-006: Public input ${label} (${val}) exceeds BN254 scalar field modulus. ` +
            `Possible field aliasing attack.`
        );
    }
    return val;
}

// ============================================================================
// PositionNoteNoirProver
// ============================================================================

export interface PositionNoteProverConfig {
    /** Number of threads for proving (default: auto-detect) */
    threads?: number;
}

export class PositionNoteNoirProver {
    private backend: UltraHonkBackend | null = null;
    private noir: Noir | null = null;
    private readonly threads: number;

    constructor(config: PositionNoteProverConfig = {}) {
        this.threads = config.threads ?? detectThreads();
    }

    // ========================================================================
    // Initialization
    // ========================================================================

    async init(): Promise<void> {
        if (this.backend && this.noir) return;

        console.log(`[PositionNoteNoirProver] Initializing with ${this.threads} thread(s)...`);
        const start = Date.now();

        const circuit = await loadPositionNoteCircuit();

        this.noir = new Noir(circuit);
        this.backend = new UltraHonkBackend(circuit.bytecode, { threads: this.threads });

        console.log(`[PositionNoteNoirProver] Initialized in ${Date.now() - start}ms (${this.threads} threads)`);
    }

    async warmup(): Promise<void> {
        await this.init();
        console.log('[PositionNoteNoirProver] Warmup complete (backend initialized)');
    }

    // ========================================================================
    // Input Validation
    // ========================================================================

    validateInputs(inputs: PositionNoteProofInput): void {
        // randomness must be non-zero (prevents predictable commitments)
        if (inputs.randomness === 0n) {
            throw new Error('randomness must be non-zero (prevents predictable position commitments)');
        }

        // nullifierKey must be non-zero (prevents predictable nullifiers)
        if (inputs.nullifierKey === 0n) {
            throw new Error('nullifierKey must be non-zero (prevents predictable nullifiers)');
        }

        // argumentIndex must be within field
        if (inputs.argumentIndex >= BN254_MODULUS) {
            throw new Error('argumentIndex exceeds BN254 scalar field modulus');
        }

        // weightedAmount must be non-zero and within field
        if (inputs.weightedAmount === 0n) {
            throw new Error('weightedAmount must be non-zero');
        }
        if (inputs.weightedAmount >= BN254_MODULUS) {
            throw new Error('weightedAmount exceeds BN254 scalar field modulus');
        }

        // randomness must be within field
        if (inputs.randomness >= BN254_MODULUS) {
            throw new Error('randomness exceeds BN254 scalar field modulus');
        }

        // nullifierKey must be within field
        if (inputs.nullifierKey >= BN254_MODULUS) {
            throw new Error('nullifierKey exceeds BN254 scalar field modulus');
        }

        // positionPath length must match circuit TREE_DEPTH
        if (inputs.positionPath.length !== POSITION_TREE_DEPTH) {
            throw new Error(
                `positionPath length must be ${POSITION_TREE_DEPTH} (circuit TREE_DEPTH), ` +
                `got ${inputs.positionPath.length}`
            );
        }

        // Validate all path elements are within field
        for (let i = 0; i < inputs.positionPath.length; i++) {
            if (inputs.positionPath[i] >= BN254_MODULUS) {
                throw new Error(
                    `positionPath[${i}] (${inputs.positionPath[i]}) exceeds BN254 scalar field modulus`
                );
            }
        }

        // positionIndex must be < 2^TREE_DEPTH (1_048_576)
        const maxIndex = 2 ** POSITION_TREE_DEPTH;
        if (!Number.isInteger(inputs.positionIndex) || inputs.positionIndex < 0 || inputs.positionIndex >= maxIndex) {
            throw new Error(
                `positionIndex must be an integer in [0, ${maxIndex - 1}], got ${inputs.positionIndex}`
            );
        }

        // positionRoot must be within field
        if (inputs.positionRoot >= BN254_MODULUS) {
            throw new Error('positionRoot exceeds BN254 scalar field modulus');
        }

        // debateId must be within field
        if (inputs.debateId >= BN254_MODULUS) {
            throw new Error('debateId exceeds BN254 scalar field modulus');
        }

        // winningArgumentIndex must be within field
        if (inputs.winningArgumentIndex >= BN254_MODULUS) {
            throw new Error('winningArgumentIndex exceeds BN254 scalar field modulus');
        }
    }

    // ========================================================================
    // Input Formatting
    // ========================================================================

    /**
     * Compute pre-circuit values and format all inputs for Noir.
     *
     * Pre-computation order:
     *   1. commitment = H_PCM(argumentIndex, weightedAmount, randomness)
     *   2. nullifier  = H_PNL(nullifierKey, commitment, debateId)
     *
     * These are passed as BOTH private witnesses (for Merkle path computation)
     * AND public inputs (the nullifier is public; commitment drives the path).
     */
    async formatInputs(inputs: PositionNoteProofInput): Promise<Record<string, unknown>> {
        const hasher = await Poseidon2Hasher.getInstance();

        // Compute position commitment (private, but drives Merkle path verification)
        const commitment = await computePositionCommitment(
            hasher,
            inputs.argumentIndex,
            inputs.weightedAmount,
            inputs.randomness,
        );

        // Compute nullifier (public output for on-chain double-claim prevention)
        const nullifier = await computePositionNullifier(
            hasher,
            inputs.nullifierKey,
            commitment,
            inputs.debateId,
        );

        return {
            // Private inputs (witnesses)
            argument_index: toHex(inputs.argumentIndex),
            weighted_amount: toHex(inputs.weightedAmount),
            randomness: toHex(inputs.randomness),
            nullifier_key: toHex(inputs.nullifierKey),
            position_path: inputs.positionPath.map(s => toHex(s)),
            position_index: inputs.positionIndex,
            // Public inputs (pre-computed for the circuit to verify)
            position_root: toHex(inputs.positionRoot),
            nullifier: toHex(nullifier),
            debate_id: toHex(inputs.debateId),
            winning_argument_index: toHex(inputs.winningArgumentIndex),
            claimed_weighted_amount: toHex(inputs.weightedAmount),
        };
    }

    /**
     * Compute the position commitment for an input tuple (for external use).
     *
     * commitment = H_PCM(argumentIndex, weightedAmount, randomness)
     *
     * This is the value that should be passed to shadow-atlas for insertion
     * into the position Merkle tree at revealTrade time.
     */
    async computeCommitment(
        argumentIndex: bigint,
        weightedAmount: bigint,
        randomness: bigint,
    ): Promise<bigint> {
        const hasher = await Poseidon2Hasher.getInstance();
        return computePositionCommitment(hasher, argumentIndex, weightedAmount, randomness);
    }

    /**
     * Compute the position nullifier (for external use / lookup).
     *
     * nullifier = H_PNL(nullifierKey, commitment, debateId)
     */
    async computeNullifier(
        nullifierKey: bigint,
        commitment: bigint,
        debateId: bigint,
    ): Promise<bigint> {
        const hasher = await Poseidon2Hasher.getInstance();
        return computePositionNullifier(hasher, nullifierKey, commitment, debateId);
    }

    // ========================================================================
    // Proof Generation
    // ========================================================================

    async generateProof(
        inputs: PositionNoteProofInput,
        options?: ProofOptions,
    ): Promise<PositionNoteProofResult> {
        // Validate inputs before heavy init() call
        this.validateInputs(inputs);

        await this.init();

        const mode = options?.keccak ? 'keccak (on-chain)' : 'default (off-chain)';
        console.log(`[PositionNoteNoirProver] Generating witness... (mode: ${mode})`);
        const witnessStart = Date.now();

        const noirInputs = await this.formatInputs(inputs);

        const { witness } = await this.noir!.execute(noirInputs as any);
        console.log(`[PositionNoteNoirProver] Witness generated in ${Date.now() - witnessStart}ms`);

        console.log('[PositionNoteNoirProver] Generating proof...');
        const proofStart = Date.now();

        const { proof, publicInputs } = options?.keccak
            ? await this.backend!.generateProof(witness, { keccak: true })
            : await this.backend!.generateProof(witness);

        console.log(`[PositionNoteNoirProver] Proof generated in ${Date.now() - proofStart}ms (${proof.length} bytes)`);

        if (publicInputs.length !== POSITION_NOTE_PUBLIC_INPUT_COUNT) {
            throw new Error(
                `Unexpected public input count: expected ${POSITION_NOTE_PUBLIC_INPUT_COUNT}, ` +
                `got ${publicInputs.length}`
            );
        }

        return { proof, publicInputs };
    }

    // ========================================================================
    // Proof Verification
    // ========================================================================

    async verifyProof(proofResult: PositionNoteProofResult, options?: ProofOptions): Promise<boolean> {
        if (proofResult.publicInputs.length !== POSITION_NOTE_PUBLIC_INPUT_COUNT) {
            throw new Error(
                `BR5-006: Public input count mismatch: expected ${POSITION_NOTE_PUBLIC_INPUT_COUNT}, ` +
                `got ${proofResult.publicInputs.length}. Possible proof tampering.`
            );
        }

        await this.init();

        const proofData = {
            proof: proofResult.proof,
            publicInputs: proofResult.publicInputs,
        };

        return options?.keccak
            ? this.backend!.verifyProof(proofData, { keccak: true })
            : this.backend!.verifyProof(proofData);
    }

    /**
     * Verify proof and assert public inputs match expected values.
     *
     * Use this when the caller needs to bind the proof to specific
     * (positionRoot, debateId, winningArgumentIndex, weightedAmount) values,
     * guarding against input substitution (BR5-006).
     *
     * @param proofResult - The proof and public inputs to verify
     * @param expectedInputs - The original inputs used to generate the proof
     * @param options - Proof options (keccak mode)
     * @returns true if proof is valid AND public inputs match
     * @throws Error if public inputs do not match expected values
     */
    async verifyProofWithExpectedInputs(
        proofResult: PositionNoteProofResult,
        expectedInputs: PositionNoteProofInput,
        options?: ProofOptions,
    ): Promise<boolean> {
        const valid = await this.verifyProof(proofResult, options);
        if (!valid) return false;

        // BR5-006: Bind public inputs to expected values.
        // Public input layout:
        //   [0] position_root, [1] nullifier, [2] debate_id,
        //   [3] winning_argument_index, [4] claimed_weighted_amount
        const pi = proofResult.publicInputs;

        const actualPositionRoot = parsePublicInput(pi[0], 'position_root[0]');
        if (actualPositionRoot !== expectedInputs.positionRoot) {
            throw new Error(
                `BR5-006: Public input mismatch at index 0 (position_root): ` +
                `expected ${expectedInputs.positionRoot}, got ${actualPositionRoot}`
            );
        }

        // Recompute expected nullifier
        const hasher = await Poseidon2Hasher.getInstance();
        const commitment = await computePositionCommitment(
            hasher,
            expectedInputs.argumentIndex,
            expectedInputs.weightedAmount,
            expectedInputs.randomness,
        );
        const expectedNullifier = await computePositionNullifier(
            hasher,
            expectedInputs.nullifierKey,
            commitment,
            expectedInputs.debateId,
        );

        const actualNullifier = parsePublicInput(pi[1], 'nullifier[1]');
        if (actualNullifier !== expectedNullifier) {
            throw new Error(
                `BR5-006: Public input mismatch at index 1 (nullifier): ` +
                `expected ${expectedNullifier}, got ${actualNullifier}`
            );
        }

        const actualDebateId = parsePublicInput(pi[2], 'debate_id[2]');
        if (actualDebateId !== expectedInputs.debateId) {
            throw new Error(
                `BR5-006: Public input mismatch at index 2 (debate_id): ` +
                `expected ${expectedInputs.debateId}, got ${actualDebateId}`
            );
        }

        const actualWinningArg = parsePublicInput(pi[3], 'winning_argument_index[3]');
        if (actualWinningArg !== expectedInputs.winningArgumentIndex) {
            throw new Error(
                `BR5-006: Public input mismatch at index 3 (winning_argument_index): ` +
                `expected ${expectedInputs.winningArgumentIndex}, got ${actualWinningArg}`
            );
        }

        const actualClaimedAmount = parsePublicInput(pi[4], 'claimed_weighted_amount[4]');
        if (actualClaimedAmount !== expectedInputs.weightedAmount) {
            throw new Error(
                `BR5-006: Public input mismatch at index 4 (claimed_weighted_amount): ` +
                `expected ${expectedInputs.weightedAmount}, got ${actualClaimedAmount}`
            );
        }

        return true;
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

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

let positionNoteProverInstance: PositionNoteNoirProver | null = null;
let positionNoteInitPromise: Promise<PositionNoteNoirProver> | null = null;

export async function getPositionNoteProver(
    config?: PositionNoteProverConfig,
): Promise<PositionNoteNoirProver> {
    if (positionNoteProverInstance) return positionNoteProverInstance;

    if (positionNoteInitPromise) return positionNoteInitPromise;

    // Register promise synchronously before any async work (HIGH-003 pattern)
    let resolveInit: (prover: PositionNoteNoirProver) => void;
    let rejectInit: (error: Error) => void;

    const initPromise = new Promise<PositionNoteNoirProver>((resolve, reject) => {
        resolveInit = resolve;
        rejectInit = reject;
    });

    positionNoteInitPromise = initPromise;

    (async () => {
        try {
            const prover = new PositionNoteNoirProver(config);
            await prover.init();
            positionNoteProverInstance = prover;
            positionNoteInitPromise = null;
            resolveInit!(prover);
        } catch (err) {
            positionNoteInitPromise = null;
            rejectInit!(err instanceof Error ? err : new Error(String(err)));
        }
    })();

    return initPromise;
}

export async function resetPositionNoteProverSingleton(): Promise<void> {
    if (positionNoteProverInstance) {
        await positionNoteProverInstance.destroy();
        positionNoteProverInstance = null;
    }
    positionNoteInitPromise = null;
}
