/**
 * Golden Cities Regression Test Suite
 *
 * PURPOSE: Prevent regressions in tessellation validation
 *
 * THEORY: If a city passes all 4 axioms today, any change that causes it to
 * fail is a regression. This test locks in known-good cities as invariants.
 *
 * THE 4 AXIOMS:
 * 1. EXCLUSIVITY: No district overlaps (districts are disjoint)
 * 2. EXHAUSTIVITY: Districts cover the municipal boundary (complete coverage)
 * 3. CONTAINMENT: Districts are within the municipal boundary
 * 4. CARDINALITY: District count matches expected count
 *
 * FAILURE POLICY:
 * - If a golden city fails, the test suite fails loudly
 * - Fix the regression OR document why the city should be removed from golden set
 * - Never silently remove golden cities
 *
 * MAINTENANCE:
 * - Add new golden cities via PR with 30+ day validation history
 * - Remove cities only with documented justification (redistricting, data source change)
 * - Any threshold changes require explicit PR approval
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TessellationProofValidator, type TessellationProof } from '../../validators/council/tessellation-proof.js';
import { MunicipalBoundaryResolver } from '../../validators/council/municipal-boundary.js';
import { KNOWN_PORTALS, type KnownPortal } from '../../core/registry/known-portals.generated.js';
import { EXPECTED_DISTRICT_COUNTS } from '../../core/registry/district-count-registry.js';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';

// ============================================================================
// Types (defined before fixture loading)
// ============================================================================

interface GoldenCity {
  readonly fips: string;
  readonly cityName: string;
  readonly state: string;
  readonly expectedFeatureCount: number;
  readonly region: string;
  readonly characteristics: readonly string[];
  readonly confidence: number;
  readonly dateAdded: string;
  readonly notes: string;
}

interface GoldenCitiesFixture {
  readonly version: string;
  readonly description: string;
  readonly lastUpdated: string;
  readonly cities: readonly GoldenCity[];
  readonly selectionCriteria: {
    readonly passRate: string;
    readonly coverageRange: string;
    readonly confidenceMinimum: number;
    readonly diversityRequirements: readonly string[];
  };
  readonly maintenancePolicy: {
    readonly addingNewCities: string;
    readonly removingCities: string;
    readonly thresholdChanges: string;
  };
}

// Load golden cities fixture
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const goldenCitiesPath = join(__dirname, '..', 'fixtures', 'golden-cities.json');
const goldenCitiesFixture = JSON.parse(readFileSync(goldenCitiesPath, 'utf-8')) as GoldenCitiesFixture;

interface ValidationResult {
  readonly city: GoldenCity;
  readonly portal: KnownPortal | null;
  readonly proof: TessellationProof | null;
  readonly error: string | null;
}

// ============================================================================
// Test Configuration
// ============================================================================

const GOLDEN_CITIES = (goldenCitiesFixture as GoldenCitiesFixture).cities;

// Skip integration tests in CI unless explicitly enabled
const SKIP_NETWORK_TESTS = process.env.CI === 'true' && process.env.RUN_GOLDEN_CITIES !== 'true';

// Rate limiting configuration
const RATE_LIMIT_MS = 500;
const REQUEST_TIMEOUT_MS = 30_000;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Fetch district GeoJSON from portal URL
 */
async function fetchDistricts(url: string): Promise<FeatureCollection<Polygon | MultiPolygon> | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'VOTER-Protocol/1.0 GoldenCities-Regression-Test',
        Accept: 'application/geo+json,application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (!data.features || !Array.isArray(data.features)) {
      return null;
    }

    return data as FeatureCollection<Polygon | MultiPolygon>;
  } catch {
    return null;
  }
}

/**
 * Delay for rate limiting
 */
async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validate a single golden city
 */
async function validateGoldenCity(
  city: GoldenCity,
  boundaryResolver: MunicipalBoundaryResolver,
  tessellationValidator: TessellationProofValidator
): Promise<ValidationResult> {
  // Get portal entry
  const portal = KNOWN_PORTALS[city.fips] ?? null;
  if (!portal) {
    return {
      city,
      portal: null,
      proof: null,
      error: `No portal entry found for FIPS ${city.fips}`,
    };
  }

  // Fetch district data
  const districts = await fetchDistricts(portal.downloadUrl);
  if (!districts) {
    return {
      city,
      portal,
      proof: null,
      error: `Failed to fetch districts from ${portal.downloadUrl}`,
    };
  }

  // Resolve municipal boundary
  const boundaryResult = await boundaryResolver.resolve(city.fips);
  if (!boundaryResult.success || !boundaryResult.boundary) {
    return {
      city,
      portal,
      proof: null,
      error: `Failed to resolve boundary: ${boundaryResult.error}`,
    };
  }

  // Get expected count from registry or fixture
  const registryEntry = EXPECTED_DISTRICT_COUNTS[city.fips];
  const expectedCount = registryEntry?.expectedDistrictCount ?? city.expectedFeatureCount;

  // Run tessellation proof
  const proof = tessellationValidator.prove(
    districts,
    boundaryResult.boundary.geometry,
    expectedCount,
    boundaryResult.boundary.landAreaSqM,
    undefined,
    boundaryResult.boundary.waterAreaSqM,
    city.fips
  );

  return {
    city,
    portal,
    proof,
    error: null,
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Golden Cities Regression Tests', () => {
  // Validate fixture integrity at test load time
  test('fixture integrity: all golden cities have required fields', () => {
    expect(GOLDEN_CITIES.length).toBeGreaterThanOrEqual(15);
    expect(GOLDEN_CITIES.length).toBeLessThanOrEqual(25);

    for (const city of GOLDEN_CITIES) {
      expect(city.fips).toMatch(/^\d{7}$/);
      expect(city.cityName).toBeTruthy();
      expect(city.state).toMatch(/^[A-Z]{2}$/);
      expect(city.expectedFeatureCount).toBeGreaterThan(0);
      expect(city.confidence).toBeGreaterThanOrEqual(80);
      expect(city.dateAdded).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('fixture integrity: all golden cities have portal entries', () => {
    const missingPortals: string[] = [];

    for (const city of GOLDEN_CITIES) {
      if (!KNOWN_PORTALS[city.fips]) {
        missingPortals.push(`${city.cityName}, ${city.state} (${city.fips})`);
      }
    }

    if (missingPortals.length > 0) {
      throw new Error(
        `Golden cities missing portal entries:\n${missingPortals.join('\n')}\n` +
          'Add these to known-portals.ts or remove from golden-cities.json'
      );
    }
  });

  test('fixture integrity: geographic diversity', () => {
    const regions = new Set(GOLDEN_CITIES.map((c) => c.region));

    // Require at least 5 different regions
    expect(regions.size).toBeGreaterThanOrEqual(5);

    // Check for key regions
    const requiredRegions = ['Midwest', 'Southeast', 'Southwest', 'Northeast'];
    for (const region of requiredRegions) {
      expect(regions.has(region)).toBe(true);
    }
  });

  test('fixture integrity: size diversity', () => {
    const featureCounts = GOLDEN_CITIES.map((c) => c.expectedFeatureCount);
    const minCount = Math.min(...featureCounts);
    const maxCount = Math.max(...featureCounts);

    // Should have variety from small to large councils
    expect(minCount).toBeLessThanOrEqual(7);
    expect(maxCount).toBeGreaterThanOrEqual(25);
  });

  // Network-dependent validation tests
  describe.skipIf(SKIP_NETWORK_TESTS)('live validation', () => {
    let boundaryResolver: MunicipalBoundaryResolver;
    let tessellationValidator: TessellationProofValidator;

    beforeAll(() => {
      boundaryResolver = new MunicipalBoundaryResolver();
      tessellationValidator = new TessellationProofValidator();
    });

    // Generate individual test for each golden city
    test.each(GOLDEN_CITIES.map((city) => [city.cityName, city.state, city] as const))(
      '%s, %s passes all 4 axioms',
      async (cityName, state, city) => {
        const result = await validateGoldenCity(city, boundaryResolver, tessellationValidator);

        // Rate limit between tests
        await delay(RATE_LIMIT_MS);

        // Check for errors
        if (result.error) {
          throw new Error(
            `GOLDEN CITY REGRESSION: ${cityName}, ${state}\n` +
              `Error: ${result.error}\n` +
              `This city was previously passing. Investigate the regression.`
          );
        }

        // Check proof validity
        expect(result.proof).not.toBeNull();
        const proof = result.proof as TessellationProof;

        if (!proof.valid) {
          throw new Error(
            `GOLDEN CITY REGRESSION: ${cityName}, ${state}\n` +
              `Failed axiom: ${proof.failedAxiom}\n` +
              `Reason: ${proof.reason}\n` +
              `Coverage: ${(proof.diagnostics.coverageRatio * 100).toFixed(2)}%\n` +
              `District count: ${proof.diagnostics.districtCount}/${proof.diagnostics.expectedCount}\n` +
              `This city was previously passing. Investigate the regression.`
          );
        }

        // Additional diagnostic assertions
        expect(proof.valid).toBe(true);
        expect(proof.failedAxiom).toBeNull();
        expect(proof.diagnostics.districtCount).toBe(proof.diagnostics.expectedCount);
      },
      // Longer timeout for network requests
      60_000
    );

    // Summary test that runs all cities and reports aggregate results
    test(
      'all golden cities pass validation',
      async () => {
        const results: ValidationResult[] = [];
        const failures: ValidationResult[] = [];

        for (const city of GOLDEN_CITIES) {
          const result = await validateGoldenCity(city, boundaryResolver, tessellationValidator);
          results.push(result);

          if (result.error || !result.proof?.valid) {
            failures.push(result);
          }

          // Rate limit
          await delay(RATE_LIMIT_MS);
        }

        // Report results
        const passCount = results.length - failures.length;
        console.log(`\nGolden Cities Validation: ${passCount}/${results.length} passed`);

        if (failures.length > 0) {
          console.log('\nFailed cities:');
          for (const failure of failures) {
            const reason = failure.error ?? failure.proof?.reason ?? 'Unknown';
            console.log(`  - ${failure.city.cityName}, ${failure.city.state}: ${reason}`);
          }
        }

        // Fail if any golden city regressed
        expect(failures.length).toBe(0);
      },
      // 5 minute timeout for full suite
      300_000
    );
  });
});

// ============================================================================
// Utility: Batch Validation for CI
// ============================================================================

/**
 * Run batch validation and return summary for CI reporting
 *
 * Usage in CI:
 * ```bash
 * npx vitest run src/__tests__/regression/golden-cities.test.ts --reporter=json
 * ```
 */
export async function runBatchValidation(): Promise<{
  total: number;
  passed: number;
  failed: number;
  failures: Array<{ city: string; reason: string }>;
}> {
  const boundaryResolver = new MunicipalBoundaryResolver();
  const tessellationValidator = new TessellationProofValidator();
  const failures: Array<{ city: string; reason: string }> = [];

  let passed = 0;

  for (const city of GOLDEN_CITIES) {
    const result = await validateGoldenCity(city, boundaryResolver, tessellationValidator);

    if (result.error || !result.proof?.valid) {
      failures.push({
        city: `${city.cityName}, ${city.state}`,
        reason: result.error ?? result.proof?.reason ?? 'Unknown',
      });
    } else {
      passed++;
    }

    await delay(RATE_LIMIT_MS);
  }

  return {
    total: GOLDEN_CITIES.length,
    passed,
    failed: failures.length,
    failures,
  };
}
