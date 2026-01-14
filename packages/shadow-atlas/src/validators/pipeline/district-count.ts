/**
 * District Count Validator
 *
 * PREVENTS: Cincinnati-style failures where wrong-granularity data passes validation
 *
 * STRATEGY:
 * - Exact match (0 diff) → 100% confidence boost
 * - Within tolerance (≤2 diff) → 70% confidence (recent redistricting allowance)
 * - Outside tolerance (>2 diff) → REJECT (likely wrong dataset)
 * - Unknown city → ALLOW (discovery continues)
 * - At-large city (null count) → Expect 1 feature (single municipal boundary)
 *
 * INTEGRATION POINTS:
 * - Hub API discovery: Check count before accepting dataset
 * - Portal scanner: Reject datasets outside tolerance
 * - Manual additions: Warn if count doesn't match expected
 */

import type { DistrictCountRecord } from '../../core/registry/district-count-registry.js';
import { getExpectedDistrictCount } from '../../core/registry/district-count-registry.js';

/**
 * Validation result with confidence scoring
 */
export interface DistrictCountValidation {
  /** Whether discovered count is valid */
  readonly valid: boolean;

  /** Confidence score (0-100) */
  readonly confidence: number;

  /** Human-readable validation reason */
  readonly reason: string;

  /** Expected vs. discovered count information */
  readonly countInfo: {
    readonly expected: number | null;
    readonly discovered: number;
    readonly diff: number;
  };

  /** Whether this is a known city in registry */
  readonly knownCity: boolean;
}

/**
 * Validate discovered district count against expected count
 *
 * @param fips - 7-digit Census PLACE FIPS code
 * @param discoveredCount - Number of features/districts discovered
 * @param tolerance - Allowed difference from expected count (default: 2)
 * @returns Validation result with confidence scoring
 *
 * @example
 * ```typescript
 * // Cincinnati case (REJECT)
 * const result = validateDistrictCount('3915000', 74);
 * // → { valid: false, confidence: 0, reason: "Expected 9 districts, found 74 (diff: 65)" }
 *
 * // Fort Worth case (ACCEPT)
 * const result = validateDistrictCount('4827000', 9);
 * // → { valid: true, confidence: 100, reason: "Exact match" }
 *
 * // Unknown city (ALLOW)
 * const result = validateDistrictCount('9999999', 7);
 * // → { valid: true, confidence: 50, reason: "Unknown city, allowing discovery" }
 * ```
 */
export function validateDistrictCount(
  fips: string,
  discoveredCount: number,
  tolerance: number = 2
): DistrictCountValidation {
  const expected = getExpectedDistrictCount(fips);

  // Unknown city - allow discovery to proceed
  if (!expected) {
    return {
      valid: true,
      confidence: 50, // Medium confidence (unknown territory)
      reason: 'Unknown city, allowing discovery',
      countInfo: {
        expected: null,
        discovered: discoveredCount,
        diff: 0,
      },
      knownCity: false,
    };
  }

  // At-large city - expect single municipal boundary
  if (expected.expectedDistrictCount === null) {
    if (discoveredCount === 1) {
      return {
        valid: true,
        confidence: 100,
        reason: `${expected.cityName} is at-large (no districts), single boundary confirmed`,
        countInfo: {
          expected: 1,
          discovered: discoveredCount,
          diff: 0,
        },
        knownCity: true,
      };
    }

    return {
      valid: false,
      confidence: 0,
      reason: `${expected.cityName} is at-large (no districts) but found ${discoveredCount} features`,
      countInfo: {
        expected: 1,
        discovered: discoveredCount,
        diff: discoveredCount - 1,
      },
      knownCity: true,
    };
  }

  // District-based validation
  const diff = Math.abs(discoveredCount - expected.expectedDistrictCount);

  // Exact match - highest confidence
  if (diff === 0) {
    return {
      valid: true,
      confidence: 100,
      reason: 'Exact match',
      countInfo: {
        expected: expected.expectedDistrictCount,
        discovered: discoveredCount,
        diff: 0,
      },
      knownCity: true,
    };
  }

  // Within tolerance - allow with reduced confidence
  if (diff <= tolerance) {
    return {
      valid: true,
      confidence: 70,
      reason: `Expected ${expected.expectedDistrictCount}, found ${discoveredCount} (within tolerance, possible redistricting)`,
      countInfo: {
        expected: expected.expectedDistrictCount,
        discovered: discoveredCount,
        diff,
      },
      knownCity: true,
    };
  }

  // Outside tolerance - REJECT
  return {
    valid: false,
    confidence: 0,
    reason: `Expected ${expected.expectedDistrictCount} districts, found ${discoveredCount} (diff: ${diff}) - likely wrong dataset (${expected.notes || 'no notes'})`,
    countInfo: {
      expected: expected.expectedDistrictCount,
      discovered: discoveredCount,
      diff,
    },
    knownCity: true,
  };
}

/**
 * Cincinnati-specific prevention check
 *
 * CRITICAL: Cincinnati has 9 council districts but 74 Community Council neighborhoods.
 * This function explicitly flags the 74-feature dataset as invalid.
 */
export function isCincinnatiCommunityCouncilFailure(
  fips: string,
  discoveredCount: number
): boolean {
  return fips === '3915000' && discoveredCount === 74;
}

/**
 * Batch validate multiple discoveries
 *
 * Useful for validating entire PoC batches or portal scan results.
 */
export function validateBatch(
  discoveries: Array<{ fips: string; featureCount: number; cityName?: string }>
): {
  valid: Array<{ fips: string; validation: DistrictCountValidation }>;
  rejected: Array<{ fips: string; validation: DistrictCountValidation }>;
  summary: {
    total: number;
    validCount: number;
    rejectedCount: number;
    avgConfidence: number;
  };
} {
  const valid: Array<{ fips: string; validation: DistrictCountValidation }> = [];
  const rejected: Array<{ fips: string; validation: DistrictCountValidation }> = [];

  for (const discovery of discoveries) {
    const validation = validateDistrictCount(discovery.fips, discovery.featureCount);

    if (validation.valid) {
      valid.push({ fips: discovery.fips, validation });
    } else {
      rejected.push({ fips: discovery.fips, validation });
    }
  }

  const allConfidences = [...valid, ...rejected].map(v => v.validation.confidence);
  const avgConfidence = allConfidences.length > 0
    ? allConfidences.reduce((sum, c) => sum + c, 0) / allConfidences.length
    : 0;

  return {
    valid,
    rejected,
    summary: {
      total: discoveries.length,
      validCount: valid.length,
      rejectedCount: rejected.length,
      avgConfidence,
    },
  };
}

/**
 * Generate human-readable validation report
 */
export function generateValidationReport(
  validation: DistrictCountValidation,
  cityName: string
): string {
  const emoji = validation.valid ? '✅' : '❌';
  const status = validation.valid ? 'VALID' : 'REJECTED';

  return `${emoji} ${status} - ${cityName}
  Expected: ${validation.countInfo.expected !== null ? validation.countInfo.expected : 'at-large (1 boundary)'}
  Discovered: ${validation.countInfo.discovered}
  Difference: ${validation.countInfo.diff}
  Confidence: ${validation.confidence}/100
  Reason: ${validation.reason}
  Known City: ${validation.knownCity ? 'Yes' : 'No (discovery allowed)'}`;
}

/**
 * Pre-flight check for discovery workers
 *
 * Returns early-exit signal if we know this city won't have valid data.
 */
export function shouldSkipDiscovery(fips: string): {
  skip: boolean;
  reason?: string;
} {
  const expected = getExpectedDistrictCount(fips);

  // Unknown city - continue with discovery
  if (!expected) {
    return { skip: false };
  }

  // At-large city - skip Layer 1 discovery, go straight to TIGER Place
  if (expected.expectedDistrictCount === null) {
    return {
      skip: true,
      reason: `${expected.cityName} is at-large (no districts) - skipping Layer 1 discovery`,
    };
  }

  // District-based city - continue with discovery
  return { skip: false };
}
