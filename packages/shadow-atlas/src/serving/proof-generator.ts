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

import { ShadowAtlasMerkleTree, createShadowAtlasMerkleTree, type MerkleProof } from '../merkle-tree.js';
import type { DistrictBoundary } from './types';
import {
  DistrictProver,
  type DistrictProof,
  type CircuitDepth,
} from '@voter-protocol/crypto/district-prover';

/**
 * ZK Proof Service Configuration
 */
export interface ZKProofServiceConfig {
  /**
   * Circuit depth (14=municipal, 20=state, 22=federal)
   * Must match the Merkle tree depth being used
   */
  readonly depth: CircuitDepth;
}

// Re-export types from crypto package for convenience
import type { DistrictWitness } from '@voter-protocol/crypto/district-prover';
export type CircuitInputs = DistrictWitness;

/**
 * ZK Proof Result
 */
export interface ZKProofResult {
  /** Serialized proof bytes */
  readonly proof: DistrictProof['proof'];
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
 * ZK Proof Service
 *
 * Wrapper around DistrictProver from @voter-protocol/crypto.
 * Uses browser-native WASM proving (no server dependency).
 *
 * USAGE:
 * ```typescript
 * const zkService = await ZKProofService.create({ depth: 20 });
 * const proof = await zkService.generateProof(inputs);
 * const isValid = await zkService.verify(proof.proof, Object.values(proof.publicInputs));
 * ```
 */
export class ZKProofService {
  private prover: DistrictProver | null = null;
  private readonly depth: CircuitDepth;

  private constructor(config: ZKProofServiceConfig) {
    this.depth = config.depth;
  }

  /**
   * Create ZK Proof Service (async factory)
   */
  static async create(config: ZKProofServiceConfig): Promise<ZKProofService> {
    const service = new ZKProofService(config);
    await service.init();
    return service;
  }

  /**
   * Initialize the prover (must be called before generating proofs)
   */
  private async init(): Promise<void> {
    if (this.prover) return; // Already initialized

    console.log(`[ZKProofService] Initializing DistrictProver (depth=${this.depth})...`);
    const start = Date.now();

    // Get singleton prover instance for this depth
    this.prover = await DistrictProver.getInstance(this.depth);

    console.log(`[ZKProofService] Initialized in ${Date.now() - start}ms`);
  }

  /**
   * Generate a ZK proof for district membership
   *
   * @param inputs - Circuit inputs (must match circuit main() parameters)
   * @returns ZK proof with public inputs
   */
  async generateProof(inputs: CircuitInputs): Promise<ZKProofResult> {
    await this.init();

    console.log('[ZKProofService] Generating proof...');
    const start = Date.now();

    // Generate proof using DistrictProver
    const districtProof = await this.prover!.generateProof(inputs);

    console.log(`[ZKProofService] Proof generated in ${Date.now() - start}ms`);

    // Convert to ZKProofResult format
    return {
      proof: districtProof.proof,
      publicInputs: {
        merkleRoot: districtProof.publicInputs[0],
        nullifier: districtProof.publicInputs[1],
        authorityHash: districtProof.publicInputs[2],
        epochId: districtProof.publicInputs[3],
        campaignId: districtProof.publicInputs[4],
      },
    };
  }

  /**
   * Verify a ZK proof
   *
   * @param proof - Serialized proof bytes
   * @param publicInputs - Public inputs object
   * @returns true if proof is valid
   */
  async verify(
    proof: DistrictProof['proof'],
    publicInputs: ZKProofResult['publicInputs']
  ): Promise<boolean> {
    await this.init();

    const districtProof: DistrictProof = {
      proof,
      publicInputs: [
        publicInputs.merkleRoot,
        publicInputs.nullifier,
        publicInputs.authorityHash,
        publicInputs.epochId,
        publicInputs.campaignId,
      ],
    };

    const verificationConfig = {
      expectedRoot: publicInputs.merkleRoot,
      expectedNullifier: publicInputs.nullifier,
      expectedAuthorityHash: publicInputs.authorityHash,
      expectedEpochId: publicInputs.epochId,
      expectedCampaignId: publicInputs.campaignId,
    };

    return this.prover!.verifyProof(districtProof, verificationConfig);
  }

  /**
   * Clean up resources (no-op since DistrictProver is a singleton)
   */
  async destroy(): Promise<void> {
    // DistrictProver is a singleton, no cleanup needed
    this.prover = null;
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
   * @param zkConfig - ZK proof service configuration (required for ZK proving)
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
    if (zkConfig) {
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

    // Convert merkle_path to array of hex strings
    // NOTE: The depth should match the zkConfig.depth provided to create()
    const merklePath = merkleProof.siblings.map((sibling) =>
      '0x' + sibling.toString(16).padStart(64, '0')
    );

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
   * @throws Error if ZK service not initialized (must pass zkConfig to create())
   */
  async generateZKProof(
    districtId: string,
    userSecret: string,
    campaignId: string,
    authorityHash: string,
    epochId: string
  ): Promise<ZKProofResult> {
    if (!this.zkService) {
      throw new Error(
        'ZK service not initialized. Pass zkConfig to ProofService.create() to enable ZK proving.'
      );
    }

    // 1. Get Merkle inclusion proof
    const merkleProof = await this.generateProof(districtId);

    // 2. Convert to circuit inputs
    const circuitInputs = this.mapToCircuitInputs(
      merkleProof,
      userSecret,
      campaignId,
      authorityHash,
      epochId
    );

    // 3. Generate ZK proof
    return this.zkService.generateProof(circuitInputs);
  }

  /**
   * Verify ZK proof
   *
   * @param proof - Serialized proof bytes
   * @param publicInputs - Public inputs object
   * @returns true if proof is valid
   * @throws Error if ZK service not initialized
   */
  async verifyZKProof(
    proof: DistrictProof['proof'],
    publicInputs: ZKProofResult['publicInputs']
  ): Promise<boolean> {
    if (!this.zkService) {
      throw new Error(
        'ZK service not initialized. Pass zkConfig to ProofService.create() to enable ZK verification.'
      );
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
