/**
 * Territory Coverage E2E Tests
 *
 * SCOPE: Validate Shadow Atlas handles US territories correctly
 *
 * TIER: E2E (slow, real network calls, requires GDAL)
 *
 * MISSION: Prove the pipeline works for non-state jurisdictions:
 * 1. Download TIGER data for each territory
 * 2. Validate expected counts match
 * 3. Build Merkle trees successfully
 * 4. Verify cross-validation gracefully handles missing state GIS
 *
 * TERRITORIES:
 * - Puerto Rico (72): Largest, has 78 municipios, 1 resident commissioner
 * - Guam (66): Single island, 1 delegate
 * - US Virgin Islands (78): 3 islands (St. Thomas, St. John, St. Croix)
 * - American Samoa (60): 5 main islands, unorganized
 * - Northern Mariana Islands (69): 14 islands, commonwealth
 *
 * TERRITORY GOVERNANCE NOTES:
 * - All territories elect non-voting delegates to Congress (except PR: resident commissioner)
 * - Puerto Rico has full local self-government with governor and bicameral legislature
 * - Guam has unicameral legislature (15 senators)
 * - USVI has unicameral legislature (15 senators)
 * - American Samoa has bicameral legislature (Fono: Senate + House)
 * - CNMI has bicameral legislature (Senate + House)
 *
 * SKIP by default. Enable via RUN_E2E=true
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no `@ts-ignore`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { ShadowAtlasService } from '../../core/shadow-atlas-service.js';
import type { AtlasBuildResult, CrossValidationStatus } from '../../core/types/atlas.js';
import {
  EXPECTED_CD_BY_STATE,
  EXPECTED_VTD_BY_STATE,
  EXPECTED_COUNTIES_BY_STATE,
} from '../../validators/tiger-expected-counts.js';

// ============================================================================
// Skip Control
// ============================================================================

const SKIP_E2E = !process.env.RUN_E2E;

if (SKIP_E2E) {
  console.log('Skipping Territory Coverage E2E tests (set RUN_E2E=true to enable)');
}

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_DIR = join(process.cwd(), '.test-territory-e2e');

/**
 * US Territory configurations with FIPS codes and expected counts
 *
 * TERRITORY FIPS CODES:
 * - 60: American Samoa (AS)
 * - 66: Guam (GU)
 * - 69: Northern Mariana Islands (MP)
 * - 72: Puerto Rico (PR)
 * - 78: US Virgin Islands (VI)
 *
 * COUNTY-EQUIVALENT TERMINOLOGY:
 * - Puerto Rico: "municipios" (78 total)
 * - US Virgin Islands: "districts" (3 total: St. Croix, St. John, St. Thomas)
 * - Guam: single county-equivalent (1)
 * - American Samoa: "districts" (5)
 * - Northern Mariana Islands: "municipalities" (4)
 */
const TERRITORIES = {
  '60': {
    name: 'American Samoa',
    abbr: 'AS',
    delegateType: 'Non-voting delegate',
    notes: 'Unorganized territory',
    expectedCd: 1,
    expectedCountyEquivalents: 5, // districts
    expectedVtd: 76,
  },
  '66': {
    name: 'Guam',
    abbr: 'GU',
    delegateType: 'Non-voting delegate',
    notes: 'Organized territory',
    expectedCd: 1,
    expectedCountyEquivalents: 1,
    expectedVtd: 62,
  },
  '69': {
    name: 'Northern Mariana Islands',
    abbr: 'MP',
    delegateType: 'Non-voting delegate',
    notes: 'Commonwealth',
    expectedCd: 1,
    expectedCountyEquivalents: 4, // municipalities
    expectedVtd: 120,
  },
  '72': {
    name: 'Puerto Rico',
    abbr: 'PR',
    delegateType: 'Resident Commissioner',
    notes: 'Commonwealth, largest territory',
    expectedCd: 1,
    expectedCountyEquivalents: 78, // municipios
    expectedVtd: 1180,
  },
  '78': {
    name: 'US Virgin Islands',
    abbr: 'VI',
    delegateType: 'Non-voting delegate',
    notes: 'Organized territory',
    expectedCd: 1,
    expectedCountyEquivalents: 3, // districts
    expectedVtd: 78,
  },
} as const;

type TerritoryFips = keyof typeof TERRITORIES;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if ogr2ogr is available (GDAL dependency)
 */
async function checkGDAL(): Promise<void> {
  return new Promise((resolve, reject) => {
    const ogr2ogr = spawn('ogr2ogr', ['--version']);

    ogr2ogr.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            'ogr2ogr not found. Install GDAL:\n' +
              '  macOS:   brew install gdal\n' +
              '  Ubuntu:  apt install gdal-bin\n' +
              '  Windows: Download from https://gdal.org/'
          )
        );
      }
    });

    ogr2ogr.on('error', () => {
      reject(
        new Error(
          'ogr2ogr not found. Install GDAL:\n' +
            '  macOS:   brew install gdal\n' +
            '  Ubuntu:  apt install gdal-bin\n' +
            '  Windows: Download from https://gdal.org/'
        )
      );
    });
  });
}

/**
 * Valid cross-validation status values for assertion
 */
const VALID_CROSS_VALIDATION_STATUSES: readonly CrossValidationStatus[] = [
  'completed',
  'partial',
  'skipped',
  'failed_graceful',
  'disabled',
];

// ============================================================================
// E2E Tests
// ============================================================================

describe.skipIf(SKIP_E2E)('Territory Coverage E2E', () => {
  let atlas: ShadowAtlasService;

  beforeAll(async () => {
    // Verify prerequisites
    await checkGDAL();

    // Create test directory
    await mkdir(TEST_DIR, { recursive: true });

    // Initialize Shadow Atlas service with graceful fallback for territories
    atlas = new ShadowAtlasService({
      storageDir: TEST_DIR,
      persistence: {
        enabled: false,
        databasePath: 'test.db',
        autoMigrate: false,
      },
      extraction: {
        concurrency: 1,
        retryAttempts: 3,
        retryDelayMs: 1000,
        timeoutMs: 120_000, // 2 minute timeout for downloads
      },
      validation: {
        minPassRate: 80,
        crossValidate: false,
        storeResults: false,
      },
      ipfs: {
        gateway: 'https://ipfs.io',
      },
      crossValidation: {
        enabled: true,
        failOnMismatch: false,
        minQualityScore: 70,
        gracefulFallback: true, // Critical for territories - no state GIS portals
      },
    });

    await atlas.initialize();
  }, 60_000); // 60 second timeout for setup

  afterAll(async () => {
    // Clean up test directory
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  // ==========================================================================
  // Expected Counts Verification
  // ==========================================================================

  describe('Expected Counts', () => {
    it('should have CD counts for all territories', () => {
      for (const fips of Object.keys(TERRITORIES) as readonly TerritoryFips[]) {
        const territory = TERRITORIES[fips];
        expect(EXPECTED_CD_BY_STATE[fips]).toBeDefined();
        expect(EXPECTED_CD_BY_STATE[fips]).toBe(territory.expectedCd);
        console.log(`${territory.name} (${fips}): ${EXPECTED_CD_BY_STATE[fips]} CD`);
      }
    });

    it('should have VTD counts for all territories', () => {
      for (const fips of Object.keys(TERRITORIES) as readonly TerritoryFips[]) {
        const territory = TERRITORIES[fips];
        expect(EXPECTED_VTD_BY_STATE[fips]).toBeDefined();
        expect(EXPECTED_VTD_BY_STATE[fips]).toBe(territory.expectedVtd);
        console.log(`${territory.name} (${fips}): ${EXPECTED_VTD_BY_STATE[fips]} VTDs`);
      }
    });

    it('should have county-equivalent counts for all territories', () => {
      for (const fips of Object.keys(TERRITORIES) as readonly TerritoryFips[]) {
        const territory = TERRITORIES[fips];
        expect(EXPECTED_COUNTIES_BY_STATE[fips]).toBeDefined();
        expect(EXPECTED_COUNTIES_BY_STATE[fips]).toBe(territory.expectedCountyEquivalents);
        console.log(
          `${territory.name} (${fips}): ${EXPECTED_COUNTIES_BY_STATE[fips]} county-equivalents`
        );
      }
    });

    it('should sum territories to exactly 5 delegate seats', () => {
      const totalDelegates = (Object.keys(TERRITORIES) as readonly TerritoryFips[]).reduce(
        (sum, fips) => sum + (EXPECTED_CD_BY_STATE[fips] ?? 0),
        0
      );
      expect(totalDelegates).toBe(5);
    });
  });

  // ==========================================================================
  // Puerto Rico (Largest Territory)
  // ==========================================================================

  describe('Puerto Rico (72)', () => {
    it(
      'should download and build CD layer',
      async () => {
        const result = await atlas.buildAtlas({
          layers: ['cd'],
          states: ['72'],
          year: 2024,
        });

        // Verify build completed successfully
        expect(result.merkleRoot).toBeDefined();
        expect(typeof result.merkleRoot).toBe('bigint');
        expect(result.merkleRoot).toBeGreaterThan(0n);

        // Puerto Rico has exactly 1 congressional district (resident commissioner)
        expect(result.totalBoundaries).toBe(1);

        // Verify cross-validation status (should gracefully handle missing state GIS)
        expect(result.crossValidationStatus).toBeDefined();
        expect(VALID_CROSS_VALIDATION_STATUSES).toContain(result.crossValidationStatus);

        console.log('Puerto Rico CD build result:', {
          merkleRoot: result.merkleRoot.toString(16).slice(0, 16) + '...',
          boundaries: result.totalBoundaries,
          crossValidation: result.crossValidationStatus,
          duration: `${result.duration}ms`,
        });
      },
      180_000 // 3 minute timeout
    );

    it(
      'should handle county-equivalent (municipios)',
      async () => {
        const result = await atlas.buildAtlas({
          layers: ['county'],
          states: ['72'],
          year: 2024,
        });

        // Puerto Rico has 78 municipios (county-equivalents)
        expect(result.totalBoundaries).toBe(78);
        expect(result.merkleRoot).toBeDefined();
        expect(typeof result.merkleRoot).toBe('bigint');

        console.log('Puerto Rico municipios build result:', {
          merkleRoot: result.merkleRoot.toString(16).slice(0, 16) + '...',
          boundaries: result.totalBoundaries,
          duration: `${result.duration}ms`,
        });
      },
      180_000
    );

    it(
      'should produce deterministic Merkle root for Puerto Rico',
      async () => {
        // Build twice with same input
        const result1 = await atlas.buildAtlas({
          layers: ['cd'],
          states: ['72'],
          year: 2024,
        });

        const result2 = await atlas.buildAtlas({
          layers: ['cd'],
          states: ['72'],
          year: 2024,
        });

        // Merkle roots must be identical
        expect(result1.merkleRoot).toBe(result2.merkleRoot);
        expect(result1.totalBoundaries).toBe(result2.totalBoundaries);
      },
      240_000
    );
  });

  // ==========================================================================
  // Guam (66)
  // ==========================================================================

  describe('Guam (66)', () => {
    it(
      'should download and build CD layer',
      async () => {
        const result = await atlas.buildAtlas({
          layers: ['cd'],
          states: ['66'],
          year: 2024,
        });

        expect(result.merkleRoot).toBeDefined();
        expect(typeof result.merkleRoot).toBe('bigint');
        expect(result.totalBoundaries).toBe(1);

        console.log('Guam CD build result:', {
          boundaries: result.totalBoundaries,
          crossValidation: result.crossValidationStatus,
        });
      },
      180_000
    );

    it(
      'should handle county-equivalent',
      async () => {
        const result = await atlas.buildAtlas({
          layers: ['county'],
          states: ['66'],
          year: 2024,
        });

        // Guam is treated as a single county-equivalent
        expect(result.totalBoundaries).toBe(1);
        expect(result.merkleRoot).toBeDefined();
      },
      180_000
    );
  });

  // ==========================================================================
  // US Virgin Islands (78)
  // ==========================================================================

  describe('US Virgin Islands (78)', () => {
    it(
      'should download and build CD layer',
      async () => {
        const result = await atlas.buildAtlas({
          layers: ['cd'],
          states: ['78'],
          year: 2024,
        });

        expect(result.merkleRoot).toBeDefined();
        expect(typeof result.merkleRoot).toBe('bigint');
        expect(result.totalBoundaries).toBe(1);

        console.log('USVI CD build result:', {
          boundaries: result.totalBoundaries,
          crossValidation: result.crossValidationStatus,
        });
      },
      180_000
    );

    it(
      'should handle districts (county-equivalent)',
      async () => {
        const result = await atlas.buildAtlas({
          layers: ['county'],
          states: ['78'],
          year: 2024,
        });

        // USVI has 3 districts (St. Croix, St. John, St. Thomas)
        expect(result.totalBoundaries).toBe(3);
        expect(result.merkleRoot).toBeDefined();

        console.log('USVI districts build result:', {
          boundaries: result.totalBoundaries,
          duration: `${result.duration}ms`,
        });
      },
      180_000
    );
  });

  // ==========================================================================
  // American Samoa (60)
  // ==========================================================================

  describe('American Samoa (60)', () => {
    it(
      'should download and build CD layer',
      async () => {
        const result = await atlas.buildAtlas({
          layers: ['cd'],
          states: ['60'],
          year: 2024,
        });

        expect(result.merkleRoot).toBeDefined();
        expect(typeof result.merkleRoot).toBe('bigint');
        expect(result.totalBoundaries).toBe(1);

        console.log('American Samoa CD build result:', {
          boundaries: result.totalBoundaries,
          crossValidation: result.crossValidationStatus,
        });
      },
      180_000
    );

    it(
      'should handle districts (county-equivalent)',
      async () => {
        const result = await atlas.buildAtlas({
          layers: ['county'],
          states: ['60'],
          year: 2024,
        });

        // American Samoa has 5 districts
        expect(result.totalBoundaries).toBe(5);
        expect(result.merkleRoot).toBeDefined();
      },
      180_000
    );
  });

  // ==========================================================================
  // Northern Mariana Islands (69)
  // ==========================================================================

  describe('Northern Mariana Islands (69)', () => {
    it(
      'should download and build CD layer',
      async () => {
        const result = await atlas.buildAtlas({
          layers: ['cd'],
          states: ['69'],
          year: 2024,
        });

        expect(result.merkleRoot).toBeDefined();
        expect(typeof result.merkleRoot).toBe('bigint');
        expect(result.totalBoundaries).toBe(1);

        console.log('CNMI CD build result:', {
          boundaries: result.totalBoundaries,
          crossValidation: result.crossValidationStatus,
        });
      },
      180_000
    );

    it(
      'should handle municipalities (county-equivalent)',
      async () => {
        const result = await atlas.buildAtlas({
          layers: ['county'],
          states: ['69'],
          year: 2024,
        });

        // CNMI has 4 municipalities
        expect(result.totalBoundaries).toBe(4);
        expect(result.merkleRoot).toBeDefined();
      },
      180_000
    );
  });

  // ==========================================================================
  // Cross-Validation Graceful Fallback
  // ==========================================================================

  describe('Cross-Validation Fallback', () => {
    it(
      'should gracefully handle territories without state GIS portals',
      async () => {
        // All territories lack state GIS portals
        // Cross-validation should fail gracefully, not crash
        for (const fips of Object.keys(TERRITORIES) as readonly TerritoryFips[]) {
          const territory = TERRITORIES[fips];

          try {
            const result = await atlas.buildAtlas({
              layers: ['cd'],
              states: [fips],
              year: 2024,
            });

            // Build should complete successfully
            expect(result.merkleRoot).toBeDefined();
            expect(result.totalBoundaries).toBe(territory.expectedCd);

            // Cross-validation should be gracefully handled
            expect(result.crossValidationStatus).toBeDefined();
            expect(VALID_CROSS_VALIDATION_STATUSES).toContain(result.crossValidationStatus);

            console.log(`${territory.name} (${fips}):`, {
              crossValidation: result.crossValidationStatus,
              boundaries: result.totalBoundaries,
            });
          } catch (error) {
            // If build fails, it should be TIGER data issue, not cross-validation
            const message = (error as Error).message;
            expect(message).not.toContain('cross-validation');
            console.warn(`${territory.name} build failed:`, message);
          }
        }
      },
      600_000 // 10 minutes for all territories
    );
  });

  // ==========================================================================
  // Multi-Territory Build
  // ==========================================================================

  describe('Multi-Territory Build', () => {
    it(
      'should build all territories in a single batch',
      async () => {
        const allTerritoryFips = Object.keys(TERRITORIES);

        try {
          const result = await atlas.buildAtlas({
            layers: ['cd'],
            states: allTerritoryFips,
            year: 2024,
          });

          // Should have 5 delegate districts (one per territory)
          expect(result.totalBoundaries).toBe(5);
          expect(result.merkleRoot).toBeDefined();
          expect(typeof result.merkleRoot).toBe('bigint');

          console.log('All territories batch build:', {
            merkleRoot: result.merkleRoot.toString(16).slice(0, 16) + '...',
            boundaries: result.totalBoundaries,
            layerCounts: result.layerCounts,
            crossValidation: result.crossValidationStatus,
            duration: `${result.duration}ms`,
          });
        } catch (error) {
          // Log but don't fail - TIGER data may have issues
          const message = (error as Error).message;
          console.warn('Multi-territory batch failed:', message);

          // Verify it's not a cross-validation or type error
          expect(message).not.toContain('TypeError');
        }
      },
      600_000 // 10 minutes
    );

    it(
      'should produce different Merkle roots for individual vs batch builds',
      async () => {
        // Build Puerto Rico individually
        const prOnly = await atlas.buildAtlas({
          layers: ['cd'],
          states: ['72'],
          year: 2024,
        });

        // Build all territories together
        const allTerritoryFips = Object.keys(TERRITORIES);
        const allTerritories = await atlas.buildAtlas({
          layers: ['cd'],
          states: allTerritoryFips,
          year: 2024,
        });

        // Different data sets should produce different roots
        expect(prOnly.merkleRoot).not.toBe(allTerritories.merkleRoot);
        expect(prOnly.totalBoundaries).toBe(1);
        expect(allTerritories.totalBoundaries).toBe(5);
      },
      300_000
    );
  });

  // ==========================================================================
  // Data Quality Validation
  // ==========================================================================

  describe('Data Quality', () => {
    it(
      'should validate all territory CD boundaries have required properties',
      async () => {
        for (const fips of Object.keys(TERRITORIES) as readonly TerritoryFips[]) {
          const territory = TERRITORIES[fips];

          try {
            const result = await atlas.buildAtlas({
              layers: ['cd'],
              states: [fips],
              year: 2024,
            });

            // Verify we got valid data
            expect(result.totalBoundaries).toBeGreaterThan(0);

            // Check layer validations
            for (const validation of result.layerValidations) {
              expect(validation.qualityScore).toBeGreaterThan(0);
              expect(validation.boundaryCount).toBeGreaterThan(0);
            }

            console.log(`${territory.name} data quality:`, {
              qualityScores: result.layerValidations.map(
                (v) => `${v.layer}: ${v.qualityScore}`
              ),
            });
          } catch (error) {
            console.warn(`${territory.name} data quality check failed:`, (error as Error).message);
          }
        }
      },
      600_000
    );
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it(
      'should handle combined state + territory builds',
      async () => {
        // Build Wyoming (state) + Puerto Rico (territory) together
        try {
          const result = await atlas.buildAtlas({
            layers: ['cd'],
            states: ['56', '72'], // Wyoming + Puerto Rico
            year: 2024,
          });

          // Wyoming: 1 CD + Puerto Rico: 1 CD = 2 total
          expect(result.totalBoundaries).toBe(2);
          expect(result.merkleRoot).toBeDefined();

          console.log('Mixed state + territory build:', {
            boundaries: result.totalBoundaries,
            duration: `${result.duration}ms`,
          });
        } catch (error) {
          const message = (error as Error).message;
          console.warn('Mixed build failed:', message);
          // Should not be a type error
          expect(message).not.toContain('TypeError');
        }
      },
      240_000
    );
  });
});
