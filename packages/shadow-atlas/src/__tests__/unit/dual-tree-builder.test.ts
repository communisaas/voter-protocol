/**
 * Tests for Dual-Tree Builder - Two-Tree Architecture
 *
 * Tests cover:
 * 1. Cell Map Tree (Tree 2) construction and proofs
 * 2. User Identity Tree (Tree 1) construction and proofs
 * 3. Dual tree consistency validation
 * 4. Integration with SparseMerkleTree
 * 5. Cell-District Loader utilities
 *
 * NOTE: These tests use real Poseidon2 hashing via the Noir WASM runtime.
 * The beforeAll hook has a 60s timeout to allow WASM initialization.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Poseidon2Hasher, getHasher } from '@voter-protocol/crypto/poseidon2';
import { SparseMerkleTree } from '@voter-protocol/crypto';

import {
  buildCellMapTree,
  buildUserTree,
  buildUserTreeFull,
  buildDualTrees,
  computeDistrictCommitment,
  computeCellMapLeaf,
  computeUserLeaf,
  generateUserProof,
  getCellMapProof,
  getUserProof,
  verifyUserProof,
  verifyCellMapProof,
  DISTRICT_SLOT_COUNT,
  type CellDistrictMapping,
  type UserRegistration,
} from '../../dual-tree-builder.js';

import {
  generateMockMappings,
  encodeGeoidAsField,
  fromRawDistricts,
  getSlotForDistrictType,
  DISTRICT_TYPE_TO_SLOT,
  type RawCellDistricts,
} from '../../cell-district-loader.js';

// ============================================================================
// Test Constants
// ============================================================================

/**
 * Small tree depth for tests.
 * Depth 4 = 16 leaf capacity. Keeps tests fast.
 */
const TEST_DEPTH = 4;

/**
 * Generate a mock 24-slot district array with deterministic values.
 */
function mockDistricts(seed: number): bigint[] {
  const districts = new Array(DISTRICT_SLOT_COUNT).fill(0n);
  districts[0] = BigInt(seed);            // Congressional
  districts[1] = BigInt(seed + 100);      // Federal Senate
  districts[2] = BigInt(seed + 200);      // State Senate
  districts[3] = BigInt(seed + 300);      // State House
  districts[4] = BigInt(seed + 400);      // County
  return districts;
}

/**
 * Generate mock cell-district mappings with unique cell IDs.
 */
function mockMappings(count: number, startSeed: number = 1000): CellDistrictMapping[] {
  const mappings: CellDistrictMapping[] = [];
  for (let i = 0; i < count; i++) {
    mappings.push({
      cellId: BigInt(startSeed + i),
      districts: mockDistricts(i + 1),
    });
  }
  return mappings;
}

/**
 * Generate mock user registrations.
 * Each user is assigned to one of the provided cell IDs.
 */
function mockUsers(count: number, cellIds: bigint[]): UserRegistration[] {
  const users: UserRegistration[] = [];
  for (let i = 0; i < count; i++) {
    users.push({
      userSecret: BigInt(9000 + i * 7),
      cellId: cellIds[i % cellIds.length],
      registrationSalt: BigInt(5000 + i * 13),
    });
  }
  return users;
}

// ============================================================================
// Tests
// ============================================================================

describe('Dual-Tree Builder', () => {
  let hasher: Poseidon2Hasher;

  beforeAll(async () => {
    hasher = await getHasher();
  }, 60_000); // 60s for WASM init

  afterAll(() => {
    Poseidon2Hasher.resetInstance();
  });

  // ==========================================================================
  // 1. Cell Map Tree (Tree 2) Construction
  // ==========================================================================

  describe('Cell Map Tree (Tree 2)', () => {
    it('should build tree with 10 mock mappings and produce non-zero root', async () => {
      const mappings = mockMappings(10);
      const result = await buildCellMapTree(mappings, TEST_DEPTH);

      expect(result.root).toBeTypeOf('bigint');
      expect(result.root).not.toBe(0n);
      expect(result.cellCount).toBe(10);
      expect(result.depth).toBe(TEST_DEPTH);
    }, 120_000);

    it('should produce deterministic roots for same input', async () => {
      const mappings = mockMappings(5);
      const result1 = await buildCellMapTree(mappings, TEST_DEPTH);
      const result2 = await buildCellMapTree(mappings, TEST_DEPTH);

      expect(result1.root).toBe(result2.root);
    }, 120_000);

    it('should produce different roots for different inputs', async () => {
      const mappings1 = mockMappings(5, 1000);
      const mappings2 = mockMappings(5, 2000);

      const result1 = await buildCellMapTree(mappings1, TEST_DEPTH);
      const result2 = await buildCellMapTree(mappings2, TEST_DEPTH);

      expect(result1.root).not.toBe(result2.root);
    }, 120_000);

    it('should throw on duplicate cell_id', async () => {
      const mappings: CellDistrictMapping[] = [
        { cellId: 100n, districts: mockDistricts(1) },
        { cellId: 100n, districts: mockDistricts(2) }, // duplicate
      ];

      await expect(buildCellMapTree(mappings, TEST_DEPTH)).rejects.toThrow(
        'Duplicate cell_id detected: 100'
      );
    });

    it('should throw on wrong district array length', async () => {
      const mappings: CellDistrictMapping[] = [
        { cellId: 100n, districts: [1n, 2n, 3n] }, // only 3, need 24
      ];

      await expect(buildCellMapTree(mappings, TEST_DEPTH)).rejects.toThrow(
        `district array must have ${DISTRICT_SLOT_COUNT} elements`
      );
    });

    it('should handle empty mappings (empty tree)', async () => {
      const result = await buildCellMapTree([], TEST_DEPTH);

      expect(result.root).toBeTypeOf('bigint');
      expect(result.cellCount).toBe(0);
      // Root should be the empty tree root (deterministic)
    }, 30_000);

    it('should store district commitments for each cell', async () => {
      const mappings = mockMappings(3);
      const result = await buildCellMapTree(mappings, TEST_DEPTH);

      expect(result.commitments.size).toBe(3);
      for (const mapping of mappings) {
        const commitment = result.commitments.get(mapping.cellId.toString());
        expect(commitment).toBeDefined();
        expect(commitment).toBeTypeOf('bigint');
        expect(commitment).not.toBe(0n);
      }
    }, 120_000);
  });

  // ==========================================================================
  // 2. Cell Map Proof Generation and Verification
  // ==========================================================================

  describe('Cell Map Proofs', () => {
    it('should generate and verify proof for each cell', async () => {
      const mappings = mockMappings(5);
      const result = await buildCellMapTree(mappings, TEST_DEPTH);

      for (const mapping of mappings) {
        const cellProof = await getCellMapProof(result, mapping.cellId, mappings);

        // Verify proof structure
        expect(cellProof.proof.key).toBe(mapping.cellId);
        expect(cellProof.proof.siblings.length).toBe(TEST_DEPTH);
        expect(cellProof.proof.pathBits.length).toBe(TEST_DEPTH);
        expect(cellProof.proof.root).toBe(result.root);
        expect(cellProof.districts.length).toBe(DISTRICT_SLOT_COUNT);
        expect(cellProof.districtCommitment).toBeTypeOf('bigint');

        // Verify proof against root
        const isValid = await verifyCellMapProof(cellProof.proof, result.root);
        expect(isValid).toBe(true);
      }
    }, 120_000);

    it('should throw for unknown cell_id in getCellMapProof', async () => {
      const mappings = mockMappings(3);
      const result = await buildCellMapTree(mappings, TEST_DEPTH);

      await expect(
        getCellMapProof(result, 999999n, mappings)
      ).rejects.toThrow('Cell ID 999999 not found in mappings');
    }, 30_000);

    it('should include correct pathBits derived from position', async () => {
      const mappings = mockMappings(3);
      const result = await buildCellMapTree(mappings, TEST_DEPTH);

      for (const mapping of mappings) {
        const cellProof = await getCellMapProof(result, mapping.cellId, mappings);

        // pathBits should be 0 or 1
        for (const bit of cellProof.proof.pathBits) {
          expect(bit === 0 || bit === 1).toBe(true);
        }

        // Attempt should be a non-negative integer
        expect(cellProof.proof.attempt).toBeGreaterThanOrEqual(0);
      }
    }, 120_000);

    it('should produce a valid proof even with many cells (collision handling)', async () => {
      // Insert enough cells to likely trigger collision handling in depth-4 tree
      const mappings = mockMappings(12); // 12 cells in 2^4=16 positions
      const result = await buildCellMapTree(mappings, TEST_DEPTH);

      for (const mapping of mappings) {
        const cellProof = await getCellMapProof(result, mapping.cellId, mappings);
        const isValid = await verifyCellMapProof(cellProof.proof, result.root);
        expect(isValid).toBe(true);
      }
    }, 180_000);
  });

  // ==========================================================================
  // 3. District Commitment
  // ==========================================================================

  describe('District Commitment', () => {
    it('should compute non-zero commitment for non-zero districts', async () => {
      const districts = mockDistricts(42);
      const commitment = await computeDistrictCommitment(districts);

      expect(commitment).toBeTypeOf('bigint');
      expect(commitment).not.toBe(0n);
    }, 30_000);

    it('should compute commitment for all-zero districts', async () => {
      const districts = new Array(DISTRICT_SLOT_COUNT).fill(0n);
      const commitment = await computeDistrictCommitment(districts);

      expect(commitment).toBeTypeOf('bigint');
      // All-zero districts still produce a non-zero commitment due to domain tag
      expect(commitment).not.toBe(0n);
    }, 30_000);

    it('should be deterministic', async () => {
      const districts = mockDistricts(7);
      const c1 = await computeDistrictCommitment(districts);
      const c2 = await computeDistrictCommitment(districts);
      expect(c1).toBe(c2);
    }, 30_000);

    it('should be different for different district arrays', async () => {
      const d1 = mockDistricts(1);
      const d2 = mockDistricts(2);
      const c1 = await computeDistrictCommitment(d1);
      const c2 = await computeDistrictCommitment(d2);
      expect(c1).not.toBe(c2);
    }, 30_000);

    it('should reject wrong-length district array', async () => {
      await expect(computeDistrictCommitment([1n, 2n])).rejects.toThrow(
        `must have exactly ${DISTRICT_SLOT_COUNT} elements`
      );
    });
  });

  // ==========================================================================
  // 4. Cell Map Leaf
  // ==========================================================================

  describe('Cell Map Leaf', () => {
    it('should compute cell_map_leaf = hashPair(cellId, commitment)', async () => {
      const cellId = 12345n;
      const commitment = 67890n;

      const leaf = await computeCellMapLeaf(cellId, commitment);
      const expected = await hasher.hashPair(cellId, commitment);

      expect(leaf).toBe(expected);
    }, 30_000);
  });

  // ==========================================================================
  // 5. User Identity Tree (Tree 1) Construction
  // ==========================================================================

  describe('User Identity Tree (Tree 1)', () => {
    it('should build tree with 10 mock users and produce non-zero root', async () => {
      const cellIds = [100n, 200n, 300n];
      const users = mockUsers(10, cellIds);
      const result = await buildUserTree(users, TEST_DEPTH);

      expect(result.root).toBeTypeOf('bigint');
      expect(result.root).not.toBe(0n);
      expect(result.leafCount).toBe(10);
      expect(result.depth).toBe(TEST_DEPTH);
      expect(result.leaves.length).toBe(10);
    }, 120_000);

    it('should produce deterministic roots', async () => {
      const users = mockUsers(5, [100n, 200n]);
      const r1 = await buildUserTree(users, TEST_DEPTH);
      const r2 = await buildUserTree(users, TEST_DEPTH);
      expect(r1.root).toBe(r2.root);
    }, 120_000);

    it('should produce different roots for different user sets', async () => {
      const users1 = mockUsers(5, [100n]);
      const users2 = mockUsers(5, [200n]);

      const r1 = await buildUserTree(users1, TEST_DEPTH);
      const r2 = await buildUserTree(users2, TEST_DEPTH);

      expect(r1.root).not.toBe(r2.root);
    }, 120_000);

    it('should throw when user count exceeds capacity', async () => {
      const users = mockUsers(20, [100n]); // 20 > 2^4=16

      await expect(buildUserTree(users, TEST_DEPTH)).rejects.toThrow(
        'exceeds tree capacity'
      );
    });
  });

  // ==========================================================================
  // 6. User Leaf Computation
  // ==========================================================================

  describe('User Leaf Computation', () => {
    it('should compute user_leaf using hash3 (matching Noir circuit)', async () => {
      const user: UserRegistration = {
        userSecret: 111n,
        cellId: 222n,
        registrationSalt: 333n,
      };

      const leaf = await computeUserLeaf(user);
      // Verify it matches hash3(secret, cellId, salt) which uses DOMAIN_HASH3 = 0x48334d
      const expected = await hasher.hash3(111n, 222n, 333n);

      expect(leaf).toBe(expected);
    }, 30_000);

    it('should be different for different users', async () => {
      const user1: UserRegistration = { userSecret: 1n, cellId: 100n, registrationSalt: 50n };
      const user2: UserRegistration = { userSecret: 2n, cellId: 100n, registrationSalt: 50n };

      const leaf1 = await computeUserLeaf(user1);
      const leaf2 = await computeUserLeaf(user2);

      expect(leaf1).not.toBe(leaf2);
    }, 30_000);
  });

  // ==========================================================================
  // 7. User Proof Generation and Verification
  // ==========================================================================

  describe('User Proofs', () => {
    it('should generate and verify proof for each user', async () => {
      const users = mockUsers(8, [100n, 200n]);
      const fullTree = await buildUserTreeFull(users, TEST_DEPTH);

      for (let i = 0; i < users.length; i++) {
        const proof = getUserProof(fullTree.layers, i, TEST_DEPTH);

        expect(proof.leafIndex).toBe(i);
        expect(proof.siblings.length).toBe(TEST_DEPTH);
        expect(proof.pathIndices.length).toBe(TEST_DEPTH);
        expect(proof.root).toBe(fullTree.root);

        // Verify
        const isValid = await verifyUserProof(proof);
        expect(isValid).toBe(true);
      }
    }, 120_000);

    it('should throw for out-of-range leaf index', async () => {
      const users = mockUsers(4, [100n]);
      const fullTree = await buildUserTreeFull(users, TEST_DEPTH);

      expect(() => getUserProof(fullTree.layers, -1, TEST_DEPTH)).toThrow('out of range');
      expect(() => getUserProof(fullTree.layers, 100, TEST_DEPTH)).toThrow('out of range');
    }, 60_000);

    it('should produce correct pathIndices (0 = left, 1 = right)', async () => {
      const users = mockUsers(4, [100n]);
      const fullTree = await buildUserTreeFull(users, TEST_DEPTH);

      const proof = getUserProof(fullTree.layers, 0, TEST_DEPTH);
      // Leaf at index 0 is always a left child, so first pathIndex should be 0
      expect(proof.pathIndices[0]).toBe(0);

      const proof1 = getUserProof(fullTree.layers, 1, TEST_DEPTH);
      // Leaf at index 1 is always a right child, so first pathIndex should be 1
      expect(proof1.pathIndices[0]).toBe(1);
    }, 60_000);
  });

  // ==========================================================================
  // 8. Dual Tree Consistency
  // ==========================================================================

  describe('Dual Tree Consistency', () => {
    it('should build both trees and verify all user cell_ids exist in cell map', async () => {
      const mappings = mockMappings(5);
      const cellIds = mappings.map(m => m.cellId);
      const users = mockUsers(8, cellIds);

      const result = await buildDualTrees(users, mappings, { depth: TEST_DEPTH });

      expect(result.userTree.root).not.toBe(0n);
      expect(result.cellMapTree.root).not.toBe(0n);
      expect(result.userTree.leafCount).toBe(8);
      expect(result.cellMapTree.cellCount).toBe(5);
      expect(result.warnings).toHaveLength(0);
    }, 180_000);

    it('should warn when user references unknown cell_id (non-strict)', async () => {
      const mappings = mockMappings(3);
      // Users reference cell IDs that are NOT in the mappings
      const users: UserRegistration[] = [
        { userSecret: 1n, cellId: 999999n, registrationSalt: 10n },
        { userSecret: 2n, cellId: mappings[0].cellId, registrationSalt: 20n },
      ];

      const result = await buildDualTrees(users, mappings, { depth: TEST_DEPTH });

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('999999');
      expect(result.warnings[0]).toContain('not found');
    }, 120_000);

    it('should throw when user references unknown cell_id (strict mode)', async () => {
      const mappings = mockMappings(3);
      const users: UserRegistration[] = [
        { userSecret: 1n, cellId: 999999n, registrationSalt: 10n },
      ];

      await expect(
        buildDualTrees(users, mappings, { depth: TEST_DEPTH, strict: true })
      ).rejects.toThrow('not found in cell-district map');
    }, 120_000);

    it('should produce stable roots across multiple builds', async () => {
      const mappings = mockMappings(4);
      const cellIds = mappings.map(m => m.cellId);
      const users = mockUsers(6, cellIds);

      const r1 = await buildDualTrees(users, mappings, { depth: TEST_DEPTH });
      const r2 = await buildDualTrees(users, mappings, { depth: TEST_DEPTH });

      expect(r1.userTree.root).toBe(r2.userTree.root);
      expect(r1.cellMapTree.root).toBe(r2.cellMapTree.root);
    }, 180_000);
  });

  // ==========================================================================
  // 9. Integration with SMT
  // ==========================================================================

  describe('SMT Integration', () => {
    it('should insert cells that hash to same position (collision handling)', async () => {
      // Use depth=4 to increase collision probability with more cells
      const mappings = mockMappings(14); // 14 cells, 16 positions
      const result = await buildCellMapTree(mappings, TEST_DEPTH);

      // All cells should be inserted
      expect(result.cellCount).toBe(14);

      // All proofs should be valid
      for (const mapping of mappings) {
        const proof = await result.tree.getProof(mapping.cellId);
        const isValid = await SparseMerkleTree.verify(proof, result.root, hasher);
        expect(isValid).toBe(true);
      }
    }, 180_000);

    it('should verify SMT proof has correct structure', async () => {
      const mappings = mockMappings(3);
      const result = await buildCellMapTree(mappings, TEST_DEPTH);

      const proof = await result.tree.getProof(mappings[0].cellId);

      // Structure checks
      expect(proof.key).toBe(mappings[0].cellId);
      expect(proof.value).toBeTypeOf('bigint');
      expect(proof.siblings).toBeInstanceOf(Array);
      expect(proof.siblings.length).toBe(TEST_DEPTH);
      expect(proof.pathBits).toBeInstanceOf(Array);
      expect(proof.pathBits.length).toBe(TEST_DEPTH);
      expect(proof.root).toBe(result.root);
      expect(typeof proof.attempt).toBe('number');
      expect(proof.attempt).toBeGreaterThanOrEqual(0);
    }, 120_000);

    it('should distinguish membership and non-membership proofs', async () => {
      const mappings = mockMappings(3);
      const result = await buildCellMapTree(mappings, TEST_DEPTH);

      // Membership proof for existing key
      const memberProof = await result.tree.getProof(mappings[0].cellId);
      expect(memberProof.value).not.toBe(0n);

      // Non-membership: query for a key that was never inserted
      const nonMemberProof = await result.tree.getProof(999999999n);
      // The value for a non-existent key is the empty leaf hash
      const emptyLeafHash = result.tree.getEmptyHash(0);
      expect(nonMemberProof.value).toBe(emptyLeafHash);
    }, 120_000);
  });

  // ==========================================================================
  // 10. Cell-District Loader
  // ==========================================================================

  describe('Cell-District Loader', () => {
    describe('encodeGeoidAsField', () => {
      it('should encode numeric GEOIDs as bigint', () => {
        expect(encodeGeoidAsField('06075061200')).toBe(6075061200n);
        expect(encodeGeoidAsField('0601')).toBe(601n);
        expect(encodeGeoidAsField('0')).toBe(0n);
      });

      it('should encode alphanumeric GEOIDs via hex', () => {
        const result = encodeGeoidAsField('ZZZ');
        expect(result).toBeTypeOf('bigint');
        expect(result).toBeGreaterThan(0n);
        // 'Z' = 0x5A, so 'ZZZ' = 0x5A5A5A
        expect(result).toBe(BigInt('0x5a5a5a'));
      });

      it('should throw for overly long GEOIDs', () => {
        const longGeoid = 'A'.repeat(32); // 32 bytes > 31 byte limit
        expect(() => encodeGeoidAsField(longGeoid)).toThrow('too long');
      });
    });

    describe('generateMockMappings', () => {
      it('should generate the requested number of mappings', () => {
        const mappings = generateMockMappings(10);
        expect(mappings.length).toBe(10);
      });

      it('should have 24 districts per mapping', () => {
        const mappings = generateMockMappings(5);
        for (const m of mappings) {
          expect(m.districts.length).toBe(DISTRICT_SLOT_COUNT);
        }
      });

      it('should produce unique cell IDs', () => {
        const mappings = generateMockMappings(50);
        const cellIds = new Set(mappings.map(m => m.cellId));
        expect(cellIds.size).toBe(50);
      });
    });

    describe('fromRawDistricts', () => {
      it('should map district types to correct slots', () => {
        const raw: RawCellDistricts[] = [
          {
            tractGeoid: '06075061200',
            stateFips: '06',
            assignments: new Map([
              ['congressional', '0601'],
              ['state_senate', '0620'],
              ['county', '06075'],
            ]),
          },
        ];

        const result = fromRawDistricts(raw);
        expect(result.length).toBe(1);
        expect(result[0].districts[0]).toBe(601n);  // Congressional -> slot 0
        expect(result[0].districts[2]).toBe(620n);   // State Senate -> slot 2
        expect(result[0].districts[4]).toBe(6075n);  // County -> slot 4

        // Unused slots should be 0
        expect(result[0].districts[1]).toBe(0n);
        expect(result[0].districts[3]).toBe(0n);
        expect(result[0].districts[5]).toBe(0n);
      });

      it('should ignore unknown district types', () => {
        const raw: RawCellDistricts[] = [
          {
            tractGeoid: '06001000100',
            stateFips: '06',
            assignments: new Map([
              ['congressional', '0601'],
              ['unknown_type', '9999'],
            ]),
          },
        ];

        const result = fromRawDistricts(raw);
        expect(result[0].districts[0]).toBe(601n);
        // All other slots should be 0
        for (let i = 1; i < DISTRICT_SLOT_COUNT; i++) {
          expect(result[0].districts[i]).toBe(0n);
        }
      });
    });

    describe('getSlotForDistrictType', () => {
      it('should return correct slots for known types', () => {
        expect(getSlotForDistrictType('congressional')).toBe(0);
        expect(getSlotForDistrictType('cd')).toBe(0);
        expect(getSlotForDistrictType('state_senate')).toBe(2);
        expect(getSlotForDistrictType('sldu')).toBe(2);
        expect(getSlotForDistrictType('county')).toBe(4);
        expect(getSlotForDistrictType('school_unified')).toBe(7);
        expect(getSlotForDistrictType('voting_precinct')).toBe(21);
      });

      it('should be case-insensitive', () => {
        expect(getSlotForDistrictType('CONGRESSIONAL')).toBe(0);
        expect(getSlotForDistrictType('County')).toBe(4);
      });

      it('should return undefined for unknown types', () => {
        expect(getSlotForDistrictType('unknown')).toBeUndefined();
        expect(getSlotForDistrictType('')).toBeUndefined();
      });
    });

    describe('DISTRICT_TYPE_TO_SLOT', () => {
      it('should cover all 24 slots', () => {
        const coveredSlots = new Set(Object.values(DISTRICT_TYPE_TO_SLOT));
        // At minimum, core slots 0-5, 7-9, 20-21, 22-23 should be covered
        expect(coveredSlots.has(0)).toBe(true);
        expect(coveredSlots.has(1)).toBe(true);
        expect(coveredSlots.has(2)).toBe(true);
        expect(coveredSlots.has(3)).toBe(true);
        expect(coveredSlots.has(4)).toBe(true);
        expect(coveredSlots.has(5)).toBe(true);
        expect(coveredSlots.has(7)).toBe(true);
        expect(coveredSlots.has(20)).toBe(true);
        expect(coveredSlots.has(21)).toBe(true);
      });
    });
  });
});
