/**
 * Engagement Tree Builder
 *
 * Derives engagement metrics from on-chain nullifier consumption events
 * and produces entries ready for insertion into Tree 3 (EngagementService).
 *
 * Metrics derivation (Section 4.2):
 * - actionCount: distinct nullifiers per signer
 * - diversityScore: Shannon diversity index H, stored as floor(H × 1000)
 * - tenureMonths: floor((referenceTimestamp - firstEvent) / (30 * 86400))
 *
 * Action categories (Section 4.2):
 * - 1: Congressional contact
 * - 2: Template creation
 * - 3: Challenge participation
 * - 4: Campaign support
 * - 5: Governance vote
 *
 * CATEGORY RESOLUTION:
 * Action domains are keccak256 hashes (from communique's buildActionDomain),
 * so the category cannot be extracted from the hash bytes. Categories are
 * resolved via an ActionCategoryRegistry — a server-side map from action
 * domain hash to category (1-5). The registry is populated when action
 * domains are whitelisted in DistrictGate.
 *
 * SPEC REFERENCE: specs/REPUTATION-ARCHITECTURE-SPEC.md Sections 4, 9
 */

import {
  deriveTier,
  computeShannonDiversity,
  encodeShannonDiversity,
  type EngagementMetrics,
} from '@voter-protocol/crypto/engagement';

// ============================================================================
// Types
// ============================================================================

/** A nullifier consumption event from DistrictGate */
export interface NullifierEvent {
  /** EOA address that submitted the proof */
  readonly signer: string;
  /** Hex-encoded nullifier (with 0x prefix) */
  readonly nullifier: string;
  /** Hex-encoded action domain (with 0x prefix) */
  readonly actionDomain: string;
  /** Block number of the event */
  readonly blockNumber: number;
  /** Unix timestamp in seconds */
  readonly timestamp: number;
}

/** Engagement entry ready for EngagementService.batchUpdate() */
export interface EngagementEntry {
  readonly identityCommitment: bigint;
  readonly signerAddress: string;
  readonly tier: 0 | 1 | 2 | 3 | 4;
  readonly actionCount: number;
  /** Shannon diversity encoded as floor(H × 1000), range [0, 1609] */
  readonly diversityScore: number;
  readonly tenureMonths: number;
}

/** Result of building engagement data from events */
export interface EngagementBuildResult {
  readonly entries: EngagementEntry[];
  readonly skippedSigners: string[];
  readonly totalEvents: number;
  readonly uniqueSigners: number;
}

// ============================================================================
// Action Category Registry
// ============================================================================

/**
 * Maps action domain hashes to category indices (1-5).
 *
 * Action domains are keccak256 hashes produced by communique's
 * buildActionDomain(). The hash output has no structured prefix byte,
 * so category must be resolved via this server-side registry.
 *
 * The registry is populated when action domains are whitelisted in
 * DistrictGate's allowedActionDomains mapping. Each domain is registered
 * with its category:
 *   1 = Congressional contact
 *   2 = Template creation
 *   3 = Challenge participation
 *   4 = Campaign support
 *   5 = Governance vote
 *
 * Keys are lowercase hex (with 0x prefix).
 */
export type ActionCategoryRegistry = ReadonlyMap<string, number>;

/**
 * Create an empty mutable registry for population.
 */
export function createActionCategoryRegistry(): Map<string, number> {
  return new Map();
}

const SECONDS_PER_MONTH = 30 * 86400;

// ============================================================================
// EngagementTreeBuilder
// ============================================================================

export class EngagementTreeBuilder {
  /**
   * Build engagement entries from nullifier events.
   *
   * Only signers present in identityMap are included; others are skipped.
   * Events are grouped by signer, deduped by nullifier, and metrics derived.
   *
   * @param categoryRegistry - Maps action domain hashes to category (1-5).
   *   Required for diversity_score computation. Without it, diversityScore
   *   will be 0 for all entries (action domains are keccak256 hashes with
   *   no structured prefix byte).
   */
  static buildFromEvents(
    events: readonly NullifierEvent[],
    identityMap: ReadonlyMap<string, bigint>,
    referenceTimestamp?: number,
    categoryRegistry?: ActionCategoryRegistry,
  ): EngagementBuildResult {
    const refTime = referenceTimestamp ?? Math.floor(Date.now() / 1000);

    // Group events by signer (lowercase)
    const signerEvents = new Map<string, NullifierEvent[]>();
    for (const event of events) {
      const signer = event.signer.toLowerCase();
      const existing = signerEvents.get(signer);
      if (existing) {
        existing.push(event);
      } else {
        signerEvents.set(signer, [event]);
      }
    }

    const entries: EngagementEntry[] = [];
    const skippedSigners: string[] = [];

    for (const [signer, signerEvts] of signerEvents) {
      const ic = identityMap.get(signer);
      if (ic === undefined) {
        skippedSigners.push(signer);
        continue;
      }

      const metrics = EngagementTreeBuilder.computeMetricsForSigner(signerEvts, refTime, categoryRegistry);
      // adoptionCount defaults to 0 — adoption pipeline is Phase 2 (see REPUTATION-ARCHITECTURE-SPEC.md §4.3)
      const tier = deriveTier(metrics.actionCount, metrics.diversityScore, metrics.tenureMonths);

      entries.push({
        identityCommitment: ic,
        signerAddress: signer,
        tier,
        actionCount: metrics.actionCount,
        diversityScore: metrics.diversityScore,
        tenureMonths: metrics.tenureMonths,
      });
    }

    return {
      entries,
      skippedSigners,
      totalEvents: events.length,
      uniqueSigners: signerEvents.size,
    };
  }

  /**
   * Compute engagement metrics for a single signer's events.
   *
   * Deduplicates nullifiers (same nullifier = same action, counted once).
   * Derives diversityScore as Shannon diversity index H (encoded as floor(H × 1000)).
   * Computes tenure from earliest event timestamp.
   *
   * @param categoryRegistry - Maps action domain hashes to category (1-5).
   *   If not provided, diversityScore will be 0.
   */
  static computeMetricsForSigner(
    events: readonly NullifierEvent[],
    referenceTimestamp?: number,
    categoryRegistry?: ActionCategoryRegistry,
  ): EngagementMetrics {
    const refTime = referenceTimestamp ?? Math.floor(Date.now() / 1000);

    if (events.length === 0) {
      return { actionCount: 0, diversityScore: 0, tenureMonths: 0 };
    }

    // Dedup nullifiers and accumulate per-category counts
    const seenNullifiers = new Set<string>();
    const categoryCounts = new Map<number, number>();
    let earliestTimestamp = Infinity;

    for (const event of events) {
      const nullLower = event.nullifier.toLowerCase();
      if (seenNullifiers.has(nullLower)) continue;
      seenNullifiers.add(nullLower);

      const category = EngagementTreeBuilder.getActionCategory(event.actionDomain, categoryRegistry);
      if (category > 0) {
        categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      }

      if (event.timestamp < earliestTimestamp) {
        earliestTimestamp = event.timestamp;
      }
    }

    const tenureSeconds = Math.max(0, refTime - earliestTimestamp);
    const tenureMonths = Math.floor(tenureSeconds / SECONDS_PER_MONTH);

    // Shannon diversity index: H = -Σ(pᵢ × ln(pᵢ))
    const shannonH = computeShannonDiversity(categoryCounts);

    return {
      actionCount: seenNullifiers.size,
      diversityScore: encodeShannonDiversity(shannonH),
      tenureMonths,
    };
  }

  /**
   * Resolve action category (1-5) for an action domain.
   *
   * Primary lookup: ActionCategoryRegistry (server-side map of action
   * domain hash → category). This is the correct path for production,
   * where action domains are keccak256 hashes with no structured prefix.
   *
   * Returns 0 for unrecognized action domains (not in registry).
   */
  static getActionCategory(actionDomain: string, categoryRegistry?: ActionCategoryRegistry): number {
    if (categoryRegistry) {
      const key = actionDomain.toLowerCase();
      return categoryRegistry.get(key) ?? 0;
    }
    // No registry: cannot determine category from hash bytes
    return 0;
  }
}
