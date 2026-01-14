/**
 * Cross-Validator - TIGER vs State GIS Portal Validation
 *
 * Validates consistency between Census TIGER/Line data and state GIS portals.
 * Detects discrepancies in district counts, GEOIDs, and boundary geometries.
 *
 * VALIDATION LAYERS:
 * 1. Count Matching: State and TIGER should report same number of districts
 * 2. ID Consistency: GEOIDs should match between sources (allowing format normalization)
 * 3. Geometry Overlap: Boundaries should be nearly identical (>95% IoU for civic infrastructure)
 * 4. Data Vintage: Post-2020 redistricting should use 2022+ data
 *
 * AUTHORITY HIERARCHY:
 * - State redistricting commissions authoritative during transition gaps (Jan-Jun of years ending in 2)
 * - TIGER authoritative after Census ingestion (typically September)
 * - Cross-validation builds confidence, doesn't automatically reject discrepancies
 *
 * USAGE:
 * ```typescript
 * const validator = new CrossValidator(tigerLoader, stateExtractor, {
 *   tolerancePercent: 0.1,
 *   requireBothSources: false,
 *   minOverlapPercent: 95,
 * });
 *
 * const result = await validator.validate('cd', '55', 2024);
 * console.log(`Quality Score: ${result.qualityScore}/100`);
 * ```
 */

import type { Polygon, MultiPolygon, Feature } from 'geojson';
import type { TIGERLayerType } from '../../core/types.js';
import type { ExtractedBoundary, LegislativeLayerType } from '../../providers/state-batch-extractor.js';
import {
  geometriesMatch,
  calculateArea,
  calculateCentroid,
  calculateCentroidDistance,
  type GeometryMatchResult,
} from '../utils/geometry-compare.js';
import { logger } from '../../core/utils/logger.js';

// ============================================================================
// Types - Re-exported from core/types/validators.ts to break circular dependencies
// ============================================================================

// Import and re-export types from canonical source in core/types
export type {
  ValidationIssueSeverity,
  ValidationIssue,
  GeometryMismatch,
  CrossValidationResult,
} from '../../core/types/validators.js';

// Import for local use
import type {
  ValidationIssueSeverity,
  ValidationIssue,
  GeometryMismatch,
  CrossValidationResult,
} from '../../core/types/validators.js';

/**
 * Cross-validation configuration
 */
export interface CrossValidationConfig {
  /** Geometry match tolerance (default: 0.1% = 99.9% similarity required) */
  readonly tolerancePercent: number;

  /** Fail validation if state source unavailable (default: false) */
  readonly requireBothSources: boolean;

  /** Minimum geometry overlap percentage (default: 95%) */
  readonly minOverlapPercent: number;
}

/**
 * Feature match result
 */
interface FeatureMatch {
  readonly tigerGeoid: string;
  readonly stateGeoid: string;
  readonly tigerGeometry: Polygon | MultiPolygon;
  readonly stateGeometry: Polygon | MultiPolygon;
  readonly tigerName: string;
  readonly stateName: string;
  readonly matchMethod: 'geoid' | 'centroid';
  readonly confidence: number;
}

/**
 * Boundary provider interface (minimal for cross-validation)
 */
export interface BoundaryProvider {
  downloadLayer(params: { layer: TIGERLayerType; stateFips: string }): Promise<unknown>;
  transform(files: unknown): Promise<ReadonlyArray<{
    id: string;
    name: string;
    geometry: Polygon | MultiPolygon;
    properties: Record<string, unknown>;
  }>>;
}

/**
 * State extractor interface (minimal for cross-validation)
 */
export interface StateExtractor {
  extractLayer(state: string, layerType: LegislativeLayerType): Promise<{
    success: boolean;
    boundaries: readonly ExtractedBoundary[];
    featureCount: number;
  }>;
}

// ============================================================================
// CrossValidator
// ============================================================================

/**
 * Cross-validator for TIGER vs State GIS portal data
 */
export class CrossValidator {
  private readonly config: CrossValidationConfig;

  constructor(
    private readonly tigerLoader: BoundaryProvider,
    private readonly stateExtractor: StateExtractor,
    config?: Partial<CrossValidationConfig>
  ) {
    this.config = {
      tolerancePercent: config?.tolerancePercent ?? 0.1,
      requireBothSources: config?.requireBothSources ?? false,
      minOverlapPercent: config?.minOverlapPercent ?? 95,
    };
  }

  /**
   * Validate TIGER vs state boundaries for a layer/state
   */
  async validate(
    layer: TIGERLayerType,
    stateFips: string,
    vintage: number
  ): Promise<CrossValidationResult> {
    const issues: ValidationIssue[] = [];

    // Map TIGER layer to state legislative layer type
    const stateLayerType = this.mapTigerToStateLayer(layer);
    if (!stateLayerType) {
      return this.emptyResult(layer, stateFips, issues, 'Unsupported layer type for cross-validation');
    }

    // Extract state boundaries
    let stateBoundaries: readonly ExtractedBoundary[] = [];
    let stateSuccess = false;

    try {
      const stateResult = await this.stateExtractor.extractLayer(
        this.fipsToStateAbbr(stateFips),
        stateLayerType
      );
      stateSuccess = stateResult.success;
      stateBoundaries = stateResult.boundaries;
    } catch (error) {
      const message = `Failed to extract state data: ${(error as Error).message}`;
      issues.push({
        severity: this.config.requireBothSources ? 'critical' : 'medium',
        category: 'count',
        message,
      });

      if (this.config.requireBothSources) {
        return this.emptyResult(layer, stateFips, issues, message);
      }
    }

    // Extract TIGER boundaries
    let tigerBoundaries: ReadonlyArray<{
      id: string;
      name: string;
      geometry: Polygon | MultiPolygon;
      properties: Record<string, unknown>;
    }> = [];

    try {
      const tigerFiles = await this.tigerLoader.downloadLayer({ layer, stateFips });
      const allBoundaries = await this.tigerLoader.transform(tigerFiles);
      tigerBoundaries = allBoundaries.filter(b => b.properties.stateFips === stateFips);
    } catch (error) {
      const message = `Failed to extract TIGER data: ${(error as Error).message}`;
      issues.push({
        severity: 'critical',
        category: 'count',
        message,
      });
      return this.emptyResult(layer, stateFips, issues, message);
    }

    // If state extraction failed, return partial result
    if (!stateSuccess || stateBoundaries.length === 0) {
      return {
        layer,
        state: stateFips,
        tigerCount: tigerBoundaries.length,
        stateCount: 0,
        matchedCount: 0,
        unmatchedTiger: tigerBoundaries.map(b => b.id),
        unmatchedState: [],
        geometryMismatches: [],
        qualityScore: 0,
        issues,
      };
    }

    // Match features
    const matches = this.matchFeatures(tigerBoundaries, stateBoundaries, stateFips);

    // Compare counts
    const tigerCount = tigerBoundaries.length;
    const stateCount = stateBoundaries.length;

    if (tigerCount !== stateCount) {
      issues.push({
        severity: Math.abs(tigerCount - stateCount) > 1 ? 'high' : 'medium',
        category: 'count',
        message: `Count mismatch: TIGER has ${tigerCount}, state has ${stateCount}`,
        details: { tigerCount, stateCount },
      });
    }

    // Find unmatched
    const matchedTigerIds = new Set(matches.map(m => m.tigerGeoid));
    const matchedStateIds = new Set(matches.map(m => m.stateGeoid));

    const unmatchedTiger = tigerBoundaries
      .filter(b => !matchedTigerIds.has(b.id))
      .map(b => b.id);

    const unmatchedState = stateBoundaries
      .filter(b => !matchedStateIds.has(b.id))
      .map(b => b.id);

    if (unmatchedTiger.length > 0) {
      issues.push({
        severity: 'medium',
        category: 'geoid',
        message: `${unmatchedTiger.length} boundaries only in TIGER`,
        details: { unmatchedTiger },
      });
    }

    if (unmatchedState.length > 0) {
      issues.push({
        severity: 'medium',
        category: 'geoid',
        message: `${unmatchedState.length} boundaries only in state`,
        details: { unmatchedState },
      });
    }

    // Compare geometries
    const geometryMismatches: GeometryMismatch[] = [];

    for (const match of matches) {
      const overlap = this.calculateOverlap(match.tigerGeometry, match.stateGeometry);
      const tigerArea = calculateArea(match.tigerGeometry);
      const stateArea = calculateArea(match.stateGeometry);
      const areaDifference = Math.abs((tigerArea - stateArea) / ((tigerArea + stateArea) / 2)) * 100;

      if (overlap < this.config.minOverlapPercent) {
        const severity = this.getGeometrySeverity(overlap);
        geometryMismatches.push({
          districtId: match.tigerGeoid,
          tigerArea,
          stateArea,
          areaDifference,
          overlapPercent: overlap,
          severity,
        });

        issues.push({
          severity,
          category: 'geometry',
          message: `Geometry mismatch for ${match.tigerGeoid}: ${overlap.toFixed(1)}% overlap`,
          details: {
            districtId: match.tigerGeoid,
            tigerName: match.tigerName,
            stateName: match.stateName,
            overlap,
            areaDifference,
          },
        });
      }
    }

    // Calculate quality score
    const qualityScore = this.calculateQualityScore(
      tigerCount,
      stateCount,
      matches.length,
      geometryMismatches.length
    );

    return {
      layer,
      state: stateFips,
      tigerCount,
      stateCount,
      matchedCount: matches.length,
      unmatchedTiger,
      unmatchedState,
      geometryMismatches,
      qualityScore,
      issues,
    };
  }

  /**
   * Batch validate multiple states
   */
  async validateBatch(
    layer: TIGERLayerType,
    stateFipsList: readonly string[],
    vintage: number
  ): Promise<readonly CrossValidationResult[]> {
    const results: CrossValidationResult[] = [];

    for (const stateFips of stateFipsList) {
      try {
        const result = await this.validate(layer, stateFips, vintage);
        results.push(result);
      } catch (error) {
        logger.error('Cross-validation failed for state', {
          stateFips,
          layer,
          error: (error as Error).message,
        });
        results.push(this.emptyResult(
          layer,
          stateFips,
          [{
            severity: 'critical',
            category: 'count',
            message: `Validation failed: ${(error as Error).message}`,
          }],
          `Validation failed: ${(error as Error).message}`
        ));
      }
    }

    return results;
  }

  /**
   * Calculate overlap percentage between two geometries
   */
  private calculateOverlap(
    tigerGeometry: Polygon | MultiPolygon,
    stateGeometry: Polygon | MultiPolygon
  ): number {
    const result = geometriesMatch(tigerGeometry, stateGeometry, this.config.tolerancePercent);
    return result.iou * 100;
  }

  /**
   * Match features between TIGER and state by ID or geometry
   */
  private matchFeatures(
    tigerFeatures: ReadonlyArray<{
      id: string;
      name: string;
      geometry: Polygon | MultiPolygon;
      properties: Record<string, unknown>;
    }>,
    stateFeatures: readonly ExtractedBoundary[],
    stateFips: string
  ): FeatureMatch[] {
    const matches: FeatureMatch[] = [];
    const matchedStateIds = new Set<string>();

    // First pass: Match by normalized GEOID
    for (const tigerFeature of tigerFeatures) {
      const normalizedTigerId = this.normalizeGeoid(tigerFeature.id, stateFips);

      for (const stateFeature of stateFeatures) {
        if (matchedStateIds.has(stateFeature.id)) {
          continue;
        }

        const normalizedStateId = this.normalizeGeoid(stateFeature.id, stateFips);

        if (normalizedTigerId === normalizedStateId) {
          matches.push({
            tigerGeoid: tigerFeature.id,
            stateGeoid: stateFeature.id,
            tigerGeometry: tigerFeature.geometry,
            stateGeometry: stateFeature.geometry,
            tigerName: tigerFeature.name,
            stateName: stateFeature.name,
            matchMethod: 'geoid',
            confidence: 1.0,
          });
          matchedStateIds.add(stateFeature.id);
          break;
        }
      }
    }

    // Second pass: Match by centroid proximity (for unmatched features)
    const unmatchedTiger = tigerFeatures.filter(
      t => !matches.find(m => m.tigerGeoid === t.id)
    );
    const unmatchedState = stateFeatures.filter(
      s => !matchedStateIds.has(s.id)
    );

    for (const tigerFeature of unmatchedTiger) {
      const tigerCentroid = calculateCentroid(tigerFeature.geometry);
      let closestMatch: { feature: ExtractedBoundary; distance: number } | null = null;

      for (const stateFeature of unmatchedState) {
        const stateCentroid = calculateCentroid(stateFeature.geometry);
        const distance = calculateCentroidDistance(tigerCentroid, stateCentroid);

        // Match if centroid within 5km (likely same district with slight boundary differences)
        if (distance < 5000 && (!closestMatch || distance < closestMatch.distance)) {
          closestMatch = { feature: stateFeature, distance };
        }
      }

      if (closestMatch) {
        const confidence = Math.max(0, 1 - (closestMatch.distance / 5000));
        matches.push({
          tigerGeoid: tigerFeature.id,
          stateGeoid: closestMatch.feature.id,
          tigerGeometry: tigerFeature.geometry,
          stateGeometry: closestMatch.feature.geometry,
          tigerName: tigerFeature.name,
          stateName: closestMatch.feature.name,
          matchMethod: 'centroid',
          confidence,
        });
        matchedStateIds.add(closestMatch.feature.id);

        // Remove from unmatchedState
        const index = unmatchedState.indexOf(closestMatch.feature);
        if (index > -1) {
          unmatchedState.splice(index, 1);
        }
      }
    }

    return matches;
  }

  /**
   * Normalize GEOID for comparison
   */
  private normalizeGeoid(geoid: string, stateFips: string): string {
    // Remove separators
    let normalized = geoid.replace(/[-_\s]/g, '').toUpperCase();

    // Ensure state FIPS prefix
    if (!normalized.startsWith(stateFips)) {
      const districtMatch = normalized.match(/\d+$/);
      if (districtMatch) {
        const districtNum = districtMatch[0].padStart(2, '0');
        normalized = `${stateFips}${districtNum}`;
      }
    }

    return normalized;
  }

  /**
   * Map TIGER layer to state legislative layer type
   */
  private mapTigerToStateLayer(layer: TIGERLayerType): LegislativeLayerType | null {
    switch (layer) {
      case 'cd':
        return 'congressional';
      case 'sldu':
        return 'state_senate';
      case 'sldl':
        return 'state_house';
      case 'county':
        return 'county';
      default:
        return null;
    }
  }

  /**
   * Convert FIPS code to state abbreviation
   */
  private fipsToStateAbbr(fips: string): string {
    const fipsMap: Record<string, string> = {
      '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
      '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
      '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
      '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
      '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
      '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
      '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
      '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
      '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
      '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
      '56': 'WY',
    };
    return fipsMap[fips] ?? 'UNKNOWN';
  }

  /**
   * Get geometry mismatch severity
   */
  private getGeometrySeverity(overlapPercent: number): ValidationIssueSeverity {
    if (overlapPercent >= 95) return 'low';
    if (overlapPercent >= 90) return 'medium';
    if (overlapPercent >= 80) return 'high';
    return 'critical';
  }

  /**
   * Calculate quality score (0-100)
   */
  private calculateQualityScore(
    tigerCount: number,
    stateCount: number,
    matchedCount: number,
    geometryMismatchCount: number
  ): number {
    // Count match score (40%)
    const countMatch = tigerCount === stateCount ? 40 : 0;

    // GEOID match score (30%)
    const maxCount = Math.max(tigerCount, stateCount, 1);
    const geoidMatchScore = (matchedCount / maxCount) * 30;

    // Geometry match score (30%)
    const geometryMatchScore = matchedCount > 0
      ? ((matchedCount - geometryMismatchCount) / matchedCount) * 30
      : 0;

    return Math.round(countMatch + geoidMatchScore + geometryMatchScore);
  }

  /**
   * Create empty result for failed validation
   */
  private emptyResult(
    layer: string,
    state: string,
    issues: ValidationIssue[],
    message: string
  ): CrossValidationResult {
    return {
      layer,
      state,
      tigerCount: 0,
      stateCount: 0,
      matchedCount: 0,
      unmatchedTiger: [],
      unmatchedState: [],
      geometryMismatches: [],
      qualityScore: 0,
      issues: [...issues, {
        severity: 'critical',
        category: 'count',
        message,
      }],
    };
  }
}
