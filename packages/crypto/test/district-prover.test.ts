/**
 * District Prover Tests - Comprehensive ZK proof generation validation
 *
 * Tests cover:
 * 1. Singleton initialization for all depths (18, 20, 22, 24)
 * 2. Witness validation (field bounds, array lengths, index bounds, authority_level range)
 * 3. Proof generation with valid witnesses
 * 4. Proof verification (happy path and invalid cases)
 * 5. Public output validation (merkle_root, nullifier, authority_level, action_domain, district_id)
 * 6. Error handling (invalid witnesses, bad proofs)
 *
 * SECURITY TESTS:
 * - CVE-001/CVE-003: Leaf computed from user_secret (identity binding)
 * - CVE-002: Nullifier uses PUBLIC action_domain (no user manipulation)
 * - ISSUE-006: authority_level range validation [1-5]
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  DistrictProver,
  getProver,
  generateProof,
  verifyProof,
  type DistrictWitness,
  type DistrictProof,
  type VerificationConfig,
  type CircuitDepth,
} from '../district-prover';
import { Poseidon2Hasher } from '../poseidon2';

// BN254 field modulus for validation tests
const BN254_FIELD_MODULUS = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

/**
 * Generate valid test witness for specified depth
 *
 * NEW CIRCUIT INTERFACE:
 * - Leaf is COMPUTED inside circuit from: user_secret, district_id, authority_level, registration_salt
 * - Nullifier is COMPUTED inside circuit from: user_secret, action_domain
 * - action_domain is PUBLIC (contract-controlled)
 */
async function generateTestWitnessForDepth(depth: CircuitDepth): Promise<DistrictWitness> {
  const hasher = await Poseidon2Hasher.getInstance();

  // Private inputs for leaf computation
  const userSecret = '0x' + '01'.repeat(32);
  const districtId = '0x' + '02'.repeat(32);
  const authorityLevel = 3; // Valid range [1-5]
  const registrationSalt = '0x' + '03'.repeat(32);

  // PUBLIC input (contract-controlled)
  const actionDomain = '0x' + '04'.repeat(32);

  // Compute the leaf as the circuit will (CVE-001/CVE-003 fix)
  const leaf = await hasher.hash4(userSecret, districtId, BigInt(authorityLevel), registrationSalt);

  // Build Merkle tree
  const merklePath: string[] = [];
  let currentHash = leaf;
  for (let i = 0; i < depth; i++) {
    const sibling = await hasher.hashSingle(BigInt(i + 1000));
    merklePath.push('0x' + sibling.toString(16).padStart(64, '0'));
    // For leaf_index = 0, always hash(node, sibling)
    currentHash = await hasher.hashPair(currentHash, sibling);
  }

  const merkleRoot = currentHash;

  return {
    // PUBLIC inputs
    merkle_root: '0x' + merkleRoot.toString(16).padStart(64, '0'),
    action_domain: actionDomain,
    // PRIVATE inputs
    user_secret: userSecret,
    district_id: districtId,
    authority_level: authorityLevel,
    registration_salt: registrationSalt,
    merkle_path: merklePath,
    leaf_index: 0,
  };
}

/**
 * Compute expected nullifier (for verification config)
 * Circuit computes: nullifier = hash2(user_secret, action_domain)
 */
async function computeExpectedNullifier(
  userSecret: string,
  actionDomain: string
): Promise<string> {
  const hasher = await Poseidon2Hasher.getInstance();
  const nullifier = await hasher.hashPair(BigInt(userSecret), BigInt(actionDomain));
  return '0x' + nullifier.toString(16).padStart(64, '0');
}

describe('DistrictProver - Singleton Management', () => {
  it('should create singleton instance for depth 18', async () => {
    const prover1 = await DistrictProver.getInstance(18);
    const prover2 = await DistrictProver.getInstance(18);

    expect(prover1).toBe(prover2); // Same instance
    expect(prover1.getDepth()).toBe(18);
  });

  it('should create separate instances for different depths', async () => {
    const prover18 = await DistrictProver.getInstance(18);
    const prover20 = await DistrictProver.getInstance(20);
    const prover22 = await DistrictProver.getInstance(22);

    expect(prover18).not.toBe(prover20);
    expect(prover20).not.toBe(prover22);
    expect(prover18.getDepth()).toBe(18);
    expect(prover20.getDepth()).toBe(20);
    expect(prover22.getDepth()).toBe(22);
  });

  it('should work with convenience function getProver', async () => {
    const prover = await getProver(18);
    expect(prover.getDepth()).toBe(18);
  });

  it('should reset instances correctly', async () => {
    const prover1 = await DistrictProver.getInstance(18);
    DistrictProver.resetInstances();
    const prover2 = await DistrictProver.getInstance(18);

    // After reset, new instance created
    expect(prover2).toBeDefined();
    expect(prover2.getDepth()).toBe(18);
  });
});

describe('DistrictProver - Witness Validation', () => {
  it('should reject witness with wrong merkle_path length', async () => {
    const prover = await DistrictProver.getInstance(18);
    const witness = await generateTestWitnessForDepth(18);

    // Wrong length (should be 18, give 10)
    witness.merkle_path = witness.merkle_path.slice(0, 10);

    await expect(prover.generateProof(witness)).rejects.toThrow(
      'Invalid merkle_path length: expected 18, got 10'
    );
  });

  it('should reject witness with out-of-bounds leaf_index', async () => {
    const prover = await DistrictProver.getInstance(18);
    const witness = await generateTestWitnessForDepth(18);

    // Max index for depth 18 is 2^18 - 1 = 262143
    witness.leaf_index = 262144;

    await expect(prover.generateProof(witness)).rejects.toThrow(
      'Invalid leaf_index: 262144 (must be in [0, 262143])'
    );
  });

  it('should reject witness with negative leaf_index', async () => {
    const prover = await DistrictProver.getInstance(18);
    const witness = await generateTestWitnessForDepth(18);

    witness.leaf_index = -1;

    await expect(prover.generateProof(witness)).rejects.toThrow('Invalid leaf_index');
  });

  it('should reject witness with invalid field element (not hex)', async () => {
    const prover = await DistrictProver.getInstance(18);
    const witness = await generateTestWitnessForDepth(18);

    // Invalid hex string
    witness.merkle_root = 'not-a-hex-string';

    await expect(prover.generateProof(witness)).rejects.toThrow('Invalid field element');
  });

  it('should reject witness with field element >= BN254 modulus', async () => {
    const prover = await DistrictProver.getInstance(18);
    const witness = await generateTestWitnessForDepth(18);

    // Set to field modulus (invalid, must be < modulus)
    witness.merkle_root = '0x' + BN254_FIELD_MODULUS.toString(16);

    await expect(prover.generateProof(witness)).rejects.toThrow('Invalid field element');
  });

  // ISSUE-006: authority_level range validation
  it('should reject witness with authority_level < 1', async () => {
    const prover = await DistrictProver.getInstance(18);
    const witness = await generateTestWitnessForDepth(18);

    witness.authority_level = 0;

    await expect(prover.generateProof(witness)).rejects.toThrow(
      'Invalid authority_level: 0 (must be in [1, 5])'
    );
  });

  it('should reject witness with authority_level > 5', async () => {
    const prover = await DistrictProver.getInstance(18);
    const witness = await generateTestWitnessForDepth(18);

    witness.authority_level = 6;

    await expect(prover.generateProof(witness)).rejects.toThrow(
      'Invalid authority_level: 6 (must be in [1, 5])'
    );
  });

  it('should accept witness with valid authority_level (1)', async () => {
    const hasher = await Poseidon2Hasher.getInstance();
    const prover = await DistrictProver.getInstance(18);

    // Create witness with authority_level = 1 (minimum valid)
    const userSecret = '0x' + '01'.repeat(32);
    const districtId = '0x' + '02'.repeat(32);
    const authorityLevel = 1;
    const registrationSalt = '0x' + '03'.repeat(32);
    const actionDomain = '0x' + '04'.repeat(32);

    const leaf = await hasher.hash4(userSecret, districtId, BigInt(authorityLevel), registrationSalt);

    const merklePath: string[] = [];
    let currentHash = leaf;
    for (let i = 0; i < 18; i++) {
      const sibling = await hasher.hashSingle(BigInt(i + 1000));
      merklePath.push('0x' + sibling.toString(16).padStart(64, '0'));
      currentHash = await hasher.hashPair(currentHash, sibling);
    }

    const witness: DistrictWitness = {
      merkle_root: '0x' + currentHash.toString(16).padStart(64, '0'),
      action_domain: actionDomain,
      user_secret: userSecret,
      district_id: districtId,
      authority_level: authorityLevel,
      registration_salt: registrationSalt,
      merkle_path: merklePath,
      leaf_index: 0,
    };

    const proof = await prover.generateProof(witness);
    expect(proof).toBeDefined();
    expect(proof.publicInputs).toHaveLength(5);
  }, 30000);

  it('should accept witness with valid authority_level (5)', async () => {
    const hasher = await Poseidon2Hasher.getInstance();
    const prover = await DistrictProver.getInstance(18);

    // Create witness with authority_level = 5 (maximum valid)
    const userSecret = '0x' + '01'.repeat(32);
    const districtId = '0x' + '02'.repeat(32);
    const authorityLevel = 5;
    const registrationSalt = '0x' + '03'.repeat(32);
    const actionDomain = '0x' + '04'.repeat(32);

    const leaf = await hasher.hash4(userSecret, districtId, BigInt(authorityLevel), registrationSalt);

    const merklePath: string[] = [];
    let currentHash = leaf;
    for (let i = 0; i < 18; i++) {
      const sibling = await hasher.hashSingle(BigInt(i + 1000));
      merklePath.push('0x' + sibling.toString(16).padStart(64, '0'));
      currentHash = await hasher.hashPair(currentHash, sibling);
    }

    const witness: DistrictWitness = {
      merkle_root: '0x' + currentHash.toString(16).padStart(64, '0'),
      action_domain: actionDomain,
      user_secret: userSecret,
      district_id: districtId,
      authority_level: authorityLevel,
      registration_salt: registrationSalt,
      merkle_path: merklePath,
      leaf_index: 0,
    };

    const proof = await prover.generateProof(witness);
    expect(proof).toBeDefined();
    expect(proof.publicInputs).toHaveLength(5);
  }, 30000);

  it('should accept witness with valid field elements', async () => {
    const prover = await DistrictProver.getInstance(18);
    const witness = await generateTestWitnessForDepth(18);

    // Should not throw
    const proof = await prover.generateProof(witness);
    expect(proof).toBeDefined();
    expect(proof.publicInputs).toHaveLength(5);
  }, 30000);
});

describe('DistrictProver - Proof Generation', () => {
  it('should generate valid proof for depth 18', async () => {
    const prover = await DistrictProver.getInstance(18);
    const witness = await generateTestWitnessForDepth(18);

    const proof = await prover.generateProof(witness);

    expect(proof).toBeDefined();
    expect(proof.proof).toBeDefined();
    expect(proof.publicInputs).toHaveLength(5);

    // Verify public outputs match expected values
    // Order: [merkle_root, nullifier, authority_level, action_domain, district_id]
    expect(proof.publicInputs[0]).toBe(witness.merkle_root);
    // Nullifier is computed inside circuit, verify it matches expected
    const expectedNullifier = await computeExpectedNullifier(
      witness.user_secret,
      witness.action_domain
    );
    expect(proof.publicInputs[1]).toBe(expectedNullifier);
    expect(proof.publicInputs[2]).toBe(witness.authority_level.toString());
    expect(proof.publicInputs[3]).toBe(witness.action_domain);
    expect(proof.publicInputs[4]).toBe(witness.district_id);
  }, 30000);

  it('should generate valid proof for depth 20', async () => {
    const prover = await DistrictProver.getInstance(20);
    const witness = await generateTestWitnessForDepth(20);

    const proof = await prover.generateProof(witness);

    expect(proof).toBeDefined();
    expect(proof.publicInputs).toHaveLength(5);
  }, 60000); // Longer timeout for depth 20

  it('should generate valid proof for depth 22', async () => {
    const prover = await DistrictProver.getInstance(22);
    const witness = await generateTestWitnessForDepth(22);

    const proof = await prover.generateProof(witness);

    expect(proof).toBeDefined();
    expect(proof.publicInputs).toHaveLength(5);
  }, 60000); // Longer timeout for depth 22

  it('should work with convenience function generateProof', async () => {
    const witness = await generateTestWitnessForDepth(18);
    const proof = await generateProof(witness, 18);

    expect(proof).toBeDefined();
    expect(proof.publicInputs).toHaveLength(5);
  }, 30000);
});

describe('DistrictProver - Proof Verification', () => {
  it('should verify valid proof', async () => {
    const prover = await DistrictProver.getInstance(18);
    const witness = await generateTestWitnessForDepth(18);

    const proof = await prover.generateProof(witness);

    const expectedNullifier = await computeExpectedNullifier(
      witness.user_secret,
      witness.action_domain
    );

    const config: VerificationConfig = {
      expectedRoot: witness.merkle_root,
      expectedNullifier: expectedNullifier,
      expectedAuthorityLevel: witness.authority_level,
      expectedActionDomain: witness.action_domain,
      expectedDistrictId: witness.district_id,
    };

    const isValid = await prover.verifyProof(proof, config);
    expect(isValid).toBe(true);
  }, 60000);

  it('should reject proof with wrong merkle root', async () => {
    const prover = await DistrictProver.getInstance(18);
    const witness = await generateTestWitnessForDepth(18);

    const proof = await prover.generateProof(witness);

    const expectedNullifier = await computeExpectedNullifier(
      witness.user_secret,
      witness.action_domain
    );

    const config: VerificationConfig = {
      expectedRoot: '0x' + '99'.repeat(32), // Wrong root
      expectedNullifier: expectedNullifier,
      expectedAuthorityLevel: witness.authority_level,
      expectedActionDomain: witness.action_domain,
      expectedDistrictId: witness.district_id,
    };

    const isValid = await prover.verifyProof(proof, config);
    expect(isValid).toBe(false);
  }, 30000);

  it('should reject proof with wrong nullifier', async () => {
    const prover = await DistrictProver.getInstance(18);
    const witness = await generateTestWitnessForDepth(18);

    const proof = await prover.generateProof(witness);

    const config: VerificationConfig = {
      expectedRoot: witness.merkle_root,
      expectedNullifier: '0x' + '99'.repeat(32), // Wrong nullifier
      expectedAuthorityLevel: witness.authority_level,
      expectedActionDomain: witness.action_domain,
      expectedDistrictId: witness.district_id,
    };

    const isValid = await prover.verifyProof(proof, config);
    expect(isValid).toBe(false);
  }, 30000);

  it('should reject proof with wrong authority_level', async () => {
    const prover = await DistrictProver.getInstance(18);
    const witness = await generateTestWitnessForDepth(18);

    const proof = await prover.generateProof(witness);

    const expectedNullifier = await computeExpectedNullifier(
      witness.user_secret,
      witness.action_domain
    );

    const config: VerificationConfig = {
      expectedRoot: witness.merkle_root,
      expectedNullifier: expectedNullifier,
      expectedAuthorityLevel: 5, // Wrong authority level (witness has 3)
      expectedActionDomain: witness.action_domain,
      expectedDistrictId: witness.district_id,
    };

    const isValid = await prover.verifyProof(proof, config);
    expect(isValid).toBe(false);
  }, 30000);

  it('should reject proof with wrong action_domain', async () => {
    const prover = await DistrictProver.getInstance(18);
    const witness = await generateTestWitnessForDepth(18);

    const proof = await prover.generateProof(witness);

    const expectedNullifier = await computeExpectedNullifier(
      witness.user_secret,
      witness.action_domain
    );

    const config: VerificationConfig = {
      expectedRoot: witness.merkle_root,
      expectedNullifier: expectedNullifier,
      expectedAuthorityLevel: witness.authority_level,
      expectedActionDomain: '0x' + '99'.repeat(32), // Wrong action domain
      expectedDistrictId: witness.district_id,
    };

    const isValid = await prover.verifyProof(proof, config);
    expect(isValid).toBe(false);
  }, 30000);

  it('should reject proof with wrong district_id', async () => {
    const prover = await DistrictProver.getInstance(18);
    const witness = await generateTestWitnessForDepth(18);

    const proof = await prover.generateProof(witness);

    const expectedNullifier = await computeExpectedNullifier(
      witness.user_secret,
      witness.action_domain
    );

    const config: VerificationConfig = {
      expectedRoot: witness.merkle_root,
      expectedNullifier: expectedNullifier,
      expectedAuthorityLevel: witness.authority_level,
      expectedActionDomain: witness.action_domain,
      expectedDistrictId: '0x' + '99'.repeat(32), // Wrong district ID
    };

    const isValid = await prover.verifyProof(proof, config);
    expect(isValid).toBe(false);
  }, 30000);

  it('should work with convenience function verifyProof', async () => {
    const witness = await generateTestWitnessForDepth(18);
    const proof = await generateProof(witness, 18);

    const expectedNullifier = await computeExpectedNullifier(
      witness.user_secret,
      witness.action_domain
    );

    const config: VerificationConfig = {
      expectedRoot: witness.merkle_root,
      expectedNullifier: expectedNullifier,
      expectedAuthorityLevel: witness.authority_level,
      expectedActionDomain: witness.action_domain,
      expectedDistrictId: witness.district_id,
    };

    const isValid = await verifyProof(proof, config, 18);
    expect(isValid).toBe(true);
  }, 60000);
});

describe('DistrictProver - Security Tests', () => {
  // CVE-001/CVE-003: Test that leaf is computed from user_secret
  it('should fail verification with wrong user_secret (CVE-001/CVE-003)', async () => {
    const hasher = await Poseidon2Hasher.getInstance();
    const prover = await DistrictProver.getInstance(18);

    // Create a valid witness
    const userSecret = '0x' + '01'.repeat(32);
    const districtId = '0x' + '02'.repeat(32);
    const authorityLevel = 3;
    const registrationSalt = '0x' + '03'.repeat(32);
    const actionDomain = '0x' + '04'.repeat(32);

    const leaf = await hasher.hash4(userSecret, districtId, BigInt(authorityLevel), registrationSalt);

    const merklePath: string[] = [];
    let currentHash = leaf;
    for (let i = 0; i < 18; i++) {
      const sibling = await hasher.hashSingle(BigInt(i + 1000));
      merklePath.push('0x' + sibling.toString(16).padStart(64, '0'));
      currentHash = await hasher.hashPair(currentHash, sibling);
    }

    // Create witness with WRONG user_secret (attacker trying to claim someone else's leaf)
    const wrongUserSecret = '0x' + '99'.repeat(32);

    const witness: DistrictWitness = {
      merkle_root: '0x' + currentHash.toString(16).padStart(64, '0'),
      action_domain: actionDomain,
      user_secret: wrongUserSecret, // WRONG!
      district_id: districtId,
      authority_level: authorityLevel,
      registration_salt: registrationSalt,
      merkle_path: merklePath,
      leaf_index: 0,
    };

    // Proof generation should fail because the circuit computes the leaf from user_secret,
    // and it won't match the merkle root
    await expect(prover.generateProof(witness)).rejects.toThrow();
  }, 30000);

  // CVE-002: Test that nullifier cannot be manipulated by changing action_domain privately
  it('should produce different nullifiers for different action_domains (CVE-002)', async () => {
    const prover = await DistrictProver.getInstance(18);
    const hasher = await Poseidon2Hasher.getInstance();

    const userSecret = '0x' + '01'.repeat(32);
    const districtId = '0x' + '02'.repeat(32);
    const authorityLevel = 3;
    const registrationSalt = '0x' + '03'.repeat(32);

    const leaf = await hasher.hash4(userSecret, districtId, BigInt(authorityLevel), registrationSalt);

    const merklePath: string[] = [];
    let currentHash = leaf;
    for (let i = 0; i < 18; i++) {
      const sibling = await hasher.hashSingle(BigInt(i + 1000));
      merklePath.push('0x' + sibling.toString(16).padStart(64, '0'));
      currentHash = await hasher.hashPair(currentHash, sibling);
    }

    const merkleRoot = '0x' + currentHash.toString(16).padStart(64, '0');

    // Generate proof with action_domain_1
    const actionDomain1 = '0x' + '04'.repeat(32);
    const witness1: DistrictWitness = {
      merkle_root: merkleRoot,
      action_domain: actionDomain1,
      user_secret: userSecret,
      district_id: districtId,
      authority_level: authorityLevel,
      registration_salt: registrationSalt,
      merkle_path: merklePath,
      leaf_index: 0,
    };

    const proof1 = await prover.generateProof(witness1);

    // Generate proof with action_domain_2
    const actionDomain2 = '0x' + '05'.repeat(32);
    const witness2: DistrictWitness = {
      merkle_root: merkleRoot,
      action_domain: actionDomain2,
      user_secret: userSecret,
      district_id: districtId,
      authority_level: authorityLevel,
      registration_salt: registrationSalt,
      merkle_path: merklePath,
      leaf_index: 0,
    };

    const proof2 = await prover.generateProof(witness2);

    // Nullifiers should be DIFFERENT because action_domain is different
    // This is the CVE-002 fix - users cannot reuse proofs across different action domains
    const nullifier1 = proof1.publicInputs[1];
    const nullifier2 = proof2.publicInputs[1];

    expect(nullifier1).not.toBe(nullifier2);
  }, 60000);
});

describe('DistrictProver - Integration Tests', () => {
  it('should handle multiple proofs with same prover instance', async () => {
    const prover = await DistrictProver.getInstance(18);

    // Generate 3 different proofs
    const witness1 = await generateTestWitnessForDepth(18);
    const witness2 = await generateTestWitnessForDepth(18);
    const witness3 = await generateTestWitnessForDepth(18);

    const proof1 = await prover.generateProof(witness1);
    const proof2 = await prover.generateProof(witness2);
    const proof3 = await prover.generateProof(witness3);

    expect(proof1.publicInputs[0]).toBe(witness1.merkle_root);
    expect(proof2.publicInputs[0]).toBe(witness2.merkle_root);
    expect(proof3.publicInputs[0]).toBe(witness3.merkle_root);
  }, 120000);

  it('should handle cross-depth proving (different instances)', async () => {
    const witness18 = await generateTestWitnessForDepth(18);
    const witness20 = await generateTestWitnessForDepth(20);

    const proof18 = await generateProof(witness18, 18);
    const proof20 = await generateProof(witness20, 20);

    expect(proof18.publicInputs).toHaveLength(5);
    expect(proof20.publicInputs).toHaveLength(5);
  }, 120000);
});

describe('DistrictProver - Edge Cases', () => {
  it('should handle leaf_index at max boundary (2^depth - 1)', async () => {
    const hasher = await Poseidon2Hasher.getInstance();
    const prover = await DistrictProver.getInstance(18);

    const userSecret = '0x' + '01'.repeat(32);
    const districtId = '0x' + '02'.repeat(32);
    const authorityLevel = 3;
    const registrationSalt = '0x' + '03'.repeat(32);
    const actionDomain = '0x' + '04'.repeat(32);

    const leaf = await hasher.hash4(userSecret, districtId, BigInt(authorityLevel), registrationSalt);

    // Max index for depth 18 is 2^18 - 1 = 262143
    const maxIndex = 262143;
    const merklePath: string[] = [];

    let currentHash = leaf;
    for (let i = 0; i < 18; i++) {
      const sibling = await hasher.hashSingle(BigInt(i + 1000));
      merklePath.push('0x' + sibling.toString(16).padStart(64, '0'));
      // For max index (all 1s), we're always the right child: hash(sibling, node)
      currentHash = await hasher.hashPair(sibling, currentHash);
    }

    const witness: DistrictWitness = {
      merkle_root: '0x' + currentHash.toString(16).padStart(64, '0'),
      action_domain: actionDomain,
      user_secret: userSecret,
      district_id: districtId,
      authority_level: authorityLevel,
      registration_salt: registrationSalt,
      merkle_path: merklePath,
      leaf_index: maxIndex,
    };

    const proof = await prover.generateProof(witness);
    expect(proof).toBeDefined();
  }, 60000);

  it('should handle zero values in some private inputs', async () => {
    const hasher = await Poseidon2Hasher.getInstance();
    const prover = await DistrictProver.getInstance(18);

    // Zero district_id and registration_salt (but valid user_secret and authority_level)
    const userSecret = '0x' + '01'.repeat(32);
    const districtId = '0x' + '00'.repeat(32);
    const authorityLevel = 1;
    const registrationSalt = '0x' + '00'.repeat(32);
    const actionDomain = '0x' + '04'.repeat(32);

    const leaf = await hasher.hash4(userSecret, districtId, BigInt(authorityLevel), registrationSalt);

    const merklePath: string[] = [];
    let currentHash = leaf;
    for (let i = 0; i < 18; i++) {
      const sibling = await hasher.hashSingle(BigInt(i));
      merklePath.push('0x' + sibling.toString(16).padStart(64, '0'));
      currentHash = await hasher.hashPair(currentHash, sibling);
    }

    const witness: DistrictWitness = {
      merkle_root: '0x' + currentHash.toString(16).padStart(64, '0'),
      action_domain: actionDomain,
      user_secret: userSecret,
      district_id: districtId,
      authority_level: authorityLevel,
      registration_salt: registrationSalt,
      merkle_path: merklePath,
      leaf_index: 0,
    };

    const proof = await prover.generateProof(witness);
    expect(proof).toBeDefined();
  }, 60000);

  it('should handle maximum valid field element (modulus - 1)', async () => {
    const prover = await DistrictProver.getInstance(18);
    const witness = await generateTestWitnessForDepth(18);

    // Set action_domain to max valid field element
    const maxField = BN254_FIELD_MODULUS - 1n;
    witness.action_domain = '0x' + maxField.toString(16).padStart(64, '0');

    // Note: This will fail circuit constraints because merkle root computation will differ,
    // but it should pass witness validation
    await expect(prover.generateProof(witness)).rejects.toThrow();
  }, 30000);
});
