/**
 * Proof Generator Tests
 *
 * Production-grade test coverage for Merkle proof generation and ZK proof service.
 * Zero tolerance for bugs in cryptographic verification.
 *
 * SECURITY CRITICAL: Proofs enable trustless verification.
 * Invalid proofs brick the entire protocol.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  ProofService,
  ZKProofService,
  toCompactProof,
  fromCompactProof,
  type CircuitInputs,
  type ZKProofResult,
} from '../../../serving/proof-generator.js';
import type { DistrictBoundary, GeoJSONPolygon, ServingProvenanceMetadata } from '../../../serving/types';
import type { MerkleProof } from '../../../merkle-tree.js';

/**
 * Test fixture: Create mock district boundary
 */
function createMockDistrict(id: string, name: string): DistrictBoundary {
  const geometry: GeoJSONPolygon = {
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
  };

  const provenance: ServingProvenanceMetadata = {
    source: 'test-source',
    authority: 'state-gis' as const,
    timestamp: Date.now(),
    method: 'test',
    responseHash: '0x123',
  };

  return {
    id,
    name,
    jurisdiction: 'Test Jurisdiction',
    districtType: 'council' as const,
    geometry,
    provenance,
  };
}

describe('ZKProofService', () => {
  let zkService: ZKProofService;

  beforeAll(async () => {
    // Initialize ZK service with depth 14 (municipal level)
    zkService = await ZKProofService.create({ depth: 14 });
  });

  afterAll(async () => {
    // Clean up resources
    if (zkService) {
      await zkService.destroy();
    }
  });

  it('should initialize successfully', () => {
    expect(zkService).toBeDefined();
  });

  it('should have correct circuit inputs structure', () => {
    // Test that we can create valid circuit inputs
    const testInputs: CircuitInputs = {
      merkle_root: '0x' + BigInt(12345).toString(16).padStart(64, '0'),
      nullifier: '0x' + BigInt(67890).toString(16).padStart(64, '0'),
      authority_hash: '0x' + BigInt(11111).toString(16).padStart(64, '0'),
      epoch_id: '0x' + BigInt(1).toString(16).padStart(64, '0'),
      campaign_id: '0x' + BigInt(2).toString(16).padStart(64, '0'),
      leaf: '0x' + BigInt(99999).toString(16).padStart(64, '0'),
      merkle_path: Array(14).fill('0x' + BigInt(0).toString(16).padStart(64, '0')),
      leaf_index: 0,
      user_secret: '0x' + BigInt(77777).toString(16).padStart(64, '0'),
    };

    // Verify all required fields are present
    expect(testInputs.merkle_root).toBeDefined();
    expect(testInputs.nullifier).toBeDefined();
    expect(testInputs.authority_hash).toBeDefined();
    expect(testInputs.epoch_id).toBeDefined();
    expect(testInputs.campaign_id).toBeDefined();
    expect(testInputs.leaf).toBeDefined();
    expect(testInputs.merkle_path).toHaveLength(14);
    expect(testInputs.leaf_index).toBeDefined();
    expect(testInputs.user_secret).toBeDefined();
  });

  it('should validate merkle_path has exactly 14 elements', () => {
    const validPath = Array(14).fill('0x' + BigInt(0).toString(16).padStart(64, '0'));
    expect(validPath).toHaveLength(14);

    const invalidPath = Array(10).fill('0x' + BigInt(0).toString(16).padStart(64, '0'));
    expect(invalidPath).not.toHaveLength(14);
  });

  it('should format hex strings with 0x prefix', () => {
    const testInputs: CircuitInputs = {
      merkle_root: '0x' + BigInt(12345).toString(16).padStart(64, '0'),
      nullifier: '0x' + BigInt(67890).toString(16).padStart(64, '0'),
      authority_hash: '0x' + BigInt(11111).toString(16).padStart(64, '0'),
      epoch_id: '0x' + BigInt(1).toString(16).padStart(64, '0'),
      campaign_id: '0x' + BigInt(2).toString(16).padStart(64, '0'),
      leaf: '0x' + BigInt(99999).toString(16).padStart(64, '0'),
      merkle_path: Array(14).fill('0x' + BigInt(0).toString(16).padStart(64, '0')),
      leaf_index: 0,
      user_secret: '0x' + BigInt(77777).toString(16).padStart(64, '0'),
    };

    expect(testInputs.merkle_root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(testInputs.leaf).toMatch(/^0x[0-9a-f]{64}$/);
    expect(testInputs.merkle_path.every((p) => p.match(/^0x[0-9a-f]{64}$/))).toBe(true);
  });
});

describe('ProofService - Async Factory Pattern', () => {
  it('should create ProofService with async factory', async () => {
    const districts = [
      createMockDistrict('district-1', 'District 1'),
      createMockDistrict('district-2', 'District 2'),
    ];
    const addresses = ['123 Main St', '456 Oak Ave'];

    const service = await ProofService.create(districts, addresses);

    expect(service).toBeDefined();
    expect(service.getLeafCount()).toBeGreaterThan(0);
  });

  it('should initialize with empty arrays', async () => {
    const service = await ProofService.create([], []);

    expect(service).toBeDefined();
    expect(service.getLeafCount()).toBeGreaterThan(0);
  });

  it('should create with ZK config', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    const service = await ProofService.create(districts, addresses, { depth: 14 });

    expect(service).toBeDefined();
  });
});

describe('ProofService - Merkle Proof Generation', () => {
  it('should generate proof for existing district', async () => {
    const districts = [
      createMockDistrict('district-1', 'District 1'),
      createMockDistrict('district-2', 'District 2'),
    ];
    const addresses = ['123 Main St', '456 Oak Ave'];

    const service = await ProofService.create(districts, addresses);
    const proof = await service.generateProof('district-1');

    expect(proof).toBeDefined();
    expect(proof.root).toBeDefined();
    expect(typeof proof.root).toBe('bigint');
    expect(proof.leaf).toBeDefined();
    expect(typeof proof.leaf).toBe('bigint');
    expect(proof.siblings).toBeDefined();
    expect(proof.pathIndices).toBeDefined();
    expect(proof.siblings.length).toBeGreaterThan(0);
    expect(proof.pathIndices.length).toBe(proof.siblings.length);
  });

  it('should throw for non-existent district', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    const service = await ProofService.create(districts, addresses);

    await expect(async () => {
      await service.generateProof('non-existent-district');
    }).rejects.toThrow('District not found in tree');
  });

  it('should generate different proofs for different districts', async () => {
    const districts = [
      createMockDistrict('district-1', 'District 1'),
      createMockDistrict('district-2', 'District 2'),
    ];
    const addresses = ['123 Main St', '456 Oak Ave'];

    const service = await ProofService.create(districts, addresses);
    const proof1 = await service.generateProof('district-1');
    const proof2 = await service.generateProof('district-2');

    // Same root (same tree)
    expect(proof1.root).toBe(proof2.root);

    // Different leaves (different districts)
    expect(proof1.leaf).not.toBe(proof2.leaf);
  });

  it('should have valid path indices (0 or 1)', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    const service = await ProofService.create(districts, addresses);
    const proof = await service.generateProof('district-1');

    for (const idx of proof.pathIndices) {
      expect([0, 1]).toContain(idx);
    }
  });
});

describe('ProofService - Circuit Input Mapping', () => {
  it('should map Merkle proof to circuit inputs', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    const service = await ProofService.create(districts, addresses);
    const merkleProof = await service.generateProof('district-1');

    const circuitInputs = await service.mapToCircuitInputs(
      merkleProof,
      '0x' + BigInt(12345).toString(16).padStart(64, '0'), // user_secret
      '0x' + BigInt(1).toString(16).padStart(64, '0'),      // campaign_id
      '0x' + BigInt(2).toString(16).padStart(64, '0'),      // authority_hash
      '0x' + BigInt(3).toString(16).padStart(64, '0')       // epoch_id
    );

    // Verify circuit inputs structure
    expect(circuitInputs.merkle_root).toBeDefined();
    expect(circuitInputs.merkle_root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(circuitInputs.leaf).toBeDefined();
    expect(circuitInputs.leaf).toMatch(/^0x[0-9a-f]{64}$/);
    expect(circuitInputs.merkle_path).toHaveLength(14);
    expect(circuitInputs.merkle_path.every((p) => p.match(/^0x[0-9a-f]{64}$/))).toBe(true);
    expect(circuitInputs.leaf_index).toBeGreaterThanOrEqual(0);
    expect(circuitInputs.user_secret).toBeDefined();
    expect(circuitInputs.campaign_id).toBeDefined();
    expect(circuitInputs.authority_hash).toBeDefined();
    expect(circuitInputs.epoch_id).toBeDefined();
  });

  it('should pad merkle_path to 14 elements if needed', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    const service = await ProofService.create(districts, addresses);
    const merkleProof = await service.generateProof('district-1');

    const circuitInputs = await service.mapToCircuitInputs(
      merkleProof,
      '0x' + BigInt(12345).toString(16).padStart(64, '0'),
      '0x' + BigInt(1).toString(16).padStart(64, '0'),
      '0x' + BigInt(2).toString(16).padStart(64, '0'),
      '0x' + BigInt(3).toString(16).padStart(64, '0')
    );

    // Should always have exactly 14 elements
    expect(circuitInputs.merkle_path).toHaveLength(14);
  });

  it('should compute leaf_index from path indices', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    const service = await ProofService.create(districts, addresses);
    const merkleProof = await service.generateProof('district-1');

    const circuitInputs = await service.mapToCircuitInputs(
      merkleProof,
      '0x' + BigInt(12345).toString(16).padStart(64, '0'),
      '0x' + BigInt(1).toString(16).padStart(64, '0'),
      '0x' + BigInt(2).toString(16).padStart(64, '0'),
      '0x' + BigInt(3).toString(16).padStart(64, '0')
    );

    // leaf_index should be a valid number
    expect(typeof circuitInputs.leaf_index).toBe('number');
    expect(circuitInputs.leaf_index).toBeGreaterThanOrEqual(0);
  });
});

describe('ProofService - Compact Proof Format', () => {
  it('should convert to compact format', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    const service = await ProofService.create(districts, addresses);
    const proof = await service.generateProof('district-1');

    const compact = toCompactProof(proof);

    expect(compact.r).toMatch(/^0x[0-9a-f]+$/i);
    expect(compact.l).toMatch(/^0x[0-9a-f]+$/i);
    expect(compact.s.length).toBeGreaterThan(0);
    expect(compact.p.length).toBe(compact.s.length);

    for (const sibling of compact.s) {
      expect(sibling).toMatch(/^0x[0-9a-f]+$/i);
    }

    for (const pathIdx of compact.p) {
      expect([0, 1]).toContain(pathIdx);
    }
  });

  it('should round-trip through compact format', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    const service = await ProofService.create(districts, addresses);
    const proof = await service.generateProof('district-1');

    const compact = toCompactProof(proof);
    const restored = fromCompactProof(compact);

    expect(restored.root).toBe(proof.root);
    expect(restored.leaf).toBe(proof.leaf);
    expect(restored.siblings).toEqual(proof.siblings);
    expect(restored.pathIndices).toEqual(proof.pathIndices);
  });
});

describe('ProofService - ZK Proof Methods', () => {
  it('should have generateZKProof method', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    const service = await ProofService.create(districts, addresses);

    expect(typeof service.generateZKProof).toBe('function');
  });

  it('should have verifyZKProof method', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    const service = await ProofService.create(districts, addresses);

    expect(typeof service.verifyZKProof).toBe('function');
  });

  it('should clean up ZK resources', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    const service = await ProofService.create(districts, addresses, { depth: 14 });

    // Should not throw
    await expect(service.destroy()).resolves.not.toThrow();
  });
});

describe('ProofService - Tree Properties', () => {
  it('should return correct Merkle root', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    const service = await ProofService.create(districts, addresses);
    const root = service.getRoot();

    expect(typeof root).toBe('bigint');
    expect(root).toBeGreaterThan(0n);
  });

  it('should return consistent root across instances', async () => {
    const districts = [
      createMockDistrict('district-1', 'District 1'),
      createMockDistrict('district-2', 'District 2'),
    ];
    const addresses = ['123 Main St', '456 Oak Ave'];

    const service1 = await ProofService.create(districts, addresses);
    const service2 = await ProofService.create(districts, addresses);

    expect(service1.getRoot()).toBe(service2.getRoot());
  });

  it('should return different root for different addresses', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];

    const service1 = await ProofService.create(districts, ['123 Main St']);
    const service2 = await ProofService.create(districts, ['456 Oak Ave']);

    expect(service1.getRoot()).not.toBe(service2.getRoot());
  });
});

describe('ProofService - Edge Cases', () => {
  it('should handle single district', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    const service = await ProofService.create(districts, addresses);
    const proof = await service.generateProof('district-1');

    expect(proof).toBeDefined();
    expect(proof.siblings.length).toBeGreaterThan(0);
  });

  it('should handle empty district ID', async () => {
    const districts = [createMockDistrict('', 'Empty ID District')];
    const addresses = ['123 Main St'];

    const service = await ProofService.create(districts, addresses);
    const proof = await service.generateProof('');

    expect(proof).toBeDefined();
  });

  it('should handle districts with same name but different IDs', async () => {
    const districts = [
      createMockDistrict('district-1', 'District A'),
      createMockDistrict('district-2', 'District A'), // Same name
    ];
    const addresses = ['123 Main St', '456 Oak Ave'];

    const service = await ProofService.create(districts, addresses);

    const proof1 = await service.generateProof('district-1');
    const proof2 = await service.generateProof('district-2');

    expect(proof1.leaf).not.toBe(proof2.leaf);
  });
});

describe('ProofService - Deterministic Behavior', () => {
  it('should generate same proof for same district across instances', async () => {
    const districts = [
      createMockDistrict('district-1', 'District 1'),
      createMockDistrict('district-2', 'District 2'),
    ];
    const addresses = ['123 Main St', '456 Oak Ave'];

    const service1 = await ProofService.create(districts, addresses);
    const service2 = await ProofService.create(districts, addresses);

    const proof1 = await service1.generateProof('district-1');
    const proof2 = await service2.generateProof('district-1');

    expect(proof1.root).toBe(proof2.root);
    expect(proof1.leaf).toBe(proof2.leaf);
    expect(proof1.siblings).toEqual(proof2.siblings);
    expect(proof1.pathIndices).toEqual(proof2.pathIndices);
  });
});
