/**
 * CommunityFieldService — Epoch-scoped geographic contribution aggregation.
 *
 * Accepts BubbleMembershipProof submissions (proof + publicInputs + epochDate),
 * enforces epoch nullifier uniqueness, and stores contributions for aggregation.
 *
 * The community field is a privacy-preserving geographic signal: verified users
 * contribute H3 cell set commitments per epoch. The aggregate reveals WHERE
 * civic engagement occurs without revealing WHO is WHERE.
 *
 * Public inputs layout (from bubble_membership circuit):
 *   [0] engagement_root  — Tree 3 root the proof was generated against
 *   [1] epoch_domain     — epoch identifier (keccak-derived, public)
 *   [2] cell_set_root    — Merkle root of user's H3 cell set (returned)
 *   [3] epoch_nullifier  — H2(identity_commitment, epoch_domain) (returned)
 *   [4] cell_count       — number of active cells (returned)
 *
 * SPEC: packages/crypto/noir/bubble_membership/src/main.nr
 */

import { logger } from '../core/utils/logger.js';

// ============================================================================
// Constants
// ============================================================================

const BN254_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Maximum contributions per epoch before rejecting (DoS protection) */
const MAX_CONTRIBUTIONS_PER_EPOCH = 100_000;

/** Maximum epochs to keep in memory (rolling window) */
const MAX_EPOCHS_IN_MEMORY = 90;

/** Expected number of public inputs from bubble_membership circuit */
const EXPECTED_PUBLIC_INPUTS = 5;

// ============================================================================
// Types
// ============================================================================

export interface CommunityFieldContribution {
  readonly epochDate: string;
  readonly epochNullifier: string;
  readonly cellSetRoot: string;
  readonly cellCount: number;
  readonly engagementRoot: string;
  readonly epochDomain: string;
  readonly proofHash: string;
  readonly submittedAt: number;
}

export interface CommunityFieldSubmission {
  readonly proof: string;
  readonly publicInputs: string[];
  readonly epochDate: string;
}

export interface EpochSummary {
  readonly epochDate: string;
  readonly contributionCount: number;
  readonly uniqueCellRoots: number;
}

// ============================================================================
// Service
// ============================================================================

export class CommunityFieldService {
  /** epoch_date -> Set of epoch_nullifiers (dedup) */
  private readonly nullifierSets: Map<string, Set<string>> = new Map();

  /** epoch_date -> contributions array */
  private readonly contributions: Map<string, CommunityFieldContribution[]> = new Map();

  /** Sorted epoch dates for eviction (oldest first) */
  private readonly epochOrder: string[] = [];

  /**
   * Submit a community field contribution.
   * Returns the stored contribution on success.
   * Throws on validation failure or duplicate nullifier.
   */
  submit(submission: CommunityFieldSubmission): CommunityFieldContribution {
    // 1. Validate epochDate format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(submission.epochDate)) {
      throw new CommunityFieldError('INVALID_EPOCH_DATE', 'epochDate must be YYYY-MM-DD format');
    }

    // 2. Validate public inputs count
    if (!Array.isArray(submission.publicInputs) || submission.publicInputs.length !== EXPECTED_PUBLIC_INPUTS) {
      throw new CommunityFieldError(
        'INVALID_PUBLIC_INPUTS',
        `Expected ${EXPECTED_PUBLIC_INPUTS} public inputs, got ${submission.publicInputs?.length ?? 0}`,
      );
    }

    // 3. Validate each public input is a valid hex field element
    for (let i = 0; i < submission.publicInputs.length; i++) {
      const pi = submission.publicInputs[i];
      if (!isValidFieldHex(pi)) {
        throw new CommunityFieldError(
          'INVALID_PUBLIC_INPUTS',
          `publicInputs[${i}] is not a valid BN254 field element`,
        );
      }
    }

    // 4. Validate proof is non-empty hex
    if (!submission.proof || !/^(0x)?[0-9a-fA-F]+$/.test(submission.proof)) {
      throw new CommunityFieldError('INVALID_PROOF', 'proof must be a non-empty hex string');
    }

    // 5. Extract public inputs
    const [engagementRoot, epochDomain, cellSetRoot, epochNullifier, cellCountHex] = submission.publicInputs;
    const cellCount = Number(BigInt(cellCountHex.startsWith('0x') ? cellCountHex : '0x' + cellCountHex));

    if (cellCount < 1 || cellCount > 16) {
      throw new CommunityFieldError('INVALID_CELL_COUNT', `cellCount must be 1-16, got ${cellCount}`);
    }

    // 6. Epoch nullifier dedup
    const nullifierKey = normalizeHex(epochNullifier);
    let nullifierSet = this.nullifierSets.get(submission.epochDate);
    if (!nullifierSet) {
      nullifierSet = new Set();
      this.nullifierSets.set(submission.epochDate, nullifierSet);
      this.epochOrder.push(submission.epochDate);
      this.evictOldEpochs();
    }

    if (nullifierSet.has(nullifierKey)) {
      throw new CommunityFieldError('DUPLICATE_NULLIFIER', 'Contribution already submitted for this epoch');
    }

    // 7. DoS protection: cap contributions per epoch
    const epochContributions = this.contributions.get(submission.epochDate) ?? [];
    if (epochContributions.length >= MAX_CONTRIBUTIONS_PER_EPOCH) {
      throw new CommunityFieldError('EPOCH_FULL', 'Maximum contributions reached for this epoch');
    }

    // 8. Compute proof hash for dedup/reference (first 32 bytes of proof hex)
    const proofNorm = normalizeHex(submission.proof);
    const proofHash = '0x' + proofNorm.slice(0, 64);

    // 9. Store
    const contribution: CommunityFieldContribution = {
      epochDate: submission.epochDate,
      epochNullifier: nullifierKey,
      cellSetRoot: normalizeHex(cellSetRoot),
      cellCount,
      engagementRoot: normalizeHex(engagementRoot),
      epochDomain: normalizeHex(epochDomain),
      proofHash,
      submittedAt: Date.now(),
    };

    nullifierSet.add(nullifierKey);
    epochContributions.push(contribution);
    this.contributions.set(submission.epochDate, epochContributions);

    logger.info('community-field: contribution accepted', {
      epochDate: submission.epochDate,
      cellCount,
      epochContributions: epochContributions.length,
    });

    return contribution;
  }

  /**
   * Get summary for an epoch.
   */
  getEpochSummary(epochDate: string): EpochSummary | null {
    const contribs = this.contributions.get(epochDate);
    if (!contribs || contribs.length === 0) return null;

    const uniqueRoots = new Set(contribs.map(c => c.cellSetRoot));
    return {
      epochDate,
      contributionCount: contribs.length,
      uniqueCellRoots: uniqueRoots.size,
    };
  }

  /**
   * Get all contributions for an epoch.
   */
  getContributions(epochDate: string): readonly CommunityFieldContribution[] {
    return this.contributions.get(epochDate) ?? [];
  }

  /**
   * Get summary of all active epochs.
   */
  getInfo(): { epochCount: number; totalContributions: number; epochs: EpochSummary[] } {
    const epochs: EpochSummary[] = [];
    let total = 0;

    for (const [epochDate, contribs] of this.contributions) {
      if (contribs.length === 0) continue;
      const uniqueRoots = new Set(contribs.map(c => c.cellSetRoot));
      epochs.push({
        epochDate,
        contributionCount: contribs.length,
        uniqueCellRoots: uniqueRoots.size,
      });
      total += contribs.length;
    }

    return {
      epochCount: epochs.length,
      totalContributions: total,
      epochs: epochs.sort((a, b) => b.epochDate.localeCompare(a.epochDate)),
    };
  }

  /**
   * Evict oldest epochs when memory limit exceeded.
   */
  private evictOldEpochs(): void {
    while (this.epochOrder.length > MAX_EPOCHS_IN_MEMORY) {
      const oldest = this.epochOrder.shift()!;
      this.nullifierSets.delete(oldest);
      this.contributions.delete(oldest);
      logger.debug('community-field: evicted epoch', { epochDate: oldest });
    }
  }
}

// ============================================================================
// Error class
// ============================================================================

export class CommunityFieldError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'CommunityFieldError';
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Normalize hex to lowercase without 0x prefix for consistent dedup */
function normalizeHex(hex: string): string {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
  return stripped.toLowerCase();
}

/** Validate a hex string is a valid BN254 field element */
function isValidFieldHex(hex: string): boolean {
  if (!hex || !/^(0x)?[0-9a-fA-F]+$/.test(hex)) return false;
  try {
    const value = BigInt(hex.startsWith('0x') ? hex : '0x' + hex);
    return value >= 0n && value < BN254_MODULUS;
  } catch {
    return false;
  }
}
