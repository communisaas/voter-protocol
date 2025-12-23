/**
 * ArcGIS Hub Ground Truth Integration Tests
 *
 * SCOPE: Validate ArcGIS Hub discovery pipeline against known ward-based cities
 * RUNTIME: ~3-5 minutes (validates Montana ground truth dataset)
 * SCHEDULE: Nightly only (network-intensive)
 *
 * MISSION: Ensure discovery pipeline achieves:
 * - High recall: Finds ward/district-based cities (target: 80%+)
 * - High precision: Avoids false positives for at-large cities (target: 80%+)
 *
 * GROUND TRUTH DATA:
 * - Montana ward-based cities (verified via subagent research 2025-11-22)
 * - District-based cities (consolidated city-counties)
 * - At-large cities (should NOT find boundaries)
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { describe, it, expect } from 'vitest';
import { isCI, runIntegration, delay, API_RATE_LIMIT_MS, retryWithBackoff } from '../setup.js';
import { ArcGISHubScanner, type CityTarget } from '../../scanners/arcgis-hub.js';

// ============================================================================
// Skip Control
// ============================================================================

// Skip in CI unless integration tests enabled
const skipInCI = isCI && !runIntegration;

// ============================================================================
// Types
// ============================================================================

interface GroundTruthCity {
  readonly name: string;
  readonly state: string;
  readonly expectedDistricts: number;
  readonly governanceType: 'ward' | 'district' | 'at-large';
  readonly knownSource: string;
  readonly population: number;
}

interface ValidationResult {
  readonly city: string;
  readonly expectedType: string;
  readonly expectedDistricts: number;
  readonly found: boolean;
  readonly discoveredUrl: string | null;
  readonly discoveredDistricts: number | null;
  readonly confidence: number;
  readonly matchesGroundTruth: boolean;
}

// ============================================================================
// Ground Truth Data
// ============================================================================

/**
 * Montana ground truth dataset
 *
 * VERIFIED via subagent research on 2025-11-22:
 * - Havre: 4 wards (corrected from 3)
 * - Laurel: 4 wards (corrected from 3)
 * - Livingston: AT-LARGE (corrected - uses City Commission, not wards)
 */
const MONTANA_GROUND_TRUTH: readonly GroundTruthCity[] = [
  // Ward-based cities (should find boundaries)
  {
    name: 'Missoula',
    state: 'MT',
    expectedDistricts: 6,
    governanceType: 'ward',
    knownSource: 'City of Missoula GIS - PoliticalBoundaries_mso',
    population: 74428,
  },
  {
    name: 'Billings',
    state: 'MT',
    expectedDistricts: 5,
    governanceType: 'ward',
    knownSource: 'Yellowstone County GIS',
    population: 119533,
  },
  {
    name: 'Kalispell',
    state: 'MT',
    expectedDistricts: 4,
    governanceType: 'ward',
    knownSource: 'Flathead County GIS',
    population: 28137,
  },
  {
    name: 'Belgrade',
    state: 'MT',
    expectedDistricts: 3,
    governanceType: 'ward',
    knownSource: 'City of Belgrade GIS',
    population: 11802,
  },
  {
    name: 'Havre',
    state: 'MT',
    expectedDistricts: 4,
    governanceType: 'ward',
    knownSource: 'Montana State Library MSDI',
    population: 9846,
  },
  {
    name: 'Laurel',
    state: 'MT',
    expectedDistricts: 4,
    governanceType: 'ward',
    knownSource: 'Yellowstone County GIS',
    population: 7340,
  },

  // District-based cities (consolidated city-counties, should find boundaries)
  {
    name: 'Helena',
    state: 'MT',
    expectedDistricts: 7,
    governanceType: 'district',
    knownSource: 'City of Helena GIS',
    population: 34370,
  },
  {
    name: 'Butte-Silver Bow',
    state: 'MT',
    expectedDistricts: 12,
    governanceType: 'district',
    knownSource: 'Butte-Silver Bow GIS',
    population: 34839,
  },
  {
    name: 'Anaconda-Deer Lodge County',
    state: 'MT',
    expectedDistricts: 5,
    governanceType: 'district',
    knownSource: 'Montana State Library MSDI',
    population: 9153,
  },

  // At-large cities (should NOT find boundaries)
  {
    name: 'Great Falls',
    state: 'MT',
    expectedDistricts: 0,
    governanceType: 'at-large',
    knownSource: 'City Commission form',
    population: 60506,
  },
  {
    name: 'Bozeman',
    state: 'MT',
    expectedDistricts: 0,
    governanceType: 'at-large',
    knownSource: 'City Commission form',
    population: 56908,
  },
  {
    name: 'Livingston',
    state: 'MT',
    expectedDistricts: 0,
    governanceType: 'at-large',
    knownSource: 'City Commission - CORRECTED (not wards)',
    population: 8131,
  },
  {
    name: 'Whitefish',
    state: 'MT',
    expectedDistricts: 0,
    governanceType: 'at-large',
    knownSource: 'City Council at-large',
    population: 8688,
  },
  {
    name: 'Miles City',
    state: 'MT',
    expectedDistricts: 0,
    governanceType: 'at-large',
    knownSource: 'City Commission form',
    population: 8410,
  },
] as const;

// ============================================================================
// Validation Functions
// ============================================================================

async function validateCity(
  scanner: ArcGISHubScanner,
  city: GroundTruthCity
): Promise<ValidationResult> {
  const cityTarget: CityTarget = {
    name: city.name,
    state: city.state,
  };

  try {
    const candidates = await retryWithBackoff(() => scanner.search(cityTarget));
    const scanResult = candidates.length > 0 ? candidates[0] : null;

    if (scanResult) {
      // Found boundary data for this city
      const matchesGroundTruth = city.governanceType !== 'at-large';

      return {
        city: city.name,
        expectedType: city.governanceType,
        expectedDistricts: city.expectedDistricts,
        found: true,
        discoveredUrl: scanResult.downloadUrl,
        discoveredDistricts: scanResult.featureCount ?? null,
        confidence: scanResult.score,
        matchesGroundTruth,
      };
    } else {
      // No boundary data found
      const matchesGroundTruth = city.governanceType === 'at-large';

      return {
        city: city.name,
        expectedType: city.governanceType,
        expectedDistricts: city.expectedDistricts,
        found: false,
        discoveredUrl: null,
        discoveredDistricts: null,
        confidence: 0,
        matchesGroundTruth,
      };
    }
  } catch (error) {
    // Error during search
    return {
      city: city.name,
      expectedType: city.governanceType,
      expectedDistricts: city.expectedDistricts,
      found: false,
      discoveredUrl: null,
      discoveredDistricts: null,
      confidence: 0,
      matchesGroundTruth: false,
    };
  }
}

// ============================================================================
// Integration Tests
// ============================================================================

describe.skipIf(skipInCI)('ArcGIS Hub Ground Truth Validation', () => {
  describe('Montana Ward-Based Cities', () => {
    const scanner = new ArcGISHubScanner();
    const wardCities = MONTANA_GROUND_TRUTH.filter((c) => c.governanceType === 'ward');

    for (const city of wardCities) {
      it(
        `finds ${city.name} (${city.expectedDistricts} wards)`,
        async () => {
          const result = await validateCity(scanner, city);

          expect(result.found).toBe(true);
          expect(result.matchesGroundTruth).toBe(true);

          if (result.discoveredDistricts !== null) {
            // Allow some tolerance for district count mismatches
            const difference = Math.abs(result.discoveredDistricts - city.expectedDistricts);
            expect(difference).toBeLessThanOrEqual(1);
          }

          // Rate limit
          await delay(API_RATE_LIMIT_MS);
        },
        30_000
      );
    }
  });

  describe('Montana District-Based Cities', () => {
    const scanner = new ArcGISHubScanner();
    const districtCities = MONTANA_GROUND_TRUTH.filter((c) => c.governanceType === 'district');

    for (const city of districtCities) {
      it(
        `finds ${city.name} (${city.expectedDistricts} districts)`,
        async () => {
          const result = await validateCity(scanner, city);

          expect(result.found).toBe(true);
          expect(result.matchesGroundTruth).toBe(true);

          // Rate limit
          await delay(API_RATE_LIMIT_MS);
        },
        30_000
      );
    }
  });

  describe('Montana At-Large Cities (False Positive Check)', () => {
    const scanner = new ArcGISHubScanner();
    const atLargeCities = MONTANA_GROUND_TRUTH.filter((c) => c.governanceType === 'at-large');

    for (const city of atLargeCities) {
      it(
        `correctly skips ${city.name} (at-large)`,
        async () => {
          const result = await validateCity(scanner, city);

          // We expect NOT to find boundary data for at-large cities
          // If we find data, it's a false positive
          if (result.found) {
            console.warn(
              `⚠️  FALSE POSITIVE: Found boundary data for at-large city ${city.name}`
            );
          }

          expect(result.matchesGroundTruth).toBe(true);

          // Rate limit
          await delay(API_RATE_LIMIT_MS);
        },
        30_000
      );
    }
  });

  describe('Overall Metrics', () => {
    it(
      'achieves 80%+ recall on district-based cities',
      async () => {
        const scanner = new ArcGISHubScanner();
        const districtCities = MONTANA_GROUND_TRUTH.filter(
          (c) => c.governanceType !== 'at-large'
        );

        const results: ValidationResult[] = [];

        for (const city of districtCities) {
          const result = await validateCity(scanner, city);
          results.push(result);
          await delay(API_RATE_LIMIT_MS);
        }

        const found = results.filter((r) => r.found).length;
        const total = results.length;
        const recall = found / total;

        console.log(`Recall: ${found}/${total} (${(recall * 100).toFixed(1)}%)`);

        expect(recall).toBeGreaterThanOrEqual(0.8);
      },
      300_000 // 5 minutes timeout
    );

    it(
      'achieves 80%+ precision (avoids at-large false positives)',
      async () => {
        const scanner = new ArcGISHubScanner();
        const atLargeCities = MONTANA_GROUND_TRUTH.filter(
          (c) => c.governanceType === 'at-large'
        );

        const results: ValidationResult[] = [];

        for (const city of atLargeCities) {
          const result = await validateCity(scanner, city);
          results.push(result);
          await delay(API_RATE_LIMIT_MS);
        }

        const correctlySkipped = results.filter((r) => !r.found).length;
        const total = results.length;
        const precision = correctlySkipped / total;

        console.log(
          `Precision: ${correctlySkipped}/${total} (${(precision * 100).toFixed(1)}%)`
        );

        expect(precision).toBeGreaterThanOrEqual(0.8);
      },
      180_000 // 3 minutes timeout
    );
  });
});
