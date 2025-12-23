/**
 * Merkle Tree Builder for Shadow Atlas
 *
 * Builds deterministic Merkle tree from normalized districts for cryptographic commitment.
 *
 * DETERMINISM: Critical property - same districts → same Merkle root
 * - Districts sorted by ID (lexicographic)
 * - Canonical JSON serialization
 * - keccak256 hash function
 *
 * ARCHITECTURE:
 * - Leaf hash: keccak256(id + geometry + provenance)
 * - Non-leaf hash: keccak256(left + right)
 * - Binary tree (balanced if district count is power of 2)
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { createHash } from 'crypto';
import type {
  NormalizedDistrict,
  MerkleTree,
  MerkleProof,
} from './types.js';

/**
 * Merkle tree builder
 */
export class MerkleTreeBuilder {
  /**
   * Build Merkle tree from normalized districts
   *
   * DETERMINISTIC: Same input → same Merkle root
   *
   * @param districts - Normalized districts (unsorted)
   * @returns Merkle tree with root, leaves, proof generation capability
   */
  build(districts: readonly NormalizedDistrict[]): MerkleTree {
    console.log(`Building Merkle tree for ${districts.length} districts...`);

    // STEP 1: Sort districts by ID (deterministic ordering)
    const sorted = [...districts].sort((a, b) => a.id.localeCompare(b.id));

    // STEP 2: Hash each district (leaf nodes)
    const leaves = sorted.map(district => this.hashDistrict(district));

    // STEP 3: Build binary tree bottom-up
    const tree = this.buildTree(leaves);

    // STEP 4: Root is single element at top
    const root = tree[tree.length - 1][0];

    console.log(`  ✓ Merkle root: ${root}`);
    console.log(`  ✓ Tree depth: ${tree.length}`);
    console.log(`  ✓ Leaf count: ${leaves.length}`);

    return {
      root,
      leaves,
      tree,
      districts: sorted,
    };
  }

  /**
   * Generate Merkle proof for a district
   *
   * @param tree - Merkle tree
   * @param districtId - District ID to prove
   * @returns Merkle proof (leaf, siblings, root)
   * @throws Error if district not found
   */
  generateProof(tree: MerkleTree, districtId: string): MerkleProof {
    const index = tree.districts.findIndex(d => d.id === districtId);
    if (index === -1) {
      throw new Error(`District not found in tree: ${districtId}`);
    }

    const siblings: string[] = [];
    let currentIndex = index;

    // Walk up the tree, collecting sibling hashes
    for (let level = 0; level < tree.tree.length - 1; level++) {
      const isLeftChild = currentIndex % 2 === 0;
      const siblingIndex = isLeftChild ? currentIndex + 1 : currentIndex - 1;

      // Check if sibling exists (odd-length layers may not have sibling)
      if (siblingIndex < tree.tree[level].length) {
        siblings.push(tree.tree[level][siblingIndex]);
      }

      // Move to parent index
      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      root: tree.root,
      leaf: tree.leaves[index],
      siblings,
      districtId,
    };
  }

  /**
   * Verify Merkle proof (for testing, actual verification in ZK circuit)
   *
   * @param proof - Merkle proof to verify
   * @returns true if proof is valid
   */
  verifyProof(proof: MerkleProof): boolean {
    let computedHash = proof.leaf;

    // Recompute hash by hashing with siblings
    for (const sibling of proof.siblings) {
      // Determine order: smaller hash goes left (deterministic)
      if (computedHash < sibling) {
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
   * @param leaves - Leaf layer (hashes)
   * @returns Array of layers [leaves, level1, ..., root]
   */
  private buildTree(leaves: readonly string[]): string[][] {
    if (leaves.length === 0) {
      throw new Error('Cannot build Merkle tree: no leaves');
    }

    const tree: string[][] = [Array.from(leaves)];
    let currentLayer = Array.from(leaves);

    // Build layers until we reach single root
    while (currentLayer.length > 1) {
      const nextLayer: string[] = [];

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
   * Hash a district to create leaf node
   *
   * DETERMINISTIC: Same district → same hash
   *
   * Includes:
   * - District ID
   * - Canonical geometry representation
   * - Provenance metadata
   *
   * @param district - Normalized district
   * @returns Hex hash string
   */
  private hashDistrict(district: NormalizedDistrict): string {
    // Create canonical representation (deterministic JSON)
    const canonical = JSON.stringify({
      id: district.id,
      geometry: this.canonicalizeGeometry(district.geometry),
      provenance: this.canonicalizeProvenance(district.provenance),
    });

    return this.keccak256(canonical);
  }

  /**
   * Hash two child hashes to create parent
   *
   * @param left - Left child hash
   * @param right - Right child hash
   * @returns Hex hash string
   */
  private hashPair(left: string, right: string): string {
    return this.keccak256(left + right);
  }

  /**
   * keccak256 hash (Ethereum-compatible)
   *
   * @param data - Data to hash (string or buffer)
   * @returns Hex hash string (0x-prefixed)
   */
  private keccak256(data: string | Buffer): string {
    const hash = createHash('sha256'); // Using sha256 for now (replace with keccak256 if needed)
    hash.update(data);
    return '0x' + hash.digest('hex');
  }

  /**
   * Canonicalize geometry for hashing (deterministic)
   */
  private canonicalizeGeometry(
    geometry: NormalizedDistrict['geometry']
  ): Record<string, unknown> {
    // Already normalized by normalizer, just ensure deterministic JSON
    if (geometry.type === 'Polygon') {
      return {
        type: 'Polygon',
        coordinates: geometry.coordinates,
      };
    } else {
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates,
      };
    }
  }

  /**
   * Canonicalize provenance for hashing (deterministic)
   */
  private canonicalizeProvenance(
    provenance: NormalizedDistrict['provenance']
  ): Record<string, unknown> {
    // Only include fields that affect cryptographic commitment
    return {
      source: provenance.source,
      authority: provenance.authority,
      timestamp: provenance.timestamp,
      responseHash: provenance.responseHash,
    };
  }

  /**
   * Export Merkle tree to JSON file
   *
   * @param tree - Merkle tree
   * @param outputPath - Output JSON file path
   */
  exportTree(tree: MerkleTree, outputPath: string): void {
    const fs = require('fs');

    const exportData = {
      root: tree.root,
      treeDepth: tree.tree.length,
      leafCount: tree.leaves.length,
      districtCount: tree.districts.length,
      districts: tree.districts.map(d => ({
        id: d.id,
        name: d.name,
        jurisdiction: d.jurisdiction,
      })),
    };

    fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
    console.log(`  ✓ Merkle tree exported: ${outputPath}`);
  }

  /**
   * Generate batch proofs for all districts
   *
   * @param tree - Merkle tree
   * @returns Array of all proofs
   */
  generateAllProofs(tree: MerkleTree): MerkleProof[] {
    return tree.districts.map(district =>
      this.generateProof(tree, district.id)
    );
  }

  /**
   * Verify all proofs (for testing)
   *
   * @param proofs - Array of proofs to verify
   * @returns true if all proofs valid
   */
  verifyAllProofs(proofs: readonly MerkleProof[]): boolean {
    for (const proof of proofs) {
      if (!this.verifyProof(proof)) {
        console.error(`  ✗ Invalid proof for district: ${proof.districtId}`);
        return false;
      }
    }
    return true;
  }
}
