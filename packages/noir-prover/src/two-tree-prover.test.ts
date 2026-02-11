/**
 * TwoTreeNoirProver Unit Tests
 *
 * Tests the two-tree ZK proving infrastructure with the two_tree_membership circuit.
 *
 * Focus areas:
 * - Input validation (authority level, zero secret, array lengths, bit values)
 * - Input formatting (TypeScript -> Noir snake_case mapping)
 * - Circuit loading per depth
 * - Public input count verification
 *
 * NOTE: Full proof generation requires the Barretenberg backend and is slow.
 * For unit tests we focus on validation, formatting, and circuit initialization.
 * The circuit execute() call (witness generation) validates circuit logic without
 * needing the full proving backend.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BN254_MODULUS } from '@voter-protocol/crypto';
import {
    TwoTreeNoirProver,
    getTwoTreeProverForDepth,
    resetTwoTreeProverForDepth,
} from './two-tree-prover';
import type { TwoTreeProofInput } from './types';
import {
    DISTRICT_SLOT_COUNT,
    TWO_TREE_PUBLIC_INPUT_COUNT,
} from './types';

// ============================================================================
// Mock Input Helpers
// ============================================================================

/**
 * Create mock two-tree circuit inputs for testing.
 *
 * These values do NOT satisfy circuit constraints (the Poseidon2 hashes
 * will not match), but they are structurally correct for validation and
 * formatting tests.
 *
 * @param depth - Circuit depth (default: 20)
 * @param overrides - Optional field overrides
 */
function createMockTwoTreeInputs(
    depth: number = 20,
    overrides: Partial<TwoTreeProofInput> = {},
): TwoTreeProofInput {
    return {
        // Public inputs
        userRoot: 1n,
        cellMapRoot: 2n,
        districts: Array(DISTRICT_SLOT_COUNT).fill(0n).map((_, i) => BigInt(i + 100)),
        nullifier: 3n,
        actionDomain: 4n,
        authorityLevel: 1,

        // Private inputs
        userSecret: 42n,
        cellId: 67890n,
        registrationSalt: 11111n,
        identityCommitment: 99999n,
        userPath: Array(depth).fill(0n),
        userIndex: 0,
        cellMapPath: Array(depth).fill(0n),
        cellMapPathBits: Array(depth).fill(0),

        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('TwoTreeNoirProver', () => {
    describe('Instantiation', () => {
        it('should instantiate with default depth (20)', () => {
            const prover = new TwoTreeNoirProver();
            expect(prover.getDepth()).toBe(20);
        });

        it('should instantiate with explicit depth 18', () => {
            const prover = new TwoTreeNoirProver({ depth: 18 });
            expect(prover.getDepth()).toBe(18);
        });

        it('should instantiate with explicit depth 22', () => {
            const prover = new TwoTreeNoirProver({ depth: 22 });
            expect(prover.getDepth()).toBe(22);
        });

        it('should instantiate with explicit depth 24', () => {
            const prover = new TwoTreeNoirProver({ depth: 24 });
            expect(prover.getDepth()).toBe(24);
        });
    });

    describe('Input Validation', () => {
        let prover: TwoTreeNoirProver;

        beforeAll(() => {
            prover = new TwoTreeNoirProver({ depth: 20 });
        });

        it('should accept valid inputs', () => {
            const inputs = createMockTwoTreeInputs(20);
            expect(() => prover.validateInputs(inputs)).not.toThrow();
        });

        it('should reject zero user secret (SA-011)', () => {
            const inputs = createMockTwoTreeInputs(20, { userSecret: 0n });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'user_secret cannot be zero'
            );
        });

        it('should reject zero cellId (BR3-005)', () => {
            const inputs = createMockTwoTreeInputs(20, { cellId: 0n });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'cell_id cannot be zero'
            );
        });

        it('should reject zero actionDomain (BR3-005)', () => {
            const inputs = createMockTwoTreeInputs(20, { actionDomain: 0n });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'action_domain cannot be zero'
            );
        });

        it('should reject zero registrationSalt (BR3-005)', () => {
            const inputs = createMockTwoTreeInputs(20, { registrationSalt: 0n });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'registration_salt cannot be zero'
            );
        });

        it('should accept non-zero values for critical fields', () => {
            const inputs = createMockTwoTreeInputs(20, {
                userSecret: 42n,
                cellId: 67890n,
                actionDomain: 4n,
                registrationSalt: 11111n,
            });
            expect(() => prover.validateInputs(inputs)).not.toThrow();
        });

        it('should reject authority level 0', () => {
            const inputs = createMockTwoTreeInputs(20, { authorityLevel: 0 as any });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'Invalid authority level: 0'
            );
        });

        it('should reject authority level 6', () => {
            const inputs = createMockTwoTreeInputs(20, { authorityLevel: 6 as any });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'Invalid authority level: 6'
            );
        });

        it('should reject non-integer authority level', () => {
            const inputs = createMockTwoTreeInputs(20, { authorityLevel: 2.5 as any });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'Invalid authority level: 2.5'
            );
        });

        it('should accept all valid authority levels (1-5)', () => {
            for (const level of [1, 2, 3, 4, 5] as const) {
                const inputs = createMockTwoTreeInputs(20, { authorityLevel: level });
                expect(() => prover.validateInputs(inputs)).not.toThrow();
            }
        });

        it('should reject districts array with wrong length', () => {
            const inputs = createMockTwoTreeInputs(20, {
                districts: Array(23).fill(0n),
            });
            expect(() => prover.validateInputs(inputs)).toThrow(
                `districts array must have exactly ${DISTRICT_SLOT_COUNT} elements, got 23`
            );
        });

        it('should reject empty districts array', () => {
            const inputs = createMockTwoTreeInputs(20, {
                districts: [],
            });
            expect(() => prover.validateInputs(inputs)).toThrow(
                `districts array must have exactly ${DISTRICT_SLOT_COUNT} elements, got 0`
            );
        });

        it('should reject userPath with wrong length', () => {
            const inputs = createMockTwoTreeInputs(20, {
                userPath: Array(18).fill(0n),
            });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'userPath length mismatch: expected 20, got 18'
            );
        });

        it('should reject cellMapPath with wrong length', () => {
            const inputs = createMockTwoTreeInputs(20, {
                cellMapPath: Array(22).fill(0n),
            });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'cellMapPath length mismatch: expected 20, got 22'
            );
        });

        it('should reject cellMapPathBits with wrong length', () => {
            const inputs = createMockTwoTreeInputs(20, {
                cellMapPathBits: Array(19).fill(0),
            });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'cellMapPathBits length mismatch: expected 20, got 19'
            );
        });

        it('should reject cellMapPathBits with invalid bit value', () => {
            const bits = Array(20).fill(0);
            bits[5] = 2; // Invalid: must be 0 or 1
            const inputs = createMockTwoTreeInputs(20, {
                cellMapPathBits: bits,
            });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'cellMapPathBits[5] must be 0 or 1, got 2'
            );
        });

        it('should reject negative userIndex', () => {
            const inputs = createMockTwoTreeInputs(20, { userIndex: -1 });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'userIndex out of range'
            );
        });

        it('should reject userIndex exceeding tree capacity', () => {
            const inputs = createMockTwoTreeInputs(20, { userIndex: 2 ** 20 });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'userIndex out of range'
            );
        });

        it('should reject oversized userPath (DoS prevention)', () => {
            const inputs = createMockTwoTreeInputs(20, {
                userPath: Array(25).fill(0n), // > MAX_MERKLE_DEPTH
            });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'userPath exceeds maximum allowed depth'
            );
        });
    });

    describe('BN254 Field Validation (BR3-003)', () => {
        let prover: TwoTreeNoirProver;

        beforeAll(() => {
            prover = new TwoTreeNoirProver({ depth: 20 });
        });

        it('should accept field element at modulus - 1', () => {
            const maxValidValue = BN254_MODULUS - 1n;
            const inputs = createMockTwoTreeInputs(20, { userSecret: maxValidValue });
            // formatInputs internally calls toHex which validates field bounds
            expect(() => prover.formatInputs(inputs)).not.toThrow();
        });

        it('should reject field element at modulus', () => {
            const inputs = createMockTwoTreeInputs(20, { userSecret: BN254_MODULUS });
            expect(() => prover.formatInputs(inputs)).toThrow(
                'exceeds BN254 scalar field modulus'
            );
        });

        it('should reject field element above modulus', () => {
            const inputs = createMockTwoTreeInputs(20, { userSecret: BN254_MODULUS + 1n });
            expect(() => prover.formatInputs(inputs)).toThrow(
                'exceeds BN254 scalar field modulus'
            );
        });

        it('should reject negative field element', () => {
            const inputs = createMockTwoTreeInputs(20, { userSecret: -1n });
            expect(() => prover.formatInputs(inputs)).toThrow(
                'Field element cannot be negative'
            );
        });

        it('should accept zero as valid field element', () => {
            // Note: userSecret cannot be zero due to SA-011, so test with cellId instead
            const inputs = createMockTwoTreeInputs(20, { cellId: 0n });
            expect(() => prover.formatInputs(inputs)).not.toThrow();
        });

        it('should reject district values at modulus', () => {
            const districts = Array(DISTRICT_SLOT_COUNT).fill(0n);
            districts[0] = BN254_MODULUS; // Invalid value in first district
            const inputs = createMockTwoTreeInputs(20, { districts });
            expect(() => prover.formatInputs(inputs)).toThrow(
                'exceeds BN254 scalar field modulus'
            );
        });

        it('should reject userPath sibling at modulus', () => {
            const userPath = Array(20).fill(0n);
            userPath[10] = BN254_MODULUS; // Invalid sibling at index 10
            const inputs = createMockTwoTreeInputs(20, { userPath });
            expect(() => prover.formatInputs(inputs)).toThrow(
                'exceeds BN254 scalar field modulus'
            );
        });

        it('should reject cellMapPath sibling at modulus', () => {
            const cellMapPath = Array(20).fill(0n);
            cellMapPath[15] = BN254_MODULUS; // Invalid sibling at index 15
            const inputs = createMockTwoTreeInputs(20, { cellMapPath });
            expect(() => prover.formatInputs(inputs)).toThrow(
                'exceeds BN254 scalar field modulus'
            );
        });

        it('should reject public inputs at modulus', () => {
            const inputs = createMockTwoTreeInputs(20, { userRoot: BN254_MODULUS });
            expect(() => prover.formatInputs(inputs)).toThrow(
                'exceeds BN254 scalar field modulus'
            );
        });
    });

    describe('Input Formatting', () => {
        let prover: TwoTreeNoirProver;

        beforeAll(() => {
            prover = new TwoTreeNoirProver({ depth: 20 });
        });

        it('should format inputs with correct Noir parameter names', () => {
            const inputs = createMockTwoTreeInputs(20);
            const formatted = prover.formatInputs(inputs);

            // Check all expected keys exist
            expect(formatted).toHaveProperty('user_root');
            expect(formatted).toHaveProperty('cell_map_root');
            expect(formatted).toHaveProperty('districts');
            expect(formatted).toHaveProperty('nullifier');
            expect(formatted).toHaveProperty('action_domain');
            expect(formatted).toHaveProperty('authority_level');
            expect(formatted).toHaveProperty('user_secret');
            expect(formatted).toHaveProperty('cell_id');
            expect(formatted).toHaveProperty('registration_salt');
            expect(formatted).toHaveProperty('user_path');
            expect(formatted).toHaveProperty('user_index');
            expect(formatted).toHaveProperty('cell_map_path');
            expect(formatted).toHaveProperty('cell_map_path_bits');
        });

        it('should format bigint values as 0x-prefixed 64-char hex strings', () => {
            const inputs = createMockTwoTreeInputs(20, { userRoot: 255n });
            const formatted = prover.formatInputs(inputs);

            const userRoot = formatted.user_root as string;
            expect(userRoot).toBe('0x' + 'ff'.padStart(64, '0'));
            expect(userRoot).toHaveLength(66); // 0x + 64 chars
        });

        it('should format authority_level as hex field element', () => {
            const inputs = createMockTwoTreeInputs(20, { authorityLevel: 3 });
            const formatted = prover.formatInputs(inputs);

            // authority_level is a Noir Field, so it must be a 0x-prefixed hex string
            expect(formatted.authority_level).toBe('0x' + '3'.padStart(64, '0'));
            expect(typeof formatted.authority_level).toBe('string');
        });

        it('should format districts as array of hex strings', () => {
            const inputs = createMockTwoTreeInputs(20);
            const formatted = prover.formatInputs(inputs);

            const districts = formatted.districts as string[];
            expect(districts).toHaveLength(DISTRICT_SLOT_COUNT);
            for (const d of districts) {
                expect(d).toMatch(/^0x[0-9a-f]{64}$/);
            }
        });

        it('should format user_path as array of hex strings', () => {
            const inputs = createMockTwoTreeInputs(20);
            const formatted = prover.formatInputs(inputs);

            const userPath = formatted.user_path as string[];
            expect(userPath).toHaveLength(20);
            for (const s of userPath) {
                expect(s).toMatch(/^0x[0-9a-f]{64}$/);
            }
        });

        it('should pass cellMapPathBits as plain integers', () => {
            const bits = Array(20).fill(0);
            bits[0] = 1;
            bits[3] = 1;
            bits[19] = 1;

            const inputs = createMockTwoTreeInputs(20, { cellMapPathBits: bits });
            const formatted = prover.formatInputs(inputs);

            const formattedBits = formatted.cell_map_path_bits as number[];
            expect(formattedBits).toEqual(bits);
            expect(formattedBits[0]).toBe(1);
            expect(formattedBits[1]).toBe(0);
            expect(formattedBits[3]).toBe(1);
        });

        it('should pass userIndex as plain number', () => {
            const inputs = createMockTwoTreeInputs(20, { userIndex: 42 });
            const formatted = prover.formatInputs(inputs);

            expect(formatted.user_index).toBe(42);
            expect(typeof formatted.user_index).toBe('number');
        });
    });

    describe('Public Input Count', () => {
        it('should define correct public input count (29)', () => {
            // user_root(1) + cell_map_root(1) + districts(24) + nullifier(1) + action_domain(1) + authority_level(1) = 29
            expect(TWO_TREE_PUBLIC_INPUT_COUNT).toBe(29);
        });

        it('should match the sum of individual public input fields', () => {
            const userRoot = 1;       // user_root
            const cellMapRoot = 1;    // cell_map_root
            const districts = 24;     // districts[0..24]
            const nullifier = 1;      // nullifier
            const actionDomain = 1;   // action_domain
            const authorityLevel = 1; // authority_level

            expect(userRoot + cellMapRoot + districts + nullifier + actionDomain + authorityLevel)
                .toBe(TWO_TREE_PUBLIC_INPUT_COUNT);
        });
    });
});

describe('TwoTreeNoirProver Integration', () => {
    let prover: TwoTreeNoirProver;

    beforeAll(async () => {
        prover = new TwoTreeNoirProver({ depth: 20 });
    }, 120000);

    afterAll(async () => {
        if (prover) {
            await prover.destroy();
        }
    });

    describe('Initialization', () => {
        it('should initialize Barretenberg backend', async () => {
            await prover.init();
            // If no error thrown, circuit loaded and backend initialized
            expect(prover.getDepth()).toBe(20);
        }, 60000);
    });

    describe('Witness Generation', () => {
        it('should reject mock inputs at circuit level (constraints not satisfied)', async () => {
            // Mock values will not satisfy Poseidon2 constraints in the circuit.
            // This test verifies that the prover correctly loads and executes the
            // circuit, and that circuit assertion failures propagate as errors.
            const inputs = createMockTwoTreeInputs(20);

            await expect(prover.generateProof(inputs)).rejects.toThrow();
        }, 180000);
    });
});

describe('TwoTreeNoirProver - Depth 24', () => {
    let prover: TwoTreeNoirProver;

    beforeAll(async () => {
        prover = await getTwoTreeProverForDepth(24);
    }, 120000);

    afterAll(async () => {
        await resetTwoTreeProverForDepth(24);
    });

    it('initializes prover for depth 24', () => {
        expect(prover).toBeDefined();
        expect(prover.getDepth()).toBe(24);
    });

    it('validates inputs at depth 24', () => {
        const inputs = createMockTwoTreeInputs(24);
        expect(() => prover.validateInputs(inputs)).not.toThrow();
    });

    it('rejects depth-20 inputs at depth-24 prover', () => {
        const inputs = createMockTwoTreeInputs(20); // Wrong depth
        expect(() => prover.validateInputs(inputs)).toThrow(
            'userPath length mismatch: expected 24, got 20'
        );
    });

    it('formats 24-element paths correctly', () => {
        const inputs = createMockTwoTreeInputs(24);
        const formatted = prover.formatInputs(inputs);

        expect((formatted.user_path as string[]).length).toBe(24);
        expect((formatted.cell_map_path as string[]).length).toBe(24);
        expect((formatted.cell_map_path_bits as number[]).length).toBe(24);
    });
});

/**
 * Heavy Tests - Gated behind RUN_HEAVY_TESTS=true
 *
 * These tests require significant memory (8GB+) and are skipped by default.
 * Run with: RUN_HEAVY_TESTS=true npx vitest run packages/noir-prover/src/two-tree-prover.test.ts
 */
describe.skipIf(!process.env.RUN_HEAVY_TESTS)('TwoTreeNoirProver - Heavy Tests', () => {
    describe('Depth-24 Proof Generation (BA-017)', () => {
        let prover: TwoTreeNoirProver;

        beforeAll(async () => {
            // Depth-24 circuit is large - increase timeout
            prover = new TwoTreeNoirProver({ depth: 24 });
            await prover.init();
        }, 300000); // 5 minute timeout for init

        afterAll(async () => {
            if (prover) {
                await prover.destroy();
            }
        });

        it('should reject mock inputs at circuit level (constraints not satisfied)', async () => {
            // This test verifies the depth-24 circuit loads and executes correctly.
            // Mock values will not satisfy Poseidon2 constraints, but reaching the
            // circuit assertion failure proves the WASM loaded and ran.
            const inputs = createMockTwoTreeInputs(24);

            await expect(prover.generateProof(inputs)).rejects.toThrow();
        }, 600000); // 10 minute timeout for proof attempt

        it('validates depth-24 specific constraints', () => {
            // Verify prover correctly initialized at depth 24
            expect(prover.getDepth()).toBe(24);

            // Verify it rejects wrong-depth inputs
            const depth20Inputs = createMockTwoTreeInputs(20);
            expect(() => prover.validateInputs(depth20Inputs)).toThrow(
                'userPath length mismatch: expected 24, got 20'
            );
        });
    });
});

// ============================================================================
// Wave 28a: BR5-006, BR5-017 Tests (outside heavy-test block)
// ============================================================================

describe('BR5-006: Public Input Binding', () => {
    let prover: TwoTreeNoirProver;

    beforeAll(() => {
        prover = new TwoTreeNoirProver({ depth: 20 });
    });

    it('verifyProof rejects wrong public input count', async () => {
        const badResult = {
            proof: new Uint8Array(32),
            publicInputs: ['0x1', '0x2'], // Too few
        };

        await expect(prover.verifyProof(badResult)).rejects.toThrow(
            'BR5-006: Public input count mismatch'
        );
    });

    it('verifyProofWithExpectedInputs detects user_root mismatch', async () => {
        const inputs = createMockTwoTreeInputs(20);

        const pi = Array(TWO_TREE_PUBLIC_INPUT_COUNT).fill('0x0');
        pi[0] = '0x' + (999n).toString(16); // Wrong user_root (expected 1n)
        pi[1] = '0x' + inputs.cellMapRoot.toString(16);
        for (let i = 0; i < DISTRICT_SLOT_COUNT; i++) {
            pi[2 + i] = '0x' + inputs.districts[i].toString(16);
        }
        pi[26] = '0x' + inputs.nullifier.toString(16);
        pi[27] = '0x' + inputs.actionDomain.toString(16);
        pi[28] = '0x' + BigInt(inputs.authorityLevel).toString(16);

        const mockBackend = {
            verifyProof: async () => true,
            generateProof: async () => ({ proof: new Uint8Array(), publicInputs: [] }),
            destroy: async () => {},
        };
        (prover as any).backend = mockBackend;
        (prover as any).noir = {};

        await expect(
            prover.verifyProofWithExpectedInputs(
                { proof: new Uint8Array(32), publicInputs: pi },
                inputs,
            )
        ).rejects.toThrow('BR5-006: Public input mismatch at index 0 (user_root)');
    });

    it('verifyProofWithExpectedInputs detects district mismatch', async () => {
        const inputs = createMockTwoTreeInputs(20);

        const pi = Array(TWO_TREE_PUBLIC_INPUT_COUNT).fill('0x0');
        pi[0] = '0x' + inputs.userRoot.toString(16);
        pi[1] = '0x' + inputs.cellMapRoot.toString(16);
        for (let i = 0; i < DISTRICT_SLOT_COUNT; i++) {
            pi[2 + i] = '0x' + inputs.districts[i].toString(16);
        }
        pi[2 + 5] = '0x' + (888n).toString(16); // Tamper with district slot 5
        pi[26] = '0x' + inputs.nullifier.toString(16);
        pi[27] = '0x' + inputs.actionDomain.toString(16);
        pi[28] = '0x' + BigInt(inputs.authorityLevel).toString(16);

        const mockBackend = {
            verifyProof: async () => true,
            generateProof: async () => ({ proof: new Uint8Array(), publicInputs: [] }),
            destroy: async () => {},
        };
        (prover as any).backend = mockBackend;
        (prover as any).noir = {};

        await expect(
            prover.verifyProofWithExpectedInputs(
                { proof: new Uint8Array(32), publicInputs: pi },
                inputs,
            )
        ).rejects.toThrow('BR5-006: District mismatch at slot 5');
    });

    it('verifyProofWithExpectedInputs accepts matching inputs', async () => {
        const inputs = createMockTwoTreeInputs(20);

        const pi = Array(TWO_TREE_PUBLIC_INPUT_COUNT).fill('0x0');
        pi[0] = '0x' + inputs.userRoot.toString(16);
        pi[1] = '0x' + inputs.cellMapRoot.toString(16);
        for (let i = 0; i < DISTRICT_SLOT_COUNT; i++) {
            pi[2 + i] = '0x' + inputs.districts[i].toString(16);
        }
        pi[26] = '0x' + inputs.nullifier.toString(16);
        pi[27] = '0x' + inputs.actionDomain.toString(16);
        pi[28] = '0x' + BigInt(inputs.authorityLevel).toString(16);

        const mockBackend = {
            verifyProof: async () => true,
            generateProof: async () => ({ proof: new Uint8Array(), publicInputs: [] }),
            destroy: async () => {},
        };
        (prover as any).backend = mockBackend;
        (prover as any).noir = {};

        const result = await prover.verifyProofWithExpectedInputs(
            { proof: new Uint8Array(32), publicInputs: pi },
            inputs,
        );
        expect(result).toBe(true);
    });

    it('verifyProofWithExpectedInputs detects nullifier mismatch', async () => {
        const inputs = createMockTwoTreeInputs(20);

        const pi = Array(TWO_TREE_PUBLIC_INPUT_COUNT).fill('0x0');
        pi[0] = '0x' + inputs.userRoot.toString(16);
        pi[1] = '0x' + inputs.cellMapRoot.toString(16);
        for (let i = 0; i < DISTRICT_SLOT_COUNT; i++) {
            pi[2 + i] = '0x' + inputs.districts[i].toString(16);
        }
        pi[26] = '0x' + (777n).toString(16); // Wrong nullifier (expected 3n)
        pi[27] = '0x' + inputs.actionDomain.toString(16);
        pi[28] = '0x' + BigInt(inputs.authorityLevel).toString(16);

        const mockBackend = {
            verifyProof: async () => true,
            generateProof: async () => ({ proof: new Uint8Array(), publicInputs: [] }),
            destroy: async () => {},
        };
        (prover as any).backend = mockBackend;
        (prover as any).noir = {};

        await expect(
            prover.verifyProofWithExpectedInputs(
                { proof: new Uint8Array(32), publicInputs: pi },
                inputs,
            )
        ).rejects.toThrow('BR5-006: Public input mismatch at index 26 (nullifier)');
    });

    it('verifyProofWithExpectedInputs detects actionDomain mismatch', async () => {
        const inputs = createMockTwoTreeInputs(20);

        const pi = Array(TWO_TREE_PUBLIC_INPUT_COUNT).fill('0x0');
        pi[0] = '0x' + inputs.userRoot.toString(16);
        pi[1] = '0x' + inputs.cellMapRoot.toString(16);
        for (let i = 0; i < DISTRICT_SLOT_COUNT; i++) {
            pi[2 + i] = '0x' + inputs.districts[i].toString(16);
        }
        pi[26] = '0x' + inputs.nullifier.toString(16);
        pi[27] = '0x' + (555n).toString(16); // Wrong actionDomain (expected 4n)
        pi[28] = '0x' + BigInt(inputs.authorityLevel).toString(16);

        const mockBackend = {
            verifyProof: async () => true,
            generateProof: async () => ({ proof: new Uint8Array(), publicInputs: [] }),
            destroy: async () => {},
        };
        (prover as any).backend = mockBackend;
        (prover as any).noir = {};

        await expect(
            prover.verifyProofWithExpectedInputs(
                { proof: new Uint8Array(32), publicInputs: pi },
                inputs,
            )
        ).rejects.toThrow('BR5-006: Public input mismatch at index 27 (action_domain)');
    });

    it('verifyProofWithExpectedInputs detects authorityLevel mismatch', async () => {
        const inputs = createMockTwoTreeInputs(20);

        const pi = Array(TWO_TREE_PUBLIC_INPUT_COUNT).fill('0x0');
        pi[0] = '0x' + inputs.userRoot.toString(16);
        pi[1] = '0x' + inputs.cellMapRoot.toString(16);
        for (let i = 0; i < DISTRICT_SLOT_COUNT; i++) {
            pi[2 + i] = '0x' + inputs.districts[i].toString(16);
        }
        pi[26] = '0x' + inputs.nullifier.toString(16);
        pi[27] = '0x' + inputs.actionDomain.toString(16);
        pi[28] = '0x' + (5n).toString(16); // Wrong authority (expected 1)

        const mockBackend = {
            verifyProof: async () => true,
            generateProof: async () => ({ proof: new Uint8Array(), publicInputs: [] }),
            destroy: async () => {},
        };
        (prover as any).backend = mockBackend;
        (prover as any).noir = {};

        await expect(
            prover.verifyProofWithExpectedInputs(
                { proof: new Uint8Array(32), publicInputs: pi },
                inputs,
            )
        ).rejects.toThrow('BR5-006: Public input mismatch at index 28 (authority_level)');
    });

    it('verifyProofWithExpectedInputs detects cellMapRoot mismatch', async () => {
        const inputs = createMockTwoTreeInputs(20);

        const pi = Array(TWO_TREE_PUBLIC_INPUT_COUNT).fill('0x0');
        pi[0] = '0x' + inputs.userRoot.toString(16);
        pi[1] = '0x' + (444n).toString(16); // Wrong cellMapRoot (expected 2n)
        for (let i = 0; i < DISTRICT_SLOT_COUNT; i++) {
            pi[2 + i] = '0x' + inputs.districts[i].toString(16);
        }
        pi[26] = '0x' + inputs.nullifier.toString(16);
        pi[27] = '0x' + inputs.actionDomain.toString(16);
        pi[28] = '0x' + BigInt(inputs.authorityLevel).toString(16);

        const mockBackend = {
            verifyProof: async () => true,
            generateProof: async () => ({ proof: new Uint8Array(), publicInputs: [] }),
            destroy: async () => {},
        };
        (prover as any).backend = mockBackend;
        (prover as any).noir = {};

        await expect(
            prover.verifyProofWithExpectedInputs(
                { proof: new Uint8Array(32), publicInputs: pi },
                inputs,
            )
        ).rejects.toThrow('BR5-006: Public input mismatch at index 1 (cell_map_root)');
    });

    it('verifyProofWithExpectedInputs rejects non-hex public input (28M-001)', async () => {
        const inputs = createMockTwoTreeInputs(20);

        const pi = Array(TWO_TREE_PUBLIC_INPUT_COUNT).fill('0x0');
        pi[0] = 'not-hex'; // Invalid format

        const mockBackend = {
            verifyProof: async () => true,
            generateProof: async () => ({ proof: new Uint8Array(), publicInputs: [] }),
            destroy: async () => {},
        };
        (prover as any).backend = mockBackend;
        (prover as any).noir = {};

        await expect(
            prover.verifyProofWithExpectedInputs(
                { proof: new Uint8Array(32), publicInputs: pi },
                inputs,
            )
        ).rejects.toThrow('BR5-006: Invalid public input format');
    });

    it('verifyProofWithExpectedInputs rejects BN254-overflowed public input (28M-002)', async () => {
        const inputs = createMockTwoTreeInputs(20);

        const pi = Array(TWO_TREE_PUBLIC_INPUT_COUNT).fill('0x0');
        // BN254 modulus as hex — exceeds the field
        pi[0] = '0x' + BN254_MODULUS.toString(16);
        pi[1] = '0x' + inputs.cellMapRoot.toString(16);

        const mockBackend = {
            verifyProof: async () => true,
            generateProof: async () => ({ proof: new Uint8Array(), publicInputs: [] }),
            destroy: async () => {},
        };
        (prover as any).backend = mockBackend;
        (prover as any).noir = {};

        await expect(
            prover.verifyProofWithExpectedInputs(
                { proof: new Uint8Array(32), publicInputs: pi },
                inputs,
            )
        ).rejects.toThrow('exceeds BN254 scalar field modulus');
    });

    it('verifyProofWithExpectedInputs returns false when crypto verification fails', async () => {
        const inputs = createMockTwoTreeInputs(20);

        const pi = Array(TWO_TREE_PUBLIC_INPUT_COUNT).fill('0x0');
        pi[0] = '0x' + inputs.userRoot.toString(16);
        pi[1] = '0x' + inputs.cellMapRoot.toString(16);
        for (let i = 0; i < DISTRICT_SLOT_COUNT; i++) {
            pi[2 + i] = '0x' + inputs.districts[i].toString(16);
        }
        pi[26] = '0x' + inputs.nullifier.toString(16);
        pi[27] = '0x' + inputs.actionDomain.toString(16);
        pi[28] = '0x' + BigInt(inputs.authorityLevel).toString(16);

        const mockBackend = {
            verifyProof: async () => false,
            generateProof: async () => ({ proof: new Uint8Array(), publicInputs: [] }),
            destroy: async () => {},
        };
        (prover as any).backend = mockBackend;
        (prover as any).noir = {};

        const result = await prover.verifyProofWithExpectedInputs(
            { proof: new Uint8Array(32), publicInputs: pi },
            inputs,
        );
        expect(result).toBe(false);
    });
});

describe('BR5-017: District Ordering Validation', () => {
    let prover: TwoTreeNoirProver;

    beforeAll(() => {
        prover = new TwoTreeNoirProver({ depth: 20 });
    });

    it('accepts unique non-zero districts', () => {
        const inputs = createMockTwoTreeInputs(20);
        expect(() => prover.validateInputs(inputs)).not.toThrow();
    });

    it('accepts all-zero districts (empty cell)', () => {
        const inputs = createMockTwoTreeInputs(20, {
            districts: Array(DISTRICT_SLOT_COUNT).fill(0n),
        });
        expect(() => prover.validateInputs(inputs)).not.toThrow();
    });

    it('accepts mix of zero and non-zero districts', () => {
        const districts = Array(DISTRICT_SLOT_COUNT).fill(0n);
        districts[0] = 100n;
        districts[3] = 200n;
        districts[7] = 300n;
        const inputs = createMockTwoTreeInputs(20, { districts });
        expect(() => prover.validateInputs(inputs)).not.toThrow();
    });

    it('rejects duplicate non-zero districts', () => {
        const districts = Array(DISTRICT_SLOT_COUNT).fill(0n);
        districts[0] = 100n;
        districts[3] = 100n;
        const inputs = createMockTwoTreeInputs(20, { districts });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'BR5-017: Duplicate district ID at slot 3'
        );
    });

    it('rejects district exceeding BN254 modulus', () => {
        const districts = Array(DISTRICT_SLOT_COUNT).fill(0n);
        districts[0] = BN254_MODULUS;
        const inputs = createMockTwoTreeInputs(20, { districts });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'districts[0] exceeds BN254 scalar field modulus'
        );
    });

    it('rejects negative district value', () => {
        const districts = Array(DISTRICT_SLOT_COUNT).fill(0n);
        districts[2] = -1n;
        const inputs = createMockTwoTreeInputs(20, { districts });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'districts[2] cannot be negative'
        );
    });
});

describe('BN254 Validation for All Fields', () => {
    let prover: TwoTreeNoirProver;

    beforeAll(() => {
        prover = new TwoTreeNoirProver({ depth: 20 });
    });

    it('rejects userRoot at BN254 modulus', () => {
        const inputs = createMockTwoTreeInputs(20, { userRoot: BN254_MODULUS });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'userRoot exceeds BN254 scalar field modulus'
        );
    });

    it('rejects cellMapRoot at BN254 modulus', () => {
        const inputs = createMockTwoTreeInputs(20, { cellMapRoot: BN254_MODULUS });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'cellMapRoot exceeds BN254 scalar field modulus'
        );
    });

    it('rejects identityCommitment at BN254 modulus', () => {
        const inputs = createMockTwoTreeInputs(20, { identityCommitment: BN254_MODULUS });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'identityCommitment exceeds BN254 scalar field modulus'
        );
    });

    it('rejects userPath sibling at BN254 modulus via validateInputs', () => {
        const userPath = Array(20).fill(0n);
        userPath[10] = BN254_MODULUS;
        const inputs = createMockTwoTreeInputs(20, { userPath });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'userPath[10] outside BN254 scalar field'
        );
    });

    it('rejects cellMapPath sibling at BN254 modulus via validateInputs', () => {
        const cellMapPath = Array(20).fill(0n);
        cellMapPath[5] = BN254_MODULUS;
        const inputs = createMockTwoTreeInputs(20, { cellMapPath });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'cellMapPath[5] outside BN254 scalar field'
        );
    });
});
