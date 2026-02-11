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

  describe('replaceLeaf', () => {
    it('zeroes old leaf and inserts new at next position', async () => {
      const oldLeaf = '0x' + '01'.padStart(64, '0');
      const newLeaf = '0x' + 'ff'.padStart(64, '0');
      await service.insertLeaf(oldLeaf);

      const result = await service.replaceLeaf(0, newLeaf);

      // New leaf is at index 1 (next available)
      expect(result.leafIndex).toBe(1);
      expect(result.userPath).toHaveLength(TEST_DEPTH);
      expect(result.pathIndices).toHaveLength(TEST_DEPTH);
    });

    it('changes root after replacement', async () => {
      await service.insertLeaf('0x' + '01'.padStart(64, '0'));
      const rootBefore = service.getRootHex();

      await service.replaceLeaf(0, '0x' + 'ff'.padStart(64, '0'));
      const rootAfter = service.getRootHex();

      expect(rootAfter).not.toBe(rootBefore);
    });

    it('old proof invalid against new root', async () => {
      const hasher = await getHasher();

      // Insert and get proof for leaf at index 0
      const leaf0 = await hasher.hash3(10n, 20n, 30n);
      await service.insertLeaf('0x' + leaf0.toString(16));
      const proofBefore = service.getProof(0);

      // Replace leaf 0
      const newLeaf = await hasher.hash3(40n, 50n, 60n);
      const replaceResult = await service.replaceLeaf(0, '0x' + newLeaf.toString(16));

      // Old proof's root no longer matches
      expect(proofBefore.userRoot).not.toBe(replaceResult.userRoot);
    });

    it('new proof valid against new root', async () => {
      const hasher = await getHasher();

      const leaf0 = await hasher.hash3(10n, 20n, 30n);
      await service.insertLeaf('0x' + leaf0.toString(16));

      const newLeaf = await hasher.hash3(40n, 50n, 60n);
      const result = await service.replaceLeaf(0, '0x' + newLeaf.toString(16));

      // Verify proof for new leaf recomputes to root
      let currentHash = newLeaf;
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

    it('rejects invalid old leaf index (negative)', async () => {
      await expect(
        service.replaceLeaf(-1, '0x' + 'ff'.padStart(64, '0'))
      ).rejects.toThrow('INVALID_OLD_INDEX');
    });

    it('rejects old index beyond tree size', async () => {
      await service.insertLeaf('0x' + '01'.padStart(64, '0'));

      // Index 1 is beyond tree size (only index 0 exists)
      await expect(
        service.replaceLeaf(1, '0x' + 'ff'.padStart(64, '0'))
      ).rejects.toThrow('INVALID_OLD_INDEX');
    });

    it('rejects replacement when old position already empty', async () => {
      const leaf1 = '0x' + '01'.padStart(64, '0');
      const leaf2 = '0x' + '02'.padStart(64, '0');
      await service.insertLeaf(leaf1);
      await service.insertLeaf(leaf2);

      // Replace at index 0
      await service.replaceLeaf(0, '0x' + 'aa'.padStart(64, '0'));

      // Try to replace at index 0 again — should be empty now
      await expect(
        service.replaceLeaf(0, '0x' + 'bb'.padStart(64, '0'))
      ).rejects.toThrow('OLD_LEAF_ALREADY_EMPTY');
    });

    it('rejects duplicate new leaf', async () => {
      const leaf1 = '0x' + '01'.padStart(64, '0');
      const leaf2 = '0x' + '02'.padStart(64, '0');
      await service.insertLeaf(leaf1);
      await service.insertLeaf(leaf2);

      // Try replacing leaf1 with leaf2 (leaf2 already exists)
      await expect(
        service.replaceLeaf(0, leaf2)
      ).rejects.toThrow('DUPLICATE_LEAF');
    });

    it('rejects same leaf as old (caught by duplicate check)', async () => {
      const leaf = '0x' + '01'.padStart(64, '0');
      await service.insertLeaf(leaf);

      // Same leaf is in leafSet, so DUPLICATE_LEAF fires before SAME_LEAF
      await expect(
        service.replaceLeaf(0, leaf)
      ).rejects.toThrow('DUPLICATE_LEAF');
    });

    it('serializes concurrent replacements', async () => {
      // Insert 4 leaves
      for (let i = 1; i <= 4; i++) {
        await service.insertLeaf('0x' + i.toString(16).padStart(64, '0'));
      }

      // Replace leaf 0 and leaf 1 concurrently
      const [r1, r2] = await Promise.all([
        service.replaceLeaf(0, '0x' + 'a0'.padStart(64, '0')),
        service.replaceLeaf(1, '0x' + 'b0'.padStart(64, '0')),
      ]);

      // Both should succeed with different indices
      expect(new Set([r1.leafIndex, r2.leafIndex]).size).toBe(2);
      // Both should report the final root
      expect(service.leafCount).toBe(6); // 4 original + 2 new
    });

    it('leafCount correct after replacement', async () => {
      await service.insertLeaf('0x' + '01'.padStart(64, '0'));
      await service.insertLeaf('0x' + '02'.padStart(64, '0'));
      expect(service.leafCount).toBe(2);

      await service.replaceLeaf(0, '0x' + 'ff'.padStart(64, '0'));
      // nextLeafIndex is now 3 (the new leaf went to index 2)
      expect(service.leafCount).toBe(3);
    });

    it('rejects when tree is full (no room for new leaf)', async () => {
      // Fill tree to capacity (depth=4 → 16 leaves)
      for (let i = 1; i <= 16; i++) {
        await service.insertLeaf('0x' + i.toString(16).padStart(64, '0'));
      }
      expect(service.isFull).toBe(true);

      // Try to replace — tree has no room for the new leaf
      await expect(
        service.replaceLeaf(0, '0x' + 'ff'.padStart(64, '0'))
      ).rejects.toThrow('capacity');
    });

    it('succeeds when tree has exactly 1 slot remaining', async () => {
      // Fill 15 of 16 slots (depth=4)
      for (let i = 1; i <= 15; i++) {
        await service.insertLeaf('0x' + i.toString(16).padStart(64, '0'));
      }
      expect(service.leafCount).toBe(15);

      // Replace leaf 0 — new leaf goes into the last slot (index 15)
      const result = await service.replaceLeaf(
        0,
        '0x' + 'aa'.padStart(64, '0'),
      );
      expect(result.leafIndex).toBe(15);
      expect(service.leafCount).toBe(16);
      expect(service.isFull).toBe(true);
    });

    it('concurrent replacements of the same old leaf — second fails', async () => {
      await service.insertLeaf('0x' + '01'.padStart(64, '0'));
      await service.insertLeaf('0x' + '02'.padStart(64, '0'));

      // Fire two replacements of the same old index concurrently
      const p1 = service.replaceLeaf(0, '0x' + 'aa'.padStart(64, '0'));
      const p2 = service.replaceLeaf(0, '0x' + 'bb'.padStart(64, '0'));

      const results = await Promise.allSettled([p1, p2]);

      // One should succeed, one should fail (old leaf already empty)
      const successes = results.filter(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected');

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect((failures[0] as PromiseRejectedResult).reason.message).toBe(
        'OLD_LEAF_ALREADY_EMPTY',
      );
    });
  });

  describe('replaceLeaf with insertion log', () => {
    it('records replace entry in insertion log', async () => {
      const { InsertionLog } = await import('../../../serving/insertion-log');
      const tmpDir = '/tmp/voter-test-replace-' + Date.now();
      const logPath = tmpDir + '/tree1.ndjson';

      const serviceWithLog = await RegistrationService.create(TEST_DEPTH, {
        path: logPath,
      });

      try {
        await serviceWithLog.insertLeaf('0x' + '01'.padStart(64, '0'));
        await serviceWithLog.replaceLeaf(0, '0x' + 'ff'.padStart(64, '0'));

        const log = serviceWithLog.getInsertionLog()!;
        const entries = await log.replay();

        expect(entries).toHaveLength(2);
        expect(entries[0].index).toBe(0);
        expect(entries[0].type).toBeUndefined(); // or 'insert'
        expect(entries[1].type).toBe('replace');
        expect(entries[1].oldIndex).toBe(0);
        expect(entries[1].index).toBe(1);
      } finally {
        await serviceWithLog.close();
      }
    });

    it('replay from log restores tree state after replacement', async () => {
      const tmpDir = '/tmp/voter-test-replay-replace-' + Date.now();
      const logPath = tmpDir + '/tree1.ndjson';

      // Create service, insert, replace, close
      const service1 = await RegistrationService.create(TEST_DEPTH, {
        path: logPath,
      });
      await service1.insertLeaf('0x' + '01'.padStart(64, '0'));
      await service1.insertLeaf('0x' + '02'.padStart(64, '0'));
      await service1.replaceLeaf(0, '0x' + 'ff'.padStart(64, '0'));

      const rootAfterReplace = service1.getRootHex();
      const leafCountAfterReplace = service1.leafCount;
      await service1.close();

      // Create new service from same log — should replay to same state
      const service2 = await RegistrationService.create(TEST_DEPTH, {
        path: logPath,
      });

      expect(service2.getRootHex()).toBe(rootAfterReplace);
      expect(service2.leafCount).toBe(leafCountAfterReplace);

      await service2.close();
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
