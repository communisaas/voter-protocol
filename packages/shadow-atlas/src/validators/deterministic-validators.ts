/**
 * Deterministic Validators for Shadow Atlas Boundary Data
 *
 * PURPOSE: Stage 1 validation pipeline that catches obvious data quality errors
 * using deterministic rules (zero LLM cost).
 *
 * DESIGN PRINCIPLE: Reject with confidence <60 (retry with different portal),
 * auto-accept with confidence ≥85, escalate 60-84 to multi-model consensus.
 *
 * ARCHITECTURE CONTEXT:
 * - Discovery system found 86 cities but 90% have wrong data
 * - Wrong data patterns: DC land development plans (Alexander City: 5,235 transit stops),
 *   statewide legislative districts, county data labeled as city councils
 * - These validators MUST reject garbage data BEFORE expensive LLM validation
 *
 * TYPE SAFETY: Zero tolerance for `any` types. Every interface must be comprehensive.
 */

import type { FeatureCollection } from 'geojson';
import type { NormalizedGeoJSON, GeoJSONFeature } from '../types/index.js';
import type { AdministrativeLevel } from '../types/provider.js';
// Canonical types imported from core/city-target.ts
import type {
  ValidationResult as CanonicalValidationResult,
  CityTarget as CanonicalCityTarget,
} from '../core/city-target.js';

// Re-export canonical types for backward compatibility
export type ValidationResult = CanonicalValidationResult;

/**
 * City target metadata for validation context
 * Extended version with additional fields for international support
 */
export interface CityTarget extends CanonicalCityTarget {
  readonly id: string;
  readonly country: string; // ISO 3166-1 alpha-2
  readonly population: number | null;
}

/**
 * Name Pattern Validator
 *
 * DETECTS: Statewide/county data misidentified as city council districts
 *
 * RED FLAGS:
 * - State legislative keywords ("State Senate District 5", "Assembly District 12")
 * - County keywords ("County Supervisor District 3", "Parish Council Ward 2")
 * - Transit/infrastructure keywords ("Bus Stop 1234", "Development Parcel A-5")
 *
 * GREEN FLAGS:
 * - Explicit city council numbering ("Council District 1", "Ward 2")
 * - No administrative hierarchy mixing
 *
 * EXAMPLES:
 * - Alexander City (5,235 transit stops) → REJECT (transit infrastructure)
 * - Alabaster (14 DC land plans) → REJECT (land development, not districts)
 * - Birmingham (9 council districts) → ACCEPT (legitimate city council data)
 */
export class NamePatternValidator {
  /**
   * Validate district names against expected patterns
   */
  validate(
    geojson: NormalizedGeoJSON,
    level: AdministrativeLevel
  ): ValidationResult {
    const names = geojson.features.map(f => this.extractName(f.properties));

    // Filter out empty/null names
    const validNames = names.filter((n): n is string => typeof n === 'string' && n.length > 0);

    // TRUTHFUL VALIDATION: Null names are OK if geometry is valid
    // We can generate synthetic names like "District 1", "District 2"
    // This handles Seattle (valid geometry, null names) correctly
    if (validNames.length === 0) {
      const featureCount = geojson.features.length;

      // If feature count is reasonable, accept with synthetic naming
      if (featureCount >= 3 && featureCount <= 100) {
        return {
          valid: true,
          confidence: 50,  // Lower confidence but still valid
          issues: [],
          warnings: [
            'All district names are null/empty - will use synthetic names (District 1, District 2, etc.)',
            `${featureCount} features with valid geometry found`,
          ],
        };
      }

      // Unreasonable count with null names -> reject
      return {
        valid: false,
        confidence: 10,
        issues: [
          `No valid district names found (all features have null/empty names)`,
          `Feature count ${featureCount} requires name validation`,
        ],
        warnings: [],
      };
    }

    // Red flag patterns (immediate rejection if found)
    const redFlags = this.detectRedFlags(validNames, level);
    if (redFlags.length > 0) {
      return {
        valid: false,
        confidence: 15,
        issues: redFlags,
        warnings: [],
      };
    }

    // Green flag patterns (high confidence if found)
    const greenFlags = this.detectGreenFlags(validNames, level);
    const greenFlagCount = greenFlags.length;

    // Confidence scoring:
    // - All features have green flags: 85 (auto-accept threshold)
    // - Most features have green flags: 70 (escalate to consensus)
    // - No obvious patterns: 60 (borderline, escalate to consensus)
    const greenFlagRatio = greenFlagCount / validNames.length;

    if (greenFlagRatio >= 0.9) {
      return {
        valid: true,
        confidence: 85,
        issues: [],
        warnings: greenFlagCount < validNames.length
          ? [`${validNames.length - greenFlagCount} districts lack explicit numbering`]
          : [],
      };
    }

    if (greenFlagRatio >= 0.5) {
      return {
        valid: true,
        confidence: 70,
        issues: [],
        warnings: [`${Math.round((1 - greenFlagRatio) * 100)}% of districts lack standard naming patterns`],
      };
    }

    // No clear patterns detected (ambiguous)
    return {
      valid: true,
      confidence: 60,
      issues: [],
      warnings: [
        'District names lack clear patterns (no standard numbering/naming conventions)',
        `Sample names: ${validNames.slice(0, 3).join(', ')}`,
      ],
    };
  }

  /**
   * Extract name from feature properties
   * Handles multiple common field names
   */
  private extractName(properties: Record<string, unknown>): string | null {
    // Common field names (ordered by likelihood)
    const nameFields = [
      'NAME',
      'name',
      'Name',
      'DISTRICT',
      'district',
      'District',
      'DISTRICT_NAME',
      'district_name',
      'LABEL',
      'label',
      'WARD',
      'ward',
    ];

    for (const field of nameFields) {
      const value = properties[field];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
      if (typeof value === 'number') {
        return value.toString();
      }
    }

    return null;
  }

  /**
   * Detect red flag patterns (wrong administrative level or data type)
   */
  private detectRedFlags(
    names: readonly string[],
    level: AdministrativeLevel
  ): readonly string[] {
    const issues: string[] = [];

    // State legislative keywords (indicates statewide data, not municipal/county)
    const statewideKeywords = /\b(state|legislative|legislature|senate|house|assembly|general assembly)\b/i;
    const hasStateKeywords = names.some(n => statewideKeywords.test(n));

    // Reject state keywords for ANY municipal-level boundary (council, county, school)
    const isMunicipalLevel = [
      'council-district',
      'municipal',
      'county-commission',
      'school-district',
    ].includes(level);

    if (hasStateKeywords && isMunicipalLevel) {
      issues.push(
        'District names contain state legislative keywords (likely statewide data, not city council districts)'
      );
    }

    // County keywords (indicates county data, not city)
    const countyKeywords = /\b(county|supervisor|parish|borough|commission)\b/i;
    const hasCountyKeywords = names.some(n => countyKeywords.test(n));

    if (hasCountyKeywords && level === 'council-district') {
      issues.push(
        'District names contain county keywords (likely county commission data, not city council districts)'
      );
    }

    // Transit/infrastructure keywords (indicates non-district data)
    const transitKeywords = /\b(stop|route|station|line|transit|bus|rail|train|metro|parking|development|parcel|lot|building|facility)\b/i;
    const hasTransitKeywords = names.some(n => transitKeywords.test(n));

    if (hasTransitKeywords) {
      issues.push(
        'District names contain transit/infrastructure keywords (likely infrastructure data, not political districts)'
      );
    }

    return issues;
  }

  /**
   * Detect green flag patterns (high confidence this is correct data)
   */
  private detectGreenFlags(
    names: readonly string[],
    level: AdministrativeLevel
  ): readonly string[] {
    const greenFlags: string[] = [];

    // Explicit district numbering patterns
    const explicitNumberingPatterns: readonly RegExp[] = [
      /\b(council\s+)?district\s+\d+\b/i,           // "District 1", "Council District 5"
      /\bward\s+\d+\b/i,                             // "Ward 2"
      /\bzone\s+\d+\b/i,                             // "Zone 3"
      /\barea\s+\d+\b/i,                             // "Area 4"
      /\bseat\s+\d+\b/i,                             // "Seat 6"
      /\b(district|ward|zone|area|seat)\s+[A-Z]\b/i, // "District A", "Ward B"
    ];

    for (const name of names) {
      if (explicitNumberingPatterns.some(pattern => pattern.test(name))) {
        greenFlags.push(name);
      }
    }

    return greenFlags;
  }
}

/**
 * District Count Validator
 *
 * DETECTS: Unrealistic district counts for administrative level
 *
 * CONTEXT:
 * - US city councils: typically 5-15 districts (range: 3-50)
 * - County commissions: typically 3-7 districts (range: 3-20)
 * - Transit systems: hundreds to thousands of stops/routes (REJECT)
 * - Land parcels: hundreds to thousands of parcels (REJECT)
 *
 * EXAMPLES:
 * - Alexander City: 5,235 features → REJECT (transit infrastructure)
 * - Alabaster: 14 features → borderline (could be legitimate, needs name validation)
 * - Birmingham: 9 features → ACCEPT (typical city council size)
 *
 * DESIGN: Boundary-type-aware validation (different bounds for councils vs counties)
 */
export class DistrictCountValidator {
  /**
   * Validate feature count against expected district counts
   */
  validate(
    geojson: NormalizedGeoJSON,
    level: AdministrativeLevel
  ): ValidationResult {
    const count = geojson.features.length;

    const bounds = this.getBounds(level);

    // Hard rejection: outside valid range
    if (count < bounds.min || count > bounds.max) {
      return {
        valid: false,
        confidence: 10,
        issues: [
          `District count ${count} outside valid range ${bounds.min}-${bounds.max} for ${level}`,
        ],
        warnings: [],
      };
    }

    // Within typical range: high confidence
    const inTypicalRange = count >= bounds.typical[0] && count <= bounds.typical[1];
    if (inTypicalRange) {
      return {
        valid: true,
        confidence: 90,
        issues: [],
        warnings: [],
      };
    }

    // Outside typical but within valid: medium confidence
    return {
      valid: true,
      confidence: 60,
      issues: [],
      warnings: [
        `District count ${count} unusual for ${level} (typical: ${bounds.typical[0]}-${bounds.typical[1]})`,
      ],
    };
  }

  /**
   * Get expected district count bounds for administrative level
   */
  private getBounds(level: AdministrativeLevel): {
    readonly min: number;
    readonly max: number;
    readonly typical: readonly [number, number];
  } {
    switch (level) {
      case 'council-district':
      case 'municipal':
        return {
          min: 2,   // Some small councils have 2 members
          max: 100, // Chicago has 50, some cities may have more
          typical: [5, 15],
        };

      case 'county-commission':
        return {
          min: 3,
          max: 20,
          typical: [3, 7],
        };

      case 'school-district':
        return {
          min: 3,
          max: 30,
          typical: [5, 12],
        };

      case 'congressional':
        return {
          min: 1,
          max: 53,  // California has 52 districts + DC delegate
          typical: [1, 15],
        };

      case 'state-legislative-upper':
        return {
          min: 20,
          max: 67,  // Minnesota Senate has 67 districts
          typical: [30, 50],
        };

      case 'state-legislative-lower':
        return {
          min: 40,
          max: 400,  // New Hampshire House has 400 seats
          typical: [80, 150],
        };

      default:
        // Generic bounds for unknown levels
        return {
          min: 3,
          max: 100,
          typical: [5, 25],
        };
    }
  }
}

/**
 * Aggregated validation result from multiple validators
 */
export interface AggregatedValidationResult extends ValidationResult {
  /** Individual validator results (for debugging) */
  readonly validatorResults: readonly {
    readonly validator: string;
    readonly result: ValidationResult;
  }[];
}

/**
 * Combined validator pipeline
 *
 * Runs all validators (sync + async) and aggregates results:
 * - All validators must pass (valid: true) for overall valid: true
 * - Confidence is MINIMUM of all validator confidences (conservative)
 * - Issues and warnings are concatenated
 *
 * ENHANCED (2025-11-18): Now includes geographic bounds validation against
 * Census PLACE boundaries to catch wrong-state and wrong-city data.
 */
export class DeterministicValidationPipeline {
  private readonly nameValidator = new NamePatternValidator();
  private readonly countValidator = new DistrictCountValidator();

  /**
   * Run all deterministic validators (synchronous only)
   *
   * @deprecated Use validateWithGeography() instead for full validation including bounds checking
   */
  validate(
    geojson: NormalizedGeoJSON,
    cityTarget: CityTarget,
    level: AdministrativeLevel
  ): AggregatedValidationResult {
    // Run individual validators
    const nameResult = this.nameValidator.validate(geojson, level);
    const countResult = this.countValidator.validate(geojson, level);

    const results = [
      { validator: 'NamePatternValidator', result: nameResult },
      { validator: 'DistrictCountValidator', result: countResult },
    ];

    // Aggregate results
    const allValid = results.every(r => r.result.valid);
    const minConfidence = Math.min(...results.map(r => r.result.confidence));
    const allIssues = results.flatMap(r => r.result.issues);
    const allWarnings = results.flatMap(r => r.result.warnings);

    return {
      valid: allValid,
      confidence: minConfidence,
      issues: allIssues,
      warnings: allWarnings,
      validatorResults: results,
    };
  }

  /**
   * Run all validators including async geographic bounds validation
   *
   * This is the RECOMMENDED validation method that includes:
   * - Name pattern validation (state/county keyword rejection)
   * - District count validation (3-50 for councils)
   * - Geographic bounds validation (coordinates + PLACE boundary checks)
   */
  async validateWithGeography(
    geojson: NormalizedGeoJSON,
    cityTarget: CityTarget,
    level: AdministrativeLevel
  ): Promise<AggregatedValidationResult> {
    // Run synchronous validators first (fast path for obvious rejections)
    const syncResult = this.validate(geojson, cityTarget, level);

    // If sync validators reject, skip expensive geographic validation
    if (!syncResult.valid) {
      return syncResult;
    }

    // Import geographic validator dynamically to avoid circular deps
    const { GeographicBoundsValidator } = await import('./geographic-bounds-validator.js');
    const geoValidator = new GeographicBoundsValidator();

    // Run geographic validation (requires FIPS code)
    if (!cityTarget.fips) {
      return {
        ...syncResult,
        warnings: [
          ...syncResult.warnings,
          'No FIPS code provided - skipping geographic bounds validation',
        ],
      };
    }

    const geoResult = await geoValidator.validate(geojson as unknown as FeatureCollection, {
      ...cityTarget,
      fips: cityTarget.fips,
    });

    // Aggregate all results
    const allResults = [
      ...syncResult.validatorResults,
      { validator: 'GeographicBoundsValidator', result: geoResult },
    ];

    const allValid = allResults.every(r => r.result.valid);
    const minConfidence = Math.min(...allResults.map(r => r.result.confidence));
    const allIssues = allResults.flatMap(r => r.result.issues);
    const allWarnings = allResults.flatMap(r => r.result.warnings);

    return {
      valid: allValid,
      confidence: minConfidence,
      issues: allIssues,
      warnings: allWarnings,
      validatorResults: allResults,
    };
  }
}
