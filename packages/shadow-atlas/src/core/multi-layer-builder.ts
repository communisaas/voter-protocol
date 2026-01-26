/**
 * Multi-Layer Merkle Tree Builder - PARALLELIZED IMPLEMENTATION
 *
 * Builds unified Merkle tree from multiple boundary sources (TIGER + municipal).
 *
 * ARCHITECTURE:
 * - Combines Congressional (435), State Legislative (~7,400), Counties (3,143), and City Council (~20k+)
 * - Total capacity: ~30,000+ boundaries in single tree
 * - Deterministic ordering: Sort by boundary type (alphabetical), then ID (lexicographic)
 * - Collision prevention: Boundary type included in leaf hash
 *
 * PERFORMANCE OPTIMIZATION (730k+ boundaries):
 * - **Sequential bottleneck eliminated**: Previous implementation used sequential loops with blocking await
 * - **Geometry hashing**: Batched in parallel (64 concurrent operations per batch)
 * - **Leaf hashing**: Batched Poseidon computation via computeLeafHashesBatch()
 * - **Tree building**: Batched pair hashing per level via hashPairsBatch()
 * - **Speedup**: ~64x theoretical parallelism (actual depends on CPU cores)
 * - **Memory**: Configurable batch size prevents memory pressure
 *
 * DETERMINISM GUARANTEE:
 * - Same boundaries → same geometry hashes → same leaf hashes → same tree structure → SAME ROOT
 * - Parallelization does NOT change output, only execution order
 * - All operations use deterministic maps (preserve input ordering)
 * - Tests verify: parallel root === sequential root
 *
 * SECURITY CRITICAL:
 * - Uses Poseidon hash from circuit WASM (TypeScript → Rust → Circuit alignment)
 * - Leaf hash includes [boundaryType, id, geometryHash, authority]
 * - Same boundary → same leaf hash → same Merkle root (determinism)
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Polygon, MultiPolygon } from 'geojson';
import {
  computeLeafHash,
  computeLeafHashesBatch,
  type BoundaryType,
  type MerkleLeafInput,
} from '../merkle-tree.js';
import { getHasher } from '@voter-protocol/crypto/poseidon2';
import { sha256 } from '@noble/hashes/sha256';
import { logger } from './utils/logger.js';
import { hashPair } from './utils/poseidon-utils.js';

/**
 * Provenance source metadata for cryptographic commitment
 *
 * Re-exported from merkle-tree.ts for convenience. Used to track data lineage
 * from source URL through to Merkle leaf hash.
 */
export type { ProvenanceSource } from '../merkle-tree.js';
import type { ProvenanceSource } from '../merkle-tree.js';

/**
 * Specialized normalized boundary for Merkle tree construction
 *
 * This interface is specifically tailored for Merkle tree leaf computation,
 * including additional fields (boundaryType, authority) not present in the
 * canonical NormalizedBoundary from core/types.ts.
 *
 * Use this type for Merkle tree operations; use core/types.ts NormalizedBoundary
 * for general boundary data provider transformations.
 */
export interface MerkleBoundaryInput {
  readonly id: string;                          // GEOID for TIGER, custom for municipal
  readonly name: string;                        // Human-readable name
  readonly geometry: Polygon | MultiPolygon;    // WGS84 GeoJSON geometry
  readonly boundaryType: BoundaryType;          // Boundary classification
  readonly authority: number;                   // Authority level (1-5)
  readonly jurisdiction?: string;               // Parent jurisdiction (e.g., "California, USA")
  /**
   * Optional provenance source for cryptographic commitment
   *
   * When provided, this metadata is hashed into the Merkle leaf, creating a
   * verifiable commitment to data lineage. Enables cryptographic proof that
   * a specific boundary was derived from a specific source file.
   *
   * SECURITY: Provenance hash is combined with authority level in the leaf hash.
   * This ensures both the authority AND the source data are cryptographically committed.
   */
  readonly source?: ProvenanceSource;
}

/**
 * @deprecated Use MerkleBoundaryInput instead. This alias exists for backward compatibility.
 * Will be removed in the next major version.
 */
export type NormalizedBoundary = MerkleBoundaryInput;

/**
 * Multi-layer Merkle tree
 */
export interface MultiLayerMerkleTree {
  readonly root: bigint;                                    // Merkle root
  readonly leaves: readonly MerkleLeafWithMetadata[];       // All leaves with metadata
  readonly tree: readonly (readonly bigint[])[];            // Tree layers [leaves, ..., root]
  readonly boundaryCount: number;                           // Total boundaries
  readonly layerCounts: Record<BoundaryType, number>;       // Counts per layer
}

/**
 * Merkle leaf with metadata
 */
export interface MerkleLeafWithMetadata {
  readonly leafHash: bigint;                    // Poseidon hash of leaf
  readonly boundaryId: string;                  // Boundary ID
  readonly boundaryType: BoundaryType;          // Boundary type
  readonly boundaryName: string;                // Human-readable name
  readonly index: number;                       // Leaf index in tree
}

/**
 * Merkle proof for boundary verification
 */
export interface MultiLayerMerkleProof {
  readonly root: bigint;                        // Merkle root
  readonly leaf: bigint;                        // Leaf hash
  readonly siblings: readonly bigint[];         // Sibling hashes (leaf → root)
  readonly pathIndices: readonly number[];      // Path indices (0 = left, 1 = right)
  readonly boundaryId: string;                  // Boundary ID
  readonly boundaryType: BoundaryType;          // Boundary type
}

/**
 * Boundary layers for tree construction
 */
export interface BoundaryLayers {
  readonly congressionalDistricts?: readonly MerkleBoundaryInput[];
  readonly stateLegislativeUpper?: readonly MerkleBoundaryInput[];
  readonly stateLegislativeLower?: readonly MerkleBoundaryInput[];
  readonly counties?: readonly MerkleBoundaryInput[];
  readonly cityCouncilDistricts?: readonly MerkleBoundaryInput[];
  // School districts (K-12 education governance)
  readonly unifiedSchoolDistricts?: readonly MerkleBoundaryInput[];
  readonly elementarySchoolDistricts?: readonly MerkleBoundaryInput[];
  readonly secondarySchoolDistricts?: readonly MerkleBoundaryInput[];
  // Voting precincts (VTDs - Voting Tabulation Districts)
  readonly votingPrecincts?: readonly MerkleBoundaryInput[];
}

/**
 * Configuration for multi-layer tree construction
 */
export interface MultiLayerConfig {
  /** Batch size for parallel leaf hashing (default: 64) */
  readonly batchSize?: number;
  /** Max concurrent operations for memory-constrained environments */
  readonly maxConcurrency?: number;
}

/**
 * Multi-Layer Merkle Tree Builder
 */
export class MultiLayerMerkleTreeBuilder {
  private readonly config: Required<MultiLayerConfig>;

  constructor(config: MultiLayerConfig = {}) {
    this.config = {
      batchSize: config.batchSize ?? 64,
      maxConcurrency: config.maxConcurrency ?? 64,
    };
  }

  /**
   * Build unified Merkle tree from multiple boundary sources
   *
   * DETERMINISTIC: Same inputs → same Merkle root
   * - Sort by boundary type (alphabetical)
   * - Then sort by ID (lexicographic)
   * - Compute leaf hash for each boundary (includes type + ID + geometry + authority)
   * - Build binary tree bottom-up
   *
   * PERFORMANCE: Parallel batching for 730k+ boundaries
   * - Geometry hashing: Batched string hashing
   * - Leaf hashing: Batched Poseidon computation
   * - Tree building: Batched pair hashing per level
   *
   * @param layers - Boundaries grouped by layer type
   * @returns Complete Merkle tree with all boundaries
   */
  async buildTree(layers: BoundaryLayers): Promise<MultiLayerMerkleTree> {
    logger.info('Building unified Merkle tree');

    // STEP 1: Flatten all boundaries with type annotation
    const allBoundaries = this.flattenBoundaries(layers);
    logger.info('Boundaries flattened', { count: allBoundaries.length });

    // STEP 2: Sort deterministically (type alphabetical, then ID lexicographic)
    const sorted = this.sortBoundaries(allBoundaries);

    // STEP 3: Compute leaf hashes (includes boundary type for collision prevention)
    const leaves = await this.computeLeafHashes(sorted);

    // STEP 4: Build binary tree bottom-up
    const tree = await this.buildTreeLayers(leaves.map(l => l.leafHash));

    // STEP 5: Extract root (single element at top)
    const root = tree[tree.length - 1][0];

    // STEP 6: Compute layer counts
    const layerCounts = this.computeLayerCounts(sorted);

    logger.info('Merkle tree built successfully', {
      root: `0x${root.toString(16).slice(0, 16)}...`,
      depth: tree.length,
      leafCount: leaves.length,
      layerCounts,
    });

    return {
      root,
      leaves,
      tree,
      boundaryCount: allBoundaries.length,
      layerCounts,
    };
  }

  /**
   * Generate Merkle proof for specific boundary
   *
   * @param tree - Multi-layer Merkle tree
   * @param boundaryId - Boundary ID to prove
   * @param boundaryType - Boundary type
   * @returns Merkle proof (leaf, siblings, path)
   * @throws Error if boundary not found
   */
  generateProof(
    tree: MultiLayerMerkleTree,
    boundaryId: string,
    boundaryType: BoundaryType
  ): MultiLayerMerkleProof {
    // Find leaf index by ID + type
    const leafIndex = tree.leaves.findIndex(
      l => l.boundaryId === boundaryId && l.boundaryType === boundaryType
    );

    if (leafIndex === -1) {
      throw new Error(
        `Boundary not found in tree: ${boundaryType}/${boundaryId}`
      );
    }

    const leaf = tree.leaves[leafIndex];
    const siblings: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = leafIndex;

    // Walk up tree from leaf to root, collecting siblings
    for (let level = 0; level < tree.tree.length - 1; level++) {
      const isLeftChild = currentIndex % 2 === 0;
      const siblingIndex = isLeftChild ? currentIndex + 1 : currentIndex - 1;

      // Check if sibling exists (odd-length layers may not have right sibling)
      if (siblingIndex < tree.tree[level].length) {
        siblings.push(tree.tree[level][siblingIndex]);
      } else {
        // No sibling (odd element) - use itself as sibling
        // SECURITY: This matches buildTreeLayers behavior of hash(element, element)
        siblings.push(tree.tree[level][currentIndex]);
      }

      pathIndices.push(isLeftChild ? 0 : 1);

      // Move to parent index
      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      root: tree.root,
      leaf: leaf.leafHash,
      siblings,
      pathIndices,
      boundaryId,
      boundaryType,
    };
  }

  /**
   * Verify Merkle proof against root
   *
   * @param proof - Merkle proof to verify
   * @returns true if proof is valid
   */
  async verifyProof(proof: MultiLayerMerkleProof): Promise<boolean> {
    let computedHash = proof.leaf;

    // Reconstruct path from leaf to root
    for (let i = 0; i < proof.siblings.length; i++) {
      const sibling = proof.siblings[i];
      const isLeftChild = proof.pathIndices[i] === 0;

      // Hash pair (order matters: left always before right)
      if (isLeftChild) {
        computedHash = await hashPair(computedHash, sibling);
      } else {
        computedHash = await hashPair(sibling, computedHash);
      }
    }

    return computedHash === proof.root;
  }

  /**
   * Flatten boundaries from layers into single array
   */
  private flattenBoundaries(layers: BoundaryLayers): MerkleBoundaryInput[] {
    const all: MerkleBoundaryInput[] = [];

    if (layers.congressionalDistricts) {
      all.push(...layers.congressionalDistricts);
    }

    if (layers.stateLegislativeUpper) {
      all.push(...layers.stateLegislativeUpper);
    }

    if (layers.stateLegislativeLower) {
      all.push(...layers.stateLegislativeLower);
    }

    if (layers.counties) {
      all.push(...layers.counties);
    }

    if (layers.cityCouncilDistricts) {
      all.push(...layers.cityCouncilDistricts);
    }

    // School districts
    if (layers.unifiedSchoolDistricts) {
      all.push(...layers.unifiedSchoolDistricts);
    }

    if (layers.elementarySchoolDistricts) {
      all.push(...layers.elementarySchoolDistricts);
    }

    if (layers.secondarySchoolDistricts) {
      all.push(...layers.secondarySchoolDistricts);
    }

    // Voting precincts (VTDs)
    if (layers.votingPrecincts) {
      all.push(...layers.votingPrecincts);
    }

    return all;
  }

  /**
   * Sort boundaries deterministically
   *
   * Order: Boundary type (alphabetical), then ID (lexicographic)
   */
  private sortBoundaries(
    boundaries: readonly MerkleBoundaryInput[]
  ): MerkleBoundaryInput[] {
    return [...boundaries].sort((a, b) => {
      // Primary sort: Boundary type (alphabetical)
      if (a.boundaryType !== b.boundaryType) {
        return a.boundaryType.localeCompare(b.boundaryType);
      }

      // Secondary sort: ID (lexicographic)
      return a.id.localeCompare(b.id);
    });
  }

  /**
   * Compute leaf hashes for all boundaries (PARALLELIZED)
   *
   * PERFORMANCE OPTIMIZATION:
   * - Step 1: Batch hash all geometry strings in parallel
   * - Step 2: Batch compute all leaf hashes in parallel
   * - Previous: Sequential O(n) iterations with await in loop
   * - Current: Batched O(n/batchSize) with Promise.all per batch
   *
   * For 730k boundaries:
   * - Sequential: ~730k iterations with blocking await
   * - Parallel (batch=64): ~11,400 batches of 64 concurrent operations
   *
   * @param boundaries - Sorted boundaries to hash
   * @returns Array of leaf hashes with metadata
   */
  private async computeLeafHashes(
    boundaries: readonly MerkleBoundaryInput[]
  ): Promise<MerkleLeafWithMetadata[]> {
    const startGeometry = Date.now();

    // STEP 1: Batch hash all geometries in parallel
    const geometryStrings = boundaries.map(b => JSON.stringify(b.geometry));
    const geometryHashes = await this.hashGeometriesBatch(
      geometryStrings,
      this.config.batchSize
    );

    const geometryDuration = Date.now() - startGeometry;
    logger.debug('Geometry hashing completed', {
      operation: 'geometry_hashing',
      boundaryCount: boundaries.length,
      batchSize: this.config.batchSize,
      durationMs: geometryDuration,
      parallelMode: true,
    });

    const startLeaf = Date.now();

    // STEP 2: Prepare all leaf inputs (including provenance if available)
    const leafInputs: MerkleLeafInput[] = boundaries.map((boundary, index) => ({
      id: boundary.id,
      boundaryType: boundary.boundaryType,
      geometryHash: geometryHashes[index],
      authority: boundary.authority,
      // Pass through provenance source if available
      // This creates a cryptographic commitment to data lineage in the leaf hash
      source: boundary.source,
    }));

    // STEP 3: Batch compute all leaf hashes in parallel
    const leafHashes = await computeLeafHashesBatch(
      leafInputs,
      this.config.batchSize
    );

    const leafDuration = Date.now() - startLeaf;
    logger.debug('Leaf hashing completed', {
      operation: 'leaf_hashing',
      leafCount: leafInputs.length,
      batchSize: this.config.batchSize,
      durationMs: leafDuration,
      parallelMode: true,
    });

    // STEP 4: Build metadata array
    const results: MerkleLeafWithMetadata[] = boundaries.map((boundary, index) => ({
      leafHash: leafHashes[index],
      boundaryId: boundary.id,
      boundaryType: boundary.boundaryType,
      boundaryName: boundary.name,
      index,
    }));

    return results;
  }

  /**
   * Batch hash multiple geometry strings in parallel
   *
   * Uses simple XOR-based hashing (deterministic, fast).
   * For cryptographic security, geometry is included in leaf hash
   * which uses Poseidon2.
   *
   * @param geometryStrings - Array of JSON.stringify'd geometries
   * @param batchSize - Max concurrent operations
   * @returns Array of geometry hashes (bigint)
   */
  private async hashGeometriesBatch(
    geometryStrings: readonly string[],
    batchSize: number
  ): Promise<bigint[]> {
    const results: bigint[] = new Array(geometryStrings.length);

    for (let i = 0; i < geometryStrings.length; i += batchSize) {
      const batch = geometryStrings.slice(i, Math.min(i + batchSize, geometryStrings.length));

      const batchResults = await Promise.all(
        batch.map(geometryString => Promise.resolve(this.hashGeometry(geometryString)))
      );

      for (let j = 0; j < batchResults.length; j++) {
        results[i + j] = batchResults[j];
      }
    }

    return results;
  }

  /**
   * Build Merkle tree layers bottom-up (PARALLELIZED)
   *
   * PERFORMANCE OPTIMIZATION:
   * - Collect all pairs for level, hash in parallel batches
   * - Previous: Sequential loop with await per pair
   * - Current: Batch all pairs per level with Promise.all
   *
   * For 730k leaves:
   * - Level 0: 365k pairs hashed in parallel batches
   * - Level 1: 182k pairs hashed in parallel batches
   * - ... etc
   *
   * @param leaves - Leaf hashes to build tree from
   * @returns Complete tree layers [leaves, ..., root]
   */
  private async buildTreeLayers(leaves: readonly bigint[]): Promise<bigint[][]> {
    if (leaves.length === 0) {
      throw new Error('Cannot build Merkle tree: no leaves');
    }

    const hasher = await getHasher();
    const tree: bigint[][] = [Array.from(leaves)];
    let currentLayer = Array.from(leaves);

    const startTree = Date.now();
    const initialLeafCount = leaves.length;

    // Build layers until we reach single root
    while (currentLayer.length > 1) {
      // Collect all pairs for this level
      const pairs: Array<readonly [bigint, bigint]> = [];

      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];

        if (i + 1 < currentLayer.length) {
          // Pair exists
          const right = currentLayer[i + 1];
          pairs.push([left, right] as const);
        }
        // Odd elements will be handled after batch hashing
      }

      // Batch hash all pairs in parallel
      const nextLayer = await hasher.hashPairsBatch(pairs, this.config.batchSize);

      // Handle odd element (no pair) - hash with itself for consistent verification
      // SECURITY: This matches global-merkle-tree.ts behavior where odd elements use hash(x, x)
      if (currentLayer.length % 2 === 1) {
        const oddElement = currentLayer[currentLayer.length - 1];
        const selfHash = await hashPair(oddElement, oddElement);
        nextLayer.push(selfHash);
      }

      tree.push(nextLayer);
      currentLayer = nextLayer;
    }

    const treeDuration = Date.now() - startTree;
    logger.debug('Tree construction completed', {
      operation: 'tree_construction',
      initialLeaves: initialLeafCount,
      treeDepth: tree.length,
      batchSize: this.config.batchSize,
      durationMs: treeDuration,
      parallelMode: true,
    });

    return tree;
  }

  /**
   * Hash geometry string to bigint using SHA-256
   *
   * SECURITY: Replaces XOR-based hash (WS-5) for collision resistance.
   * SHA-256 provides cryptographic collision resistance unlike XOR (commutative, trivial collisions).
   *
   * @param geometryString - Serialized geometry (GeoJSON)
   * @returns SHA-256 hash truncated to 31 bytes (248 bits) for field element compatibility
   */
  private hashGeometry(geometryString: string): bigint {
    const bytes = new TextEncoder().encode(geometryString);
    const hash = sha256(bytes);
    // Take first 31 bytes to fit in field element (248 bits < BN254 scalar field ~254 bits)
    // This prevents overflow when used in Poseidon hash operations
    return BigInt('0x' + Buffer.from(hash.slice(0, 31)).toString('hex'));
  }

  /**
   * Compute layer counts for statistics
   */
  private computeLayerCounts(
    boundaries: readonly MerkleBoundaryInput[]
  ): Record<BoundaryType, number> {
    const counts: Partial<Record<BoundaryType, number>> = {};

    for (const boundary of boundaries) {
      counts[boundary.boundaryType] =
        (counts[boundary.boundaryType] ?? 0) + 1;
    }

    return counts as Record<BoundaryType, number>;
  }

  /**
   * Export tree to JSON (for IPFS publication)
   */
  exportToJSON(tree: MultiLayerMerkleTree): string {
    return JSON.stringify(
      {
        version: '2.0.0',
        root: '0x' + tree.root.toString(16),
        boundaryCount: tree.boundaryCount,
        layerCounts: tree.layerCounts,
        leaves: tree.leaves.map(l => ({
          id: l.boundaryId,
          type: l.boundaryType,
          name: l.boundaryName,
          hash: '0x' + l.leafHash.toString(16),
          index: l.index,
        })),
        metadata: {
          generatedAt: new Date().toISOString(),
          tigerVersion: '2024',
        },
      },
      null,
      2
    );
  }
}
