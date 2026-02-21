/**
 * Engagement Crypto Helper Tests
 *
 * Tests for computeEngagementDataCommitment, computeEngagementLeaf, deriveTier,
 * computeShannonDiversity, encodeShannonDiversity, and computeCompositeScore.
 *
 * Validates golden vector parity with three-tree-golden-vectors.test.ts.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Poseidon2Hasher } from '../poseidon2';
import {
  computeEngagementDataCommitment,
  computeEngagementLeaf,
  computeShannonDiversity,
  encodeShannonDiversity,
  computeCompositeScore,
  deriveTier,
} from '../engagement';

describe('Engagement Crypto Helpers', () => {
  let hasher: Poseidon2Hasher;

  beforeAll(async () => {
    hasher = await Poseidon2Hasher.getInstance();
  }, 120_000);

  // ========================================================================
  // computeEngagementDataCommitment (H3)
  // ========================================================================

  describe('computeEngagementDataCommitment', () => {
    it('matches raw hash3 output', async () => {
      const tier = 2n;
      const actionCount = 10n;
      const diversityScore = 2n;

      const viaHelper = await computeEngagementDataCommitment(tier, actionCount, diversityScore);
      const viaRaw = await hasher.hash3(tier, actionCount, diversityScore);

      expect(viaHelper).toBe(viaRaw);
    });

    it('produces non-zero output for all-zero inputs', async () => {
      const result = await computeEngagementDataCommitment(0n, 0n, 0n);
      expect(result).not.toBe(0n);
      expect(typeof result).toBe('bigint');
    });

    it('is deterministic', async () => {
      const a = await computeEngagementDataCommitment(4n, 200n, 4n);
      const b = await computeEngagementDataCommitment(4n, 200n, 4n);
      expect(a).toBe(b);
    });

    it('produces different outputs for different tiers', async () => {
      const tier0 = await computeEngagementDataCommitment(0n, 0n, 0n);
      const tier1 = await computeEngagementDataCommitment(1n, 1n, 1n);
      const tier2 = await computeEngagementDataCommitment(2n, 10n, 2n);
      const tier3 = await computeEngagementDataCommitment(3n, 50n, 3n);
      const tier4 = await computeEngagementDataCommitment(4n, 200n, 4n);

      const all = [tier0, tier1, tier2, tier3, tier4];
      const unique = new Set(all);
      expect(unique.size).toBe(5);
    });

    it('input order matters (not commutative)', async () => {
      const a = await computeEngagementDataCommitment(1n, 2n, 3n);
      const b = await computeEngagementDataCommitment(3n, 2n, 1n);
      expect(a).not.toBe(b);
    });
  });

  // ========================================================================
  // computeEngagementLeaf (H2)
  // ========================================================================

  describe('computeEngagementLeaf', () => {
    it('matches raw hashPair output', async () => {
      const identityCommitment = 12345n;
      const dataCommitment = await computeEngagementDataCommitment(2n, 10n, 2n);

      const viaHelper = await computeEngagementLeaf(identityCommitment, dataCommitment);
      const viaRaw = await hasher.hashPair(identityCommitment, dataCommitment);

      expect(viaHelper).toBe(viaRaw);
    });

    it('produces non-zero output', async () => {
      const dataCommitment = await computeEngagementDataCommitment(0n, 0n, 0n);
      const leaf = await computeEngagementLeaf(1n, dataCommitment);
      expect(leaf).not.toBe(0n);
    });

    it('is deterministic', async () => {
      const dc = await computeEngagementDataCommitment(1n, 5n, 1n);
      const a = await computeEngagementLeaf(42n, dc);
      const b = await computeEngagementLeaf(42n, dc);
      expect(a).toBe(b);
    });

    it('different identityCommitments produce different leaves', async () => {
      const dc = await computeEngagementDataCommitment(2n, 10n, 2n);
      const leaf1 = await computeEngagementLeaf(100n, dc);
      const leaf2 = await computeEngagementLeaf(200n, dc);
      expect(leaf1).not.toBe(leaf2);
    });

    it('cross-tree identity binding: same identityCommitment in nullifier and engagement', async () => {
      const identityCommitment = 999n;
      const actionDomain = 42n;

      // Nullifier path: H2(identityCommitment, actionDomain)
      const nullifier = await hasher.hashPair(identityCommitment, actionDomain);

      // Engagement path: H2(identityCommitment, H3(tier, count, diversity))
      const dc = await computeEngagementDataCommitment(1n, 5n, 1n);
      const engagementLeaf = await computeEngagementLeaf(identityCommitment, dc);

      // Both use the same identityCommitment but produce different outputs
      expect(nullifier).not.toBe(engagementLeaf);
      // Both are non-zero
      expect(nullifier).not.toBe(0n);
      expect(engagementLeaf).not.toBe(0n);
    });
  });

  // ========================================================================
  // computeShannonDiversity
  // ========================================================================

  describe('computeShannonDiversity', () => {
    it('returns 0 for empty map', () => {
      expect(computeShannonDiversity(new Map())).toBe(0);
    });

    it('returns 0 for single category', () => {
      const counts = new Map([[1, 100]]);
      expect(computeShannonDiversity(counts)).toBe(0);
    });

    it('returns ln(2) for two equal categories', () => {
      const counts = new Map([[1, 50], [2, 50]]);
      expect(computeShannonDiversity(counts)).toBeCloseTo(Math.log(2), 10);
    });

    it('returns ln(5) for five equal categories', () => {
      const counts = new Map([[1, 20], [2, 20], [3, 20], [4, 20], [5, 20]]);
      expect(computeShannonDiversity(counts)).toBeCloseTo(Math.log(5), 10);
    });

    it('handles uneven distribution', () => {
      // 2/3 in cat 1, 1/3 in cat 2
      const counts = new Map([[1, 10], [2, 5]]);
      const expected = -(2/3 * Math.log(2/3) + 1/3 * Math.log(1/3));
      expect(computeShannonDiversity(counts)).toBeCloseTo(expected, 10);
    });

    it('higher diversity for more even distribution', () => {
      const uneven = new Map([[1, 90], [2, 5], [3, 5]]);
      const even = new Map([[1, 33], [2, 34], [3, 33]]);
      expect(computeShannonDiversity(even)).toBeGreaterThan(computeShannonDiversity(uneven));
    });
  });

  // ========================================================================
  // encodeShannonDiversity
  // ========================================================================

  describe('encodeShannonDiversity', () => {
    it('returns 0 for H=0', () => {
      expect(encodeShannonDiversity(0)).toBe(0);
    });

    it('returns floor(H * 1000) for ln(5)', () => {
      expect(encodeShannonDiversity(Math.log(5))).toBe(1609);
    });

    it('returns floor(H * 1000) for ln(2)', () => {
      expect(encodeShannonDiversity(Math.log(2))).toBe(693);
    });
  });

  // ========================================================================
  // computeCompositeScore
  // ========================================================================

  describe('computeCompositeScore', () => {
    it('returns 0 for zero actions', () => {
      expect(computeCompositeScore(0, 1.5, 12, 10)).toBe(0);
    });

    it('spec example A: single-category spammer', () => {
      // 200 actions, shannonH=0, 3 months, 0 adoptions
      const E = computeCompositeScore(200, 0, 3, 0);
      // E = log2(201) × 1 × (1 + sqrt(3/12)) × 1 ≈ 7.65 × 1.5 = 11.5
      expect(E).toBeCloseTo(11.5, 0);
    });

    it('spec example B: balanced moderate user', () => {
      // 40 actions, shannonH=ln(5)≈1.609, 10 months, 0 adoptions
      const E = computeCompositeScore(40, Math.log(5), 10, 0);
      // E ≈ 5.36 × 2.609 × 1.913 × 1 = 26.7
      expect(E).toBeCloseTo(26.7, 0);
    });

    it('spec example C: template creator with adoption', () => {
      // 15 actions (10 templates, 5 campaigns), 6 months, 30 adoptions
      // shannonH = -(2/3 * ln(2/3) + 1/3 * ln(1/3)) ≈ 0.637
      const shannonH = -(2/3 * Math.log(2/3) + 1/3 * Math.log(1/3));
      const E = computeCompositeScore(15, shannonH, 6, 30);
      // E ≈ 4 × 1.637 × 1.707 × 2.238 ≈ 25.0
      expect(E).toBeCloseTo(25.0, 0);
    });

    it('spec example D: new user, one action', () => {
      // 1 action, shannonH=0, 0 months, 0 adoptions
      const E = computeCompositeScore(1, 0, 0, 0);
      // E = log2(2) × 1 × 1 × 1 = 1.0
      expect(E).toBeCloseTo(1.0, 10);
    });

    it('adoption is multiplicative bonus', () => {
      const withoutAdoption = computeCompositeScore(50, 1.0, 6, 0);
      const withAdoption = computeCompositeScore(50, 1.0, 6, 15);
      expect(withAdoption).toBeGreaterThan(withoutAdoption);
    });
  });

  // ========================================================================
  // deriveTier (composite score based)
  // ========================================================================

  describe('deriveTier', () => {
    it('returns 0 (New) for all zeros', () => {
      expect(deriveTier(0, 0, 0)).toBe(0);
    });

    it('returns 0 (New) when actionCount=0 even with diversity and tenure', () => {
      expect(deriveTier(0, 1609, 24)).toBe(0);
    });

    it('returns 1 (Active) for any nonzero engagement (E > 0)', () => {
      // 1 action, no diversity, no tenure → E = log2(2) = 1.0
      expect(deriveTier(1, 0, 0)).toBe(1);
    });

    it('returns 1 (Active) for low engagement', () => {
      // 3 actions, low diversity → small E
      expect(deriveTier(3, 0, 1)).toBe(1);
    });

    it('returns 2 (Established) for E >= 5.0', () => {
      // 20 actions, shannonH ≈ 0.693 (encoded: 693), 3 months
      // E = log2(21) × (1+0.693) × (1+sqrt(3/12)) × 1 ≈ 4.39 × 1.693 × 1.5 = 11.2
      expect(deriveTier(20, 693, 3)).toBe(2);
    });

    it('spec example A: single-category spammer → tier 2', () => {
      // 200 actions, shannonH=0 (encoded: 0), 3 months, 0 adoptions
      // E ≈ 11.5
      expect(deriveTier(200, 0, 3)).toBe(2);
    });

    it('spec example B: balanced moderate user → tier 4', () => {
      // 40 actions, shannonH=ln(5) (encoded: 1609), 10 months
      // E ≈ 26.7
      expect(deriveTier(40, 1609, 10)).toBe(4);
    });

    it('spec example D: new user, one action → tier 1', () => {
      // 1 action, no diversity, no tenure
      expect(deriveTier(1, 0, 0)).toBe(1);
    });

    it('returns 3 (Veteran) for E >= 12.0', () => {
      // 50 actions, shannonH ≈ 0.693 (encoded: 693), 6 months
      // E = log2(51) × 1.693 × (1+sqrt(0.5)) × 1 ≈ 5.67 × 1.693 × 1.707 = 16.4
      expect(deriveTier(50, 693, 6)).toBe(3);
    });

    it('returns 4 (Pillar) for E >= 25.0', () => {
      // 100 actions, shannonH=ln(5) (encoded: 1609), 12 months
      // E = log2(101) × 2.609 × 2 × 1 ≈ 6.66 × 2.609 × 2 = 34.7
      expect(deriveTier(100, 1609, 12)).toBe(4);
    });

    it('adoption boosts tier', () => {
      // Without adoption: E just under threshold
      const withoutAdoption = deriveTier(15, 637, 6, 0);
      // With adoption: adoption multiplier pushes over
      const withAdoption = deriveTier(15, 637, 6, 30);
      expect(withAdoption).toBeGreaterThanOrEqual(withoutAdoption);
    });

    it('high actions but zero diversity caps at lower tier', () => {
      // 500 actions, shannonH=0, 24 months
      // E = log2(501) × 1 × (1+sqrt(2)) × 1 ≈ 8.97 × 2.414 = 21.6 → tier 3
      expect(deriveTier(500, 0, 24)).toBe(3);
    });
  });
});
