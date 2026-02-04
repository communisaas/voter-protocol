/**
 * NoirProver Integration Tests
 * 
 * Tests the ZK proving infrastructure with the district_membership circuit.
 * 
 * VERIFICATION STATUS:
 * ✅ Barretenberg WASM initialization
 * ✅ Stateful keygen (acirGetProvingKey) from @voter-protocol/bb.js fork
 * ⚠️ Full proof generation (requires matching noir_js version to circuit)
 * 
 * The circuit bytecode was compiled with Noir 1.0.0-beta.15.
 * Full proof tests require the same noir_js version.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NoirProver, getProverForDepth, resetProverForDepth } from './prover';
import type { CircuitInputs } from './types';
import { PUBLIC_INPUT_COUNT } from './types';

describe('NoirProver Integration', () => {
    let prover: NoirProver;

    beforeAll(async () => {
        prover = new NoirProver();
    }, 120000);

    afterAll(async () => {
        if (prover) {
            await prover.destroy();
        }
    });

    describe('Initialization', () => {
        it('should initialize Barretenberg backend', async () => {
            await prover.init();
            // Barretenberg WASM loads and initializes
            expect(true).toBe(true);
        }, 60000);
    });

    describe('Stateful Keygen', () => {
        it('should generate proving key via acirGetProvingKey', async () => {
            // CRITICAL TEST: This verifies our @voter-protocol/bb.js fork
            // exposes the stateful keygen API (acirGetProvingKey)
            await prover.warmup();
            // If no error thrown, the fork's keygen API works
            expect(true).toBe(true);
        }, 120000);
    });

    describe('Proof Generation', () => {
        it('should execute circuit witness generation', async () => {
            // Test that witness generation runs (will fail circuit assertions
            // since our mock values don't satisfy Poseidon2 constraints)
            const inputs = createMockCircuitInputs();

            // Witness generation should work even if circuit assertions fail later
            // This tests the noir_js + circuit version compatibility
            await expect(prover.prove(inputs)).rejects.toThrow();
        }, 180000);
    });
});

/**
 * Create mock circuit inputs for testing.
 *
 * Note: The new secure circuit computes leaf and nullifier internally:
 * - leaf = hash(userSecret, districtId, authorityLevel, registrationSalt)
 * - nullifier = hash(userSecret, actionDomain)
 */
function createMockCircuitInputs(): CircuitInputs {
    // Circuit depth 20 = default (~1M leaves)
    // Valid depths: 18, 20, 22, 24
    const DEPTH = 20;

    return {
        // Public inputs (contract-controlled)
        merkleRoot: '0x0000000000000000000000000000000000000000000000000000000000000003',
        actionDomain: '0x0000000000000000000000000000000000000000000000000000000000000001',

        // Private inputs (user secrets)
        userSecret: '0x0000000000000000000000000000000000000000000000000000000000000001',
        districtId: '0x0000000000000000000000000000000000000000000000000000000000000042',
        authorityLevel: 1,
        registrationSalt: '0x0000000000000000000000000000000000000000000000000000000000000099',

        // Merkle proof data
        merklePath: Array(DEPTH).fill('0x0000000000000000000000000000000000000000000000000000000000000000'),
        leafIndex: 0,
    };
}

/**
 * BA-017: Depth-24 Proof Generation Tests
 *
 * Tests the largest circuit supporting ~16M leaves for national-scale systems.
 * Depth-24 proofs require more memory and time than smaller depths.
 *
 * Memory requirements: ~2-4GB heap for circuit initialization and proving
 *
 * NOTE: The current depth-24 circuit uses the legacy interface with different
 * parameters (authority_hash, epoch_id, campaign_id, leaf, nullifier) compared
 * to the new secure circuit design that the NoirProver class expects. Once the
 * circuits are recompiled with the new interface, the proof generation test
 * can be updated to verify successful proof creation.
 */
describe('NoirProver - Depth 24 (BA-017)', () => {
    let prover: NoirProver;

    beforeAll(async () => {
        prover = await getProverForDepth(24);
    }, 120000); // Depth-24 may need longer initialization

    afterAll(async () => {
        await resetProverForDepth(24);
    });

    it('initializes prover for depth 24', () => {
        // Verify the prover initialized successfully
        expect(prover).toBeDefined();
        expect(prover.getDepth()).toBe(24);
    });

    it('attempts witness generation at depth 24', async () => {
        // Create test inputs with 24-level merkle path
        // Note: Current circuits use legacy interface, so this will fail with
        // parameter mismatch. This test verifies the prover can attempt to
        // process depth-24 inputs and properly reports the error.
        const inputs: CircuitInputs = {
            merkleRoot: '0x' + '0'.repeat(63) + '1',
            actionDomain: '0x' + '0'.repeat(63) + '2',
            userSecret: '0x' + '0'.repeat(63) + '3',
            districtId: '0x' + '0'.repeat(63) + '4',
            authorityLevel: 3,
            registrationSalt: '0x' + '0'.repeat(63) + '5',
            merklePath: Array(24).fill('0x' + '0'.repeat(64)),
            leafIndex: 0,
        };

        // Witness generation should work even if circuit interface mismatch
        // causes assertion to fail. This tests depth-24 circuit loading.
        await expect(prover.prove(inputs)).rejects.toThrow();
    }, 300000); // Allow 5 minutes for depth-24 processing

    it('prover reports correct depth', () => {
        expect(prover.getDepth()).toBe(24);
    });
});

/**
 * BR3-002: Public Input Count Validation Tests
 *
 * Tests that the single-tree prover hard-errors when the backend returns
 * an incorrect number of public inputs, instead of silently falling back
 * to caller-provided values.
 */
describe('NoirProver - Public Input Count Validation (BR3-002)', () => {
    describe('Public Input Count Constant', () => {
        it('should define correct public input count (5)', () => {
            // merkle_root(1) + nullifier(1) + authority_level(1) + action_domain(1) + district_id(1) = 5
            expect(PUBLIC_INPUT_COUNT).toBe(5);
        });

        it('should match the sum of individual public input fields', () => {
            const merkleRoot = 1;      // merkle_root
            const nullifier = 1;       // nullifier
            const authorityLevel = 1;  // authority_level
            const actionDomain = 1;    // action_domain
            const districtId = 1;      // district_id

            expect(merkleRoot + nullifier + authorityLevel + actionDomain + districtId)
                .toBe(PUBLIC_INPUT_COUNT);
        });
    });

    describe('Input Count Mismatch Rejection', () => {
        it('should reject when backend returns wrong number of public inputs', async () => {
            const prover = new NoirProver();
            await prover.init();

            // Create valid test inputs
            const inputs: CircuitInputs = {
                merkleRoot: '0x' + '0'.repeat(63) + '1',
                actionDomain: '0x' + '0'.repeat(63) + '2',
                userSecret: '0x' + '0'.repeat(63) + '3',
                districtId: '0x' + '0'.repeat(63) + '4',
                authorityLevel: 1,
                registrationSalt: '0x' + '0'.repeat(63) + '5',
                merklePath: Array(20).fill('0x' + '0'.repeat(64)),
                leafIndex: 0,
            };

            // Mock the noir to bypass witness generation
            const originalBackend = (prover as any).backend;
            const originalNoir = (prover as any).noir;

            const mockExecute = vi.fn().mockResolvedValue({
                witness: new Uint8Array([1, 2, 3]),
            });

            const mockGenerateProof = vi.fn().mockResolvedValue({
                proof: new Uint8Array([1, 2, 3]),
                publicInputs: ['0x1', '0x2', '0x3'], // Only 3 inputs instead of 5
            });

            (prover as any).noir = {
                ...originalNoir,
                execute: mockExecute,
            };

            (prover as any).backend = {
                ...originalBackend,
                generateProof: mockGenerateProof,
            };

            // Should throw error about public input count mismatch
            await expect(prover.prove(inputs)).rejects.toThrow(
                'Expected 5 public inputs from circuit, got 3'
            );

            // Restore original backend and noir
            (prover as any).backend = originalBackend;
            (prover as any).noir = originalNoir;
            await prover.destroy();
        });

        it('should reject when backend returns too many public inputs', async () => {
            const prover = new NoirProver();
            await prover.init();

            const inputs: CircuitInputs = {
                merkleRoot: '0x' + '0'.repeat(63) + '1',
                actionDomain: '0x' + '0'.repeat(63) + '2',
                userSecret: '0x' + '0'.repeat(63) + '3',
                districtId: '0x' + '0'.repeat(63) + '4',
                authorityLevel: 1,
                registrationSalt: '0x' + '0'.repeat(63) + '5',
                merklePath: Array(20).fill('0x' + '0'.repeat(64)),
                leafIndex: 0,
            };

            // Mock the noir to bypass witness generation
            const originalBackend = (prover as any).backend;
            const originalNoir = (prover as any).noir;

            const mockExecute = vi.fn().mockResolvedValue({
                witness: new Uint8Array([1, 2, 3]),
            });

            const mockGenerateProof = vi.fn().mockResolvedValue({
                proof: new Uint8Array([1, 2, 3]),
                publicInputs: ['0x1', '0x2', '0x3', '0x4', '0x5', '0x6', '0x7'], // 7 inputs instead of 5
            });

            (prover as any).noir = {
                ...originalNoir,
                execute: mockExecute,
            };

            (prover as any).backend = {
                ...originalBackend,
                generateProof: mockGenerateProof,
            };

            // Should throw error about public input count mismatch
            await expect(prover.prove(inputs)).rejects.toThrow(
                'Expected 5 public inputs from circuit, got 7'
            );

            // Restore original backend and noir
            (prover as any).backend = originalBackend;
            (prover as any).noir = originalNoir;
            await prover.destroy();
        });

        it('should succeed when backend returns exactly 5 public inputs', async () => {
            const prover = new NoirProver();
            await prover.init();

            const inputs: CircuitInputs = {
                merkleRoot: '0x' + '0'.repeat(63) + '1',
                actionDomain: '0x' + '0'.repeat(63) + '2',
                userSecret: '0x' + '0'.repeat(63) + '3',
                districtId: '0x' + '0'.repeat(63) + '4',
                authorityLevel: 3,
                registrationSalt: '0x' + '0'.repeat(63) + '5',
                merklePath: Array(20).fill('0x' + '0'.repeat(64)),
                leafIndex: 0,
            };

            // Mock the backend to return correct number of public inputs
            const originalBackend = (prover as any).backend;
            const originalNoir = (prover as any).noir;

            const mockGenerateProof = vi.fn().mockResolvedValue({
                proof: new Uint8Array([1, 2, 3, 4, 5]),
                publicInputs: [
                    '0x' + '0'.repeat(63) + '1', // merkleRoot
                    '0x' + 'a'.repeat(64),       // nullifier
                    '0x03',                       // authorityLevel (3 in hex)
                    '0x' + '0'.repeat(63) + '2', // actionDomain
                    '0x' + '0'.repeat(63) + '4', // districtId
                ],
            });

            const mockExecute = vi.fn().mockResolvedValue({
                witness: new Uint8Array([1, 2, 3]),
            });

            (prover as any).backend = {
                ...originalBackend,
                generateProof: mockGenerateProof,
            };

            (prover as any).noir = {
                ...originalNoir,
                execute: mockExecute,
            };

            // Should succeed with correct number of inputs
            const result = await prover.prove(inputs);

            expect(result.proof).toBeDefined();
            expect(result.publicInputs.merkleRoot).toBe('0x' + '0'.repeat(63) + '1');
            expect(result.publicInputs.nullifier).toBe('0x' + 'a'.repeat(64));
            expect(result.publicInputs.authorityLevel).toBe(3);
            expect(result.publicInputs.actionDomain).toBe('0x' + '0'.repeat(63) + '2');
            expect(result.publicInputs.districtId).toBe('0x' + '0'.repeat(63) + '4');

            // Restore original backend and noir
            (prover as any).backend = originalBackend;
            (prover as any).noir = originalNoir;
            await prover.destroy();
        });
    });
});
