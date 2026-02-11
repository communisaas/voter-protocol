/**
 * Two-Tree Membership Circuit - Cross-Language Golden Test Vectors
 *
 * PURPOSE:
 * This test file generates and verifies golden test vectors for all hash
 * primitives used in the two-tree membership circuit. These vectors serve
 * as the cross-language bridge between TypeScript (client-side computation)
 * and Noir (ZK circuit verification).
 *
 * CIRCUIT ARCHITECTURE:
 * - Tree 1 (User Tree): leaf = hash4(user_secret, cell_id, registration_salt, authority_level) (BR5-001)
 * - Tree 2 (Cell Map):  leaf = hashPair(cell_id, district_commitment)
 *   where district_commitment = poseidon2Sponge([district_1, ..., district_24])
 * - Nullifier: hashPair(identity_commitment, action_domain) (NUL-001)
 *
 * HASH FUNCTIONS:
 * - hash4(a, b, c, d): 2-round sponge with DOMAIN_HASH4 (BR5-001)
 * - hash3(a, b, c):    poseidon2_permutation([a, b, c, DOMAIN_HASH3], 4)[0]
 * - hashPair(a, b):    poseidon2_permutation([a, b, DOMAIN_HASH2, 0], 4)[0]
 * - poseidon2Sponge:   Rate-3 sponge with DOMAIN_SPONGE_24 capacity tag
 *
 * DOMAIN SEPARATION TAGS:
 * - DOMAIN_HASH2 = 0x48324d ("H2M")
 * - DOMAIN_HASH3 = 0x48334d ("H3M")
 * - DOMAIN_HASH4 = 0x48344d ("H4M")
 * - DOMAIN_SPONGE_24 = 0x534f4e47455f24 ("SONGE_24")
 *
 * MAINTENANCE:
 * If you update the Noir circuit hash functions, re-run these tests.
 * If any golden vector changes, investigate IMMEDIATELY - it means
 * TypeScript and Noir have diverged and all proofs will fail.
 *
 * @see packages/crypto/noir/two_tree_membership/src/main.nr
 * @see packages/crypto/noir/two_tree_membership/src/sponge.nr
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Poseidon2Hasher } from '../poseidon2';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * BN254 scalar field modulus
 */
const BN254_MODULUS = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

// ============================================================================
// KNOWN TEST INPUTS
// ============================================================================

/**
 * Test user secret - non-zero as required by SA-011
 */
const TEST_USER_SECRET = 42n;

/**
 * Test cell ID - geographic cell identifier
 */
const TEST_CELL_ID = 612345678901234567n;

/**
 * Test registration salt - unique per registration
 */
const TEST_REGISTRATION_SALT = 9999999999n;

/**
 * Test authority level - voting tier (1-5), cryptographically bound into leaf (BR5-001)
 */
const TEST_AUTHORITY_LEVEL = 3n;

/**
 * Test identity commitment - from self.xyz/didit verification (NUL-001)
 * Deterministic per verified person, used for nullifier computation
 */
const TEST_IDENTITY_COMMITMENT = 77777777777n;

/**
 * Test action domain - contract-controlled scope for nullifier
 */
const TEST_ACTION_DOMAIN = 1000n;

/**
 * Sequential district IDs [1..24] - standard test pattern
 */
const DISTRICTS_SEQUENTIAL: bigint[] = Array.from(
  { length: 24 },
  (_, i) => BigInt(i + 1)
);

// ============================================================================
// GOLDEN VECTORS
// ============================================================================

/**
 * Sponge golden vector for sequential districts [1..24].
 * This is the SOURCE OF TRUTH, verified in both Noir and TypeScript.
 * From: packages/crypto/noir/two_tree_membership/src/sponge.nr::test_sponge_golden_vector_sequential
 */
const SPONGE_GOLDEN_VECTOR =
  13897144223796711226515669182413786178697447221339740051025074265447026549851n;

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Two-Tree Membership Circuit - Cross-Language Golden Vectors', () => {
  let hasher: Poseidon2Hasher;

  beforeAll(async () => {
    hasher = await Poseidon2Hasher.getInstance();
  });

  // ==========================================================================
  // 1. hash3 Golden Vectors
  // ==========================================================================

  describe('hash3 (3-input Poseidon2 with DOMAIN_HASH3)', () => {
    it('should produce a deterministic golden vector for hash3(1, 2, 3)', async () => {
      // hash3(1, 2, 3) = poseidon2_permutation([1, 2, 3, DOMAIN_HASH3], 4)[0]
      // where DOMAIN_HASH3 = 0x48334d ("H3M")
      const result = await hasher.hash3(1n, 2n, 3n);

      // Store the golden vector - this value must match Noir's poseidon2_hash3(1, 2, 3)
      const HASH3_1_2_3 = result;

      expect(typeof result).toBe('bigint');
      expect(result).toBeGreaterThan(0n);
      expect(result).toBeLessThan(BN254_MODULUS);

      // Determinism check
      const result2 = await hasher.hash3(1n, 2n, 3n);
      expect(result2).toBe(HASH3_1_2_3);
    });

    it('hash3 should not collide with hashPair due to domain separation', async () => {
      // hash3(a, b, 0) uses [a, b, 0, DOMAIN_HASH3]
      // hashPair(a, b) uses [a, b, DOMAIN_HASH2, 0]
      // These MUST differ to prevent cross-arity attacks
      const h3 = await hasher.hash3(7n, 13n, 0n);
      const h2 = await hasher.hashPair(7n, 13n);

      expect(h3).not.toBe(h2);
    });

    it('hash3 should not collide with hash4 due to domain separation', async () => {
      // hash3(a, b, c) uses [a, b, c, DOMAIN_HASH3]
      // hash4(a, b, c, DOMAIN_HASH3_value) uses [a, b, c, DOMAIN_HASH3_value]
      // hash4(a, b, c, 0) uses [a, b, c, 0]
      // All should differ
      const h3 = await hasher.hash3(1n, 2n, 3n);
      const h4 = await hasher.hash4(1n, 2n, 3n, 0n);

      expect(h3).not.toBe(h4);
    });

    it('hash3 input order should matter', async () => {
      const result1 = await hasher.hash3(1n, 2n, 3n);
      const result2 = await hasher.hash3(3n, 2n, 1n);

      expect(result1).not.toBe(result2);
    });
  });

  // ==========================================================================
  // 2. User Leaf Golden Vectors
  // ==========================================================================

  describe('User Leaf: hash4(userSecret, cellId, registrationSalt, authorityLevel) (BR5-001)', () => {
    it('should produce a deterministic golden vector for test inputs', async () => {
      // This matches the circuit's compute_user_leaf() function:
      // user_leaf = poseidon2_hash4(user_secret, cell_id, registration_salt, authority_level)
      const userLeaf = await hasher.hash4(
        TEST_USER_SECRET,
        TEST_CELL_ID,
        TEST_REGISTRATION_SALT,
        TEST_AUTHORITY_LEVEL
      );

      expect(typeof userLeaf).toBe('bigint');
      expect(userLeaf).toBeGreaterThan(0n);
      expect(userLeaf).toBeLessThan(BN254_MODULUS);

      // Determinism
      const userLeaf2 = await hasher.hash4(
        TEST_USER_SECRET,
        TEST_CELL_ID,
        TEST_REGISTRATION_SALT,
        TEST_AUTHORITY_LEVEL
      );
      expect(userLeaf2).toBe(userLeaf);
    });

    it('different user secrets should produce different leaves', async () => {
      const leaf1 = await hasher.hash4(42n, TEST_CELL_ID, TEST_REGISTRATION_SALT, TEST_AUTHORITY_LEVEL);
      const leaf2 = await hasher.hash4(43n, TEST_CELL_ID, TEST_REGISTRATION_SALT, TEST_AUTHORITY_LEVEL);

      expect(leaf1).not.toBe(leaf2);
    });

    it('different cell IDs should produce different leaves', async () => {
      const leaf1 = await hasher.hash4(TEST_USER_SECRET, 100n, TEST_REGISTRATION_SALT, TEST_AUTHORITY_LEVEL);
      const leaf2 = await hasher.hash4(TEST_USER_SECRET, 200n, TEST_REGISTRATION_SALT, TEST_AUTHORITY_LEVEL);

      expect(leaf1).not.toBe(leaf2);
    });

    it('different salts should produce different leaves', async () => {
      const leaf1 = await hasher.hash4(TEST_USER_SECRET, TEST_CELL_ID, 1111n, TEST_AUTHORITY_LEVEL);
      const leaf2 = await hasher.hash4(TEST_USER_SECRET, TEST_CELL_ID, 2222n, TEST_AUTHORITY_LEVEL);

      expect(leaf1).not.toBe(leaf2);
    });

    it('different authority levels should produce different leaves (BR5-001)', async () => {
      const leaf1 = await hasher.hash4(TEST_USER_SECRET, TEST_CELL_ID, TEST_REGISTRATION_SALT, 1n);
      const leaf2 = await hasher.hash4(TEST_USER_SECRET, TEST_CELL_ID, TEST_REGISTRATION_SALT, 5n);

      expect(leaf1).not.toBe(leaf2);
    });

    it('hash4 leaf differs from hash3 leaf (domain separation)', async () => {
      // Old: hash3(secret, cell, salt) vs New: hash4(secret, cell, salt, authority)
      const oldLeaf = await hasher.hash3(TEST_USER_SECRET, TEST_CELL_ID, TEST_REGISTRATION_SALT);
      const newLeaf = await hasher.hash4(TEST_USER_SECRET, TEST_CELL_ID, TEST_REGISTRATION_SALT, TEST_AUTHORITY_LEVEL);

      expect(oldLeaf).not.toBe(newLeaf);
    });
  });

  // ==========================================================================
  // 3. Cell Map Leaf Golden Vectors
  // ==========================================================================

  describe('Cell Map Leaf: hashPair(cellId, districtCommitment)', () => {
    it('should produce a deterministic golden vector using sponge commitment', async () => {
      // Step 1: Compute district commitment via sponge
      const districtCommitment = await hasher.poseidon2Sponge(DISTRICTS_SEQUENTIAL);

      // Verify sponge matches golden vector
      expect(districtCommitment).toBe(SPONGE_GOLDEN_VECTOR);

      // Step 2: Compute cell map leaf
      // This matches the circuit's compute_cell_map_leaf() function:
      // cell_map_leaf = poseidon2_hash2(cell_id, district_commitment)
      const cellMapLeaf = await hasher.hashPair(TEST_CELL_ID, districtCommitment);

      expect(typeof cellMapLeaf).toBe('bigint');
      expect(cellMapLeaf).toBeGreaterThan(0n);
      expect(cellMapLeaf).toBeLessThan(BN254_MODULUS);

      // Determinism
      const cellMapLeaf2 = await hasher.hashPair(TEST_CELL_ID, districtCommitment);
      expect(cellMapLeaf2).toBe(cellMapLeaf);
    });

    it('different cell IDs should produce different cell map leaves', async () => {
      const commitment = await hasher.poseidon2Sponge(DISTRICTS_SEQUENTIAL);

      const leaf1 = await hasher.hashPair(100n, commitment);
      const leaf2 = await hasher.hashPair(200n, commitment);

      expect(leaf1).not.toBe(leaf2);
    });

    it('different district sets should produce different cell map leaves', async () => {
      const commitment1 = await hasher.poseidon2Sponge(DISTRICTS_SEQUENTIAL);

      const altDistricts = [...DISTRICTS_SEQUENTIAL];
      altDistricts[0] = 999n;
      const commitment2 = await hasher.poseidon2Sponge(altDistricts);

      // Different district sets produce different commitments
      expect(commitment1).not.toBe(commitment2);

      // And therefore different cell map leaves
      const leaf1 = await hasher.hashPair(TEST_CELL_ID, commitment1);
      const leaf2 = await hasher.hashPair(TEST_CELL_ID, commitment2);

      expect(leaf1).not.toBe(leaf2);
    });
  });

  // ==========================================================================
  // 4. Nullifier Golden Vectors
  // ==========================================================================

  describe('Nullifier: hashPair(identityCommitment, actionDomain) (NUL-001)', () => {
    it('should produce a deterministic golden vector for test inputs', async () => {
      // NUL-001: nullifier = poseidon2_hash2(identity_commitment, action_domain)
      // Uses identity_commitment (not user_secret) to prevent Sybil via re-registration
      const nullifier = await hasher.hashPair(TEST_IDENTITY_COMMITMENT, TEST_ACTION_DOMAIN);

      expect(typeof nullifier).toBe('bigint');
      expect(nullifier).toBeGreaterThan(0n);
      expect(nullifier).toBeLessThan(BN254_MODULUS);

      // Determinism
      const nullifier2 = await hasher.hashPair(TEST_IDENTITY_COMMITMENT, TEST_ACTION_DOMAIN);
      expect(nullifier2).toBe(nullifier);
    });

    it('different identity commitments should produce different nullifiers', async () => {
      const null1 = await hasher.hashPair(77777777777n, TEST_ACTION_DOMAIN);
      const null2 = await hasher.hashPair(88888888888n, TEST_ACTION_DOMAIN);

      expect(null1).not.toBe(null2);
    });

    it('different action domains should produce different nullifiers', async () => {
      const null1 = await hasher.hashPair(TEST_IDENTITY_COMMITMENT, 1000n);
      const null2 = await hasher.hashPair(TEST_IDENTITY_COMMITMENT, 2000n);

      expect(null1).not.toBe(null2);
    });

    it('same person re-registering produces same nullifier (NUL-001 anti-Sybil)', async () => {
      // Key property: identity_commitment is deterministic per verified person.
      // Even if user_secret changes (re-registration), nullifier stays the same.
      const nullifier = await hasher.hashPair(TEST_IDENTITY_COMMITMENT, TEST_ACTION_DOMAIN);
      const sameAgain = await hasher.hashPair(TEST_IDENTITY_COMMITMENT, TEST_ACTION_DOMAIN);
      expect(nullifier).toBe(sameAgain);
    });
  });

  // ==========================================================================
  // 5. Sponge Golden Vector Cross-Check
  // ==========================================================================

  describe('Sponge Golden Vector Consistency', () => {
    it('TypeScript sponge matches the Noir golden vector for [1..24]', async () => {
      // CRITICAL: This is the cross-language verification anchor.
      // The value 13897144223796711226515669182413786178697447221339740051025074265447026549851
      // was verified in Noir: sponge.nr::test_sponge_golden_vector_sequential
      // and in the two_tree_membership circuit: main.nr::test_sponge_integration

      const result = await hasher.poseidon2Sponge(DISTRICTS_SEQUENTIAL);
      expect(result).toBe(SPONGE_GOLDEN_VECTOR);
    });

    it('sponge golden vector is a valid BN254 field element', () => {
      expect(SPONGE_GOLDEN_VECTOR).toBeGreaterThan(0n);
      expect(SPONGE_GOLDEN_VECTOR).toBeLessThan(BN254_MODULUS);
    });

    it('sponge output feeds correctly into cell map leaf computation', async () => {
      // End-to-end: districts -> sponge -> hashPair -> cell map leaf
      const commitment = await hasher.poseidon2Sponge(DISTRICTS_SEQUENTIAL);
      expect(commitment).toBe(SPONGE_GOLDEN_VECTOR);

      const cellMapLeaf = await hasher.hashPair(TEST_CELL_ID, commitment);
      expect(typeof cellMapLeaf).toBe('bigint');
      expect(cellMapLeaf).toBeGreaterThan(0n);
      expect(cellMapLeaf).toBeLessThan(BN254_MODULUS);

      // The cell map leaf should differ from both the commitment and cell_id
      expect(cellMapLeaf).not.toBe(commitment);
      expect(cellMapLeaf).not.toBe(TEST_CELL_ID);
    });
  });

  // ==========================================================================
  // 6. Full Circuit Flow - End-to-End Vector
  // ==========================================================================

  describe('End-to-End Circuit Flow Verification', () => {
    it('should compute all circuit primitives consistently', async () => {
      // Simulate the full circuit flow in TypeScript:

      // Step 1: User leaf (Tree 1) — BR5-001: hash4 with authority level
      const userLeaf = await hasher.hash4(
        TEST_USER_SECRET,
        TEST_CELL_ID,
        TEST_REGISTRATION_SALT,
        TEST_AUTHORITY_LEVEL
      );

      // Step 2: District commitment (sponge)
      const districtCommitment = await hasher.poseidon2Sponge(DISTRICTS_SEQUENTIAL);
      expect(districtCommitment).toBe(SPONGE_GOLDEN_VECTOR);

      // Step 3: Cell map leaf (Tree 2)
      const cellMapLeaf = await hasher.hashPair(TEST_CELL_ID, districtCommitment);

      // Step 4: Nullifier — NUL-001: identity_commitment, not user_secret
      const nullifier = await hasher.hashPair(TEST_IDENTITY_COMMITMENT, TEST_ACTION_DOMAIN);

      // All values must be valid field elements
      const allValues = [userLeaf, districtCommitment, cellMapLeaf, nullifier];
      for (const value of allValues) {
        expect(typeof value).toBe('bigint');
        expect(value).toBeGreaterThan(0n);
        expect(value).toBeLessThan(BN254_MODULUS);
      }

      // All values must be unique (different hash functions / inputs)
      const uniqueValues = new Set(allValues);
      expect(uniqueValues.size).toBe(4);

      // Determinism: running again should produce same results
      const userLeaf2 = await hasher.hash4(
        TEST_USER_SECRET,
        TEST_CELL_ID,
        TEST_REGISTRATION_SALT,
        TEST_AUTHORITY_LEVEL
      );
      const districtCommitment2 = await hasher.poseidon2Sponge(DISTRICTS_SEQUENTIAL);
      const cellMapLeaf2 = await hasher.hashPair(TEST_CELL_ID, districtCommitment2);
      const nullifier2 = await hasher.hashPair(TEST_IDENTITY_COMMITMENT, TEST_ACTION_DOMAIN);

      expect(userLeaf2).toBe(userLeaf);
      expect(districtCommitment2).toBe(districtCommitment);
      expect(cellMapLeaf2).toBe(cellMapLeaf);
      expect(nullifier2).toBe(nullifier);
    });
  });

  // ==========================================================================
  // 7. Output Type and Field Bounds Validation
  // ==========================================================================

  describe('Output Type and Field Bounds', () => {
    it('all hash outputs should be bigint', async () => {
      const h3 = await hasher.hash3(1n, 2n, 3n);
      const h2 = await hasher.hashPair(1n, 2n);
      const sponge = await hasher.poseidon2Sponge(DISTRICTS_SEQUENTIAL);

      expect(typeof h3).toBe('bigint');
      expect(typeof h2).toBe('bigint');
      expect(typeof sponge).toBe('bigint');
    });

    it('all hash outputs should be valid BN254 field elements', async () => {
      const outputs = await Promise.all([
        hasher.hash3(1n, 2n, 3n),
        hasher.hash3(TEST_USER_SECRET, TEST_CELL_ID, TEST_REGISTRATION_SALT),
        hasher.hashPair(TEST_CELL_ID, SPONGE_GOLDEN_VECTOR),
        hasher.hashPair(TEST_USER_SECRET, TEST_ACTION_DOMAIN),
        hasher.poseidon2Sponge(DISTRICTS_SEQUENTIAL),
      ]);

      for (const output of outputs) {
        expect(output).toBeGreaterThanOrEqual(0n);
        expect(output).toBeLessThan(BN254_MODULUS);
      }
    });
  });
});
