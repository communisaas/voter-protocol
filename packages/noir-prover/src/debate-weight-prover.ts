/**
 * DebateWeightNoirProver - ZK prover for debate position weighting
 *
 * Proves that a debater's weighted influence amount is correctly derived from
 * their private stake and engagement tier:
 *
 *   weightedAmount = floor(sqrt(stake)) * 2^tier
 *
 * And binds the result to a Poseidon2 note commitment:
 *
 *   noteCommitment = H3(stake, tier, randomness)
 *
 * This enables private position trading in the DebateMarket contract.
 * The stake and tier remain private; only weightedAmount and noteCommitment
 * are revealed on-chain.
 *
 * CIRCUIT:
 *   - Single variant (no depth parameter — no Merkle trees)
 *   - Artifact: circuits/debate_weight.json
 *   - Public inputs: 2 (DEBATE_WEIGHT_PUBLIC_INPUT_COUNT)
 *
 * SECURITY:
 *   - sqrt_stake is computed off-circuit and passed as a witness
 *   - The circuit verifies root^2 <= stake AND (root+1)^2 > stake
 *   - u64 arithmetic is safe: max stake = 100_000_000 << 2^64
 *   - Note commitment uses H3 with DOMAIN_HASH3 (0x48334d) for domain separation
 */

import { UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import type { CompiledCircuit } from '@noir-lang/noir_js';
import { Poseidon2Hasher } from '@voter-protocol/crypto';
import { BN254_MODULUS } from '@voter-protocol/crypto';
import type { DebateWeightProofInput, DebateWeightProofResult, ProofOptions } from './types';
import { DEBATE_WEIGHT_PUBLIC_INPUT_COUNT } from './types';

// ============================================================================
// Bigint Floor Square Root (Babylonian Method)
// ============================================================================

/**
 * Compute floor(sqrt(n)) using the Babylonian method in pure bigint.
 *
 * Using Math.sqrt(Number(n)) is technically sufficient for values up to
 * 100_000_000 (max USDC stake), but Number loses precision above 2^53.
 * The Babylonian method is exact for all bigint inputs.
 *
 * @param n - Non-negative bigint
 * @returns floor(sqrt(n)) as bigint
 * @throws Error if n is negative
 */
function bigintSqrt(n: bigint): bigint {
    if (n < 0n) throw new Error('bigintSqrt: cannot compute sqrt of negative number');
    if (n === 0n) return 0n;
    // Initial estimate: start at n/2 (conservative upper bound)
    let x = n;
    let y = (x + 1n) / 2n;
    while (y < x) {
        x = y;
        y = (n / y + y) / 2n;
    }
    return x;
}

// ============================================================================
// Circuit Loader
// ============================================================================

function detectThreads(): number {
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
    if (!hasSharedArrayBuffer) {
        console.log('[DebateWeightNoirProver] SharedArrayBuffer unavailable - using single-threaded mode');
        return 1;
    }
    const cores = typeof navigator !== 'undefined'
        ? navigator.hardwareConcurrency || 4
        : 4;
    return Math.min(cores, 8);
}

async function loadDebateWeightCircuit(): Promise<CompiledCircuit> {
    const module = await import('../circuits/debate_weight.json');
    return module.default as unknown as CompiledCircuit;
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
// DebateWeightNoirProver
// ============================================================================

export interface DebateWeightProverConfig {
    /** Number of threads for proving (default: auto-detect) */
    threads?: number;
}

export class DebateWeightNoirProver {
    private backend: UltraHonkBackend | null = null;
    private noir: Noir | null = null;
    private readonly threads: number;

    constructor(config: DebateWeightProverConfig = {}) {
        this.threads = config.threads ?? detectThreads();
    }

    // ========================================================================
    // Initialization
    // ========================================================================

    async init(): Promise<void> {
        if (this.backend && this.noir) return;

        console.log(`[DebateWeightNoirProver] Initializing with ${this.threads} thread(s)...`);
        const start = Date.now();

        const circuit = await loadDebateWeightCircuit();

        this.noir = new Noir(circuit);
        this.backend = new UltraHonkBackend(circuit.bytecode, { threads: this.threads });

        console.log(`[DebateWeightNoirProver] Initialized in ${Date.now() - start}ms (${this.threads} threads)`);
    }

    async warmup(): Promise<void> {
        await this.init();
        console.log('[DebateWeightNoirProver] Warmup complete (backend initialized)');
    }

    // ========================================================================
    // Input Validation
    // ========================================================================

    validateInputs(inputs: DebateWeightProofInput): void {
        // Stake must be non-zero
        if (inputs.stake === 0n) {
            throw new Error('stake must be non-zero');
        }

        // Stake must fit in u64 (max safe USDC amount for the circuit)
        const U64_MAX = 2n ** 64n - 1n;
        if (inputs.stake > U64_MAX) {
            throw new Error(
                `stake (${inputs.stake}) exceeds u64 max (${U64_MAX}). ` +
                `Max USDC stake is $100 = 100_000_000.`
            );
        }

        // Stake must be within BN254 field (implied by u64 check, but belt-and-suspenders)
        if (inputs.stake >= BN254_MODULUS) {
            throw new Error(`stake exceeds BN254 scalar field modulus`);
        }

        // Tier must be 1-4 (tier 0 rejected by DebateMarket contract)
        if (inputs.tier < 1 || inputs.tier > 4 || !Number.isInteger(inputs.tier)) {
            throw new Error(
                `Invalid tier: ${inputs.tier}. Must be integer 1-4. ` +
                `Tier 0 is rejected by the DebateMarket contract.`
            );
        }

        // Randomness must be non-zero
        if (inputs.randomness === 0n) {
            throw new Error('randomness must be non-zero (prevents predictable note commitments)');
        }

        // Randomness must be within BN254 field
        if (inputs.randomness >= BN254_MODULUS) {
            throw new Error(`randomness exceeds BN254 scalar field modulus`);
        }
    }

    // ========================================================================
    // Input Formatting
    // ========================================================================

    async formatInputs(inputs: DebateWeightProofInput): Promise<Record<string, unknown>> {
        // Compute sqrt_stake = floor(sqrt(stake)) off-circuit
        const sqrtStake = bigintSqrt(inputs.stake);

        // Compute weighted_amount = floor(sqrt(stake)) * 2^tier
        const tierBigint = BigInt(inputs.tier);
        const multiplier = 1n << tierBigint;
        const weightedAmount = sqrtStake * multiplier;

        // Compute note_commitment = H3(stake, tier, randomness) using TypeScript Poseidon2
        // This MUST match the circuit's poseidon2_hash3(stake, tier, randomness).
        // Both use: permute([stake, tier, randomness, DOMAIN_HASH3])[0]
        const hasher = await Poseidon2Hasher.getInstance();
        const noteCommitment = await hasher.hash3(inputs.stake, tierBigint, inputs.randomness);

        return {
            // Private inputs (witnesses)
            stake: toHex(inputs.stake),
            sqrt_stake: toHex(sqrtStake),
            tier: toHex(tierBigint),
            randomness: toHex(inputs.randomness),
            // Public inputs (pre-computed for the circuit to verify)
            weighted_amount: toHex(weightedAmount),
            note_commitment: toHex(noteCommitment),
        };
    }

    // ========================================================================
    // Proof Generation
    // ========================================================================

    async generateProof(
        inputs: DebateWeightProofInput,
        options?: ProofOptions,
    ): Promise<DebateWeightProofResult> {
        // Validate inputs before heavy init() call
        this.validateInputs(inputs);

        await this.init();

        const mode = options?.keccak ? 'keccak (on-chain)' : 'default (off-chain)';
        console.log(`[DebateWeightNoirProver] Generating witness... (mode: ${mode})`);
        const witnessStart = Date.now();

        const noirInputs = await this.formatInputs(inputs);

        const { witness } = await this.noir!.execute(noirInputs as any);
        console.log(`[DebateWeightNoirProver] Witness generated in ${Date.now() - witnessStart}ms`);

        console.log('[DebateWeightNoirProver] Generating proof...');
        const proofStart = Date.now();

        const { proof, publicInputs } = options?.keccak
            ? await this.backend!.generateProof(witness, { keccak: true })
            : await this.backend!.generateProof(witness);

        console.log(`[DebateWeightNoirProver] Proof generated in ${Date.now() - proofStart}ms (${proof.length} bytes)`);

        if (publicInputs.length !== DEBATE_WEIGHT_PUBLIC_INPUT_COUNT) {
            throw new Error(
                `Unexpected public input count: expected ${DEBATE_WEIGHT_PUBLIC_INPUT_COUNT}, ` +
                `got ${publicInputs.length}`
            );
        }

        return { proof, publicInputs };
    }

    // ========================================================================
    // Proof Verification
    // ========================================================================

    async verifyProof(proofResult: DebateWeightProofResult, options?: ProofOptions): Promise<boolean> {
        if (proofResult.publicInputs.length !== DEBATE_WEIGHT_PUBLIC_INPUT_COUNT) {
            throw new Error(
                `BR5-006: Public input count mismatch: expected ${DEBATE_WEIGHT_PUBLIC_INPUT_COUNT}, ` +
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
     * Use this when the caller needs to bind the proof to a specific
     * (weightedAmount, noteCommitment) pair, guarding against input
     * substitution (BR5-006).
     *
     * @param proofResult - The proof and public inputs to verify
     * @param expectedInputs - The original inputs used to generate the proof
     * @param options - Proof options (keccak mode)
     * @returns true if proof is valid AND public inputs match
     * @throws Error if public inputs do not match expected values
     */
    async verifyProofWithExpectedInputs(
        proofResult: DebateWeightProofResult,
        expectedInputs: DebateWeightProofInput,
        options?: ProofOptions,
    ): Promise<boolean> {
        const valid = await this.verifyProof(proofResult, options);
        if (!valid) return false;

        // BR5-006: Bind public inputs to expected values.
        // Public input layout: [0] weighted_amount, [1] note_commitment
        const pi = proofResult.publicInputs;

        // Recompute expected public inputs
        const sqrtStake = bigintSqrt(expectedInputs.stake);
        const tierBigint = BigInt(expectedInputs.tier);
        const expectedWeightedAmount = sqrtStake * (1n << tierBigint);

        const hasher = await Poseidon2Hasher.getInstance();
        const expectedNoteCommitment = await hasher.hash3(
            expectedInputs.stake,
            tierBigint,
            expectedInputs.randomness,
        );

        const actualWeightedAmount = parsePublicInput(pi[0], 'weighted_amount[0]');
        if (actualWeightedAmount !== expectedWeightedAmount) {
            throw new Error(
                `BR5-006: Public input mismatch at index 0 (weighted_amount): ` +
                `expected ${expectedWeightedAmount}, got ${actualWeightedAmount}`
            );
        }

        const actualNoteCommitment = parsePublicInput(pi[1], 'note_commitment[1]');
        if (actualNoteCommitment !== expectedNoteCommitment) {
            throw new Error(
                `BR5-006: Public input mismatch at index 1 (note_commitment): ` +
                `expected ${expectedNoteCommitment}, got ${actualNoteCommitment}`
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

let debateWeightProverInstance: DebateWeightNoirProver | null = null;
let debateWeightInitPromise: Promise<DebateWeightNoirProver> | null = null;

export async function getDebateWeightProver(
    config?: DebateWeightProverConfig,
): Promise<DebateWeightNoirProver> {
    if (debateWeightProverInstance) return debateWeightProverInstance;

    if (debateWeightInitPromise) return debateWeightInitPromise;

    // Register promise synchronously before any async work (HIGH-003 pattern)
    let resolveInit: (prover: DebateWeightNoirProver) => void;
    let rejectInit: (error: Error) => void;

    const initPromise = new Promise<DebateWeightNoirProver>((resolve, reject) => {
        resolveInit = resolve;
        rejectInit = reject;
    });

    debateWeightInitPromise = initPromise;

    (async () => {
        try {
            const prover = new DebateWeightNoirProver(config);
            await prover.init();
            debateWeightProverInstance = prover;
            debateWeightInitPromise = null;
            resolveInit!(prover);
        } catch (err) {
            debateWeightInitPromise = null;
            rejectInit!(err instanceof Error ? err : new Error(String(err)));
        }
    })();

    return initPromise;
}

export async function resetDebateWeightProverSingleton(): Promise<void> {
    if (debateWeightProverInstance) {
        await debateWeightProverInstance.destroy();
        debateWeightProverInstance = null;
    }
    debateWeightInitPromise = null;
}

// ============================================================================
// Exported helpers (re-exported for test use)
// ============================================================================

export { bigintSqrt };
