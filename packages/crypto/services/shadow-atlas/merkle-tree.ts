/**
 * Shadow Atlas Merkle Tree Implementation
 *
 * Compliant with: SHADOW-ATLAS-SPEC.md Section 3 (Merkle Tree Specification)
 *
 * Structure: Single-tier balanced binary Merkle tree per legislative district
 * Depth: 12 levels (fixed)
 * Capacity: 2^12 = 4,096 addresses per tree
 * Hash Function: Poseidon (Axiom halo2_base via WASM) - IDENTICAL to ZK circuit
 *
 * SECURITY CRITICAL: This implementation uses the EXACT same Poseidon hash
 * from the Halo2 circuit via WASM bindings. This guarantees that TypeScript
 * Merkle roots match circuit Merkle roots, preventing proof verification failures.
 *
 * Supply-chain attack mitigation:
 * - WASM bindings call Axiom halo2_base (Trail of Bits audited, Mainnet V2)
 * - Rust Poseidon has golden test vectors from PSE (cross-validated)
 * - TypeScript cannot diverge from circuit (uses same binary code)
 *
 * MULTI-LAYER SUPPORT (2025-12-14 Extension):
 * - Supports TIGER boundaries (CD, SLDU, SLDL, County) alongside city council districts
 * - Boundary type included in leaf hash to prevent collisions (CD-01 vs SLDU-01)
 * - Deterministic leaf ordering across boundary types (alphabetical by type, then ID)
 */

import { hash_pair, hash_single } from '../../circuits/pkg';

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
 * Shadow Atlas Merkle Tree
 *
 * Fixed-depth balanced binary tree with Poseidon hashing via WASM
 *
 * CRITICAL INVARIANT: All hashing operations use WASM bindings to Rust circuit.
 * This guarantees TypeScript Merkle roots match ZK proof verification.
 */
export class ShadowAtlasMerkleTree {
  private static readonly TREE_DEPTH = 12;
  private static readonly MAX_CAPACITY = 2 ** 12; // 4,096 addresses
  private static readonly PADDING_LEAF = "PADDING";

  private readonly leaves: bigint[];
  private readonly layers: bigint[][];
  private readonly root: bigint;

  /**
   * Construct Merkle tree from addresses
   *
   * SECURITY: Constructor is synchronous because WASM calls are synchronous.
   * All Poseidon hashing goes through circuit's WASM exports (hash_pair, hash_single).
   *
   * @param addresses - Array of address strings (sorted lexicographically)
   * @throws Error if capacity exceeded or duplicate addresses detected
   */
  constructor(addresses: readonly string[]) {
    // Validation: Check capacity
    if (addresses.length > ShadowAtlasMerkleTree.MAX_CAPACITY) {
      throw new Error(
        `District capacity exceeded: ${addresses.length} > ${ShadowAtlasMerkleTree.MAX_CAPACITY}`
      );
    }

    // SECURITY CRITICAL: Reject duplicate addresses
    // If duplicates exist, indexOf() only returns the first occurrence,
    // making subsequent duplicates unprovable (proof generation fails silently).
    // We detect this early with a Set to prevent cryptographic integrity issues.
    const uniqueAddresses = new Set(addresses);
    if (uniqueAddresses.size !== addresses.length) {
      const duplicates = addresses.filter((addr, index) =>
        addresses.indexOf(addr) !== index
      );
      throw new Error(
        `Duplicate addresses detected: ${duplicates.join(', ')}. ` +
        `Each address must be unique within a district tree.`
      );
    }

    // Step 1: Hash addresses to leaf nodes (via WASM Poseidon)
    this.leaves = addresses.map(addr => this.hashAddress(addr));

    // Step 2: Pad to full capacity with deterministic padding
    while (this.leaves.length < ShadowAtlasMerkleTree.MAX_CAPACITY) {
      this.leaves.push(this.hashAddress(ShadowAtlasMerkleTree.PADDING_LEAF));
    }

    // Step 3: Build tree layers bottom-up
    this.layers = this.buildTree(this.leaves);

    // Step 4: Root is single element at top layer
    this.root = this.layers[ShadowAtlasMerkleTree.TREE_DEPTH][0];
  }

  /**
   * Get Merkle root hash
   */
  getRoot(): bigint {
    return this.root;
  }

  /**
   * Get all leaves (for testing/debugging)
   */
  getLeaves(): readonly bigint[] {
    return this.leaves;
  }

  /**
   * Get tree layer (for testing/debugging)
   * @param level - 0 = leaves, 12 = root
   */
  getLayer(level: number): readonly bigint[] {
    if (level < 0 || level > ShadowAtlasMerkleTree.TREE_DEPTH) {
      throw new Error(`Invalid level: ${level}`);
    }
    return this.layers[level];
  }

  /**
   * Generate Merkle proof for an address
   *
   * @param address - Address string to prove membership
   * @returns Merkle proof with siblings and path indices
   * @throws Error if address not found in tree
   */
  generateProof(address: string): MerkleProof {
    const leafHash = this.hashAddress(address);
    const leafIndex = this.leaves.indexOf(leafHash);

    if (leafIndex === -1) {
      throw new Error(`Address not in tree: ${address}`);
    }

    const siblings: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = leafIndex;

    // Traverse tree from leaf to root, collecting siblings
    for (let level = 0; level < ShadowAtlasMerkleTree.TREE_DEPTH; level++) {
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
   * Verify Merkle proof (for testing, actual verification in ZK circuit)
   *
   * @param proof - Merkle proof to verify
   * @param address - Address being proven
   * @returns true if proof is valid
   */
  verifyProof(proof: MerkleProof, address: string): boolean {
    const leafHash = this.hashAddress(address);

    if (proof.leaf !== leafHash) {
      return false;
    }

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
   * Build Merkle tree layers bottom-up
   *
   * @param leaves - Leaf layer (4,096 hashes)
   * @returns Array of layers [leaves, level1, ..., root]
   */
  private buildTree(leaves: bigint[]): bigint[][] {
    const layers: bigint[][] = [leaves];
    let currentLayer = leaves;

    // Build 12 levels (leaves → root)
    for (let level = 0; level < ShadowAtlasMerkleTree.TREE_DEPTH; level++) {
      const nextLayer: bigint[] = [];

      // Pair up elements and hash
      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];
        const right = currentLayer[i + 1];
        const parent = this.hashPair(left, right);
        nextLayer.push(parent);
      }

      layers.push(nextLayer);
      currentLayer = nextLayer;
    }

    return layers;
  }

  /**
   * Hash a single address string to BN254 field element
   *
   * SECURITY CRITICAL: This calls hash_single() from WASM (Rust circuit).
   * Chunking strategy matches circuit expectations:
   * - UTF-8 encode address string
   * - Split into 31-byte chunks (safe for BN254 254-bit field)
   * - Convert each chunk to bigint
   * - Hash with Poseidon via WASM
   *
   * @param address - Address string
   * @returns Poseidon hash as bigint (BN254 field element)
   */
  private hashAddress(address: string): bigint {
    const bytes = Buffer.from(address, 'utf-8');
    const chunks: bigint[] = [];

    // Split into 31-byte chunks (31 * 8 = 248 bits < 254-bit BN254 field)
    // This ensures each chunk fits in Fr without modular reduction
    for (let i = 0; i < bytes.length; i += 31) {
      const chunk = bytes.slice(i, i + 31);
      chunks.push(BigInt('0x' + chunk.toString('hex')));
    }

    // Hash chunks with Poseidon via WASM
    if (chunks.length === 0) {
      // Empty string → hash zero
      const hashHex = hash_single('0x00');
      return BigInt(hashHex);
    } else if (chunks.length === 1) {
      // Single chunk → hash directly
      const valueHex = '0x' + chunks[0].toString(16).padStart(64, '0');
      const hashHex = hash_single(valueHex);
      return BigInt(hashHex);
    } else {
      // Multiple chunks → iterative hashing (Poseidon sponge construction)
      // hash(chunk[0], chunk[1]) → hash(result, chunk[2]) → ...
      let hash = chunks[0];
      for (let i = 1; i < chunks.length; i++) {
        const leftHex = '0x' + hash.toString(16).padStart(64, '0');
        const rightHex = '0x' + chunks[i].toString(16).padStart(64, '0');
        const hashHex = hash_pair(leftHex, rightHex);
        hash = BigInt(hashHex);
      }
      return hash;
    }
  }

  /**
   * Hash two child hashes to create parent hash
   *
   * SECURITY CRITICAL: This calls hash_pair() from WASM (Rust circuit).
   * Ensures Merkle tree structure matches circuit's expectations exactly.
   *
   * @param left - Left child hash (BN254 field element)
   * @param right - Right child hash (BN254 field element)
   * @returns Poseidon(left, right) as bigint
   */
  private hashPair(left: bigint, right: bigint): bigint {
    const leftHex = '0x' + left.toString(16).padStart(64, '0');
    const rightHex = '0x' + right.toString(16).padStart(64, '0');
    const hashHex = hash_pair(leftHex, rightHex);
    return BigInt(hashHex);
  }
}

/**
 * Factory: Create Shadow Atlas Merkle tree
 *
 * SECURITY: Synchronous construction using WASM Poseidon from circuit.
 * No async complexity, no divergence risk.
 *
 * @param addresses - Array of address strings (sorted lexicographically)
 * @returns Merkle tree instance
 */
export function createShadowAtlasMerkleTree(
  addresses: readonly string[]
): ShadowAtlasMerkleTree {
  return new ShadowAtlasMerkleTree(addresses);
}

/**
 * Compute leaf hash for multi-layer tree
 *
 * SECURITY CRITICAL: Includes boundary type to prevent collisions.
 * Example: CD-01 (Alabama Congressional District 1) vs SLDU-01 (Alabama State Senate District 1)
 * have same ID "01" but different boundary types, producing different leaf hashes.
 *
 * @param input - Merkle leaf input with ID, type, geometry hash, authority
 * @returns Poseidon hash as bigint (BN254 field element)
 */
export function computeLeafHash(input: MerkleLeafInput): bigint {
  // Convert boundary type to numeric constant for hashing
  const typeHash = hashString(input.boundaryType);
  const idHash = hashString(input.id);

  // Hash: Poseidon([typeHash, idHash, geometryHash, authority])
  // Using hash_pair iteratively for 4 elements
  const leftHex = '0x' + typeHash.toString(16).padStart(64, '0');
  const rightHex = '0x' + idHash.toString(16).padStart(64, '0');
  let hash = BigInt(hash_pair(leftHex, rightHex));

  const geomHex = '0x' + input.geometryHash.toString(16).padStart(64, '0');
  const hashHex = '0x' + hash.toString(16).padStart(64, '0');
  hash = BigInt(hash_pair(hashHex, geomHex));

  const authHex = '0x' + BigInt(input.authority).toString(16).padStart(64, '0');
  const finalHashHex = '0x' + hash.toString(16).padStart(64, '0');
  hash = BigInt(hash_pair(finalHashHex, authHex));

  return hash;
}

/**
 * Hash a string to BN254 field element
 *
 * @param str - String to hash
 * @returns bigint hash value
 */
function hashString(str: string): bigint {
  const bytes = Buffer.from(str, 'utf-8');
  const chunks: bigint[] = [];

  // Split into 31-byte chunks (31 * 8 = 248 bits < 254-bit BN254 field)
  for (let i = 0; i < bytes.length; i += 31) {
    const chunk = bytes.slice(i, i + 31);
    chunks.push(BigInt('0x' + chunk.toString('hex')));
  }

  // Hash chunks with Poseidon
  if (chunks.length === 0) {
    const hashHex = hash_single('0x00');
    return BigInt(hashHex);
  } else if (chunks.length === 1) {
    const valueHex = '0x' + chunks[0].toString(16).padStart(64, '0');
    const hashHex = hash_single(valueHex);
    return BigInt(hashHex);
  } else {
    // Multiple chunks → iterative hashing
    let hash = chunks[0];
    for (let i = 1; i < chunks.length; i++) {
      const leftHex = '0x' + hash.toString(16).padStart(64, '0');
      const rightHex = '0x' + chunks[i].toString(16).padStart(64, '0');
      const hashHex = hash_pair(leftHex, rightHex);
      hash = BigInt(hashHex);
    }
    return hash;
  }
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
 * ARCHITECTURE:
 * - JSON format: {version, root, leaves[], metadata}
 * - IPFS pinning: Web3.Storage (free 5GB/month) or Pinata (free 1GB)
 * - On-chain reference: Store CID in smart contract
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
    version: '1.0.0',
    root: '0x' + tree.getRoot().toString(16),
    leaves: tree.getLeaves().map((leaf, index) => ({
      index,
      hash: '0x' + leaf.toString(16),
    })),
    metadata: {
      depth: 12,
      capacity: 4096,
      generatedAt: new Date().toISOString(),
      hashFunction: 'poseidon',
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
  const blob = new Blob([data], { type: 'application/json' });
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
  const blob = new Blob([data], { type: 'application/json' });
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
