/**
 * Registration Service Tests
 *
 * Tests Tree 1 incremental insertion with real Poseidon2 hashing.
 * No mocks — exercises the full Merkle tree logic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RegistrationService } from '../../../serving/registration-service';
import { getHasher } from '@voter-protocol/crypto/poseidon2';
import { verifyUserProof } from '../../../dual-tree-builder';

const BN254_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Use depth=4 for fast tests (16 leaves max)
const TEST_DEPTH = 4;

describe('RegistrationService', () => {
  let service: RegistrationService;

  beforeEach(async () => {
    service = await RegistrationService.create(TEST_DEPTH);
  });

  describe('insertLeaf', () => {
    it('inserts first leaf at index 0', async () => {
      const leaf = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const result = await service.insertLeaf(leaf);

      expect(result.leafIndex).toBe(0);
      expect(result.userRoot).toMatch(/^0x[0-9a-f]+$/);
      expect(result.userPath).toHaveLength(TEST_DEPTH);
      expect(result.pathIndices).toHaveLength(TEST_DEPTH);
      expect(result.pathIndices[0]).toBe(0); // First leaf is left child
    });

    it('assigns sequential indices', async () => {
      const results = [];
      for (let i = 1; i <= 5; i++) {
        const leaf = '0x' + i.toString(16).padStart(64, '0');
        results.push(await service.insertLeaf(leaf));
      }

      for (let i = 0; i < 5; i++) {
        expect(results[i].leafIndex).toBe(i);
      }
    });

    it('changes root after each insertion', async () => {
      const emptyRoot = service.getRootHex();

      const result1 = await service.insertLeaf('0x' + '01'.padStart(64, '0'));
      expect(result1.userRoot).not.toBe(emptyRoot);

      const result2 = await service.insertLeaf('0x' + '02'.padStart(64, '0'));
      expect(result2.userRoot).not.toBe(result1.userRoot);
    });

    it('rejects zero leaf (SA-011)', async () => {
      await expect(service.insertLeaf('0x0')).rejects.toThrow('Zero leaf');
    });

    it('rejects leaf exceeding BN254 field modulus', async () => {
      const overflow = '0x' + BN254_MODULUS.toString(16);
      await expect(service.insertLeaf(overflow)).rejects.toThrow('exceeds BN254');
    });

    it('rejects duplicate leaf', async () => {
      // Use a value within BN254 field (starts with 0x01...)
      const leaf = '0x' + '01' + 'ab'.repeat(31);
      await service.insertLeaf(leaf);
      await expect(service.insertLeaf(leaf)).rejects.toThrow('DUPLICATE_LEAF');
    });

    it('rejects invalid hex string', async () => {
      await expect(service.insertLeaf('0xGGGG')).rejects.toThrow('Invalid hex');
    });

    it('accepts leaf without 0x prefix', async () => {
      // Use a value within BN254 field (starts with 01...)
      const leaf = '01' + 'cd'.repeat(31);
      const result = await service.insertLeaf(leaf);
      expect(result.leafIndex).toBe(0);
    });

    it('rejects when tree is full', async () => {
      // depth=4 → capacity=16
      for (let i = 1; i <= 16; i++) {
        await service.insertLeaf('0x' + i.toString(16).padStart(64, '0'));
      }

      expect(service.isFull).toBe(true);
      await expect(
        service.insertLeaf('0x' + (17).toString(16).padStart(64, '0'))
      ).rejects.toThrow('capacity');
    });
  });

  describe('Merkle proof validity', () => {
    it('produces valid proof for single insertion', async () => {
      const hasher = await getHasher();

      // Compute a real leaf: hash3(secret, cellId, salt)
      const userSecret = 42n;
      const cellId = 6075061200n;
      const salt = 123456789n;
      const leaf = await hasher.hash3(userSecret, cellId, salt);

      const result = await service.insertLeaf('0x' + leaf.toString(16));

      // Verify: recompute root from leaf + path
      let currentHash = leaf;
      for (let i = 0; i < result.userPath.length; i++) {
        const sibling = BigInt(result.userPath[i]);
        if (result.pathIndices[i] === 0) {
          currentHash = await hasher.hashPair(currentHash, sibling);
        } else {
          currentHash = await hasher.hashPair(sibling, currentHash);
        }
      }

      expect('0x' + currentHash.toString(16)).toBe(result.userRoot);
    });

    it('produces valid proofs after multiple insertions', async () => {
      const hasher = await getHasher();
      const leaves: bigint[] = [];

      // Insert 8 leaves
      for (let i = 1; i <= 8; i++) {
        const leaf = await hasher.hash3(BigInt(i), BigInt(i * 100), BigInt(i * 1000));
        leaves.push(leaf);
        await service.insertLeaf('0x' + leaf.toString(16));
      }

      // Verify proof for each leaf
      for (let idx = 0; idx < leaves.length; idx++) {
        const proof = service.getProof(idx);
        let currentHash = leaves[idx];

        for (let i = 0; i < proof.userPath.length; i++) {
          const sibling = BigInt(proof.userPath[i]);
          if (proof.pathIndices[i] === 0) {
            currentHash = await hasher.hashPair(currentHash, sibling);
          } else {
            currentHash = await hasher.hashPair(sibling, currentHash);
          }
        }

        expect('0x' + currentHash.toString(16)).toBe(proof.userRoot);
      }
    });
  });

  describe('getProof', () => {
    it('throws for out-of-range leaf index', () => {
      expect(() => service.getProof(0)).toThrow('out of range');
    });

    it('throws for negative index', () => {
      expect(() => service.getProof(-1)).toThrow('out of range');
    });

    it('returns fresh proof reflecting latest root', async () => {
      await service.insertLeaf('0x' + '01'.padStart(64, '0'));
      const proofBefore = service.getProof(0);

      await service.insertLeaf('0x' + '02'.padStart(64, '0'));
      const proofAfter = service.getProof(0);

      // Same leaf, but root changed due to second insertion
      expect(proofAfter.userRoot).not.toBe(proofBefore.userRoot);
      // Path should differ at some level
      expect(proofAfter.userPath).not.toEqual(proofBefore.userPath);
    });
  });

  describe('concurrent insertion serialization', () => {
    it('handles concurrent insertions without conflicts', async () => {
      // Fire 8 concurrent insertions
      const promises = [];
      for (let i = 1; i <= 8; i++) {
        promises.push(service.insertLeaf('0x' + i.toString(16).padStart(64, '0')));
      }

      const results = await Promise.all(promises);

      // All should have unique sequential indices
      const indices = results.map(r => r.leafIndex).sort((a, b) => a - b);
      expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

      // All should have the same final root
      const finalRoot = service.getRootHex();
      expect(results[results.length - 1].userRoot).toBe(finalRoot);

      expect(service.leafCount).toBe(8);
    });
  });

  describe('state accessors', () => {
    it('reports correct leafCount', async () => {
      expect(service.leafCount).toBe(0);
      await service.insertLeaf('0x' + '01'.padStart(64, '0'));
      expect(service.leafCount).toBe(1);
    });

    it('reports isFull correctly', async () => {
      expect(service.isFull).toBe(false);
      for (let i = 1; i <= 16; i++) {
        await service.insertLeaf('0x' + i.toString(16).padStart(64, '0'));
      }
      expect(service.isFull).toBe(true);
    });
  });
});
