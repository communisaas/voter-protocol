/**
 * Engagement Tree (Tree 3) Cryptographic Helpers
 *
 * Provides typed wrappers around Poseidon2 hash functions for computing
 * engagement tree leaves and deriving engagement tiers from metrics.
 *
 * Leaf formula: H2(identityCommitment, H3(engagementTier, actionCount, diversityScore))
 *
 * SPEC REFERENCE: specs/REPUTATION-ARCHITECTURE-SPEC.md Sections 3-4
 * CIRCUIT REFERENCE: packages/crypto/noir/three_tree_membership/src/main.nr
 */

import { hash3, hashPair } from './poseidon2.js';

// ============================================================================
// Types
// ============================================================================

/** Engagement metrics derived from on-chain nullifier events */
export interface EngagementMetrics {
  readonly actionCount: number;
  /** Shannon diversity encoded as floor(H × 1000), range [0, 1609] */
  readonly diversityScore: number;
  readonly tenureMonths: number;
  readonly adoptionCount?: number;
}

/** Full engagement data for a single identity (ready for tree insertion) */
export interface EngagementData {
  readonly identityCommitment: bigint;
  readonly tier: 0 | 1 | 2 | 3 | 4;
  readonly actionCount: bigint;
  readonly diversityScore: bigint;
  readonly tenureMonths?: number;
}

// ============================================================================
// Hash Functions
// ============================================================================

/**
 * Compute engagement data commitment: H3(tier, actionCount, diversityScore)
 *
 * Uses DOMAIN_HASH3 = 0x48334d ("H3M") for domain separation.
 * Matches Noir: compute_engagement_data_commitment() in main.nr
 */
export async function computeEngagementDataCommitment(
  tier: bigint,
  actionCount: bigint,
  diversityScore: bigint,
): Promise<bigint> {
  return hash3(tier, actionCount, diversityScore);
}

/**
 * Compute engagement leaf: H2(identityCommitment, engagementDataCommitment)
 *
 * Uses DOMAIN_HASH2 = 0x48324d ("H2M") for domain separation.
 * Matches Noir: compute_engagement_leaf() in main.nr
 *
 * The same identityCommitment feeds the nullifier derivation,
 * cryptographically binding engagement to identity.
 */
export async function computeEngagementLeaf(
  identityCommitment: bigint,
  engagementDataCommitment: bigint,
): Promise<bigint> {
  return hashPair(identityCommitment, engagementDataCommitment);
}

// ============================================================================
// Shannon Diversity
// ============================================================================

/**
 * Compute Shannon diversity index from per-category action counts.
 *
 * H = -Σ(pᵢ × ln(pᵢ)) where pᵢ = categoryCount[i] / totalActions
 *
 * Returns 0 when all actions are in one category (no diversity).
 * Maximum is ln(5) ≈ 1.609 for 5 categories with perfectly even distribution.
 *
 * @param categoryCounts Map from category (1-5) to action count in that category.
 * @returns Shannon H as a float in [0, ln(5)]
 */
export function computeShannonDiversity(categoryCounts: ReadonlyMap<number, number>): number {
  let total = 0;
  for (const count of categoryCounts.values()) {
    total += count;
  }
  if (total === 0) return 0;

  let h = 0;
  for (const count of categoryCounts.values()) {
    if (count <= 0) continue;
    const p = count / total;
    h -= p * Math.log(p);
  }
  return h;
}

/**
 * Encode Shannon H as an integer for tree storage: floor(H × 1000).
 * Range: [0, 1609] for 5 categories.
 */
export function encodeShannonDiversity(shannonH: number): number {
  return Math.floor(shannonH * 1000);
}

// ============================================================================
// Composite Score
// ============================================================================

/**
 * Compute the composite engagement score E (spec Section 4.3).
 *
 * E = log₂(1 + actions) × (1 + shannonH) × (1 + √(tenure/12)) × (1 + log₂(1 + adoption) / 4)
 *
 * Multiplicative composition: weakness in any dimension limits the score.
 * A user cannot compensate for zero diversity by spamming actions.
 *
 * @param actionCount Distinct nullifier events
 * @param shannonH Shannon diversity index (float, NOT encoded)
 * @param tenureMonths Months since first nullifier event
 * @param adoptionCount Template adoptions by other verified identities (default 0)
 * @returns Composite score E as a float
 */
export function computeCompositeScore(
  actionCount: number,
  shannonH: number,
  tenureMonths: number,
  adoptionCount: number = 0,
): number {
  if (actionCount === 0) return 0;

  const actionFactor = Math.log2(1 + actionCount);
  const diversityMult = 1 + shannonH;
  const tenureMult = 1 + Math.sqrt(tenureMonths / 12);
  const adoptionMult = 1 + Math.log2(1 + adoptionCount) / 4;

  return actionFactor * diversityMult * tenureMult * adoptionMult;
}

// ============================================================================
// Tier Derivation
// ============================================================================

/**
 * Derive engagement tier from metrics using composite score E.
 *
 * diversityScore is stored as floor(H × 1000) — this function converts back
 * to float before computing the composite score.
 *
 * Tier boundaries (spec Section 4.3.2):
 *   4 (Pillar):      E >= 25.0
 *   3 (Veteran):     E >= 12.0
 *   2 (Established): E >= 5.0
 *   1 (Active):      E > 0
 *   0 (New):         E == 0
 *
 * @param actionCount Distinct nullifier events
 * @param diversityScore Shannon-encoded integer: floor(H × 1000), range [0, 1609]
 * @param tenureMonths Months since first nullifier event
 * @param adoptionCount Template adoptions (default 0)
 */
export function deriveTier(
  actionCount: number,
  diversityScore: number,
  tenureMonths: number,
  adoptionCount: number = 0,
): 0 | 1 | 2 | 3 | 4 {
  const shannonH = diversityScore / 1000;
  const E = computeCompositeScore(actionCount, shannonH, tenureMonths, adoptionCount);

  if (E >= 25.0) return 4;
  if (E >= 12.0) return 3;
  if (E >= 5.0) return 2;
  if (E > 0) return 1;
  return 0;
}
