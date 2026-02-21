/**
 * Engagement Service Tests
 *
 * Tests Tree 3 management with real Poseidon2 hashing.
 * No mocks — exercises the full Merkle tree logic including
 * upsert semantics, identity registration, and metrics updates.
 *
 * diversityScore is Shannon diversity encoded as floor(H × 1000).
 * Common values: 0 (single cat), 693 (2 equal cats), 1098 (3), 1386 (4), 1609 (5).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getHasher } from '@voter-protocol/crypto/poseidon2';
import {
  computeEngagementDataCommitment,
  computeEngagementLeaf,
  deriveTier,
} from '@voter-protocol/crypto/engagement';
import { EngagementService } from '../../../serving/engagement-service';

const BN254_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Use depth=4 for fast tests (16 leaves max)
const TEST_DEPTH = 4;

// Shannon-encoded diversity scores for common distributions
const SHANNON_2_CAT = Math.floor(Math.log(2) * 1000); // 693
const SHANNON_3_CAT = Math.floor(Math.log(3) * 1000); // 1098
const SHANNON_4_CAT = Math.floor(Math.log(4) * 1000); // 1386

describe('EngagementService', () => {
  let service: EngagementService;

  beforeEach(async () => {
    service = await EngagementService.create(TEST_DEPTH);
  });

  // ========================================================================
  // Empty Tree
  // ========================================================================

  describe('empty tree', () => {
    it('has non-zero root', () => {
      expect(service.getRoot()).not.toBe(0n);
    });

    it('has zero leaf count', () => {
      expect(service.getLeafCount()).toBe(0);
    });

    it('has correct depth', () => {
      expect(service.getDepth()).toBe(TEST_DEPTH);
    });

    it('root hex is well-formed', () => {
      expect(service.getRootHex()).toMatch(/^0x[0-9a-f]+$/);
    });
  });

  // ========================================================================
  // Identity Registration
  // ========================================================================

  describe('registerIdentity', () => {
    it('registers first identity at index 0', async () => {
      const ic = 12345n;
      const leafIndex = await service.registerIdentity('0xABC', ic);
      expect(leafIndex).toBe(0);
      expect(service.getLeafCount()).toBe(1);
    });

    it('assigns sequential indices', async () => {
      const idx0 = await service.registerIdentity('0xA', 100n);
      const idx1 = await service.registerIdentity('0xB', 200n);
      const idx2 = await service.registerIdentity('0xC', 300n);
      expect(idx0).toBe(0);
      expect(idx1).toBe(1);
      expect(idx2).toBe(2);
    });

    it('changes root after registration', async () => {
      const emptyRoot = service.getRoot();
      await service.registerIdentity('0xA', 100n);
      expect(service.getRoot()).not.toBe(emptyRoot);
    });

    it('registers with tier 0 metrics', async () => {
      await service.registerIdentity('0xA', 100n);
      const record = service.getMetrics(100n);
      expect(record).not.toBeNull();
      expect(record!.tier).toBe(0);
      expect(record!.metrics.actionCount).toBe(0);
      expect(record!.metrics.diversityScore).toBe(0);
      expect(record!.metrics.tenureMonths).toBe(0);
    });

    it('rejects duplicate identityCommitment', async () => {
      await service.registerIdentity('0xA', 100n);
      await expect(service.registerIdentity('0xB', 100n)).rejects.toThrow(
        'IDENTITY_ALREADY_REGISTERED'
      );
    });

    it('rejects duplicate signer address', async () => {
      await service.registerIdentity('0xA', 100n);
      await expect(service.registerIdentity('0xA', 200n)).rejects.toThrow(
        'SIGNER_ALREADY_REGISTERED'
      );
    });

    it('normalizes signer address to lowercase', async () => {
      await service.registerIdentity('0xABC', 100n);
      const record = service.getMetricsBySigner('0xabc');
      expect(record).not.toBeNull();
      expect(record!.identityCommitment).toBe(100n);
    });

    it('rejects zero identityCommitment', async () => {
      await expect(service.registerIdentity('0xA', 0n)).rejects.toThrow(
        'valid BN254 field element'
      );
    });

    it('rejects identityCommitment at BN254 modulus', async () => {
      await expect(
        service.registerIdentity('0xA', BN254_MODULUS)
      ).rejects.toThrow('valid BN254 field element');
    });

    it('rejects when tree is full', async () => {
      // depth=4 → capacity=16
      for (let i = 1; i <= 16; i++) {
        await service.registerIdentity(`0x${i}`, BigInt(i));
      }
      await expect(
        service.registerIdentity('0x17', 17n)
      ).rejects.toThrow('capacity');
    });

    it('computes correct leaf hash (H2(ic, H3(0, 0, 0)))', async () => {
      const ic = 42n;
      await service.registerIdentity('0xA', ic);

      // Manually compute expected leaf
      const dc = await computeEngagementDataCommitment(0n, 0n, 0n);
      const expectedLeaf = await computeEngagementLeaf(ic, dc);

      // Verify via Merkle proof recomputation
      const proof = service.getProof(0);
      const hasher = await getHasher();

      let current = expectedLeaf;
      for (let i = 0; i < proof.engagementPath.length; i++) {
        const sibling = BigInt(proof.engagementPath[i]);
        if (proof.pathIndices[i] === 0) {
          current = await hasher.hashPair(current, sibling);
        } else {
          current = await hasher.hashPair(sibling, current);
        }
      }

      expect('0x' + current.toString(16)).toBe(proof.engagementRoot);
    });
  });

  // ========================================================================
  // Metrics Update (Upsert)
  // ========================================================================

  describe('updateMetrics', () => {
    it('updates leaf and returns new root', async () => {
      await service.registerIdentity('0xA', 100n);
      const rootBefore = service.getRoot();

      // 10 actions, Shannon H≈0.693 (2 equal cats), 0 months → E≈5.86 → tier 2
      const result = await service.updateMetrics(100n, {
        actionCount: 10,
        diversityScore: SHANNON_2_CAT,
        tenureMonths: 0,
      });

      expect(service.getRoot()).not.toBe(rootBefore);
      expect(result.tier).toBe(2); // Established
      expect(result.actionCount).toBe(10);
      expect(result.diversityScore).toBe(SHANNON_2_CAT);
      expect(result.engagementRoot).toBe(service.getRootHex());
    });

    it('keeps same leafIndex after update', async () => {
      const leafIndex = await service.registerIdentity('0xA', 100n);
      const result = await service.updateMetrics(100n, {
        actionCount: 1,
        diversityScore: 0,
        tenureMonths: 0,
      });
      expect(result.leafIndex).toBe(leafIndex);
    });

    it('does not change leaf count', async () => {
      await service.registerIdentity('0xA', 100n);
      expect(service.getLeafCount()).toBe(1);

      await service.updateMetrics(100n, {
        actionCount: 1,
        diversityScore: 0,
        tenureMonths: 0,
      });
      expect(service.getLeafCount()).toBe(1);
    });

    it('updates identity record tier', async () => {
      await service.registerIdentity('0xA', 100n);

      // 200 actions, Shannon H≈1.386 (4 equal cats), 12 months → E≈36.5 → tier 4
      await service.updateMetrics(100n, {
        actionCount: 200,
        diversityScore: SHANNON_4_CAT,
        tenureMonths: 12,
      });

      const record = service.getMetrics(100n);
      expect(record!.tier).toBe(4); // Pillar
      expect(record!.metrics.actionCount).toBe(200);
    });

    it('rejects update for unregistered identity', async () => {
      await expect(
        service.updateMetrics(999n, {
          actionCount: 1,
          diversityScore: 0,
          tenureMonths: 0,
        })
      ).rejects.toThrow('IDENTITY_NOT_REGISTERED');
    });

    it('correctly derives all 5 tiers through updates', async () => {
      await service.registerIdentity('0xA', 100n);

      // Tier 0: default at registration
      expect(service.getMetrics(100n)!.tier).toBe(0);

      // Tier 1: Active (any nonzero E)
      await service.updateMetrics(100n, { actionCount: 1, diversityScore: 0, tenureMonths: 0 });
      expect(service.getMetrics(100n)!.tier).toBe(1);

      // Tier 2: Established (E >= 5.0)
      // 10 actions, Shannon 2-cat, 0 months → E≈5.86
      await service.updateMetrics(100n, { actionCount: 10, diversityScore: SHANNON_2_CAT, tenureMonths: 0 });
      expect(service.getMetrics(100n)!.tier).toBe(2);

      // Tier 3: Veteran (E >= 12.0)
      // 50 actions, Shannon 3-cat, 6 months → E≈20.3
      await service.updateMetrics(100n, { actionCount: 50, diversityScore: SHANNON_3_CAT, tenureMonths: 6 });
      expect(service.getMetrics(100n)!.tier).toBe(3);

      // Tier 4: Pillar (E >= 25.0)
      // 200 actions, Shannon 4-cat, 12 months → E≈36.5
      await service.updateMetrics(100n, { actionCount: 200, diversityScore: SHANNON_4_CAT, tenureMonths: 12 });
      expect(service.getMetrics(100n)!.tier).toBe(4);
    });

    it('returns valid Merkle proof after update', async () => {
      const ic = 100n;
      await service.registerIdentity('0xA', ic);
      const result = await service.updateMetrics(ic, {
        actionCount: 10,
        diversityScore: SHANNON_2_CAT,
        tenureMonths: 0,
      });

      // Recompute expected leaf
      const tier = deriveTier(10, SHANNON_2_CAT, 0);
      const dc = await computeEngagementDataCommitment(BigInt(tier), 10n, BigInt(SHANNON_2_CAT));
      const expectedLeaf = await computeEngagementLeaf(ic, dc);

      // Verify Merkle proof
      const hasher = await getHasher();
      let current = expectedLeaf;
      for (let i = 0; i < result.engagementPath.length; i++) {
        const sibling = BigInt(result.engagementPath[i]);
        if (result.pathIndices[i] === 0) {
          current = await hasher.hashPair(current, sibling);
        } else {
          current = await hasher.hashPair(sibling, current);
        }
      }

      expect('0x' + current.toString(16)).toBe(result.engagementRoot);
    });
  });

  // ========================================================================
  // Batch Update
  // ========================================================================

  describe('batchUpdate', () => {
    it('updates multiple registered identities', async () => {
      await service.registerIdentity('0xA', 100n);
      await service.registerIdentity('0xB', 200n);
      const rootBefore = service.getRoot();

      await service.batchUpdate([
        { identityCommitment: 100n, tier: 2, actionCount: 10n, diversityScore: BigInt(SHANNON_2_CAT) },
        { identityCommitment: 200n, tier: 1, actionCount: 1n, diversityScore: 0n },
      ]);

      expect(service.getRoot()).not.toBe(rootBefore);
      expect(service.getMetrics(100n)!.metrics.actionCount).toBe(10);
      expect(service.getMetrics(200n)!.metrics.actionCount).toBe(1);
    });

    it('skips unregistered identities in batch', async () => {
      await service.registerIdentity('0xA', 100n);

      await service.batchUpdate([
        { identityCommitment: 100n, tier: 1, actionCount: 1n, diversityScore: 0n },
        { identityCommitment: 999n, tier: 2, actionCount: 10n, diversityScore: BigInt(SHANNON_2_CAT) }, // unregistered
      ]);

      expect(service.getMetrics(100n)!.metrics.actionCount).toBe(1);
      expect(service.getMetrics(999n)).toBeNull();
    });
  });

  // ========================================================================
  // Read Operations
  // ========================================================================

  describe('getProof', () => {
    it('throws for out-of-range leaf index', () => {
      expect(() => service.getProof(0)).toThrow('out of range');
    });

    it('throws for negative index', () => {
      expect(() => service.getProof(-1)).toThrow('out of range');
    });

    it('returns proof with correct dimensions', async () => {
      await service.registerIdentity('0xA', 100n);
      const proof = service.getProof(0);

      expect(proof.leafIndex).toBe(0);
      expect(proof.engagementPath).toHaveLength(TEST_DEPTH);
      expect(proof.pathIndices).toHaveLength(TEST_DEPTH);
      expect(proof.engagementRoot).toMatch(/^0x[0-9a-f]+$/);
    });

    it('returns fresh proof reflecting latest root', async () => {
      await service.registerIdentity('0xA', 100n);
      const proofBefore = service.getProof(0);

      await service.registerIdentity('0xB', 200n);
      const proofAfter = service.getProof(0);

      expect(proofAfter.engagementRoot).not.toBe(proofBefore.engagementRoot);
    });

    it('returns correct metrics in proof', async () => {
      await service.registerIdentity('0xA', 100n);
      // 50 actions, Shannon 3-cat, 6 months → tier 3
      await service.updateMetrics(100n, { actionCount: 50, diversityScore: SHANNON_3_CAT, tenureMonths: 6 });
      const proof = service.getProof(0);

      expect(proof.tier).toBe(3);
      expect(proof.actionCount).toBe(50);
      expect(proof.diversityScore).toBe(SHANNON_3_CAT);
    });
  });

  describe('getMetrics', () => {
    it('returns null for unregistered identity', () => {
      expect(service.getMetrics(999n)).toBeNull();
    });

    it('returns record for registered identity', async () => {
      await service.registerIdentity('0xSigner', 42n);
      const record = service.getMetrics(42n);
      expect(record).not.toBeNull();
      expect(record!.identityCommitment).toBe(42n);
      expect(record!.signerAddress).toBe('0xsigner');
      expect(record!.leafIndex).toBe(0);
    });
  });

  describe('getMetricsBySigner', () => {
    it('returns null for unknown signer', () => {
      expect(service.getMetricsBySigner('0xUnknown')).toBeNull();
    });

    it('returns record by signer address (case-insensitive)', async () => {
      await service.registerIdentity('0xABC', 42n);
      const record = service.getMetricsBySigner('0xabc');
      expect(record).not.toBeNull();
      expect(record!.identityCommitment).toBe(42n);
    });
  });

  // ========================================================================
  // Merkle Proof Validity (cross-verification)
  // ========================================================================

  describe('Merkle proof validity', () => {
    it('produces valid proofs after multiple registrations', async () => {
      const hasher = await getHasher();
      const identities = [100n, 200n, 300n, 400n, 500n];
      const signers = ['0xa', '0xb', '0xc', '0xd', '0xe'];

      for (let i = 0; i < identities.length; i++) {
        await service.registerIdentity(signers[i], identities[i]);
      }

      // Verify proof for each leaf
      for (let idx = 0; idx < identities.length; idx++) {
        const proof = service.getProof(idx);
        const dc = await computeEngagementDataCommitment(0n, 0n, 0n);
        const leaf = await computeEngagementLeaf(identities[idx], dc);

        let current = leaf;
        for (let i = 0; i < proof.engagementPath.length; i++) {
          const sibling = BigInt(proof.engagementPath[i]);
          if (proof.pathIndices[i] === 0) {
            current = await hasher.hashPair(current, sibling);
          } else {
            current = await hasher.hashPair(sibling, current);
          }
        }
        expect('0x' + current.toString(16)).toBe(proof.engagementRoot);
      }
    });

    it('proof remains valid after upsert', async () => {
      const hasher = await getHasher();
      await service.registerIdentity('0xa', 100n);
      await service.registerIdentity('0xb', 200n);

      // Update identity 100 with Shannon-encoded diversity
      await service.updateMetrics(100n, {
        actionCount: 10,
        diversityScore: SHANNON_2_CAT,
        tenureMonths: 0,
      });

      // Verify proof for updated leaf
      const proof = service.getProof(0);
      const tier = deriveTier(10, SHANNON_2_CAT, 0);
      const dc = await computeEngagementDataCommitment(BigInt(tier), 10n, BigInt(SHANNON_2_CAT));
      const leaf = await computeEngagementLeaf(100n, dc);

      let current = leaf;
      for (let i = 0; i < proof.engagementPath.length; i++) {
        const sibling = BigInt(proof.engagementPath[i]);
        if (proof.pathIndices[i] === 0) {
          current = await hasher.hashPair(current, sibling);
        } else {
          current = await hasher.hashPair(sibling, current);
        }
      }
      expect('0x' + current.toString(16)).toBe(proof.engagementRoot);

      // Also verify proof for non-updated leaf still valid
      const proof2 = service.getProof(1);
      const dc2 = await computeEngagementDataCommitment(0n, 0n, 0n);
      const leaf2 = await computeEngagementLeaf(200n, dc2);

      let current2 = leaf2;
      for (let i = 0; i < proof2.engagementPath.length; i++) {
        const sibling = BigInt(proof2.engagementPath[i]);
        if (proof2.pathIndices[i] === 0) {
          current2 = await hasher.hashPair(current2, sibling);
        } else {
          current2 = await hasher.hashPair(sibling, current2);
        }
      }
      expect('0x' + current2.toString(16)).toBe(proof2.engagementRoot);
    });
  });

  // ========================================================================
  // Concurrent Operations
  // ========================================================================

  describe('concurrent registration serialization', () => {
    it('handles concurrent registrations without conflicts', async () => {
      const promises = [];
      for (let i = 1; i <= 8; i++) {
        promises.push(service.registerIdentity(`0x${i}`, BigInt(i)));
      }

      const results = await Promise.all(promises);
      const indices = results.sort((a, b) => a - b);
      expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(service.getLeafCount()).toBe(8);
    });
  });

  // ========================================================================
  // Lifecycle
  // ========================================================================

  describe('close', () => {
    it('closes without error', async () => {
      await expect(service.close()).resolves.not.toThrow();
    });

    it('can be called multiple times', async () => {
      await service.close();
      await expect(service.close()).resolves.not.toThrow();
    });
  });
});
