/**
 * DebateWeightNoirProver tests
 *
 * Tests the debate_weight ZK prover, which proves:
 *   weightedAmount = floor(sqrt(stake)) * 2^tier
 *   noteCommitment = H3(stake, tier, randomness)
 *
 * Focus areas:
 * - Input validation (tier bounds, zero stake, zero randomness, u64 overflow)
 * - Input formatting (TypeScript -> Noir snake_case mapping, correct types)
 * - bigintSqrt correctness (perfect squares, non-perfect squares, edge cases)
 * - Weight computation (sqrtStake * 2^tier for all 4 tiers)
 * - Note commitment golden vectors (cross-language parity with Poseidon2Hasher)
 *
 * NOTE: Full proof generation requires the compiled debate_weight.json artifact.
 * The circuit artifact is produced by:
 *   cd packages/crypto && ./scripts/build-debate-weight-circuit.sh
 *
 * Tests that require the compiled circuit check for its presence and skip
 * gracefully if it is not available (matches two-tree-prover.test.ts pattern).
 *
 * Run with: npx vitest run packages/noir-prover/src/debate-weight-prover.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'fs';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Poseidon2Hasher } from '@voter-protocol/crypto';
import { BN254_MODULUS } from '@voter-protocol/crypto';
import {
    DebateWeightNoirProver,
    bigintSqrt,
    resetDebateWeightProverSingleton,
} from './debate-weight-prover';
import type { DebateWeightProofInput } from './types';
import { DEBATE_WEIGHT_PUBLIC_INPUT_COUNT } from './types';

// ============================================================================
// Circuit Availability Check
// ============================================================================

/**
 * Returns true if a real (compiled) debate_weight circuit artifact is available.
 * Circuit tests are skipped if the artifact is absent or is the placeholder stub.
 *
 * The placeholder stub (created for TypeScript module resolution) has an empty
 * bytecode field. A real compiled circuit has a non-empty base64 bytecode string.
 */
function isCircuitAvailable(): boolean {
    try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const artifactPath = resolve(__dirname, '../circuits/debate_weight.json');
        if (!existsSync(artifactPath)) return false;
        // Check that bytecode is non-empty (distinguishes real artifact from stub).
        // readFileSync is available in Node.js (vitest runs in Node).
        const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
        return typeof artifact.bytecode === 'string' && artifact.bytecode.length > 0;
    } catch {
        return false;
    }
}

const CIRCUIT_AVAILABLE = isCircuitAvailable();
const describeCircuit = CIRCUIT_AVAILABLE ? describe : describe.skip;

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Fixed randomness for deterministic golden vector tests.
 * Using a known non-zero, non-trivial value within BN254 field.
 */
const GOLDEN_RANDOMNESS = 0xdeadbeef_cafebabe_12345678_abcdef01n;

/**
 * Create a valid DebateWeightProofInput with optional overrides.
 */
function createValidInput(overrides: Partial<DebateWeightProofInput> = {}): DebateWeightProofInput {
    return {
        stake: 25_000_000n,   // $25 USDC
        tier: 3,
        randomness: GOLDEN_RANDOMNESS,
        ...overrides,
    };
}

// ============================================================================
// bigintSqrt Unit Tests
// ============================================================================

describe('bigintSqrt', () => {
    it('should return 0 for input 0', () => {
        expect(bigintSqrt(0n)).toBe(0n);
    });

    it('should return 1 for input 1', () => {
        expect(bigintSqrt(1n)).toBe(1n);
    });

    it('should return floor sqrt for input 2 (non-perfect square)', () => {
        expect(bigintSqrt(2n)).toBe(1n);
    });

    it('should return 2 for input 4 (perfect square)', () => {
        expect(bigintSqrt(4n)).toBe(2n);
    });

    it('should return floor for 3 (non-perfect square)', () => {
        expect(bigintSqrt(3n)).toBe(1n);
    });

    it('should return 1000 for $1 USDC (1_000_000) — perfect square', () => {
        // sqrt(1_000_000) = 1000.0 exactly
        expect(bigintSqrt(1_000_000n)).toBe(1000n);
    });

    it('should return 5000 for $25 USDC (25_000_000) — perfect square', () => {
        // sqrt(25_000_000) = 5000.0 exactly
        expect(bigintSqrt(25_000_000n)).toBe(5000n);
    });

    it('should return 3162 for $10 USDC (10_000_000) — non-perfect square', () => {
        // sqrt(10_000_000) = 3162.277... -> floor = 3162
        // Verify: 3162^2 = 9_998_244 <= 10_000_000 AND 3163^2 = 10_004_569 > 10_000_000
        const result = bigintSqrt(10_000_000n);
        expect(result).toBe(3162n);
        expect(result * result).toBeLessThanOrEqual(10_000_000n);
        expect((result + 1n) * (result + 1n)).toBeGreaterThan(10_000_000n);
    });

    it('should return 10000 for $100 USDC (100_000_000) — maximum stake', () => {
        // sqrt(100_000_000) = 10000.0 exactly
        expect(bigintSqrt(100_000_000n)).toBe(10_000n);
    });

    it('should satisfy floor-sqrt invariant for non-perfect squares', () => {
        // Test several non-perfect square values around the range of interest
        const testCases = [
            2_000_000n,   // sqrt ~ 1414
            5_000_000n,   // sqrt ~ 2236
            7_500_000n,   // sqrt ~ 2738
            50_000_000n,  // sqrt ~ 7071
            99_999_999n,  // sqrt = 9999 (just below max)
        ];
        for (const n of testCases) {
            const root = bigintSqrt(n);
            expect(root * root).toBeLessThanOrEqual(n);
            expect((root + 1n) * (root + 1n)).toBeGreaterThan(n);
        }
    });

    it('should throw for negative input', () => {
        expect(() => bigintSqrt(-1n)).toThrow('cannot compute sqrt of negative');
    });
});

// ============================================================================
// Input Validation Tests
// ============================================================================

describe('DebateWeightNoirProver — Input Validation', () => {
    let prover: DebateWeightNoirProver;

    beforeAll(() => {
        prover = new DebateWeightNoirProver({ threads: 1 });
    });

    it('should accept valid inputs (stake=$25, tier=3)', () => {
        const inputs = createValidInput();
        expect(() => prover.validateInputs(inputs)).not.toThrow();
    });

    it('should accept all valid tiers (1-4)', () => {
        for (const tier of [1, 2, 3, 4] as const) {
            const inputs = createValidInput({ tier });
            expect(() => prover.validateInputs(inputs)).not.toThrow();
        }
    });

    it('should accept minimum stake ($1 = 1_000_000)', () => {
        const inputs = createValidInput({ stake: 1_000_000n });
        expect(() => prover.validateInputs(inputs)).not.toThrow();
    });

    it('should accept maximum stake ($100 = 100_000_000)', () => {
        const inputs = createValidInput({ stake: 100_000_000n });
        expect(() => prover.validateInputs(inputs)).not.toThrow();
    });

    // Rejection: tier=0
    it('should reject tier=0 (tier 0 rejected by DebateMarket)', () => {
        const inputs = createValidInput({ tier: 0 as any });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'Invalid tier'
        );
    });

    // Rejection: tier=5
    it('should reject tier=5 (above maximum)', () => {
        const inputs = createValidInput({ tier: 5 as any });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'Invalid tier'
        );
    });

    // Rejection: stake=0
    it('should reject stake=0', () => {
        const inputs = createValidInput({ stake: 0n });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'stake must be non-zero'
        );
    });

    it('should reject stake exceeding u64 max', () => {
        const overflowStake = 2n ** 64n;
        const inputs = createValidInput({ stake: overflowStake });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'exceeds u64 max'
        );
    });

    it('should reject randomness=0 (prevents predictable commitments)', () => {
        const inputs = createValidInput({ randomness: 0n });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'randomness must be non-zero'
        );
    });

    it('should reject randomness >= BN254_MODULUS', () => {
        const inputs = createValidInput({ randomness: BN254_MODULUS });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'randomness exceeds BN254'
        );
    });

    it('should accept randomness = BN254_MODULUS - 1 (max valid field element)', () => {
        const inputs = createValidInput({ randomness: BN254_MODULUS - 1n });
        expect(() => prover.validateInputs(inputs)).not.toThrow();
    });
});

// ============================================================================
// Input Formatting Tests (no circuit required)
// ============================================================================

describe('DebateWeightNoirProver — Input Formatting', () => {
    let prover: DebateWeightNoirProver;

    beforeAll(() => {
        prover = new DebateWeightNoirProver({ threads: 1 });
    });

    it('should format all required Noir input keys (snake_case)', async () => {
        const inputs = createValidInput();
        const formatted = await prover.formatInputs(inputs);

        // All circuit inputs must be present
        expect(formatted).toHaveProperty('stake');
        expect(formatted).toHaveProperty('sqrt_stake');
        expect(formatted).toHaveProperty('tier');
        expect(formatted).toHaveProperty('randomness');
        expect(formatted).toHaveProperty('weighted_amount');
        expect(formatted).toHaveProperty('note_commitment');
    });

    it('should format bigint values as 0x-prefixed 64-char hex strings', async () => {
        const inputs = createValidInput({ stake: 255n });
        const formatted = await prover.formatInputs(inputs);

        const stake = formatted.stake as string;
        expect(stake).toBe('0x' + 'ff'.padStart(64, '0'));
        expect(stake).toHaveLength(66); // 0x + 64 chars
    });

    // Verify: stake=$25, tier=3 -> sqrtStake=5000, weight=40_000
    it('should compute correct sqrt_stake for $25 USDC', async () => {
        const inputs = createValidInput({ stake: 25_000_000n, tier: 3 });
        const formatted = await prover.formatInputs(inputs);

        const sqrtStakeHex = formatted.sqrt_stake as string;
        expect(BigInt(sqrtStakeHex)).toBe(5000n);
    });

    it('should compute correct weighted_amount for $25 USDC tier=3 (40_000)', async () => {
        const inputs = createValidInput({ stake: 25_000_000n, tier: 3 });
        const formatted = await prover.formatInputs(inputs);

        const weightHex = formatted.weighted_amount as string;
        expect(BigInt(weightHex)).toBe(40_000n); // 5000 * 8
    });

    it('should compute correct weighted_amount for $1 USDC tier=1 (2_000)', async () => {
        const inputs = createValidInput({ stake: 1_000_000n, tier: 1 });
        const formatted = await prover.formatInputs(inputs);

        const weightHex = formatted.weighted_amount as string;
        expect(BigInt(weightHex)).toBe(2_000n); // 1000 * 2
    });

    it('should compute correct sqrt_stake for $10 USDC (non-perfect square, 3162)', async () => {
        const inputs = createValidInput({ stake: 10_000_000n, tier: 2 });
        const formatted = await prover.formatInputs(inputs);

        const sqrtStakeHex = formatted.sqrt_stake as string;
        expect(BigInt(sqrtStakeHex)).toBe(3162n);
    });

    it('should compute correct weighted_amount for $10 USDC tier=2 (12_648)', async () => {
        const inputs = createValidInput({ stake: 10_000_000n, tier: 2 });
        const formatted = await prover.formatInputs(inputs);

        const weightHex = formatted.weighted_amount as string;
        expect(BigInt(weightHex)).toBe(12_648n); // 3162 * 4
    });

    it('should compute correct weighted_amount for $100 USDC tier=4 (160_000)', async () => {
        const inputs = createValidInput({ stake: 100_000_000n, tier: 4 });
        const formatted = await prover.formatInputs(inputs);

        const weightHex = formatted.weighted_amount as string;
        expect(BigInt(weightHex)).toBe(160_000n); // 10_000 * 16
    });
});

// ============================================================================
// Weight Computation Golden Vectors (off-circuit, no artifact needed)
// ============================================================================

describe('Weight Computation Golden Vectors', () => {
    it('TC-1: Perfect square stake=$25, tier=3 -> weight=40_000', () => {
        const stake = 25_000_000n;
        const sqrtStake = bigintSqrt(stake);
        const weight = sqrtStake * (1n << 3n);

        expect(sqrtStake).toBe(5000n);
        expect(weight).toBe(40_000n);
    });

    it('TC-2: Perfect square stake=$1, tier=1 -> weight=2_000', () => {
        const stake = 1_000_000n;
        const sqrtStake = bigintSqrt(stake);
        const weight = sqrtStake * (1n << 1n);

        expect(sqrtStake).toBe(1000n);
        expect(weight).toBe(2_000n);
    });

    it('TC-3: Non-perfect square stake=$10, tier=2 -> weight=12_648', () => {
        const stake = 10_000_000n;
        const sqrtStake = bigintSqrt(stake);
        const weight = sqrtStake * (1n << 2n);

        // sqrt(10_000_000) = 3162.277... -> floor = 3162
        expect(sqrtStake).toBe(3162n);
        expect(weight).toBe(12_648n); // 3162 * 4
    });

    it('TC-4: Minimum stake, tier=1 -> weight=2_000', () => {
        const stake = 1_000_000n; // $1 minimum
        const sqrtStake = bigintSqrt(stake);
        const weight = sqrtStake * (1n << 1n);

        expect(sqrtStake).toBe(1000n);
        expect(weight).toBe(2_000n);
    });

    it('TC-5: Maximum stake=$100, tier=4 -> weight=160_000', () => {
        const stake = 100_000_000n;
        const sqrtStake = bigintSqrt(stake);
        const weight = sqrtStake * (1n << 4n);

        expect(sqrtStake).toBe(10_000n);
        expect(weight).toBe(160_000n); // 10_000 * 16
    });
});

// ============================================================================
// Note Commitment Golden Vectors (Poseidon2 cross-language parity)
// ============================================================================

describe('Note Commitment Golden Vectors (Poseidon2 parity)', () => {
    let hasher: Poseidon2Hasher;

    beforeAll(async () => {
        hasher = await Poseidon2Hasher.getInstance();
    });

    /**
     * TC-9 (Critical cross-language parity test):
     * For a fixed (stake, tier, randomness) tuple:
     *   noteCommitment from formatInputs() MUST equal
     *   Poseidon2Hasher.hash3(stake, tier, randomness)
     *
     * This validates that the TypeScript prover and Noir circuit use
     * identical H3 computation: permute([stake, tier, randomness, DOMAIN_HASH3])[0]
     */
    it('TC-9: note_commitment matches Poseidon2Hasher.hash3(stake, tier, randomness)', async () => {
        const stake = 25_000_000n;
        const tier = 3n;
        const randomness = GOLDEN_RANDOMNESS;

        // TypeScript path: Poseidon2Hasher.hash3
        const expectedCommitment = await hasher.hash3(stake, tier, randomness);

        // Prover path: formatInputs() calls hasher.hash3 internally
        const prover = new DebateWeightNoirProver({ threads: 1 });
        const formatted = await prover.formatInputs({
            stake,
            tier: 3,
            randomness,
        });

        const actualCommitment = BigInt(formatted.note_commitment as string);
        expect(actualCommitment).toBe(expectedCommitment);
    });

    it('note_commitment differs for different stakes (same tier, randomness)', async () => {
        const tier = 2n;
        const randomness = GOLDEN_RANDOMNESS;

        const h1 = await hasher.hash3(25_000_000n, tier, randomness);
        const h2 = await hasher.hash3(10_000_000n, tier, randomness);

        expect(h1).not.toBe(h2);
        // Both must be non-zero
        expect(h1).not.toBe(0n);
        expect(h2).not.toBe(0n);
    });

    it('note_commitment differs for different tiers (same stake, randomness)', async () => {
        const stake = 25_000_000n;
        const randomness = GOLDEN_RANDOMNESS;

        const h1 = await hasher.hash3(stake, 1n, randomness);
        const h4 = await hasher.hash3(stake, 4n, randomness);

        expect(h1).not.toBe(h4);
    });

    it('note_commitment differs for different randomness (same stake, tier)', async () => {
        const stake = 25_000_000n;
        const tier = 3n;

        const h1 = await hasher.hash3(stake, tier, 0xdeadbeefn);
        const h2 = await hasher.hash3(stake, tier, 0xcafebaben);

        expect(h1).not.toBe(h2);
    });

    it('note_commitment is within BN254 field', async () => {
        const commitment = await hasher.hash3(25_000_000n, 3n, GOLDEN_RANDOMNESS);
        expect(commitment).toBeGreaterThan(0n);
        expect(commitment).toBeLessThan(BN254_MODULUS);
    });

    it('note_commitment is deterministic', async () => {
        const args: [bigint, bigint, bigint] = [25_000_000n, 3n, GOLDEN_RANDOMNESS];
        const h1 = await hasher.hash3(...args);
        const h2 = await hasher.hash3(...args);
        expect(h1).toBe(h2);
    });
});

// ============================================================================
// Public Input Count Constant
// ============================================================================

describe('DEBATE_WEIGHT_PUBLIC_INPUT_COUNT', () => {
    it('should be 2 (weighted_amount + note_commitment)', () => {
        expect(DEBATE_WEIGHT_PUBLIC_INPUT_COUNT).toBe(2);
    });
});

// ============================================================================
// Circuit Tests (require compiled artifact — skipped if not available)
// ============================================================================

describeCircuit('DebateWeightNoirProver — Circuit (requires debate_weight.json)', () => {
    let prover: DebateWeightNoirProver;

    beforeAll(async () => {
        prover = new DebateWeightNoirProver({ threads: 1 });
        await prover.init();
    }, 120_000); // 120s timeout for WASM init

    afterAll(async () => {
        await resetDebateWeightProverSingleton();
        await prover.destroy();
    });

    // TC-1: Perfect square, tier=3
    it('TC-1: generates valid proof for stake=$25, tier=3 (weight=40_000)', async () => {
        const inputs: DebateWeightProofInput = {
            stake: 25_000_000n,
            tier: 3,
            randomness: GOLDEN_RANDOMNESS,
        };

        const result = await prover.generateProof(inputs);

        expect(result.proof).toBeInstanceOf(Uint8Array);
        expect(result.proof.length).toBeGreaterThan(0);
        expect(result.publicInputs).toHaveLength(DEBATE_WEIGHT_PUBLIC_INPUT_COUNT);

        // weighted_amount[0] = 40_000
        expect(BigInt(result.publicInputs[0])).toBe(40_000n);
    }, 300_000);

    // TC-2: Perfect square, tier=1
    it('TC-2: generates valid proof for stake=$1, tier=1 (weight=2_000)', async () => {
        const inputs: DebateWeightProofInput = {
            stake: 1_000_000n,
            tier: 1,
            randomness: GOLDEN_RANDOMNESS,
        };

        const result = await prover.generateProof(inputs);

        expect(result.publicInputs).toHaveLength(DEBATE_WEIGHT_PUBLIC_INPUT_COUNT);
        expect(BigInt(result.publicInputs[0])).toBe(2_000n);
    }, 300_000);

    // TC-3: Non-perfect square, tier=2
    it('TC-3: generates valid proof for stake=$10, tier=2 (weight=12_648)', async () => {
        const inputs: DebateWeightProofInput = {
            stake: 10_000_000n,
            tier: 2,
            randomness: GOLDEN_RANDOMNESS,
        };

        const result = await prover.generateProof(inputs);

        expect(result.publicInputs).toHaveLength(DEBATE_WEIGHT_PUBLIC_INPUT_COUNT);
        // floor(sqrt(10_000_000)) = 3162, weight = 3162 * 4 = 12_648
        expect(BigInt(result.publicInputs[0])).toBe(12_648n);
    }, 300_000);

    // TC-5: Maximum stake + tier
    it('TC-5: generates valid proof for stake=$100, tier=4 (weight=160_000)', async () => {
        const inputs: DebateWeightProofInput = {
            stake: 100_000_000n,
            tier: 4,
            randomness: GOLDEN_RANDOMNESS,
        };

        const result = await prover.generateProof(inputs);

        expect(result.publicInputs).toHaveLength(DEBATE_WEIGHT_PUBLIC_INPUT_COUNT);
        expect(BigInt(result.publicInputs[0])).toBe(160_000n);
    }, 300_000);

    // TC-9 (circuit): note_commitment in proof matches TypeScript H3
    it('TC-9 (circuit): note_commitment in proof matches Poseidon2Hasher.hash3', async () => {
        const stake = 25_000_000n;
        const tier = 3;
        const randomness = GOLDEN_RANDOMNESS;

        const hasher = await Poseidon2Hasher.getInstance();
        const expectedNoteCommitment = await hasher.hash3(stake, BigInt(tier), randomness);

        const result = await prover.generateProof({ stake, tier, randomness });

        // note_commitment is at public input index 1
        const actualNoteCommitment = BigInt(result.publicInputs[1]);
        expect(actualNoteCommitment).toBe(expectedNoteCommitment);
    }, 300_000);

    // TC-10: Proof verification — valid proof verifies, tampered proof fails
    it('TC-10: valid proof verifies; tampered public input fails verification', async () => {
        const inputs: DebateWeightProofInput = {
            stake: 25_000_000n,
            tier: 3,
            randomness: GOLDEN_RANDOMNESS,
        };

        const result = await prover.generateProof(inputs);

        // Valid proof must verify
        const isValid = await prover.verifyProof(result);
        expect(isValid).toBe(true);

        // Tamper: change weighted_amount (index 0) to an incorrect value
        const tamperedInputs = [...result.publicInputs];
        // Replace weighted_amount 40_000 with 40_001
        tamperedInputs[0] = '0x' + 40_001n.toString(16).padStart(64, '0');
        const tamperedResult = { ...result, publicInputs: tamperedInputs };

        // Tampered proof must FAIL verification
        const isTamperedValid = await prover.verifyProof(tamperedResult);
        expect(isTamperedValid).toBe(false);
    }, 600_000); // 2 proofs

    // TC-6/TC-7: Rejection — tier=0 and tier=5 throw before circuit execution
    it('TC-6: validateInputs throws before circuit for tier=0', async () => {
        const inputs = createValidInput({ tier: 0 as any });
        await expect(prover.generateProof(inputs)).rejects.toThrow('Invalid tier');
    });

    it('TC-7: validateInputs throws before circuit for tier=5', async () => {
        const inputs = createValidInput({ tier: 5 as any });
        await expect(prover.generateProof(inputs)).rejects.toThrow('Invalid tier');
    });

    // TC-8: Rejection — stake=0 throws before circuit execution
    it('TC-8: validateInputs throws before circuit for stake=0', async () => {
        const inputs = createValidInput({ stake: 0n });
        await expect(prover.generateProof(inputs)).rejects.toThrow('stake must be non-zero');
    });
});
