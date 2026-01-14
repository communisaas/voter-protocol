/**
 * Proof Template Generation Tests
 *
 * Tests for server-side proof template generation during Atlas build.
 * Proof templates contain Merkle proofs (siblings + path indices) that
 * clients complete with their user secret for nullifier computation.
 *
 * SECURITY CRITICAL: Proof templates enable trustless verification.
 * Invalid templates brick the entire ZK proof flow.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, rm } from 'fs/promises';
import { randomUUID } from 'crypto';
import { SnapshotManager } from '../../../distribution/snapshots/snapshot-manager.js';
import {
  MultiLayerMerkleTreeBuilder,
  type MultiLayerMerkleTree,
  type MerkleBoundaryInput,
  type BoundaryLayers,
} from '../../../core/multi-layer-builder.js';
import type {
  ProofTemplate,
  ProofTemplateStore,
} from '../../../core/types/atlas.js';
import { BoundaryType } from '../../../core/types/boundary.js';

/**
 * Test fixture: Create mock boundary input
 */
function createMockBoundary(
  id: string,
  name: string,
  boundaryType: BoundaryType = BoundaryType.CONGRESSIONAL_DISTRICT,
  authority: number = 5
): MerkleBoundaryInput {
  return {
    id,
    name,
    geometry: {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-122.4, 37.8],
          [-122.3, 37.8],
          [-122.3, 37.7],
          [-122.4, 37.7],
          [-122.4, 37.8],
        ],
      ],
    },
    boundaryType,
    authority,
  };
}

/**
 * Generate proof template from MultiLayerMerkleProof
 * This simulates what ShadowAtlasService.generateBatchProofs does
 */
function generateProofTemplate(
  merkleProof: {
    root: bigint;
    leaf: bigint;
    siblings: readonly bigint[];
    pathIndices: readonly number[];
    boundaryId: string;
    boundaryType: BoundaryType;
  },
  authority: number,
  leafIndex: number
): ProofTemplate {
  return {
    districtId: merkleProof.boundaryId,
    merkleRoot: `0x${merkleProof.root.toString(16)}`,
    siblings: merkleProof.siblings.map((s) => `0x${s.toString(16)}`),
    pathIndices: [...merkleProof.pathIndices],
    leafHash: `0x${merkleProof.leaf.toString(16)}`,
    boundaryType: merkleProof.boundaryType,
    authority,
    leafIndex,
  };
}

describe('ProofTemplate - Type Validation', () => {
  it('should have correct structure', () => {
    const template: ProofTemplate = {
      districtId: 'cd-01',
      merkleRoot: '0x123abc',
      siblings: ['0xabc', '0xdef', '0x123'],
      pathIndices: [0, 1, 0],
      leafHash: '0xleafhash',
      boundaryType: 'congressional-district',
      authority: 5,
      leafIndex: 0,
    };

    expect(template.districtId).toBe('cd-01');
    expect(template.merkleRoot).toMatch(/^0x[0-9a-f]+$/i);
    expect(template.siblings).toHaveLength(3);
    expect(template.pathIndices).toHaveLength(3);
    expect(template.boundaryType).toBe('congressional-district');
    expect(template.authority).toBe(5);
    expect(template.leafIndex).toBe(0);
  });

  it('should have valid path indices (0 or 1)', () => {
    const template: ProofTemplate = {
      districtId: 'cd-01',
      merkleRoot: '0x123',
      siblings: ['0xabc', '0xdef'],
      pathIndices: [0, 1],
      leafHash: '0xleaf',
      boundaryType: 'county',
      authority: 4,
      leafIndex: 5,
    };

    for (const idx of template.pathIndices) {
      expect([0, 1]).toContain(idx);
    }
  });
});

describe('ProofTemplateStore - Type Validation', () => {
  it('should have correct structure', () => {
    const store: ProofTemplateStore = {
      merkleRoot: '0xroot123',
      treeDepth: 14,
      templateCount: 2,
      generatedAt: new Date().toISOString(),
      templates: {
        'cd-01': {
          districtId: 'cd-01',
          merkleRoot: '0xroot123',
          siblings: ['0xabc'],
          pathIndices: [0],
          leafHash: '0xleaf1',
          boundaryType: 'congressional-district',
          authority: 5,
          leafIndex: 0,
        },
        'cd-02': {
          districtId: 'cd-02',
          merkleRoot: '0xroot123',
          siblings: ['0xdef'],
          pathIndices: [1],
          leafHash: '0xleaf2',
          boundaryType: 'congressional-district',
          authority: 5,
          leafIndex: 1,
        },
      },
    };

    expect(store.merkleRoot).toBe('0xroot123');
    expect(store.treeDepth).toBe(14);
    expect(store.templateCount).toBe(2);
    expect(Object.keys(store.templates)).toHaveLength(2);
    expect(store.templates['cd-01'].districtId).toBe('cd-01');
  });
});

describe('MultiLayerMerkleTreeBuilder - Proof Generation', () => {
  let builder: MultiLayerMerkleTreeBuilder;
  let tree: MultiLayerMerkleTree;
  let boundaries: MerkleBoundaryInput[];

  beforeAll(async () => {
    builder = new MultiLayerMerkleTreeBuilder();

    // Create test boundaries
    boundaries = [
      createMockBoundary('cd-01', 'Congressional District 1', BoundaryType.CONGRESSIONAL_DISTRICT, 5),
      createMockBoundary('cd-02', 'Congressional District 2', BoundaryType.CONGRESSIONAL_DISTRICT, 5),
      createMockBoundary('county-001', 'Test County', BoundaryType.COUNTY, 4),
    ];

    const layers: BoundaryLayers = {
      congressionalDistricts: boundaries.filter((b) => b.boundaryType === BoundaryType.CONGRESSIONAL_DISTRICT),
      counties: boundaries.filter((b) => b.boundaryType === BoundaryType.COUNTY),
    };

    tree = await builder.buildTree(layers);
  });

  it('should generate proof for single district', () => {
    const proof = builder.generateProof(tree, 'cd-01', BoundaryType.CONGRESSIONAL_DISTRICT);

    expect(proof).toBeDefined();
    expect(proof.root).toBe(tree.root);
    expect(proof.boundaryId).toBe('cd-01');
    expect(proof.boundaryType).toBe(BoundaryType.CONGRESSIONAL_DISTRICT);
    expect(proof.siblings.length).toBeGreaterThan(0);
    expect(proof.pathIndices.length).toBe(proof.siblings.length);
  });

  it('should generate proofs for all districts', () => {
    const proofs = new Map<string, ProofTemplate>();

    for (const leaf of tree.leaves) {
      const merkleProof = builder.generateProof(tree, leaf.boundaryId, leaf.boundaryType);
      const template = generateProofTemplate(merkleProof, 5, leaf.index);
      proofs.set(leaf.boundaryId, template);
    }

    expect(proofs.size).toBe(tree.leaves.length);

    // All proofs should have same root
    const roots = new Set<string>();
    for (const template of proofs.values()) {
      roots.add(template.merkleRoot);
    }
    expect(roots.size).toBe(1);
  });

  it('should generate different leaf hashes for different districts', () => {
    const proof1 = builder.generateProof(tree, 'cd-01', BoundaryType.CONGRESSIONAL_DISTRICT);
    const proof2 = builder.generateProof(tree, 'cd-02', BoundaryType.CONGRESSIONAL_DISTRICT);

    expect(proof1.leaf).not.toBe(proof2.leaf);
    expect(proof1.root).toBe(proof2.root); // Same tree
  });

  it('should throw for non-existent district', () => {
    expect(() => {
      builder.generateProof(tree, 'non-existent', BoundaryType.CONGRESSIONAL_DISTRICT);
    }).toThrow('Boundary not found in tree');
  });

  it('should verify proof against root', async () => {
    const proof = builder.generateProof(tree, 'cd-01', BoundaryType.CONGRESSIONAL_DISTRICT);
    const isValid = await builder.verifyProof(proof);

    expect(isValid).toBe(true);
  });

  it('should have valid path indices (0 or 1)', () => {
    const proof = builder.generateProof(tree, 'cd-01', BoundaryType.CONGRESSIONAL_DISTRICT);

    for (const idx of proof.pathIndices) {
      expect([0, 1]).toContain(idx);
    }
  });
});

describe('Batch Proof Generation - Performance', () => {
  it('should generate proofs for 100 districts efficiently', async () => {
    const builder = new MultiLayerMerkleTreeBuilder();

    // Create 100 boundaries
    const boundaries: MerkleBoundaryInput[] = [];
    for (let i = 0; i < 100; i++) {
      boundaries.push(
        createMockBoundary(`cd-${String(i).padStart(3, '0')}`, `District ${i}`, BoundaryType.CONGRESSIONAL_DISTRICT, 5)
      );
    }

    const layers: BoundaryLayers = {
      congressionalDistricts: boundaries,
    };

    const tree = await builder.buildTree(layers);
    expect(tree.leaves.length).toBe(100);

    // Generate all proofs
    const startTime = Date.now();
    const proofs = new Map<string, ProofTemplate>();

    for (const leaf of tree.leaves) {
      const merkleProof = builder.generateProof(tree, leaf.boundaryId, leaf.boundaryType);
      const template = generateProofTemplate(merkleProof, 5, leaf.index);
      proofs.set(leaf.boundaryId, template);
    }

    const duration = Date.now() - startTime;

    expect(proofs.size).toBe(100);
    // Should complete in reasonable time (< 5 seconds for 100 proofs)
    expect(duration).toBeLessThan(5000);
  });
});

describe('SnapshotManager - Proof Storage', () => {
  let snapshotManager: SnapshotManager;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = join(tmpdir(), `proof-test-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });
    snapshotManager = new SnapshotManager(tempDir);
    await snapshotManager.initialize();
  });

  afterAll(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should store proof templates', async () => {
    const snapshotId = randomUUID();
    const merkleRoot = BigInt('0x123456789abcdef');
    const treeDepth = 14;

    const proofs = new Map<string, ProofTemplate>();
    proofs.set('cd-01', {
      districtId: 'cd-01',
      merkleRoot: `0x${merkleRoot.toString(16)}`,
      siblings: ['0xabc', '0xdef'],
      pathIndices: [0, 1],
      leafHash: '0xleaf1',
      boundaryType: 'congressional-district',
      authority: 5,
      leafIndex: 0,
    });
    proofs.set('cd-02', {
      districtId: 'cd-02',
      merkleRoot: `0x${merkleRoot.toString(16)}`,
      siblings: ['0x123', '0x456'],
      pathIndices: [1, 0],
      leafHash: '0xleaf2',
      boundaryType: 'congressional-district',
      authority: 5,
      leafIndex: 1,
    });

    await snapshotManager.storeProofs(snapshotId, proofs, merkleRoot, treeDepth);

    // Verify storage
    const hasProofs = await snapshotManager.hasProofTemplates(snapshotId);
    expect(hasProofs).toBe(true);
  });

  it('should retrieve proof template by district ID', async () => {
    const snapshotId = randomUUID();
    const merkleRoot = BigInt('0xabcdef123');
    const treeDepth = 12;

    const proofs = new Map<string, ProofTemplate>();
    proofs.set('county-001', {
      districtId: 'county-001',
      merkleRoot: `0x${merkleRoot.toString(16)}`,
      siblings: ['0xaaa', '0xbbb', '0xccc'],
      pathIndices: [0, 1, 0],
      leafHash: '0xleafhash',
      boundaryType: 'county',
      authority: 4,
      leafIndex: 5,
    });

    await snapshotManager.storeProofs(snapshotId, proofs, merkleRoot, treeDepth);

    const template = await snapshotManager.getProofTemplate(snapshotId, 'county-001');

    expect(template).not.toBeNull();
    expect(template?.districtId).toBe('county-001');
    expect(template?.boundaryType).toBe('county');
    expect(template?.siblings).toHaveLength(3);
    expect(template?.pathIndices).toEqual([0, 1, 0]);
  });

  it('should return null for non-existent district', async () => {
    const snapshotId = randomUUID();
    const merkleRoot = BigInt('0x111222333');
    const treeDepth = 10;

    const proofs = new Map<string, ProofTemplate>();
    proofs.set('cd-01', {
      districtId: 'cd-01',
      merkleRoot: `0x${merkleRoot.toString(16)}`,
      siblings: ['0x111'],
      pathIndices: [0],
      leafHash: '0xleaf',
      boundaryType: 'congressional-district',
      authority: 5,
      leafIndex: 0,
    });

    await snapshotManager.storeProofs(snapshotId, proofs, merkleRoot, treeDepth);

    const template = await snapshotManager.getProofTemplate(snapshotId, 'non-existent');
    expect(template).toBeNull();
  });

  it('should return null for non-existent snapshot', async () => {
    const template = await snapshotManager.getProofTemplate('non-existent-snapshot', 'cd-01');
    expect(template).toBeNull();
  });

  it('should retrieve full proof template store', async () => {
    const snapshotId = randomUUID();
    const merkleRoot = BigInt('0xfedcba987');
    const treeDepth = 16;

    const proofs = new Map<string, ProofTemplate>();
    for (let i = 0; i < 5; i++) {
      proofs.set(`district-${i}`, {
        districtId: `district-${i}`,
        merkleRoot: `0x${merkleRoot.toString(16)}`,
        siblings: [`0x${i}`],
        pathIndices: [i % 2],
        leafHash: `0xleaf${i}`,
        boundaryType: 'congressional-district',
        authority: 5,
        leafIndex: i,
      });
    }

    await snapshotManager.storeProofs(snapshotId, proofs, merkleRoot, treeDepth);

    const store = await snapshotManager.getProofTemplateStore(snapshotId);

    expect(store).not.toBeNull();
    expect(store?.templateCount).toBe(5);
    expect(store?.treeDepth).toBe(16);
    expect(store?.merkleRoot).toBe(`0x${merkleRoot.toString(16)}`);
    expect(Object.keys(store?.templates ?? {})).toHaveLength(5);
  });
});

describe('Merkle Proof Validity', () => {
  it('should verify that siblings + path recomputes to root', async () => {
    const builder = new MultiLayerMerkleTreeBuilder();

    const boundaries: MerkleBoundaryInput[] = [
      createMockBoundary('cd-01', 'District 1', BoundaryType.CONGRESSIONAL_DISTRICT, 5),
      createMockBoundary('cd-02', 'District 2', BoundaryType.CONGRESSIONAL_DISTRICT, 5),
      createMockBoundary('cd-03', 'District 3', BoundaryType.CONGRESSIONAL_DISTRICT, 5),
      createMockBoundary('cd-04', 'District 4', BoundaryType.CONGRESSIONAL_DISTRICT, 5),
    ];

    const layers: BoundaryLayers = {
      congressionalDistricts: boundaries,
    };

    const tree = await builder.buildTree(layers);

    // Generate and verify all proofs
    for (const leaf of tree.leaves) {
      const proof = builder.generateProof(tree, leaf.boundaryId, leaf.boundaryType);
      const isValid = await builder.verifyProof(proof);

      expect(isValid).toBe(true);
    }
  });

  it('should fail verification with tampered sibling', async () => {
    const builder = new MultiLayerMerkleTreeBuilder();

    const boundaries: MerkleBoundaryInput[] = [
      createMockBoundary('cd-01', 'District 1', BoundaryType.CONGRESSIONAL_DISTRICT, 5),
      createMockBoundary('cd-02', 'District 2', BoundaryType.CONGRESSIONAL_DISTRICT, 5),
    ];

    const layers: BoundaryLayers = {
      congressionalDistricts: boundaries,
    };

    const tree = await builder.buildTree(layers);
    const proof = builder.generateProof(tree, 'cd-01', BoundaryType.CONGRESSIONAL_DISTRICT);

    // Tamper with sibling
    const tamperedProof = {
      ...proof,
      siblings: [...proof.siblings],
    };
    if (tamperedProof.siblings.length > 0) {
      tamperedProof.siblings[0] = BigInt('0x9999999999');
    }

    const isValid = await builder.verifyProof(tamperedProof);
    expect(isValid).toBe(false);
  });

  it('should fail verification with wrong root', async () => {
    const builder = new MultiLayerMerkleTreeBuilder();

    const boundaries: MerkleBoundaryInput[] = [
      createMockBoundary('cd-01', 'District 1', BoundaryType.CONGRESSIONAL_DISTRICT, 5),
    ];

    const layers: BoundaryLayers = {
      congressionalDistricts: boundaries,
    };

    const tree = await builder.buildTree(layers);
    const proof = builder.generateProof(tree, 'cd-01', BoundaryType.CONGRESSIONAL_DISTRICT);

    // Tamper with root
    const tamperedProof = {
      ...proof,
      root: BigInt('0x1111111111111'),
    };

    const isValid = await builder.verifyProof(tamperedProof);
    expect(isValid).toBe(false);
  });
});

describe('Deterministic Proof Generation', () => {
  it('should generate same proof template across instances', async () => {
    const boundaries: MerkleBoundaryInput[] = [
      createMockBoundary('cd-01', 'District 1', BoundaryType.CONGRESSIONAL_DISTRICT, 5),
      createMockBoundary('cd-02', 'District 2', BoundaryType.CONGRESSIONAL_DISTRICT, 5),
    ];

    const layers: BoundaryLayers = {
      congressionalDistricts: boundaries,
    };

    // Build tree twice
    const builder1 = new MultiLayerMerkleTreeBuilder();
    const tree1 = await builder1.buildTree(layers);
    const proof1 = builder1.generateProof(tree1, 'cd-01', BoundaryType.CONGRESSIONAL_DISTRICT);

    const builder2 = new MultiLayerMerkleTreeBuilder();
    const tree2 = await builder2.buildTree(layers);
    const proof2 = builder2.generateProof(tree2, 'cd-01', BoundaryType.CONGRESSIONAL_DISTRICT);

    // Should produce identical results
    expect(proof1.root).toBe(proof2.root);
    expect(proof1.leaf).toBe(proof2.leaf);
    expect(proof1.siblings).toEqual(proof2.siblings);
    expect(proof1.pathIndices).toEqual(proof2.pathIndices);
  });
});

describe('Provenance Commitment in Leaf Hash', () => {
  it('should change leaf hash when provenance changes', async () => {
    const builder = new MultiLayerMerkleTreeBuilder();

    // Same boundary, different provenance
    const boundaryWithProvenance1: MerkleBoundaryInput = {
      id: 'cd-01',
      name: 'District 1',
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-122.4, 37.8],
            [-122.3, 37.8],
            [-122.3, 37.7],
            [-122.4, 37.7],
            [-122.4, 37.8],
          ],
        ],
      },
      boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
      authority: 5,
      source: {
        url: 'https://example.com/tiger/v1.zip',
        checksum: 'abc123def456',
        timestamp: '2024-01-01T00:00:00Z',
        provider: 'census-tiger',
      },
    };

    const boundaryWithProvenance2: MerkleBoundaryInput = {
      ...boundaryWithProvenance1,
      source: {
        url: 'https://example.com/tiger/v2.zip', // Different URL
        checksum: 'xyz789uvw012',
        timestamp: '2024-01-02T00:00:00Z',
        provider: 'census-tiger',
      },
    };

    // Build trees
    const tree1 = await builder.buildTree({
      congressionalDistricts: [boundaryWithProvenance1],
    });
    const tree2 = await builder.buildTree({
      congressionalDistricts: [boundaryWithProvenance2],
    });

    // Leaf hashes should differ (provenance is committed)
    expect(tree1.leaves[0].leafHash).not.toBe(tree2.leaves[0].leafHash);

    // Roots should differ (different leaf hash → different tree)
    expect(tree1.root).not.toBe(tree2.root);
  });

  it('should produce same leaf hash with identical provenance', async () => {
    const builder = new MultiLayerMerkleTreeBuilder();

    const provenance = {
      url: 'https://example.com/tiger/data.zip',
      checksum: 'abcdef123456',
      timestamp: '2024-01-01T00:00:00Z',
      provider: 'census-tiger',
    };

    const boundary1: MerkleBoundaryInput = {
      id: 'cd-01',
      name: 'District 1',
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-122.4, 37.8],
            [-122.3, 37.8],
            [-122.3, 37.7],
            [-122.4, 37.7],
            [-122.4, 37.8],
          ],
        ],
      },
      boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
      authority: 5,
      source: provenance,
    };

    const boundary2: MerkleBoundaryInput = {
      ...boundary1,
      source: { ...provenance }, // Clone provenance
    };

    // Build trees
    const tree1 = await builder.buildTree({
      congressionalDistricts: [boundary1],
    });
    const tree2 = await builder.buildTree({
      congressionalDistricts: [boundary2],
    });

    // Identical provenance → identical leaf hash
    expect(tree1.leaves[0].leafHash).toBe(tree2.leaves[0].leafHash);
    expect(tree1.root).toBe(tree2.root);
  });

  it('should maintain backward compatibility without provenance', async () => {
    const builder = new MultiLayerMerkleTreeBuilder();

    const boundaryWithoutProvenance: MerkleBoundaryInput = {
      id: 'cd-01',
      name: 'District 1',
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-122.4, 37.8],
            [-122.3, 37.8],
            [-122.3, 37.7],
            [-122.4, 37.7],
            [-122.4, 37.8],
          ],
        ],
      },
      boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
      authority: 5,
      // No source field
    };

    // Should build tree successfully
    const tree = await builder.buildTree({
      congressionalDistricts: [boundaryWithoutProvenance],
    });

    expect(tree.leaves).toHaveLength(1);
    expect(tree.leaves[0].boundaryId).toBe('cd-01');
  });

  it('should change leaf hash when checksum changes', async () => {
    const builder = new MultiLayerMerkleTreeBuilder();

    const boundary1: MerkleBoundaryInput = {
      id: 'cd-01',
      name: 'District 1',
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-122.4, 37.8],
            [-122.3, 37.8],
            [-122.3, 37.7],
            [-122.4, 37.7],
            [-122.4, 37.8],
          ],
        ],
      },
      boundaryType: BoundaryType.CONGRESSIONAL_DISTRICT,
      authority: 5,
      source: {
        url: 'https://example.com/tiger/data.zip',
        checksum: 'checksum_v1',
        timestamp: '2024-01-01T00:00:00Z',
        provider: 'census-tiger',
      },
    };

    const boundary2: MerkleBoundaryInput = {
      ...boundary1,
      source: {
        ...boundary1.source!,
        checksum: 'checksum_v2', // Different checksum (file was updated)
      },
    };

    const tree1 = await builder.buildTree({
      congressionalDistricts: [boundary1],
    });
    const tree2 = await builder.buildTree({
      congressionalDistricts: [boundary2],
    });

    // Different checksum → different leaf hash
    expect(tree1.leaves[0].leafHash).not.toBe(tree2.leaves[0].leafHash);
  });
});
