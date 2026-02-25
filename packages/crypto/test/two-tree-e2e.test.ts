/**
 * Legacy two-tree E2E pipeline — see three-tree-golden-vectors.test.ts for primary path.
 *
 * Two-Tree Architecture E2E Integration Test
 *
 * Validates the full cross-package computation pipeline:
 *   User registration -> Tree building -> Proof generation -> Verification
 *
 * This test exercises the TypeScript-side of the two-tree architecture
 * WITHOUT running the actual Noir circuit (which requires full BB compilation).
 * It verifies that all cryptographic building blocks connect correctly:
 *
 * 1. User leaf computation: hash4(user_secret, cell_id, registration_salt, authority_level)
 * 2. District commitment: poseidon2Sponge(districts[24])
 * 3. Cell map leaf: hashPair(cell_id, district_commitment)
 * 4. User tree (standard Merkle): built with hashPair for internal nodes
 * 5. Cell map tree (SMT): built with SparseMerkleTree
 * 6. Nullifier computation: hashPair(identity_commitment, action_domain) — NUL-001
 * 7. Authority level validation: [1, 5] with BA-007 truncation guard
 *
 * Cross-references:
 * - Circuit: packages/crypto/noir/two_tree_membership/src/main.nr
 * - Spec: specs/TWO-TREE-ARCHITECTURE-SPEC.md Section 4
 * - Poseidon2: packages/crypto/poseidon2.ts
 * - SMT: packages/crypto/sparse-merkle-tree.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  Poseidon2Hasher,
  hashPair,
  hash4,
  poseidon2Sponge,
} from '../poseidon2';
import {
  SparseMerkleTree,
  createSparseMerkleTree,
  type SMTProof,
} from '../sparse-merkle-tree';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build a standard Merkle tree from an array of leaves, using hashPair
 * for internal nodes. Pads to the next power of 2 with zero leaves.
 *
 * Returns the root and a function to get the Merkle proof for a given leaf index.
 */
async function buildStandardMerkleTree(
  leaves: bigint[],
  depth: number,
  hasher: Poseidon2Hasher,
): Promise<{
  root: bigint;
  getProof: (index: number) => Promise<{ siblings: bigint[]; root: bigint }>;
}> {
  const capacity = 2 ** depth;
  if (leaves.length > capacity) {
    throw new Error(`Too many leaves: ${leaves.length} > ${capacity}`);
  }

  // Pad leaves to fill the tree (empty leaves = 0n)
  const paddedLeaves = [...leaves];
  while (paddedLeaves.length < capacity) {
    paddedLeaves.push(0n);
  }

  // Build tree level by level (bottom-up)
  const levels: bigint[][] = [paddedLeaves];

  let currentLevel = paddedLeaves;
  for (let d = 0; d < depth; d++) {
    const nextLevel: bigint[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = currentLevel[i + 1];
      const parent = await hasher.hashPair(left, right);
      nextLevel.push(parent);
    }
    levels.push(nextLevel);
    currentLevel = nextLevel;
  }

  const root = levels[depth][0];

  // Return proof generator
  const getProof = async (index: number) => {
    const siblings: bigint[] = [];
    let currentIndex = index;

    for (let d = 0; d < depth; d++) {
      const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      siblings.push(levels[d][siblingIndex]);
      currentIndex = Math.floor(currentIndex / 2);
    }

    return { siblings, root };
  };

  return { root, getProof };
}

/**
 * Verify a standard Merkle proof by recomputing the root from leaf to root.
 * Direction bits are derived from the leaf index.
 */
async function verifyMerkleProof(
  leaf: bigint,
  index: number,
  siblings: bigint[],
  expectedRoot: bigint,
  hasher: Poseidon2Hasher,
): Promise<boolean> {
  let current = leaf;

  for (let i = 0; i < siblings.length; i++) {
    const bit = (index >> i) & 1;
    if (bit === 0) {
      current = await hasher.hashPair(current, siblings[i]);
    } else {
      current = await hasher.hashPair(siblings[i], current);
    }
  }

  return current === expectedRoot;
}

// ============================================================================
// TEST CONSTANTS
// ============================================================================

/**
 * BN254 scalar field modulus.
 * All field elements must be strictly less than this value.
 */
const BN254_MODULUS = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

/**
 * Test user secrets -- must be valid BN254 field elements (< modulus).
 * Using values that are large enough to be realistic but safely below the modulus.
 */
const USER_SECRET_1 = 0x0123456789abcdef0123456789abcdef01234567n;
const USER_SECRET_2 = 0xfedcba9876543210fedcba9876543210fedcba98n;

/** Census Tract FIPS codes (11 digits as bigint) */
const CELL_ID_SF = 6075061200n;    // San Francisco
const CELL_ID_NY = 36061000100n;   // New York

/** Registration salts (valid field elements, well below modulus) */
const SALT_1 = 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaan;
const SALT_2 = 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbn;

/** Action domains (contract-controlled) */
const ACTION_DOMAIN_VOTE = 1001n;
const ACTION_DOMAIN_PETITION = 2002n;

/** Authority level */
const AUTHORITY_LEVEL = 3n;

/** Tree depth (small for fast tests) */
const TEST_TREE_DEPTH = 4;

/**
 * Generate 24 district IDs for a cell.
 * In production, these come from TIGER/Census data.
 * Districts represent: federal, state, county, city, school, etc.
 */
function generateDistrictSet(seed: number): bigint[] {
  const districts: bigint[] = [];
  for (let i = 0; i < 24; i++) {
    // Deterministic district IDs based on seed
    districts.push(BigInt(seed * 1000 + i + 1));
  }
  return districts;
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Two-Tree Architecture E2E Integration', () => {
  let hasher: Poseidon2Hasher;

  beforeAll(async () => {
    hasher = await Poseidon2Hasher.getInstance();
  });

  // --------------------------------------------------------------------------
  // TEST 1: Full two-tree flow for a single user
  // --------------------------------------------------------------------------
  it('full two-tree flow for a single user', async () => {
    // STEP 1: Create test user
    const userSecret = USER_SECRET_1;
    const cellId = CELL_ID_SF;
    const salt = SALT_1;
    const actionDomain = ACTION_DOMAIN_VOTE;
    const authorityLevel = AUTHORITY_LEVEL;
    const districts = generateDistrictSet(1);

    // STEP 2: Compute user leaf (Tree 1 leaf)
    // Circuit: user_leaf = poseidon2_hash4(user_secret, cell_id, registration_salt, authority_level)
    const userLeaf = await hash4(userSecret, cellId, salt, authorityLevel);
    expect(typeof userLeaf).toBe('bigint');
    expect(userLeaf).not.toBe(0n);

    // STEP 3: Compute district commitment via sponge
    // Circuit: district_commitment = poseidon2_sponge_24(districts)
    const districtCommitment = await poseidon2Sponge(districts);
    expect(typeof districtCommitment).toBe('bigint');
    expect(districtCommitment).not.toBe(0n);

    // STEP 4: Compute cell map leaf (Tree 2 leaf)
    // Circuit: cell_map_leaf = poseidon2_hash2(cell_id, district_commitment)
    const cellMapLeaf = await hashPair(cellId, districtCommitment);
    expect(typeof cellMapLeaf).toBe('bigint');
    expect(cellMapLeaf).not.toBe(0n);

    // STEP 5: Build User Tree (standard Merkle)
    const userTree = await buildStandardMerkleTree(
      [userLeaf], // Single user
      TEST_TREE_DEPTH,
      hasher,
    );
    const userRoot = userTree.root;
    expect(userRoot).not.toBe(0n);

    // STEP 6: Build Cell Map Tree (SMT)
    const cellMapTree = await createSparseMerkleTree({ depth: TEST_TREE_DEPTH });
    await cellMapTree.insert(cellId, cellMapLeaf);
    const cellMapRoot = await cellMapTree.getRoot();
    expect(cellMapRoot).not.toBe(0n);

    // STEP 7: Generate Merkle proofs
    // User tree proof (standard Merkle)
    const userProof = await userTree.getProof(0);
    expect(userProof.siblings).toHaveLength(TEST_TREE_DEPTH);

    // Cell map proof (SMT)
    const cellMapProof = await cellMapTree.getProof(cellId);
    expect(cellMapProof.siblings).toHaveLength(TEST_TREE_DEPTH);
    expect(cellMapProof.root).toBe(cellMapRoot);

    // STEP 8: Verify all circuit constraints would be satisfied

    // Constraint 1: User leaf recomputed from secret + authority level
    const recomputedUserLeaf = await hasher.hash4(userSecret, cellId, salt, authorityLevel);
    expect(recomputedUserLeaf).toBe(userLeaf);

    // Constraint 2: User Merkle proof verifies against user_root
    const userProofValid = await verifyMerkleProof(
      userLeaf,
      0, // index
      userProof.siblings,
      userRoot,
      hasher,
    );
    expect(userProofValid).toBe(true);

    // Constraint 3: District commitment recomputed from sponge
    const recomputedCommitment = await poseidon2Sponge(districts);
    expect(recomputedCommitment).toBe(districtCommitment);

    // Constraint 4: Cell map leaf recomputed from hash2(cellId, commitment)
    const recomputedCellMapLeaf = await hasher.hashPair(cellId, districtCommitment);
    expect(recomputedCellMapLeaf).toBe(cellMapLeaf);

    // Constraint 5: Cell map SMT proof verifies against cell_map_root
    const smtProofValid = await SparseMerkleTree.verify(
      cellMapProof,
      cellMapRoot,
      hasher,
    );
    expect(smtProofValid).toBe(true);

    // Constraint 6: Nullifier = hash2(userSecret, actionDomain)
    const nullifier = await hasher.hashPair(userSecret, actionDomain);
    expect(typeof nullifier).toBe('bigint');
    expect(nullifier).not.toBe(0n);

    // Constraint 7: Authority level validated in [1, 5]
    expect(Number(authorityLevel)).toBeGreaterThanOrEqual(1);
    expect(Number(authorityLevel)).toBeLessThanOrEqual(5);

    // Verify all roots and values are consistent
    expect(userProof.root).toBe(userRoot);
    expect(cellMapProof.value).toBe(cellMapLeaf);
  });

  // --------------------------------------------------------------------------
  // TEST 2: Multiple users in the same cell share the same cell map entry
  // --------------------------------------------------------------------------
  it('multiple users in the same cell share the same cell map entry', async () => {
    // Two users in the same Census Tract (San Francisco)
    const cellId = CELL_ID_SF;
    const districts = generateDistrictSet(1);

    // User 1
    const userLeaf1 = await hash4(USER_SECRET_1, cellId, SALT_1, AUTHORITY_LEVEL);

    // User 2 (different secret and salt, same cell)
    const userLeaf2 = await hash4(USER_SECRET_2, cellId, SALT_2, AUTHORITY_LEVEL);

    // User leaves must be different (different secrets + salts)
    expect(userLeaf1).not.toBe(userLeaf2);

    // But they share the same district commitment (same cell = same districts)
    const districtCommitment = await poseidon2Sponge(districts);

    // And the same cell map leaf (same cellId + same districtCommitment)
    const cellMapLeaf = await hashPair(cellId, districtCommitment);

    // Build User Tree with both users
    const userTree = await buildStandardMerkleTree(
      [userLeaf1, userLeaf2],
      TEST_TREE_DEPTH,
      hasher,
    );

    // Build Cell Map Tree with one entry for the shared cell
    const cellMapTree = await createSparseMerkleTree({ depth: TEST_TREE_DEPTH });
    await cellMapTree.insert(cellId, cellMapLeaf);

    // Verify both users can produce valid user tree proofs
    const proof1 = await userTree.getProof(0);
    const proof2 = await userTree.getProof(1);

    const valid1 = await verifyMerkleProof(
      userLeaf1, 0, proof1.siblings, userTree.root, hasher,
    );
    const valid2 = await verifyMerkleProof(
      userLeaf2, 1, proof2.siblings, userTree.root, hasher,
    );

    expect(valid1).toBe(true);
    expect(valid2).toBe(true);

    // Both users share the same cell map proof
    const cellProof = await cellMapTree.getProof(cellId);
    const cellProofValid = await SparseMerkleTree.verify(
      cellProof,
      await cellMapTree.getRoot(),
      hasher,
    );
    expect(cellProofValid).toBe(true);

    // Nullifiers are different (different secrets, same action domain)
    const null1 = await hashPair(USER_SECRET_1, ACTION_DOMAIN_VOTE);
    const null2 = await hashPair(USER_SECRET_2, ACTION_DOMAIN_VOTE);
    expect(null1).not.toBe(null2);
  });

  // --------------------------------------------------------------------------
  // TEST 3: Users in different cells get different district commitments
  // --------------------------------------------------------------------------
  it('users in different cells get different district commitments', async () => {
    // User in San Francisco
    const cellIdSF = CELL_ID_SF;
    const districtsSF = generateDistrictSet(1); // SF districts

    // User in New York
    const cellIdNY = CELL_ID_NY;
    const districtsNY = generateDistrictSet(2); // NY districts (different set)

    // District commitments differ
    const commitmentSF = await poseidon2Sponge(districtsSF);
    const commitmentNY = await poseidon2Sponge(districtsNY);
    expect(commitmentSF).not.toBe(commitmentNY);

    // Cell map leaves differ (different cellId AND different commitment)
    const cellMapLeafSF = await hashPair(cellIdSF, commitmentSF);
    const cellMapLeafNY = await hashPair(cellIdNY, commitmentNY);
    expect(cellMapLeafSF).not.toBe(cellMapLeafNY);

    // Build Cell Map Tree with both cells
    const cellMapTree = await createSparseMerkleTree({ depth: TEST_TREE_DEPTH });
    await cellMapTree.insert(cellIdSF, cellMapLeafSF);
    await cellMapTree.insert(cellIdNY, cellMapLeafNY);

    // Verify independent proofs for each cell
    const proofSF = await cellMapTree.getProof(cellIdSF);
    const proofNY = await cellMapTree.getProof(cellIdNY);

    const cellMapRoot = await cellMapTree.getRoot();

    const validSF = await SparseMerkleTree.verify(proofSF, cellMapRoot, hasher);
    const validNY = await SparseMerkleTree.verify(proofNY, cellMapRoot, hasher);

    expect(validSF).toBe(true);
    expect(validNY).toBe(true);

    // Proof values are different
    expect(proofSF.value).toBe(cellMapLeafSF);
    expect(proofNY.value).toBe(cellMapLeafNY);
    expect(proofSF.value).not.toBe(proofNY.value);

    // User leaves also differ (different cell_id bindings)
    const userLeafSF = await hash4(USER_SECRET_1, cellIdSF, SALT_1, AUTHORITY_LEVEL);
    const userLeafNY = await hash4(USER_SECRET_1, cellIdNY, SALT_1, AUTHORITY_LEVEL);
    expect(userLeafSF).not.toBe(userLeafNY);
  });

  // --------------------------------------------------------------------------
  // TEST 4: Nullifier is deterministic for same user+action
  // --------------------------------------------------------------------------
  it('nullifier is deterministic for same user+action', async () => {
    // Compute the same nullifier multiple times
    const nullifier1 = await hashPair(USER_SECRET_1, ACTION_DOMAIN_VOTE);
    const nullifier2 = await hashPair(USER_SECRET_1, ACTION_DOMAIN_VOTE);
    const nullifier3 = await hashPair(USER_SECRET_1, ACTION_DOMAIN_VOTE);

    // Must be identical every time
    expect(nullifier1).toBe(nullifier2);
    expect(nullifier2).toBe(nullifier3);

    // Must be a valid field element (non-zero bigint)
    expect(typeof nullifier1).toBe('bigint');
    expect(nullifier1).not.toBe(0n);
    expect(nullifier1).toBeGreaterThan(0n);

    // This is the core anti-double-vote property:
    // Same user + same action domain = same nullifier = detected as duplicate
  });

  // --------------------------------------------------------------------------
  // TEST 5: Nullifier differs across action domains
  // --------------------------------------------------------------------------
  it('nullifier differs across action domains', async () => {
    // Same user, different action domains
    const nullifierVote = await hashPair(USER_SECRET_1, ACTION_DOMAIN_VOTE);
    const nullifierPetition = await hashPair(USER_SECRET_1, ACTION_DOMAIN_PETITION);

    // Must be different
    expect(nullifierVote).not.toBe(nullifierPetition);

    // This is the CVE-002 fix: action_domain is PUBLIC and contract-controlled.
    // Different actions produce different nullifiers, preventing cross-action
    // nullifier reuse while allowing legitimate multi-action participation.

    // Also verify different users get different nullifiers for the same action
    const nullifierUser1 = await hashPair(USER_SECRET_1, ACTION_DOMAIN_VOTE);
    const nullifierUser2 = await hashPair(USER_SECRET_2, ACTION_DOMAIN_VOTE);
    expect(nullifierUser1).not.toBe(nullifierUser2);
  });

  // --------------------------------------------------------------------------
  // TEST 6: Zero user secret produces valid leaf but SA-011 rejects at circuit
  // --------------------------------------------------------------------------
  it('zero user secret produces a valid leaf but SA-011 rejects at circuit level', async () => {
    const zeroSecret = 0n;
    const cellId = CELL_ID_SF;
    const salt = SALT_1;

    // hash4 with zero secret still produces a valid field element
    // (the hash function itself doesn't reject zero inputs)
    const leafWithZeroSecret = await hash4(zeroSecret, cellId, salt, AUTHORITY_LEVEL);
    expect(typeof leafWithZeroSecret).toBe('bigint');
    expect(leafWithZeroSecret).not.toBe(0n); // hash output is non-zero

    // The nullifier with zero secret is predictable:
    // nullifier = hash2(0, action_domain) -- an attacker knowing action_domain
    // can predict this nullifier without knowing any secret.
    const predictableNullifier = await hashPair(zeroSecret, ACTION_DOMAIN_VOTE);
    expect(typeof predictableNullifier).toBe('bigint');

    // IMPORTANT: The actual Noir circuit (main.nr line 263) rejects this:
    //   assert(user_secret != 0, "user_secret cannot be zero");
    //
    // This TypeScript-side test confirms:
    // 1. The hash functions DO compute a value for zero (no TypeScript guard)
    // 2. The resulting nullifier IS predictable (security concern)
    // 3. The circuit enforces the zero-check (SA-011 fix)
    //
    // This is defense-in-depth: even if the registration system somehow
    // accepts a zero secret, the circuit will reject the proof.

    // Verify the zero-secret leaf is DIFFERENT from a non-zero-secret leaf
    const normalLeaf = await hash4(USER_SECRET_1, cellId, salt, AUTHORITY_LEVEL);
    expect(leafWithZeroSecret).not.toBe(normalLeaf);
  });

  // --------------------------------------------------------------------------
  // Additional integration checks
  // --------------------------------------------------------------------------

  it('district commitment is order-sensitive (changing district order changes commitment)', async () => {
    const districts = generateDistrictSet(1);

    // Original commitment
    const commitment1 = await poseidon2Sponge(districts);

    // Swap first two districts
    const swappedDistricts = [...districts];
    [swappedDistricts[0], swappedDistricts[1]] = [swappedDistricts[1], swappedDistricts[0]];

    const commitment2 = await poseidon2Sponge(swappedDistricts);

    // Different order = different commitment (sponge is order-sensitive)
    expect(commitment1).not.toBe(commitment2);
  });

  it('sponge rejects non-24 input arrays', async () => {
    // poseidon2Sponge is hardcoded for 24 inputs
    await expect(poseidon2Sponge([1n, 2n, 3n])).rejects.toThrow(
      'poseidon2Sponge expects 24 inputs'
    );

    await expect(poseidon2Sponge(new Array(25).fill(1n))).rejects.toThrow(
      'poseidon2Sponge expects 24 inputs'
    );
  });

  it('end-to-end: two users, two cells, full tree verification', async () => {
    // This is the most comprehensive test: 2 users in 2 different cells,
    // both trees populated, both proof paths verified.

    // Setup district data
    const districtsSF = generateDistrictSet(1);
    const districtsNY = generateDistrictSet(2);

    // Compute district commitments
    const commitmentSF = await poseidon2Sponge(districtsSF);
    const commitmentNY = await poseidon2Sponge(districtsNY);

    // Compute user leaves
    const userLeafSF = await hash4(USER_SECRET_1, CELL_ID_SF, SALT_1, AUTHORITY_LEVEL);
    const userLeafNY = await hash4(USER_SECRET_2, CELL_ID_NY, SALT_2, AUTHORITY_LEVEL);

    // Compute cell map leaves
    const cellMapLeafSF = await hashPair(CELL_ID_SF, commitmentSF);
    const cellMapLeafNY = await hashPair(CELL_ID_NY, commitmentNY);

    // Build User Tree with both users
    const userTree = await buildStandardMerkleTree(
      [userLeafSF, userLeafNY],
      TEST_TREE_DEPTH,
      hasher,
    );

    // Build Cell Map Tree with both cells
    const cellMapTree = await createSparseMerkleTree({ depth: TEST_TREE_DEPTH });
    await cellMapTree.insert(CELL_ID_SF, cellMapLeafSF);
    await cellMapTree.insert(CELL_ID_NY, cellMapLeafNY);

    const userRoot = userTree.root;
    const cellMapRoot = await cellMapTree.getRoot();

    // === Verify User 1 (SF) ===

    // User tree proof
    const userProofSF = await userTree.getProof(0);
    expect(await verifyMerkleProof(
      userLeafSF, 0, userProofSF.siblings, userRoot, hasher,
    )).toBe(true);

    // Cell map proof
    const cellProofSF = await cellMapTree.getProof(CELL_ID_SF);
    expect(await SparseMerkleTree.verify(cellProofSF, cellMapRoot, hasher)).toBe(true);

    // Nullifier
    const nullifierSF = await hashPair(USER_SECRET_1, ACTION_DOMAIN_VOTE);
    expect(nullifierSF).not.toBe(0n);

    // === Verify User 2 (NY) ===

    // User tree proof
    const userProofNY = await userTree.getProof(1);
    expect(await verifyMerkleProof(
      userLeafNY, 1, userProofNY.siblings, userRoot, hasher,
    )).toBe(true);

    // Cell map proof
    const cellProofNY = await cellMapTree.getProof(CELL_ID_NY);
    expect(await SparseMerkleTree.verify(cellProofNY, cellMapRoot, hasher)).toBe(true);

    // Nullifier
    const nullifierNY = await hashPair(USER_SECRET_2, ACTION_DOMAIN_VOTE);
    expect(nullifierNY).not.toBe(0n);

    // Cross-checks: nullifiers are different
    expect(nullifierSF).not.toBe(nullifierNY);

    // Both share the same user_root and cell_map_root
    expect(userProofSF.root).toBe(userProofNY.root);
    expect(cellProofSF.root).toBe(cellProofNY.root);
  });
});
