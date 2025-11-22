/**
 * Transformation Validation Pipeline
 *
 * Validates raw scraped data against semantic, geographic, and district count rules.
 * Rejects voting precincts, canopy cover, and other false positives.
 *
 * ARCHITECTURE:
 * - Uses existing validators from validators/ (semantic, geographic)
 * - Adds district count validation
 * - Adds geometry quality validation
 * - Records rejection reasons for provenance
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';
import { SemanticLayerValidator } from '../validators/semantic-layer-validator.js';
import { EnhancedGeographicValidator } from '../validators/enhanced-geographic-validator.js';
import type {
  RawDataset,
  ValidationResult,
  ValidationContext,
  ValidationStats,
  ProvenanceMetadata,
} from './types.js';

/**
 * Known district counts for validation
 * Source: Census data, official city websites, verified registry
 */
const KNOWN_DISTRICT_COUNTS: Record<string, { count: number; source: string }> = {
  'USA/Hawaii/Honolulu': { count: 9, source: 'City Charter' },
  'USA/New York/New York': { count: 51, source: 'NYC Charter' },
  'USA/California/Los Angeles': { count: 15, source: 'LA City Charter' },
  'USA/Illinois/Chicago': { count: 50, source: 'Chicago City Code' },
  'USA/Texas/Houston': { count: 11, source: 'Houston City Charter' },
  'USA/Arizona/Phoenix': { count: 8, source: 'Phoenix City Charter' },
  'USA/Pennsylvania/Philadelphia': { count: 10, source: 'Philly Home Rule Charter' },
  'USA/Texas/San Antonio': { count: 10, source: 'San Antonio City Charter' },
  'USA/California/San Diego': { count: 9, source: 'San Diego Municipal Code' },
  'USA/Texas/Dallas': { count: 14, source: 'Dallas City Charter' },
  // Add more as we verify them
};

/**
 * Validator orchestrator
 *
 * Coordinates semantic, geographic, geometry, and district count validation
 */
export class TransformationValidator {
  private semanticValidator: SemanticLayerValidator;
  private geographicValidator: EnhancedGeographicValidator;

  constructor() {
    this.semanticValidator = new SemanticLayerValidator();
    this.geographicValidator = new EnhancedGeographicValidator();
  }

  /**
   * Validate a raw dataset
   *
   * DETERMINISTIC: Same input → same validation result
   *
   * @param dataset - Raw dataset from acquisition layer
   * @param context - Validation context (jurisdiction, expected counts)
   * @returns Validation result with detailed reasons
   */
  async validate(
    dataset: RawDataset,
    context: ValidationContext
  ): Promise<ValidationResult> {
    const issues: string[] = [];
    const warnings: string[] = [];
    let confidence = 100;

    // STEP 1: Semantic validation (reject wrong layer types)
    const semanticResult = this.validateSemantic(dataset);
    if (!semanticResult.valid) {
      return semanticResult;
    }
    confidence = Math.min(confidence, semanticResult.confidence);
    warnings.push(...semanticResult.warnings);

    // STEP 2: Geographic validation (reject wrong coordinates)
    const geographicResult = await this.validateGeographic(dataset, context);
    if (!geographicResult.valid) {
      return geographicResult;
    }
    confidence = Math.min(confidence, geographicResult.confidence);
    warnings.push(...geographicResult.warnings);

    // STEP 3: Geometry quality validation
    const geometryResult = this.validateGeometry(dataset);
    if (!geometryResult.valid) {
      return geometryResult;
    }
    confidence = Math.min(confidence, geometryResult.confidence);
    warnings.push(...geometryResult.warnings);

    // STEP 4: District count validation
    const countResult = this.validateDistrictCount(dataset, context);
    if (!countResult.valid) {
      return countResult;
    }
    confidence = Math.min(confidence, countResult.confidence);
    warnings.push(...countResult.warnings);

    // SUCCESS: All validations passed
    return {
      valid: true,
      confidence,
      issues: [],
      warnings,
    };
  }

  /**
   * Batch validate multiple datasets
   *
   * @param datasets - Array of raw datasets
   * @param context - Validation context
   * @returns Array of validation results + statistics
   */
  async validateBatch(
    datasets: readonly RawDataset[],
    context: ValidationContext
  ): Promise<{ results: ValidationResult[]; stats: ValidationStats }> {
    const results: ValidationResult[] = [];
    const rejectionReasons: Record<string, number> = {};
    let passed = 0;
    let rejected = 0;
    let warnings = 0;

    for (const dataset of datasets) {
      const result = await this.validate(dataset, context);
      results.push(result);

      if (result.valid) {
        passed++;
        if (result.warnings.length > 0) {
          warnings++;
        }
      } else {
        rejected++;
        // Track rejection reasons
        for (const issue of result.issues) {
          const reason = this.extractRejectionReason(issue);
          rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
        }
      }
    }

    return {
      results,
      stats: {
        total: datasets.length,
        passed,
        rejected,
        warnings,
        rejectionReasons,
      },
    };
  }

  /**
   * Semantic validation: Reject voting precincts, canopy cover, etc.
   */
  private validateSemantic(dataset: RawDataset): ValidationResult {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Extract layer name from provenance source
    const layerName = this.extractLayerName(dataset.provenance.source);

    // Score layer name
    const scoreResult = this.semanticValidator.scoreTitleOnly(layerName);

    if (scoreResult.score === 0) {
      // Rejected by negative keywords
      return {
        valid: false,
        confidence: 0,
        issues: [
          `Semantic validation failed: ${scoreResult.reasons.join('; ')}`,
          `Layer name: "${layerName}"`,
        ],
        warnings: [],
      };
    }

    if (scoreResult.score < 50) {
      // Low confidence, but not rejected
      warnings.push(
        `Low semantic confidence (${scoreResult.score}%): ${scoreResult.reasons.join('; ')}`
      );
      return {
        valid: true,
        confidence: scoreResult.score,
        issues: [],
        warnings,
      };
    }

    // High confidence
    return {
      valid: true,
      confidence: scoreResult.score,
      issues: [],
      warnings: [
        `Semantic validation passed (${scoreResult.score}%): ${scoreResult.reasons.join('; ')}`,
      ],
    };
  }

  /**
   * Geographic validation: Reject wrong coordinates, cross-city contamination
   */
  private async validateGeographic(
    dataset: RawDataset,
    context: ValidationContext
  ): Promise<ValidationResult> {
    // Extract state from jurisdiction
    const state = this.extractState(context.jurisdiction);
    const fips = this.extractFIPS(context.jurisdiction);

    if (!state) {
      return {
        valid: true,
        confidence: 70,
        issues: [],
        warnings: [`Unknown jurisdiction: ${context.jurisdiction} (cannot validate geography)`],
      };
    }

    // Use enhanced geographic validator
    const cityTarget = {
      name: context.jurisdiction,
      state,
      fips: fips || '0000000', // Fallback for missing FIPS
      region: state,
    };

    const result = await this.geographicValidator.validate(
      dataset.geojson,
      cityTarget
    );

    return result;
  }

  /**
   * Geometry quality validation: Reject degenerate polygons
   */
  private validateGeometry(dataset: RawDataset): ValidationResult {
    const issues: string[] = [];
    const warnings: string[] = [];
    const invalidFeatures: number[] = [];

    for (let i = 0; i < dataset.geojson.features.length; i++) {
      const feature = dataset.geojson.features[i];

      // Validate geometry type
      if (
        feature.geometry.type !== 'Polygon' &&
        feature.geometry.type !== 'MultiPolygon'
      ) {
        issues.push(`Feature ${i}: Invalid geometry type "${feature.geometry.type}"`);
        invalidFeatures.push(i);
        continue;
      }

      // Validate coordinate count
      const coords = this.extractCoordinates(feature);
      if (coords.length < 4) {
        issues.push(`Feature ${i}: Degenerate polygon (< 4 vertices)`);
        invalidFeatures.push(i);
        continue;
      }

      // Validate coordinate ranges (basic sanity check)
      for (const [lon, lat] of coords) {
        if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
          issues.push(`Feature ${i}: Invalid coordinates [${lon}, ${lat}]`);
          invalidFeatures.push(i);
          break;
        }
      }

      // Check for excessive vertex count (>10,000 = likely error)
      if (coords.length > 10000) {
        warnings.push(`Feature ${i}: Excessive vertex count (${coords.length})`);
      }
    }

    if (invalidFeatures.length > 0) {
      const invalidRatio = invalidFeatures.length / dataset.geojson.features.length;

      if (invalidRatio > 0.5) {
        // Majority invalid = REJECT
        return {
          valid: false,
          confidence: 0,
          issues: [
            `${invalidFeatures.length} of ${dataset.geojson.features.length} features have invalid geometry`,
            ...issues.slice(0, 3), // First 3 issues
          ],
          warnings: [],
        };
      } else {
        // Few invalid = WARNING
        return {
          valid: true,
          confidence: 70,
          issues: [],
          warnings: [
            `${invalidFeatures.length} features have geometry issues`,
            ...issues.slice(0, 3),
          ],
        };
      }
    }

    return {
      valid: true,
      confidence: 100,
      issues: [],
      warnings,
    };
  }

  /**
   * District count validation: Flag suspicious counts
   */
  private validateDistrictCount(
    dataset: RawDataset,
    context: ValidationContext
  ): ValidationResult {
    const discoveredCount = dataset.geojson.features.length;
    const warnings: string[] = [];

    // Check against known counts
    const known = KNOWN_DISTRICT_COUNTS[context.jurisdiction];
    if (known) {
      const tolerance = 2; // Allow ±2 districts for uncertainty
      const diff = Math.abs(discoveredCount - known.count);

      if (diff > tolerance) {
        return {
          valid: false,
          confidence: 0,
          issues: [
            `District count mismatch: expected ${known.count}, found ${discoveredCount} (diff: ${diff})`,
            `Source: ${known.source}`,
          ],
          warnings: [],
        };
      }

      warnings.push(
        `District count validated: ${discoveredCount} (expected ${known.count} ±${tolerance})`
      );
    }

    // Sanity check: Very few or very many districts
    if (discoveredCount < 3) {
      warnings.push(`Unusually low district count: ${discoveredCount} (possible at-large)`);
    }

    if (discoveredCount > 100) {
      return {
        valid: false,
        confidence: 0,
        issues: [
          `Unusually high district count: ${discoveredCount} (likely voting precincts, not council districts)`,
        ],
        warnings: [],
      };
    }

    return {
      valid: true,
      confidence: 100,
      issues: [],
      warnings,
    };
  }

  /**
   * Extract layer name from source URL
   */
  private extractLayerName(source: string): string {
    // Extract from ArcGIS REST URL
    if (source.includes('/MapServer/') || source.includes('/FeatureServer/')) {
      const parts = source.split('/');
      const layerIndex = parts.indexOf('MapServer') || parts.indexOf('FeatureServer');
      if (layerIndex > 0 && parts[layerIndex - 1]) {
        return parts[layerIndex - 1];
      }
    }

    // Extract from Socrata/CKAN
    if (source.includes('/dataset/') || source.includes('/resource/')) {
      const match = source.match(/\/([^\/]+)(?:\?|$)/);
      if (match?.[1]) {
        return match[1];
      }
    }

    // Fallback: Use last path segment
    const url = new URL(source);
    const segments = url.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || 'unknown';
  }

  /**
   * Extract state from jurisdiction string
   */
  private extractState(jurisdiction: string): string | null {
    // Format: "USA/State/City" or "State"
    const parts = jurisdiction.split('/');
    if (parts.length >= 2) {
      return parts[1]; // "USA/Hawaii/Honolulu" → "Hawaii"
    }
    return null;
  }

  /**
   * Extract FIPS code from jurisdiction (if encoded)
   */
  private extractFIPS(jurisdiction: string): string | null {
    // For now, return null (FIPS lookup requires external service)
    // TODO: Integrate FIPS lookup service
    return null;
  }

  /**
   * Extract coordinates from feature
   */
  private extractCoordinates(feature: Feature): Array<[number, number]> {
    const coords: Array<[number, number]> = [];

    if (feature.geometry.type === 'Polygon') {
      const polygon = feature.geometry as Polygon;
      for (const ring of polygon.coordinates) {
        coords.push(...ring);
      }
    } else if (feature.geometry.type === 'MultiPolygon') {
      const multiPolygon = feature.geometry as MultiPolygon;
      for (const polygon of multiPolygon.coordinates) {
        for (const ring of polygon) {
          coords.push(...ring);
        }
      }
    }

    return coords;
  }

  /**
   * Extract rejection reason from issue string
   */
  private extractRejectionReason(issue: string): string {
    // Extract first few words before colon or full sentence
    const match = issue.match(/^([^:]+):/);
    if (match) {
      return match[1].trim();
    }

    // Return first 50 characters
    return issue.slice(0, 50);
  }
}
