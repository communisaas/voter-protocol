/**
 * Shadow Atlas Merkle Tree Builder Tests
 *
 * Validates Layer 5 implementation against specification requirements:
 * - Deterministic leaf ordering
 * - Binary tree construction
 * - Proof generation and verification
 * - Edge case handling
 */

import { describe, it, expect } from 'vitest';
import {
  keccak256,
  createDistrictId,
  createLeaf,
  buildMerkleTree,
  generateProof,
  verifyProof,
  type MerkleLeaf,
  type MerkleProof,
} from './merkle-tree-builder';
import type { GovernanceDistrict, QualityTier, DistrictType, GovernanceLevel, GeometryType } from '../schemas/governance-district';

/**
 * Create mock district for testing
 */
function createMockDistrict(
  layerUrl: string,
  options?: Partial<GovernanceDistrict>
): GovernanceDistrict {
  return {
    service_url: options?.service_url || 'https://example.com/FeatureServer',
    layer_number: options?.layer_number || 0,
    layer_url: layerUrl,
    layer_name: options?.layer_name || 'Test District',
    geometry_type: (options?.geometry_type as GeometryType) || 'esriGeometryPolygon',
    feature_count: options?.feature_count || 10,
    fields: options?.fields || ['OBJECTID', 'DISTRICT', 'NAME'],
    district_type: (options?.district_type as DistrictType) || 'city_council',
    tier: (options?.tier as QualityTier) || 'GOLD',
    governance_level: (options?.governance_level as GovernanceLevel) || 'municipal',
    elected: options?.elected ?? true,
    confidence: options?.confidence || 0.8,
    score: options?.score || 80,
    classification_reasons: options?.classification_reasons || ['Test classification'],
  };
}

describe('Keccak256 Hashing', () => {
  it('should produce 66-character hex string (0x + 64 hex)', () => {
    const hash = keccak256('test');
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('should be deterministic (same input → same output)', () => {
    const hash1 = keccak256('test');
    const hash2 = keccak256('test');
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different inputs', () => {
    const hash1 = keccak256('test1');
    const hash2 = keccak256('test2');
    expect(hash1).not.toBe(hash2);
  });

  it('should handle empty string', () => {
    const hash = keccak256('');
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('should handle unicode', () => {
    const hash = keccak256('北京市朝阳区');
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
  });
});

describe('District ID Creation', () => {
  it('should use layer_url as district_id', () => {
    const district = createMockDistrict('https://example.com/FeatureServer/1');
    const id = createDistrictId(district);
    expect(id).toBe('https://example.com/FeatureServer/1');
  });

  it('should be deterministic', () => {
    const district = createMockDistrict('https://example.com/FeatureServer/1');
    const id1 = createDistrictId(district);
    const id2 = createDistrictId(district);
    expect(id1).toBe(id2);
  });

  it('should produce unique IDs for different districts', () => {
    const district1 = createMockDistrict('https://example.com/FeatureServer/1');
    const district2 = createMockDistrict('https://example.com/FeatureServer/2');

    const id1 = createDistrictId(district1);
    const id2 = createDistrictId(district2);

    expect(id1).not.toBe(id2);
  });
});

describe('Merkle Leaf Creation', () => {
  it('should create valid leaf structure', () => {
    const district = createMockDistrict('https://example.com/FeatureServer/1');
    const leaf = createLeaf(district, 0);

    expect(leaf).toHaveProperty('index', 0);
    expect(leaf).toHaveProperty('district_id');
    expect(leaf).toHaveProperty('district_type');
    expect(leaf).toHaveProperty('name');
    expect(leaf).toHaveProperty('geometry_hash');
    expect(leaf).toHaveProperty('metadata_hash');
    expect(leaf).toHaveProperty('leaf_hash');
  });

  it('should produce valid hash format', () => {
    const district = createMockDistrict('https://example.com/FeatureServer/1');
    const leaf = createLeaf(district, 0);

    expect(leaf.leaf_hash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(leaf.geometry_hash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(leaf.metadata_hash).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('should be deterministic', () => {
    const district = createMockDistrict('https://example.com/FeatureServer/1');
    const leaf1 = createLeaf(district, 0);
    const leaf2 = createLeaf(district, 0);

    expect(leaf1.leaf_hash).toBe(leaf2.leaf_hash);
    expect(leaf1.geometry_hash).toBe(leaf2.geometry_hash);
    expect(leaf1.metadata_hash).toBe(leaf2.metadata_hash);
  });

  it('should produce different hashes for different districts', () => {
    const district1 = createMockDistrict('https://example.com/FeatureServer/1');
    const district2 = createMockDistrict('https://example.com/FeatureServer/2');

    const leaf1 = createLeaf(district1, 0);
    const leaf2 = createLeaf(district2, 1);

    expect(leaf1.leaf_hash).not.toBe(leaf2.leaf_hash);
  });
});

describe('Merkle Tree Construction', () => {
  it('should build tree with single leaf', () => {
    const district = createMockDistrict('https://example.com/FeatureServer/1');
    const leaves = [createLeaf(district, 0)];

    const tree = buildMerkleTree(leaves);

    expect(tree.root).toMatch(/^0x[a-f0-9]{64}$/);
    expect(tree.leafCount).toBe(1);
    expect(tree.depth).toBe(0);
  });

  it('should build tree with two leaves', () => {
    const district1 = createMockDistrict('https://example.com/FeatureServer/1');
    const district2 = createMockDistrict('https://example.com/FeatureServer/2');

    const leaves = [
      createLeaf(district1, 0),
      createLeaf(district2, 1),
    ];

    const tree = buildMerkleTree(leaves);

    expect(tree.root).toMatch(/^0x[a-f0-9]{64}$/);
    expect(tree.leafCount).toBe(2);
    expect(tree.depth).toBe(1);
    expect(tree.levels.length).toBe(2); // Leaf level + root level
  });

  it('should build tree with odd number of leaves (3)', () => {
    const districts = [
      createMockDistrict('https://example.com/FeatureServer/1'),
      createMockDistrict('https://example.com/FeatureServer/2'),
      createMockDistrict('https://example.com/FeatureServer/3'),
    ];

    const leaves = districts.map((d, i) => createLeaf(d, i));
    const tree = buildMerkleTree(leaves);

    expect(tree.root).toMatch(/^0x[a-f0-9]{64}$/);
    expect(tree.leafCount).toBe(3);
    expect(tree.depth).toBe(2); // 3 leaves → 2 parents → 1 root
  });

  it('should build tree with power-of-2 leaves (8)', () => {
    const districts = Array(8)
      .fill(null)
      .map((_, i) => createMockDistrict(`https://example.com/FeatureServer/${i}`));

    const leaves = districts.map((d, i) => createLeaf(d, i));
    const tree = buildMerkleTree(leaves);

    expect(tree.leafCount).toBe(8);
    expect(tree.depth).toBe(3); // log2(8) = 3
  });

  it('should throw on empty leaf array', () => {
    expect(() => {
      buildMerkleTree([]);
    }).toThrow('Cannot build tree from empty leaf set');
  });

  it('should be deterministic (same leaves → same root)', () => {
    const districts = [
      createMockDistrict('https://example.com/FeatureServer/1'),
      createMockDistrict('https://example.com/FeatureServer/2'),
    ];

    const leaves = districts.map((d, i) => createLeaf(d, i));

    const tree1 = buildMerkleTree(leaves);
    const tree2 = buildMerkleTree(leaves);

    expect(tree1.root).toBe(tree2.root);
  });

  it('should produce different roots for different leaf order', () => {
    const district1 = createMockDistrict('https://example.com/FeatureServer/1');
    const district2 = createMockDistrict('https://example.com/FeatureServer/2');

    const leavesAB = [createLeaf(district1, 0), createLeaf(district2, 1)];
    const leavesBA = [createLeaf(district2, 0), createLeaf(district1, 1)];

    const treeAB = buildMerkleTree(leavesAB);
    const treeBA = buildMerkleTree(leavesBA);

    expect(treeAB.root).not.toBe(treeBA.root);
  });
});

describe('Merkle Proof Generation', () => {
  it('should generate valid proof for single leaf', () => {
    const district = createMockDistrict('https://example.com/FeatureServer/1');
    const leaves = [createLeaf(district, 0)];
    const tree = buildMerkleTree(leaves);

    const proof = generateProof(tree, leaves, 0);

    expect(proof.district_id).toBe(district.layer_url);
    expect(proof.leaf_hash).toBe(leaves[0].leaf_hash);
    expect(proof.root).toBe(tree.root);
    expect(proof.proof).toHaveLength(0); // Single leaf has no siblings
    expect(proof.indices).toHaveLength(0);
  });

  it('should generate valid proof for two leaves (left)', () => {
    const districts = [
      createMockDistrict('https://example.com/FeatureServer/1'),
      createMockDistrict('https://example.com/FeatureServer/2'),
    ];
    const leaves = districts.map((d, i) => createLeaf(d, i));
    const tree = buildMerkleTree(leaves);

    const proof = generateProof(tree, leaves, 0);

    expect(proof.proof).toHaveLength(1); // One sibling to get to root
    expect(proof.indices).toEqual([0]); // Left child
  });

  it('should generate valid proof for two leaves (right)', () => {
    const districts = [
      createMockDistrict('https://example.com/FeatureServer/1'),
      createMockDistrict('https://example.com/FeatureServer/2'),
    ];
    const leaves = districts.map((d, i) => createLeaf(d, i));
    const tree = buildMerkleTree(leaves);

    const proof = generateProof(tree, leaves, 1);

    expect(proof.proof).toHaveLength(1); // One sibling to get to root
    expect(proof.indices).toEqual([1]); // Right child
  });

  it('should generate proofs of correct depth', () => {
    const districts = Array(8)
      .fill(null)
      .map((_, i) => createMockDistrict(`https://example.com/FeatureServer/${i}`));
    const leaves = districts.map((d, i) => createLeaf(d, i));
    const tree = buildMerkleTree(leaves);

    for (let i = 0; i < leaves.length; i++) {
      const proof = generateProof(tree, leaves, i);
      expect(proof.proof).toHaveLength(tree.depth);
      expect(proof.indices).toHaveLength(tree.depth);
    }
  });

  it('should throw on invalid leaf index', () => {
    const district = createMockDistrict('https://example.com/FeatureServer/1');
    const leaves = [createLeaf(district, 0)];
    const tree = buildMerkleTree(leaves);

    expect(() => {
      generateProof(tree, leaves, 1);
    }).toThrow('Invalid leaf index');

    expect(() => {
      generateProof(tree, leaves, -1);
    }).toThrow('Invalid leaf index');
  });
});

describe('Merkle Proof Verification', () => {
  it('should verify valid proof for single leaf', () => {
    const district = createMockDistrict('https://example.com/FeatureServer/1');
    const leaves = [createLeaf(district, 0)];
    const tree = buildMerkleTree(leaves);

    const proof = generateProof(tree, leaves, 0);
    const isValid = verifyProof(proof);

    expect(isValid).toBe(true);
  });

  it('should verify valid proof for two leaves', () => {
    const districts = [
      createMockDistrict('https://example.com/FeatureServer/1'),
      createMockDistrict('https://example.com/FeatureServer/2'),
    ];
    const leaves = districts.map((d, i) => createLeaf(d, i));
    const tree = buildMerkleTree(leaves);

    const proof0 = generateProof(tree, leaves, 0);
    const proof1 = generateProof(tree, leaves, 1);

    expect(verifyProof(proof0)).toBe(true);
    expect(verifyProof(proof1)).toBe(true);
  });

  it('should verify all proofs in 8-leaf tree', () => {
    const districts = Array(8)
      .fill(null)
      .map((_, i) => createMockDistrict(`https://example.com/FeatureServer/${i}`));
    const leaves = districts.map((d, i) => createLeaf(d, i));
    const tree = buildMerkleTree(leaves);

    for (let i = 0; i < leaves.length; i++) {
      const proof = generateProof(tree, leaves, i);
      expect(verifyProof(proof)).toBe(true);
    }
  });

  it('should reject proof with tampered leaf_hash', () => {
    const district = createMockDistrict('https://example.com/FeatureServer/1');
    const leaves = [createLeaf(district, 0)];
    const tree = buildMerkleTree(leaves);

    const proof = generateProof(tree, leaves, 0);
    const tamperedProof: MerkleProof = {
      ...proof,
      leaf_hash: keccak256('tampered'),
    };

    expect(verifyProof(tamperedProof)).toBe(false);
  });

  it('should reject proof with tampered sibling', () => {
    const districts = [
      createMockDistrict('https://example.com/FeatureServer/1'),
      createMockDistrict('https://example.com/FeatureServer/2'),
    ];
    const leaves = districts.map((d, i) => createLeaf(d, i));
    const tree = buildMerkleTree(leaves);

    const proof = generateProof(tree, leaves, 0);
    const tamperedProof: MerkleProof = {
      ...proof,
      proof: [keccak256('tampered')],
    };

    expect(verifyProof(tamperedProof)).toBe(false);
  });

  it('should reject proof with flipped path index', () => {
    const districts = [
      createMockDistrict('https://example.com/FeatureServer/1'),
      createMockDistrict('https://example.com/FeatureServer/2'),
    ];
    const leaves = districts.map((d, i) => createLeaf(d, i));
    const tree = buildMerkleTree(leaves);

    const proof = generateProof(tree, leaves, 0);
    const tamperedProof: MerkleProof = {
      ...proof,
      indices: [proof.indices[0] === 0 ? 1 : 0], // Flip bit
    };

    expect(verifyProof(tamperedProof)).toBe(false);
  });

  it('should reject proof with wrong root', () => {
    const districts = [
      createMockDistrict('https://example.com/FeatureServer/1'),
      createMockDistrict('https://example.com/FeatureServer/2'),
    ];
    const leaves = districts.map((d, i) => createLeaf(d, i));
    const tree = buildMerkleTree(leaves);

    const proof = generateProof(tree, leaves, 0);
    const tamperedProof: MerkleProof = {
      ...proof,
      root: keccak256('wrong_root'),
    };

    expect(verifyProof(tamperedProof)).toBe(false);
  });
});

describe('Edge Cases', () => {
  it('should handle large tree (1000 leaves)', () => {
    const districts = Array(1000)
      .fill(null)
      .map((_, i) => createMockDistrict(`https://example.com/FeatureServer/${i}`));
    const leaves = districts.map((d, i) => createLeaf(d, i));
    const tree = buildMerkleTree(leaves);

    expect(tree.leafCount).toBe(1000);
    expect(tree.depth).toBe(10); // log2(1024) = 10 (next power of 2)

    // Verify first and last proofs
    const proof0 = generateProof(tree, leaves, 0);
    const proof999 = generateProof(tree, leaves, 999);

    expect(verifyProof(proof0)).toBe(true);
    expect(verifyProof(proof999)).toBe(true);
  });

  it('should handle district with unicode name', () => {
    const district = createMockDistrict(
      'https://example.com/FeatureServer/1',
      { layer_name: '北京市朝阳区' }
    );
    const leaves = [createLeaf(district, 0)];
    const tree = buildMerkleTree(leaves);

    const proof = generateProof(tree, leaves, 0);
    expect(verifyProof(proof)).toBe(true);
  });

  it('should handle district with very long URL', () => {
    const longUrl = 'https://example.com/' + 'A'.repeat(500) + '/FeatureServer/1';
    const district = createMockDistrict(longUrl);
    const leaves = [createLeaf(district, 0)];
    const tree = buildMerkleTree(leaves);

    const proof = generateProof(tree, leaves, 0);
    expect(verifyProof(proof)).toBe(true);
  });

  it('should handle districts with identical metadata but different URLs', () => {
    const district1 = createMockDistrict(
      'https://example.com/FeatureServer/1',
      { layer_name: 'District' }
    );
    const district2 = createMockDistrict(
      'https://example.com/FeatureServer/2',
      { layer_name: 'District' }
    );

    const leaves = [createLeaf(district1, 0), createLeaf(district2, 1)];
    const tree = buildMerkleTree(leaves);

    // Different URLs should produce different leaf hashes
    expect(leaves[0].leaf_hash).not.toBe(leaves[1].leaf_hash);

    // Both proofs should verify
    const proof0 = generateProof(tree, leaves, 0);
    const proof1 = generateProof(tree, leaves, 1);

    expect(verifyProof(proof0)).toBe(true);
    expect(verifyProof(proof1)).toBe(true);
  });
});

describe('Production-Scale Tests', () => {
  it('should handle realistic US dataset size (4000 districts)', () => {
    const districts = Array(4000)
      .fill(null)
      .map((_, i) => createMockDistrict(`https://example.com/FeatureServer/${i}`));
    const leaves = districts.map((d, i) => createLeaf(d, i));

    const startTime = Date.now();
    const tree = buildMerkleTree(leaves);
    const constructionTime = Date.now() - startTime;

    expect(tree.leafCount).toBe(4000);
    expect(tree.depth).toBe(12); // log2(4096) = 12
    expect(constructionTime).toBeLessThan(5000); // Should build in < 5 seconds

    // Sample verify 100 random proofs
    const verifyStart = Date.now();
    for (let i = 0; i < 100; i++) {
      const randomIndex = Math.floor(Math.random() * leaves.length);
      const proof = generateProof(tree, leaves, randomIndex);
      expect(verifyProof(proof)).toBe(true);
    }
    const verifyTime = Date.now() - verifyStart;

    expect(verifyTime).toBeLessThan(1000); // 100 proofs in < 1 second
  });
});
