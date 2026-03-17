/**
 * At-Large Cities Integration Examples
 *
 * This file demonstrates how to integrate the at-large cities registry
 * with existing validators to prevent false negative failures.
 *
 * DO NOT IMPORT THIS FILE - these are examples only
 */

import type { FeatureCollection, Polygon } from 'geojson';
import {
  isAtLargeCity,
  getAtLargeCityInfo,
  type AtLargeCity,
} from '../src/core/registry/at-large-cities.generated.js';

/**
 * EXAMPLE 1: Tessellation Validator Integration
 *
 * Tessellation checks that districts:
 * - Cover entire city (containment)
 * - Don't overlap (mutual exclusion)
 * - Have no gaps (completeness)
 *
 * At-large cities have ZERO districts → impossible to tessellate
 */
interface TessellationResult {
  valid: boolean;
  skipped?: boolean;
  reason?: string;
  coverage?: number;
  gaps?: number;
  overlaps?: number;
}

function validateTessellation(
  cityFips: string,
  districts: FeatureCollection,
  boundary: Polygon
): TessellationResult {
  // STEP 1: Check if city uses at-large voting (early exit)
  if (isAtLargeCity(cityFips)) {
    const cityInfo = getAtLargeCityInfo(cityFips);
    return {
      valid: true,
      skipped: true,
      reason: `${cityInfo?.cityName}, ${cityInfo?.state} uses ${cityInfo?.electionMethod} voting (no geographic districts)`,
    };
  }

  // STEP 2: Proceed with normal tessellation validation
  // ... (existing tessellation logic)
  return {
    valid: true,
    coverage: 100,
    gaps: 0,
    overlaps: 0,
  };
}

/**
 * EXAMPLE 2: Containment Validator Integration
 *
 * Containment checks that districts fit within city boundary.
 * At-large cities have no districts to contain.
 */
interface ContainmentResult {
  valid: boolean;
  skipped?: boolean;
  overflowPercent?: number;
  direction?: string;
}

function validateContainment(
  cityFips: string,
  districts: FeatureCollection,
  boundary: Polygon
): ContainmentResult {
  // Check for at-large voting
  if (isAtLargeCity(cityFips)) {
    const cityInfo = getAtLargeCityInfo(cityFips);
    console.log(
      `Skipping containment check for ${cityInfo?.cityName} (${cityInfo?.electionMethod})`
    );
    return {
      valid: true,
      skipped: true,
    };
  }

  // Proceed with containment check
  // ... (existing containment logic)
  return {
    valid: true,
    overflowPercent: 0,
  };
}

/**
 * EXAMPLE 3: District Count Validator Integration
 *
 * Verifies feature count matches expected district count.
 * At-large cities expect 0 districts (elected citywide).
 */
interface CountValidationResult {
  valid: boolean;
  skipped?: boolean;
  expected?: number;
  actual?: number;
  reason?: string;
}

function validateDistrictCount(
  cityFips: string,
  districts: FeatureCollection,
  expectedCount: number
): CountValidationResult {
  // At-large cities should have 0 districts
  if (isAtLargeCity(cityFips)) {
    const cityInfo = getAtLargeCityInfo(cityFips);

    // If registry incorrectly has district data for at-large city
    if (districts.features.length > 0) {
      return {
        valid: false,
        skipped: false,
        expected: 0,
        actual: districts.features.length,
        reason: `${cityInfo?.cityName} uses ${cityInfo?.electionMethod} voting but registry contains ${districts.features.length} districts (should be 0)`,
      };
    }

    return {
      valid: true,
      skipped: true,
      expected: 0,
      actual: 0,
      reason: `At-large city with ${cityInfo?.councilSize} citywide seats`,
    };
  }

  // Proceed with normal count validation
  const actual = districts.features.length;
  const valid = actual === expectedCount;

  return {
    valid,
    expected: expectedCount,
    actual,
    reason: valid
      ? 'Count matches expected'
      : `Expected ${expectedCount}, got ${actual}`,
  };
}

/**
 * EXAMPLE 4: Bulk Validation with At-Large Filtering
 *
 * When validating multiple cities, filter out at-large cities first
 */
interface BulkValidationSummary {
  totalCities: number;
  validated: number;
  skippedAtLarge: number;
  failures: number;
  atLargeCities: Array<{ fips: string; name: string; method: string }>;
}

function bulkValidateCities(
  cityFipsList: string[]
): BulkValidationSummary {
  const summary: BulkValidationSummary = {
    totalCities: cityFipsList.length,
    validated: 0,
    skippedAtLarge: 0,
    failures: 0,
    atLargeCities: [],
  };

  for (const fips of cityFipsList) {
    // Check if at-large
    if (isAtLargeCity(fips)) {
      summary.skippedAtLarge++;
      const info = getAtLargeCityInfo(fips);
      if (info) {
        summary.atLargeCities.push({
          fips,
          name: `${info.cityName}, ${info.state}`,
          method: info.electionMethod,
        });
      }
      continue;
    }

    // Validate city (pseudo-code)
    // const result = validateCity(fips);
    // if (result.valid) summary.validated++;
    // else summary.failures++;
  }

  return summary;
}

/**
 * EXAMPLE 5: Logging and Transparency
 *
 * When skipping at-large cities, log with context for transparency
 */
interface ValidationLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

function validateWithLogging(
  cityFips: string,
  districts: FeatureCollection,
  logger: ValidationLogger
): TessellationResult {
  // Check for at-large voting
  if (isAtLargeCity(cityFips)) {
    const info = getAtLargeCityInfo(cityFips);

    logger.info(
      `🔵 Skipping tessellation for ${info?.cityName}, ${info?.state}`
    );
    logger.info(
      `   Election Method: ${info?.electionMethod} (${info?.councilSize} citywide seats)`
    );
    logger.info(`   Source: ${info?.source}`);

    if (info?.notes) {
      logger.info(`   Notes: ${info.notes}`);
    }

    return {
      valid: true,
      skipped: true,
      reason: 'At-large voting (no geographic districts)',
    };
  }

  logger.info(`🔍 Validating tessellation for FIPS ${cityFips}`);
  // ... proceed with validation
  return { valid: true };
}

/**
 * EXAMPLE 6: Pre-Validation Sanity Check
 *
 * Use at-large registry as part of comprehensive pre-validation
 */
interface SanityCheckResult {
  valid: boolean;
  reason: string | null;
  shouldSkip: boolean;
}

function preValidationSanityCheck(
  cityFips: string,
  districts: FeatureCollection,
  expectedCount: number
): SanityCheckResult {
  // Check 1: At-large city
  if (isAtLargeCity(cityFips)) {
    return {
      valid: true,
      reason: 'At-large voting (no districts to validate)',
      shouldSkip: true,
    };
  }

  // Check 2: Feature count sanity
  const countRatio = districts.features.length / expectedCount;
  if (countRatio > 3 || countRatio < 0.3) {
    return {
      valid: false,
      reason: `Feature count ${districts.features.length} vs expected ${expectedCount} (ratio ${countRatio.toFixed(1)}x)`,
      shouldSkip: false,
    };
  }

  // Check 3: Non-zero districts
  if (districts.features.length === 0) {
    return {
      valid: false,
      reason: 'Zero districts found (may be at-large city not in registry)',
      shouldSkip: false,
    };
  }

  return {
    valid: true,
    reason: null,
    shouldSkip: false,
  };
}

/**
 * EXAMPLE 7: WS-3 Remediation Integration
 *
 * When analyzing containment failures, check if city is at-large
 */
interface ContainmentFailure {
  cityFips: string;
  cityName: string;
  overflowPercent: number;
  featureCount: number;
  expectedCount: number;
}

function analyzeContainmentFailure(
  failure: ContainmentFailure
): string {
  // Check if this is actually an at-large city
  if (isAtLargeCity(failure.cityFips)) {
    const info = getAtLargeCityInfo(failure.cityFips);
    return `RESOLUTION: ${failure.cityName} uses ${info?.electionMethod} voting. Add to at-large registry, remove from known-portals.`;
  }

  // Check if city SHOULD be at-large based on failure pattern
  if (
    failure.overflowPercent === 100 &&
    failure.featureCount !== failure.expectedCount
  ) {
    return `INVESTIGATE: 100% overflow suggests wrong data source. Check if ${failure.cityName} uses at-large voting.`;
  }

  // Normal containment failure (wrong data source, boundary vintage, etc.)
  return `FIX_DATA: Find correct district data for ${failure.cityName}`;
}

/**
 * EXAMPLE 8: Statistics and Reporting
 *
 * Generate reports on at-large cities for transparency
 */
import { getAtLargeCityStats } from '../src/core/registry/at-large-cities.generated.js';

function generateAtLargeReport(): string {
  const stats = getAtLargeCityStats();

  let report = '=== AT-LARGE CITIES REPORT ===\n\n';
  report += `Total at-large cities: ${stats.total}\n\n`;

  report += 'By Election Method:\n';
  for (const [method, count] of Object.entries(stats.byMethod)) {
    report += `  - ${method}: ${count}\n`;
  }

  report += '\nBy State:\n';
  for (const [state, count] of Object.entries(stats.byState)) {
    report += `  - ${state}: ${count}\n`;
  }

  return report;
}

/**
 * EXAMPLE 9: Data Cleaning - Identify Wrong Registry Entries
 *
 * Use at-large registry to flag incorrect entries in known-portals
 */
interface PortalEntry {
  cityFips: string;
  cityName: string;
  state: string;
  featureCount: number;
}

function auditPortalForAtLargeCities(
  portals: Record<string, PortalEntry>
): Array<{ fips: string; issue: string }> {
  const issues: Array<{ fips: string; issue: string }> = [];

  for (const [fips, portal] of Object.entries(portals)) {
    // If city is at-large but has portal entry with districts
    if (isAtLargeCity(fips)) {
      const info = getAtLargeCityInfo(fips);
      issues.push({
        fips,
        issue: `${portal.cityName} uses ${info?.electionMethod} voting but has ${portal.featureCount} districts in registry. Should be removed.`,
      });
    }
  }

  return issues;
}

/**
 * USAGE SUMMARY:
 *
 * 1. Import registry functions:
 *    import { isAtLargeCity, getAtLargeCityInfo } from '@/core/registry/at-large-cities.js';
 *
 * 2. Check before validation:
 *    if (isAtLargeCity(cityFips)) {
 *      return { valid: true, skipped: true, reason: 'At-large voting' };
 *    }
 *
 * 3. Log with context:
 *    const info = getAtLargeCityInfo(cityFips);
 *    logger.info(`Skipping ${info?.cityName} - ${info?.electionMethod}`);
 *
 * 4. Use in analysis:
 *    - WS-3 containment failure remediation
 *    - Data quality audits
 *    - Bulk validation filtering
 *    - Statistical reporting
 */

export {
  validateTessellation,
  validateContainment,
  validateDistrictCount,
  bulkValidateCities,
  validateWithLogging,
  preValidationSanityCheck,
  analyzeContainmentFailure,
  generateAtLargeReport,
  auditPortalForAtLargeCities,
};
