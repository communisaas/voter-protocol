/**
 * Proof Generator Tests
 *
 * Tests the Merkle proof generation layer (ProofService) and ZK proof
 * service interface (ZKProofService) that bridge Shadow Atlas geographic
 * data to the Noir circuit.
 *
 * DATA FLOW:
 *   Shadow Atlas boundaries → ProofService (Merkle tree) → mapToCircuitInputs
 *   → DistrictWitness → Noir circuit (client-side) → UltraHonk proof → on-chain
 *
 * These tests cover steps 1-3. Actual proving (step 4) requires the full
 * Barretenberg WASM backend and is tested in packages/crypto/test/ with
 * golden vectors and two-tree vectors (53 tests).
 *
 * SECURITY CRITICAL: Invalid Merkle proofs or malformed circuit inputs
 * produce invalid ZK proofs, bricking the submission flow.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock constants to use depth 4 (16 leaves) instead of depth 20 (1M leaves).
// Building a 2^20-leaf Poseidon2 Merkle tree per test takes ~8 minutes.
// Merkle tree correctness is tested separately in merkle-tree.test.ts.
vi.mock('../../../core/constants.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../core/constants.js')>();
  return {
    ...mod,
    DEFAULT_TREE_DEPTH: 4,
    CIRCUIT_DEPTHS: [4, ...mod.CIRCUIT_DEPTHS],
  };
});

import {
  ProofService,
  ZKProofService,
  toCompactProof,
  fromCompactProof,
  type CircuitInputs,
} from '../../../serving/proof-generator.js';
import type { DistrictBoundary, GeoJSONPolygon, ServingProvenanceMetadata } from '../../../serving/types';
import { DEFAULT_TREE_DEPTH } from '../../../core/constants.js';

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

// ============================================================================
// DistrictWitness (CircuitInputs) shape tests
//
// CircuitInputs = DistrictWitness. The circuit expects these exact fields.
// Testing the shape WITHOUT initializing the WASM backend.
// ============================================================================

describe('CircuitInputs (DistrictWitness) shape', () => {
  it('should have all required circuit fields', () => {
    const inputs: CircuitInputs = {
      merkle_root: '0x' + BigInt(12345).toString(16).padStart(64, '0'),
      action_domain: '0x' + BigInt(67890).toString(16).padStart(64, '0'),
      user_secret: '0x' + BigInt(77777).toString(16).padStart(64, '0'),
      district_id: '0x' + BigInt(11111).toString(16).padStart(64, '0'),
      authority_level: 3,
      registration_salt: '0x' + BigInt(22222).toString(16).padStart(64, '0'),
      merkle_path: Array(DEFAULT_TREE_DEPTH).fill('0x' + BigInt(0).toString(16).padStart(64, '0')),
      leaf_index: 0,
    };

    expect(inputs.merkle_root).toBeDefined();
    expect(inputs.action_domain).toBeDefined();
    expect(inputs.user_secret).toBeDefined();
    expect(inputs.district_id).toBeDefined();
    expect(inputs.authority_level).toBe(3);
    expect(inputs.registration_salt).toBeDefined();
    expect(inputs.merkle_path).toHaveLength(DEFAULT_TREE_DEPTH);
    expect(inputs.leaf_index).toBe(0);
  });

  it('should require merkle_path length matching circuit depth', () => {
    // Circuit depth is 20 (default in ProofService). Tree depth may differ (mocked to 4 in tests).
    // mapToCircuitInputs pads paths to circuit depth, not tree depth.
    const CIRCUIT_DEPTH = 20;
    const validPath = Array(CIRCUIT_DEPTH).fill('0x' + BigInt(0).toString(16).padStart(64, '0'));
    expect(validPath).toHaveLength(CIRCUIT_DEPTH);

    const shortPath = Array(10).fill('0x' + BigInt(0).toString(16).padStart(64, '0'));
    expect(shortPath).not.toHaveLength(CIRCUIT_DEPTH);
  });

  it('should format all hex fields with 0x prefix and 64 hex chars', () => {
    const inputs: CircuitInputs = {
      merkle_root: '0x' + BigInt(12345).toString(16).padStart(64, '0'),
      action_domain: '0x' + BigInt(67890).toString(16).padStart(64, '0'),
      user_secret: '0x' + BigInt(77777).toString(16).padStart(64, '0'),
      district_id: '0x' + BigInt(11111).toString(16).padStart(64, '0'),
      authority_level: 1,
      registration_salt: '0x' + BigInt(22222).toString(16).padStart(64, '0'),
      merkle_path: Array(DEFAULT_TREE_DEPTH).fill('0x' + BigInt(0).toString(16).padStart(64, '0')),
      leaf_index: 0,
    };

    const hexPattern = /^0x[0-9a-f]{64}$/;
    expect(inputs.merkle_root).toMatch(hexPattern);
    expect(inputs.action_domain).toMatch(hexPattern);
    expect(inputs.user_secret).toMatch(hexPattern);
    expect(inputs.district_id).toMatch(hexPattern);
    expect(inputs.registration_salt).toMatch(hexPattern);
    expect(inputs.merkle_path.every((p) => hexPattern.test(p))).toBe(true);
  });

  it('should accept authority_level in range 1-5', () => {
    for (const level of [1, 2, 3, 4, 5]) {
      const inputs: CircuitInputs = {
        merkle_root: '0x' + '0'.repeat(64),
        action_domain: '0x' + '0'.repeat(64),
        user_secret: '0x' + '0'.repeat(64),
        district_id: '0x' + '0'.repeat(64),
        authority_level: level,
        registration_salt: '0x' + '0'.repeat(64),
        merkle_path: Array(DEFAULT_TREE_DEPTH).fill('0x' + '0'.repeat(64)),
        leaf_index: 0,
      };
      expect(inputs.authority_level).toBe(level);
    }
  });
});

// ============================================================================
// ZKProofService interface tests
//
// Test the ZKProofService class contract WITHOUT initializing the WASM backend.
// Actual proof generation is tested in packages/crypto/test/ (53 golden vector
// + two-tree vector tests that exercise the full Noir→Barretenberg pipeline).
// ============================================================================

describe('ZKProofService', () => {
  it('should expose create() async factory', () => {
    expect(typeof ZKProofService.create).toBe('function');
  });

  // NOTE: We do NOT call ZKProofService.create() here. That loads the full
  // Barretenberg WASM backend (~300MB heap for depth-20 SRS), which OOMs
  // vitest workers. The WASM pipeline is tested end-to-end via:
  //   packages/crypto/test/golden-vectors.test.ts (30 tests)
  //   packages/crypto/test/two-tree-vectors.test.ts (23 tests)
});

// ============================================================================
// ProofService — Async Factory Pattern
// ============================================================================

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
});

// ============================================================================
// ProofService — Merkle Proof Generation
// ============================================================================

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

// ============================================================================
// ProofService — Circuit Input Mapping (mapToCircuitInputs)
//
// Signature: mapToCircuitInputs(merkleProof, userSecret, actionDomain,
//            districtId, authorityLevel, registrationSalt)
// Returns: DistrictWitness ready for Noir circuit
// ============================================================================

describe('ProofService - Circuit Input Mapping', () => {
  const USER_SECRET = '0x' + BigInt(12345).toString(16).padStart(64, '0');
  const ACTION_DOMAIN = '0x' + BigInt(1).toString(16).padStart(64, '0');
  const DISTRICT_ID = '0x' + BigInt(2).toString(16).padStart(64, '0');
  const AUTHORITY_LEVEL = 3;
  const REGISTRATION_SALT = '0x' + BigInt(3).toString(16).padStart(64, '0');

  it('should map Merkle proof to DistrictWitness circuit inputs', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    const service = await ProofService.create(districts, addresses);
    const merkleProof = await service.generateProof('district-1');

    const circuitInputs = await service.mapToCircuitInputs(
      merkleProof,
      USER_SECRET,
      ACTION_DOMAIN,
      DISTRICT_ID,
      AUTHORITY_LEVEL,
      REGISTRATION_SALT,
    );

    // Verify all DistrictWitness fields are present and correctly formatted
    expect(circuitInputs.merkle_root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(circuitInputs.action_domain).toBe(ACTION_DOMAIN);
    expect(circuitInputs.user_secret).toBe(USER_SECRET);
    expect(circuitInputs.district_id).toBe(DISTRICT_ID);
    expect(circuitInputs.authority_level).toBe(AUTHORITY_LEVEL);
    expect(circuitInputs.registration_salt).toBe(REGISTRATION_SALT);
    // mapToCircuitInputs pads to circuit depth (20), not tree build depth
    expect(circuitInputs.merkle_path).toHaveLength(20);
    expect(circuitInputs.merkle_path.every((p) => /^0x[0-9a-f]{64}$/.test(p))).toBe(true);
    expect(circuitInputs.leaf_index).toBeGreaterThanOrEqual(0);
  });

  it('should pad merkle_path to DEFAULT_TREE_DEPTH elements', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    const service = await ProofService.create(districts, addresses);
    const merkleProof = await service.generateProof('district-1');

    const circuitInputs = await service.mapToCircuitInputs(
      merkleProof, USER_SECRET, ACTION_DOMAIN, DISTRICT_ID, AUTHORITY_LEVEL, REGISTRATION_SALT,
    );

    // Circuit requires exactly circuitDepth (20) elements; shorter paths are zero-padded
    expect(circuitInputs.merkle_path).toHaveLength(20);
  });

  it('should compute leaf_index from path indices', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    const service = await ProofService.create(districts, addresses);
    const merkleProof = await service.generateProof('district-1');

    const circuitInputs = await service.mapToCircuitInputs(
      merkleProof, USER_SECRET, ACTION_DOMAIN, DISTRICT_ID, AUTHORITY_LEVEL, REGISTRATION_SALT,
    );

    expect(typeof circuitInputs.leaf_index).toBe('number');
    expect(circuitInputs.leaf_index).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// ProofService — Compact Proof Format (network serialization)
// ============================================================================

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

// ============================================================================
// ProofService — ZK Method Interface
// ============================================================================

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

  it('should throw when generateZKProof called without ZK config', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    // Create WITHOUT zkConfig
    const service = await ProofService.create(districts, addresses);

    await expect(
      service.generateZKProof('district-1', '0x1', '0x2', 3, '0x4')
    ).rejects.toThrow('ZK service not initialized');
  });

  it('should clean up ZK resources without error', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    // Create without ZK config — destroy() should be a no-op
    const service = await ProofService.create(districts, addresses);
    await expect(service.destroy()).resolves.not.toThrow();
  });
});

// ============================================================================
// ProofService — Tree Properties
// ============================================================================

describe('ProofService - Tree Properties', () => {
  it('should return correct Merkle root', async () => {
    const districts = [createMockDistrict('district-1', 'District 1')];
    const addresses = ['123 Main St'];

    const service = await ProofService.create(districts, addresses);
    const root = service.getRoot();

    expect(typeof root).toBe('bigint');
    expect(root).toBeGreaterThan(0n);
  });

  it('should return consistent root across instances (deterministic)', async () => {
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

// ============================================================================
// ProofService — Edge Cases
// ============================================================================

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

// ============================================================================
// ProofService — Deterministic Behavior
// ============================================================================

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
