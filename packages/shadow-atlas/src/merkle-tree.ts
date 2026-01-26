/**
 * Shadow Atlas Merkle Tree - Parallel Implementation
 *
 * Compliant with: SHADOW-ATLAS-SPEC.md Section 3 (Merkle Tree Specification)
 *
 * Structure: Single-tier balanced binary Merkle tree per legislative district
 * Depth: 12 levels (fixed)
 * Capacity: 2^12 = 4,096 addresses per tree
 * Hash Function: Poseidon2 (Noir stdlib via @noir-lang/noir_js)
 *
 * PERFORMANCE OPTIMIZATIONS:
 * 1. Parallel leaf hashing - All addresses hashed concurrently
 * 2. Parallel tree building - Each level hashed concurrently
 * 3. Cached padding hash - Computed once, reused for all padding leaves
 * 4. Configurable batch sizes - Tune parallelism for environment
 * 5. Singleton hasher - Noir instance reused across operations
 *
 * SECURITY:
 * - Uses EXACT same Poseidon2 as ZK circuit (Noir stdlib)
 * - Deterministic leaf ordering prevents proof generation attacks
 * - Duplicate detection prevents silent proof failures
 */

import { Poseidon2Hasher, getHasher } from '@voter-protocol/crypto/poseidon2';
import { BoundaryType } from './core/types.js';
import {
  AUTHORITY_LEVELS,
  type CircuitDepth,
  CIRCUIT_DEPTHS,
  selectDepthForJurisdiction,
  getCapacityForDepth,
  validateDepthForCount,
} from './core/constants.js';

// Re-export for public API compatibility
export type { BoundaryType, CircuitDepth };

// Re-export constants for backward compatibility and public API
export {
  AUTHORITY_LEVELS,
  CIRCUIT_DEPTHS,
  selectDepthForJurisdiction,
  getCapacityForDepth,
  validateDepthForCount,
};

/**
 * Provenance source metadata for cryptographic commitment
 *
 * SECURITY: This data is hashed into the Merkle leaf, creating a cryptographic
 * commitment to the data's lineage. Any tampering with source URL, checksum,
 * or timestamp will produce a different leaf hash, breaking proof verification.
 *
 * LEGAL RISK MITIGATION: By including provenance in the leaf hash, we can
 * cryptographically prove the exact source data that was used to construct
 * the boundary. This addresses the audit finding: "Legal Risk: MEDIUM-HIGH"
 */
export interface ProvenanceSource {
  /** Direct URL to source data (e.g., Census TIGER shapefile URL) */
  readonly url: string;
  /** SHA-256 checksum of downloaded file (hex string without 0x prefix) */
  readonly checksum: string;
  /** ISO 8601 timestamp when data was retrieved */
  readonly timestamp: string;
  /** Optional: Data provider identifier (e.g., "census-tiger", "municipal-gis") */
  readonly provider?: string;
}

/**
 * Merkle leaf input for multi-layer tree
 */
export interface MerkleLeafInput {
  readonly id: string;                    // Unique identifier (GEOID for TIGER, custom for municipal)
  readonly boundaryType: BoundaryType;    // Boundary type for disambiguation
  readonly geometryHash: bigint;          // Poseidon hash of geometry
  readonly authority: number;             // Authority level (1-5)
  /**
   * Optional provenance source for cryptographic commitment
   *
   * When provided, provenance is hashed into the leaf hash, creating an
   * immutable commitment to data lineage. Backward compatible: leaves
   * without provenance compute the same hash as before.
   */
  readonly source?: ProvenanceSource;
}

/**
 * Merkle proof for ZK circuit verification
 *
 * DEPTH-AWARE (v2.1.0):
 * The `depth` field indicates which circuit variant to use for verification.
 * The proof's siblings array length MUST equal depth for valid verification.
 *
 * Depth → Circuit mapping:
 * - 18: UltraPlonkVerifier_18 (~262K capacity)
 * - 20: UltraPlonkVerifier_20 (~1M capacity)
 * - 22: UltraPlonkVerifier_22 (~4M capacity)
 * - 24: UltraPlonkVerifier_24 (~16M capacity)
 */
export interface MerkleProof {
  readonly root: bigint;
  readonly leaf: bigint;
  readonly siblings: readonly bigint[];
  readonly pathIndices: readonly number[];  // 0 = left, 1 = right
  /**
   * Circuit depth used to build this tree
   * MUST match the verifier contract depth for on-chain verification
   */
  readonly depth: CircuitDepth;
}

/**
 * Configuration for parallel tree construction
 *
 * MULTI-DEPTH SUPPORT (v2.1.0):
 * The `depth` field now accepts only valid CircuitDepth values (18, 20, 22, 24).
 * This ensures the tree depth matches a compiled circuit for proof verification.
 *
 * To select depth automatically:
 * - By address count: Use selectDepthForSize() from poseidon-utils
 * - By country: Use selectDepthForJurisdiction() from constants
 */
export interface MerkleTreeConfig {
  /** Max concurrent hash operations per batch (default: 64) */
  readonly batchSize?: number;
  /**
   * Circuit-compatible tree depth (default: 20)
   * Valid values: 18, 20, 22, 24
   */
  readonly depth?: CircuitDepth;
  /**
   * Optional: ISO 3166-1 alpha-3 country code for automatic depth selection
   * If provided and depth is not set, uses selectDepthForJurisdiction()
   */
  readonly countryCode?: string;
}

import { DEFAULT_TREE_DEPTH, DEFAULT_BATCH_SIZE } from './core/constants.js';
const PADDING_LEAF = 'PADDING';

/**
 * Shadow Atlas Merkle Tree v2 - Async Parallel Implementation
 *
 * USAGE:
 * ```typescript
 * const tree = await ShadowAtlasMerkleTree.create(addresses);
 * const proof = tree.generateProof(address);
 * const isValid = await tree.verifyProof(proof, address);
 * ```
 */
export class ShadowAtlasMerkleTree {
  private readonly leaves: bigint[];
  private readonly layers: bigint[][];
  private readonly root: bigint;
  private readonly hasher: Poseidon2Hasher;
  private readonly depth: number;
  private readonly capacity: number;
  private readonly addressToIndex: Map<string, number>;

  /**
   * Private constructor - use create() factory instead
   */
  private constructor(
    leaves: bigint[],
    layers: bigint[][],
    hasher: Poseidon2Hasher,
    depth: number,
    addressToIndex: Map<string, number>
  ) {
    this.leaves = leaves;
    this.layers = layers;
    this.root = layers[depth][0];
    this.hasher = hasher;
    this.depth = depth;
    this.capacity = 2 ** depth;
    this.addressToIndex = addressToIndex;
  }

  /**
   * Create Merkle tree from addresses (async factory)
   *
   * PARALLELISM:
   * 1. Hash all addresses concurrently (batch size controlled)
   * 2. Build tree level-by-level with concurrent pair hashing
   *
   * @param addresses - Array of address strings (will be sorted for determinism)
   * @param config - Optional configuration for parallelism tuning
   * @returns Promise<ShadowAtlasMerkleTree>
   */
  static async create(
    addresses: readonly string[],
    config: MerkleTreeConfig = {}
  ): Promise<ShadowAtlasMerkleTree> {
    // Determine depth: explicit > country-based > default
    let depth: CircuitDepth;
    if (config.depth !== undefined) {
      depth = config.depth;
    } else if (config.countryCode) {
      depth = selectDepthForJurisdiction(config.countryCode);
    } else {
      depth = DEFAULT_TREE_DEPTH as CircuitDepth;
    }

    // Validate depth is a valid CircuitDepth
    if (!CIRCUIT_DEPTHS.includes(depth)) {
      throw new Error(
        `Invalid circuit depth: ${depth}. Valid values: ${CIRCUIT_DEPTHS.join(', ')}`
      );
    }

    const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
    const capacity = 2 ** depth;

    // Validation: Check capacity
    if (addresses.length > capacity) {
      throw new Error(
        `District capacity exceeded: ${addresses.length} > ${capacity}`
      );
    }

    // SECURITY: Detect duplicates before hashing
    const uniqueAddresses = new Set(addresses);
    if (uniqueAddresses.size !== addresses.length) {
      const duplicates = addresses.filter((addr, index) =>
        addresses.indexOf(addr) !== index
      );
      throw new Error(
        `Duplicate addresses detected: ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? '...' : ''}. ` +
        `Each address must be unique within a district tree.`
      );
    }

    // Initialize hasher singleton
    const hasher = await getHasher();

    // Build address -> index map for O(1) proof generation
    const addressToIndex = new Map<string, number>();
    addresses.forEach((addr, idx) => addressToIndex.set(addr, idx));

    // Step 1: Hash all addresses in parallel
    console.time('merkle:hash-addresses');
    const addressHashes = await hasher.hashStringsBatch(addresses, batchSize);
    console.timeEnd('merkle:hash-addresses');

    // Step 2: Compute padding hash once
    const paddingHash = await hasher.hashString(PADDING_LEAF);

    // Step 3: Create full leaf array with padding
    const leaves: bigint[] = [...addressHashes];
    while (leaves.length < capacity) {
      leaves.push(paddingHash);
    }

    // Step 4: Build tree layers with parallel hashing
    console.time('merkle:build-tree');
    const layers = await ShadowAtlasMerkleTree.buildTreeParallel(
      leaves,
      depth,
      hasher,
      batchSize
    );
    console.timeEnd('merkle:build-tree');

    return new ShadowAtlasMerkleTree(leaves, layers, hasher, depth, addressToIndex);
  }

  /**
   * Build Merkle tree layers with parallel hashing
   *
   * PARALLELISM: At each level, all pairs are hashed concurrently.
   * Level 0: 4096 leaves → 2048 pairs hashed in parallel
   * Level 1: 2048 nodes → 1024 pairs hashed in parallel
   * ... etc
   */
  private static async buildTreeParallel(
    leaves: bigint[],
    depth: number,
    hasher: Poseidon2Hasher,
    batchSize: number
  ): Promise<bigint[][]> {
    const layers: bigint[][] = [leaves];
    let currentLayer = leaves;

    for (let level = 0; level < depth; level++) {
      // Create pairs for this level
      const pairs: Array<readonly [bigint, bigint]> = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        pairs.push([currentLayer[i], currentLayer[i + 1]] as const);
      }

      // Hash all pairs in parallel
      const nextLayer = await hasher.hashPairsBatch(pairs, batchSize);
      layers.push(nextLayer);
      currentLayer = nextLayer;
    }

    return layers;
  }

  /**
   * Get Merkle root hash
   */
  getRoot(): bigint {
    return this.root;
  }

  /**
   * Get all leaves (for testing/debugging/export)
   */
  getLeaves(): readonly bigint[] {
    return this.leaves;
  }

  /**
   * Get tree layer (for testing/debugging)
   * @param level - 0 = leaves, depth = root
   */
  getLayer(level: number): readonly bigint[] {
    if (level < 0 || level > this.depth) {
      throw new Error(`Invalid level: ${level}. Valid range: 0-${this.depth}`);
    }
    return this.layers[level];
  }

  /**
   * Get tree depth
   */
  getDepth(): number {
    return this.depth;
  }

  /**
   * Get tree capacity
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Generate Merkle proof for an address
   *
   * O(1) address lookup via pre-built index map.
   * O(depth) sibling collection.
   *
   * @param address - Address string to prove membership
   * @returns Merkle proof with siblings and path indices
   * @throws Error if address not found in tree
   */
  async generateProof(address: string): Promise<MerkleProof> {
    // O(1) lookup via index map
    const leafIndex = this.addressToIndex.get(address);

    if (leafIndex === undefined) {
      throw new Error(`Address not in tree: ${address}`);
    }

    const leafHash = this.leaves[leafIndex];
    const siblings: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = leafIndex;

    // Traverse tree from leaf to root, collecting siblings
    for (let level = 0; level < this.depth; level++) {
      const isLeftChild = currentIndex % 2 === 0;
      const siblingIndex = isLeftChild ? currentIndex + 1 : currentIndex - 1;
      const siblingHash = this.layers[level][siblingIndex];

      siblings.push(siblingHash);
      pathIndices.push(isLeftChild ? 0 : 1);

      // Move to parent index
      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      root: this.root,
      leaf: leafHash,
      siblings,
      pathIndices,
      depth: this.depth as CircuitDepth,
    };
  }

  /**
   * Verify Merkle proof
   *
   * Recomputes root from leaf + siblings and compares to stored root.
   * Used for testing; actual verification happens in ZK circuit.
   *
   * @param proof - Merkle proof to verify
   * @param address - Address being proven
   * @returns true if proof is valid
   */
  async verifyProof(proof: MerkleProof, address: string): Promise<boolean> {
    const leafHash = await this.hasher.hashString(address);

    if (proof.leaf !== leafHash) {
      return false;
    }

    let computedHash = proof.leaf;

    for (let i = 0; i < proof.siblings.length; i++) {
      const sibling = proof.siblings[i];
      const isLeftChild = proof.pathIndices[i] === 0;

      if (isLeftChild) {
        computedHash = await this.hasher.hashPair(computedHash, sibling);
      } else {
        computedHash = await this.hasher.hashPair(sibling, computedHash);
      }
    }

    return computedHash === proof.root;
  }

  /**
   * Check if address exists in tree
   */
  hasAddress(address: string): boolean {
    return this.addressToIndex.has(address);
  }

  /**
   * Get address count (excluding padding)
   */
  getAddressCount(): number {
    return this.addressToIndex.size;
  }
}

/**
 * Factory: Create Shadow Atlas Merkle tree
 *
 * @param addresses - Array of address strings (sorted lexicographically recommended)
 * @param config - Optional configuration for parallelism tuning
 * @returns Promise<ShadowAtlasMerkleTree>
 */
export async function createShadowAtlasMerkleTree(
  addresses: readonly string[],
  config?: MerkleTreeConfig
): Promise<ShadowAtlasMerkleTree> {
  return ShadowAtlasMerkleTree.create(addresses, config);
}

/**
 * Compute leaf hash for multi-layer tree
 *
 * SECURITY: Includes boundary type to prevent collisions.
 * Example: CD-01 (Congressional District 1) vs SLDU-01 (State Senate District 1)
 * have same ID "01" but different boundary types, producing different leaf hashes.
 *
 * PROVENANCE COMMITMENT (v2.1.0):
 * When source metadata is provided, the leaf hash includes a cryptographic commitment
 * to the data's provenance (source URL, checksum, timestamp). This enables verification
 * that a boundary was derived from a specific source file.
 *
 * Hash structure:
 * - Without provenance: hash4(typeHash, idHash, geometryHash, authority)
 * - With provenance:    hash4(typeHash, idHash, geometryHash, hash2(authority, provenanceHash))
 *
 * The hash2(authority, provenanceHash) combines authority level with provenance into a
 * single field, maintaining hash4 arity while adding provenance commitment.
 *
 * BACKWARD COMPATIBILITY: Leaves without source metadata compute the same hash as before.
 *
 * @param input - Merkle leaf input with ID, type, geometry hash, authority, and optional provenance
 * @returns Promise<bigint> Poseidon2 hash as bigint
 */
export async function computeLeafHash(input: MerkleLeafInput): Promise<bigint> {
  const hasher = await getHasher();

  // Hash components
  const typeHash = await hasher.hashString(input.boundaryType);
  const idHash = await hasher.hashString(input.id);

  // Compute authority field (with or without provenance)
  let authorityField: bigint;

  if (input.source?.url && input.source?.checksum) {
    // WITH PROVENANCE: Combine authority + provenance into single hash
    // Format: "url|checksum|timestamp" (timestamp optional but included if present)
    const provenanceString = `${input.source.url}|${input.source.checksum}|${input.source.timestamp ?? ''}`;
    const provenanceHash = await hasher.hashString(provenanceString);

    // Combine: hash2(authority, provenanceHash)
    // This ensures both authority level AND provenance are cryptographically committed
    authorityField = await hasher.hashPair(BigInt(input.authority), provenanceHash);
  } else {
    // WITHOUT PROVENANCE: Use raw authority (backward compatible)
    authorityField = BigInt(input.authority);
  }

  // Hash: Poseidon2([typeHash, idHash, geometryHash, authorityField])
  return hasher.hash4(typeHash, idHash, input.geometryHash, authorityField);
}

/**
 * Batch compute leaf hashes for multiple inputs
 *
 * Supports provenance commitment: inputs with source metadata will have
 * provenance hashed into their leaf hash. See computeLeafHash() for details.
 *
 * @param inputs - Array of Merkle leaf inputs (with optional provenance)
 * @param batchSize - Max concurrent operations
 * @returns Promise<bigint[]> Array of hashes in same order
 */
export async function computeLeafHashesBatch(
  inputs: readonly MerkleLeafInput[],
  batchSize: number = DEFAULT_BATCH_SIZE
): Promise<bigint[]> {
  const results: bigint[] = new Array(inputs.length);

  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, Math.min(i + batchSize, inputs.length));

    const batchResults = await Promise.all(
      batch.map((input) => computeLeafHash(input))
    );

    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
  }

  return results;
}

/**
 * IPFS Export Result
 */
export interface IPFSExportResult {
  readonly cid: string;           // IPFS CID (Content Identifier)
  readonly size: number;          // Size in bytes
  readonly url: string;           // IPFS gateway URL
  readonly pinned: boolean;       // Whether pinned to remote service
}

/**
 * Export Merkle tree to IPFS
 *
 * Serializes tree to JSON and uploads to IPFS via Web3.Storage or Pinata.
 * Returns CID for on-chain commitment.
 *
 * @param tree - Shadow Atlas Merkle tree
 * @param apiToken - IPFS service API token (Web3.Storage or Pinata)
 * @param service - IPFS service ('web3storage' | 'pinata')
 * @returns IPFS CID and metadata
 */
export async function exportToIPFS(
  tree: ShadowAtlasMerkleTree,
  apiToken: string,
  service: 'web3storage' | 'pinata' = 'web3storage'
): Promise<IPFSExportResult> {
  // Serialize tree to JSON
  const treeData = {
    version: '2.0.0',
    root: '0x' + tree.getRoot().toString(16),
    leaves: tree.getLeaves().map((leaf, index) => ({
      index,
      hash: '0x' + leaf.toString(16),
    })),
    metadata: {
      depth: tree.getDepth(),
      circuitDepth: tree.getDepth() as CircuitDepth, // Explicit circuit binding
      capacity: tree.getCapacity(),
      addressCount: tree.getAddressCount(),
      generatedAt: new Date().toISOString(),
      hashFunction: 'poseidon2',
      implementation: 'noir-stdlib',
      verifierContract: `UltraPlonkVerifier_${tree.getDepth()}`, // On-chain verifier reference
    },
  };

  const jsonString = JSON.stringify(treeData, null, 2);
  const jsonBytes = Buffer.from(jsonString, 'utf-8');

  if (service === 'web3storage') {
    return await uploadToWeb3Storage(jsonBytes, apiToken);
  } else {
    return await uploadToPinata(jsonBytes, apiToken);
  }
}

/**
 * Upload to Web3.Storage
 */
async function uploadToWeb3Storage(
  data: Buffer,
  apiToken: string
): Promise<IPFSExportResult> {
  const formData = new FormData();
  const blob = new Blob([data as unknown as BlobPart], { type: 'application/json' });
  formData.append('file', blob, 'shadow-atlas-tree.json');

  const response = await fetch('https://api.web3.storage/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Web3.Storage upload failed: ${response.statusText}`);
  }

  const result = await response.json();
  const cid = result.cid;

  return {
    cid,
    size: data.length,
    url: `https://w3s.link/ipfs/${cid}`,
    pinned: true,
  };
}

/**
 * Upload to Pinata
 */
async function uploadToPinata(
  data: Buffer,
  apiToken: string
): Promise<IPFSExportResult> {
  const formData = new FormData();
  const blob = new Blob([data as unknown as BlobPart], { type: 'application/json' });
  formData.append('file', blob, 'shadow-atlas-tree.json');

  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Pinata upload failed: ${response.statusText}`);
  }

  const result = await response.json();
  const cid = result.IpfsHash;

  return {
    cid,
    size: data.length,
    url: `https://gateway.pinata.cloud/ipfs/${cid}`,
    pinned: true,
  };
}
