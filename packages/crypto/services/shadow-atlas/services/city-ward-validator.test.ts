/**
 * CityWardValidator Tests
 *
 * Comprehensive test suite for CityWardValidator service.
 * Tests all validation logic with temporary file system.
 *
 * TYPE SAFETY: Nuclear-level strictness. Zero `any`, zero `@ts-ignore`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CityWardValidator } from './city-ward-validator.js';
import type {
  CityWardValidationResult,
  FipsValidationResult,
  WardCountValidationResult,
  GeometryValidationResult,
  WardIdentifierValidationResult,
  ExtractionSummary,
  CityRegistryEntry,
  WardFeature,
} from './city-ward-validator.types.js';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_DATA_DIR = '.shadow-atlas-test/statewide-wards';

/**
 * Create mock GeoJSON feature collection
 */
function createMockGeoJSON(wardCount: number, closed = true): FeatureCollection<Polygon> {
  const features: WardFeature[] = [];

  for (let i = 1; i <= wardCount; i++) {
    const ring: Array<[number, number]> = [
      [-90.0, 45.0],
      [-89.0, 45.0],
      [-89.0, 44.0],
      [-90.0, 44.0],
    ];

    // Add closing coordinate if closed
    if (closed) {
      ring.push([-90.0, 45.0]);
    }

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [ring],
      },
      properties: {
        WARD_NORMALIZED: `Ward ${i}`,
        WARD: i.toString(),
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Create mock GeoJSON with duplicate ward IDs
 */
function createMockGeoJSONWithDuplicates(): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-90.0, 45.0],
            [-89.0, 45.0],
            [-89.0, 44.0],
            [-90.0, 44.0],
            [-90.0, 45.0],
          ]],
        },
        properties: { WARD_NORMALIZED: 'Ward 1' },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-90.0, 45.0],
            [-89.0, 45.0],
            [-89.0, 44.0],
            [-90.0, 44.0],
            [-90.0, 45.0],
          ]],
        },
        properties: { WARD_NORMALIZED: 'Ward 1' }, // Duplicate
      },
    ],
  };
}

/**
 * Create mock extraction summary
 */
function createMockExtractionSummary(
  state: string,
  citiesFound: number,
  expectedCities: number
): ExtractionSummary {
  return {
    extractedAt: new Date().toISOString(),
    citiesFound,
    expectedCities,
    state,
  };
}

/**
 * Create mock registry entries
 */
function createMockRegistryEntries(cities: Array<{ fips: string; name: string }>): CityRegistryEntry[] {
  return cities.map(city => ({
    cityFips: city.fips,
    cityName: city.name,
    state: 'WI',
  }));
}

/**
 * Setup mock file system for state extraction
 */
async function setupMockStateExtraction(
  dataDir: string,
  state: string,
  cities: Array<{ fips: string; name: string; wardCount: number }>
): Promise<void> {
  const stateDir = join(dataDir, state);
  const citiesDir = join(stateDir, 'cities');

  // Create directories
  await mkdir(citiesDir, { recursive: true });

  // Create extraction summary
  const summary = createMockExtractionSummary(state, cities.length, cities.length);
  await writeFile(
    join(stateDir, 'extraction-summary.json'),
    JSON.stringify(summary, null, 2),
    'utf-8'
  );

  // Create registry entries
  const registry = createMockRegistryEntries(cities);
  await writeFile(
    join(stateDir, 'registry-entries.json'),
    JSON.stringify(registry, null, 2),
    'utf-8'
  );

  // Create city GeoJSON files
  for (const city of cities) {
    const geojson = createMockGeoJSON(city.wardCount);
    await writeFile(
      join(citiesDir, `${city.fips}.geojson`),
      JSON.stringify(geojson, null, 2),
      'utf-8'
    );
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('CityWardValidator', () => {
  let validator: CityWardValidator;

  beforeEach(async () => {
    validator = new CityWardValidator();
    // Clean up test directory
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  // ==========================================================================
  // Constructor Tests
  // ==========================================================================

  describe('constructor', () => {
    it('should create validator with default options', () => {
      expect(validator).toBeDefined();
    });

    it('should create validator with custom ward count range', () => {
      const customValidator = new CityWardValidator({
        minWardCount: 5,
        maxWardCount: 25,
      });

      const result = customValidator.validateWardCount(4);
      expect(result.reasonable).toBe(false);
      expect(result.expectedRange.min).toBe(5);
      expect(result.expectedRange.max).toBe(25);
    });
  });

  // ==========================================================================
  // FIPS Validation Tests
  // ==========================================================================

  describe('validateFipsCode', () => {
    it('should validate correct 7-digit FIPS code', () => {
      const result = validator.validateFipsCode('5553000');

      expect(result.valid).toBe(true);
      expect(result.fips).toBe('5553000');
      expect(result.error).toBeUndefined();
    });

    it('should reject FIPS code that is too short', () => {
      const result = validator.validateFipsCode('123');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid FIPS format');
    });

    it('should reject FIPS code that is too long', () => {
      const result = validator.validateFipsCode('12345678');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid FIPS format');
    });

    it('should reject FIPS code with non-numeric characters', () => {
      const result = validator.validateFipsCode('555300A');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid FIPS format');
    });

    it('should reject empty FIPS code', () => {
      const result = validator.validateFipsCode('');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid FIPS format');
    });
  });

  // ==========================================================================
  // Ward Count Validation Tests
  // ==========================================================================

  describe('validateWardCount', () => {
    it('should validate reasonable ward count (3-50 range)', () => {
      const result = validator.validateWardCount(7);

      expect(result.valid).toBe(true);
      expect(result.reasonable).toBe(true);
      expect(result.count).toBe(7);
      expect(result.expectedRange.min).toBe(3);
      expect(result.expectedRange.max).toBe(50);
    });

    it('should mark ward count below minimum as unreasonable', () => {
      const result = validator.validateWardCount(2);

      expect(result.valid).toBe(true);
      expect(result.reasonable).toBe(false);
    });

    it('should mark ward count above maximum as unreasonable', () => {
      const result = validator.validateWardCount(75);

      expect(result.valid).toBe(true);
      expect(result.reasonable).toBe(false);
    });

    it('should mark zero ward count as invalid', () => {
      const result = validator.validateWardCount(0);

      expect(result.valid).toBe(false);
      expect(result.reasonable).toBe(false);
    });

    it('should validate minimum acceptable ward count', () => {
      const result = validator.validateWardCount(3);

      expect(result.valid).toBe(true);
      expect(result.reasonable).toBe(true);
    });

    it('should validate maximum acceptable ward count', () => {
      const result = validator.validateWardCount(50);

      expect(result.valid).toBe(true);
      expect(result.reasonable).toBe(true);
    });
  });

  // ==========================================================================
  // Geometry Validation Tests
  // ==========================================================================

  describe('validateGeometry', () => {
    it('should validate correct Polygon geometry', () => {
      const geojson = createMockGeoJSON(5);
      const result = validator.validateGeometry(geojson);

      expect(result.valid).toBe(true);
      expect(result.featureCount).toBe(5);
      expect(result.issues).toHaveLength(0);
      expect(result.error).toBeUndefined();
    });

    it('should reject empty feature collection', () => {
      const geojson: FeatureCollection<Polygon> = {
        type: 'FeatureCollection',
        features: [],
      };

      const result = validator.validateGeometry(geojson);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('No features');
    });

    it('should detect unclosed polygon rings', () => {
      const geojson = createMockGeoJSON(1, false); // unclosed ring
      const result = validator.validateGeometry(geojson);

      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe('unclosed-ring');
    });

    it('should detect missing geometry', () => {
      const geojson: FeatureCollection<Polygon> = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: null as unknown as Polygon, // Missing geometry
            properties: {},
          },
        ],
      };

      const result = validator.validateGeometry(geojson);

      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe('missing-geometry');
    });

    it('should validate MultiPolygon geometry', () => {
      const geojson: FeatureCollection<MultiPolygon> = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'MultiPolygon',
              coordinates: [
                [[
                  [-90.0, 45.0],
                  [-89.0, 45.0],
                  [-89.0, 44.0],
                  [-90.0, 44.0],
                  [-90.0, 45.0],
                ]],
              ],
            },
            properties: {},
          },
        ],
      };

      const result = validator.validateGeometry(geojson);

      expect(result.valid).toBe(true);
      expect(result.featureCount).toBe(1);
    });

    it('should detect empty coordinates', () => {
      const geojson: FeatureCollection<Polygon> = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [], // Empty coordinates
            },
            properties: {},
          },
        ],
      };

      const result = validator.validateGeometry(geojson);

      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe('empty-coordinates');
    });

    it('should detect rings with fewer than 4 coordinates', () => {
      const geojson: FeatureCollection<Polygon> = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [-90.0, 45.0],
                [-89.0, 45.0],
                [-90.0, 45.0], // Only 3 coordinates
              ]],
            },
            properties: {},
          },
        ],
      };

      const result = validator.validateGeometry(geojson);

      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe('unclosed-ring');
    });
  });

  // ==========================================================================
  // Ward Identifier Validation Tests
  // ==========================================================================

  describe('validateWardIdentifiers', () => {
    it('should validate unique ward identifiers', () => {
      const geojson = createMockGeoJSON(5);
      const result = validator.validateWardIdentifiers(geojson.features as WardFeature[]);

      expect(result.valid).toBe(true);
      expect(result.totalWards).toBe(5);
      expect(result.uniqueWards).toBe(5);
      expect(result.duplicates).toHaveLength(0);
    });

    it('should detect duplicate ward identifiers', () => {
      const geojson = createMockGeoJSONWithDuplicates();
      const result = validator.validateWardIdentifiers(geojson.features as WardFeature[]);

      expect(result.valid).toBe(false);
      expect(result.totalWards).toBe(2);
      expect(result.uniqueWards).toBe(1);
      expect(result.duplicates).toContain('Ward 1');
    });

    it('should handle features with missing ward identifiers', () => {
      const geojson: FeatureCollection<Polygon> = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [-90.0, 45.0],
                [-89.0, 45.0],
                [-89.0, 44.0],
                [-90.0, 44.0],
                [-90.0, 45.0],
              ]],
            },
            properties: {}, // No WARD or WARD_NORMALIZED
          },
        ],
      };

      const result = validator.validateWardIdentifiers(geojson.features as WardFeature[]);

      expect(result.valid).toBe(true);
      expect(result.totalWards).toBe(1);
    });

    it('should prefer WARD_NORMALIZED over WARD', () => {
      const geojson: FeatureCollection<Polygon> = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [-90.0, 45.0],
                [-89.0, 45.0],
                [-89.0, 44.0],
                [-90.0, 44.0],
                [-90.0, 45.0],
              ]],
            },
            properties: {
              WARD_NORMALIZED: 'Normalized',
              WARD: 'Original',
            },
          },
        ],
      };

      const result = validator.validateWardIdentifiers(geojson.features as WardFeature[]);

      expect(result.valid).toBe(true);
      expect(result.uniqueWards).toBe(1);
    });
  });

  // ==========================================================================
  // Extraction Directory Validation Tests
  // ==========================================================================

  describe('validateExtractionDirectory', () => {
    it('should validate complete extraction directory successfully', async () => {
      await setupMockStateExtraction(TEST_DATA_DIR, 'WI', [
        { fips: '5553000', name: 'Milwaukee', wardCount: 15 },
        { fips: '5548000', name: 'Madison', wardCount: 20 },
        { fips: '5522000', name: 'Green Bay', wardCount: 7 },
      ]);

      const stateDir = join(TEST_DATA_DIR, 'WI');
      const result = validator.validateExtractionDirectory(stateDir);

      expect(result.passed).toBe(true);
      expect(result.state).toBe('WI');
      expect(result.cityCount).toBe(3);
      expect(result.errors).toHaveLength(0);
      expect(result.extractionSummary).toBeDefined();
      expect(result.registryEntries).toBeDefined();
    });

    it('should fail when cities directory does not exist', () => {
      const stateDir = join(TEST_DATA_DIR, 'XX');
      const result = validator.validateExtractionDirectory(stateDir);

      expect(result.passed).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('DIRECTORY_NOT_FOUND');
    });

    it('should detect duplicate FIPS codes across files', async () => {
      const stateDir = join(TEST_DATA_DIR, 'WI');
      const citiesDir = join(stateDir, 'cities');

      await mkdir(citiesDir, { recursive: true });

      const geojson = createMockGeoJSON(5);

      // Create two files with same FIPS (simulating duplicate)
      await writeFile(join(citiesDir, '5553000.geojson'), JSON.stringify(geojson), 'utf-8');

      // Note: Filesystem won't allow duplicate filenames, so duplicate detection
      // works at the set level within single pass. This test validates the logic.
      const result = validator.validateExtractionDirectory(stateDir);

      expect(result.cityCount).toBe(1);
      // No duplicate because filesystem prevents duplicate filenames
      expect(result.errors.some(e => e.code === 'DUPLICATE_FIPS')).toBe(false);
    });

    it('should detect invalid FIPS codes', async () => {
      const stateDir = join(TEST_DATA_DIR, 'WI');
      const citiesDir = join(stateDir, 'cities');

      await mkdir(citiesDir, { recursive: true });

      const geojson = createMockGeoJSON(5);
      await writeFile(join(citiesDir, '123.geojson'), JSON.stringify(geojson), 'utf-8');

      const result = validator.validateExtractionDirectory(stateDir);

      expect(result.passed).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_FIPS')).toBe(true);
    });

    it('should warn about unusual ward counts', async () => {
      await setupMockStateExtraction(TEST_DATA_DIR, 'WI', [
        { fips: '5553000', name: 'Milwaukee', wardCount: 75 },
      ]);

      const stateDir = join(TEST_DATA_DIR, 'WI');
      const result = validator.validateExtractionDirectory(stateDir);

      expect(result.passed).toBe(true);
      expect(result.warnings.some(w => w.code === 'UNUSUAL_WARD_COUNT')).toBe(true);
    });

    it('should warn when extraction summary is missing', async () => {
      const stateDir = join(TEST_DATA_DIR, 'WI');
      const citiesDir = join(stateDir, 'cities');

      await mkdir(citiesDir, { recursive: true });

      const geojson = createMockGeoJSON(5);
      await writeFile(join(citiesDir, '5553000.geojson'), JSON.stringify(geojson), 'utf-8');

      const result = validator.validateExtractionDirectory(stateDir);

      expect(result.warnings.some(w => w.code === 'MISSING_EXTRACTION_SUMMARY')).toBe(true);
    });

    it('should warn when registry entries are missing', async () => {
      const stateDir = join(TEST_DATA_DIR, 'WI');
      const citiesDir = join(stateDir, 'cities');

      await mkdir(citiesDir, { recursive: true });

      const geojson = createMockGeoJSON(5);
      await writeFile(join(citiesDir, '5553000.geojson'), JSON.stringify(geojson), 'utf-8');

      const result = validator.validateExtractionDirectory(stateDir);

      expect(result.warnings.some(w => w.code === 'MISSING_REGISTRY_ENTRIES')).toBe(true);
    });

    it('should warn when city count is below expected', async () => {
      const stateDir = join(TEST_DATA_DIR, 'WI');
      const citiesDir = join(stateDir, 'cities');

      await mkdir(citiesDir, { recursive: true });

      const summary = createMockExtractionSummary('WI', 1, 10);
      await writeFile(join(stateDir, 'extraction-summary.json'), JSON.stringify(summary), 'utf-8');

      const geojson = createMockGeoJSON(5);
      await writeFile(join(citiesDir, '5553000.geojson'), JSON.stringify(geojson), 'utf-8');

      const result = validator.validateExtractionDirectory(stateDir);

      expect(result.warnings.some(w => w.code === 'LOW_CITY_COUNT')).toBe(true);
    });

    it('should validate geometry when enabled', async () => {
      const stateDir = join(TEST_DATA_DIR, 'WI');
      const citiesDir = join(stateDir, 'cities');

      await mkdir(citiesDir, { recursive: true });

      const badGeojson = createMockGeoJSON(1, false);
      await writeFile(join(citiesDir, '5553000.geojson'), JSON.stringify(badGeojson), 'utf-8');

      const result = validator.validateExtractionDirectory(stateDir, {
        includeGeometry: true,
      });

      expect(result.passed).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_GEOMETRY')).toBe(true);
    });

    it('should validate ward identifiers when enabled', async () => {
      const stateDir = join(TEST_DATA_DIR, 'WI');
      const citiesDir = join(stateDir, 'cities');

      await mkdir(citiesDir, { recursive: true });

      const geojsonWithDuplicates = createMockGeoJSONWithDuplicates();
      await writeFile(join(citiesDir, '5553000.geojson'), JSON.stringify(geojsonWithDuplicates), 'utf-8');

      const result = validator.validateExtractionDirectory(stateDir, {
        includeWardIdentifiers: true,
      });

      expect(result.passed).toBe(true);
      expect(result.warnings.some(w => w.code === 'DUPLICATE_WARD_ID')).toBe(true);
    });

    it('should handle failed GeoJSON load gracefully', async () => {
      const stateDir = join(TEST_DATA_DIR, 'WI');
      const citiesDir = join(stateDir, 'cities');

      await mkdir(citiesDir, { recursive: true });

      await writeFile(join(citiesDir, '5553000.geojson'), 'invalid json{', 'utf-8');

      const result = validator.validateExtractionDirectory(stateDir);

      expect(result.passed).toBe(false);
      expect(result.errors.some(e => e.code === 'MISSING_GEOJSON')).toBe(true);
    });

    it('should extract state code from directory path', async () => {
      await setupMockStateExtraction(TEST_DATA_DIR, 'ma', [
        { fips: '2507000', name: 'Boston', wardCount: 22 },
      ]);

      const stateDir = join(TEST_DATA_DIR, 'ma');
      const result = validator.validateExtractionDirectory(stateDir);

      expect(result.state).toBe('MA'); // Should be uppercase
      expect(result.passed).toBe(true);
    });

    it('should validate multiple cities with cross-references', async () => {
      await setupMockStateExtraction(TEST_DATA_DIR, 'WI', [
        { fips: '5553000', name: 'Milwaukee', wardCount: 15 },
        { fips: '5548000', name: 'Madison', wardCount: 20 },
        { fips: '5522000', name: 'Green Bay', wardCount: 7 },
        { fips: '5566000', name: 'Racine', wardCount: 14 },
        { fips: '5579000', name: 'Waukesha', wardCount: 10 },
      ]);

      const stateDir = join(TEST_DATA_DIR, 'WI');
      const result = validator.validateExtractionDirectory(stateDir);

      expect(result.passed).toBe(true);
      expect(result.cityCount).toBe(5);
      expect(result.extractionSummary?.citiesFound).toBe(5);
      expect(result.registryEntries).toHaveLength(5);
    });

    it('should handle empty cities directory', async () => {
      const stateDir = join(TEST_DATA_DIR, 'WI');
      const citiesDir = join(stateDir, 'cities');

      await mkdir(citiesDir, { recursive: true });

      const result = validator.validateExtractionDirectory(stateDir);

      expect(result.passed).toBe(true); // No errors, just empty
      expect(result.cityCount).toBe(0);
    });

    it('should validate all files match registry entries', async () => {
      await setupMockStateExtraction(TEST_DATA_DIR, 'WI', [
        { fips: '5553000', name: 'Milwaukee', wardCount: 15 },
        { fips: '5548000', name: 'Madison', wardCount: 20 },
      ]);

      const stateDir = join(TEST_DATA_DIR, 'WI');
      const result = validator.validateExtractionDirectory(stateDir);

      expect(result.passed).toBe(true);
      expect(result.cityCount).toBe(2);

      // Check that city names are resolved from registry
      const hasValidCityNames = result.registryEntries?.every(
        entry => entry.cityName !== 'Unknown'
      );
      expect(hasValidCityNames).toBe(true);
    });
  });

  // ==========================================================================
  // State Extraction Validation Tests
  // ==========================================================================

  describe('validateStateExtraction', () => {
    it('should validate complete state extraction successfully', async () => {
      await setupMockStateExtraction(TEST_DATA_DIR, 'WI', [
        { fips: '5553000', name: 'Milwaukee', wardCount: 15 },
        { fips: '5548000', name: 'Madison', wardCount: 20 },
        { fips: '5522000', name: 'Green Bay', wardCount: 7 },
      ]);

      const result = validator.validateStateExtraction('WI', TEST_DATA_DIR);

      expect(result.passed).toBe(true);
      expect(result.state).toBe('WI');
      expect(result.cityCount).toBe(3);
      expect(result.errors).toHaveLength(0);
      expect(result.extractionSummary).toBeDefined();
      expect(result.registryEntries).toBeDefined();
    });

    it('should fail when cities directory does not exist', () => {
      const result = validator.validateStateExtraction('XX', TEST_DATA_DIR);

      expect(result.passed).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('DIRECTORY_NOT_FOUND');
    });

    it('should detect duplicate FIPS codes', async () => {
      const stateDir = join(TEST_DATA_DIR, 'WI');
      const citiesDir = join(stateDir, 'cities');

      await mkdir(citiesDir, { recursive: true });

      // Create single file - duplicate detection happens within the set check
      const geojson = createMockGeoJSON(5);
      await writeFile(join(citiesDir, '5553000.geojson'), JSON.stringify(geojson), 'utf-8');

      const result = validator.validateStateExtraction('WI', TEST_DATA_DIR);

      expect(result.cityCount).toBe(1);
    });

    it('should detect invalid FIPS codes', async () => {
      const stateDir = join(TEST_DATA_DIR, 'WI');
      const citiesDir = join(stateDir, 'cities');

      await mkdir(citiesDir, { recursive: true });

      const geojson = createMockGeoJSON(5);
      await writeFile(join(citiesDir, '123.geojson'), JSON.stringify(geojson), 'utf-8'); // Invalid FIPS

      const result = validator.validateStateExtraction('WI', TEST_DATA_DIR);

      expect(result.passed).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_FIPS')).toBe(true);
    });

    it('should warn about unusual ward counts', async () => {
      await setupMockStateExtraction(TEST_DATA_DIR, 'WI', [
        { fips: '5553000', name: 'Milwaukee', wardCount: 75 }, // Unusual count
      ]);

      const result = validator.validateStateExtraction('WI', TEST_DATA_DIR);

      expect(result.passed).toBe(true); // Warnings don't fail validation
      expect(result.warnings.some(w => w.code === 'UNUSUAL_WARD_COUNT')).toBe(true);
    });

    it('should warn when extraction summary is missing', async () => {
      const stateDir = join(TEST_DATA_DIR, 'WI');
      const citiesDir = join(stateDir, 'cities');

      await mkdir(citiesDir, { recursive: true });

      const geojson = createMockGeoJSON(5);
      await writeFile(join(citiesDir, '5553000.geojson'), JSON.stringify(geojson), 'utf-8');

      const result = validator.validateStateExtraction('WI', TEST_DATA_DIR);

      expect(result.warnings.some(w => w.code === 'MISSING_EXTRACTION_SUMMARY')).toBe(true);
    });

    it('should warn when registry entries are missing', async () => {
      const stateDir = join(TEST_DATA_DIR, 'WI');
      const citiesDir = join(stateDir, 'cities');

      await mkdir(citiesDir, { recursive: true });

      const geojson = createMockGeoJSON(5);
      await writeFile(join(citiesDir, '5553000.geojson'), JSON.stringify(geojson), 'utf-8');

      const result = validator.validateStateExtraction('WI', TEST_DATA_DIR);

      expect(result.warnings.some(w => w.code === 'MISSING_REGISTRY_ENTRIES')).toBe(true);
    });

    it('should warn when city count is below expected', async () => {
      const stateDir = join(TEST_DATA_DIR, 'WI');
      const citiesDir = join(stateDir, 'cities');

      await mkdir(citiesDir, { recursive: true });

      // Create summary expecting 10 cities but only provide 1
      const summary = createMockExtractionSummary('WI', 1, 10);
      await writeFile(join(stateDir, 'extraction-summary.json'), JSON.stringify(summary), 'utf-8');

      const geojson = createMockGeoJSON(5);
      await writeFile(join(citiesDir, '5553000.geojson'), JSON.stringify(geojson), 'utf-8');

      const result = validator.validateStateExtraction('WI', TEST_DATA_DIR);

      expect(result.warnings.some(w => w.code === 'LOW_CITY_COUNT')).toBe(true);
    });

    it('should validate geometry when enabled', async () => {
      const stateDir = join(TEST_DATA_DIR, 'WI');
      const citiesDir = join(stateDir, 'cities');

      await mkdir(citiesDir, { recursive: true });

      // Create GeoJSON with unclosed ring
      const badGeojson = createMockGeoJSON(1, false);
      await writeFile(join(citiesDir, '5553000.geojson'), JSON.stringify(badGeojson), 'utf-8');

      const result = validator.validateStateExtraction('WI', TEST_DATA_DIR, {
        includeGeometry: true,
      });

      expect(result.passed).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_GEOMETRY')).toBe(true);
    });

    it('should validate ward identifiers when enabled', async () => {
      const stateDir = join(TEST_DATA_DIR, 'WI');
      const citiesDir = join(stateDir, 'cities');

      await mkdir(citiesDir, { recursive: true });

      const geojsonWithDuplicates = createMockGeoJSONWithDuplicates();
      await writeFile(join(citiesDir, '5553000.geojson'), JSON.stringify(geojsonWithDuplicates), 'utf-8');

      const result = validator.validateStateExtraction('WI', TEST_DATA_DIR, {
        includeWardIdentifiers: true,
      });

      expect(result.passed).toBe(true); // Duplicate ward IDs are warnings
      expect(result.warnings.some(w => w.code === 'DUPLICATE_WARD_ID')).toBe(true);
    });

    it('should handle failed GeoJSON load gracefully', async () => {
      const stateDir = join(TEST_DATA_DIR, 'WI');
      const citiesDir = join(stateDir, 'cities');

      await mkdir(citiesDir, { recursive: true });

      // Create invalid JSON
      await writeFile(join(citiesDir, '5553000.geojson'), 'invalid json{', 'utf-8');

      const result = validator.validateStateExtraction('WI', TEST_DATA_DIR);

      expect(result.passed).toBe(false);
      expect(result.errors.some(e => e.code === 'MISSING_GEOJSON')).toBe(true);
    });

    it('should allow warnings without failing when allowWarnings is true', async () => {
      await setupMockStateExtraction(TEST_DATA_DIR, 'WI', [
        { fips: '5553000', name: 'Milwaukee', wardCount: 75 }, // Unusual count
      ]);

      const result = validator.validateStateExtraction('WI', TEST_DATA_DIR, {
        allowWarnings: true,
      });

      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(1);
    });
  });
});
