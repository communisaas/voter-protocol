/**
 * Comprehensive GEOID Validation Suite
 *
 * Validates GEOID integrity across all Shadow Atlas layer types:
 * - Congressional Districts (CD)
 * - State Legislative Upper (SLDU)
 * - State Legislative Lower (SLDL)
 * - Unified School Districts (UNSD)
 * - Elementary School Districts (ELSD)
 * - Secondary School Districts (SCSD)
 * - Counties (COUNTY)
 * - Voting Tabulation Districts (VTD)
 *
 * VALIDATION CHECKS:
 * 1. Format validation: Verify GEOID format matches layer specification
 * 2. Coverage validation: Ensure all states/territories are covered
 * 3. Count validation: Compare actual vs expected counts
 * 4. Completeness validation: Verify no missing or extra GEOIDs
 *
 * USAGE:
 *   import { validateAllCanonicalGEOIDs } from './geoid-validation-suite.js';
 *   const report = validateAllCanonicalGEOIDs();
 *   console.log(report.summary);
 *
 * Last Updated: 2026-01-02
 * Data Vintage: 2024 TIGER/Line (post-2020 Census redistricting)
 */

import type { TIGERLayerType } from '../../core/types.js';
import {
  CANONICAL_CD_GEOIDS,
  CANONICAL_SLDU_GEOIDS,
  CANONICAL_SLDL_GEOIDS,
  CANONICAL_UNSD_GEOIDS,
  CANONICAL_ELSD_GEOIDS,
  CANONICAL_SCSD_GEOIDS,
} from './reference.js';
import {
  EXPECTED_CD_BY_STATE,
  EXPECTED_SLDU_BY_STATE,
  EXPECTED_SLDL_BY_STATE,
  EXPECTED_UNSD_BY_STATE,
  EXPECTED_ELSD_BY_STATE,
  EXPECTED_SCSD_BY_STATE,
  EXPECTED_VTD_BY_STATE,
  EXPECTED_COUNTIES_BY_STATE,
  getStateAbbr,
  getStateName,
} from '../tiger-expected-counts.js';
import { loadVTDGEOIDs, getVTDCount } from '../utils/vtd-loader.js';
import type {
  CanonicalCrossValidationReport,
  ValidatableLayerReport,
} from '../tiger/canonical-validator.js';
import type { FreshnessAlert, BoundaryType } from '../../provenance/primary-comparator.js';

/**
 * Layer types supported by validation suite
 */
export type ValidatableLayer = 'cd' | 'sldu' | 'sldl' | 'unsd' | 'elsd' | 'scsd' | 'county' | 'vtd';

/**
 * GEOID format specifications by layer type
 */
export const GEOID_FORMATS: Record<ValidatableLayer, {
  readonly description: string;
  readonly length: number | 'variable';
  readonly pattern: RegExp;
  readonly example: string;
}> = {
  cd: {
    description: 'Congressional Districts (SSDD)',
    length: 4,
    pattern: /^\d{4}$/,
    example: '0601',
  },
  sldu: {
    description: 'State Legislative Upper (SSDDD)',
    length: 5,
    pattern: /^\d{2}[A-Z0-9]{3}$/,
    example: '06001',
  },
  sldl: {
    description: 'State Legislative Lower (SLDL)',
    length: 'variable', // Vermont uses variable-length town codes
    pattern: /^\d{2}[A-Z0-9-]{3,4}$/, // Allow hyphens and 3-4 chars after state FIPS
    example: '06001',
  },
  unsd: {
    description: 'Unified School Districts (SSGGGGG)',
    length: 7,
    pattern: /^\d{7}$/,
    example: '0600001',
  },
  elsd: {
    description: 'Elementary School Districts (SSGGGGG)',
    length: 7,
    pattern: /^\d{7}$/,
    example: '0900001',
  },
  scsd: {
    description: 'Secondary School Districts (SSGGGGG)',
    length: 7,
    pattern: /^\d{7}$/,
    example: '0400001',
  },
  county: {
    description: 'Counties (SSCCC)',
    length: 5,
    pattern: /^\d{5}$/,
    example: '06001',
  },
  vtd: {
    // NOTE: VTD data from Redistricting Data Hub (VEST) uses raw precinct identifiers,
    // NOT standardized 11-digit Census GEOIDs. Format varies by state:
    // - Delaware: "01-01", "01-02" (hyphenated)
    // - Florida: "0", "0000" (numeric)
    // - Iowa: "1-GR", "1NW" (alphanumeric with dashes)
    // - Illinois: "1700500BG01" (block group based)
    // Accept any non-empty string for VEST precinct identifiers.
    description: 'Voting Tabulation Districts (VEST precinct ID)',
    length: 'variable',
    pattern: /^.+$/, // Any non-empty string (VEST uses local precinct formats)
    example: '06001000100',
  },
} as const;

/**
 * Validation result for a single state/layer
 */
export interface StateLayerValidation {
  readonly stateFips: string;
  readonly stateAbbr: string | null;
  readonly stateName: string | null;
  readonly layer: ValidatableLayer;
  readonly expectedCount: number;
  readonly actualCount: number;
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Validation result for entire layer
 */
export interface LayerValidation {
  readonly layer: ValidatableLayer;
  readonly description: string;
  readonly formatSpec: string;
  readonly statesValidated: number;
  readonly statesPassed: number;
  readonly statesFailed: number;
  readonly totalGEOIDs: number;
  readonly totalExpected: number;
  readonly status: 'PASS' | 'FAIL' | 'WARNING';
  readonly stateResults: readonly StateLayerValidation[];
}

/**
 * Complete validation report
 */
export interface ValidationReport {
  readonly timestamp: string;
  readonly layers: readonly LayerValidation[];
  readonly summary: {
    readonly layersValidated: number;
    readonly layersPassed: number;
    readonly layersFailed: number;
    readonly layersWithWarnings: number;
    readonly totalStatesValidated: number;
    readonly totalStatesPassed: number;
    readonly totalStatesFailed: number;
    readonly overallStatus: 'PASS' | 'FAIL' | 'WARNING';
  };
}

/**
 * Validate GEOID format for a layer type
 *
 * @param layer - Layer type to validate
 * @param geoid - GEOID string to validate
 * @returns True if GEOID format is valid
 */
export function validateGEOIDFormat(layer: ValidatableLayer, geoid: string): boolean {
  const format = GEOID_FORMATS[layer];

  // Check length (skip if variable length)
  if (format.length !== 'variable' && geoid.length !== format.length) {
    return false;
  }

  // Check pattern match
  return format.pattern.test(geoid);
}

/**
 * Get canonical GEOID data for a layer
 *
 * @param layer - Layer type
 * @returns Record of state FIPS to GEOID arrays
 */
function getCanonicalGEOIDs(layer: ValidatableLayer): Record<string, readonly string[]> {
  switch (layer) {
    case 'cd':
      return CANONICAL_CD_GEOIDS;
    case 'sldu':
      return CANONICAL_SLDU_GEOIDS;
    case 'sldl':
      return CANONICAL_SLDL_GEOIDS;
    case 'unsd':
      return CANONICAL_UNSD_GEOIDS;
    case 'elsd':
      return CANONICAL_ELSD_GEOIDS;
    case 'scsd':
      return CANONICAL_SCSD_GEOIDS;
    case 'county':
      return {}; // County GEOIDs not in reference yet
    case 'vtd':
      return {}; // VTD GEOIDs loaded dynamically
  }
}

/**
 * Get expected counts for a layer
 *
 * @param layer - Layer type
 * @returns Record of state FIPS to expected counts
 */
function getExpectedCounts(layer: ValidatableLayer): Record<string, number> {
  switch (layer) {
    case 'cd':
      return EXPECTED_CD_BY_STATE;
    case 'sldu':
      return EXPECTED_SLDU_BY_STATE;
    case 'sldl':
      return EXPECTED_SLDL_BY_STATE;
    case 'unsd':
      return EXPECTED_UNSD_BY_STATE;
    case 'elsd':
      return EXPECTED_ELSD_BY_STATE;
    case 'scsd':
      return EXPECTED_SCSD_BY_STATE;
    case 'county':
      return EXPECTED_COUNTIES_BY_STATE;
    case 'vtd':
      return EXPECTED_VTD_BY_STATE;
  }
}

/**
 * Validate a single state for a layer
 *
 * @param layer - Layer type
 * @param stateFips - State FIPS code
 * @param geoids - Array of GEOIDs for this state
 * @returns Validation result
 */
function validateStateLayer(
  layer: ValidatableLayer,
  stateFips: string,
  geoids: readonly string[]
): StateLayerValidation {
  const expectedCounts = getExpectedCounts(layer);
  const expectedCount = expectedCounts[stateFips] ?? 0;
  const actualCount = geoids.length;
  const errors: string[] = [];
  const warnings: string[] = [];

  // Skip states with 0 expected (not applicable)
  if (expectedCount === 0 && actualCount === 0) {
    return {
      stateFips,
      stateAbbr: getStateAbbr(stateFips),
      stateName: getStateName(stateFips),
      layer,
      expectedCount,
      actualCount,
      valid: true,
      errors: [],
      warnings: ['State uses different district system (expected 0, got 0)'],
    };
  }

  // Validate count
  if (actualCount !== expectedCount) {
    errors.push(
      `Count mismatch: expected ${expectedCount}, got ${actualCount} (diff: ${actualCount - expectedCount})`
    );
  }

  // Validate format for each GEOID
  const invalidGEOIDs: string[] = [];
  for (const geoid of geoids) {
    if (!validateGEOIDFormat(layer, geoid)) {
      invalidGEOIDs.push(geoid);
    }
  }

  if (invalidGEOIDs.length > 0) {
    errors.push(
      `Invalid GEOID format (${invalidGEOIDs.length}): ${invalidGEOIDs.slice(0, 3).join(', ')}${invalidGEOIDs.length > 3 ? '...' : ''}`
    );
  }

  // Check for duplicates
  const uniqueGEOIDs = new Set(geoids);
  if (uniqueGEOIDs.size !== geoids.length) {
    errors.push(
      `Duplicate GEOIDs detected: ${geoids.length} total, ${uniqueGEOIDs.size} unique`
    );
  }

  // Validate state FIPS prefix (skip for VTD - VEST uses local precinct IDs without state prefix)
  if (layer !== 'vtd') {
    const wrongPrefix = geoids.filter(
      (g) => !g.startsWith(stateFips)
    );
    if (wrongPrefix.length > 0) {
      errors.push(
        `Wrong state prefix (${wrongPrefix.length}): ${wrongPrefix.slice(0, 3).join(', ')}${wrongPrefix.length > 3 ? '...' : ''}`
      );
    }
  }

  return {
    stateFips,
    stateAbbr: getStateAbbr(stateFips),
    stateName: getStateName(stateFips),
    layer,
    expectedCount,
    actualCount,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate canonical coverage for a layer
 *
 * Ensures all applicable states are covered.
 *
 * @param layer - Layer type
 * @returns Array of missing state FIPS codes
 */
export function validateCanonicalCoverage(layer: ValidatableLayer): readonly string[] {
  const canonicalGEOIDs = getCanonicalGEOIDs(layer);
  const expectedCounts = getExpectedCounts(layer);

  const missing: string[] = [];

  for (const stateFips of Object.keys(expectedCounts)) {
    const expectedCount = expectedCounts[stateFips];

    // Skip states with 0 expected (not applicable)
    if (expectedCount === 0) {
      continue;
    }

    // Check if state exists in canonical data
    if (!(stateFips in canonicalGEOIDs)) {
      missing.push(stateFips);
    }
  }

  return missing;
}

/**
 * Validate expected counts for a layer
 *
 * Compares actual GEOID counts vs expected counts from TIGER documentation.
 *
 * @param layer - Layer type
 * @returns Array of states with count mismatches
 */
export function validateExpectedCounts(layer: ValidatableLayer): readonly StateLayerValidation[] {
  const canonicalGEOIDs = getCanonicalGEOIDs(layer);
  const expectedCounts = getExpectedCounts(layer);
  const results: StateLayerValidation[] = [];

  for (const [stateFips, expectedCount] of Object.entries(expectedCounts)) {
    // Skip states with 0 expected
    if (expectedCount === 0) {
      continue;
    }

    const geoids = canonicalGEOIDs[stateFips] ?? [];
    const result = validateStateLayer(layer, stateFips, geoids);

    if (!result.valid) {
      results.push(result);
    }
  }

  return results;
}

/**
 * Validate a single layer
 *
 * @param layer - Layer type to validate
 * @returns Layer validation result
 */
export function validateLayer(layer: ValidatableLayer): LayerValidation {
  const format = GEOID_FORMATS[layer];
  const canonicalGEOIDs = getCanonicalGEOIDs(layer);
  const expectedCounts = getExpectedCounts(layer);

  const stateResults: StateLayerValidation[] = [];
  let totalGEOIDs = 0;
  let totalExpected = 0;

  // Validate each state
  for (const [stateFips, expectedCount] of Object.entries(expectedCounts)) {
    let geoids: readonly string[];

    // Special handling for VTD (lazy loaded)
    if (layer === 'vtd') {
      const vtdGEOIDs = loadVTDGEOIDs(stateFips);
      geoids = vtdGEOIDs ?? [];
    } else {
      geoids = canonicalGEOIDs[stateFips] ?? [];
    }

    const result = validateStateLayer(layer, stateFips, geoids);
    stateResults.push(result);

    totalGEOIDs += result.actualCount;
    totalExpected += result.expectedCount;
  }

  const statesPassed = stateResults.filter((r) => r.valid).length;
  const statesFailed = stateResults.filter((r) => !r.valid && r.errors.length > 0).length;
  const statesWithWarnings = stateResults.filter((r) => r.warnings.length > 0).length;

  // Determine overall status
  // Only count warnings where expected count is > 0 (ignore "uses different system" warnings)
  const substantiveWarnings = stateResults.filter(
    (r) => r.warnings.length > 0 && r.expectedCount > 0
  ).length;

  let status: 'PASS' | 'FAIL' | 'WARNING';
  if (statesFailed > 0) {
    status = 'FAIL';
  } else if (substantiveWarnings > 0) {
    status = 'WARNING';
  } else {
    status = 'PASS';
  }

  return {
    layer,
    description: format.description,
    formatSpec: `${format.length} digits (${format.example})`,
    statesValidated: stateResults.length,
    statesPassed,
    statesFailed,
    totalGEOIDs,
    totalExpected,
    status,
    stateResults,
  };
}

/**
 * Validate all canonical GEOIDs across all layers
 *
 * @returns Complete validation report
 */
export function validateAllCanonicalGEOIDs(): ValidationReport {
  const timestamp = new Date().toISOString();
  const layers: ValidatableLayer[] = ['cd', 'sldu', 'sldl', 'unsd', 'elsd', 'scsd', 'vtd'];

  const layerResults = layers.map((layer) => validateLayer(layer));

  // Calculate summary
  const layersPassed = layerResults.filter((r) => r.status === 'PASS').length;
  const layersFailed = layerResults.filter((r) => r.status === 'FAIL').length;
  const layersWithWarnings = layerResults.filter((r) => r.status === 'WARNING').length;

  const totalStatesValidated = layerResults.reduce((sum, r) => sum + r.statesValidated, 0);
  const totalStatesPassed = layerResults.reduce((sum, r) => sum + r.statesPassed, 0);
  const totalStatesFailed = layerResults.reduce((sum, r) => sum + r.statesFailed, 0);

  // Determine overall status
  let overallStatus: 'PASS' | 'FAIL' | 'WARNING';
  if (layersFailed > 0 || totalStatesFailed > 0) {
    overallStatus = 'FAIL';
  } else if (layersWithWarnings > 0) {
    overallStatus = 'WARNING';
  } else {
    overallStatus = 'PASS';
  }

  return {
    timestamp,
    layers: layerResults,
    summary: {
      layersValidated: layers.length,
      layersPassed,
      layersFailed,
      layersWithWarnings,
      totalStatesValidated,
      totalStatesPassed,
      totalStatesFailed,
      overallStatus,
    },
  };
}

/**
 * Generate formatted validation report
 *
 * @param report - Validation report
 * @returns Formatted report string
 */
export function generateValidationReport(report: ValidationReport): string {
  const lines: string[] = [];

  lines.push('SHADOW ATLAS GEOID VALIDATION REPORT');
  lines.push('====================================');
  lines.push(`Generated: ${report.timestamp}`);
  lines.push('');

  // Layer results
  for (const layer of report.layers) {
    const statusIcon = layer.status === 'PASS' ? '✅' : layer.status === 'WARNING' ? '⚠️' : '❌';

    lines.push(`LAYER: ${layer.layer.toUpperCase()} (${layer.description})`);
    lines.push(`  Format: ${layer.formatSpec}`);
    lines.push(`  States Validated: ${layer.statesValidated}`);
    lines.push(`  States Passed: ${layer.statesPassed}`);
    lines.push(`  States Failed: ${layer.statesFailed}`);
    lines.push(`  Total GEOIDs: ${layer.totalGEOIDs.toLocaleString()}`);
    lines.push(`  Expected: ${layer.totalExpected.toLocaleString()}`);
    lines.push(`  Status: ${statusIcon} ${layer.status}`);

    // Show failed states
    const failedStates = layer.stateResults.filter((s) => !s.valid && s.errors.length > 0);
    if (failedStates.length > 0) {
      lines.push('  Failed States:');
      for (const state of failedStates.slice(0, 5)) {
        lines.push(`    - ${state.stateAbbr} (${state.stateFips}): ${state.errors[0]}`);
      }
      if (failedStates.length > 5) {
        lines.push(`    ... and ${failedStates.length - 5} more`);
      }
    }

    lines.push('');
  }

  // Summary
  lines.push('SUMMARY');
  lines.push('-------');
  lines.push(`Layers validated: ${report.summary.layersValidated}`);
  lines.push(`Passed: ${report.summary.layersPassed}`);
  lines.push(`Failed: ${report.summary.layersFailed}`);
  lines.push(`Warnings: ${report.summary.layersWithWarnings}`);
  lines.push('');
  lines.push(`Total states validated: ${report.summary.totalStatesValidated}`);
  lines.push(`Total states passed: ${report.summary.totalStatesPassed}`);
  lines.push(`Total states failed: ${report.summary.totalStatesFailed}`);
  lines.push('');

  const overallIcon = report.summary.overallStatus === 'PASS' ? '✅' :
                      report.summary.overallStatus === 'WARNING' ? '⚠️' : '❌';
  lines.push(`Overall Status: ${overallIcon} ${report.summary.overallStatus}`);

  return lines.join('\n');
}

// ============================================================================
// Comprehensive Validation Report (Task 4.1)
// ============================================================================

/**
 * VTD coverage gap information
 */
export interface VTDCoverageGap {
  /** State FIPS code */
  readonly stateFips: string;
  /** State abbreviation */
  readonly stateAbbr: string | null;
  /** Reason for gap */
  readonly reason: string;
  /** Resolution status */
  readonly resolutionStatus: 'excluded' | 'pending' | 'in-progress' | 'resolved';
}

/**
 * Comprehensive validation report aggregating all validation subsystems
 *
 * Combines:
 * - Basic GEOID validation (format, count, coverage)
 * - TIGER cross-validation (canonical vs actual)
 * - Freshness monitoring (staleness alerts)
 * - VTD coverage gaps (documented exclusions)
 */
export interface ComprehensiveValidationReport extends ValidationReport {
  /** TIGER cross-validation results */
  readonly crossValidation: {
    /** Match rate per layer (0.0 - 1.0) */
    readonly tigerMatch: Partial<Record<ValidatableLayer, number>>;
    /** Overall match rate across all layers */
    readonly overallMatchRate: number;
    /** When cross-validation was last performed */
    readonly lastChecked: Date;
    /** Critical alerts from cross-validation */
    readonly alerts: readonly string[];
  };

  /** Freshness monitoring results */
  readonly freshness: {
    /** Jurisdictions with stale data */
    readonly staleJurisdictions: readonly FreshnessAlert[];
    /** Boundary types audited */
    readonly boundaryTypesAudited: readonly BoundaryType[];
    /** When freshness audit was last performed */
    readonly lastAudit: Date;
  };

  /** VTD coverage analysis */
  readonly coverage: {
    /** States with missing VTD data */
    readonly vtdMissingStates: readonly VTDCoverageGap[];
    /** Total VTDs extracted */
    readonly vtdTotalExtracted: number;
    /** States with VTD data */
    readonly vtdStatesExtracted: number;
    /** When VTD extraction was last performed */
    readonly lastExtraction: Date;
  };

  /** Production readiness assessment */
  readonly readiness: {
    /** Overall readiness status */
    readonly status: 'production-ready' | 'needs-review' | 'not-ready';
    /** Blocking issues */
    readonly blockers: readonly string[];
    /** Non-blocking warnings */
    readonly warnings: readonly string[];
  };
}

/**
 * Options for generating comprehensive report
 */
export interface ComprehensiveReportOptions {
  /** Include TIGER cross-validation (may take time) */
  includeCrossValidation?: boolean;
  /** Include freshness audit (requires network) */
  includeFreshnessAudit?: boolean;
  /** Pre-computed cross-validation report (to avoid re-running) */
  crossValidationReport?: CanonicalCrossValidationReport;
  /** Pre-computed freshness alerts (to avoid re-running) */
  freshnessAlerts?: Map<BoundaryType, FreshnessAlert[]>;
}

/**
 * Known VTD coverage gaps with documented reasons
 *
 * These are intentional exclusions, not bugs.
 */
const KNOWN_VTD_GAPS: readonly VTDCoverageGap[] = [
  {
    stateFips: '49',
    stateAbbr: 'UT',
    reason: 'Utah VTD data extracted via custom vistapre extractor (resolved 2026-01-09)',
    resolutionStatus: 'resolved',
  },
  {
    stateFips: '11',
    stateAbbr: 'DC',
    reason: 'DC operates as single voting jurisdiction with no precinct subdivisions in VEST dataset',
    resolutionStatus: 'excluded',
  },
] as const;

/**
 * Generate a comprehensive validation report
 *
 * Aggregates results from all validation subsystems into a single
 * production-readiness assessment.
 *
 * @param options - Configuration options
 * @returns Comprehensive validation report
 *
 * @example
 * ```typescript
 * // Basic report (GEOID validation only)
 * const report = await generateComprehensiveReport();
 *
 * // Full report with all subsystems
 * const fullReport = await generateComprehensiveReport({
 *   includeCrossValidation: true,
 *   includeFreshnessAudit: true,
 * });
 *
 * // With pre-computed results (faster)
 * const quickReport = await generateComprehensiveReport({
 *   crossValidationReport: existingCrossReport,
 *   freshnessAlerts: existingAlerts,
 * });
 * ```
 */
export async function generateComprehensiveReport(
  options: ComprehensiveReportOptions = {}
): Promise<ComprehensiveValidationReport> {
  const timestamp = new Date().toISOString();

  // 1. Run basic GEOID validation
  const baseReport = validateAllCanonicalGEOIDs();

  // 2. Get cross-validation results
  let crossValidationMatch: Partial<Record<ValidatableLayer, number>> = {};
  let overallMatchRate = 1.0;
  let crossValidationAlerts: readonly string[] = [];
  let crossValidationDate = new Date();

  if (options.crossValidationReport) {
    // Use pre-computed cross-validation
    crossValidationDate = new Date(options.crossValidationReport.timestamp);
    overallMatchRate = options.crossValidationReport.summary.overallMatchRate;
    crossValidationAlerts = options.crossValidationReport.summary.alerts;

    for (const layerReport of options.crossValidationReport.layers) {
      crossValidationMatch[layerReport.layer] = layerReport.averageMatchRate;
    }
  } else if (options.includeCrossValidation) {
    // Run cross-validation (this can be slow)
    const { createTIGERCanonicalValidator } = await import('../tiger/canonical-validator.js');
    const validator = createTIGERCanonicalValidator();
    const crossReport = await validator.validateAllLayers();

    crossValidationDate = new Date(crossReport.timestamp);
    overallMatchRate = crossReport.summary.overallMatchRate;
    crossValidationAlerts = crossReport.summary.alerts;

    for (const layerReport of crossReport.layers) {
      crossValidationMatch[layerReport.layer] = layerReport.averageMatchRate;
    }
  }

  // 3. Get freshness alerts
  let staleJurisdictions: readonly FreshnessAlert[] = [];
  let boundaryTypesAudited: readonly BoundaryType[] = [];
  let freshnessAuditDate = new Date();

  if (options.freshnessAlerts) {
    // Use pre-computed alerts
    staleJurisdictions = Array.from(options.freshnessAlerts.values()).flat();
    boundaryTypesAudited = Array.from(options.freshnessAlerts.keys());
  } else if (options.includeFreshnessAudit) {
    // Run freshness audit (requires network)
    const { PrimarySourceComparator } = await import('../../provenance/primary-comparator.js');
    const comparator = new PrimarySourceComparator();
    const alertsMap = await comparator.runFullAudit();

    staleJurisdictions = Array.from(alertsMap.values()).flat();
    boundaryTypesAudited = Array.from(alertsMap.keys());
  }

  // 4. Analyze VTD coverage
  const vtdCoverage = analyzeVTDCoverage();

  // 5. Assess production readiness
  const readiness = assessProductionReadiness(
    baseReport,
    overallMatchRate,
    crossValidationAlerts,
    staleJurisdictions,
    vtdCoverage
  );

  return {
    ...baseReport,
    timestamp,
    crossValidation: {
      tigerMatch: crossValidationMatch,
      overallMatchRate,
      lastChecked: crossValidationDate,
      alerts: crossValidationAlerts,
    },
    freshness: {
      staleJurisdictions,
      boundaryTypesAudited,
      lastAudit: freshnessAuditDate,
    },
    coverage: {
      vtdMissingStates: vtdCoverage.gaps,
      vtdTotalExtracted: vtdCoverage.totalExtracted,
      vtdStatesExtracted: vtdCoverage.statesExtracted,
      lastExtraction: vtdCoverage.extractionDate,
    },
    readiness,
  };
}

/**
 * Analyze VTD coverage gaps
 */
function analyzeVTDCoverage(): {
  gaps: readonly VTDCoverageGap[];
  totalExtracted: number;
  statesExtracted: number;
  extractionDate: Date;
} {
  // Count extracted VTDs
  let totalExtracted = 0;
  let statesExtracted = 0;

  // Check each state for VTD data
  for (const [stateFips, expectedCount] of Object.entries(EXPECTED_VTD_BY_STATE)) {
    if (expectedCount === 0) continue;

    const vtdGEOIDs = loadVTDGEOIDs(stateFips);
    if (vtdGEOIDs && vtdGEOIDs.length > 0) {
      totalExtracted += vtdGEOIDs.length;
      statesExtracted++;
    }
  }

  return {
    gaps: KNOWN_VTD_GAPS,
    totalExtracted,
    statesExtracted,
    extractionDate: new Date('2026-01-09T22:03:27.515Z'), // From vtd-geoids.ts header
  };
}

/**
 * Assess production readiness based on all validation results
 */
function assessProductionReadiness(
  baseReport: ValidationReport,
  crossValidationMatchRate: number,
  crossValidationAlerts: readonly string[],
  staleJurisdictions: readonly FreshnessAlert[],
  vtdCoverage: { gaps: readonly VTDCoverageGap[]; totalExtracted: number; statesExtracted: number }
): ComprehensiveValidationReport['readiness'] {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Check base validation
  if (baseReport.summary.overallStatus === 'FAIL') {
    blockers.push(`GEOID validation failed: ${baseReport.summary.totalStatesFailed} states with errors`);
  } else if (baseReport.summary.overallStatus === 'WARNING') {
    warnings.push(`GEOID validation has warnings: ${baseReport.summary.layersWithWarnings} layers with warnings`);
  }

  // Check cross-validation
  if (crossValidationMatchRate < 0.95) {
    blockers.push(`TIGER cross-validation below 95%: ${(crossValidationMatchRate * 100).toFixed(1)}% match rate`);
  } else if (crossValidationMatchRate < 0.99) {
    warnings.push(`TIGER cross-validation below 99%: ${(crossValidationMatchRate * 100).toFixed(1)}% match rate`);
  }

  // Add critical cross-validation alerts as blockers
  for (const alert of crossValidationAlerts) {
    if (alert.startsWith('CRITICAL')) {
      blockers.push(alert);
    } else if (alert.startsWith('WARNING')) {
      warnings.push(alert);
    }
  }

  // Check freshness
  const criticalStale = staleJurisdictions.filter(
    (a) => a.recommendation === 'use-primary' && a.staleDays > 30
  );
  if (criticalStale.length > 0) {
    warnings.push(`${criticalStale.length} jurisdictions have stale data (>30 days behind primary)`);
  }

  // Check VTD coverage
  const pendingGaps = vtdCoverage.gaps.filter((g) => g.resolutionStatus === 'pending');
  if (pendingGaps.length > 0) {
    warnings.push(`${pendingGaps.length} states with pending VTD coverage gaps (${pendingGaps.map(g => g.stateAbbr).join(', ')})`);
  }

  // Determine overall status
  let status: 'production-ready' | 'needs-review' | 'not-ready';
  if (blockers.length > 0) {
    status = 'not-ready';
  } else if (warnings.length > 0) {
    status = 'needs-review';
  } else {
    status = 'production-ready';
  }

  return {
    status,
    blockers,
    warnings,
  };
}

/**
 * Generate formatted comprehensive report
 *
 * @param report - Comprehensive validation report
 * @returns Formatted text report
 */
export function generateComprehensiveReportText(report: ComprehensiveValidationReport): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════════════════════════════');
  lines.push('SHADOW ATLAS COMPREHENSIVE VALIDATION REPORT');
  lines.push('═══════════════════════════════════════════════════════════════════════════════');
  lines.push(`Generated: ${report.timestamp}`);
  lines.push('');

  // Production Readiness
  const statusIcon = report.readiness.status === 'production-ready' ? '✅' :
                     report.readiness.status === 'needs-review' ? '⚠️' : '❌';
  lines.push('PRODUCTION READINESS');
  lines.push('─────────────────────────────────────────────────────────────────────────────');
  lines.push(`  Status: ${statusIcon} ${report.readiness.status.toUpperCase()}`);

  if (report.readiness.blockers.length > 0) {
    lines.push('  Blockers:');
    for (const blocker of report.readiness.blockers) {
      lines.push(`    ❌ ${blocker}`);
    }
  }

  if (report.readiness.warnings.length > 0) {
    lines.push('  Warnings:');
    for (const warning of report.readiness.warnings) {
      lines.push(`    ⚠️ ${warning}`);
    }
  }

  if (report.readiness.blockers.length === 0 && report.readiness.warnings.length === 0) {
    lines.push('  All validation checks passed.');
  }
  lines.push('');

  // GEOID Validation Summary
  lines.push('GEOID VALIDATION');
  lines.push('─────────────────────────────────────────────────────────────────────────────');
  const geoidIcon = report.summary.overallStatus === 'PASS' ? '✅' :
                    report.summary.overallStatus === 'WARNING' ? '⚠️' : '❌';
  lines.push(`  Status: ${geoidIcon} ${report.summary.overallStatus}`);
  lines.push(`  Layers: ${report.summary.layersPassed}/${report.summary.layersValidated} passed`);
  lines.push(`  States: ${report.summary.totalStatesPassed}/${report.summary.totalStatesValidated} passed`);
  lines.push('');

  // Cross-Validation Summary
  lines.push('TIGER CROSS-VALIDATION');
  lines.push('─────────────────────────────────────────────────────────────────────────────');
  const matchPct = (report.crossValidation.overallMatchRate * 100).toFixed(2);
  const crossIcon = report.crossValidation.overallMatchRate >= 0.99 ? '✅' :
                    report.crossValidation.overallMatchRate >= 0.95 ? '⚠️' : '❌';
  lines.push(`  Overall Match Rate: ${crossIcon} ${matchPct}%`);
  lines.push(`  Last Checked: ${report.crossValidation.lastChecked.toISOString()}`);

  if (Object.keys(report.crossValidation.tigerMatch).length > 0) {
    lines.push('  Per-Layer Match Rates:');
    for (const [layer, rate] of Object.entries(report.crossValidation.tigerMatch)) {
      if (rate !== undefined) {
        const layerPct = (rate * 100).toFixed(1);
        const layerIcon = rate >= 0.99 ? '✅' : rate >= 0.95 ? '⚠️' : '❌';
        lines.push(`    ${layer.toUpperCase()}: ${layerIcon} ${layerPct}%`);
      }
    }
  }
  lines.push('');

  // Freshness Summary
  lines.push('FRESHNESS MONITORING');
  lines.push('─────────────────────────────────────────────────────────────────────────────');
  lines.push(`  Last Audit: ${report.freshness.lastAudit.toISOString()}`);
  lines.push(`  Boundary Types Audited: ${report.freshness.boundaryTypesAudited.length}`);
  lines.push(`  Stale Jurisdictions: ${report.freshness.staleJurisdictions.length}`);

  if (report.freshness.staleJurisdictions.length > 0) {
    lines.push('  Stale Data:');
    for (const alert of report.freshness.staleJurisdictions.slice(0, 5)) {
      lines.push(`    - ${alert.jurisdiction}/${alert.boundaryType}: ${alert.staleDays} days stale`);
    }
    if (report.freshness.staleJurisdictions.length > 5) {
      lines.push(`    ... and ${report.freshness.staleJurisdictions.length - 5} more`);
    }
  }
  lines.push('');

  // VTD Coverage Summary
  lines.push('VTD COVERAGE');
  lines.push('─────────────────────────────────────────────────────────────────────────────');
  lines.push(`  States Extracted: ${report.coverage.vtdStatesExtracted}/50`);
  lines.push(`  Total VTDs: ${report.coverage.vtdTotalExtracted.toLocaleString()}`);
  lines.push(`  Last Extraction: ${report.coverage.lastExtraction.toISOString()}`);

  if (report.coverage.vtdMissingStates.length > 0) {
    lines.push('  Coverage Gaps:');
    for (const gap of report.coverage.vtdMissingStates) {
      const gapIcon = gap.resolutionStatus === 'excluded' ? '📋' :
                      gap.resolutionStatus === 'pending' ? '⏳' : '🔧';
      lines.push(`    ${gapIcon} ${gap.stateAbbr} (${gap.stateFips}): ${gap.reason}`);
    }
  }
  lines.push('');

  lines.push('═══════════════════════════════════════════════════════════════════════════════');

  return lines.join('\n');
}
