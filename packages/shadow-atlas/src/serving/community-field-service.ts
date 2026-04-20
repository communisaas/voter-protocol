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
 * [0] engagement_root — Tree 3 root the proof was generated against
 * [1] epoch_domain — epoch identifier (keccak-derived, public)
 * [2] cell_set_root — Merkle root of user's H3 cell set (returned)
 * [3] epoch_nullifier — H2(identity_commitment, epoch_domain) (returned)
 * [4] cell_count — number of active cells (returned)
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
  /** epoch_domain_key -> Set of epoch_nullifiers (dedup, proof-bound) */
  private readonly nullifierSets: Map<string, Set<string>> = new Map();

  /** epoch_date -> contributions array (query/aggregation) */
  private readonly contributions: Map<string, CommunityFieldContribution[]> = new Map();

  /** Sorted epoch domain keys for eviction (oldest first) */
  private readonly epochOrder: string[] = [];

  /** R22-H4: epoch_domain_key -> epoch_date reverse mapping for contributions eviction */
  private readonly domainToDate: Map<string, string> = new Map();

  /**
   * Submit a community field contribution.
   * Returns the stored contribution on success.
   * Throws on validation failure or duplicate nullifier.
   */
  submit(submission: CommunityFieldSubmission): CommunityFieldContribution {
    // 1. Validate epochDate format (YYYY-MM-DD) and calendar validity
    if (!/^\d{4}-\d{2}-\d{2}$/.test(submission.epochDate)) {
      throw new CommunityFieldError('INVALID_EPOCH_DATE', 'epochDate must be YYYY-MM-DD format');
    }
    // R9-M3: Validate it's a real calendar date and not unreasonably far in the future.
    // Without this, an attacker can fill the 90-slot rolling window with future dates
    // (e.g., "9999-12-31") and force legitimate current epochs into EPOCH_TOO_OLD rejection.
    // R10-M1: Date.parse('2026-02-30') rolls to March 2 instead of NaN. Use roundtrip
    // validation: parse → reconstruct YYYY-MM-DD → reject if it doesn't match input.
    const epochMs = Date.parse(submission.epochDate);
    if (isNaN(epochMs)) {
      throw new CommunityFieldError('INVALID_EPOCH_DATE', 'epochDate is not a valid calendar date');
    }
    const d = new Date(epochMs);
    const reconstructed = d.toISOString().slice(0, 10);
    if (reconstructed !== submission.epochDate) {
      throw new CommunityFieldError('INVALID_EPOCH_DATE', `epochDate is not a valid calendar date (resolves to ${reconstructed})`);
    }
    const maxFutureMs = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days ahead
    if (epochMs > maxFutureMs) {
      throw new CommunityFieldError('INVALID_EPOCH_DATE', 'epochDate is too far in the future');
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
    // R22-H4: Key nullifier dedup on proof-bound epochDomain (publicInputs[1]),
    // NOT caller-supplied epochDate. This prevents replay attacks where the same
    // proof is submitted with different epochDate values to bypass dedup.
    const nullifierKey = normalizeHex(epochNullifier);
    const epochDomainKey = normalizeHex(epochDomain);
    let nullifierSet = this.nullifierSets.get(epochDomainKey);
    if (!nullifierSet) {
      // R8-M1: Reject epochs that would be immediately evicted.
      // Without this guard, an ancient epoch gets pushed, sorted to front,
      // evicted (deleting nullifierSet from Map), but contributions re-created
      // at step 9 — desync allows nullifier bypass on re-submission.
      if (this.epochOrder.length >= MAX_EPOCHS_IN_MEMORY) {
        const oldest = this.epochOrder[0];
        if (oldest && epochDomainKey < oldest) {
          throw new CommunityFieldError(
            'EPOCH_TOO_OLD',
            `Epoch domain ${epochDomainKey.slice(0, 16)}... is older than the oldest tracked epoch`,
          );
        }
      }
      nullifierSet = new Set();
      this.nullifierSets.set(epochDomainKey, nullifierSet);
      this.domainToDate.set(epochDomainKey, submission.epochDate);
      this.epochOrder.push(epochDomainKey);
      this.epochOrder.sort();
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
    // R14-M1: Extract directly from hex — don't BigInt-parse the entire proof.
    // normalizeHex on a multi-KB proof does unnecessary O(n) BigInt allocation.
    const proofHex = (submission.proof.startsWith('0x') ? submission.proof.slice(2) : submission.proof).toLowerCase();
    const proofHash = '0x' + proofHex.slice(0, 64).padEnd(64, '0');

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
      // R22-H4: Evict contributions via reverse mapping (domain → date)
      const dateKey = this.domainToDate.get(oldest);
      if (dateKey) {
        this.contributions.delete(dateKey);
        this.domainToDate.delete(oldest);
      }
      logger.debug('community-field: evicted epoch', { epochDomain: oldest.slice(0, 16) });
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

/**
 * Normalize hex to canonical lowercase form for consistent dedup.
 * Converts through BigInt to strip leading zeros — `0x01` and `0x001`
 * both produce the same 64-char output. This prevents the same field element
 * from bypassing nullifier dedup via non-canonical encoding (R9-M2).
 *
 * Output is zero-padded to 64 chars so that string comparison
 * (used by epochOrder.sort()) produces correct numeric ordering.
 *
 * R13-M1: No fallback — all callers pre-validate via isValidFieldHex().
 * A catch-to-toLowerCase fallback would silently produce non-canonical
 * output (preserving leading zeros), violating the dedup invariant.
 */
function normalizeHex(hex: string): string {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
  return BigInt('0x' + stripped).toString(16).padStart(64, '0');
}

/** Validate a hex string is a valid BN254 field element */
function isValidFieldHex(hex: string): boolean {
  if (!hex || !/^(0x)?[0-9a-fA-F]+$/.test(hex)) return false;
  // R21-H2: Fast-fail on oversized hex before expensive BigInt parse (DoS mitigation).
  // BN254 field elements are at most 32 bytes = 64 hex chars + optional "0x" prefix = 66 chars.
  if (hex.length > 66) return false;
  try {
    const value = BigInt(hex.startsWith('0x') ? hex : '0x' + hex);
    return value >= 0n && value < BN254_MODULUS;
  } catch {
    return false;
  }
}
