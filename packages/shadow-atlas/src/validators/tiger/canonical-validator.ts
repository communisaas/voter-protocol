/**
 * TIGER Canonical Cross-Validation Orchestrator
 *
 * Validates TIGER shapefile GEOIDs against canonical reference lists.
 * Detects missing boundaries (in canonical but not in TIGER) and extra
 * boundaries (in TIGER but not in canonical).
 *
 * VALIDATION WORKFLOW:
 * 1. Download TIGER shapefile for layer/state using TIGERBoundaryProvider
 * 2. Extract GEOIDs from shapefile (validation-only mode, no geometry)
 * 3. Compare against canonical GEOIDs from geoid-reference.ts
 * 4. Report missing, extra, and match rate per layer/state
 *
 * SUPPORTED LAYERS:
 * - cd: Congressional Districts
 * - sldu: State Legislative Upper
 * - sldl: State Legislative Lower
 * - county: Counties
 * - unsd: Unified School Districts
 * - elsd: Elementary School Districts
 * - scsd: Secondary School Districts
 *
 * NOTE: VTD is not cross-validated against TIGER (comes from RDH).
 *
 * @example
 * ```typescript
 * const validator = createTIGERCanonicalValidator({ year: 2024 });
 *
 * // Validate single layer for specific states
 * const cdResults = await validator.validateLayer('cd', ['06', '48']);
 *
 * // Validate all layers for all states
 * const report = await validator.validateAllLayers();
 * console.log(`Overall match rate: ${report.summary.overallMatchRate}%`);
 * ```
 */

import {
  TIGERBoundaryProvider,
  type TIGERLayer,
  type ValidationExtractionResult,
} from '../../providers/tiger-boundary-provider.js';
import type { ValidatableLayer } from '../geoid/validation-suite.js';
import { logger } from '../../core/utils/logger.js';
import {
  getCanonicalGEOIDs,
  getMissingGEOIDs,
  getExtraGEOIDs,
} from '../geoid/reference.js';
import {
  EXPECTED_CD_BY_STATE,
  EXPECTED_SLDU_BY_STATE,
  EXPECTED_SLDL_BY_STATE,
  EXPECTED_COUNTIES_BY_STATE,
  EXPECTED_UNSD_BY_STATE,
  EXPECTED_ELSD_BY_STATE,
  EXPECTED_SCSD_BY_STATE,
  getStateAbbr,
} from '../tiger-expected-counts.js';
import type { TIGERLayerType } from '../../core/types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of cross-validation for a single layer/state combination
 */
export interface CanonicalCrossValidationResult {
  /** Layer type validated */
  readonly layer: ValidatableLayer;

  /** State FIPS code (2 digits) */
  readonly stateFips: string;

  /** State abbreviation (e.g., 'CA') */
  readonly stateAbbr: string | null;

  /** Canonical GEOIDs expected for this layer/state */
  readonly canonical: readonly string[];

  /** Actual GEOIDs extracted from TIGER shapefile */
  readonly actual: readonly string[];

  /** GEOIDs in canonical but not in TIGER (missing from TIGER) */
  readonly missing: readonly string[];

  /** GEOIDs in TIGER but not in canonical (extra in TIGER) */
  readonly extra: readonly string[];

  /** Match rate (0.0 - 1.0) - percentage of canonical GEOIDs found in TIGER */
  readonly matchRate: number;

  /** Whether validation passed (no missing, no extra) */
  readonly valid: boolean;

  /** TIGER vintage year */
  readonly year: number;

  /** Source URL of TIGER shapefile */
  readonly source: string;
}

/**
 * Aggregated results for a single layer across all validated states
 */
export interface ValidatableLayerReport {
  /** Layer type */
  readonly layer: ValidatableLayer;

  /** Number of states validated */
  readonly statesValidated: number;

  /** Number of states that passed validation */
  readonly statesPassed: number;

  /** Number of states with missing GEOIDs */
  readonly statesWithMissing: number;

  /** Number of states with extra GEOIDs */
  readonly statesWithExtra: number;

  /** Average match rate across all states */
  readonly averageMatchRate: number;

  /** Total canonical GEOIDs expected across all states */
  readonly totalCanonical: number;

  /** Total actual GEOIDs found across all states */
  readonly totalActual: number;

  /** Total missing GEOIDs across all states */
  readonly totalMissing: number;

  /** Total extra GEOIDs across all states */
  readonly totalExtra: number;

  /** Per-state validation results */
  readonly stateResults: readonly CanonicalCrossValidationResult[];
}

/**
 * Complete cross-validation report for all layers
 */
export interface CanonicalCrossValidationReport {
  /** Report generation timestamp (ISO 8601) */
  readonly timestamp: string;

  /** Per-layer validation reports */
  readonly layers: readonly ValidatableLayerReport[];

  /** Summary statistics */
  readonly summary: {
    /** Total layers validated */
    readonly totalLayers: number;

    /** Total states validated across all layers */
    readonly totalStates: number;

    /** Overall match rate (weighted by canonical count) */
    readonly overallMatchRate: number;

    /** Critical alerts (e.g., layers with <90% match rate) */
    readonly alerts: readonly string[];
  };
}

/**
 * Options for creating TIGERCanonicalValidator
 */
export interface TIGERCanonicalValidatorOptions {
  /** TIGER vintage year (default: 2024) */
  year?: number;

  /** Custom cache directory for TIGER downloads */
  cacheDir?: string;

  /** Force re-download of TIGER files */
  forceRefresh?: boolean;
}

// ============================================================================
// Layer Mapping
// ============================================================================

/**
 * Map ValidatableLayer to TIGERLayer
 *
 * VTD is excluded because it comes from RDH, not TIGER.
 */
const VALIDATABLE_TO_TIGER_LAYER: Record<Exclude<ValidatableLayer, 'vtd'>, TIGERLayer> = {
  cd: 'cd',
  sldu: 'sldu',
  sldl: 'sldl',
  county: 'county',
  unsd: 'unsd',
  elsd: 'elsd',
  scsd: 'scsd',
};

/**
 * Layers that can be cross-validated against TIGER
 * (excludes VTD which comes from RDH)
 */
type CrossValidatableLayer = Exclude<ValidatableLayer, 'vtd'>;

/**
 * Get expected counts for a layer by state
 */
function getExpectedCountsByState(layer: CrossValidatableLayer): Record<string, number> {
  switch (layer) {
    case 'cd':
      return EXPECTED_CD_BY_STATE;
    case 'sldu':
      return EXPECTED_SLDU_BY_STATE;
    case 'sldl':
      return EXPECTED_SLDL_BY_STATE;
    case 'county':
      return EXPECTED_COUNTIES_BY_STATE;
    case 'unsd':
      return EXPECTED_UNSD_BY_STATE;
    case 'elsd':
      return EXPECTED_ELSD_BY_STATE;
    case 'scsd':
      return EXPECTED_SCSD_BY_STATE;
  }
}

/**
 * Get all state FIPS codes that have data for a layer
 */
function getApplicableStates(layer: CrossValidatableLayer): readonly string[] {
  const countsByState = getExpectedCountsByState(layer);
  return Object.entries(countsByState)
    .filter(([, count]) => count > 0)
    .map(([fips]) => fips);
}

// ============================================================================
// TIGERCanonicalValidator Class
// ============================================================================

/**
 * Cross-validation orchestrator for TIGER vs canonical GEOIDs
 */
export class TIGERCanonicalValidator {
  private readonly provider: TIGERBoundaryProvider;
  private readonly year: number;
  private readonly forceRefresh: boolean;

  constructor(
    provider: TIGERBoundaryProvider,
    options: { year?: number; forceRefresh?: boolean } = {}
  ) {
    this.provider = provider;
    this.year = options.year ?? 2024;
    this.forceRefresh = options.forceRefresh ?? false;
  }

  /**
   * Validate a single layer against canonical GEOIDs
   *
   * @param layer - Layer type to validate (cd, sldu, sldl, county, unsd, elsd, scsd)
   * @param states - Optional list of state FIPS codes (defaults to all applicable states)
   * @returns Array of validation results, one per state
   */
  async validateLayer(
    layer: CrossValidatableLayer,
    states?: readonly string[]
  ): Promise<readonly CanonicalCrossValidationResult[]> {
    const tigerLayer = VALIDATABLE_TO_TIGER_LAYER[layer];
    const statesToValidate = states ?? getApplicableStates(layer);
    const results: CanonicalCrossValidationResult[] = [];

    logger.info('Starting TIGER canonical GEOID validation for layer', {
      layer: layer.toUpperCase(),
      stateCount: statesToValidate.length,
    });

    for (const stateFips of statesToValidate) {
      try {
        const result = await this.validateLayerForState(layer, tigerLayer, stateFips);
        results.push(result);

        // Log progress
        const statusIcon = result.valid ? 'PASS' : 'FAIL';
        const matchPct = (result.matchRate * 100).toFixed(1);
        logger.info('TIGER canonical validation state result', {
          state: result.stateAbbr ?? stateFips,
          status: statusIcon,
          matchRate: matchPct,
          missing: result.missing.length,
          extra: result.extra.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('TIGER canonical validation state failed', {
          stateFips,
          error: message,
        });

        // Add failed result with empty arrays
        results.push(this.createFailedResult(layer, stateFips, message));
      }
    }

    return results;
  }

  /**
   * Validate all supported layers against canonical GEOIDs
   *
   * @returns Complete cross-validation report
   */
  async validateAllLayers(): Promise<CanonicalCrossValidationReport> {
    const timestamp = new Date().toISOString();
    const layerReports: ValidatableLayerReport[] = [];
    const alerts: string[] = [];

    // Layers to validate (excludes VTD)
    const layers: CrossValidatableLayer[] = ['cd', 'sldu', 'sldl', 'county', 'unsd', 'elsd', 'scsd'];

    logger.info('TIGER Canonical Cross-Validation Report', {
      timestamp,
      tigerYear: this.year,
      layerCount: layers.length,
    });

    for (const layer of layers) {
      const stateResults = await this.validateLayer(layer);
      const report = this.aggregateLayerResults(layer, stateResults);
      layerReports.push(report);

      // Generate alerts for problematic layers
      if (report.averageMatchRate < 0.9) {
        alerts.push(
          `CRITICAL: ${layer.toUpperCase()} layer has ${(report.averageMatchRate * 100).toFixed(1)}% ` +
          `average match rate (below 90% threshold)`
        );
      }

      if (report.statesWithMissing > 0) {
        alerts.push(
          `WARNING: ${layer.toUpperCase()} layer has ${report.statesWithMissing} states ` +
          `with missing GEOIDs (${report.totalMissing} total missing)`
        );
      }
    }

    // Calculate summary statistics
    const totalStates = layerReports.reduce((sum, r) => sum + r.statesValidated, 0);
    const totalCanonical = layerReports.reduce((sum, r) => sum + r.totalCanonical, 0);
    const totalActual = layerReports.reduce((sum, r) => sum + r.totalActual, 0);
    const overallMatchRate = totalCanonical > 0
      ? this.calculateWeightedMatchRate(layerReports)
      : 0;

    return {
      timestamp,
      layers: layerReports,
      summary: {
        totalLayers: layers.length,
        totalStates,
        overallMatchRate,
        alerts,
      },
    };
  }

  /**
   * Validate a single layer for a single state
   */
  private async validateLayerForState(
    layer: CrossValidatableLayer,
    tigerLayer: TIGERLayer,
    stateFips: string
  ): Promise<CanonicalCrossValidationResult> {
    // Get canonical GEOIDs
    const canonical = getCanonicalGEOIDs(layer as TIGERLayerType, stateFips);

    if (!canonical || canonical.length === 0) {
      // No canonical data available for this layer/state
      return {
        layer,
        stateFips,
        stateAbbr: getStateAbbr(stateFips),
        canonical: [],
        actual: [],
        missing: [],
        extra: [],
        matchRate: 1.0, // No canonical = nothing to validate
        valid: true,
        year: this.year,
        source: '',
      };
    }

    // Download and extract GEOIDs from TIGER
    const extraction = await this.provider.downloadForValidation({
      layer: tigerLayer,
      stateFips,
      year: this.year,
      forceRefresh: this.forceRefresh,
    });

    // Compare against canonical
    const missing = getMissingGEOIDs(layer as TIGERLayerType, stateFips, extraction.geoids);
    const extra = getExtraGEOIDs(layer as TIGERLayerType, stateFips, extraction.geoids);

    // Calculate match rate (canonical found in TIGER)
    const matchedCount = canonical.length - missing.length;
    const matchRate = canonical.length > 0 ? matchedCount / canonical.length : 1.0;

    return {
      layer,
      stateFips,
      stateAbbr: getStateAbbr(stateFips),
      canonical,
      actual: extraction.geoids,
      missing,
      extra,
      matchRate,
      valid: missing.length === 0 && extra.length === 0,
      year: this.year,
      source: extraction.source,
    };
  }

  /**
   * Create a failed validation result
   */
  private createFailedResult(
    layer: CrossValidatableLayer,
    stateFips: string,
    _error: string
  ): CanonicalCrossValidationResult {
    return {
      layer,
      stateFips,
      stateAbbr: getStateAbbr(stateFips),
      canonical: [],
      actual: [],
      missing: [],
      extra: [],
      matchRate: 0,
      valid: false,
      year: this.year,
      source: '',
    };
  }

  /**
   * Aggregate per-state results into a layer report
   */
  private aggregateLayerResults(
    layer: CrossValidatableLayer,
    stateResults: readonly CanonicalCrossValidationResult[]
  ): ValidatableLayerReport {
    const statesValidated = stateResults.length;
    const statesPassed = stateResults.filter(r => r.valid).length;
    const statesWithMissing = stateResults.filter(r => r.missing.length > 0).length;
    const statesWithExtra = stateResults.filter(r => r.extra.length > 0).length;

    const totalCanonical = stateResults.reduce((sum, r) => sum + r.canonical.length, 0);
    const totalActual = stateResults.reduce((sum, r) => sum + r.actual.length, 0);
    const totalMissing = stateResults.reduce((sum, r) => sum + r.missing.length, 0);
    const totalExtra = stateResults.reduce((sum, r) => sum + r.extra.length, 0);

    // Weighted average match rate by canonical count
    const weightedSum = stateResults.reduce(
      (sum, r) => sum + r.matchRate * r.canonical.length,
      0
    );
    const averageMatchRate = totalCanonical > 0 ? weightedSum / totalCanonical : 1.0;

    return {
      layer,
      statesValidated,
      statesPassed,
      statesWithMissing,
      statesWithExtra,
      averageMatchRate,
      totalCanonical,
      totalActual,
      totalMissing,
      totalExtra,
      stateResults,
    };
  }

  /**
   * Calculate weighted overall match rate across all layers
   */
  private calculateWeightedMatchRate(layerReports: readonly ValidatableLayerReport[]): number {
    const totalCanonical = layerReports.reduce((sum, r) => sum + r.totalCanonical, 0);
    if (totalCanonical === 0) return 1.0;

    const weightedSum = layerReports.reduce(
      (sum, r) => sum + r.averageMatchRate * r.totalCanonical,
      0
    );
    return weightedSum / totalCanonical;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a TIGERCanonicalValidator instance
 *
 * @param options - Validator configuration options
 * @returns Configured TIGERCanonicalValidator instance
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const validator = createTIGERCanonicalValidator();
 *
 * // Custom year and cache directory
 * const validator = createTIGERCanonicalValidator({
 *   year: 2023,
 *   cacheDir: '/tmp/tiger-cache',
 *   forceRefresh: true,
 * });
 * ```
 */
export function createTIGERCanonicalValidator(
  options: TIGERCanonicalValidatorOptions = {}
): TIGERCanonicalValidator {
  const provider = new TIGERBoundaryProvider({
    year: options.year ?? 2024,
    cacheDir: options.cacheDir,
  });

  return new TIGERCanonicalValidator(provider, {
    year: options.year,
    forceRefresh: options.forceRefresh,
  });
}

// ============================================================================
// Report Formatting
// ============================================================================

/**
 * Generate a human-readable text report from validation results
 *
 * @param report - Cross-validation report
 * @returns Formatted text report
 */
export function formatCrossValidationReport(report: CanonicalCrossValidationReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('========================================');
  lines.push('TIGER CANONICAL CROSS-VALIDATION REPORT');
  lines.push('========================================');
  lines.push(`Generated: ${report.timestamp}`);
  lines.push('');

  // Summary
  lines.push('SUMMARY');
  lines.push('-------');
  lines.push(`Total Layers Validated: ${report.summary.totalLayers}`);
  lines.push(`Total State Validations: ${report.summary.totalStates}`);
  lines.push(`Overall Match Rate: ${(report.summary.overallMatchRate * 100).toFixed(2)}%`);
  lines.push('');

  // Alerts
  if (report.summary.alerts.length > 0) {
    lines.push('ALERTS');
    lines.push('------');
    for (const alert of report.summary.alerts) {
      lines.push(`  * ${alert}`);
    }
    lines.push('');
  }

  // Per-layer details
  lines.push('LAYER DETAILS');
  lines.push('-------------');

  for (const layer of report.layers) {
    const matchPct = (layer.averageMatchRate * 100).toFixed(1);
    const statusIcon = layer.statesPassed === layer.statesValidated ? 'PASS' : 'FAIL';

    lines.push('');
    lines.push(`${layer.layer.toUpperCase()} [${statusIcon}]`);
    lines.push(`  States Validated: ${layer.statesValidated}`);
    lines.push(`  States Passed: ${layer.statesPassed}`);
    lines.push(`  Average Match Rate: ${matchPct}%`);
    lines.push(`  Total Canonical: ${layer.totalCanonical.toLocaleString()}`);
    lines.push(`  Total Actual: ${layer.totalActual.toLocaleString()}`);
    lines.push(`  Total Missing: ${layer.totalMissing}`);
    lines.push(`  Total Extra: ${layer.totalExtra}`);

    // Show failed states
    const failedStates = layer.stateResults.filter(r => !r.valid);
    if (failedStates.length > 0) {
      lines.push('  Failed States:');
      for (const state of failedStates.slice(0, 5)) {
        const stateMatchPct = (state.matchRate * 100).toFixed(1);
        lines.push(
          `    - ${state.stateAbbr ?? state.stateFips}: ${stateMatchPct}% match, ` +
          `${state.missing.length} missing, ${state.extra.length} extra`
        );
      }
      if (failedStates.length > 5) {
        lines.push(`    ... and ${failedStates.length - 5} more`);
      }
    }
  }

  lines.push('');
  lines.push('========================================');

  return lines.join('\n');
}
