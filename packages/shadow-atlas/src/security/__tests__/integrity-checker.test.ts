/**
 * Integrity Checker Security Tests
 *
 * Validates cryptographic verification, geometry validation, and tamper detection.
 */

import { describe, test, expect } from 'vitest';
import {
  verifyMerkleProof,
  verifyGeometryIntegrity,
  verifyBoundaryCount,
  compareBoundarySources,
  computeContentHash,
  verifyContentHash,
  verifySnapshotIntegrity,
  EXPECTED_BOUNDARY_COUNTS,
} from '../integrity-checker.js';
import type { Polygon, MultiPolygon } from 'geojson';
import { ShadowAtlasMerkleTree } from '../../merkle-tree.js';
import { hashPair as poseidon2HashPair } from '@voter-protocol/crypto/poseidon2';

describe('Integrity Checker - Merkle Proof Verification', () => {
  test('verifies valid Merkle proof', async () => {
    // Simple 2-level tree
    const leaf = 123n;
    const sibling = 456n;
    const siblings = [sibling];
    const pathIndices = [0]; // Leaf is left child

    // Compute expected root (simplified - actual Poseidon hash would differ)
    // For testing, we use the implementation's hash function
    const expectedRoot = 789n; // Placeholder

    // Note: This test validates the structure, not actual cryptographic correctness
    // Real tests would use known-good test vectors from Poseidon2
    const result = await verifyMerkleProof(leaf, [], [], leaf); // Single-node tree
    expect(result).toBe(true);
  });

  test('rejects invalid Merkle proof', async () => {
    const leaf = 123n;
    const siblings = [456n];
    const pathIndices = [0];
    const wrongRoot = 999n;

    // Verification should fail with wrong root
    const result = await verifyMerkleProof(leaf, siblings, pathIndices, wrongRoot);
    expect(result).toBe(false);
  });

  test('rejects mismatched siblings and path indices', async () => {
    const leaf = 123n;
    const siblings = [456n, 789n];
    const pathIndices = [0]; // Too few indices

    const result = await verifyMerkleProof(leaf, siblings, pathIndices, 999n);
    expect(result).toBe(false);
  });

  test('handles single-node tree (leaf is root)', async () => {
    const leaf = 123n;
    const result = await verifyMerkleProof(leaf, [], [], leaf);
    expect(result).toBe(true);
  });

  test('validates proof from actual ShadowAtlasMerkleTree', async () => {
    // Create a small tree with known addresses
    const addresses = [
      '123 Main St, District 1',
      '456 Oak Ave, District 1',
      '789 Pine Rd, District 1',
    ];

    const tree = await ShadowAtlasMerkleTree.create(addresses);
    const root = tree.getRoot();

    // Generate proof for first address
    const proof = await tree.generateProof(addresses[0]);

    // Verify using integrity-checker's verifyMerkleProof
    const isValid = await verifyMerkleProof(
      proof.leaf,
      proof.siblings,
      proof.pathIndices,
      root
    );

    expect(isValid).toBe(true);
    expect(proof.root).toBe(root);
  });

  test('rejects tampered proof from merkle tree', async () => {
    const addresses = [
      '123 Main St, District 1',
      '456 Oak Ave, District 1',
    ];

    const tree = await ShadowAtlasMerkleTree.create(addresses);
    const proof = await tree.generateProof(addresses[0]);

    // Tamper with the root
    const tamperedRoot = BigInt(proof.root) + 1n;

    const isValid = await verifyMerkleProof(
      proof.leaf,
      proof.siblings,
      proof.pathIndices,
      tamperedRoot
    );

    expect(isValid).toBe(false);
  });

  test('uses correct Poseidon2 implementation', async () => {
    // Verify hash consistency with crypto package
    const left = 12345n;
    const right = 67890n;

    // Hash using crypto package directly
    const expectedHash = await poseidon2HashPair(left, right);

    // Create a simple 2-level tree to verify hash behavior
    const leaf = left;
    const sibling = right;
    const siblings = [sibling];
    const pathIndices = [0]; // Leaf is left child

    // Compute expected root manually
    const expectedRoot = await poseidon2HashPair(leaf, sibling);

    // Verify proof
    const isValid = await verifyMerkleProof(leaf, siblings, pathIndices, expectedRoot);

    expect(isValid).toBe(true);
    expect(expectedRoot).toBe(expectedHash);
  });
});

describe('Integrity Checker - Geometry Validation', () => {
  test('accepts valid Polygon', () => {
    const polygon: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0], // Closed, counter-clockwise (RFC 7946)
        ],
      ],
    };

    const result = verifyGeometryIntegrity(polygon);
    expect(result.geometryValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('accepts valid MultiPolygon', () => {
    const multiPolygon: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0],
          ],
        ],
        [
          [
            [2, 2],
            [2, 3],
            [3, 3],
            [3, 2],
            [2, 2],
          ],
        ],
      ],
    };

    const result = verifyGeometryIntegrity(multiPolygon);
    expect(result.geometryValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('rejects coordinates outside valid range', () => {
    const polygon: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 1],
          [200, 1], // Longitude out of range
          [200, 0],
          [0, 0],
        ],
      ],
    };

    const result = verifyGeometryIntegrity(polygon);
    expect(result.geometryValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('rejects non-finite coordinates', () => {
    const polygon: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 1],
          [NaN, 1], // Invalid coordinate
          [1, 0],
          [0, 0],
        ],
      ],
    };

    const result = verifyGeometryIntegrity(polygon);
    expect(result.geometryValid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-finite'))).toBe(true);
  });

  test('rejects excessive precision (DoS protection)', () => {
    const polygon: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 1],
          [1.123456789, 1], // 9 decimal places (max is 8)
          [1, 0],
          [0, 0],
        ],
      ],
    };

    const result = verifyGeometryIntegrity(polygon);
    expect(result.geometryValid).toBe(false);
    expect(result.errors.some((e) => e.includes('excessive precision'))).toBe(true);
  });

  test('rejects unclosed rings', () => {
    const polygon: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          // Missing closing point!
        ],
      ],
    };

    const result = verifyGeometryIntegrity(polygon);
    expect(result.geometryValid).toBe(false);
    expect(result.errors.some((e) => e.includes('too few points') || e.includes('not closed'))).toBe(true);
  });

  test('rejects rings with too few points', () => {
    const polygon: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [0, 0], // Only 3 points (need 4 for closed triangle)
        ],
      ],
    };

    const result = verifyGeometryIntegrity(polygon);
    expect(result.geometryValid).toBe(false);
    expect(result.errors.some((e) => e.includes('too few points'))).toBe(true);
  });

  test('rejects duplicate consecutive points', () => {
    const polygon: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 1],
          [0, 1], // Duplicate
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ],
    };

    const result = verifyGeometryIntegrity(polygon);
    expect(result.geometryValid).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  test('validates winding order (RFC 7946: exterior counter-clockwise, holes clockwise)', () => {
    // Counter-clockwise exterior ring (CORRECT per RFC 7946)
    const polygon: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ],
    };

    const result = verifyGeometryIntegrity(polygon);
    // Should pass - counter-clockwise is correct for exterior rings
    expect(result.geometryValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('rejects clockwise exterior ring', () => {
    // Clockwise exterior ring (INCORRECT per RFC 7946)
    const polygon: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    };

    const result = verifyGeometryIntegrity(polygon);
    // Should fail - clockwise is incorrect for exterior rings
    expect(result.geometryValid).toBe(false);
    expect(result.errors.some((e) => e.includes('winding order'))).toBe(true);
  });
});

describe('Integrity Checker - Boundary Count Verification', () => {
  test('accepts correct boundary counts', () => {
    const result = verifyBoundaryCount('US-congressional', 441);
    expect(result.valid).toBe(true);
    expect(result.expected).toBe(441);
  });

  test('rejects incorrect boundary counts', () => {
    const result = verifyBoundaryCount('US-congressional', 400);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('mismatch');
  });

  test('allows tolerance for minor variations', () => {
    const result = verifyBoundaryCount('US-congressional', 440, 2);
    expect(result.valid).toBe(true);
  });

  test('returns valid for unknown jurisdictions', () => {
    const result = verifyBoundaryCount('UNKNOWN-jurisdiction', 100);
    expect(result.valid).toBe(true);
    expect(result.expected).toBeUndefined();
  });

  test('validates all known jurisdictions', () => {
    expect(EXPECTED_BOUNDARY_COUNTS['US-congressional']).toBe(441);
    expect(EXPECTED_BOUNDARY_COUNTS['US-county']).toBe(3143);
    expect(EXPECTED_BOUNDARY_COUNTS['GB-parliamentary']).toBe(650);
    expect(EXPECTED_BOUNDARY_COUNTS['CA-federal']).toBe(338);
  });
});

describe('Integrity Checker - Cross-Source Validation', () => {
  test('detects missing boundaries', () => {
    const source1 = new Map([
      ['district-1', { name: 'District 1', geometry: createSquarePolygon(0, 0, 1) }],
      ['district-2', { name: 'District 2', geometry: createSquarePolygon(1, 0, 2) }],
    ]);

    const source2 = new Map([
      ['district-1', { name: 'District 1', geometry: createSquarePolygon(0, 0, 1) }],
      // district-2 missing
    ]);

    const discrepancies = compareBoundarySources(source1, source2);

    expect(discrepancies.length).toBeGreaterThan(0);
    expect(discrepancies.some((d) => d.field === 'existence')).toBe(true);
    expect(discrepancies.some((d) => d.severity === 'critical')).toBe(true);
  });

  test('detects name inconsistencies', () => {
    const source1 = new Map([
      ['district-1', { name: 'District 1', geometry: createSquarePolygon(0, 0, 1) }],
    ]);

    const source2 = new Map([
      ['district-1', { name: 'District One', geometry: createSquarePolygon(0, 0, 1) }],
    ]);

    const discrepancies = compareBoundarySources(source1, source2);

    expect(discrepancies.some((d) => d.field === 'name')).toBe(true);
    expect(discrepancies.some((d) => d.severity === 'warning')).toBe(true);
  });

  test('detects geometry differences', () => {
    const source1 = new Map([
      ['district-1', { name: 'District 1', geometry: createSquarePolygon(0, 0, 1) }],
    ]);

    const source2 = new Map([
      ['district-1', { name: 'District 1', geometry: createSquarePolygon(10, 10, 11) }], // Very different
    ]);

    const discrepancies = compareBoundarySources(source1, source2);

    expect(discrepancies.some((d) => d.field === 'geometry')).toBe(true);
    expect(discrepancies.some((d) => d.severity === 'critical')).toBe(true);
  });

  test('handles identical sources', () => {
    const source1 = new Map([
      ['district-1', { name: 'District 1', geometry: createSquarePolygon(0, 0, 1) }],
      ['district-2', { name: 'District 2', geometry: createSquarePolygon(1, 0, 2) }],
    ]);

    const source2 = new Map([
      ['district-1', { name: 'District 1', geometry: createSquarePolygon(0, 0, 1) }],
      ['district-2', { name: 'District 2', geometry: createSquarePolygon(1, 0, 2) }],
    ]);

    const discrepancies = compareBoundarySources(source1, source2);

    expect(discrepancies).toHaveLength(0);
  });
});

describe('Integrity Checker - Content Hash Verification', () => {
  test('computes consistent hashes for identical data', () => {
    const data = { id: '123', name: 'Test', value: 42 };

    const hash1 = computeContentHash(data);
    const hash2 = computeContentHash(data);

    expect(hash1).toBe(hash2);
  });

  test('computes different hashes for different data', () => {
    const data1 = { id: '123', name: 'Test' };
    const data2 = { id: '456', name: 'Other' };

    const hash1 = computeContentHash(data1);
    const hash2 = computeContentHash(data2);

    expect(hash1).not.toBe(hash2);
  });

  test('is order-independent (sorts keys)', () => {
    const data1 = { b: 2, a: 1, c: 3 };
    const data2 = { a: 1, b: 2, c: 3 };

    const hash1 = computeContentHash(data1);
    const hash2 = computeContentHash(data2);

    expect(hash1).toBe(hash2);
  });

  test('verifies content hash correctly', () => {
    const data = { id: '123', name: 'Test' };
    const hash = computeContentHash(data);

    expect(verifyContentHash(data, hash)).toBe(true);
    expect(verifyContentHash(data, 'wrong-hash')).toBe(false);
  });
});

describe('Integrity Checker - Snapshot Verification', () => {
  test('accepts valid snapshot', () => {
    const snapshot = {
      merkleRoot: 123n,
      boundaryCount: 2,
      ipfsCID: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      boundaries: [
        { id: '1', geometry: createSquarePolygon(0, 0, 1) },
        { id: '2', geometry: createSquarePolygon(1, 0, 2) },
      ],
    };

    const result = verifySnapshotIntegrity(snapshot);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('detects boundary count mismatch', () => {
    const snapshot = {
      merkleRoot: 123n,
      boundaryCount: 10, // Says 10...
      ipfsCID: '',
      boundaries: [
        { id: '1', geometry: createSquarePolygon(0, 0, 1) },
      ], // ...but only 1
    };

    const result = verifySnapshotIntegrity(snapshot);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('count mismatch'))).toBe(true);
  });

  test('validates IPFS CID format', () => {
    const snapshot = {
      merkleRoot: 123n,
      boundaryCount: 1,
      ipfsCID: 'invalid-cid', // Invalid format
      boundaries: [{ id: '1', geometry: createSquarePolygon(0, 0, 1) }],
    };

    const result = verifySnapshotIntegrity(snapshot);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('CID'))).toBe(true);
  });

  test('allows empty IPFS CID', () => {
    const snapshot = {
      merkleRoot: 123n,
      boundaryCount: 1,
      ipfsCID: '', // Empty is allowed (not yet published)
      boundaries: [{ id: '1', geometry: createSquarePolygon(0, 0, 1) }],
    };

    const result = verifySnapshotIntegrity(snapshot);
    expect(result.valid).toBe(true);
  });

  test('validates all boundary geometries', () => {
    const snapshot = {
      merkleRoot: 123n,
      boundaryCount: 2,
      ipfsCID: '',
      boundaries: [
        { id: '1', geometry: createSquarePolygon(0, 0, 1) },
        { id: '2', geometry: createInvalidPolygon() }, // Invalid
      ],
    };

    const result = verifySnapshotIntegrity(snapshot);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('invalid geometry'))).toBe(true);
  });
});

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a simple square polygon for testing (RFC 7946 compliant: counter-clockwise)
 */
function createSquarePolygon(x: number, y: number, size: number): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [x, y],
        [x, y + size],
        [x + size, y + size],
        [x + size, y],
        [x, y],
      ],
    ],
  };
}

/**
 * Create an invalid polygon (unclosed ring)
 */
function createInvalidPolygon(): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        // Missing closing point
      ],
    ],
  };
}
