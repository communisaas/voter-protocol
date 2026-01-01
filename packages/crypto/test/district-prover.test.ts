/**
 * District Prover Tests - Comprehensive ZK proof generation validation
 *
 * Tests cover:
 * 1. Singleton initialization for all depths (14, 20, 22)
 * 2. Witness validation (field bounds, array lengths, index bounds)
 * 3. Proof generation with valid witnesses
 * 4. Proof verification (happy path and invalid cases)
 * 5. Public input validation
 * 6. Error handling (invalid witnesses, bad proofs)
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
 * Generate valid test witness for depth 14 (municipal)
 */
async function generateTestWitness14(): Promise<DistrictWitness> {
  const hasher = await Poseidon2Hasher.getInstance();

  // Private inputs
  const userSecret = '0x' + '01'.repeat(32);
  const campaignId = '0x' + '02'.repeat(32);
  const authorityHash = '0x' + '03'.repeat(32);
  const epochId = '0x' + '04'.repeat(32);

  // Compute nullifier
  const nullifier = await hasher.hash4(userSecret, campaignId, authorityHash, epochId);

  // Build minimal Merkle tree (depth 14)
  const leaf = await hasher.hashSingle('0x' + '05'.repeat(32));
  const merklePath: string[] = [];

  // Generate sibling hashes for depth 14
  let currentHash = leaf;
  for (let i = 0; i < 14; i++) {
    const sibling = await hasher.hashSingle(BigInt(i + 1000));
    merklePath.push('0x' + sibling.toString(16).padStart(64, '0'));

    // Compute parent (leaf_index = 0, so always hash(node, sibling))
    currentHash = await hasher.hashPair(currentHash, sibling);
  }

  const merkleRoot = currentHash;

  return {
    merkle_root: '0x' + merkleRoot.toString(16).padStart(64, '0'),
    nullifier: '0x' + nullifier.toString(16).padStart(64, '0'),
    authority_hash: authorityHash,
    epoch_id: epochId,
    campaign_id: campaignId,
    leaf: '0x' + leaf.toString(16).padStart(64, '0'),
    merkle_path: merklePath,
    leaf_index: 0,
    user_secret: userSecret,
  };
}

/**
 * Generate test witness for arbitrary depth
 */
async function generateTestWitnessForDepth(depth: CircuitDepth): Promise<DistrictWitness> {
  const hasher = await Poseidon2Hasher.getInstance();

  // Private inputs
  const userSecret = '0x' + '01'.repeat(32);
  const campaignId = '0x' + '02'.repeat(32);
  const authorityHash = '0x' + '03'.repeat(32);
  const epochId = '0x' + '04'.repeat(32);

  // Compute nullifier
  const nullifier = await hasher.hash4(userSecret, campaignId, authorityHash, epochId);

  // Build minimal Merkle tree
  const leaf = await hasher.hashSingle('0x' + '05'.repeat(32));
  const merklePath: string[] = [];

  let currentHash = leaf;
  for (let i = 0; i < depth; i++) {
    const sibling = await hasher.hashSingle(BigInt(i + 1000));
    merklePath.push('0x' + sibling.toString(16).padStart(64, '0'));
    currentHash = await hasher.hashPair(currentHash, sibling);
  }

  const merkleRoot = currentHash;

  return {
    merkle_root: '0x' + merkleRoot.toString(16).padStart(64, '0'),
    nullifier: '0x' + nullifier.toString(16).padStart(64, '0'),
    authority_hash: authorityHash,
    epoch_id: epochId,
    campaign_id: campaignId,
    leaf: '0x' + leaf.toString(16).padStart(64, '0'),
    merkle_path: merklePath,
    leaf_index: 0,
    user_secret: userSecret,
  };
}

describe('DistrictProver - Singleton Management', () => {
  it('should create singleton instance for depth 14', async () => {
    const prover1 = await DistrictProver.getInstance(14);
    const prover2 = await DistrictProver.getInstance(14);

    expect(prover1).toBe(prover2); // Same instance
    expect(prover1.getDepth()).toBe(14);
  });

  it('should create separate instances for different depths', async () => {
    const prover14 = await DistrictProver.getInstance(14);
    const prover20 = await DistrictProver.getInstance(20);
    const prover22 = await DistrictProver.getInstance(22);

    expect(prover14).not.toBe(prover20);
    expect(prover20).not.toBe(prover22);
    expect(prover14.getDepth()).toBe(14);
    expect(prover20.getDepth()).toBe(20);
    expect(prover22.getDepth()).toBe(22);
  });

  it('should work with convenience function getProver', async () => {
    const prover = await getProver(14);
    expect(prover.getDepth()).toBe(14);
  });

  it('should reset instances correctly', async () => {
    const prover1 = await DistrictProver.getInstance(14);
    DistrictProver.resetInstances();
    const prover2 = await DistrictProver.getInstance(14);

    // After reset, new instance created
    expect(prover2).toBeDefined();
    expect(prover2.getDepth()).toBe(14);
  });
});

describe('DistrictProver - Witness Validation', () => {
  it('should reject witness with wrong merkle_path length', async () => {
    const prover = await DistrictProver.getInstance(14);
    const witness = await generateTestWitness14();

    // Wrong length (should be 14, give 10)
    witness.merkle_path = witness.merkle_path.slice(0, 10);

    await expect(prover.generateProof(witness)).rejects.toThrow(
      'Invalid merkle_path length: expected 14, got 10'
    );
  });

  it('should reject witness with out-of-bounds leaf_index', async () => {
    const prover = await DistrictProver.getInstance(14);
    const witness = await generateTestWitness14();

    // Max index for depth 14 is 2^14 - 1 = 16383
    witness.leaf_index = 16384;

    await expect(prover.generateProof(witness)).rejects.toThrow(
      'Invalid leaf_index: 16384 (must be in [0, 16383])'
    );
  });

  it('should reject witness with negative leaf_index', async () => {
    const prover = await DistrictProver.getInstance(14);
    const witness = await generateTestWitness14();

    witness.leaf_index = -1;

    await expect(prover.generateProof(witness)).rejects.toThrow('Invalid leaf_index');
  });

  it('should reject witness with invalid field element (not hex)', async () => {
    const prover = await DistrictProver.getInstance(14);
    const witness = await generateTestWitness14();

    // Invalid hex string
    witness.merkle_root = 'not-a-hex-string';

    await expect(prover.generateProof(witness)).rejects.toThrow('Invalid field element');
  });

  it('should reject witness with field element >= BN254 modulus', async () => {
    const prover = await DistrictProver.getInstance(14);
    const witness = await generateTestWitness14();

    // Set to field modulus (invalid, must be < modulus)
    witness.merkle_root = '0x' + BN254_FIELD_MODULUS.toString(16);

    await expect(prover.generateProof(witness)).rejects.toThrow('Invalid field element');
  });

  it('should accept witness with valid field elements', async () => {
    const prover = await DistrictProver.getInstance(14);
    const witness = await generateTestWitness14();

    // Should not throw
    const proof = await prover.generateProof(witness);
    expect(proof).toBeDefined();
    expect(proof.publicInputs).toHaveLength(5);
  });
});

describe('DistrictProver - Proof Generation', () => {
  it('should generate valid proof for depth 14', async () => {
    const prover = await DistrictProver.getInstance(14);
    const witness = await generateTestWitnessForDepth(14);

    const proof = await prover.generateProof(witness);

    expect(proof).toBeDefined();
    expect(proof.proof).toBeDefined();
    expect(proof.publicInputs).toHaveLength(5);
    expect(proof.publicInputs[0]).toBe(witness.merkle_root);
    expect(proof.publicInputs[1]).toBe(witness.nullifier);
    expect(proof.publicInputs[2]).toBe(witness.authority_hash);
    expect(proof.publicInputs[3]).toBe(witness.epoch_id);
    expect(proof.publicInputs[4]).toBe(witness.campaign_id);
  });

  it('should generate valid proof for depth 20', async () => {
    const prover = await DistrictProver.getInstance(20);
    const witness = await generateTestWitnessForDepth(20);

    const proof = await prover.generateProof(witness);

    expect(proof).toBeDefined();
    expect(proof.publicInputs).toHaveLength(5);
  }, 30000); // Longer timeout for depth 20

  it('should generate valid proof for depth 22', async () => {
    const prover = await DistrictProver.getInstance(22);
    const witness = await generateTestWitnessForDepth(22);

    const proof = await prover.generateProof(witness);

    expect(proof).toBeDefined();
    expect(proof.publicInputs).toHaveLength(5);
  }, 30000); // Longer timeout for depth 22

  it('should work with convenience function generateProof', async () => {
    const witness = await generateTestWitnessForDepth(14);
    const proof = await generateProof(witness, 14);

    expect(proof).toBeDefined();
    expect(proof.publicInputs).toHaveLength(5);
  });
});

describe('DistrictProver - Proof Verification', () => {
  it('should verify valid proof', async () => {
    const prover = await DistrictProver.getInstance(14);
    const witness = await generateTestWitnessForDepth(14);

    const proof = await prover.generateProof(witness);

    const config: VerificationConfig = {
      expectedRoot: witness.merkle_root,
      expectedNullifier: witness.nullifier,
      expectedAuthorityHash: witness.authority_hash,
      expectedEpochId: witness.epoch_id,
      expectedCampaignId: witness.campaign_id,
    };

    const isValid = await prover.verifyProof(proof, config);
    expect(isValid).toBe(true);
  }, 30000);

  it('should reject proof with wrong merkle root', async () => {
    const prover = await DistrictProver.getInstance(14);
    const witness = await generateTestWitnessForDepth(14);

    const proof = await prover.generateProof(witness);

    const config: VerificationConfig = {
      expectedRoot: '0x' + '99'.repeat(32), // Wrong root
      expectedNullifier: witness.nullifier,
      expectedAuthorityHash: witness.authority_hash,
      expectedEpochId: witness.epoch_id,
      expectedCampaignId: witness.campaign_id,
    };

    const isValid = await prover.verifyProof(proof, config);
    expect(isValid).toBe(false);
  });

  it('should reject proof with wrong nullifier', async () => {
    const prover = await DistrictProver.getInstance(14);
    const witness = await generateTestWitnessForDepth(14);

    const proof = await prover.generateProof(witness);

    const config: VerificationConfig = {
      expectedRoot: witness.merkle_root,
      expectedNullifier: '0x' + '99'.repeat(32), // Wrong nullifier
      expectedAuthorityHash: witness.authority_hash,
      expectedEpochId: witness.epoch_id,
      expectedCampaignId: witness.campaign_id,
    };

    const isValid = await prover.verifyProof(proof, config);
    expect(isValid).toBe(false);
  });

  it('should work with convenience function verifyProof', async () => {
    const witness = await generateTestWitnessForDepth(14);
    const proof = await generateProof(witness, 14);

    const config: VerificationConfig = {
      expectedRoot: witness.merkle_root,
      expectedNullifier: witness.nullifier,
      expectedAuthorityHash: witness.authority_hash,
      expectedEpochId: witness.epoch_id,
      expectedCampaignId: witness.campaign_id,
    };

    const isValid = await verifyProof(proof, config, 14);
    expect(isValid).toBe(true);
  }, 30000);
});

describe('DistrictProver - Integration Tests', () => {
  it('should handle multiple proofs with same prover instance', async () => {
    const prover = await DistrictProver.getInstance(14);

    // Generate 3 different proofs
    const witness1 = await generateTestWitnessForDepth(14);
    const witness2 = await generateTestWitnessForDepth(14);
    const witness3 = await generateTestWitnessForDepth(14);

    const proof1 = await prover.generateProof(witness1);
    const proof2 = await prover.generateProof(witness2);
    const proof3 = await prover.generateProof(witness3);

    expect(proof1.publicInputs[0]).toBe(witness1.merkle_root);
    expect(proof2.publicInputs[0]).toBe(witness2.merkle_root);
    expect(proof3.publicInputs[0]).toBe(witness3.merkle_root);
  }, 60000);

  it('should handle cross-depth proving (different instances)', async () => {
    const witness14 = await generateTestWitnessForDepth(14);
    const witness20 = await generateTestWitnessForDepth(20);

    const proof14 = await generateProof(witness14, 14);
    const proof20 = await generateProof(witness20, 20);

    expect(proof14.publicInputs).toHaveLength(5);
    expect(proof20.publicInputs).toHaveLength(5);
  }, 60000);
});

describe('DistrictProver - Edge Cases', () => {
  it('should handle leaf_index at max boundary (2^depth - 1)', async () => {
    const hasher = await Poseidon2Hasher.getInstance();
    const prover = await DistrictProver.getInstance(14);

    // Generate witness with leaf_index at max boundary
    const userSecret = '0x' + '01'.repeat(32);
    const campaignId = '0x' + '02'.repeat(32);
    const authorityHash = '0x' + '03'.repeat(32);
    const epochId = '0x' + '04'.repeat(32);

    const nullifier = await hasher.hash4(userSecret, campaignId, authorityHash, epochId);

    const leaf = await hasher.hashSingle('0x' + '05'.repeat(32));
    const merklePath: string[] = [];

    // Build merkle path for max index (16383 for depth 14)
    // Max index means all bits are 1, so always hash(sibling, node)
    const maxIndex = 16383;
    let currentHash = leaf;
    for (let i = 0; i < 14; i++) {
      const sibling = await hasher.hashSingle(BigInt(i + 1000));
      merklePath.push('0x' + sibling.toString(16).padStart(64, '0'));
      // For max index (all 1s), we're always the right child: hash(sibling, node)
      currentHash = await hasher.hashPair(sibling, currentHash);
    }

    const witness: DistrictWitness = {
      merkle_root: '0x' + currentHash.toString(16).padStart(64, '0'),
      nullifier: '0x' + nullifier.toString(16).padStart(64, '0'),
      authority_hash: authorityHash,
      epoch_id: epochId,
      campaign_id: campaignId,
      leaf: '0x' + leaf.toString(16).padStart(64, '0'),
      merkle_path: merklePath,
      leaf_index: maxIndex,
      user_secret: userSecret,
    };

    const proof = await prover.generateProof(witness);
    expect(proof).toBeDefined();
  }, 30000);

  it('should handle zero values in private inputs', async () => {
    const hasher = await Poseidon2Hasher.getInstance();
    const prover = await DistrictProver.getInstance(14);

    // All zeros (valid but edge case)
    const userSecret = '0x' + '00'.repeat(32);
    const campaignId = '0x' + '00'.repeat(32);
    const authorityHash = '0x' + '00'.repeat(32);
    const epochId = '0x' + '00'.repeat(32);

    const nullifier = await hasher.hash4(userSecret, campaignId, authorityHash, epochId);

    const leaf = await hasher.hashSingle('0x' + '00'.repeat(32));
    const merklePath: string[] = [];

    let currentHash = leaf;
    for (let i = 0; i < 14; i++) {
      const sibling = await hasher.hashSingle(BigInt(i));
      merklePath.push('0x' + sibling.toString(16).padStart(64, '0'));
      currentHash = await hasher.hashPair(currentHash, sibling);
    }

    const witness: DistrictWitness = {
      merkle_root: '0x' + currentHash.toString(16).padStart(64, '0'),
      nullifier: '0x' + nullifier.toString(16).padStart(64, '0'),
      authority_hash: authorityHash,
      epoch_id: epochId,
      campaign_id: campaignId,
      leaf: '0x' + leaf.toString(16).padStart(64, '0'),
      merkle_path: merklePath,
      leaf_index: 0,
      user_secret: userSecret,
    };

    const proof = await prover.generateProof(witness);
    expect(proof).toBeDefined();
  }, 30000);

  it('should handle maximum valid field element (modulus - 1)', async () => {
    const prover = await DistrictProver.getInstance(14);
    const witness = await generateTestWitnessForDepth(14);

    // Set leaf to max valid field element
    const maxField = BN254_FIELD_MODULUS - 1n;
    witness.leaf = '0x' + maxField.toString(16).padStart(64, '0');

    // Note: This will fail circuit constraints because merkle root won't match,
    // but it should pass witness validation
    await expect(prover.generateProof(witness)).rejects.toThrow();
  });
});
