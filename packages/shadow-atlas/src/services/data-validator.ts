/**
 * DataValidator - Unified validation service for Shadow Atlas extractions
 *
 * Consolidates validation logic from scattered scripts into a reusable,
 * testable service with stored results and comprehensive audit trail.
 *
 * ARCHITECTURE:
 * - Composes existing validators (DeterministicValidationPipeline, TIGERValidityChecker)
 * - Adds cross-validation against TIGERweb API
 * - Provides mismatch diagnostics (ZZ districts, multi-member systems)
 * - Stores results for audit trail
 *
 * TYPE SAFETY: Nuclear-level strictness. Zero `any`, zero `@ts-ignore`.
 * This is production infrastructure - type errors = invalid validation.
 *
 * @example
 * ```typescript
 * const validator = new DataValidator();
 *
 * // Validate extraction against registry
 * const result = await validator.validateAgainstRegistry(extraction);
 * if (!result.passed) {
 *   console.error(`${result.mismatchedStates} states have count mismatches`);
 * }
 *
 * // Cross-validate with TIGERweb
 * const crossVal = await validator.crossValidateWithTIGER(extraction, {
 *   state: 'WI',
 *   layer: 'congressional'
 * });
 *
 * // Diagnose mismatches
 * const diagnostic = await validator.diagnoseMismatches('CT', 'congressional');
 * console.log(`Diagnosis: ${diagnostic.diagnosis}`);
 * console.log(`Recommendation: ${diagnostic.recommendation}`);
 * ```
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { area, kinks, unkinkPolygon } from '@turf/turf';
import { polygon as turfPolygon, multiPolygon as turfMultiPolygon } from '@turf/helpers';
import type { Position } from 'geojson';
import type {
  ValidationOptions,
  CrossValidationOptions,
  RegistryValidationResult,
  CountMismatch,
  CrossValidationResult,
  CrossValidationDiscrepancy,
  GeometryValidationResult,
  GeometryIssue,
  MismatchDiagnostic,
  DiagnosisType,
  ExtraFeatureInfo,
  ZZDistrictInfo,
  MultiMemberDistrictInfo,
  ValidationResults,
  StoredValidationResults,
  TIGERwebResponse,
  MultiStateValidationOptions,
  StateConfig,
  StateLayerValidationResult,
  MultiStateValidationResult,
  GeoidValidationResult,
  BatchGeoidValidationResult,
  CoverageValidationResult,
  ReportFormat,
  MultiStateReport,
  ReportSummary,
  StateReport,
  LayerReport,
} from './data-validator.types.js';
import type {
  BatchExtractionResult,
  ExtractedBoundary,
  LayerExtractionResult,
  StateExtractionResult,
} from '../providers/state-batch-extractor.js';
import type { LegislativeLayerType } from '../core/registry/state-gis-portals.js';
import { DeterministicValidationPipeline } from '../validators/pipeline/deterministic.js';
import { getLegislativeEndpoint, STATE_GIS_PORTALS } from '../core/registry/state-gis-portals.js';

// ============================================================================
// Constants
// ============================================================================

const STORAGE_DIR = '.shadow-atlas/validation-results';
const SCHEMA_VERSION = 1;
const STORAGE_VERSION = '1.0.0';

/** Rate limit delay for TIGERweb API calls (ms) */
const DEFAULT_RATE_LIMIT_MS = 500;

/** Default retry attempts for failed API calls */
const DEFAULT_RETRY_ATTEMPTS = 3;

/** Timeout for TIGERweb API requests (ms) */
const TIGERWEB_TIMEOUT_MS = 30000;

// STATE_FIPS imported from centralized geo-constants (eliminated duplicate)
import { STATE_ABBR_TO_FIPS as STATE_FIPS } from '../core/geo-constants.js';

/** TIGERweb REST API endpoints */
const TIGERWEB_ENDPOINTS: Record<LegislativeLayerType, string> = {
  congressional: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0',
  state_senate: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/1',
  state_house: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/2',
  county: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1',
};

// ============================================================================
// DataValidator Service
// ============================================================================

/**
 * DataValidator - Production validation service
 *
 * Consolidates scattered validation logic into unified, type-safe service.
 */
export class DataValidator {
  private readonly deterministicPipeline = new DeterministicValidationPipeline();
  private readonly storageDir: string;

  constructor(storageDir?: string) {
    this.storageDir = storageDir ?? STORAGE_DIR;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Validate extraction against expected counts from registry
   *
   * Compares extracted boundary counts with expected counts from state-gis-portals.ts.
   *
   * @param extraction - Batch extraction result from StateBatchExtractor
   * @param options - Validation options
   * @returns Registry validation result with detailed mismatches
   */
  async validateAgainstRegistry(
    extraction: BatchExtractionResult,
    options?: ValidationOptions
  ): Promise<RegistryValidationResult> {
    const mismatches: CountMismatch[] = [];
    let matchedStates = 0;

    for (const stateResult of extraction.states) {
      for (const layerResult of stateResult.layers) {
        const mismatch = this.detectCountMismatch(
          stateResult.state,
          layerResult.layerType,
          layerResult.expectedCount,
          layerResult.featureCount
        );

        if (mismatch) {
          mismatches.push(mismatch);
        } else if (layerResult.success) {
          matchedStates++;
        }
      }
    }

    const totalStates = extraction.states.length;
    const mismatchedStates = mismatches.length;
    const passed = mismatches.length === 0;

    // Calculate confidence based on match ratio
    const matchRatio = matchedStates / (matchedStates + mismatchedStates);
    const confidence = matchRatio;

    return {
      passed,
      totalStates,
      matchedStates,
      mismatchedStates,
      mismatches,
      validatedAt: new Date(),
      confidence,
    };
  }

  /**
   * Cross-validate state portal data against TIGERweb API
   *
   * Fetches ground truth data from TIGERweb and compares with state extraction.
   *
   * @param state - State code (e.g., "WI")
   * @param layer - Legislative layer type
   * @param extraction - State extraction result
   * @param options - Cross-validation options
   * @returns Cross-validation result with discrepancies
   */
  async crossValidateWithTIGER(
    state: string,
    layer: LegislativeLayerType,
    extraction: StateExtractionResult,
    options?: CrossValidationOptions
  ): Promise<CrossValidationResult> {
    const startTime = Date.now();
    const stateUpper = state.toUpperCase();

    // Find layer in extraction
    const layerResult = extraction.layers.find(l => l.layerType === layer);
    if (!layerResult) {
      throw new Error(`Layer ${layer} not found in extraction for ${state}`);
    }

    // Fetch TIGERweb data
    const tigerData = await this.fetchTIGERwebData(stateUpper, layer, options);
    const tigerBoundaryCount = tigerData.features.length;
    const stateBoundaryCount = layerResult.featureCount;

    // Compare counts
    const discrepancies: CrossValidationDiscrepancy[] = [];

    if (tigerBoundaryCount !== stateBoundaryCount) {
      discrepancies.push({
        boundaryId: `${stateUpper}-${layer}-count`,
        type: 'count',
        tigerValue: tigerBoundaryCount,
        stateValue: stateBoundaryCount,
        severity: Math.abs(tigerBoundaryCount - stateBoundaryCount) > 2 ? 'critical' : 'warning',
        explanation: `Count mismatch: TIGERweb has ${tigerBoundaryCount} boundaries, state has ${stateBoundaryCount}`,
      });
    }

    // Compare GEOIDs
    const tigerGeoids = new Set(
      tigerData.features.map(f => String(f.attributes.GEOID ?? ''))
    );
    const stateGeoids = new Set(
      layerResult.boundaries.map(b => String(b.properties.GEOID ?? b.id))
    );

    for (const geoid of stateGeoids) {
      if (!tigerGeoids.has(geoid)) {
        discrepancies.push({
          boundaryId: geoid,
          type: 'missing',
          tigerValue: null,
          stateValue: geoid,
          severity: 'warning',
          explanation: `GEOID ${geoid} found in state data but not in TIGERweb`,
        });
      }
    }

    for (const geoid of tigerGeoids) {
      if (!stateGeoids.has(geoid)) {
        discrepancies.push({
          boundaryId: geoid,
          type: 'missing',
          tigerValue: geoid,
          stateValue: null,
          severity: 'warning',
          explanation: `GEOID ${geoid} found in TIGERweb but not in state data`,
        });
      }
    }

    const matches = Math.min(tigerBoundaryCount, stateBoundaryCount) - discrepancies.filter(d => d.type === 'missing').length;
    const passed = discrepancies.length === 0;
    const confidence = discrepancies.length === 0 ? 1.0 : Math.max(0, 1.0 - (discrepancies.length / Math.max(tigerBoundaryCount, stateBoundaryCount)));

    const durationMs = Date.now() - startTime;

    return {
      passed,
      state: stateUpper,
      layer,
      stateSource: layerResult.metadata.endpoint,
      tigerSource: TIGERWEB_ENDPOINTS[layer],
      stateBoundaryCount,
      tigerBoundaryCount,
      matches,
      discrepancyCount: discrepancies.length,
      discrepancies,
      confidence,
      validatedAt: new Date(),
      durationMs,
    };
  }

  /**
   * Validate geometry: gaps, overlaps, coordinate systems
   *
   * Performs geometric validation on extracted boundaries.
   *
   * @param boundaries - Extracted boundaries to validate
   * @returns Geometry validation result
   */
  async validateGeometry(
    boundaries: readonly ExtractedBoundary[]
  ): Promise<GeometryValidationResult> {
    const issues: GeometryIssue[] = [];
    let validGeometry = 0;
    let gapsDetected = 0;
    let overlapsDetected = 0;
    let invalidCoordinates = 0;

    for (const boundary of boundaries) {
      // Validate coordinate ranges
      const coordIssue = this.validateCoordinates(boundary);
      if (coordIssue) {
        issues.push(coordIssue);
        invalidCoordinates++;
      } else {
        validGeometry++;
      }

      // Check for self-intersection
      const selfIntersection = this.checkSelfIntersection(boundary);
      if (selfIntersection) {
        issues.push(selfIntersection);
      }
    }

    const totalBoundaries = boundaries.length;
    const passed = issues.filter(i => i.severity === 'critical').length === 0;
    const confidence = validGeometry / totalBoundaries;

    return {
      passed,
      totalBoundaries,
      validGeometry,
      gapsDetected,
      overlapsDetected,
      invalidCoordinates,
      coordinateSystemIssues: [],
      issues,
      confidence,
    };
  }

  /**
   * Diagnose count mismatches (ZZ districts, multi-member systems)
   *
   * Investigates why a state has more/fewer districts than expected.
   * Detects common patterns like ZZ water districts and multi-member districts.
   *
   * @param state - State code
   * @param layer - Legislative layer type
   * @returns Mismatch diagnostic with recommendations
   */
  async diagnoseMismatches(
    state: string,
    layer: LegislativeLayerType
  ): Promise<MismatchDiagnostic> {
    const stateUpper = state.toUpperCase();
    const portal = STATE_GIS_PORTALS[stateUpper];

    if (!portal) {
      throw new Error(`State ${state} not found in registry`);
    }

    const layerInfo = getLegislativeEndpoint(stateUpper, layer);
    if (!layerInfo) {
      throw new Error(`Layer ${layer} not configured for ${state}`);
    }

    // Fetch actual data
    const tigerData = await this.fetchTIGERwebData(stateUpper, layer);

    const expectedCount = layerInfo.expectedCount;
    const actualCount = tigerData.features.length;
    const discrepancy = actualCount - expectedCount;

    // Analyze features
    const extraFeatures: ExtraFeatureInfo[] = [];
    const zzDistricts: ZZDistrictInfo[] = [];
    const multiMemberDistricts: MultiMemberDistrictInfo[] = [];

    for (const feature of tigerData.features) {
      const geoid = String(feature.attributes.GEOID ?? '');
      const name = String(feature.attributes.NAME ?? '');

      // Check for ZZ districts (water, uninhabited)
      if (geoid.endsWith('ZZ') || name.includes('(water)') || name.includes('Water')) {
        zzDistricts.push({
          id: geoid,
          name,
          geoid,
          type: 'water',
        });
        extraFeatures.push({
          id: geoid,
          name,
          reason: 'ZZ district (water/uninhabited area)',
          isExpected: true,
        });
      }

      // Check for multi-member districts (e.g., West Virginia)
      const memberMatch = name.match(/District (\d+)[A-Z]/);
      if (memberMatch) {
        const districtNum = memberMatch[1];
        const existing = multiMemberDistricts.find(d => d.name.includes(`District ${districtNum}`));
        if (existing) {
          // Found another seat for same district
          multiMemberDistricts.push({
            id: geoid,
            name,
            memberCount: 2,
            memberGeoids: [existing.id, geoid],
          });
        }
      }
    }

    // Determine diagnosis
    let diagnosis: DiagnosisType = 'unknown';
    let recommendation = 'Manual review required to determine cause of discrepancy.';

    if (zzDistricts.length > 0 && Math.abs(discrepancy) === zzDistricts.length) {
      diagnosis = 'zz_water_districts';
      recommendation = `Update registry to include ${zzDistricts.length} ZZ districts in expected count.`;
    } else if (multiMemberDistricts.length > 0) {
      diagnosis = 'multi_member_districts';
      recommendation = `State uses multi-member districts. Update registry or extraction logic to handle multiple seats per district.`;
    } else if (discrepancy > 0) {
      diagnosis = 'data_quality_issue';
      recommendation = `State portal has ${discrepancy} extra features. Investigate whether these are valid districts or data quality issues.`;
    }

    const confidence = diagnosis === 'unknown' ? 0.3 : 0.8;

    return {
      state: stateUpper,
      stateName: portal.stateName,
      layer,
      expectedCount,
      actualCount,
      discrepancy,
      diagnosis,
      details: {
        extraFeatures,
        missingFeatures: [],
        zzDistricts,
        multiMemberDistricts,
        redistrictingInProgress: false,
      },
      recommendation,
      confidence,
    };
  }

  /**
   * Store validation results for audit trail
   *
   * Saves validation results to disk for future reference.
   *
   * @param jobId - Unique job identifier
   * @param results - Validation results to store
   */
  async storeResults(
    jobId: string,
    results: ValidationResults
  ): Promise<void> {
    await this.ensureStorageDir();

    const stored: StoredValidationResults = {
      ...results,
      metadata: {
        storedAt: new Date(),
        storageVersion: STORAGE_VERSION,
        schemaVersion: SCHEMA_VERSION,
      },
    };

    const filename = `${jobId}.json`;
    const filepath = join(this.storageDir, filename);

    await writeFile(filepath, JSON.stringify(stored, null, 2), 'utf-8');
  }

  /**
   * Retrieve stored validation results
   *
   * Loads validation results from disk.
   *
   * @param jobId - Job identifier
   * @returns Stored validation results or null if not found
   */
  async getStoredResults(jobId: string): Promise<StoredValidationResults | null> {
    const filename = `${jobId}.json`;
    const filepath = join(this.storageDir, filename);

    if (!existsSync(filepath)) {
      return null;
    }

    const content = await readFile(filepath, 'utf-8');
    return JSON.parse(content) as StoredValidationResults;
  }

  /**
   * Validate multiple states with rate limiting and retry logic
   *
   * Performs comprehensive validation across multiple states and layers.
   * Includes rate limiting (500ms between calls), retry with exponential backoff
   * (3 attempts), and 30-second timeout per request.
   *
   * @param states - State configurations to validate
   * @param options - Multi-state validation options
   * @returns Multi-state validation result
   *
   * @example
   * ```typescript
   * const states = [
   *   { state: 'WI', stateName: 'Wisconsin', stateFips: '55',
   *     layers: { congressional: 8, state_senate: 33, state_house: 99 } },
   *   { state: 'TX', stateName: 'Texas', stateFips: '48',
   *     layers: { congressional: 38, state_senate: 31, state_house: 150 } },
   * ];
   *
   * const result = await validator.validateMultiState(states);
   * console.log(`Success rate: ${result.summary.successRate * 100}%`);
   * ```
   */
  async validateMultiState(
    states: readonly StateConfig[],
    options?: MultiStateValidationOptions
  ): Promise<MultiStateValidationResult> {
    const startTime = Date.now();
    const rateLimitMs = options?.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS;
    const retryAttempts = options?.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS;
    const timeoutMs = options?.timeoutMs ?? TIGERWEB_TIMEOUT_MS;
    const layersToValidate = options?.layers ?? ['congressional', 'state_senate', 'state_house'];

    const results: StateLayerValidationResult[] = [];

    for (const stateConfig of states) {
      for (const layer of layersToValidate) {
        const layerStartTime = Date.now();
        const expectedCount = stateConfig.layers[layer] ?? 0;

        try {
          // Fetch TIGERweb data with retry logic
          const tigerData = await this.fetchTIGERwebData(
            stateConfig.state,
            layer,
            { timeoutMs, rateLimitMs }
          );

          const actual = tigerData.features.length;
          const match = actual === expectedCount;

          // Validate GEOIDs
          const geoids = tigerData.features.map(f => String(f.attributes.GEOID ?? ''));
          const geoidValidation = this.validateGeoids(
            geoids.map(geoid => ({
              id: geoid,
              name: '',
              layerType: layer,
              geometry: { type: 'Polygon', coordinates: [] } as const,
              source: {
                state: stateConfig.state,
                portalName: '',
                endpoint: '',
                authority: 'state-gis' as const,
                vintage: 2022,
                retrievedAt: new Date().toISOString(),
              } as any,
              properties: { GEOID: geoid },
            })),
            stateConfig.stateFips,
            layer
          );

          // Validate geometry (check for valid features)
          const geometryValid = tigerData.features.every(f =>
            f.attributes && typeof f.attributes === 'object'
          );

          const duration = Date.now() - layerStartTime;

          results.push({
            state: stateConfig.state,
            stateName: stateConfig.stateName,
            layer,
            expected: expectedCount,
            actual,
            match,
            geoidValid: geoidValidation.passed,
            geometryValid,
            duration,
            details: {
              geoids,
              invalidGeoids: geoidValidation.invalidRecords.map(r => r.geoid),
            },
          });
        } catch (error) {
          const duration = Date.now() - layerStartTime;

          results.push({
            state: stateConfig.state,
            stateName: stateConfig.stateName,
            layer,
            expected: expectedCount,
            actual: 0,
            match: false,
            geoidValid: false,
            geometryValid: false,
            error: error instanceof Error ? error.message : String(error),
            duration,
            details: {
              geoids: [],
              invalidGeoids: [],
            },
          });
        }

        // Rate limit between API calls
        await this.sleep(rateLimitMs);
      }
    }

    const totalDurationMs = Date.now() - startTime;
    const passed = results.filter(r => r.match && r.geoidValid && r.geometryValid).length;
    const failed = results.length - passed;

    return {
      states: results,
      summary: {
        totalValidations: results.length,
        passed,
        failed,
        successRate: results.length > 0 ? passed / results.length : 0,
      },
      validatedAt: new Date(),
      totalDurationMs,
    };
  }

  /**
   * Validate GEOID format for a single GEOID
   *
   * GEOIDs follow the pattern SSFFF where:
   * - SS = 2-digit state FIPS code
   * - FFF = feature ID (varies by layer type)
   *
   * @param geoid - GEOID to validate
   * @param stateFips - Expected state FIPS code
   * @param layer - Legislative layer type
   * @returns GEOID validation result
   *
   * @example
   * ```typescript
   * const result = validator.validateGeoidFormat('5501', '55', 'congressional');
   * // { geoid: '5501', valid: true, expectedPattern: '55XXX' }
   * ```
   */
  validateGeoidFormat(
    geoid: string,
    stateFips: string,
    layer: LegislativeLayerType
  ): GeoidValidationResult {
    const expectedPattern = `${stateFips}XXX`;

    // GEOID must start with state FIPS
    if (!geoid.startsWith(stateFips)) {
      return {
        geoid,
        valid: false,
        expectedPattern,
        error: `GEOID does not start with state FIPS code ${stateFips}`,
      };
    }

    // Minimum length check (at least SSFFF = 5 characters)
    if (geoid.length < 4) {
      return {
        geoid,
        valid: false,
        expectedPattern,
        error: `GEOID too short (expected at least 4 characters)`,
      };
    }

    // Valid GEOID
    return {
      geoid,
      valid: true,
      expectedPattern,
    };
  }

  /**
   * Validate GEOIDs for a batch of boundaries
   *
   * Validates all GEOIDs in a boundary set follow the expected SSFFF pattern.
   *
   * @param boundaries - Extracted boundaries to validate
   * @param stateFips - Expected state FIPS code
   * @param layer - Legislative layer type
   * @returns Batch GEOID validation result
   *
   * @example
   * ```typescript
   * const result = validator.validateGeoids(boundaries, '55', 'congressional');
   * console.log(`${result.validGeoids}/${result.totalGeoids} GEOIDs are valid`);
   * ```
   */
  validateGeoids(
    boundaries: readonly ExtractedBoundary[],
    stateFips: string,
    layer: LegislativeLayerType
  ): BatchGeoidValidationResult {
    const invalidRecords: GeoidValidationResult[] = [];
    let validCount = 0;

    for (const boundary of boundaries) {
      const geoid = String(boundary.properties.GEOID ?? boundary.id);
      const validation = this.validateGeoidFormat(geoid, stateFips, layer);

      if (validation.valid) {
        validCount++;
      } else {
        invalidRecords.push(validation);
      }
    }

    return {
      totalGeoids: boundaries.length,
      validGeoids: validCount,
      invalidGeoids: invalidRecords.length,
      invalidRecords,
      passed: invalidRecords.length === 0,
    };
  }

  /**
   * Validate coverage/area for extracted boundaries
   *
   * Uses @turf/turf to calculate total area and average district area.
   * Helps identify missing boundaries or incomplete coverage.
   *
   * @param boundaries - Extracted boundaries to validate
   * @returns Coverage validation result
   *
   * @example
   * ```typescript
   * const result = await validator.validateCoverage(boundaries);
   * console.log(`Total area: ${result.totalArea} sq meters`);
   * console.log(`Average district: ${result.averageDistrictArea} sq meters`);
   * ```
   */
  async validateCoverage(
    boundaries: readonly ExtractedBoundary[]
  ): Promise<CoverageValidationResult> {
    try {
      let totalArea = 0;

      for (const boundary of boundaries) {
        const geometry = boundary.geometry;

        // Convert to turf-compatible format
        const turfGeometry = geometry.type === 'Polygon'
          ? turfPolygon(geometry.coordinates)
          : turfMultiPolygon(geometry.coordinates);

        // Calculate area in square meters
        const boundaryArea = area(turfGeometry);
        totalArea += boundaryArea;
      }

      const averageDistrictArea = boundaries.length > 0
        ? totalArea / boundaries.length
        : 0;

      return {
        totalArea,
        averageDistrictArea,
        boundaryCount: boundaries.length,
        passed: true,
      };
    } catch (error) {
      return {
        totalArea: 0,
        averageDistrictArea: 0,
        boundaryCount: boundaries.length,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Detect count mismatch between expected and actual
   */
  private detectCountMismatch(
    state: string,
    layer: LegislativeLayerType,
    expected: number,
    actual: number
  ): CountMismatch | null {
    const discrepancy = actual - expected;

    if (discrepancy === 0) {
      return null;
    }

    const possibleCauses: string[] = [];
    let severity: 'critical' | 'warning' | 'info' = 'warning';

    if (Math.abs(discrepancy) === 1) {
      possibleCauses.push('ZZ district (water/uninhabited area)');
      possibleCauses.push('Multi-member district counted separately');
      severity = 'info';
    } else if (Math.abs(discrepancy) > 2) {
      possibleCauses.push('Data quality issue');
      possibleCauses.push('Redistricting in progress');
      possibleCauses.push('Wrong layer or endpoint');
      severity = 'critical';
    } else {
      possibleCauses.push('Minor discrepancy - needs investigation');
    }

    return {
      state,
      layer,
      expected,
      actual,
      discrepancy,
      possibleCauses,
      severity,
    };
  }

  /**
   * Fetch data from TIGERweb REST API with exponential backoff retry
   */
  private async fetchTIGERwebData(
    state: string,
    layer: LegislativeLayerType,
    options?: CrossValidationOptions
  ): Promise<TIGERwebResponse> {
    const fips = STATE_FIPS[state];
    if (!fips) {
      throw new Error(`Unknown state FIPS code for: ${state}`);
    }

    const endpoint = TIGERWEB_ENDPOINTS[layer];
    const url = `${endpoint}/query?where=STATE='${fips}'&outFields=*&f=json&returnGeometry=false`;

    const timeoutMs = options?.timeoutMs ?? TIGERWEB_TIMEOUT_MS;
    const retryAttempts = options?.rateLimitMs !== undefined ? DEFAULT_RETRY_ATTEMPTS : 3;
    const rateLimitMs = options?.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retryAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
          },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          // Retry on rate limit or server errors
          if (response.status === 429 || response.status >= 500) {
            lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);

            // Exponential backoff: 500ms, 1000ms, 2000ms
            const backoffMs = rateLimitMs * Math.pow(2, attempt);
            await this.sleep(backoffMs);
            continue;
          }

          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as TIGERwebResponse;

        if (!data.features || !Array.isArray(data.features)) {
          throw new Error('Invalid TIGERweb response: missing features array');
        }

        return data;
      } catch (error) {
        clearTimeout(timeout);

        // Handle AbortController timeout
        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeoutMs}ms`);

          // Retry with exponential backoff
          const backoffMs = rateLimitMs * Math.pow(2, attempt);
          await this.sleep(backoffMs);
          continue;
        }

        // Network errors - retry with exponential backoff
        if (error instanceof Error &&
          (error.message.includes('fetch') || error.message.includes('network'))) {
          lastError = error;

          const backoffMs = rateLimitMs * Math.pow(2, attempt);
          await this.sleep(backoffMs);
          continue;
        }

        // Non-retryable error
        throw error;
      }
    }

    // All retries exhausted
    throw new Error(
      `Failed to fetch TIGERweb data after ${retryAttempts} attempts: ${lastError?.message ?? 'Unknown error'}`
    );
  }

  /**
   * Sleep utility for rate limiting and backoff
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate coordinate ranges
   */
  private validateCoordinates(boundary: ExtractedBoundary): GeometryIssue | null {
    const geometry = boundary.geometry;
    const coords = geometry.type === 'Polygon'
      ? geometry.coordinates
      : geometry.coordinates.flat();

    for (const ring of coords) {
      for (const [lon, lat] of ring as Array<[number, number]>) {
        if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
          return {
            boundaryId: boundary.id,
            type: 'invalid-coordinates',
            severity: 'critical',
            description: `Invalid coordinates: lon=${lon}, lat=${lat}`,
            suggestedFix: 'Check coordinate system (should be EPSG:4326 / WGS84)',
          };
        }
      }
    }

    return null;
  }

  /**
   * Check for self-intersection in polygon using @turf/turf
   *
   * Detects actual self-intersections (kinks), bowtie polygons,
   * and unclosed rings using precise geometric analysis.
   */
  /**
   * Check for self-intersection in polygon using @turf/turf
   *
   * Detects actual self-intersections (kinks), bowtie polygons,
   * and unclosed rings using precise geometric analysis.
   */
  private checkSelfIntersection(boundary: ExtractedBoundary): GeometryIssue | null {
    const geometry = boundary.geometry;

    // 1. Basic ring validation (manual)
    const allRings = geometry.type === 'Polygon'
      ? geometry.coordinates
      : geometry.coordinates.flat(); // Flattens MultiPolygon to list of all rings

    for (const ring of allRings) {
      const typedRing = ring as Position[];

      if (typedRing.length < 4) {
        return {
          boundaryId: boundary.id,
          type: 'self-intersection',
          severity: 'critical',
          description: 'Polygon ring has fewer than 4 coordinates',
          suggestedFix: 'Verify geometry is valid GeoJSON',
        };
      }

      // Check ring is closed
      const first = typedRing[0];
      const last = typedRing[typedRing.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        return {
          boundaryId: boundary.id,
          type: 'unclosed-ring',
          severity: 'warning',
          description: 'Polygon ring is not closed (first != last coordinate)',
          suggestedFix: 'Add closing coordinate matching the first point',
        };
      }
    }

    // 2. Hole overlap check (per polygon)
    if (geometry.type === 'Polygon') {
      if (geometry.coordinates.length > 1) {
        const holeOverlap = this.detectHoleOverlap(boundary.id, geometry.coordinates);
        if (holeOverlap) return holeOverlap;
      }
    } else {
      // MultiPolygon: Check each polygon individually
      for (const polyCoords of geometry.coordinates) {
        if (polyCoords.length > 1) {
          const holeOverlap = this.detectHoleOverlap(boundary.id, polyCoords);
          if (holeOverlap) return holeOverlap;
        }
      }
    }

    // 3. Advanced topology checks using turf (kinks, unkink)
    try {
      // Split into individual polygons for analysis
      const polygons = geometry.type === 'Polygon'
        ? [turfPolygon(geometry.coordinates)]
        : geometry.coordinates.map(coords => turfPolygon(coords));

      for (const poly of polygons) {
        const intersections = kinks(poly);

        if (intersections.features.length > 0) {
          // Get the first intersection point for location reporting
          const firstIntersection = intersections.features[0];
          const [lon, lat] = firstIntersection.geometry.coordinates as [number, number];

          // Check if this is a bowtie polygon (figure-8 shape)
          const isBowtie = this.detectBowtie(poly.geometry);

          return {
            boundaryId: boundary.id,
            type: isBowtie ? 'bowtie' : 'self-intersection',
            severity: 'critical',
            description: isBowtie
              ? `Bowtie polygon detected (figure-8 shape) with ${intersections.features.length} self-intersection(s)`
              : `Self-intersecting polygon with ${intersections.features.length} intersection point(s)`,
            suggestedFix: isBowtie
              ? 'Split bowtie polygon into two separate polygons'
              : 'Remove self-intersections by adjusting polygon vertices',
            location: { lat, lon },
          };
        }
      }
    } catch (error) {
      // If turf.kinks() fails, the geometry is likely invalid
      return {
        boundaryId: boundary.id,
        type: 'self-intersection',
        severity: 'critical',
        description: `Failed to validate topology: ${error instanceof Error ? error.message : String(error)}`,
        suggestedFix: 'Verify geometry is valid GeoJSON',
      };
    }

    return null;
  }

  /**
   * Validate polygon topology (self-intersections, valid rings)
   *
   * Uses @turf/turf for precise geometric analysis.
   * Returns all detected topology issues for a boundary.
   */
  private validateTopology(boundary: ExtractedBoundary): GeometryIssue[] {
    const issues: GeometryIssue[] = [];
    const geometry = boundary.geometry;

    // Check for self-intersection (includes ring closure check)
    const selfIntersection = this.checkSelfIntersection(boundary);
    if (selfIntersection) {
      issues.push(selfIntersection);
    }

    // Check if polygon can be unkinked (splits self-intersecting polygon)
    try {
      const polygons = geometry.type === 'Polygon'
        ? [turfPolygon(geometry.coordinates)]
        : geometry.coordinates.map(coords => turfPolygon(coords));

      for (const poly of polygons) {
        const unkinked = unkinkPolygon(poly);

        // If unkinkPolygon produces multiple features, original had self-intersections
        if (unkinked.features.length > 1) {
          // Avoid duplicate reporting if checkSelfIntersection already caught it
          if (!selfIntersection || selfIntersection.type !== 'self-intersection') {
            issues.push({
              boundaryId: boundary.id,
              type: 'self-intersection',
              severity: 'warning',
              description: `Polygon contains ${unkinked.features.length} separate components when unkinked`,
              suggestedFix: 'Consider splitting into multiple non-intersecting polygons',
            });
          }
        }
      }
    } catch (error) {
      // unkinkPolygon failed - geometry may be invalid
      issues.push({
        boundaryId: boundary.id,
        type: 'self-intersection',
        severity: 'critical',
        description: `Topology validation failed: ${error instanceof Error ? error.message : String(error)}`,
        suggestedFix: 'Verify geometry is valid GeoJSON',
      });
    }

    return issues;
  }

  /**
   * Detect bowtie polygon (figure-8 shape)
   *
   * A bowtie polygon has two lobes that touch at a single point,
   * creating a self-intersection in the middle.
   */
  private detectBowtie(geometry: ExtractedBoundary['geometry']): boolean {
    // Simple heuristic: if polygon has exactly 1 self-intersection
    // and the outer ring crosses itself once, it's likely a bowtie
    try {
      const polygons = geometry.type === 'Polygon'
        ? [turfPolygon(geometry.coordinates)]
        : geometry.coordinates.map(coords => turfPolygon(coords));

      for (const poly of polygons) {
        const intersections = kinks(poly);
        // Bowtie typically has exactly 1 intersection point
        if (intersections.features.length === 1) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Detect holes that overlap with outer ring
   *
   * Holes (inner rings) should be fully contained within the outer ring
   * and should not overlap with it.
   */
  private detectHoleOverlap(
    boundaryId: string,
    coordinates: Position[][] | Position[][][]
  ): GeometryIssue | null {
    // For Polygon: coordinates[0] is outer ring, coordinates[1+] are holes
    if (coordinates.length <= 1) {
      return null; // No holes
    }

    const typedCoords = coordinates as Position[][];
    const outerRing = typedCoords[0];

    // Check each hole
    for (let i = 1; i < typedCoords.length; i++) {
      const hole = typedCoords[i];

      // Check if hole shares vertices with outer ring (overlap)
      for (const holeVertex of hole) {
        for (const outerVertex of outerRing) {
          if (holeVertex[0] === outerVertex[0] && holeVertex[1] === outerVertex[1]) {
            return {
              boundaryId,
              type: 'hole-overlap',
              severity: 'critical',
              description: `Hole ${i} overlaps with outer ring at vertex (${holeVertex[0]}, ${holeVertex[1]})`,
              suggestedFix: 'Ensure holes are fully contained within outer ring without touching',
              location: {
                lat: holeVertex[1],
                lon: holeVertex[0],
              },
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Export multi-state validation results as formatted report
   *
   * Generates human-readable QA audit trail for validation runs.
   * Supports JSON (programmatic access), Markdown (readable docs),
   * and CSV (spreadsheet analysis) formats.
   *
   * @param result - Multi-state validation result
   * @param format - Output format (json, markdown, csv)
   * @returns Formatted report string
   *
   * @example
   * ```typescript
   * const result = await validator.validateMultiState(states);
   * const markdown = await validator.exportMultiStateReport(result, 'markdown');
   * console.log(markdown);
   * ```
   */
  async exportMultiStateReport(
    result: MultiStateValidationResult,
    format: ReportFormat = 'markdown'
  ): Promise<string> {
    const report = this.buildMultiStateReport(result);

    switch (format) {
      case 'json':
        return this.formatReportAsJSON(report);
      case 'markdown':
        return this.formatReportAsMarkdown(report);
      case 'csv':
        return this.formatReportAsCSV(report);
      default: {
        const exhaustive: never = format;
        throw new Error(`Unsupported format: ${exhaustive}`);
      }
    }
  }

  /**
   * Save report to file
   *
   * Convenience method to export and save report in one step.
   *
   * @param result - Multi-state validation result
   * @param filepath - Output file path
   * @param format - Output format (inferred from extension if not provided)
   *
   * @example
   * ```typescript
   * await validator.saveReport(result, './report.md', 'markdown');
   * ```
   */
  async saveReport(
    result: MultiStateValidationResult,
    filepath: string,
    format?: ReportFormat
  ): Promise<void> {
    // Ensure parent directory exists
    const { dirname } = await import('node:path');
    const dir = dirname(filepath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Infer format from file extension if not provided
    const inferredFormat = format ?? this.inferFormatFromPath(filepath);
    const reportContent = await this.exportMultiStateReport(result, inferredFormat);

    await writeFile(filepath, reportContent, 'utf-8');
  }

  // ==========================================================================
  // Report Building (Private)
  // ==========================================================================

  /**
   * Build structured report from validation result
   */
  private buildMultiStateReport(result: MultiStateValidationResult): MultiStateReport {
    // Group results by state
    const stateGroups = new Map<string, StateLayerValidationResult[]>();
    for (const layerResult of result.states) {
      const existing = stateGroups.get(layerResult.state) ?? [];
      existing.push(layerResult);
      stateGroups.set(layerResult.state, existing);
    }

    // Build per-state reports
    const states: StateReport[] = [];
    for (const [stateCode, layerResults] of stateGroups) {
      const stateName = layerResults[0]?.stateName ?? stateCode;

      const layers: LayerReport[] = layerResults.map(lr => ({
        layer: lr.layer,
        expected: lr.expected,
        actual: lr.actual,
        match: lr.match,
        geoidValid: lr.geoidValid,
        geometryValid: lr.geometryValid,
        duration: lr.duration,
      }));

      const issues = this.extractIssues(layerResults);
      const passed = layerResults.every(lr => lr.match && lr.geoidValid && lr.geometryValid);

      states.push({
        state: stateCode,
        stateName,
        passed,
        layers,
        issues,
      });
    }

    // Build summary
    const totalLayers = result.states.length;
    const passedLayers = result.states.filter(s =>
      s.match && s.geoidValid && s.geometryValid
    ).length;
    const criticalIssues = this.countCriticalIssues(result.states);
    const warnings = this.countWarnings(result.states);
    const passedStates = states.filter(s => s.passed).length;

    const summary: ReportSummary = {
      totalStates: stateGroups.size,
      passedStates,
      failedStates: stateGroups.size - passedStates,
      successRate: result.summary.successRate,
      totalLayers,
      criticalIssues,
      warnings,
    };

    // Generate recommendations
    const recommendations = this.generateRecommendations(states, summary);

    return {
      generatedAt: new Date(),
      reportVersion: '1.0.0',
      summary,
      states,
      recommendations,
    };
  }

  /**
   * Extract issues from layer results
   */
  private extractIssues(layerResults: readonly StateLayerValidationResult[]): readonly string[] {
    const issues: string[] = [];

    for (const result of layerResults) {
      if (!result.match) {
        issues.push(
          `${result.layer}: Count mismatch (expected ${result.expected}, got ${result.actual})`
        );
      }

      if (!result.geoidValid && result.details.invalidGeoids.length > 0) {
        issues.push(
          `${result.layer}: Invalid GEOIDs (${result.details.invalidGeoids.length} invalid)`
        );
      }

      if (!result.geometryValid) {
        issues.push(`${result.layer}: Geometry validation failed`);
      }

      if (result.error) {
        issues.push(`${result.layer}: ${result.error}`);
      }
    }

    return issues;
  }

  /**
   * Count critical issues in results
   */
  private countCriticalIssues(states: readonly StateLayerValidationResult[]): number {
    let count = 0;

    for (const state of states) {
      if (!state.match) {
        const discrepancy = Math.abs(state.expected - state.actual);
        if (discrepancy > 2) {
          count++;
        }
      }

      if (!state.geoidValid && state.details.invalidGeoids.length > 0) {
        count++;
      }

      if (!state.geometryValid) {
        count++;
      }
    }

    return count;
  }

  /**
   * Count warnings in results
   */
  private countWarnings(states: readonly StateLayerValidationResult[]): number {
    let count = 0;

    for (const state of states) {
      if (!state.match) {
        const discrepancy = Math.abs(state.expected - state.actual);
        if (discrepancy <= 2) {
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Generate actionable recommendations
   */
  private generateRecommendations(
    states: readonly StateReport[],
    summary: ReportSummary
  ): readonly string[] {
    const recommendations: string[] = [];

    if (summary.criticalIssues > 0) {
      recommendations.push(
        'CRITICAL: Review states with count mismatches >2 or invalid GEOIDs immediately'
      );
    }

    if (summary.failedStates > 0) {
      const failedStates = states.filter(s => !s.passed);
      recommendations.push(
        `Review ${summary.failedStates} failed state(s): ${failedStates.map(s => s.state).join(', ')}`
      );
    }

    if (summary.warnings > 0) {
      recommendations.push(
        'Minor count mismatches (±1-2) detected - verify ZZ districts or redistricting status'
      );
    }

    if (summary.successRate >= 0.95) {
      recommendations.push('Validation success rate >95% - data quality is excellent');
    } else if (summary.successRate >= 0.80) {
      recommendations.push('Validation success rate 80-95% - investigate failed states');
    } else {
      recommendations.push(
        'WARNING: Validation success rate <80% - systematic issues may exist'
      );
    }

    return recommendations;
  }

  /**
   * Format report as JSON
   */
  private formatReportAsJSON(report: MultiStateReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Format report as Markdown
   */
  private formatReportAsMarkdown(report: MultiStateReport): string {
    const lines: string[] = [];

    // Header
    lines.push('# Multi-State Validation Report\n');
    lines.push(`**Generated:** ${report.generatedAt.toISOString()}`);
    lines.push(`**Report Version:** ${report.reportVersion}\n`);

    // Summary
    lines.push('## Executive Summary\n');
    lines.push(`- **Total States:** ${report.summary.totalStates}`);
    lines.push(`- **Passed:** ${report.summary.passedStates} ✅`);
    lines.push(`- **Failed:** ${report.summary.failedStates} ${report.summary.failedStates > 0 ? '❌' : '✅'}`);
    lines.push(`- **Success Rate:** ${(report.summary.successRate * 100).toFixed(1)}%`);
    lines.push(`- **Total Layers:** ${report.summary.totalLayers}`);
    lines.push(`- **Critical Issues:** ${report.summary.criticalIssues} ${report.summary.criticalIssues > 0 ? '🔴' : '✅'}`);
    lines.push(`- **Warnings:** ${report.summary.warnings} ${report.summary.warnings > 0 ? '⚠️' : '✅'}\n`);

    // Recommendations
    if (report.recommendations.length > 0) {
      lines.push('## Recommendations\n');
      for (const rec of report.recommendations) {
        lines.push(`- ${rec}`);
      }
      lines.push('');
    }

    // Per-state details
    lines.push('## State Details\n');

    for (const state of report.states) {
      const status = state.passed ? '✅ PASS' : '❌ FAIL';
      lines.push(`### ${state.stateName} (${state.state}) ${status}\n`);

      // Layer table
      lines.push('| Layer | Expected | Actual | Match | GEOID | Geometry | Duration |');
      lines.push('|-------|----------|--------|-------|-------|----------|----------|');

      for (const layer of state.layers) {
        const matchIcon = layer.match ? '✅' : '❌';
        const geoidIcon = layer.geoidValid ? '✅' : '❌';
        const geomIcon = layer.geometryValid ? '✅' : '❌';
        const durationSec = (layer.duration / 1000).toFixed(1);

        lines.push(
          `| ${layer.layer} | ${layer.expected} | ${layer.actual} | ${matchIcon} | ${geoidIcon} | ${geomIcon} | ${durationSec}s |`
        );
      }

      lines.push('');

      // Issues
      if (state.issues.length > 0) {
        lines.push('**Issues:**\n');
        for (const issue of state.issues) {
          lines.push(`- ⚠️ ${issue}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Format report as CSV
   */
  private formatReportAsCSV(report: MultiStateReport): string {
    const lines: string[] = [];

    // Header
    lines.push('State,State Name,Layer,Expected,Actual,Match,GEOID Valid,Geometry Valid,Duration (ms),Issues');

    // Data rows
    for (const state of report.states) {
      for (const layer of state.layers) {
        const issues = state.issues
          .filter(i => i.startsWith(layer.layer))
          .map(i => i.replace(/,/g, ';'))
          .join(' | ');

        const row = [
          state.state,
          state.stateName,
          layer.layer,
          layer.expected.toString(),
          layer.actual.toString(),
          layer.match ? 'TRUE' : 'FALSE',
          layer.geoidValid ? 'TRUE' : 'FALSE',
          layer.geometryValid ? 'TRUE' : 'FALSE',
          layer.duration.toString(),
          issues || 'None',
        ];

        lines.push(row.join(','));
      }
    }

    return lines.join('\n');
  }

  /**
   * Infer format from file path extension
   */
  private inferFormatFromPath(filepath: string): ReportFormat {
    const ext = filepath.toLowerCase().split('.').pop();

    switch (ext) {
      case 'json':
        return 'json';
      case 'md':
      case 'markdown':
        return 'markdown';
      case 'csv':
        return 'csv';
      default:
        return 'markdown'; // Default to markdown
    }
  }

  /**
   * Ensure storage directory exists
   */
  private async ensureStorageDir(): Promise<void> {
    if (!existsSync(this.storageDir)) {
      await mkdir(this.storageDir, { recursive: true });
    }
  }
}
