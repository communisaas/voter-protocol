/**
 * Multi-Layer Merkle Tree Builder
 *
 * Builds unified Merkle tree from multiple boundary sources (TIGER + municipal).
 *
 * ARCHITECTURE:
 * - Combines Congressional (435), State Legislative (~7,400), Counties (3,143), and City Council (~20k+)
 * - Total capacity: ~30,000+ boundaries in single tree
 * - Deterministic ordering: Sort by boundary type (alphabetical), then ID (lexicographic)
 * - Collision prevention: Boundary type included in leaf hash
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
  type BoundaryType,
  type MerkleLeafInput,
  AUTHORITY_LEVELS,
} from '../merkle-tree.js';
import { hash_pair } from '../../../circuits/pkg/index.js';

/**
 * Normalized boundary (TIGER or municipal source)
 */
export interface NormalizedBoundary {
  readonly id: string;                          // GEOID for TIGER, custom for municipal
  readonly name: string;                        // Human-readable name
  readonly geometry: Polygon | MultiPolygon;    // WGS84 GeoJSON geometry
  readonly boundaryType: BoundaryType;          // Boundary classification
  readonly authority: number;                   // Authority level (1-5)
  readonly jurisdiction?: string;               // Parent jurisdiction (e.g., "California, USA")
}

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
  readonly congressionalDistricts?: readonly NormalizedBoundary[];
  readonly stateLegislativeUpper?: readonly NormalizedBoundary[];
  readonly stateLegislativeLower?: readonly NormalizedBoundary[];
  readonly counties?: readonly NormalizedBoundary[];
  readonly cityCouncilDistricts?: readonly NormalizedBoundary[];
}

/**
 * Multi-Layer Merkle Tree Builder
 */
export class MultiLayerMerkleTreeBuilder {
  /**
   * Build unified Merkle tree from multiple boundary sources
   *
   * DETERMINISTIC: Same inputs → same Merkle root
   * - Sort by boundary type (alphabetical)
   * - Then sort by ID (lexicographic)
   * - Compute leaf hash for each boundary (includes type + ID + geometry + authority)
   * - Build binary tree bottom-up
   *
   * @param layers - Boundaries grouped by layer type
   * @returns Complete Merkle tree with all boundaries
   */
  buildTree(layers: BoundaryLayers): MultiLayerMerkleTree {
    console.log('[MultiLayerBuilder] Building unified Merkle tree...');

    // STEP 1: Flatten all boundaries with type annotation
    const allBoundaries = this.flattenBoundaries(layers);
    console.log(`  Total boundaries: ${allBoundaries.length}`);

    // STEP 2: Sort deterministically (type alphabetical, then ID lexicographic)
    const sorted = this.sortBoundaries(allBoundaries);

    // STEP 3: Compute leaf hashes (includes boundary type for collision prevention)
    const leaves = this.computeLeafHashes(sorted);

    // STEP 4: Build binary tree bottom-up
    const tree = this.buildTreeLayers(leaves.map(l => l.leafHash));

    // STEP 5: Extract root (single element at top)
    const root = tree[tree.length - 1][0];

    // STEP 6: Compute layer counts
    const layerCounts = this.computeLayerCounts(sorted);

    console.log(`  ✓ Merkle root: 0x${root.toString(16).slice(0, 16)}...`);
    console.log(`  ✓ Tree depth: ${tree.length}`);
    console.log(`  ✓ Leaf count: ${leaves.length}`);
    console.log(`  Layer counts:`, layerCounts);

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
        // No sibling (odd element) - use zero hash
        siblings.push(BigInt(0));
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
  verifyProof(proof: MultiLayerMerkleProof): boolean {
    let computedHash = proof.leaf;

    // Reconstruct path from leaf to root
    for (let i = 0; i < proof.siblings.length; i++) {
      const sibling = proof.siblings[i];
      const isLeftChild = proof.pathIndices[i] === 0;

      // Hash pair (order matters: left always before right)
      if (isLeftChild) {
        computedHash = this.hashPair(computedHash, sibling);
      } else {
        computedHash = this.hashPair(sibling, computedHash);
      }
    }

    return computedHash === proof.root;
  }

  /**
   * Flatten boundaries from layers into single array
   */
  private flattenBoundaries(layers: BoundaryLayers): NormalizedBoundary[] {
    const all: NormalizedBoundary[] = [];

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

    return all;
  }

  /**
   * Sort boundaries deterministically
   *
   * Order: Boundary type (alphabetical), then ID (lexicographic)
   */
  private sortBoundaries(
    boundaries: readonly NormalizedBoundary[]
  ): NormalizedBoundary[] {
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
   * Compute leaf hashes for all boundaries
   */
  private computeLeafHashes(
    boundaries: readonly NormalizedBoundary[]
  ): MerkleLeafWithMetadata[] {
    return boundaries.map((boundary, index) => {
      // Hash geometry (simplified for now - could use full Poseidon of coordinates)
      const geometryString = JSON.stringify(boundary.geometry);
      const geometryHash = this.hashGeometry(geometryString);

      // Compute leaf hash (includes type + ID + geometry + authority)
      const leafInput: MerkleLeafInput = {
        id: boundary.id,
        boundaryType: boundary.boundaryType,
        geometryHash,
        authority: boundary.authority,
      };

      const leafHash = computeLeafHash(leafInput);

      return {
        leafHash,
        boundaryId: boundary.id,
        boundaryType: boundary.boundaryType,
        boundaryName: boundary.name,
        index,
      };
    });
  }

  /**
   * Build Merkle tree layers bottom-up
   */
  private buildTreeLayers(leaves: readonly bigint[]): bigint[][] {
    if (leaves.length === 0) {
      throw new Error('Cannot build Merkle tree: no leaves');
    }

    const tree: bigint[][] = [Array.from(leaves)];
    let currentLayer = Array.from(leaves);

    // Build layers until we reach single root
    while (currentLayer.length > 1) {
      const nextLayer: bigint[] = [];

      // Pair up elements and hash
      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];

        if (i + 1 < currentLayer.length) {
          // Pair exists
          const right = currentLayer[i + 1];
          const parent = this.hashPair(left, right);
          nextLayer.push(parent);
        } else {
          // Odd element (no pair) - promote to next level
          nextLayer.push(left);
        }
      }

      tree.push(nextLayer);
      currentLayer = nextLayer;
    }

    return tree;
  }

  /**
   * Hash two child hashes using Poseidon
   */
  private hashPair(left: bigint, right: bigint): bigint {
    const leftHex = '0x' + left.toString(16).padStart(64, '0');
    const rightHex = '0x' + right.toString(16).padStart(64, '0');
    const hashHex = hash_pair(leftHex, rightHex);
    return BigInt(hashHex);
  }

  /**
   * Hash geometry string to bigint
   */
  private hashGeometry(geometryString: string): bigint {
    // Simple hash for now (could use full Poseidon of coordinate array)
    const bytes = Buffer.from(geometryString, 'utf-8');
    let hash = BigInt(0);

    // XOR chunks (simple but deterministic)
    for (let i = 0; i < bytes.length; i += 31) {
      const chunk = bytes.slice(i, i + 31);
      const chunkBigInt = BigInt('0x' + chunk.toString('hex'));
      hash ^= chunkBigInt;
    }

    return hash;
  }

  /**
   * Compute layer counts for statistics
   */
  private computeLayerCounts(
    boundaries: readonly NormalizedBoundary[]
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
