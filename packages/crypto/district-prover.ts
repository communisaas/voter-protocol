/**
 * District Membership Prover - Singleton wrapper for Noir ZK proof generation
 *
 * Provides browser-native zero-knowledge proof generation for district residency
 * verification using Noir circuits and Barretenberg (UltraHonk) backend.
 *
 * ARCHITECTURE:
 * 1. Noir circuit compiles address → district membership (with configurable Merkle depth)
 * 2. Browser generates ZK proof (witness computation + proving in WASM)
 * 3. Proof submitted on-chain (verifier contract on Scroll L2)
 * 4. No server trust - proving happens 100% client-side
 *
 * CIRCUIT DEPTHS:
 * - DEPTH=14: Municipal (city council, ~16K leaves)
 * - DEPTH=20: State (congressional districts, ~1M leaves)
 * - DEPTH=22: Federal (national boundaries, ~4M leaves)
 *
 * PERFORMANCE:
 * - Singleton pattern: Backend initialized once, reused for all proofs
 * - Expected proving time: 8-12 seconds on mid-range mobile
 * - Proof size: ~2KB (UltraHonk compact proofs)
 *
 * SECURITY:
 * - Private inputs (address, secret, Merkle path) never leave browser
 * - Public outputs (merkle_root, nullifier, authority_hash, epoch_id, campaign_id) verified on-chain
 * - Poseidon2 hashing matches on-chain verifier (domain separation enforced)
 */

import { Noir } from '@noir-lang/noir_js';
import { UltraHonkBackend } from '@aztec/bb.js';
import type { CompiledCircuit, InputMap } from '@noir-lang/noir_js';
import type { ProofData } from '@aztec/bb.js';

// Import compiled district_membership circuits (build script generates 3 variants)
import districtCircuit14 from './noir/district_membership/target/district_membership_14.json';
import districtCircuit20 from './noir/district_membership/target/district_membership_20.json';
import districtCircuit22 from './noir/district_membership/target/district_membership_22.json';

/**
 * Supported Merkle tree depths
 */
export type CircuitDepth = 14 | 20 | 22;

/**
 * Private witness inputs (never leave browser)
 */
export interface DistrictWitness {
  /** Merkle root of district tree (public output, verified on-chain) */
  merkle_root: string;
  /** Nullifier preventing double-actions (public output, checked on-chain) */
  nullifier: string;
  /** Hash of authority ID (public output, identifies representative) */
  authority_hash: string;
  /** Epoch identifier (public output, prevents replay attacks) */
  epoch_id: string;
  /** Campaign identifier (public output, groups related actions) */
  campaign_id: string;
  /** Hashed address leaf (private) */
  leaf: string;
  /** Sibling hashes from leaf to root (private, length = DEPTH) */
  merkle_path: string[];
  /** Leaf position in tree (private) */
  leaf_index: number;
  /** User secret for nullifier (private, prevents linkability) */
  user_secret: string;
}

/**
 * Generated ZK proof with public inputs
 */
export interface DistrictProof {
  /** Serialized proof bytes (UltraHonk format) */
  proof: ProofData;
  /** Public outputs from circuit: [merkle_root, nullifier, authority_hash, epoch_id, campaign_id] */
  publicInputs: string[];
}

/**
 * Configuration for proof verification
 */
export interface VerificationConfig {
  /** Expected Merkle root (must match proof public output) */
  expectedRoot: string;
  /** Expected nullifier (must match proof public output) */
  expectedNullifier: string;
  /** Expected authority hash (must match proof public output) */
  expectedAuthorityHash: string;
  /** Expected epoch ID (must match proof public output) */
  expectedEpochId: string;
  /** Expected campaign ID (must match proof public output) */
  expectedCampaignId: string;
}

/**
 * DistrictProver - Singleton for efficient district membership proving
 *
 * USAGE:
 * ```typescript
 * // Municipal authority (depth 14)
 * const prover = await DistrictProver.getInstance(14);
 * const proof = await prover.generateProof(witness);
 * const isValid = await prover.verifyProof(proof, verificationConfig);
 * ```
 */
export class DistrictProver {
  private static instances: Map<CircuitDepth, DistrictProver> = new Map();
  private static initPromises: Map<CircuitDepth, Promise<DistrictProver>> = new Map();

  private readonly noir: Noir;
  private readonly backend: UltraHonkBackend;
  private readonly depth: CircuitDepth;
  private initialized = false;

  /**
   * Private constructor - use getInstance() instead
   */
  private constructor(noir: Noir, backend: UltraHonkBackend, depth: CircuitDepth) {
    this.noir = noir;
    this.backend = backend;
    this.depth = depth;
  }

  /**
   * Get singleton instance for specific circuit depth (thread-safe initialization)
   *
   * First call initializes the Noir circuit + Barretenberg backend, subsequent calls
   * return cached instance. Uses promise-based locking to prevent double initialization.
   *
   * @param depth - Merkle tree depth (14=municipal, 20=state, 22=federal)
   */
  static async getInstance(depth: CircuitDepth): Promise<DistrictProver> {
    const cachedInstance = DistrictProver.instances.get(depth);
    if (cachedInstance?.initialized) {
      return cachedInstance;
    }

    // Prevent double initialization with promise lock
    let initPromise = DistrictProver.initPromises.get(depth);
    if (!initPromise) {
      initPromise = DistrictProver.initialize(depth);
      DistrictProver.initPromises.set(depth, initPromise);
    }

    return initPromise;
  }

  /**
   * Initialize the Noir circuit + backend (called once per depth)
   */
  private static async initialize(depth: CircuitDepth): Promise<DistrictProver> {
    // Select circuit based on depth
    let circuit: CompiledCircuit;
    switch (depth) {
      case 14:
        circuit = districtCircuit14 as unknown as CompiledCircuit;
        break;
      case 20:
        circuit = districtCircuit20 as unknown as CompiledCircuit;
        break;
      case 22:
        circuit = districtCircuit22 as unknown as CompiledCircuit;
        break;
      default:
        throw new Error(`Unsupported circuit depth: ${depth}. Must be 14, 20, or 22.`);
    }

    const noir = new Noir(circuit);
    const backend = new UltraHonkBackend(circuit.bytecode);

    const instance = new DistrictProver(noir, backend, depth);
    instance.initialized = true;
    DistrictProver.instances.set(depth, instance);

    return instance;
  }

  /**
   * Reset singleton instances (for testing only)
   */
  static resetInstances(): void {
    DistrictProver.instances.clear();
    DistrictProver.initPromises.clear();
  }

  /**
   * Generate ZK proof of district membership
   *
   * PROCESS:
   * 1. Validate witness inputs (field bounds, array lengths)
   * 2. Execute Noir circuit to compute witness
   * 3. Generate UltraHonk proof using Barretenberg backend
   * 4. Extract public inputs from witness
   *
   * @param witness - Private inputs + public parameters
   * @returns ZK proof with public outputs
   * @throws Error if witness invalid or proving fails
   */
  async generateProof(witness: DistrictWitness): Promise<DistrictProof> {
    // Validate witness structure
    this.validateWitness(witness);

    // Convert witness to Noir input format
    const inputs: InputMap = {
      merkle_root: witness.merkle_root,
      nullifier: witness.nullifier,
      authority_hash: witness.authority_hash,
      epoch_id: witness.epoch_id,
      campaign_id: witness.campaign_id,
      leaf: witness.leaf,
      merkle_path: witness.merkle_path,
      leaf_index: witness.leaf_index.toString(),
      user_secret: witness.user_secret,
    };

    // Execute circuit to compute witness
    const { witness: computedWitness } = await this.noir.execute(inputs);

    // Generate proof using Barretenberg backend
    const proof = await this.backend.generateProof(computedWitness);

    // Extract public inputs (circuit returns 5 field elements)
    const publicInputs = [
      witness.merkle_root,
      witness.nullifier,
      witness.authority_hash,
      witness.epoch_id,
      witness.campaign_id,
    ];

    return {
      proof,
      publicInputs,
    };
  }

  /**
   * Verify ZK proof (local verification, mimics on-chain verifier)
   *
   * VERIFICATION STEPS:
   * 1. Validate proof structure
   * 2. Check public inputs match expected values
   * 3. Verify proof using Barretenberg backend
   *
   * @param proof - Generated proof from generateProof()
   * @param config - Expected public values
   * @returns true if proof valid, false otherwise
   */
  async verifyProof(proof: DistrictProof, config: VerificationConfig): Promise<boolean> {
    // Validate proof structure
    if (!proof.proof) {
      return false;
    }
    if (proof.publicInputs.length !== 5) {
      return false;
    }

    // Check public inputs match expected values
    const [merkleRoot, nullifier, authorityHash, epochId, campaignId] = proof.publicInputs;

    if (merkleRoot !== config.expectedRoot) {
      return false;
    }
    if (nullifier !== config.expectedNullifier) {
      return false;
    }
    if (authorityHash !== config.expectedAuthorityHash) {
      return false;
    }
    if (epochId !== config.expectedEpochId) {
      return false;
    }
    if (campaignId !== config.expectedCampaignId) {
      return false;
    }

    // Verify proof using backend
    try {
      const isValid = await this.backend.verifyProof(proof.proof);
      return isValid;
    } catch {
      return false;
    }
  }

  /**
   * Validate witness inputs before proving
   *
   * CHECKS:
   * - All fields are valid hex strings or numbers
   * - merkle_path has correct length (DEPTH)
   * - leaf_index is within bounds [0, 2^DEPTH)
   * - Field elements are within BN254 field modulus
   */
  private validateWitness(witness: DistrictWitness): void {
    // Check merkle_path length matches circuit depth
    if (witness.merkle_path.length !== this.depth) {
      throw new Error(
        `Invalid merkle_path length: expected ${this.depth}, got ${witness.merkle_path.length}`
      );
    }

    // Check leaf_index is within valid range
    const maxIndex = Math.pow(2, this.depth) - 1;
    if (witness.leaf_index < 0 || witness.leaf_index > maxIndex) {
      throw new Error(
        `Invalid leaf_index: ${witness.leaf_index} (must be in [0, ${maxIndex}])`
      );
    }

    // Validate all field elements are valid hex strings
    const fields = [
      witness.merkle_root,
      witness.nullifier,
      witness.authority_hash,
      witness.epoch_id,
      witness.campaign_id,
      witness.leaf,
      witness.user_secret,
      ...witness.merkle_path,
    ];

    for (const field of fields) {
      if (!this.isValidFieldElement(field)) {
        throw new Error(`Invalid field element: ${field}`);
      }
    }
  }

  /**
   * Check if string is valid BN254 field element
   *
   * Valid formats:
   * - Hex string with 0x prefix
   * - Decimal string
   * - Must be < BN254 field modulus
   */
  private isValidFieldElement(value: string): boolean {
    try {
      // Convert to bigint (supports hex with 0x prefix and decimal)
      const bn = BigInt(value);

      // BN254 field modulus: 21888242871839275222246405745257275088548364400416034343698204186575808495617
      const BN254_FIELD_MODULUS = BigInt(
        '21888242871839275222246405745257275088548364400416034343698204186575808495617'
      );

      return bn >= 0n && bn < BN254_FIELD_MODULUS;
    } catch {
      return false;
    }
  }

  /**
   * Get circuit depth for this prover instance
   */
  getDepth(): CircuitDepth {
    return this.depth;
  }
}

/**
 * Convenience function: Get prover instance for specific depth
 */
export async function getProver(depth: CircuitDepth): Promise<DistrictProver> {
  return DistrictProver.getInstance(depth);
}

/**
 * Convenience function: Generate proof (one-off usage)
 */
export async function generateProof(
  witness: DistrictWitness,
  depth: CircuitDepth
): Promise<DistrictProof> {
  const prover = await DistrictProver.getInstance(depth);
  return prover.generateProof(witness);
}

/**
 * Convenience function: Verify proof (one-off usage)
 */
export async function verifyProof(
  proof: DistrictProof,
  config: VerificationConfig,
  depth: CircuitDepth
): Promise<boolean> {
  const prover = await DistrictProver.getInstance(depth);
  return prover.verifyProof(proof, config);
}
