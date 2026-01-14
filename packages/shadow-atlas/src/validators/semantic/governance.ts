/**
 * Governance Validator
 *
 * Pre-flight governance structure detection to prevent wasted compute
 * on at-large cities where Layer 1 discovery structurally cannot succeed.
 *
 * DESIGN PRINCIPLES:
 * - Zero false positives: Never skip Layer 1 for district-based cities
 * - Registry-first: Check authoritative sources before attempting discovery
 * - Graceful degradation: Unknown cities → attempt discovery with Layer 2 fallback
 * - Post-discovery validation: Verify discovered district counts match registry
 *
 * INTEGRATION:
 * - Called by discovery pipeline BEFORE attempting Layer 1 portal discovery
 * - Validates discovered districts AFTER successful Layer 1 discovery
 * - Provides metadata for Layer 2 fallback decisions
 */

import { GOVERNANCE_REGISTRY, type GovernanceStructure } from '../../core/registry/governance-structures.js';

/**
 * Governance check result
 *
 * Tells the discovery pipeline whether to attempt Layer 1 discovery
 * and provides reasoning for logging/debugging.
 */
export interface GovernanceCheckResult {
  readonly structure: GovernanceStructure;
  readonly shouldAttemptLayer1: boolean;
  readonly reason: string;
  readonly source?: string;
  readonly councilSize?: number;
  readonly districtSeats?: number;
}

/**
 * District validation result
 *
 * Validates discovered district count against registry metadata.
 */
export interface DistrictValidationResult {
  readonly valid: boolean;
  readonly reason: string;
  readonly expectedCount?: number;
  readonly discoveredCount: number;
}

/**
 * Governance Validator
 *
 * Pre-flight checks and post-discovery validation for city governance structures.
 *
 * EXAMPLE USAGE (future integration):
 *
 * ```typescript
 * // In multi-path scanner (before attempting Layer 1):
 * const validator = new GovernanceValidator();
 * const govCheck = await validator.checkGovernance(city.fips);
 *
 * if (!govCheck.shouldAttemptLayer1) {
 *   console.log(`⏭️  Skipping Layer 1 for ${city.name}, ${city.state}`);
 *   console.log(`   Reason: ${govCheck.reason}`);
 *   console.log(`   Source: ${govCheck.source}`);
 *   return { success: false, fallbackToLayer2: true };
 * }
 *
 * // Attempt Layer 1 discovery...
 * const layer1Result = await this.attemptLayer1Discovery(city);
 *
 * if (layer1Result.success) {
 *   // Validate discovered count against registry
 *   const validation = validator.validateDiscoveredDistricts(
 *     city.fips,
 *     layer1Result.featureCount
 *   );
 *
 *   if (!validation.valid) {
 *     console.warn(`⚠️  Discovery validation failed: ${validation.reason}`);
 *     // Continue with Layer 2 fallback or manual review
 *   }
 * }
 * ```
 */
export class GovernanceValidator {
  /**
   * Check if city uses district-based representation
   *
   * This is a PRE-FLIGHT check that runs BEFORE attempting Layer 1 discovery.
   * It prevents wasted compute on at-large cities where discovery will fail.
   *
   * DECISION LOGIC:
   * - 'at-large' → Skip Layer 1 (no districts exist)
   * - 'district-based' → Attempt Layer 1 (districts exist)
   * - 'mixed' → Attempt Layer 1 (partial districts exist)
   * - 'unknown' → Attempt Layer 1 (graceful degradation)
   *
   * @param cityFips - Census FIPS code (e.g., '5363000' for Seattle)
   * @returns Decision on whether to attempt Layer 1 discovery
   */
  async checkGovernance(cityFips: string): Promise<GovernanceCheckResult> {
    // Check registry first (authoritative source)
    const record = GOVERNANCE_REGISTRY[cityFips];

    if (record) {
      // Registry hit - use authoritative data
      const shouldAttempt = record.structure === 'district-based' ||
                           record.structure === 'mixed' ||
                           record.structure === 'unknown';

      return {
        structure: record.structure,
        shouldAttemptLayer1: shouldAttempt,
        reason: shouldAttempt
          ? `Registry confirms ${record.structure} governance (${record.districtSeats || record.councilSize} seats)`
          : `Registry confirms at-large governance (no geographic districts)`,
        source: record.source,
        councilSize: record.councilSize,
        districtSeats: record.districtSeats,
      };
    }

    // Registry miss - graceful degradation
    // IMPORTANT: Default to attempting discovery for unknown cities
    // This ensures zero false negatives (never skip district-based cities)
    return {
      structure: 'unknown',
      shouldAttemptLayer1: true,
      reason: 'No governance data in registry, attempting discovery (graceful degradation)',
    };
  }

  /**
   * Validate discovered district count against governance registry
   *
   * This is a POST-DISCOVERY validation that runs AFTER successful Layer 1 discovery.
   * It ensures discovered data matches authoritative governance metadata.
   *
   * VALIDATION LOGIC:
   * - No registry entry → Valid (cannot validate, accept discovery)
   * - At-large city → Invalid (should not have discovered districts)
   * - District count mismatch → Invalid (discovered count != registry count)
   * - District count match → Valid
   *
   * @param cityFips - Census FIPS code
   * @param discoveredCount - Number of districts found by Layer 1 discovery
   * @returns Validation result with reason
   */
  validateDiscoveredDistricts(
    cityFips: string,
    discoveredCount: number
  ): DistrictValidationResult {
    const record = GOVERNANCE_REGISTRY[cityFips];

    // No registry entry - cannot validate, accept discovery
    if (!record) {
      return {
        valid: true,
        reason: 'No registry entry to validate against (accepting discovered data)',
        discoveredCount,
      };
    }

    // At-large city should not have districts
    if (record.structure === 'at-large') {
      return {
        valid: false,
        reason: `Registry shows at-large governance (no districts) but discovered ${discoveredCount} districts`,
        expectedCount: 0,
        discoveredCount,
      };
    }

    // Unknown structure - accept discovery
    if (record.structure === 'unknown') {
      return {
        valid: true,
        reason: 'Registry shows unknown governance (accepting discovered data)',
        discoveredCount,
      };
    }

    // District-based or mixed - validate count
    const expectedCount = record.districtSeats;

    if (expectedCount !== undefined && discoveredCount !== expectedCount) {
      return {
        valid: false,
        reason: `Registry shows ${expectedCount} district seats but discovered ${discoveredCount}`,
        expectedCount,
        discoveredCount,
      };
    }

    // Count matches or no expected count specified
    return {
      valid: true,
      reason: expectedCount
        ? `District count matches registry (${discoveredCount} seats)`
        : `Registry has no district count (accepting discovered ${discoveredCount} seats)`,
      expectedCount,
      discoveredCount,
    };
  }

  /**
   * Get governance metadata for a city
   *
   * Returns full governance record if available, null otherwise.
   * Useful for logging, debugging, and display purposes.
   *
   * @param cityFips - Census FIPS code
   * @returns Governance record or null if not in registry
   */
  getGovernanceMetadata(cityFips: string): Readonly<typeof GOVERNANCE_REGISTRY[string]> | null {
    const record = GOVERNANCE_REGISTRY[cityFips];
    return record || null;
  }

  /**
   * Check if a city is confirmed at-large
   *
   * Convenience method for callers who only need at-large detection.
   *
   * @param cityFips - Census FIPS code
   * @returns True if city is CONFIRMED at-large (not unknown)
   */
  isConfirmedAtLarge(cityFips: string): boolean {
    const record = GOVERNANCE_REGISTRY[cityFips];
    return record?.structure === 'at-large';
  }

  /**
   * Check if a city is confirmed district-based
   *
   * Convenience method for callers who only need district-based detection.
   *
   * @param cityFips - Census FIPS code
   * @returns True if city is CONFIRMED district-based (not unknown)
   */
  isConfirmedDistrictBased(cityFips: string): boolean {
    const record = GOVERNANCE_REGISTRY[cityFips];
    return record?.structure === 'district-based' || record?.structure === 'mixed';
  }
}
