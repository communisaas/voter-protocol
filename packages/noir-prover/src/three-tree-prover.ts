/**
 * ThreeTreeNoirProver - ZK prover for the three-tree architecture
 *
 * Extends the two-tree prover with Tree 3 (Engagement Tree), proving that a user:
 * 1. Belongs to a geographic cell (Tree 1)
 * 2. That cell maps to a specific set of 24 districts (Tree 2)
 * 3. Has a verified engagement tier bound to their identity (Tree 3)
 *
 * ARCHITECTURE:
 * - Tree 1 (User Tree): Standard Merkle tree.
 *   Leaf = H4(user_secret, cell_id, registration_salt, authority_level)
 * - Tree 2 (Cell Map): Sparse Merkle tree.
 *   Leaf = H2(cell_id, district_commitment)
 *   where district_commitment = poseidon2_sponge_24(districts)
 * - Tree 3 (Engagement): Standard Merkle tree.
 *   Leaf = H2(identity_commitment, engagement_data_commitment)
 *   where engagement_data_commitment = H3(engagement_tier, action_count, diversity_score)
 *
 * CROSS-TREE IDENTITY BINDING:
 * A single identity_commitment feeds BOTH the nullifier and the engagement leaf,
 * cryptographically binding engagement data to the same identity.
 *
 * CIRCUIT DEPTHS: 18, 20, 22, 24 (all three trees share the same depth)
 */

import { UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import type { CompiledCircuit } from '@noir-lang/noir_js';
import { BN254_MODULUS } from '@voter-protocol/crypto';
import type {
    ThreeTreeProverConfig,
    ThreeTreeProofInput,
    ThreeTreeProofResult,
    ProofOptions,
    CircuitDepth,
} from './types';
import {
    DEFAULT_CIRCUIT_DEPTH,
    DISTRICT_SLOT_COUNT,
    THREE_TREE_PUBLIC_INPUT_COUNT,
    validateAuthorityLevel,
    validateEngagementTier,
} from './types';

// ============================================================================
// Circuit Loaders
// ============================================================================

const threeTreeCircuitLoaders: Record<CircuitDepth, () => Promise<CompiledCircuit>> = {
    18: async () => {
        const module = await import('../circuits/three_tree_membership_18.json');
        return module.default as unknown as CompiledCircuit;
    },
    20: async () => {
        const module = await import('../circuits/three_tree_membership_20.json');
        return module.default as unknown as CompiledCircuit;
    },
    22: async () => {
        const module = await import('../circuits/three_tree_membership_22.json');
        return module.default as unknown as CompiledCircuit;
    },
    24: async () => {
        const module = await import('../circuits/three_tree_membership_24.json');
        return module.default as unknown as CompiledCircuit;
    },
};

// ============================================================================
// Thread Detection
// ============================================================================

function detectThreads(): number {
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
    if (!hasSharedArrayBuffer) {
        console.log('[ThreeTreeNoirProver] SharedArrayBuffer unavailable - using single-threaded mode');
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
// ThreeTreeNoirProver
// ============================================================================

export class ThreeTreeNoirProver {
    private backend: UltraHonkBackend | null = null;
    private noir: Noir | null = null;
    private readonly threads: number;
    private readonly depth: CircuitDepth;

    constructor(config: ThreeTreeProverConfig = {}) {
        this.threads = config.threads ?? detectThreads();
        this.depth = config.depth ?? DEFAULT_CIRCUIT_DEPTH;
    }

    // ========================================================================
    // Initialization
    // ========================================================================

    async init(): Promise<void> {
        if (this.backend && this.noir) return;

        console.log(`[ThreeTreeNoirProver] Initializing depth=${this.depth} with ${this.threads} thread(s)...`);
        const start = Date.now();

        const loader = threeTreeCircuitLoaders[this.depth];
        if (!loader) {
            throw new Error(`Unsupported circuit depth: ${this.depth}. Must be 18, 20, 22, or 24.`);
        }
        const circuit = await loader();

        this.noir = new Noir(circuit);
        this.backend = new UltraHonkBackend(circuit.bytecode, { threads: this.threads });

        console.log(`[ThreeTreeNoirProver] Initialized depth=${this.depth} in ${Date.now() - start}ms (${this.threads} threads)`);
    }

    getDepth(): CircuitDepth {
        return this.depth;
    }

    async warmup(): Promise<void> {
        await this.init();
        console.log('[ThreeTreeNoirProver] Warmup complete (backend initialized)');
    }

    // ========================================================================
    // Input Validation
    // ========================================================================

    private static readonly MAX_MERKLE_DEPTH = 24;

    validateInputs(inputs: ThreeTreeProofInput): void {
        // SA-011: Reject zero user_secret
        if (inputs.userSecret === 0n) {
            throw new Error(
                'user_secret cannot be zero (SA-011). A zero secret produces predictable nullifiers.'
            );
        }

        // BR3-005: Reject zero values for critical fields
        if (inputs.cellId === 0n) {
            throw new Error('cell_id cannot be zero. A zero cell ID produces a degenerate cell map leaf.');
        }
        if (inputs.actionDomain === 0n) {
            throw new Error(
                'action_domain cannot be zero. A zero action domain produces a universal nullifier ' +
                'that would be consumed across ALL elections, permanently blocking the user.'
            );
        }
        if (inputs.registrationSalt === 0n) {
            throw new Error('registration_salt cannot be zero. A zero salt reduces leaf preimage entropy.');
        }
        // NUL-001: identity_commitment must be non-zero
        if (inputs.identityCommitment === 0n) {
            throw new Error(
                'identity_commitment cannot be zero. NUL-001 requires a verified identity commitment ' +
                'from self.xyz/didit to prevent Sybil attacks via re-registration.'
            );
        }

        // Validate authority level range [1, 5]
        validateAuthorityLevel(inputs.authorityLevel);

        // REP-001: Validate engagement tier range [0, 4]
        validateEngagementTier(inputs.engagementTier);

        // Validate districts array length
        if (!Array.isArray(inputs.districts) || inputs.districts.length !== DISTRICT_SLOT_COUNT) {
            throw new Error(
                `districts array must have exactly ${DISTRICT_SLOT_COUNT} elements, got ${inputs.districts?.length ?? 'non-array'}`
            );
        }

        // BR5-017: Validate district array integrity
        const nonZeroDistricts = new Set<bigint>();
        for (let i = 0; i < inputs.districts.length; i++) {
            const d = inputs.districts[i];
            if (d < 0n) {
                throw new Error(`districts[${i}] cannot be negative`);
            }
            if (d >= BN254_MODULUS) {
                throw new Error(`districts[${i}] exceeds BN254 scalar field modulus`);
            }
            if (d !== 0n) {
                if (nonZeroDistricts.has(d)) {
                    throw new Error(
                        `BR5-017: Duplicate district ID at slot ${i}: 0x${d.toString(16)}. ` +
                        `Each non-zero district must appear in exactly one positional slot.`
                    );
                }
                nonZeroDistricts.add(d);
            }
        }

        // Validate BN254 field bounds for all bigint fields
        const fieldChecks: [bigint, string][] = [
            [inputs.userRoot, 'userRoot'],
            [inputs.cellMapRoot, 'cellMapRoot'],
            [inputs.engagementRoot, 'engagementRoot'],
            [inputs.nullifier, 'nullifier'],
            [inputs.actionDomain, 'actionDomain'],
            [inputs.userSecret, 'userSecret'],
            [inputs.cellId, 'cellId'],
            [inputs.registrationSalt, 'registrationSalt'],
            [inputs.identityCommitment, 'identityCommitment'],
            [inputs.actionCount, 'actionCount'],
            [inputs.diversityScore, 'diversityScore'],
        ];
        for (const [val, name] of fieldChecks) {
            if (val < 0n) {
                throw new Error(`${name} cannot be negative`);
            }
            if (val >= BN254_MODULUS) {
                throw new Error(`${name} exceeds BN254 scalar field modulus`);
            }
        }

        // Validate userPath (Tree 1 Merkle siblings)
        if (!Array.isArray(inputs.userPath)) {
            throw new Error('userPath must be an array');
        }
        if (inputs.userPath.length > ThreeTreeNoirProver.MAX_MERKLE_DEPTH) {
            throw new Error(
                `userPath exceeds maximum allowed depth: ${inputs.userPath.length} > ${ThreeTreeNoirProver.MAX_MERKLE_DEPTH}`
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
        for (let i = 0; i < inputs.cellMapPathBits.length; i++) {
            if (inputs.cellMapPathBits[i] !== 0 && inputs.cellMapPathBits[i] !== 1) {
                throw new Error(
                    `cellMapPathBits[${i}] must be 0 or 1, got ${inputs.cellMapPathBits[i]}`
                );
            }
        }

        // Validate engagementPath (Tree 3 Merkle siblings)
        if (!Array.isArray(inputs.engagementPath)) {
            throw new Error('engagementPath must be an array');
        }
        if (inputs.engagementPath.length !== this.depth) {
            throw new Error(
                `engagementPath length mismatch: expected ${this.depth}, got ${inputs.engagementPath.length}`
            );
        }

        // Validate userIndex range
        if (inputs.userIndex < 0 || inputs.userIndex >= 2 ** this.depth) {
            throw new Error(
                `userIndex out of range: must be 0 to ${2 ** this.depth - 1}, got ${inputs.userIndex}`
            );
        }

        // Validate engagementIndex range
        if (inputs.engagementIndex < 0 || inputs.engagementIndex >= 2 ** this.depth) {
            throw new Error(
                `engagementIndex out of range: must be 0 to ${2 ** this.depth - 1}, got ${inputs.engagementIndex}`
            );
        }

        // Validate Merkle path siblings are within BN254 field
        for (let i = 0; i < inputs.userPath.length; i++) {
            if (inputs.userPath[i] < 0n || inputs.userPath[i] >= BN254_MODULUS) {
                throw new Error(`userPath[${i}] outside BN254 scalar field`);
            }
        }
        for (let i = 0; i < inputs.cellMapPath.length; i++) {
            if (inputs.cellMapPath[i] < 0n || inputs.cellMapPath[i] >= BN254_MODULUS) {
                throw new Error(`cellMapPath[${i}] outside BN254 scalar field`);
            }
        }
        for (let i = 0; i < inputs.engagementPath.length; i++) {
            if (inputs.engagementPath[i] < 0n || inputs.engagementPath[i] >= BN254_MODULUS) {
                throw new Error(`engagementPath[${i}] outside BN254 scalar field`);
            }
        }
    }

    // ========================================================================
    // Input Formatting
    // ========================================================================

    formatInputs(inputs: ThreeTreeProofInput): Record<string, unknown> {
        return {
            // Public inputs
            user_root: toHex(inputs.userRoot),
            cell_map_root: toHex(inputs.cellMapRoot),
            districts: inputs.districts.map(toHex),
            nullifier: toHex(inputs.nullifier),
            action_domain: toHex(inputs.actionDomain),
            authority_level: toHex(BigInt(inputs.authorityLevel)),
            engagement_root: toHex(inputs.engagementRoot),
            engagement_tier: toHex(BigInt(inputs.engagementTier)),

            // Private inputs (witnesses)
            user_secret: toHex(inputs.userSecret),
            cell_id: toHex(inputs.cellId),
            registration_salt: toHex(inputs.registrationSalt),
            identity_commitment: toHex(inputs.identityCommitment),

            // Tree 1: Standard Merkle proof
            user_path: inputs.userPath.map(toHex),
            user_index: inputs.userIndex,

            // Tree 2: SMT proof
            cell_map_path: inputs.cellMapPath.map(toHex),
            cell_map_path_bits: inputs.cellMapPathBits,

            // Tree 3: Standard Merkle proof
            engagement_path: inputs.engagementPath.map(toHex),
            engagement_index: inputs.engagementIndex,

            // Engagement data (private)
            action_count: toHex(inputs.actionCount),
            diversity_score: toHex(inputs.diversityScore),
        };
    }

    // ========================================================================
    // Proof Generation
    // ========================================================================

    async generateProof(inputs: ThreeTreeProofInput, options?: ProofOptions): Promise<ThreeTreeProofResult> {
        // BR3-006: Validate inputs before heavy init() call
        this.validateInputs(inputs);

        await this.init();

        const mode = options?.keccak ? 'keccak (on-chain)' : 'default (off-chain)';
        console.log(`[ThreeTreeNoirProver] Generating witness... (mode: ${mode})`);
        const witnessStart = Date.now();

        const noirInputs = this.formatInputs(inputs);

        const { witness } = await this.noir!.execute(noirInputs as any);
        console.log(`[ThreeTreeNoirProver] Witness generated in ${Date.now() - witnessStart}ms`);

        console.log('[ThreeTreeNoirProver] Generating proof...');
        const proofStart = Date.now();

        const { proof, publicInputs } = options?.keccak
            ? await this.backend!.generateProof(witness, { keccak: true })
            : await this.backend!.generateProof(witness);

        console.log(`[ThreeTreeNoirProver] Proof generated in ${Date.now() - proofStart}ms (${proof.length} bytes)`);

        if (publicInputs.length !== THREE_TREE_PUBLIC_INPUT_COUNT) {
            throw new Error(
                `Unexpected public input count: expected ${THREE_TREE_PUBLIC_INPUT_COUNT}, ` +
                `got ${publicInputs.length}`
            );
        }

        return { proof, publicInputs };
    }

    // ========================================================================
    // Proof Verification
    // ========================================================================

    async verifyProof(proofResult: ThreeTreeProofResult, options?: ProofOptions): Promise<boolean> {
        if (proofResult.publicInputs.length !== THREE_TREE_PUBLIC_INPUT_COUNT) {
            throw new Error(
                `BR5-006: Public input count mismatch: expected ${THREE_TREE_PUBLIC_INPUT_COUNT}, ` +
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

    async verifyProofWithExpectedInputs(
        proofResult: ThreeTreeProofResult,
        expectedInputs: ThreeTreeProofInput,
        options?: ProofOptions,
    ): Promise<boolean> {
        const valid = await this.verifyProof(proofResult, options);
        if (!valid) return false;

        // BR5-006: Bind public inputs to expected values.
        // Public input layout: [0] user_root, [1] cell_map_root, [2-25] districts,
        //   [26] nullifier, [27] action_domain, [28] authority_level,
        //   [29] engagement_root, [30] engagement_tier
        const pi = proofResult.publicInputs;

        const checks: [number, bigint, string][] = [
            [0, expectedInputs.userRoot, 'user_root'],
            [1, expectedInputs.cellMapRoot, 'cell_map_root'],
            [26, expectedInputs.nullifier, 'nullifier'],
            [27, expectedInputs.actionDomain, 'action_domain'],
            [28, BigInt(expectedInputs.authorityLevel), 'authority_level'],
            [29, expectedInputs.engagementRoot, 'engagement_root'],
            [30, BigInt(expectedInputs.engagementTier), 'engagement_tier'],
        ];

        for (const [idx, expected, name] of checks) {
            const actual = parsePublicInput(pi[idx], `${name}[${idx}]`);
            if (actual !== expected) {
                throw new Error(
                    `BR5-006: Public input mismatch at index ${idx} (${name}): ` +
                    `expected ${expected}, got ${actual}`
                );
            }
        }

        // Check all 24 districts
        for (let i = 0; i < DISTRICT_SLOT_COUNT; i++) {
            const actual = parsePublicInput(pi[2 + i], `district[${i}]`);
            const expected = expectedInputs.districts[i];
            if (actual !== expected) {
                throw new Error(
                    `BR5-006: District mismatch at slot ${i} (public input index ${2 + i}): ` +
                    `expected ${expected}, got ${actual}`
                );
            }
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

const threeTreeProverInstances: Map<CircuitDepth, ThreeTreeNoirProver> = new Map();
const threeTreeInitPromises: Map<CircuitDepth, Promise<ThreeTreeNoirProver>> = new Map();

export async function getThreeTreeProverForDepth(
    depth: CircuitDepth = DEFAULT_CIRCUIT_DEPTH,
    config?: Omit<ThreeTreeProverConfig, 'depth'>
): Promise<ThreeTreeNoirProver> {
    const existing = threeTreeProverInstances.get(depth);
    if (existing) return existing;

    const existingPromise = threeTreeInitPromises.get(depth);
    if (existingPromise) return existingPromise;

    // HIGH-003 FIX: Register promise synchronously before any async work
    let resolveInit: (prover: ThreeTreeNoirProver) => void;
    let rejectInit: (error: Error) => void;

    const initPromise = new Promise<ThreeTreeNoirProver>((resolve, reject) => {
        resolveInit = resolve;
        rejectInit = reject;
    });

    threeTreeInitPromises.set(depth, initPromise);

    (async () => {
        try {
            const prover = new ThreeTreeNoirProver({ ...config, depth });
            await prover.init();
            threeTreeProverInstances.set(depth, prover);
            threeTreeInitPromises.delete(depth);
            resolveInit!(prover);
        } catch (err) {
            threeTreeInitPromises.delete(depth);
            rejectInit!(err instanceof Error ? err : new Error(String(err)));
        }
    })();

    return initPromise;
}

export async function resetThreeTreeProverSingleton(): Promise<void> {
    const destroyPromises = Array.from(threeTreeProverInstances.values()).map(
        (prover) => prover.destroy()
    );
    await Promise.all(destroyPromises);
    threeTreeProverInstances.clear();
    threeTreeInitPromises.clear();
}

export async function resetThreeTreeProverForDepth(depth: CircuitDepth): Promise<void> {
    const prover = threeTreeProverInstances.get(depth);
    if (prover) {
        await prover.destroy();
        threeTreeProverInstances.delete(depth);
    }
    threeTreeInitPromises.delete(depth);
}
