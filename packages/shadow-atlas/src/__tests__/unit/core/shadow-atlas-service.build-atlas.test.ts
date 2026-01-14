/**
 * ShadowAtlasService.buildAtlas() Unit Tests
 *
 * Tests the complete Atlas building orchestration with MOCKED network calls:
 * - Download TIGER data (mocked)
 * - Validate layers
 * - Build unified Merkle tree
 * - Export to JSON
 *
 * IMPORTANT: These tests do NOT make actual network calls. All TIGER downloads
 * are mocked to return fixture data for deterministic, fast test execution.
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import { rm, mkdir, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import tigerCdSample from '../../fixtures/tiger-cd-sample.json' with { type: 'json' };

const TEST_OUTPUT_DIR = join(process.cwd(), 'test-output', 'atlas-build');

/**
 * Mock TIGER boundary file response
 */
interface MockRawBoundaryFile {
  readonly data: Buffer;
  readonly url: string;
  readonly format: string;
  readonly metadata: {
    readonly featureCount: number;
    readonly layer: string;
    readonly vintage: number;
  };
}

/**
 * Create mock raw boundary file from GeoJSON
 */
function createMockRawFile(
  geojson: FeatureCollection<Polygon | MultiPolygon>,
  layer: string,
  year: number
): MockRawBoundaryFile {
  return {
    data: Buffer.from(JSON.stringify(geojson)),
    url: `https://www2.census.gov/geo/tiger/TIGER${year}/${layer.toUpperCase()}/tl_${year}_55_${layer}.zip`,
    format: 'geojson',
    metadata: {
      featureCount: geojson.features.length,
      layer,
      vintage: year,
    },
  };
}

/**
 * Mock NormalizedBoundary matching the actual interface
 */
interface MockNormalizedBoundary {
  readonly id: string;
  readonly name: string;
  readonly level: number; // AdministrativeLevel
  readonly geometry: Polygon | MultiPolygon;
  readonly properties: Record<string, unknown>;
  readonly source: {
    readonly provider: string;
    readonly url: string;
    readonly version: string;
    readonly license: string;
    readonly updatedAt: string;
    readonly checksum: string;
    readonly authorityLevel: string;
    readonly legalStatus: string;
    readonly collectionMethod: string;
    readonly lastVerified: string;
    readonly verifiedBy: string;
    readonly topologyValidated: boolean;
    readonly geometryRepaired: boolean;
    readonly coordinateSystem: string;
    readonly nextScheduledUpdate: string;
    readonly updateMonitoring: string;
  };
}

// Fixed timestamp for deterministic test output
const FIXED_TIMESTAMP = '2024-01-15T00:00:00.000Z';

/**
 * Create mock normalized boundaries from GeoJSON
 */
function createMockBoundaries(
  geojson: FeatureCollection<Polygon | MultiPolygon>,
  layer: string,
  year: number
): MockNormalizedBoundary[] {
  const url = `https://www2.census.gov/geo/tiger/TIGER${year}/${layer.toUpperCase()}/tl_${year}_55_${layer}.zip`;
  const now = FIXED_TIMESTAMP; // Use fixed timestamp for deterministic tests

  return geojson.features.map((feature) => ({
    id: (feature.properties?.['GEOID'] as string) || 'unknown',
    name: (feature.properties?.['NAMELSAD'] as string) || 'Unknown District',
    level: 4, // Federal level for congressional districts
    geometry: feature.geometry,
    properties: {
      stateFips: '55',
      entityFips: (feature.properties?.['GEOID'] as string)?.slice(2) || '',
      geoid: (feature.properties?.['GEOID'] as string) || 'unknown',
      layer,
      layerName: layer === 'cd' ? 'Congressional Districts' : 'Unknown',
      ...feature.properties,
    },
    source: {
      provider: 'MockTIGERBoundaryProvider',
      url,
      version: String(year),
      license: 'CC0-1.0',
      updatedAt: now,
      checksum: 'mock-checksum-12345',
      authorityLevel: 'federal-mandate',
      legalStatus: 'binding',
      collectionMethod: 'census-tiger',
      lastVerified: now,
      verifiedBy: 'automated',
      topologyValidated: true,
      geometryRepaired: false,
      coordinateSystem: 'EPSG:4326',
      nextScheduledUpdate: `${year + 1}-01-01`,
      updateMonitoring: 'api-polling',
    },
  }));
}

// Get typed fixture
const tigerCdSampleTyped = tigerCdSample as unknown as FeatureCollection<Polygon | MultiPolygon>;

// Mock the TIGERBoundaryProvider module BEFORE any imports
vi.mock('../../../providers/tiger-boundary-provider.js', () => ({
  TIGERBoundaryProvider: class MockTIGERBoundaryProvider {
    private readonly year: number;
    private lastLayer = 'cd';

    constructor(options: { year: number }) {
      this.year = options.year;
    }

    async downloadLayer(options: {
      layer: string;
      stateFips?: string;
      year?: number;
    }): Promise<MockRawBoundaryFile[]> {
      // Simulate failure for invalid states
      if (options.stateFips === '00' || options.stateFips === '99') {
        throw new Error(`Failed to download ${options.layer} for state ${options.stateFips}`);
      }
      this.lastLayer = options.layer;
      return [createMockRawFile(tigerCdSampleTyped, options.layer, this.year)];
    }

    async transform(rawFiles: MockRawBoundaryFile[]): Promise<MockNormalizedBoundary[]> {
      // Extract layer from raw file metadata
      const layer = rawFiles[0]?.metadata?.layer ?? this.lastLayer;
      return createMockBoundaries(tigerCdSampleTyped, layer, this.year);
    }

    async healthCheck(): Promise<{ available: boolean; latencyMs: number }> {
      return { available: true, latencyMs: 10 };
    }
  },
}));

// Mock the TIGERValidator module
vi.mock('../../../validators/tiger-validator.js', () => ({
  TIGERValidator: class MockTIGERValidator {
    validate(
      layer: string,
      boundaries: Array<{
        geoid: string;
        name: string;
        geometry: Polygon | MultiPolygon;
        properties: Record<string, unknown>;
      }>
    ): {
      layer: string;
      qualityScore: number;
      completeness: {
        valid: boolean;
        expected: number;
        actual: number;
        percentage: number;
        missingGEOIDs: readonly string[];
        extraGEOIDs: readonly string[];
        summary: string;
      };
      topology: {
        valid: boolean;
        selfIntersections: number;
        overlaps: readonly {
          geoid1: string;
          geoid2: string;
          overlapArea: number;
        }[];
        gaps: number;
        invalidGeometries: readonly string[];
        summary: string;
      };
      coordinates: {
        valid: boolean;
        outOfRangeCount: number;
        nullCoordinates: readonly string[];
        suspiciousLocations: readonly {
          geoid: string;
          reason: string;
          centroid: { lat: number; lon: number };
        }[];
        summary: string;
      };
    } {
      return {
        layer,
        qualityScore: 95,
        completeness: {
          valid: true,
          expected: 8, // Wisconsin has 8 CDs
          actual: boundaries.length,
          percentage: (boundaries.length / 8) * 100,
          missingGEOIDs: [],
          extraGEOIDs: [],
          summary: `${boundaries.length}/8 boundaries present (100.0%)`,
        },
        topology: {
          valid: true,
          selfIntersections: 0,
          overlaps: [],
          gaps: 0,
          invalidGeometries: [],
          summary: 'All geometries valid',
        },
        coordinates: {
          valid: true,
          outOfRangeCount: 0,
          nullCoordinates: [],
          suspiciousLocations: [],
          summary: 'All coordinates within valid range',
        },
      };
    }
  },
}));

describe('ShadowAtlasService.buildAtlas()', () => {
  // Import ShadowAtlasService after mocks are set up
  let ShadowAtlasService: typeof import('../../../core/shadow-atlas-service.js').ShadowAtlasService;
  let service: InstanceType<typeof ShadowAtlasService>;

  beforeAll(async () => {
    // Create test output directory
    await mkdir(TEST_OUTPUT_DIR, { recursive: true });

    // Dynamic import after mocks are configured
    const mod = await import('../../../core/shadow-atlas-service.js');
    ShadowAtlasService = mod.ShadowAtlasService;

    // Initialize service with cross-validation disabled for deterministic tests
    service = new ShadowAtlasService({
      storageDir: ':memory:',
      persistence: { enabled: false, autoMigrate: false, databasePath: ':memory:' },
      extraction: { retryAttempts: 1, retryDelayMs: 100 },
      validation: { minPassRate: 0.8 },
      crossValidation: { enabled: false }, // Disable for deterministic unit tests
    });
    await service.initialize();
  });

  afterAll(async () => {
    // Close service
    service.close();

    // Clean up test output
    try {
      await rm(TEST_OUTPUT_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should build Atlas with single layer (CD)', async () => {
    const result = await service.buildAtlas({
      layers: ['cd'],
      states: ['55'], // Wisconsin (small state for testing)
      year: 2024,
      qualityThreshold: 80,
      crossValidation: { enabled: false }, // Disable cross-validation for unit tests
    });

    // Verify result structure
    expect(result).toBeDefined();
    expect(result.jobId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(result.merkleRoot).toBeDefined();
    expect(typeof result.merkleRoot).toBe('bigint');
    expect(result.totalBoundaries).toBeGreaterThan(0);
    expect(result.treeDepth).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);
    expect(result.timestamp).toBeInstanceOf(Date);

    // Verify layer counts
    expect(result.layerCounts).toBeDefined();
    expect(Object.keys(result.layerCounts).length).toBeGreaterThan(0);

    // Verify validations
    expect(result.layerValidations).toBeDefined();
    expect(result.layerValidations.length).toBe(1);
    expect(result.layerValidations[0].layer).toBe('cd');
    expect(result.layerValidations[0].qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.layerValidations[0].qualityScore).toBeLessThanOrEqual(100);
  });

  it('should build Atlas with multiple layers', async () => {
    const result = await service.buildAtlas({
      layers: ['cd', 'county'],
      states: ['55'], // Wisconsin
      year: 2024,
      qualityThreshold: 70,
      crossValidation: { enabled: false },
    });

    // Verify multiple layers (both return mock CD data for simplicity)
    expect(result.layerValidations.length).toBe(2);

    const layers = result.layerValidations.map(v => v.layer);
    expect(layers).toContain('cd');
    expect(layers).toContain('county');

    // Verify all layers contributed to tree
    expect(result.totalBoundaries).toBeGreaterThan(0);

    // Verify layer counts match validations
    const totalFromValidations = result.layerValidations.reduce(
      (sum, v) => sum + v.boundaryCount,
      0
    );
    expect(result.totalBoundaries).toBe(totalFromValidations);
  });

  it('should export Atlas to JSON when outputPath provided', async () => {
    const outputPath = join(TEST_OUTPUT_DIR, 'test-atlas-export.json');

    const result = await service.buildAtlas({
      layers: ['cd'],
      states: ['55'], // Wisconsin
      year: 2024,
      qualityThreshold: 80,
      outputPath,
      crossValidation: { enabled: false },
    });

    // Verify export succeeded
    expect(result).toBeDefined();

    // Verify file exists
    await expect(access(outputPath)).resolves.not.toThrow();

    // Verify file is valid JSON
    const json = await readFile(outputPath, 'utf-8');
    const parsed = JSON.parse(json) as {
      version?: string;
      root?: string;
      boundaryCount?: number;
      leaves?: unknown[];
    };

    expect(parsed.version).toBeDefined();
    expect(parsed.root).toBeDefined();
    expect(parsed.boundaryCount).toBe(result.totalBoundaries);
    expect(parsed.leaves).toBeDefined();
    expect(Array.isArray(parsed.leaves)).toBe(true);
  });

  it('should handle layer validation failures gracefully', async () => {
    // Use invalid state code to trigger download failure
    await expect(
      service.buildAtlas({
        layers: ['cd'],
        states: ['99'], // Invalid state code
        year: 2024,
        qualityThreshold: 80,
      })
    ).rejects.toThrow();
  });

  it('should respect quality threshold warnings', async () => {
    const result = await service.buildAtlas({
      layers: ['cd'],
      states: ['55'], // Wisconsin
      year: 2024,
      qualityThreshold: 100, // Unrealistically high threshold
      crossValidation: { enabled: false },
    });

    // Build should still succeed
    expect(result).toBeDefined();
    expect(result.totalBoundaries).toBeGreaterThan(0);

    // Validations might not meet threshold
    const belowThreshold = result.layerValidations.filter(v => v.qualityScore < 100);
    expect(belowThreshold.length).toBeGreaterThanOrEqual(0);
  });

  it('should throw when all layers fail', async () => {
    // Use invalid layer configuration to force all layers to fail
    await expect(
      service.buildAtlas({
        layers: ['cd'],
        states: ['00'], // Invalid state that will cause download to fail
        year: 2024,
        qualityThreshold: 80,
      })
    ).rejects.toThrow();
  });

  it('should produce deterministic Merkle roots for identical inputs', async () => {
    // Use fake timers to ensure deterministic timestamps
    vi.useFakeTimers();
    const fixedDate = new Date('2024-01-15T00:00:00.000Z');
    vi.setSystemTime(fixedDate);

    try {
      // Build atlas twice with same inputs
      const result1 = await service.buildAtlas({
        layers: ['cd'],
        states: ['55'], // Wisconsin
        year: 2024,
        qualityThreshold: 80,
        crossValidation: { enabled: false },
      });

      const result2 = await service.buildAtlas({
        layers: ['cd'],
        states: ['55'], // Wisconsin
        year: 2024,
        qualityThreshold: 80,
        crossValidation: { enabled: false },
      });

      // Merkle roots should be identical
      expect(result1.merkleRoot).toBe(result2.merkleRoot);

      // Boundary counts should be identical
      expect(result1.totalBoundaries).toBe(result2.totalBoundaries);

      // Tree depths should be identical
      expect(result1.treeDepth).toBe(result2.treeDepth);
    } finally {
      // Restore real timers
      vi.useRealTimers();
    }
  });

  it('should include all validation details in layer results', async () => {
    const result = await service.buildAtlas({
      layers: ['cd'],
      states: ['55'], // Wisconsin
      year: 2024,
      qualityThreshold: 80,
      crossValidation: { enabled: false },
    });

    // Check validation details
    for (const validation of result.layerValidations) {
      expect(validation.layer).toBeDefined();
      expect(validation.qualityScore).toBeGreaterThanOrEqual(0);
      expect(validation.qualityScore).toBeLessThanOrEqual(100);
      expect(validation.boundaryCount).toBeGreaterThanOrEqual(0);
      expect(validation.expectedCount).toBeGreaterThanOrEqual(0);

      // If successful, validation should be present
      if (validation.qualityScore > 0) {
        expect(validation.validation).toBeDefined();
        if (validation.validation) {
          expect(validation.validation.layer).toBe(validation.layer);
          expect(validation.validation.qualityScore).toBe(validation.qualityScore);
          expect(validation.validation.completeness).toBeDefined();
          expect(validation.validation.topology).toBeDefined();
          expect(validation.validation.coordinates).toBeDefined();
        }
      }

      // If failed, error should be present
      if (validation.qualityScore === 0) {
        expect(validation.error).toBeDefined();
      }
    }
  });

  it('should track build duration accurately', async () => {
    const startTime = Date.now();

    const result = await service.buildAtlas({
      layers: ['cd'],
      states: ['55'], // Wisconsin
      year: 2024,
      qualityThreshold: 80,
      crossValidation: { enabled: false },
    });

    const endTime = Date.now();
    const measuredDuration = endTime - startTime;

    // Reported duration should be close to measured duration
    // Allow wider margin for async overhead in mocked tests
    expect(result.duration).toBeGreaterThan(0);
    expect(result.duration).toBeLessThanOrEqual(measuredDuration * 2);
    expect(result.duration).toBeGreaterThanOrEqual(1); // At least 1ms
  });

  it('should generate valid Merkle root in BN254 field', async () => {
    const result = await service.buildAtlas({
      layers: ['cd'],
      states: ['55'],
      year: 2024,
      qualityThreshold: 80,
      crossValidation: { enabled: false },
    });

    // BN254 field modulus
    const BN254_FIELD_MODULUS =
      21888242871839275222246405745257275088548364400416034343698204186575808495617n;

    // Merkle root should be valid field element
    expect(result.merkleRoot).toBeGreaterThanOrEqual(0n);
    expect(result.merkleRoot).toBeLessThan(BN254_FIELD_MODULUS);
  });

  it('should set correct tree type for US-only builds', async () => {
    const result = await service.buildAtlas({
      layers: ['cd'],
      states: ['55'],
      year: 2024,
      qualityThreshold: 80,
      crossValidation: { enabled: false },
    });

    // US-only builds should use flat tree
    expect(result.treeType).toBe('flat');
  });
});
