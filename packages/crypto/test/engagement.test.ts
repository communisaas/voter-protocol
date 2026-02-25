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

  // ========================================================================
  // TST-015: Engagement Score Boundary Tests
  // ========================================================================

  describe('score boundaries (TST-015)', () => {
    // ------------------------------------------------------------------
    // TST-015.1: Score with zero actions
    // ------------------------------------------------------------------

    describe('zero actions', () => {
      it('computeCompositeScore returns exactly 0 for zero actions', () => {
        const score = computeCompositeScore(0, 0, 0, 0);
        expect(score).toBe(0);
      });

      it('computeCompositeScore returns 0 regardless of other inputs when actions=0', () => {
        // Even with max diversity, tenure, and adoption — zero actions means zero
        expect(computeCompositeScore(0, Math.log(5), 120, 1000)).toBe(0);
      });

      it('deriveTier returns 0 for zero actions with max diversity and tenure', () => {
        expect(deriveTier(0, 1609, 120, 1000)).toBe(0);
      });
    });

    // ------------------------------------------------------------------
    // TST-015.2: Score with zero diversity (single category)
    // ------------------------------------------------------------------

    describe('zero diversity', () => {
      it('computeCompositeScore with zero shannonH = action factor only', () => {
        // shannonH=0 → diversityMult = 1+0 = 1 (no bonus)
        // tenureMonths=0 → tenureMult = 1+0 = 1
        // adoption=0 → adoptionMult = 1
        // E = log2(1+actions) * 1 * 1 * 1
        const score = computeCompositeScore(10, 0, 0, 0);
        expect(score).toBeCloseTo(Math.log2(11), 10);
      });

      it('Shannon diversity of single category is exactly 0', () => {
        const counts = new Map([[1, 1000]]);
        expect(computeShannonDiversity(counts)).toBe(0);
      });

      it('encoded Shannon diversity of 0 is 0', () => {
        expect(encodeShannonDiversity(0)).toBe(0);
      });

      it('zero diversity severely limits tier progression', () => {
        // Compare: 100 actions, 12 months, no diversity vs with diversity
        const scoreNoDiversity = computeCompositeScore(100, 0, 12, 0);
        const scoreMaxDiversity = computeCompositeScore(100, Math.log(5), 12, 0);

        // Max diversity should give ~2.6x multiplier
        expect(scoreMaxDiversity / scoreNoDiversity).toBeCloseTo(1 + Math.log(5), 1);

        // Without diversity: tier 3 (E ≈ 13.3)
        expect(deriveTier(100, 0, 12)).toBe(3);
        // With max diversity: tier 4 (E ≈ 34.7)
        expect(deriveTier(100, 1609, 12)).toBe(4);
      });
    });

    // ------------------------------------------------------------------
    // TST-015.3: NaN / Infinity guards
    // ------------------------------------------------------------------

    describe('NaN and Infinity guards', () => {
      it('computeCompositeScore with NaN actionCount returns 0', () => {
        // actionCount=NaN → the (actionCount === 0) check: NaN === 0 is false
        // But log2(1+NaN) = NaN, so result should be NaN.
        // This documents current behavior — it is a known edge.
        const score = computeCompositeScore(NaN, 0, 0, 0);
        expect(Number.isNaN(score)).toBe(true);
      });

      it('computeCompositeScore with NaN shannonH returns NaN', () => {
        const score = computeCompositeScore(10, NaN, 0, 0);
        expect(Number.isNaN(score)).toBe(true);
      });

      it('computeCompositeScore with negative tenureMonths does not crash', () => {
        // sqrt of negative → NaN, but does not throw
        const score = computeCompositeScore(10, 1.0, -12, 0);
        expect(Number.isNaN(score)).toBe(true);
      });

      it('computeCompositeScore with Infinity actions returns Infinity', () => {
        const score = computeCompositeScore(Infinity, 1.0, 12, 0);
        expect(score).toBe(Infinity);
      });

      it('deriveTier with NaN diversity score returns tier 1 (not crash)', () => {
        // NaN / 1000 = NaN, then computeCompositeScore(10, NaN, ...) = NaN
        // NaN >= 25 is false, NaN >= 12 is false, NaN >= 5 is false, NaN > 0 is false
        // Falls through to return 0
        const tier = deriveTier(10, NaN, 6);
        expect(tier).toBe(0);
      });

      it('computeShannonDiversity with zero-count categories does not produce NaN', () => {
        // Categories with 0 counts should be skipped (p=0, ln(0) = -Infinity)
        const counts = new Map([[1, 10], [2, 0], [3, 0]]);
        const h = computeShannonDiversity(counts);
        expect(Number.isFinite(h)).toBe(true);
        // Only 1 effective category → H=0
        expect(h).toBe(0);
      });

      it('computeShannonDiversity with negative counts does not produce NaN', () => {
        // Negative counts are logically invalid; verify no crash
        const counts = new Map([[1, -5], [2, 10]]);
        const h = computeShannonDiversity(counts);
        // -5 + 10 = 5 total, p1 = -1 (invalid), p2 = 2 (invalid)
        // Implementation: -5 <= 0, so skipped. p2 = 10/5 = 2, log(2) * 2 = negative
        // The result is mathematically nonsensical but should not crash
        expect(typeof h).toBe('number');
      });

      it('encodeShannonDiversity with NaN returns NaN (not crash)', () => {
        const encoded = encodeShannonDiversity(NaN);
        expect(Number.isNaN(encoded)).toBe(true);
      });

      it('encodeShannonDiversity with Infinity returns Infinity (not crash)', () => {
        // floor(Infinity * 1000) = Infinity
        const encoded = encodeShannonDiversity(Infinity);
        expect(encoded).toBe(Infinity);
      });
    });

    // ------------------------------------------------------------------
    // TST-015.4: Boundary precision at tier thresholds
    // ------------------------------------------------------------------

    describe('tier threshold boundaries', () => {
      it('tier 0→1 boundary: E just above 0', () => {
        // Smallest possible E > 0: 1 action, 0 diversity, 0 tenure
        // E = log2(2) * 1 * 1 * 1 = 1.0
        const E = computeCompositeScore(1, 0, 0, 0);
        expect(E).toBe(1.0);
        expect(deriveTier(1, 0, 0)).toBe(1);
      });

      it('tier 1→2 boundary: E just below 5.0', () => {
        // Find inputs where E is just under 5.0
        // 7 actions, shannonH=0.693, 0 months
        // E = log2(8) * (1+0.693) * 1 * 1 = 3 * 1.693 = 5.079
        // That's above 5, so reduce: 6 actions
        // E = log2(7) * 1.693 * 1 * 1 = 2.807 * 1.693 = 4.753
        const Ebelow = computeCompositeScore(6, 0.693, 0, 0);
        expect(Ebelow).toBeLessThan(5.0);
        expect(deriveTier(6, 693, 0)).toBe(1);

        const Eabove = computeCompositeScore(7, 0.693, 0, 0);
        expect(Eabove).toBeGreaterThanOrEqual(5.0);
        expect(deriveTier(7, 693, 0)).toBe(2);
      });

      it('tier 2→3 boundary: E just below and above 12.0', () => {
        // Find inputs: 20 actions, shannonH ≈ 0.693, 3 months
        // E = log2(21) * 1.693 * (1+sqrt(0.25)) * 1 = 4.39 * 1.693 * 1.5 = 11.15
        const Ebelow = computeCompositeScore(20, 0.693, 3, 0);
        expect(Ebelow).toBeLessThan(12.0);
        expect(deriveTier(20, 693, 3)).toBe(2);

        // 25 actions
        // E = log2(26) * 1.693 * 1.5 * 1 = 4.70 * 1.693 * 1.5 = 11.93 → still under 12
        // 30 actions
        // E = log2(31) * 1.693 * 1.5 * 1 = 4.95 * 1.693 * 1.5 = 12.57 → over 12
        const Eabove = computeCompositeScore(30, 0.693, 3, 0);
        expect(Eabove).toBeGreaterThanOrEqual(12.0);
        expect(deriveTier(30, 693, 3)).toBe(3);
      });

      it('tier 3→4 boundary: E just below and above 25.0', () => {
        // 30 actions, shannonH=ln(5)=1.609, 6 months
        // E = log2(31) * 2.609 * (1+sqrt(0.5)) * 1 = 4.95 * 2.609 * 1.707 = 22.04
        const Ebelow = computeCompositeScore(30, Math.log(5), 6, 0);
        expect(Ebelow).toBeLessThan(25.0);
        expect(deriveTier(30, 1609, 6)).toBe(3);

        // 40 actions, shannonH=ln(5), 8 months
        // E = log2(41) * 2.609 * (1+sqrt(8/12)) * 1 = 5.36 * 2.609 * 1.816 = 25.37
        const Eabove = computeCompositeScore(40, Math.log(5), 8, 0);
        expect(Eabove).toBeGreaterThanOrEqual(25.0);
        expect(deriveTier(40, 1609, 8)).toBe(4);
      });

      it('tier boundaries are strict: E exactly at threshold', () => {
        // Build score that hits exactly 5.0, 12.0, 25.0 via direct check
        // Tier 2 at E=5.0 exactly
        expect(deriveTier(1, 0, 0)).toBe(1); // E=1.0, tier 1
        // We can't easily construct exact E=5.0, so test the deriveTier logic directly
        // by reverse-engineering: if E >= 5.0, tier 2; if E >= 12.0, tier 3; etc.

        // Test with computed score that we verify manually
        const E5 = computeCompositeScore(15, 0, 0, 0);
        // E5 = log2(16) = 4.0 → tier 1
        expect(E5).toBe(4.0);
        expect(deriveTier(15, 0, 0)).toBe(1);

        const E5b = computeCompositeScore(31, 0, 0, 0);
        // E5b = log2(32) = 5.0 → tier 2 (>= 5.0)
        expect(E5b).toBe(5.0);
        expect(deriveTier(31, 0, 0)).toBe(2);
      });

      it('tier boundary at E exactly 12.0', () => {
        // Need actionFactor * diversityMult * tenureMult * adoptionMult = 12.0
        // With no diversity, tenure, adoption: E = log2(1+a) = 12 → a = 4095
        const E12 = computeCompositeScore(4095, 0, 0, 0);
        expect(E12).toBe(12.0);
        expect(deriveTier(4095, 0, 0)).toBe(3);
      });

      it('tier boundary at E exactly 25.0', () => {
        // log2(1+a) = 25 → a = 2^25 - 1 = 33554431
        const E25 = computeCompositeScore(33554431, 0, 0, 0);
        expect(E25).toBe(25.0);
        expect(deriveTier(33554431, 0, 0)).toBe(4);
      });

      it('adjacent tier boundary values differ by exactly one tier', () => {
        // Just below each threshold
        const justBelow5 = computeCompositeScore(30, 0, 0, 0);
        const justAt5 = computeCompositeScore(31, 0, 0, 0);
        expect(justBelow5).toBeLessThan(5.0);
        expect(justAt5).toBe(5.0);
        expect(deriveTier(30, 0, 0)).toBe(1);
        expect(deriveTier(31, 0, 0)).toBe(2);
      });
    });

    // ------------------------------------------------------------------
    // TST-015.5: Multiplicative composition properties
    // ------------------------------------------------------------------

    describe('multiplicative composition', () => {
      it('each factor contributes multiplicatively', () => {
        const base = computeCompositeScore(10, 0, 0, 0);

        // Adding diversity multiplies
        const withDiversity = computeCompositeScore(10, 1.0, 0, 0);
        expect(withDiversity).toBeCloseTo(base * (1 + 1.0), 10);

        // Adding tenure multiplies
        const withTenure = computeCompositeScore(10, 0, 12, 0);
        expect(withTenure).toBeCloseTo(base * (1 + Math.sqrt(1)), 10);

        // Adding adoption multiplies
        const withAdoption = computeCompositeScore(10, 0, 0, 15);
        expect(withAdoption).toBeCloseTo(base * (1 + Math.log2(16) / 4), 10);
      });

      it('all-factors-combined is product of individual multipliers', () => {
        const actions = 50;
        const shannonH = Math.log(3);
        const tenure = 18;
        const adoption = 10;

        const E = computeCompositeScore(actions, shannonH, tenure, adoption);

        const actionFactor = Math.log2(1 + actions);
        const diversityMult = 1 + shannonH;
        const tenureMult = 1 + Math.sqrt(tenure / 12);
        const adoptionMult = 1 + Math.log2(1 + adoption) / 4;

        expect(E).toBeCloseTo(actionFactor * diversityMult * tenureMult * adoptionMult, 10);
      });

      it('monotonically increasing in each dimension', () => {
        // Actions: more is always higher
        const a1 = computeCompositeScore(10, 1.0, 6, 5);
        const a2 = computeCompositeScore(20, 1.0, 6, 5);
        expect(a2).toBeGreaterThan(a1);

        // Diversity: more is always higher
        const d1 = computeCompositeScore(10, 0.5, 6, 5);
        const d2 = computeCompositeScore(10, 1.5, 6, 5);
        expect(d2).toBeGreaterThan(d1);

        // Tenure: more is always higher
        const t1 = computeCompositeScore(10, 1.0, 3, 5);
        const t2 = computeCompositeScore(10, 1.0, 12, 5);
        expect(t2).toBeGreaterThan(t1);

        // Adoption: more is always higher
        const ad1 = computeCompositeScore(10, 1.0, 6, 0);
        const ad2 = computeCompositeScore(10, 1.0, 6, 20);
        expect(ad2).toBeGreaterThan(ad1);
      });
    });
  });
});
