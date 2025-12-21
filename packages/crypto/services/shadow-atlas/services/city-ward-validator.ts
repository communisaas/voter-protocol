/**
 * CityWardValidator - Validation service for city ward extractions
 *
 * Consolidates validation logic from validate-statewide-extraction.ts script
 * into a reusable, testable service with comprehensive type safety.
 *
 * ARCHITECTURE:
 * - Validates FIPS codes (7-digit Census PLACE codes)
 * - Validates ward counts (3-50 reasonable range)
 * - Validates GeoJSON geometry (Polygon/MultiPolygon)
 * - Detects duplicate cities and wards
 * - Checks unique ward identifiers
 * - Produces detailed error/warning reports
 *
 * TYPE SAFETY: Nuclear-level strictness. Zero `any`, zero `@ts-ignore`.
 * This is production infrastructure - type errors = invalid validation.
 *
 * @example
 * ```typescript
 * const validator = new CityWardValidator();
 *
 * // Validate entire state extraction
 * const result = validator.validateStateExtraction('WI', '/path/to/data');
 * if (!result.passed) {
 *   console.error(`Validation failed with ${result.errors.length} errors`);
 * }
 *
 * // Validate individual components
 * const fipsValid = validator.validateFipsCode('5553000');
 * const wardCountValid = validator.validateWardCount(7);
 * ```
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import type {
  CityWardValidationOptions,
  CityWardValidationResult,
  CityWardError,
  CityWardWarning,
  ExtractionSummary,
  CityRegistryEntry,
  FipsValidationResult,
  WardCountValidationResult,
  GeometryValidationResult,
  GeometryIssue,
  WardIdentifierValidationResult,
  SingleCityValidationResult,
  WardFeature,
  StateDirectoryStructure,
} from './city-ward-validator.types.js';

// ============================================================================
// Constants
// ============================================================================

/** Default minimum ward count */
const DEFAULT_MIN_WARD_COUNT = 3;

/** Default maximum ward count */
const DEFAULT_MAX_WARD_COUNT = 50;

/** FIPS code pattern (7 digits) */
const FIPS_PATTERN = /^\d{7}$/;

/** Low city count threshold (80% of expected) */
const LOW_CITY_COUNT_THRESHOLD = 0.8;

// ============================================================================
// CityWardValidator Service
// ============================================================================

/**
 * CityWardValidator - Production validation service for city ward data
 *
 * Consolidates scattered validation logic into unified, type-safe service.
 */
export class CityWardValidator {
  private readonly minWardCount: number;
  private readonly maxWardCount: number;

  constructor(options?: CityWardValidationOptions) {
    this.minWardCount = options?.minWardCount ?? DEFAULT_MIN_WARD_COUNT;
    this.maxWardCount = options?.maxWardCount ?? DEFAULT_MAX_WARD_COUNT;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Validate extraction directory
   *
   * Validates all GeoJSON files in a state extraction directory, loading files
   * from disk and cross-referencing extraction-summary.json and registry-entries.json.
   *
   * This method replicates the functionality of validate-statewide-extraction.ts script.
   *
   * @param stateDir - State directory path (e.g., "data/statewide-wards/WI")
   * @param options - Validation options
   * @returns Comprehensive validation result
   *
   * @example
   * ```typescript
   * const result = validator.validateExtractionDirectory('./data/statewide-wards/WI');
   * console.log(`Validated ${result.cityCount} cities`);
   * console.log(`Errors: ${result.errors.length}, Warnings: ${result.warnings.length}`);
   * ```
   */
  validateExtractionDirectory(
    stateDir: string,
    options?: CityWardValidationOptions
  ): CityWardValidationResult {
    const errors: CityWardError[] = [];
    const warnings: CityWardWarning[] = [];

    // Extract state code from directory path
    const stateCode = path.basename(stateDir).toUpperCase();

    // Get directory structure
    const citiesDir = path.join(stateDir, 'cities');
    const summaryPath = path.join(stateDir, 'extraction-summary.json');
    const registryPath = path.join(stateDir, 'registry-entries.json');

    // Check if directories exist
    if (!fs.existsSync(citiesDir)) {
      errors.push({
        city: 'N/A',
        fips: 'N/A',
        message: `Cities directory not found: ${citiesDir}`,
        severity: 'error',
        code: 'DIRECTORY_NOT_FOUND',
      });

      return {
        state: stateCode,
        cityCount: 0,
        passed: false,
        errors,
        warnings,
        validatedAt: new Date(),
      };
    }

    // Load extraction summary
    const extractionSummary = this.loadExtractionSummary(summaryPath);
    if (!extractionSummary) {
      warnings.push({
        city: 'N/A',
        fips: 'N/A',
        message: 'extraction-summary.json not found',
        severity: 'warning',
        code: 'MISSING_EXTRACTION_SUMMARY',
      });
    }

    // Load registry entries
    const registryEntries = this.loadRegistryEntries(registryPath);
    if (!registryEntries) {
      warnings.push({
        city: 'N/A',
        fips: 'N/A',
        message: 'registry-entries.json not found',
        severity: 'warning',
        code: 'MISSING_REGISTRY_ENTRIES',
      });
    }

    // Get all city files
    const cityFiles = this.getCityFiles(citiesDir);

    // Validate each city
    const fipsSet = new Set<string>();

    for (const cityFile of cityFiles) {
      const fips = cityFile.replace('.geojson', '');
      const cityPath = path.join(citiesDir, cityFile);
      const cityName = this.getCityName(fips, registryEntries);

      // Validate single city
      const cityResult = this.validateSingleCity(
        cityName,
        fips,
        cityPath,
        fipsSet,
        options
      );

      // Aggregate errors and warnings
      errors.push(...cityResult.errors);
      warnings.push(...cityResult.warnings);

      // Add FIPS to set for duplicate detection
      if (cityResult.fipsValidation.valid) {
        fipsSet.add(fips);
      }
    }

    // Validate city count
    if (extractionSummary) {
      const cityCountWarning = this.validateCityCount(
        cityFiles.length,
        extractionSummary.expectedCities
      );
      if (cityCountWarning) {
        warnings.push(cityCountWarning);
      }
    }

    const passed = errors.length === 0 && (options?.allowWarnings ?? true);

    return {
      state: stateCode,
      cityCount: cityFiles.length,
      passed,
      errors,
      warnings,
      validatedAt: new Date(),
      extractionSummary: extractionSummary ?? undefined,
      registryEntries: registryEntries ?? undefined,
    };
  }

  /**
   * Validate entire state extraction
   *
   * Validates all cities in a state directory, checking FIPS codes, ward counts,
   * geometry, and ward identifiers.
   *
   * @param state - State code (e.g., "WI")
   * @param dataDir - Data directory path (e.g., "data/statewide-wards")
   * @param options - Validation options
   * @returns Comprehensive validation result
   *
   * @example
   * ```typescript
   * const result = validator.validateStateExtraction('WI', './data/statewide-wards');
   * console.log(`Validated ${result.cityCount} cities`);
   * console.log(`Errors: ${result.errors.length}, Warnings: ${result.warnings.length}`);
   * ```
   */
  validateStateExtraction(
    state: string,
    dataDir: string,
    options?: CityWardValidationOptions
  ): CityWardValidationResult {
    const errors: CityWardError[] = [];
    const warnings: CityWardWarning[] = [];
    const stateUpper = state.toUpperCase();

    // Get directory structure
    const structure = this.getStateDirectoryStructure(stateUpper, dataDir);

    // Check if directories exist
    if (!structure.exists) {
      errors.push({
        city: 'N/A',
        fips: 'N/A',
        message: `Cities directory not found: ${structure.citiesDir}`,
        severity: 'error',
        code: 'DIRECTORY_NOT_FOUND',
      });

      return {
        state: stateUpper,
        cityCount: 0,
        passed: false,
        errors,
        warnings,
        validatedAt: new Date(),
      };
    }

    // Load extraction summary
    const extractionSummary = this.loadExtractionSummary(structure.summaryPath);
    if (!extractionSummary) {
      warnings.push({
        city: 'N/A',
        fips: 'N/A',
        message: 'extraction-summary.json not found',
        severity: 'warning',
        code: 'MISSING_EXTRACTION_SUMMARY',
      });
    }

    // Load registry entries
    const registryEntries = this.loadRegistryEntries(structure.registryPath);
    if (!registryEntries) {
      warnings.push({
        city: 'N/A',
        fips: 'N/A',
        message: 'registry-entries.json not found',
        severity: 'warning',
        code: 'MISSING_REGISTRY_ENTRIES',
      });
    }

    // Get all city files
    const cityFiles = this.getCityFiles(structure.citiesDir);

    // Validate each city
    const fipsSet = new Set<string>();

    for (const cityFile of cityFiles) {
      const fips = cityFile.replace('.geojson', '');
      const cityPath = path.join(structure.citiesDir, cityFile);
      const cityName = this.getCityName(fips, registryEntries);

      // Validate single city
      const cityResult = this.validateSingleCity(
        cityName,
        fips,
        cityPath,
        fipsSet,
        options
      );

      // Aggregate errors and warnings
      errors.push(...cityResult.errors);
      warnings.push(...cityResult.warnings);

      // Add FIPS to set for duplicate detection
      if (cityResult.fipsValidation.valid) {
        fipsSet.add(fips);
      }
    }

    // Validate city count
    if (extractionSummary) {
      const cityCountWarning = this.validateCityCount(
        cityFiles.length,
        extractionSummary.expectedCities
      );
      if (cityCountWarning) {
        warnings.push(cityCountWarning);
      }
    }

    const passed = errors.length === 0 && (options?.allowWarnings ?? true);

    return {
      state: stateUpper,
      cityCount: cityFiles.length,
      passed,
      errors,
      warnings,
      validatedAt: new Date(),
      extractionSummary: extractionSummary ?? undefined,
      registryEntries: registryEntries ?? undefined,
    };
  }

  /**
   * Validate FIPS code format
   *
   * FIPS codes must be exactly 7 digits (Census PLACE codes).
   *
   * @param fips - FIPS code to validate
   * @returns FIPS validation result
   *
   * @example
   * ```typescript
   * const result = validator.validateFipsCode('5553000');
   * // { fips: '5553000', valid: true }
   *
   * const invalid = validator.validateFipsCode('123');
   * // { fips: '123', valid: false, error: 'Invalid FIPS format...' }
   * ```
   */
  validateFipsCode(fips: string): FipsValidationResult {
    const valid = FIPS_PATTERN.test(fips);

    if (!valid) {
      return {
        fips,
        valid: false,
        error: `Invalid FIPS format: ${fips} (expected 7 digits)`,
      };
    }

    return { fips, valid: true };
  }

  /**
   * Validate ward count is reasonable
   *
   * Ward counts should typically be between 3 and 50.
   * Values outside this range trigger warnings.
   *
   * @param count - Ward count to validate
   * @returns Ward count validation result
   *
   * @example
   * ```typescript
   * const result = validator.validateWardCount(7);
   * // { count: 7, valid: true, reasonable: true, expectedRange: { min: 3, max: 50 } }
   *
   * const unusual = validator.validateWardCount(75);
   * // { count: 75, valid: true, reasonable: false, ... }
   * ```
   */
  validateWardCount(count: number): WardCountValidationResult {
    const reasonable = count >= this.minWardCount && count <= this.maxWardCount;

    return {
      count,
      valid: count > 0,
      reasonable,
      expectedRange: {
        min: this.minWardCount,
        max: this.maxWardCount,
      },
    };
  }

  /**
   * Validate GeoJSON geometry
   *
   * Checks for:
   * - Feature count > 0
   * - All features have geometries
   * - Geometry types are Polygon or MultiPolygon
   * - Coordinates arrays are not empty
   * - Polygon rings are closed (first == last)
   *
   * @param geojson - GeoJSON feature collection to validate
   * @returns Geometry validation result
   *
   * @example
   * ```typescript
   * const geojson = loadGeoJSON('city.geojson');
   * const result = validator.validateGeometry(geojson);
   * if (!result.valid) {
   *   console.error(`Geometry errors: ${result.error}`);
   * }
   * ```
   */
  validateGeometry(
    geojson: FeatureCollection<Polygon | MultiPolygon>
  ): GeometryValidationResult {
    const issues: GeometryIssue[] = [];

    // Check feature count
    if (geojson.features.length === 0) {
      return {
        valid: false,
        featureCount: 0,
        error: 'No features in GeoJSON',
        issues,
      };
    }

    // Validate each feature
    for (let i = 0; i < geojson.features.length; i++) {
      const feature = geojson.features[i];

      // Check geometry exists
      if (!feature.geometry) {
        issues.push({
          featureIndex: i,
          type: 'missing-geometry',
          description: `Feature ${i} has no geometry`,
        });
        continue;
      }

      // Check geometry type
      const geometryType = feature.geometry.type;
      if (geometryType !== 'Polygon' && geometryType !== 'MultiPolygon') {
        issues.push({
          featureIndex: i,
          type: 'invalid-type',
          description: `Feature ${i} has invalid geometry type: ${geometryType}`,
        });
        continue;
      }

      // Check coordinates exist
      if (!feature.geometry.coordinates || feature.geometry.coordinates.length === 0) {
        issues.push({
          featureIndex: i,
          type: 'empty-coordinates',
          description: `Feature ${i} has empty coordinates`,
        });
        continue;
      }

      // Check polygon rings are closed
      const ringIssue = this.validatePolygonRings(feature.geometry, i);
      if (ringIssue) {
        issues.push(ringIssue);
      }
    }

    const valid = issues.length === 0;
    const error = issues.length > 0 ? issues[0].description : undefined;

    return {
      valid,
      featureCount: geojson.features.length,
      error,
      issues,
    };
  }

  /**
   * Validate ward identifiers are unique
   *
   * Checks that all ward identifiers (WARD_NORMALIZED or WARD properties)
   * are unique within a city.
   *
   * @param features - GeoJSON features to validate
   * @returns Ward identifier validation result
   *
   * @example
   * ```typescript
   * const geojson = loadGeoJSON('city.geojson');
   * const result = validator.validateWardIdentifiers(geojson.features);
   * if (!result.valid) {
   *   console.error(`Duplicate wards: ${result.duplicates.join(', ')}`);
   * }
   * ```
   */
  validateWardIdentifiers(
    features: readonly WardFeature[]
  ): WardIdentifierValidationResult {
    const wardIds = new Map<string, number>();
    const duplicates = new Set<string>();

    for (const feature of features) {
      const wardId = this.extractWardIdentifier(feature);
      const count = wardIds.get(wardId) ?? 0;

      if (count > 0) {
        duplicates.add(wardId);
      }

      wardIds.set(wardId, count + 1);
    }

    return {
      valid: duplicates.size === 0,
      totalWards: features.length,
      uniqueWards: wardIds.size,
      duplicates: Array.from(duplicates),
    };
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Get state directory structure
   */
  private getStateDirectoryStructure(
    state: string,
    dataDir: string
  ): StateDirectoryStructure {
    const stateDir = path.join(dataDir, state);
    const citiesDir = path.join(stateDir, 'cities');
    const summaryPath = path.join(stateDir, 'extraction-summary.json');
    const registryPath = path.join(stateDir, 'registry-entries.json');
    const exists = fs.existsSync(citiesDir);

    return {
      stateDir,
      citiesDir,
      summaryPath,
      registryPath,
      exists,
    };
  }

  /**
   * Load extraction summary from JSON file
   */
  private loadExtractionSummary(summaryPath: string): ExtractionSummary | null {
    if (!fs.existsSync(summaryPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(summaryPath, 'utf-8');
      const parsed: unknown = JSON.parse(content);

      // Type guard for extraction summary
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'extractedAt' in parsed &&
        'citiesFound' in parsed &&
        'expectedCities' in parsed &&
        'state' in parsed
      ) {
        return parsed as ExtractionSummary;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Load registry entries from JSON file
   */
  private loadRegistryEntries(registryPath: string): readonly CityRegistryEntry[] | null {
    if (!fs.existsSync(registryPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(registryPath, 'utf-8');
      const parsed: unknown = JSON.parse(content);

      // Type guard for registry entries
      if (Array.isArray(parsed)) {
        return parsed as CityRegistryEntry[];
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get all city GeoJSON files in directory
   */
  private getCityFiles(citiesDir: string): readonly string[] {
    if (!fs.existsSync(citiesDir)) {
      return [];
    }

    return fs.readdirSync(citiesDir).filter(f => f.endsWith('.geojson'));
  }

  /**
   * Get city name from registry entries or FIPS code
   */
  private getCityName(
    fips: string,
    registryEntries: readonly CityRegistryEntry[] | null
  ): string {
    if (!registryEntries) {
      return 'Unknown';
    }

    const entry = registryEntries.find(e => e.cityFips === fips);
    return entry?.cityName ?? 'Unknown';
  }

  /**
   * Validate a single city
   */
  private validateSingleCity(
    cityName: string,
    fips: string,
    cityPath: string,
    fipsSet: Set<string>,
    options?: CityWardValidationOptions
  ): SingleCityValidationResult {
    const errors: CityWardError[] = [];
    const warnings: CityWardWarning[] = [];

    // Check for duplicate FIPS
    if (fipsSet.has(fips)) {
      errors.push({
        city: cityName,
        fips,
        message: 'Duplicate FIPS code',
        severity: 'error',
        code: 'DUPLICATE_FIPS',
      });
    }

    // Validate FIPS format
    const fipsValidation = this.validateFipsCode(fips);
    if (!fipsValidation.valid) {
      errors.push({
        city: cityName,
        fips,
        message: fipsValidation.error ?? 'Invalid FIPS code',
        severity: 'error',
        code: 'INVALID_FIPS',
      });
    }

    // Load GeoJSON
    const geojson = this.loadGeoJSON(cityPath);
    if (!geojson) {
      errors.push({
        city: cityName,
        fips,
        message: 'Failed to load GeoJSON',
        severity: 'error',
        code: 'MISSING_GEOJSON',
      });

      return {
        cityName,
        fips,
        passed: false,
        wardCount: 0,
        fipsValidation,
        wardCountValidation: this.validateWardCount(0),
        errors,
        warnings,
      };
    }

    // Validate ward count
    const wardCount = geojson.features.length;
    const wardCountValidation = this.validateWardCount(wardCount);

    if (!wardCountValidation.reasonable) {
      warnings.push({
        city: cityName,
        fips,
        message: `Unusual ward count: ${wardCount} (expected ${this.minWardCount}-${this.maxWardCount})`,
        severity: 'warning',
        code: 'UNUSUAL_WARD_COUNT',
      });
    }

    // Validate geometry (if enabled)
    let geometryValidation: GeometryValidationResult | undefined;
    if (options?.includeGeometry ?? true) {
      geometryValidation = this.validateGeometry(geojson);
      if (!geometryValidation.valid) {
        errors.push({
          city: cityName,
          fips,
          message: `Geometry validation failed: ${geometryValidation.error}`,
          severity: 'error',
          code: 'INVALID_GEOMETRY',
        });
      }
    }

    // Validate ward identifiers (if enabled)
    let wardIdentifierValidation: WardIdentifierValidationResult | undefined;
    if (options?.includeWardIdentifiers ?? true) {
      wardIdentifierValidation = this.validateWardIdentifiers(
        geojson.features as WardFeature[]
      );
      if (!wardIdentifierValidation.valid) {
        for (const duplicate of wardIdentifierValidation.duplicates) {
          warnings.push({
            city: cityName,
            fips,
            message: `Duplicate ward identifier: ${duplicate}`,
            severity: 'warning',
            code: 'DUPLICATE_WARD_ID',
          });
        }
      }
    }

    const passed = errors.length === 0;

    return {
      cityName,
      fips,
      passed,
      wardCount,
      fipsValidation,
      wardCountValidation,
      geometryValidation,
      wardIdentifierValidation,
      errors,
      warnings,
    };
  }

  /**
   * Load GeoJSON file safely
   */
  private loadGeoJSON(
    filePath: string
  ): FeatureCollection<Polygon | MultiPolygon> | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(content);

      // Type guard for FeatureCollection
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'type' in parsed &&
        parsed.type === 'FeatureCollection' &&
        'features' in parsed &&
        Array.isArray(parsed.features)
      ) {
        return parsed as FeatureCollection<Polygon | MultiPolygon>;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Validate polygon rings are closed
   */
  private validatePolygonRings(
    geometry: Polygon | MultiPolygon,
    featureIndex: number
  ): GeometryIssue | null {
    const coords = geometry.type === 'Polygon'
      ? geometry.coordinates
      : geometry.coordinates.flat();

    for (const ring of coords) {
      const typedRing = ring as Array<[number, number]>;

      if (typedRing.length < 4) {
        return {
          featureIndex,
          type: 'unclosed-ring',
          description: `Feature ${featureIndex} has ring with < 4 coordinates`,
        };
      }

      // Check ring is closed (first == last)
      const first = typedRing[0];
      const last = typedRing[typedRing.length - 1];

      if (first[0] !== last[0] || first[1] !== last[1]) {
        return {
          featureIndex,
          type: 'unclosed-ring',
          description: `Feature ${featureIndex} has unclosed ring (first != last)`,
        };
      }
    }

    return null;
  }

  /**
   * Extract ward identifier from feature
   */
  private extractWardIdentifier(feature: WardFeature): string {
    const wardNormalized = feature.properties?.WARD_NORMALIZED;
    const ward = feature.properties?.WARD;

    if (wardNormalized !== undefined && wardNormalized !== null) {
      return String(wardNormalized);
    }

    if (ward !== undefined && ward !== null) {
      return String(ward);
    }

    return 'unknown';
  }

  /**
   * Validate city count against expected
   */
  private validateCityCount(
    actualCount: number,
    expectedCount: number
  ): CityWardWarning | null {
    const threshold = expectedCount * LOW_CITY_COUNT_THRESHOLD;

    if (actualCount < threshold) {
      return {
        city: 'N/A',
        fips: 'N/A',
        message: `Low city count: ${actualCount} (expected ${expectedCount})`,
        severity: 'warning',
        code: 'LOW_CITY_COUNT',
      };
    }

    return null;
  }
}
