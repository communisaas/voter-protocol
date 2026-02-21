/**
 * ThreeTreeNoirProver Unit Tests
 *
 * Tests the three-tree ZK proving infrastructure with the three_tree_membership circuit.
 *
 * Focus areas:
 * - Input validation (authority level, engagement tier, zero fields, array lengths)
 * - Input formatting (TypeScript -> Noir snake_case mapping)
 * - Circuit loading per depth
 * - Public input count verification
 * - BR5-006 public input binding
 * - Singleton management
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BN254_MODULUS } from '@voter-protocol/crypto';
import {
    ThreeTreeNoirProver,
    getThreeTreeProverForDepth,
    resetThreeTreeProverForDepth,
} from './three-tree-prover';
import type { ThreeTreeProofInput } from './types';
import {
    DISTRICT_SLOT_COUNT,
    THREE_TREE_PUBLIC_INPUT_COUNT,
} from './types';

// ============================================================================
// Mock Input Helpers
// ============================================================================

function createMockThreeTreeInputs(
    depth: number = 20,
    overrides: Partial<ThreeTreeProofInput> = {},
): ThreeTreeProofInput {
    return {
        // Public inputs (two-tree)
        userRoot: 1n,
        cellMapRoot: 2n,
        districts: Array(DISTRICT_SLOT_COUNT).fill(0n).map((_, i) => BigInt(i + 100)),
        nullifier: 3n,
        actionDomain: 4n,
        authorityLevel: 1,

        // Public inputs (three-tree additions)
        engagementRoot: 5n,
        engagementTier: 0,

        // Private inputs (two-tree)
        userSecret: 42n,
        cellId: 67890n,
        registrationSalt: 11111n,
        identityCommitment: 99999n,
        userPath: Array(depth).fill(0n),
        userIndex: 0,
        cellMapPath: Array(depth).fill(0n),
        cellMapPathBits: Array(depth).fill(0),

        // Private inputs (three-tree additions)
        engagementPath: Array(depth).fill(0n),
        engagementIndex: 0,
        actionCount: 10n,
        diversityScore: 3n,

        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('ThreeTreeNoirProver', () => {
    describe('Instantiation', () => {
        it('should instantiate with default depth (20)', () => {
            const prover = new ThreeTreeNoirProver();
            expect(prover.getDepth()).toBe(20);
        });

        it('should instantiate with explicit depth 18', () => {
            const prover = new ThreeTreeNoirProver({ depth: 18 });
            expect(prover.getDepth()).toBe(18);
        });

        it('should instantiate with explicit depth 22', () => {
            const prover = new ThreeTreeNoirProver({ depth: 22 });
            expect(prover.getDepth()).toBe(22);
        });

        it('should instantiate with explicit depth 24', () => {
            const prover = new ThreeTreeNoirProver({ depth: 24 });
            expect(prover.getDepth()).toBe(24);
        });
    });

    describe('Input Validation', () => {
        let prover: ThreeTreeNoirProver;

        beforeAll(() => {
            prover = new ThreeTreeNoirProver({ depth: 20 });
        });

        it('should accept valid inputs', () => {
            const inputs = createMockThreeTreeInputs(20);
            expect(() => prover.validateInputs(inputs)).not.toThrow();
        });

        // Zero-field rejections
        it('should reject zero user secret (SA-011)', () => {
            const inputs = createMockThreeTreeInputs(20, { userSecret: 0n });
            expect(() => prover.validateInputs(inputs)).toThrow('user_secret cannot be zero');
        });

        it('should reject zero cellId (BR3-005)', () => {
            const inputs = createMockThreeTreeInputs(20, { cellId: 0n });
            expect(() => prover.validateInputs(inputs)).toThrow('cell_id cannot be zero');
        });

        it('should reject zero actionDomain (BR3-005)', () => {
            const inputs = createMockThreeTreeInputs(20, { actionDomain: 0n });
            expect(() => prover.validateInputs(inputs)).toThrow('action_domain cannot be zero');
        });

        it('should reject zero registrationSalt (BR3-005)', () => {
            const inputs = createMockThreeTreeInputs(20, { registrationSalt: 0n });
            expect(() => prover.validateInputs(inputs)).toThrow('registration_salt cannot be zero');
        });

        it('should reject zero identityCommitment (NUL-001)', () => {
            const inputs = createMockThreeTreeInputs(20, { identityCommitment: 0n });
            expect(() => prover.validateInputs(inputs)).toThrow('identity_commitment cannot be zero');
        });

        // Authority level validation
        it('should reject authority level 0', () => {
            const inputs = createMockThreeTreeInputs(20, { authorityLevel: 0 as any });
            expect(() => prover.validateInputs(inputs)).toThrow('Invalid authority level: 0');
        });

        it('should reject authority level 6', () => {
            const inputs = createMockThreeTreeInputs(20, { authorityLevel: 6 as any });
            expect(() => prover.validateInputs(inputs)).toThrow('Invalid authority level: 6');
        });

        it('should accept all valid authority levels (1-5)', () => {
            for (const level of [1, 2, 3, 4, 5] as const) {
                const inputs = createMockThreeTreeInputs(20, { authorityLevel: level });
                expect(() => prover.validateInputs(inputs)).not.toThrow();
            }
        });

        // Engagement tier validation (REP-001)
        it('should reject engagement tier -1', () => {
            const inputs = createMockThreeTreeInputs(20, { engagementTier: -1 as any });
            expect(() => prover.validateInputs(inputs)).toThrow('Invalid engagement tier: -1');
        });

        it('should reject engagement tier 5', () => {
            const inputs = createMockThreeTreeInputs(20, { engagementTier: 5 as any });
            expect(() => prover.validateInputs(inputs)).toThrow('Invalid engagement tier: 5');
        });

        it('should reject non-integer engagement tier', () => {
            const inputs = createMockThreeTreeInputs(20, { engagementTier: 1.5 as any });
            expect(() => prover.validateInputs(inputs)).toThrow('Invalid engagement tier: 1.5');
        });

        it('should accept all valid engagement tiers (0-4)', () => {
            for (const tier of [0, 1, 2, 3, 4] as const) {
                const inputs = createMockThreeTreeInputs(20, { engagementTier: tier });
                expect(() => prover.validateInputs(inputs)).not.toThrow();
            }
        });

        // Array length validation
        it('should reject districts array with wrong length', () => {
            const inputs = createMockThreeTreeInputs(20, { districts: Array(23).fill(0n) });
            expect(() => prover.validateInputs(inputs)).toThrow(
                `districts array must have exactly ${DISTRICT_SLOT_COUNT} elements, got 23`
            );
        });

        it('should reject userPath with wrong length', () => {
            const inputs = createMockThreeTreeInputs(20, { userPath: Array(18).fill(0n) });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'userPath length mismatch: expected 20, got 18'
            );
        });

        it('should reject cellMapPath with wrong length', () => {
            const inputs = createMockThreeTreeInputs(20, { cellMapPath: Array(22).fill(0n) });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'cellMapPath length mismatch: expected 20, got 22'
            );
        });

        it('should reject cellMapPathBits with wrong length', () => {
            const inputs = createMockThreeTreeInputs(20, { cellMapPathBits: Array(19).fill(0) });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'cellMapPathBits length mismatch: expected 20, got 19'
            );
        });

        it('should reject engagementPath with wrong length', () => {
            const inputs = createMockThreeTreeInputs(20, { engagementPath: Array(18).fill(0n) });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'engagementPath length mismatch: expected 20, got 18'
            );
        });

        it('should reject cellMapPathBits with invalid bit value', () => {
            const bits = Array(20).fill(0);
            bits[5] = 2;
            const inputs = createMockThreeTreeInputs(20, { cellMapPathBits: bits });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'cellMapPathBits[5] must be 0 or 1, got 2'
            );
        });

        // Index range validation
        it('should reject negative userIndex', () => {
            const inputs = createMockThreeTreeInputs(20, { userIndex: -1 });
            expect(() => prover.validateInputs(inputs)).toThrow('userIndex out of range');
        });

        it('should reject userIndex exceeding tree capacity', () => {
            const inputs = createMockThreeTreeInputs(20, { userIndex: 2 ** 20 });
            expect(() => prover.validateInputs(inputs)).toThrow('userIndex out of range');
        });

        it('should reject negative engagementIndex', () => {
            const inputs = createMockThreeTreeInputs(20, { engagementIndex: -1 });
            expect(() => prover.validateInputs(inputs)).toThrow('engagementIndex out of range');
        });

        it('should reject engagementIndex exceeding tree capacity', () => {
            const inputs = createMockThreeTreeInputs(20, { engagementIndex: 2 ** 20 });
            expect(() => prover.validateInputs(inputs)).toThrow('engagementIndex out of range');
        });

        it('should reject oversized userPath (DoS prevention)', () => {
            const inputs = createMockThreeTreeInputs(20, { userPath: Array(25).fill(0n) });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'userPath exceeds maximum allowed depth'
            );
        });
    });

    describe('BN254 Field Validation (BR3-003)', () => {
        let prover: ThreeTreeNoirProver;

        beforeAll(() => {
            prover = new ThreeTreeNoirProver({ depth: 20 });
        });

        it('should accept field element at modulus - 1', () => {
            const inputs = createMockThreeTreeInputs(20, { userSecret: BN254_MODULUS - 1n });
            expect(() => prover.formatInputs(inputs)).not.toThrow();
        });

        it('should reject field element at modulus', () => {
            const inputs = createMockThreeTreeInputs(20, { userSecret: BN254_MODULUS });
            expect(() => prover.formatInputs(inputs)).toThrow('exceeds BN254 scalar field modulus');
        });

        it('should reject negative field element', () => {
            const inputs = createMockThreeTreeInputs(20, { userSecret: -1n });
            expect(() => prover.formatInputs(inputs)).toThrow('Field element cannot be negative');
        });

        it('should reject engagementRoot at modulus', () => {
            const inputs = createMockThreeTreeInputs(20, { engagementRoot: BN254_MODULUS });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'engagementRoot exceeds BN254 scalar field modulus'
            );
        });

        it('should reject actionCount at modulus', () => {
            const inputs = createMockThreeTreeInputs(20, { actionCount: BN254_MODULUS });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'actionCount exceeds BN254 scalar field modulus'
            );
        });

        it('should reject diversityScore at modulus', () => {
            const inputs = createMockThreeTreeInputs(20, { diversityScore: BN254_MODULUS });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'diversityScore exceeds BN254 scalar field modulus'
            );
        });

        it('should reject engagementPath sibling at modulus', () => {
            const engagementPath = Array(20).fill(0n);
            engagementPath[7] = BN254_MODULUS;
            const inputs = createMockThreeTreeInputs(20, { engagementPath });
            expect(() => prover.validateInputs(inputs)).toThrow(
                'engagementPath[7] outside BN254 scalar field'
            );
        });
    });

    describe('Input Formatting', () => {
        let prover: ThreeTreeNoirProver;

        beforeAll(() => {
            prover = new ThreeTreeNoirProver({ depth: 20 });
        });

        it('should format inputs with correct Noir parameter names', () => {
            const inputs = createMockThreeTreeInputs(20);
            const formatted = prover.formatInputs(inputs);

            // Two-tree fields
            expect(formatted).toHaveProperty('user_root');
            expect(formatted).toHaveProperty('cell_map_root');
            expect(formatted).toHaveProperty('districts');
            expect(formatted).toHaveProperty('nullifier');
            expect(formatted).toHaveProperty('action_domain');
            expect(formatted).toHaveProperty('authority_level');
            expect(formatted).toHaveProperty('user_secret');
            expect(formatted).toHaveProperty('cell_id');
            expect(formatted).toHaveProperty('registration_salt');
            expect(formatted).toHaveProperty('identity_commitment');
            expect(formatted).toHaveProperty('user_path');
            expect(formatted).toHaveProperty('user_index');
            expect(formatted).toHaveProperty('cell_map_path');
            expect(formatted).toHaveProperty('cell_map_path_bits');

            // Three-tree additions
            expect(formatted).toHaveProperty('engagement_root');
            expect(formatted).toHaveProperty('engagement_tier');
            expect(formatted).toHaveProperty('engagement_path');
            expect(formatted).toHaveProperty('engagement_index');
            expect(formatted).toHaveProperty('action_count');
            expect(formatted).toHaveProperty('diversity_score');
        });

        it('should format engagement_root as 0x-prefixed 64-char hex', () => {
            const inputs = createMockThreeTreeInputs(20, { engagementRoot: 255n });
            const formatted = prover.formatInputs(inputs);

            const engRoot = formatted.engagement_root as string;
            expect(engRoot).toBe('0x' + 'ff'.padStart(64, '0'));
            expect(engRoot).toHaveLength(66);
        });

        it('should format engagement_tier as hex field element', () => {
            const inputs = createMockThreeTreeInputs(20, { engagementTier: 3 });
            const formatted = prover.formatInputs(inputs);

            expect(formatted.engagement_tier).toBe('0x' + '3'.padStart(64, '0'));
        });

        it('should format action_count as hex field element', () => {
            const inputs = createMockThreeTreeInputs(20, { actionCount: 42n });
            const formatted = prover.formatInputs(inputs);

            expect(formatted.action_count).toBe('0x' + '2a'.padStart(64, '0'));
        });

        it('should format diversity_score as hex field element', () => {
            const inputs = createMockThreeTreeInputs(20, { diversityScore: 5n });
            const formatted = prover.formatInputs(inputs);

            expect(formatted.diversity_score).toBe('0x' + '5'.padStart(64, '0'));
        });

        it('should format engagement_path as array of hex strings', () => {
            const inputs = createMockThreeTreeInputs(20);
            const formatted = prover.formatInputs(inputs);

            const engPath = formatted.engagement_path as string[];
            expect(engPath).toHaveLength(20);
            for (const s of engPath) {
                expect(s).toMatch(/^0x[0-9a-f]{64}$/);
            }
        });

        it('should pass engagementIndex as plain number', () => {
            const inputs = createMockThreeTreeInputs(20, { engagementIndex: 7 });
            const formatted = prover.formatInputs(inputs);

            expect(formatted.engagement_index).toBe(7);
            expect(typeof formatted.engagement_index).toBe('number');
        });

        it('should format districts as array of hex strings', () => {
            const inputs = createMockThreeTreeInputs(20);
            const formatted = prover.formatInputs(inputs);

            const districts = formatted.districts as string[];
            expect(districts).toHaveLength(DISTRICT_SLOT_COUNT);
            for (const d of districts) {
                expect(d).toMatch(/^0x[0-9a-f]{64}$/);
            }
        });
    });

    describe('Public Input Count', () => {
        it('should define correct public input count (31)', () => {
            // user_root(1) + cell_map_root(1) + districts(24) + nullifier(1)
            // + action_domain(1) + authority_level(1) + engagement_root(1) + engagement_tier(1) = 31
            expect(THREE_TREE_PUBLIC_INPUT_COUNT).toBe(31);
        });

        it('should match the sum of individual public input fields', () => {
            const userRoot = 1;
            const cellMapRoot = 1;
            const districts = 24;
            const nullifier = 1;
            const actionDomain = 1;
            const authorityLevel = 1;
            const engagementRoot = 1;
            const engagementTier = 1;

            expect(
                userRoot + cellMapRoot + districts + nullifier + actionDomain +
                authorityLevel + engagementRoot + engagementTier
            ).toBe(THREE_TREE_PUBLIC_INPUT_COUNT);
        });
    });
});

describe('ThreeTreeNoirProver Integration', () => {
    let prover: ThreeTreeNoirProver;

    beforeAll(async () => {
        prover = new ThreeTreeNoirProver({ depth: 20 });
    }, 120000);

    afterAll(async () => {
        if (prover) {
            await prover.destroy();
        }
    });

    describe('Initialization', () => {
        it('should initialize Barretenberg backend', async () => {
            await prover.init();
            expect(prover.getDepth()).toBe(20);
        }, 60000);
    });

    describe('Witness Generation', () => {
        it('should reject mock inputs at circuit level (constraints not satisfied)', async () => {
            const inputs = createMockThreeTreeInputs(20);
            await expect(prover.generateProof(inputs)).rejects.toThrow();
        }, 180000);
    });
});

describe('ThreeTreeNoirProver - Depth 24', () => {
    let prover: ThreeTreeNoirProver;

    beforeAll(async () => {
        prover = await getThreeTreeProverForDepth(24);
    }, 120000);

    afterAll(async () => {
        await resetThreeTreeProverForDepth(24);
    });

    it('initializes prover for depth 24', () => {
        expect(prover).toBeDefined();
        expect(prover.getDepth()).toBe(24);
    });

    it('validates inputs at depth 24', () => {
        const inputs = createMockThreeTreeInputs(24);
        expect(() => prover.validateInputs(inputs)).not.toThrow();
    });

    it('rejects depth-20 inputs at depth-24 prover', () => {
        const inputs = createMockThreeTreeInputs(20);
        expect(() => prover.validateInputs(inputs)).toThrow(
            'userPath length mismatch: expected 24, got 20'
        );
    });

    it('formats 24-element paths correctly', () => {
        const inputs = createMockThreeTreeInputs(24);
        const formatted = prover.formatInputs(inputs);

        expect((formatted.user_path as string[]).length).toBe(24);
        expect((formatted.cell_map_path as string[]).length).toBe(24);
        expect((formatted.cell_map_path_bits as number[]).length).toBe(24);
        expect((formatted.engagement_path as string[]).length).toBe(24);
    });
});

// ============================================================================
// BR5-006: Public Input Binding
// ============================================================================

describe('BR5-006: Three-Tree Public Input Binding', () => {
    let prover: ThreeTreeNoirProver;

    beforeAll(() => {
        prover = new ThreeTreeNoirProver({ depth: 20 });
    });

    function buildMockPublicInputs(inputs: ThreeTreeProofInput): string[] {
        const pi = Array(THREE_TREE_PUBLIC_INPUT_COUNT).fill('0x0');
        pi[0] = '0x' + inputs.userRoot.toString(16);
        pi[1] = '0x' + inputs.cellMapRoot.toString(16);
        for (let i = 0; i < DISTRICT_SLOT_COUNT; i++) {
            pi[2 + i] = '0x' + inputs.districts[i].toString(16);
        }
        pi[26] = '0x' + inputs.nullifier.toString(16);
        pi[27] = '0x' + inputs.actionDomain.toString(16);
        pi[28] = '0x' + BigInt(inputs.authorityLevel).toString(16);
        pi[29] = '0x' + inputs.engagementRoot.toString(16);
        pi[30] = '0x' + BigInt(inputs.engagementTier).toString(16);
        return pi;
    }

    function injectMockBackend(): void {
        const mockBackend = {
            verifyProof: async () => true,
            generateProof: async () => ({ proof: new Uint8Array(), publicInputs: [] }),
            destroy: async () => {},
        };
        (prover as any).backend = mockBackend;
        (prover as any).noir = {};
    }

    it('verifyProof rejects wrong public input count', async () => {
        const badResult = {
            proof: new Uint8Array(32),
            publicInputs: ['0x1', '0x2'],
        };
        await expect(prover.verifyProof(badResult)).rejects.toThrow(
            'BR5-006: Public input count mismatch'
        );
    });

    it('verifyProofWithExpectedInputs accepts matching inputs', async () => {
        const inputs = createMockThreeTreeInputs(20);
        const pi = buildMockPublicInputs(inputs);
        injectMockBackend();

        const result = await prover.verifyProofWithExpectedInputs(
            { proof: new Uint8Array(32), publicInputs: pi },
            inputs,
        );
        expect(result).toBe(true);
    });

    it('detects user_root mismatch', async () => {
        const inputs = createMockThreeTreeInputs(20);
        const pi = buildMockPublicInputs(inputs);
        pi[0] = '0x' + (999n).toString(16);
        injectMockBackend();

        await expect(
            prover.verifyProofWithExpectedInputs(
                { proof: new Uint8Array(32), publicInputs: pi },
                inputs,
            )
        ).rejects.toThrow('BR5-006: Public input mismatch at index 0 (user_root)');
    });

    it('detects engagement_root mismatch', async () => {
        const inputs = createMockThreeTreeInputs(20);
        const pi = buildMockPublicInputs(inputs);
        pi[29] = '0x' + (888n).toString(16);
        injectMockBackend();

        await expect(
            prover.verifyProofWithExpectedInputs(
                { proof: new Uint8Array(32), publicInputs: pi },
                inputs,
            )
        ).rejects.toThrow('BR5-006: Public input mismatch at index 29 (engagement_root)');
    });

    it('detects engagement_tier mismatch', async () => {
        const inputs = createMockThreeTreeInputs(20, { engagementTier: 2 });
        const pi = buildMockPublicInputs(inputs);
        pi[30] = '0x' + (4n).toString(16); // Tamper tier to 4
        injectMockBackend();

        await expect(
            prover.verifyProofWithExpectedInputs(
                { proof: new Uint8Array(32), publicInputs: pi },
                inputs,
            )
        ).rejects.toThrow('BR5-006: Public input mismatch at index 30 (engagement_tier)');
    });

    it('detects district mismatch', async () => {
        const inputs = createMockThreeTreeInputs(20);
        const pi = buildMockPublicInputs(inputs);
        pi[2 + 5] = '0x' + (888n).toString(16);
        injectMockBackend();

        await expect(
            prover.verifyProofWithExpectedInputs(
                { proof: new Uint8Array(32), publicInputs: pi },
                inputs,
            )
        ).rejects.toThrow('BR5-006: District mismatch at slot 5');
    });

    it('detects nullifier mismatch', async () => {
        const inputs = createMockThreeTreeInputs(20);
        const pi = buildMockPublicInputs(inputs);
        pi[26] = '0x' + (777n).toString(16);
        injectMockBackend();

        await expect(
            prover.verifyProofWithExpectedInputs(
                { proof: new Uint8Array(32), publicInputs: pi },
                inputs,
            )
        ).rejects.toThrow('BR5-006: Public input mismatch at index 26 (nullifier)');
    });

    it('rejects non-hex public input (28M-001)', async () => {
        const inputs = createMockThreeTreeInputs(20);
        const pi = buildMockPublicInputs(inputs);
        pi[0] = 'not-hex';
        injectMockBackend();

        await expect(
            prover.verifyProofWithExpectedInputs(
                { proof: new Uint8Array(32), publicInputs: pi },
                inputs,
            )
        ).rejects.toThrow('BR5-006: Invalid public input format');
    });

    it('rejects BN254-overflowed public input (28M-002)', async () => {
        const inputs = createMockThreeTreeInputs(20);
        const pi = buildMockPublicInputs(inputs);
        pi[0] = '0x' + BN254_MODULUS.toString(16);
        injectMockBackend();

        await expect(
            prover.verifyProofWithExpectedInputs(
                { proof: new Uint8Array(32), publicInputs: pi },
                inputs,
            )
        ).rejects.toThrow('exceeds BN254 scalar field modulus');
    });

    it('returns false when crypto verification fails', async () => {
        const inputs = createMockThreeTreeInputs(20);
        const pi = buildMockPublicInputs(inputs);

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

// ============================================================================
// BR5-017: District Ordering Validation (three-tree)
// ============================================================================

describe('BR5-017: Three-Tree District Ordering', () => {
    let prover: ThreeTreeNoirProver;

    beforeAll(() => {
        prover = new ThreeTreeNoirProver({ depth: 20 });
    });

    it('accepts unique non-zero districts', () => {
        const inputs = createMockThreeTreeInputs(20);
        expect(() => prover.validateInputs(inputs)).not.toThrow();
    });

    it('accepts all-zero districts', () => {
        const inputs = createMockThreeTreeInputs(20, {
            districts: Array(DISTRICT_SLOT_COUNT).fill(0n),
        });
        expect(() => prover.validateInputs(inputs)).not.toThrow();
    });

    it('rejects duplicate non-zero districts', () => {
        const districts = Array(DISTRICT_SLOT_COUNT).fill(0n);
        districts[0] = 100n;
        districts[3] = 100n;
        const inputs = createMockThreeTreeInputs(20, { districts });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'BR5-017: Duplicate district ID at slot 3'
        );
    });
});

// ============================================================================
// BN254 Validation for Three-Tree-Specific Fields
// ============================================================================

describe('BN254 Validation for Three-Tree Fields', () => {
    let prover: ThreeTreeNoirProver;

    beforeAll(() => {
        prover = new ThreeTreeNoirProver({ depth: 20 });
    });

    it('rejects engagementRoot at BN254 modulus', () => {
        const inputs = createMockThreeTreeInputs(20, { engagementRoot: BN254_MODULUS });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'engagementRoot exceeds BN254 scalar field modulus'
        );
    });

    it('rejects actionCount at BN254 modulus', () => {
        const inputs = createMockThreeTreeInputs(20, { actionCount: BN254_MODULUS });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'actionCount exceeds BN254 scalar field modulus'
        );
    });

    it('rejects diversityScore at BN254 modulus', () => {
        const inputs = createMockThreeTreeInputs(20, { diversityScore: BN254_MODULUS });
        expect(() => prover.validateInputs(inputs)).toThrow(
            'diversityScore exceeds BN254 scalar field modulus'
        );
    });

    it('rejects negative actionCount', () => {
        const inputs = createMockThreeTreeInputs(20, { actionCount: -1n });
        expect(() => prover.validateInputs(inputs)).toThrow('actionCount cannot be negative');
    });

    it('rejects negative diversityScore', () => {
        const inputs = createMockThreeTreeInputs(20, { diversityScore: -1n });
        expect(() => prover.validateInputs(inputs)).toThrow('diversityScore cannot be negative');
    });
});
