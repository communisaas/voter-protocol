/**
 * PositionNoteNoirProver tests
 *
 * Tests the position_note ZK prover, which proves:
 *   commitment = H_PCM(argument_index, weighted_amount, randomness)
 *   Merkle membership in the position tree (depth 20)
 *   nullifier = H_PNL(nullifier_key, commitment, debate_id)
 *
 * Focus areas:
 * - Input validation (zero randomness, zero nullifierKey, field bound checks)
 * - Position commitment golden vectors (PCM domain parity with circuit)
 * - Position nullifier golden vectors (PNL domain parity with circuit)
 * - Merkle proof integration: PositionTreeBuilder -> getProof -> formatInputs
 * - Domain separation verification (PCM != H3M, PNL != PCM)
 * - Circuit tests (skipped when artifact unavailable — matches debate-weight pattern)
 *
 * NOTE: Full proof generation requires the compiled position_note.json artifact.
 * The circuit artifact is produced by:
 *   cd packages/crypto && ./scripts/build-position-note-circuit.sh
 *
 * Tests that require the compiled circuit check for its presence and skip
 * gracefully if it is not available.
 *
 * Run with: npx vitest run packages/noir-prover/src/position-note-prover.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'fs';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Poseidon2Hasher } from '@voter-protocol/crypto';
import { BN254_MODULUS } from '@voter-protocol/crypto';
import {
    PositionNoteNoirProver,
    resetPositionNoteProverSingleton,
} from './position-note-prover';
import type { PositionNoteProofInput } from './types';
import {
    POSITION_NOTE_PUBLIC_INPUT_COUNT,
    POSITION_TREE_DEPTH,
    DOMAIN_POS_COMMIT,
    DOMAIN_POS_NUL,
} from './types';

// PositionTreeBuilder is imported optionally for Merkle integration tests.
// It lives in @voter-protocol/shadow-atlas which is not a required dep of this
// package. Tests that need it are guarded by TREE_BUILDER_AVAILABLE and run
// only when shadow-atlas is present (e.g. full monorepo checkout, not CI lite).
//
// Type-level: we use `any` for the dynamic import to avoid a TypeScript
// cross-package reference error. The runtime guard ensures type safety.
/* eslint-disable @typescript-eslint/no-explicit-any */
let PositionTreeBuilder: any = null;
let verifyPositionMerkleProof: any = null;

try {
    // Dynamic import resolves through node_modules/@voter-protocol/shadow-atlas
    // when the workspace symlink is present. Falls back gracefully if not.
    // @ts-ignore — cross-package optional import; guarded at runtime
    const mod = await import('@voter-protocol/shadow-atlas/position-tree-builder');
    PositionTreeBuilder = mod.PositionTreeBuilder;
    verifyPositionMerkleProof = mod.verifyPositionMerkleProof;
} catch {
    // shadow-atlas not available in this test context — tree tests will be skipped
}

const TREE_BUILDER_AVAILABLE = PositionTreeBuilder !== null;
const describeTree = TREE_BUILDER_AVAILABLE ? describe : describe.skip;

// ============================================================================
// Circuit Availability Check
// ============================================================================

/**
 * Returns true if a real (compiled) position_note circuit artifact is available.
 * Circuit tests are skipped if the artifact is absent or is the placeholder stub.
 *
 * The placeholder stub has an empty bytecode field.
 * A real compiled circuit has a non-empty base64 bytecode string.
 */
function isCircuitAvailable(): boolean {
    try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const artifactPath = resolve(__dirname, '../circuits/position_note.json');
        if (!existsSync(artifactPath)) return false;
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
 * Fixed entropy for deterministic golden vector tests.
 * Non-zero, non-trivial value well within BN254 field.
 */
const GOLDEN_RANDOMNESS = 0xdeadbeef_cafebabe_12345678_abcdef01n;
const GOLDEN_NULLIFIER_KEY = 0xabcdef01_23456789_deadbeef_cafebaben;

/** Zero-padded Merkle path (all siblings are 0n, for unit tests) */
function zeroPaddedPath(depth: number = POSITION_TREE_DEPTH): bigint[] {
    return new Array(depth).fill(0n);
}

/**
 * Create a valid PositionNoteProofInput with optional overrides.
 * Uses depth-20 zero-padded path for unit tests (no real tree).
 */
function createValidInput(overrides: Partial<PositionNoteProofInput> = {}): PositionNoteProofInput {
    const base: PositionNoteProofInput = {
        argumentIndex: 1n,          // argument 1 (winning)
        weightedAmount: 40_000n,    // floor(sqrt($25)) * 2^3 = 40_000
        randomness: GOLDEN_RANDOMNESS,
        nullifierKey: GOLDEN_NULLIFIER_KEY,
        positionPath: zeroPaddedPath(),
        positionIndex: 0,
        positionRoot: 0n,           // will not match real root — circuit tests use real tree
        debateId: 42n,
        winningArgumentIndex: 1n,
    };
    return { ...base, ...overrides };
}

// ============================================================================
// Domain Constants
// ============================================================================

describe('Domain Separation Constants', () => {
    it('DOMAIN_POS_COMMIT should be 0x50434d ("PCM")', () => {
        expect(DOMAIN_POS_COMMIT).toBe(0x50434dn);
    });

    it('DOMAIN_POS_NUL should be 0x504e4c ("PNL")', () => {
        expect(DOMAIN_POS_NUL).toBe(0x504e4cn);
    });

    it('DOMAIN_POS_COMMIT must not equal DOMAIN_POS_NUL', () => {
        expect(DOMAIN_POS_COMMIT).not.toBe(DOMAIN_POS_NUL);
    });

    it('DOMAIN_POS_COMMIT must not equal H3M (0x48334d)', () => {
        // H3M is the domain used by debate_weight noteCommitment and engagement data commitment.
        // A collision would allow a position commitment to alias as an engagement hash.
        expect(DOMAIN_POS_COMMIT).not.toBe(0x48334dn);
    });

    it('DOMAIN_POS_NUL must not equal H2M (0x48324d)', () => {
        expect(DOMAIN_POS_NUL).not.toBe(0x48324dn);
    });

    it('POSITION_TREE_DEPTH should be 20', () => {
        expect(POSITION_TREE_DEPTH).toBe(20);
    });

    it('POSITION_NOTE_PUBLIC_INPUT_COUNT should be 5', () => {
        expect(POSITION_NOTE_PUBLIC_INPUT_COUNT).toBe(5);
    });
});

// ============================================================================
// Input Validation Tests
// ============================================================================

describe('PositionNoteNoirProver — Input Validation', () => {
    let prover: PositionNoteNoirProver;

    beforeAll(() => {
        prover = new PositionNoteNoirProver({ threads: 1 });
    });

    it('should accept valid inputs', () => {
        const inputs = createValidInput();
        expect(() => prover.validateInputs(inputs)).not.toThrow();
    });

    it('should reject randomness=0', () => {
        const inputs = createValidInput({ randomness: 0n });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'randomness must be non-zero'
        );
    });

    it('should reject nullifierKey=0', () => {
        const inputs = createValidInput({ nullifierKey: 0n });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'nullifierKey must be non-zero'
        );
    });

    it('should reject weightedAmount=0', () => {
        const inputs = createValidInput({ weightedAmount: 0n });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'weightedAmount must be non-zero'
        );
    });

    it('should reject randomness >= BN254_MODULUS', () => {
        const inputs = createValidInput({ randomness: BN254_MODULUS });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'randomness exceeds BN254'
        );
    });

    it('should reject nullifierKey >= BN254_MODULUS', () => {
        const inputs = createValidInput({ nullifierKey: BN254_MODULUS });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'nullifierKey exceeds BN254'
        );
    });

    it('should reject weightedAmount >= BN254_MODULUS', () => {
        const inputs = createValidInput({ weightedAmount: BN254_MODULUS });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'weightedAmount exceeds BN254'
        );
    });

    it('should reject positionPath with wrong length', () => {
        const inputs = createValidInput({ positionPath: [0n, 1n] }); // length 2, not 20
        expect(() => prover.validateInputs(inputs)).toThrow(
            `positionPath length must be ${POSITION_TREE_DEPTH}`
        );
    });

    it('should reject positionPath with excess length', () => {
        const inputs = createValidInput({ positionPath: new Array(21).fill(0n) });
        expect(() => prover.validateInputs(inputs)).toThrow(
            `positionPath length must be ${POSITION_TREE_DEPTH}`
        );
    });

    it('should reject positionIndex < 0', () => {
        const inputs = createValidInput({ positionIndex: -1 });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'positionIndex must be an integer'
        );
    });

    it('should reject positionIndex >= 2^20 (out of range)', () => {
        const inputs = createValidInput({ positionIndex: 2 ** 20 }); // 1_048_576
        expect(() => prover.validateInputs(inputs)).toThrow(
            'positionIndex must be an integer'
        );
    });

    it('should accept positionIndex = 2^20 - 1 (max valid)', () => {
        const inputs = createValidInput({ positionIndex: 2 ** 20 - 1 });
        expect(() => prover.validateInputs(inputs)).not.toThrow();
    });

    it('should reject positionIndex as non-integer', () => {
        const inputs = createValidInput({ positionIndex: 0.5 });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'positionIndex must be an integer'
        );
    });

    it('should accept argumentIndex=0 (first argument)', () => {
        const inputs = createValidInput({ argumentIndex: 0n, winningArgumentIndex: 0n });
        expect(() => prover.validateInputs(inputs)).not.toThrow();
    });

    it('should accept randomness = BN254_MODULUS - 1 (max valid field element)', () => {
        const inputs = createValidInput({ randomness: BN254_MODULUS - 1n });
        expect(() => prover.validateInputs(inputs)).not.toThrow();
    });
});

// ============================================================================
// Position Commitment Golden Vectors
// ============================================================================

describe('Position Commitment Golden Vectors (PCM domain parity)', () => {
    let hasher: Poseidon2Hasher;
    let prover: PositionNoteNoirProver;

    beforeAll(async () => {
        hasher = await Poseidon2Hasher.getInstance();
        prover = new PositionNoteNoirProver({ threads: 1 });
    });

    /**
     * Critical parity test: TypeScript commitment computation must produce
     * the same value as the Noir circuit's poseidon2_pos_commit().
     *
     * Both use: permute([argument_index, weighted_amount, randomness, 0x50434d])[0]
     */
    it('TC-1: commitment is deterministic for same inputs', async () => {
        const c1 = await prover.computeCommitment(1n, 40_000n, GOLDEN_RANDOMNESS);
        const c2 = await prover.computeCommitment(1n, 40_000n, GOLDEN_RANDOMNESS);
        expect(c1).toBe(c2);
    });

    it('TC-2: commitment differs with different argument_index', async () => {
        const c1 = await prover.computeCommitment(0n, 40_000n, GOLDEN_RANDOMNESS);
        const c2 = await prover.computeCommitment(1n, 40_000n, GOLDEN_RANDOMNESS);
        expect(c1).not.toBe(c2);
        expect(c1).not.toBe(0n);
        expect(c2).not.toBe(0n);
    });

    it('TC-3: commitment differs with different weighted_amount', async () => {
        const c1 = await prover.computeCommitment(1n, 40_000n, GOLDEN_RANDOMNESS);
        const c2 = await prover.computeCommitment(1n, 2_000n, GOLDEN_RANDOMNESS);
        expect(c1).not.toBe(c2);
    });

    it('TC-4: commitment differs with different randomness', async () => {
        const c1 = await prover.computeCommitment(1n, 40_000n, 0xdeadbeefn);
        const c2 = await prover.computeCommitment(1n, 40_000n, 0xcafebaben);
        expect(c1).not.toBe(c2);
    });

    it('TC-5: commitment uses PCM domain (not H3M domain)', async () => {
        const argIdx = 1n;
        const weight = 40_000n;
        const rand = GOLDEN_RANDOMNESS;

        // PCM domain (position commitment)
        const commitmentPCM = await prover.computeCommitment(argIdx, weight, rand);

        // H3M domain (debate_weight note commitment — standard hash3)
        const noteCommitmentH3M = await hasher.hash3(argIdx, weight, rand);

        // With same inputs but different domain, must produce different output
        expect(commitmentPCM).not.toBe(noteCommitmentH3M);
        expect(commitmentPCM).not.toBe(0n);
    });

    it('TC-6: commitment is within BN254 field', async () => {
        const commitment = await prover.computeCommitment(1n, 40_000n, GOLDEN_RANDOMNESS);
        expect(commitment).toBeGreaterThan(0n);
        expect(commitment).toBeLessThan(BN254_MODULUS);
    });

    it('TC-7: commitment matches hashWithCustomDomain3 directly', async () => {
        // Verify the prover delegates correctly to Poseidon2Hasher.hashWithCustomDomain3
        const argIdx = 2n;
        const weight = 12_648n;
        const rand = GOLDEN_RANDOMNESS;

        const fromProver = await prover.computeCommitment(argIdx, weight, rand);
        const fromHasher = await hasher.hashWithCustomDomain3(argIdx, weight, rand, DOMAIN_POS_COMMIT);

        expect(fromProver).toBe(fromHasher);
    });
});

// ============================================================================
// Position Nullifier Golden Vectors
// ============================================================================

describe('Position Nullifier Golden Vectors (PNL domain parity)', () => {
    let hasher: Poseidon2Hasher;
    let prover: PositionNoteNoirProver;

    beforeAll(async () => {
        hasher = await Poseidon2Hasher.getInstance();
        prover = new PositionNoteNoirProver({ threads: 1 });
    });

    it('TC-8: nullifier is deterministic for same inputs', async () => {
        const commitment = await prover.computeCommitment(1n, 40_000n, GOLDEN_RANDOMNESS);
        const n1 = await prover.computeNullifier(GOLDEN_NULLIFIER_KEY, commitment, 42n);
        const n2 = await prover.computeNullifier(GOLDEN_NULLIFIER_KEY, commitment, 42n);
        expect(n1).toBe(n2);
    });

    it('TC-9: nullifier differs with different debate_id', async () => {
        const commitment = await prover.computeCommitment(1n, 40_000n, GOLDEN_RANDOMNESS);
        const n1 = await prover.computeNullifier(GOLDEN_NULLIFIER_KEY, commitment, 1n);
        const n2 = await prover.computeNullifier(GOLDEN_NULLIFIER_KEY, commitment, 2n);
        expect(n1).not.toBe(n2);
    });

    it('TC-10: nullifier differs with different nullifier_key', async () => {
        const commitment = await prover.computeCommitment(1n, 40_000n, GOLDEN_RANDOMNESS);
        const n1 = await prover.computeNullifier(0xaabbccddn, commitment, 42n);
        const n2 = await prover.computeNullifier(0xddccbbaan, commitment, 42n);
        expect(n1).not.toBe(n2);
    });

    it('TC-11: nullifier differs with different commitment', async () => {
        const c1 = await prover.computeCommitment(1n, 40_000n, GOLDEN_RANDOMNESS);
        const c2 = await prover.computeCommitment(0n, 40_000n, GOLDEN_RANDOMNESS);
        const n1 = await prover.computeNullifier(GOLDEN_NULLIFIER_KEY, c1, 42n);
        const n2 = await prover.computeNullifier(GOLDEN_NULLIFIER_KEY, c2, 42n);
        expect(n1).not.toBe(n2);
    });

    it('TC-12: nullifier != commitment for same (a, b, c) inputs (domain separation)', async () => {
        // Even with the same three inputs, PCM vs PNL domain must differ
        const a = 1n;
        const b = 40_000n;
        const c = GOLDEN_RANDOMNESS;

        const commitment = await hasher.hashWithCustomDomain3(a, b, c, DOMAIN_POS_COMMIT);
        const nullifier = await hasher.hashWithCustomDomain3(a, b, c, DOMAIN_POS_NUL);

        expect(commitment).not.toBe(nullifier);
    });

    it('TC-13: nullifier is within BN254 field', async () => {
        const commitment = await prover.computeCommitment(1n, 40_000n, GOLDEN_RANDOMNESS);
        const nullifier = await prover.computeNullifier(GOLDEN_NULLIFIER_KEY, commitment, 42n);
        expect(nullifier).toBeGreaterThan(0n);
        expect(nullifier).toBeLessThan(BN254_MODULUS);
    });

    it('TC-14: nullifier matches hashWithCustomDomain3 directly', async () => {
        const commitment = await prover.computeCommitment(1n, 40_000n, GOLDEN_RANDOMNESS);
        const debateId = 42n;

        const fromProver = await prover.computeNullifier(GOLDEN_NULLIFIER_KEY, commitment, debateId);
        const fromHasher = await hasher.hashWithCustomDomain3(
            GOLDEN_NULLIFIER_KEY,
            commitment,
            debateId,
            DOMAIN_POS_NUL,
        );

        expect(fromProver).toBe(fromHasher);
    });
});

// ============================================================================
// Input Formatting Tests
// ============================================================================

describe('PositionNoteNoirProver — Input Formatting', () => {
    let prover: PositionNoteNoirProver;

    beforeAll(() => {
        prover = new PositionNoteNoirProver({ threads: 1 });
    });

    it('should format all required Noir input keys (snake_case)', async () => {
        const inputs = createValidInput();
        const formatted = await prover.formatInputs(inputs);

        // Private inputs
        expect(formatted).toHaveProperty('argument_index');
        expect(formatted).toHaveProperty('weighted_amount');
        expect(formatted).toHaveProperty('randomness');
        expect(formatted).toHaveProperty('nullifier_key');
        expect(formatted).toHaveProperty('position_path');
        expect(formatted).toHaveProperty('position_index');
        // Public inputs
        expect(formatted).toHaveProperty('position_root');
        expect(formatted).toHaveProperty('nullifier');
        expect(formatted).toHaveProperty('debate_id');
        expect(formatted).toHaveProperty('winning_argument_index');
        expect(formatted).toHaveProperty('claimed_weighted_amount');
    });

    it('should format bigint values as 0x-prefixed 64-char hex strings', async () => {
        const inputs = createValidInput({ argumentIndex: 255n });
        const formatted = await prover.formatInputs(inputs);

        const argIdx = formatted.argument_index as string;
        expect(argIdx).toBe('0x' + 'ff'.padStart(64, '0'));
        expect(argIdx).toHaveLength(66); // 0x + 64 chars
    });

    it('should format position_path as array of hex strings (length 20)', async () => {
        const inputs = createValidInput();
        const formatted = await prover.formatInputs(inputs);

        const path = formatted.position_path as string[];
        expect(Array.isArray(path)).toBe(true);
        expect(path).toHaveLength(POSITION_TREE_DEPTH);
        for (const elem of path) {
            expect(typeof elem).toBe('string');
            expect(elem.startsWith('0x')).toBe(true);
            expect(elem).toHaveLength(66); // 0x + 64 chars
        }
    });

    it('claimed_weighted_amount must equal private weighted_amount', async () => {
        const inputs = createValidInput({ weightedAmount: 40_000n });
        const formatted = await prover.formatInputs(inputs);

        // Both must encode the same value
        const privWeight = BigInt(formatted.weighted_amount as string);
        const pubWeight = BigInt(formatted.claimed_weighted_amount as string);
        expect(privWeight).toBe(pubWeight);
        expect(privWeight).toBe(40_000n);
    });

    it('nullifier should be pre-computed and non-zero', async () => {
        const inputs = createValidInput();
        const formatted = await prover.formatInputs(inputs);

        const nullifier = BigInt(formatted.nullifier as string);
        expect(nullifier).not.toBe(0n);
        expect(nullifier).toBeLessThan(BN254_MODULUS);
    });

    it('position_index is passed through as numeric', async () => {
        const inputs = createValidInput({ positionIndex: 42 });
        const formatted = await prover.formatInputs(inputs);

        expect(formatted.position_index).toBe(42);
    });
});

// ============================================================================
// Merkle Proof Integration Tests (requires PositionTreeBuilder)
// ============================================================================

describeTree('PositionTreeBuilder + PositionNoteNoirProver — Merkle Integration', () => {
    let prover: PositionNoteNoirProver;

    beforeAll(() => {
        prover = new PositionNoteNoirProver({ threads: 1 });
    });

    it('TC-M1: insert single commitment and get valid proof', async () => {
        const builder = new PositionTreeBuilder!(20);

        const commitment = await prover.computeCommitment(1n, 40_000n, GOLDEN_RANDOMNESS);
        const idx = await builder.insert(commitment);
        expect(idx).toBe(0);

        const proof = await builder.getProof(0);
        expect(proof.commitment).toBe(commitment);
        expect(proof.index).toBe(0);
        expect(proof.path).toHaveLength(20);

        // Verify proof locally
        const valid = await builder.verifyProof(proof);
        expect(valid).toBe(true);
    });

    it('TC-M2: insert two commitments and verify each proof independently', async () => {
        const builder = new PositionTreeBuilder!(20);

        const commitment0 = await prover.computeCommitment(0n, 2_000n, 0xdeadbeefn);
        const commitment1 = await prover.computeCommitment(1n, 40_000n, GOLDEN_RANDOMNESS);

        await builder.insert(commitment0);
        await builder.insert(commitment1);

        const proof0 = await builder.getProof(0);
        const proof1 = await builder.getProof(1);

        // Both proofs must be valid
        expect(await builder.verifyProof(proof0)).toBe(true);
        expect(await builder.verifyProof(proof1)).toBe(true);

        // Proofs must differ (different sibling hashes)
        expect(proof0.path[0]).not.toBe(proof1.path[0]);
    });

    it('TC-M3: getRoot changes after insertion', async () => {
        const builder = new PositionTreeBuilder!(20);

        const rootBefore = await builder.getRoot();
        await builder.insert(await prover.computeCommitment(1n, 40_000n, GOLDEN_RANDOMNESS));
        const rootAfter = await builder.getRoot();

        expect(rootBefore).not.toBe(rootAfter);
    });

    it('TC-M4: formatInputs uses correct proof data from tree', async () => {
        const builder = new PositionTreeBuilder!(20);

        const argumentIndex = 1n;
        const weightedAmount = 40_000n;
        const randomness = GOLDEN_RANDOMNESS;

        const commitment = await prover.computeCommitment(argumentIndex, weightedAmount, randomness);
        const insertedIdx = await builder.insert(commitment);

        const treeRoot = await builder.getRoot();
        const merkleProof = await builder.getProof(insertedIdx);

        const inputs: PositionNoteProofInput = {
            argumentIndex,
            weightedAmount,
            randomness,
            nullifierKey: GOLDEN_NULLIFIER_KEY,
            positionPath: merkleProof.path,
            positionIndex: merkleProof.index,
            positionRoot: treeRoot,
            debateId: 1n,
            winningArgumentIndex: 1n,
        };

        // Should not throw
        expect(() => prover.validateInputs(inputs)).not.toThrow();

        const formatted = await prover.formatInputs(inputs);

        // position_root must match the actual tree root
        const formattedRoot = BigInt(formatted.position_root as string);
        expect(formattedRoot).toBe(treeRoot);

        // position_index must match insertion index
        expect(formatted.position_index).toBe(insertedIdx);

        // position_path must have correct length
        const formattedPath = formatted.position_path as string[];
        expect(formattedPath).toHaveLength(POSITION_TREE_DEPTH);
    });

    it('TC-M5: verifyPositionMerkleProof helper agrees with builder.verifyProof', async () => {
        const builder = new PositionTreeBuilder!(20);

        const commitment = await prover.computeCommitment(2n, 12_648n, 0xcafebaben);
        await builder.insert(commitment);

        const treeRoot = await builder.getRoot();
        const merkleProof = await builder.getProof(0);

        // Both verification paths must agree
        const builderValid = await builder.verifyProof(merkleProof);
        const helperValid = await verifyPositionMerkleProof!(
            commitment,
            merkleProof.path,
            merkleProof.index,
            treeRoot,
        );

        expect(builderValid).toBe(true);
        expect(helperValid).toBe(true);
    });

    it('TC-M6: leaf count and capacity are tracked correctly', async () => {
        const builder = new PositionTreeBuilder!(20);

        expect(builder.getLeafCount()).toBe(0);
        expect(builder.getCapacity()).toBe(2 ** 20);

        await builder.insert(await prover.computeCommitment(0n, 2_000n, 0xabn));
        expect(builder.getLeafCount()).toBe(1);

        await builder.insert(await prover.computeCommitment(1n, 40_000n, 0xcdn));
        expect(builder.getLeafCount()).toBe(2);
    });

    it('TC-M7: getLeaves returns insertion-ordered commitments', async () => {
        const builder = new PositionTreeBuilder!(20);

        const c0 = await prover.computeCommitment(0n, 2_000n, 0x111n);
        const c1 = await prover.computeCommitment(1n, 40_000n, 0x222n);
        const c2 = await prover.computeCommitment(0n, 2_000n, 0x333n);

        await builder.insert(c0);
        await builder.insert(c1);
        await builder.insert(c2);

        const leaves = builder.getLeaves();
        expect(leaves).toHaveLength(3);
        expect(leaves[0]).toBe(c0);
        expect(leaves[1]).toBe(c1);
        expect(leaves[2]).toBe(c2);
    });

    it('TC-M8: depth-4 small tree proof verification', async () => {
        // Use depth=4 (16 leaves) for a fast integration smoke test
        const builder = new PositionTreeBuilder!(4);

        const commitments: bigint[] = [];
        for (let i = 0; i < 5; i++) {
            const c = await prover.computeCommitment(BigInt(i % 2), BigInt(i * 1000), BigInt(i + 1));
            commitments.push(c);
            await builder.insert(c);
        }

        // All proofs should be valid
        for (let i = 0; i < commitments.length; i++) {
            const proof = await builder.getProof(i);
            const valid = await builder.verifyProof(proof);
            expect(valid).toBe(true);
        }
    });
});

// ============================================================================
// Public Input Count Constant
// ============================================================================

describe('POSITION_NOTE_PUBLIC_INPUT_COUNT', () => {
    it('should be 5 (position_root + nullifier + debate_id + winning_arg + claimed_amount)', () => {
        expect(POSITION_NOTE_PUBLIC_INPUT_COUNT).toBe(5);
    });
});

// ============================================================================
// Circuit Tests (require compiled artifact — skipped if not available)
// ============================================================================

describeCircuit('PositionNoteNoirProver — Circuit (requires position_note.json)', () => {
    let prover: PositionNoteNoirProver;

    /**
     * Full integration uses a real PositionTreeBuilder to produce a real
     * Merkle proof, so the circuit's position_root check passes.
     */
    async function buildRealInputs(options: {
        argumentIndex: bigint;
        weightedAmount: bigint;
        winningArgumentIndex: bigint;
        debateId?: bigint;
    }): Promise<PositionNoteProofInput> {
        const builder = new PositionTreeBuilder!(20);
        const randomness = GOLDEN_RANDOMNESS;
        const debateId = options.debateId ?? 1n;

        const commitment = await prover.computeCommitment(
            options.argumentIndex,
            options.weightedAmount,
            randomness,
        );
        const insertedIdx = await builder.insert(commitment);
        const treeRoot = await builder.getRoot();
        const merkleProof = await builder.getProof(insertedIdx);

        return {
            argumentIndex: options.argumentIndex,
            weightedAmount: options.weightedAmount,
            randomness,
            nullifierKey: GOLDEN_NULLIFIER_KEY,
            positionPath: merkleProof.path,
            positionIndex: merkleProof.index,
            positionRoot: treeRoot,
            debateId,
            winningArgumentIndex: options.winningArgumentIndex,
        };
    }

    beforeAll(async () => {
        prover = new PositionNoteNoirProver({ threads: 1 });
        await prover.init();
    }, 120_000);

    afterAll(async () => {
        await resetPositionNoteProverSingleton();
        await prover.destroy();
    });

    it('TC-C1: generates valid proof for winning position (argument=1)', async () => {
        if (!TREE_BUILDER_AVAILABLE) {
            console.warn('Skipping TC-C1: PositionTreeBuilder not available');
            return;
        }

        const inputs = await buildRealInputs({
            argumentIndex: 1n,
            weightedAmount: 40_000n,
            winningArgumentIndex: 1n,
        });

        const result = await prover.generateProof(inputs);

        expect(result.proof).toBeInstanceOf(Uint8Array);
        expect(result.proof.length).toBeGreaterThan(0);
        expect(result.publicInputs).toHaveLength(POSITION_NOTE_PUBLIC_INPUT_COUNT);

        // Public input [3] must be winning_argument_index = 1
        expect(BigInt(result.publicInputs[3])).toBe(1n);
        // Public input [4] must be claimed_weighted_amount = 40_000
        expect(BigInt(result.publicInputs[4])).toBe(40_000n);
    }, 300_000);

    it('TC-C2: generates valid proof for argument=0, weight=2_000', async () => {
        if (!TREE_BUILDER_AVAILABLE) return;

        const inputs = await buildRealInputs({
            argumentIndex: 0n,
            weightedAmount: 2_000n,
            winningArgumentIndex: 0n,
        });

        const result = await prover.generateProof(inputs);

        expect(result.publicInputs).toHaveLength(POSITION_NOTE_PUBLIC_INPUT_COUNT);
        expect(BigInt(result.publicInputs[3])).toBe(0n);
        expect(BigInt(result.publicInputs[4])).toBe(2_000n);
    }, 300_000);

    it('TC-C3: valid proof verifies; tampered public input fails', async () => {
        if (!TREE_BUILDER_AVAILABLE) return;

        const inputs = await buildRealInputs({
            argumentIndex: 1n,
            weightedAmount: 40_000n,
            winningArgumentIndex: 1n,
        });

        const result = await prover.generateProof(inputs);

        // Valid proof must verify
        const isValid = await prover.verifyProof(result);
        expect(isValid).toBe(true);

        // Tamper: change claimed_weighted_amount (index 4) to wrong value
        const tampered = [...result.publicInputs];
        tampered[4] = '0x' + 40_001n.toString(16).padStart(64, '0');
        const tamperedResult = { ...result, publicInputs: tampered };

        const isTamperedValid = await prover.verifyProof(tamperedResult);
        expect(isTamperedValid).toBe(false);
    }, 600_000);

    it('TC-C4: validateInputs throws before circuit for randomness=0', async () => {
        if (!TREE_BUILDER_AVAILABLE) return;

        const inputs = await buildRealInputs({
            argumentIndex: 1n,
            weightedAmount: 40_000n,
            winningArgumentIndex: 1n,
        });
        const badInputs = { ...inputs, randomness: 0n };

        await expect(prover.generateProof(badInputs)).rejects.toThrow('randomness must be non-zero');
    });

    it('TC-C5: nullifier in proof matches TypeScript computeNullifier', async () => {
        if (!TREE_BUILDER_AVAILABLE) return;

        const inputs = await buildRealInputs({
            argumentIndex: 1n,
            weightedAmount: 40_000n,
            winningArgumentIndex: 1n,
            debateId: 99n,
        });

        // Pre-compute expected nullifier
        const commitment = await prover.computeCommitment(
            inputs.argumentIndex,
            inputs.weightedAmount,
            inputs.randomness,
        );
        const expectedNullifier = await prover.computeNullifier(
            inputs.nullifierKey,
            commitment,
            inputs.debateId,
        );

        const result = await prover.generateProof(inputs);

        // nullifier is at public input index 1
        const actualNullifier = BigInt(result.publicInputs[1]);
        expect(actualNullifier).toBe(expectedNullifier);
    }, 300_000);
});
