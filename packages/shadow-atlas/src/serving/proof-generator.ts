/**
 * Merkle Proof Generator
 *
 * Generates cryptographic inclusion proofs for district membership.
 * Clients verify proofs against published Merkle root (IPFS + on-chain).
 *
 * Proof format:
 * - leaf: Hash of district data
 * - siblings: Sibling hashes for tree traversal
 * - pathIndices: 0 = left, 1 = right
 * - root: Merkle root (cryptographic commitment)
 *
 * Verification:
 * hash(hash(...hash(leaf, sibling[0]), sibling[1])...) == root
 *
 * SECURITY CRITICAL: Proofs enable trustless verification.
 * Clients don't trust server - they verify cryptographically.
 */

import { UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import type { CompiledCircuit } from '@noir-lang/noir_js';
import { ShadowAtlasMerkleTree, createShadowAtlasMerkleTree, type MerkleProof } from '../merkle-tree.js';
import type { DistrictBoundary } from './types';

// Import compiled circuit
import circuitJson from '@voter-protocol/crypto/circuits/district_membership';

/**
 * ZK Proof Service Configuration
 */
export interface ZKProofServiceConfig {
  /**
   * Number of threads for proving (default: auto-detect via navigator.hardwareConcurrency)
   * Set to 1 for single-threaded proving (useful when SharedArrayBuffer is unavailable)
   * Requires COOP/COEP headers for multithreading in browsers
   */
  readonly threads?: number;
}

/**
 * Circuit inputs for ZK proof generation
 * Field names MUST match circuit main() parameter names (snake_case)
 */
export interface CircuitInputs {
  /** Merkle root of the district tree */
  readonly merkle_root: string;
  /** Nullifier for double-spend prevention */
  readonly nullifier: string;
  /** Authority hash */
  readonly authority_hash: string;
  /** Epoch ID */
  readonly epoch_id: string;
  /** Campaign ID */
  readonly campaign_id: string;
  /** Leaf value (hashed address) */
  readonly leaf: string;
  /** Merkle path (siblings) - array of 14 Field values */
  readonly merkle_path: readonly string[];
  /** Leaf index in tree */
  readonly leaf_index: number;
  /** User secret for nullifier */
  readonly user_secret: string;
}

/**
 * ZK Proof Result
 */
export interface ZKProofResult {
  /** Serialized proof bytes */
  readonly proof: Uint8Array;
  /** Public inputs */
  readonly publicInputs: {
    readonly merkleRoot: string;
    readonly nullifier: string;
    readonly authorityHash: string;
    readonly epochId: string;
    readonly campaignId: string;
  };
}

/**
 * Detect optimal thread count for proving
 * Returns 1 if SharedArrayBuffer is unavailable (no multithreading support)
 */
function detectThreads(): number {
  // Check for SharedArrayBuffer support (required for multithreading)
  const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';

  if (!hasSharedArrayBuffer) {
    console.log('[ZKProofService] SharedArrayBuffer unavailable - using single-threaded mode');
    return 1;
  }

  // Use hardware concurrency, capped at reasonable limits
  const cores = typeof navigator !== 'undefined'
    ? navigator.hardwareConcurrency || 4
    : 4;

  // Cap at 8 threads - diminishing returns beyond this for ZK proving
  return Math.min(cores, 8);
}

/**
 * ZK Proof Service
 *
 * Singleton service for generating ZK proofs using Noir + Barretenberg.
 * Uses browser-native WASM proving (no server dependency).
 *
 * USAGE:
 * ```typescript
 * const zkService = await ZKProofService.create(config);
 * const proof = await zkService.generateProof(inputs);
 * const isValid = await zkService.verify(proof.proof, Object.values(proof.publicInputs));
 * ```
 */
export class ZKProofService {
  private backend: UltraHonkBackend | null = null;
  private noir: Noir | null = null;
  private readonly threads: number;

  private constructor(config: ZKProofServiceConfig = {}) {
    this.threads = config.threads ?? detectThreads();
  }

  /**
   * Create ZK Proof Service (async factory)
   */
  static async create(config: ZKProofServiceConfig = {}): Promise<ZKProofService> {
    const service = new ZKProofService(config);
    await service.init();
    return service;
  }

  /**
   * Initialize the prover (must be called before generating proofs)
   */
  private async init(): Promise<void> {
    if (this.backend && this.noir) return; // Already initialized

    console.log(`[ZKProofService] Initializing with ${this.threads} thread(s)...`);
    const start = Date.now();

    // Cast circuit JSON to CompiledCircuit type
    const circuit = circuitJson as unknown as CompiledCircuit;

    // Initialize Noir for witness generation
    this.noir = new Noir(circuit);

    // Initialize UltraHonk backend for proving with thread configuration
    // threads > 1 enables parallel proving using Web Workers internally
    this.backend = new UltraHonkBackend(circuit.bytecode, { threads: this.threads });

    console.log(`[ZKProofService] Initialized in ${Date.now() - start}ms (${this.threads} threads)`);
  }

  /**
   * Generate a ZK proof for district membership
   *
   * @param inputs - Circuit inputs (must match circuit main() parameters)
   * @returns ZK proof with public inputs
   */
  async generateProof(inputs: CircuitInputs): Promise<ZKProofResult> {
    await this.init();

    console.log('[ZKProofService] Generating witness...');
    const witnessStart = Date.now();

    // Use Noir to generate witness from circuit inputs
    // The input names must match the circuit's main() function parameters (snake_case)
    // Cast to Record<string, string | string[] | number> to satisfy Noir's InputMap type
    const noirInputs = inputs as unknown as Record<string, string | string[] | number>;
    const { witness } = await this.noir!.execute(noirInputs);
    console.log(`[ZKProofService] Witness generated in ${Date.now() - witnessStart}ms`);

    console.log('[ZKProofService] Generating proof...');
    const proofStart = Date.now();

    // Generate proof using UltraHonk backend
    const { proof, publicInputs } = await this.backend!.generateProof(witness);

    console.log(`[ZKProofService] Proof generated in ${Date.now() - proofStart}ms`);

    // Extract public inputs from proof result
    // The order matches the circuit's return statement:
    // (merkle_root, nullifier, authority_hash, epoch_id, campaign_id)
    return {
      proof,
      publicInputs: {
        merkleRoot: publicInputs[0] ?? inputs.merkle_root,
        nullifier: publicInputs[1] ?? inputs.nullifier,
        authorityHash: publicInputs[2] ?? inputs.authority_hash,
        epochId: publicInputs[3] ?? inputs.epoch_id,
        campaignId: publicInputs[4] ?? inputs.campaign_id,
      },
    };
  }

  /**
   * Verify a ZK proof
   *
   * @param proof - Serialized proof bytes
   * @param publicInputs - Array of public inputs (must match circuit return order)
   * @returns true if proof is valid
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
 * Merkle proof service
 *
 * Uses async factory pattern because Merkle tree construction is async.
 */
export class ProofService {
  private merkleTree: ShadowAtlasMerkleTree;
  private readonly districtMap: Map<string, number>;
  private zkService: ZKProofService | null = null;

  /**
   * Private constructor - use ProofService.create() instead
   */
  private constructor(
    merkleTree: ShadowAtlasMerkleTree,
    districtMap: Map<string, number>
  ) {
    this.merkleTree = merkleTree;
    this.districtMap = districtMap;
  }

  /**
   * Create a ProofService instance (async factory)
   *
   * @param districts - Array of districts (must match Merkle tree construction)
   * @param addresses - Array of addresses used to build tree (sorted lexicographically)
   * @param zkConfig - Optional ZK proof service configuration
   */
  static async create(
    districts: readonly DistrictBoundary[],
    addresses: readonly string[],
    zkConfig?: ZKProofServiceConfig
  ): Promise<ProofService> {
    // Build Merkle tree from addresses (async)
    const merkleTree = await createShadowAtlasMerkleTree(addresses);

    // Build district ID → address index map
    const districtMap = new Map<string, number>();
    districts.forEach((district, index) => {
      districtMap.set(district.id, index);
    });

    const service = new ProofService(merkleTree, districtMap);

    // Initialize ZK service if config provided
    if (zkConfig !== undefined) {
      service.zkService = await ZKProofService.create(zkConfig);
    }

    return service;
  }

  /**
   * Generate Merkle proof for district
   *
   * @param districtId - District ID to prove membership
   * @returns Merkle proof with siblings and path indices
   * @throws Error if district not found
   */
  async generateProof(districtId: string): Promise<MerkleProof> {
    const addressIndex = this.districtMap.get(districtId);

    if (addressIndex === undefined) {
      throw new Error(`District not found in tree: ${districtId}`);
    }

    // Get corresponding address (districts and addresses must be 1:1 mapped)
    // In production, this would be loaded from database or snapshot
    // For now, we generate proof by address string
    // Note: This requires knowing the original address string
    // In a real implementation, you'd store the address->district mapping
    return this.generateProofByIndex(addressIndex);
  }

  /**
   * Generate proof by address index
   */
  private async generateProofByIndex(index: number): Promise<MerkleProof> {
    const leaves = this.merkleTree.getLeaves();
    const leaf = leaves[index];

    if (!leaf) {
      throw new Error(`Invalid index: ${index}`);
    }

    // Generate proof using Merkle tree
    const siblings: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = index;

    // Traverse tree from leaf to root, collecting siblings
    const depth = this.merkleTree.getDepth();
    for (let level = 0; level < depth; level++) {
      const isLeftChild = currentIndex % 2 === 0;
      const siblingIndex = isLeftChild ? currentIndex + 1 : currentIndex - 1;
      const layer = this.merkleTree.getLayer(level);
      const siblingHash = layer[siblingIndex];

      if (siblingHash === undefined) {
        throw new Error(`Missing sibling at level ${level}, index ${siblingIndex}`);
      }

      siblings.push(siblingHash);
      pathIndices.push(isLeftChild ? 0 : 1);

      // Move to parent index
      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      root: this.merkleTree.getRoot(),
      leaf,
      siblings,
      pathIndices,
    };
  }

  /**
   * Verify Merkle proof (for testing, actual verification in browser/ZK circuit)
   *
   * @param proof - Merkle proof to verify
   * @returns true if proof is valid
   */
  verifyProof(proof: MerkleProof): boolean {
    let computedHash = proof.leaf;

    for (let i = 0; i < proof.siblings.length; i++) {
      const sibling = proof.siblings[i];
      const isLeftChild = proof.pathIndices[i] === 0;

      if (isLeftChild) {
        computedHash = this.hashPair(computedHash, sibling);
      } else {
        computedHash = this.hashPair(sibling, computedHash);
      }
    }

    return computedHash === proof.root;
  }

  /**
   * Hash two values using Poseidon (via WASM)
   * NOTE: In production, import from merkle-tree.ts
   */
  private hashPair(left: bigint, right: bigint): bigint {
    // Import hash_pair from WASM circuit
    // For now, simplified implementation (replace with actual WASM call)
    const leftHex = '0x' + left.toString(16).padStart(64, '0');
    const rightHex = '0x' + right.toString(16).padStart(64, '0');

    // In production: import { hash_pair } from '../../circuits/pkg';
    // const hashHex = hash_pair(leftHex, rightHex);
    // return BigInt(hashHex);

    // Placeholder: XOR for testing (REPLACE with WASM Poseidon)
    return left ^ right;
  }

  /**
   * Get Merkle root
   */
  getRoot(): bigint {
    return this.merkleTree.getRoot();
  }

  /**
   * Get total leaf count
   */
  getLeafCount(): number {
    return this.merkleTree.getLeaves().length;
  }

  /**
   * Convert Merkle proof to Circuit inputs
   *
   * @param merkleProof - Merkle proof from generateProof()
   * @param userSecret - User secret for nullifier generation
   * @param campaignId - Campaign ID
   * @param authorityHash - Authority hash
   * @param epochId - Epoch ID
   * @returns Circuit inputs ready for ZK proof generation
   */
  mapToCircuitInputs(
    merkleProof: MerkleProof,
    userSecret: string,
    campaignId: string,
    authorityHash: string,
    epochId: string
  ): CircuitInputs {
    // Compute nullifier: Poseidon2(userSecret, campaignId, authorityHash, epochId)
    // For now, using placeholder - in production, compute actual nullifier
    const nullifier = '0x' + BigInt(0).toString(16).padStart(64, '0');

    // Convert merkle_path to array of 14 hex strings
    const merklePath = merkleProof.siblings.slice(0, 14).map((sibling) =>
      '0x' + sibling.toString(16).padStart(64, '0')
    );

    // Pad merkle_path to 14 elements if needed
    while (merklePath.length < 14) {
      merklePath.push('0x' + BigInt(0).toString(16).padStart(64, '0'));
    }

    return {
      merkle_root: '0x' + merkleProof.root.toString(16).padStart(64, '0'),
      nullifier,
      authority_hash: authorityHash,
      epoch_id: epochId,
      campaign_id: campaignId,
      leaf: '0x' + merkleProof.leaf.toString(16).padStart(64, '0'),
      merkle_path: merklePath,
      leaf_index: merkleProof.pathIndices.reduce((acc, bit, i) => acc | (bit << i), 0),
      user_secret: userSecret,
    };
  }

  /**
   * Generate ZK proof for district membership
   *
   * Uses Noir witness generation + UltraHonk backend for proving.
   *
   * @param districtId - District ID to prove
   * @param userSecret - User secret for nullifier
   * @param campaignId - Campaign ID
   * @param authorityHash - Authority hash
   * @param epochId - Epoch ID
   * @returns ZK proof with public inputs
   */
  async generateZKProof(
    districtId: string,
    userSecret: string,
    campaignId: string,
    authorityHash: string,
    epochId: string
  ): Promise<ZKProofResult> {
    // 1. Get Merkle inclusion proof
    const merkleProof = await this.generateProof(districtId);

    // 2. Initialize ZK service if not already initialized
    if (!this.zkService) {
      this.zkService = await ZKProofService.create();
    }

    // 3. Convert to circuit inputs
    const circuitInputs = this.mapToCircuitInputs(
      merkleProof,
      userSecret,
      campaignId,
      authorityHash,
      epochId
    );

    // 4. Generate ZK proof
    return this.zkService.generateProof(circuitInputs);
  }

  /**
   * Verify ZK proof
   *
   * @param proof - Serialized proof bytes
   * @param publicInputs - Array of public inputs
   * @returns true if proof is valid
   */
  async verifyZKProof(proof: Uint8Array, publicInputs: string[]): Promise<boolean> {
    if (!this.zkService) {
      this.zkService = await ZKProofService.create();
    }
    return this.zkService.verify(proof, publicInputs);
  }

  /**
   * Clean up ZK resources
   */
  async destroy(): Promise<void> {
    if (this.zkService) {
      await this.zkService.destroy();
      this.zkService = null;
    }
  }
}

/**
 * Compact proof format for network transmission
 */
export interface CompactProof {
  readonly r: string; // root (hex)
  readonly l: string; // leaf (hex)
  readonly s: readonly string[]; // siblings (hex array)
  readonly p: readonly number[]; // path indices
}

/**
 * Convert MerkleProof to compact format
 */
export function toCompactProof(proof: MerkleProof): CompactProof {
  return {
    r: '0x' + proof.root.toString(16),
    l: '0x' + proof.leaf.toString(16),
    s: proof.siblings.map((s) => '0x' + s.toString(16)),
    p: proof.pathIndices as number[],
  };
}

/**
 * Convert compact format back to MerkleProof
 */
export function fromCompactProof(compact: CompactProof): MerkleProof {
  return {
    root: BigInt(compact.r),
    leaf: BigInt(compact.l),
    siblings: compact.s.map((s) => BigInt(s)),
    pathIndices: compact.p,
  };
}
