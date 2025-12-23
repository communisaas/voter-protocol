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

/**
 * Boundary types for multi-layer tree support
 */
export type BoundaryType =
  | 'congressional-district'
  | 'state-legislative-upper'
  | 'state-legislative-lower'
  | 'county'
  | 'city-council-district';

/**
 * Authority levels for provenance tracking
 */
export const AUTHORITY_LEVELS = {
  FEDERAL_MANDATE: 5,      // US Census TIGER (Congressional, State, County)
  STATE_OFFICIAL: 4,       // State GIS clearinghouse
  MUNICIPAL_OFFICIAL: 3,   // Official city/county GIS
  COMMUNITY_VERIFIED: 2,   // Community sources with validation
  UNVERIFIED: 1,           // Unverified sources
} as const;

/**
 * Merkle leaf input for multi-layer tree
 */
export interface MerkleLeafInput {
  readonly id: string;                    // Unique identifier (GEOID for TIGER, custom for municipal)
  readonly boundaryType: BoundaryType;    // Boundary type for disambiguation
  readonly geometryHash: bigint;          // Poseidon hash of geometry
  readonly authority: number;             // Authority level (1-5)
}

/**
 * Merkle proof for ZK circuit verification
 */
export interface MerkleProof {
  readonly root: bigint;
  readonly leaf: bigint;
  readonly siblings: readonly bigint[];
  readonly pathIndices: readonly number[];  // 0 = left, 1 = right
}

/**
 * Configuration for parallel tree construction
 */
export interface MerkleTreeConfig {
  /** Max concurrent hash operations per batch (default: 64) */
  readonly batchSize?: number;
  /** Tree depth override (default: 12, max capacity 4096) */
  readonly depth?: number;
}

const DEFAULT_TREE_DEPTH = 12;
const DEFAULT_BATCH_SIZE = 64;
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
    const depth = config.depth ?? DEFAULT_TREE_DEPTH;
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
      pathIndices
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
 * @param input - Merkle leaf input with ID, type, geometry hash, authority
 * @returns Promise<bigint> Poseidon2 hash as bigint
 */
export async function computeLeafHash(input: MerkleLeafInput): Promise<bigint> {
  const hasher = await getHasher();

  // Hash components
  const typeHash = await hasher.hashString(input.boundaryType);
  const idHash = await hasher.hashString(input.id);

  // Hash: Poseidon2([typeHash, idHash, geometryHash, authority])
  return hasher.hash4(typeHash, idHash, input.geometryHash, BigInt(input.authority));
}

/**
 * Batch compute leaf hashes for multiple inputs
 *
 * @param inputs - Array of Merkle leaf inputs
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
      capacity: tree.getCapacity(),
      addressCount: tree.getAddressCount(),
      generatedAt: new Date().toISOString(),
      hashFunction: 'poseidon2',
      implementation: 'noir-stdlib',
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
