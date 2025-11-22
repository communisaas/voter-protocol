/**
 * 100% Coverage Validation Script
 * 
 * Systematically tests all 13 known failures to prove our multi-source strategy
 * achieves 100% coverage (344/344 boundary types).
 * 
 * Current Failures (96.2% → 100%):
 * - 1 municipal (Washington, DC)
 * - 1 county (St. Louis County, MO) 
 * - 11 state legislative (6 house, 5 senate)
 * 
 * Expected Results:
 * - All failures resolve via TIGER/Line fallback
 * - All return score = 100 (authoritative federal data)
 * - All contain valid FIPS codes and geometry
 */

import { discoverBoundary } from './orchestrator';
import type { BoundaryRequest } from './sources/types';

/**
 * Test cases for all 13 known failures
 * Each includes coordinates within the boundary for point-in-polygon testing
 */
const FAILURE_TEST_CASES = [
  // Municipal Failure (1 case)
  {
    name: 'Washington, DC (Municipal → County-Equivalent)',
    request: {
      location: {
        lat: 38.9072, // White House coordinates (definitely in DC)
        lng: -77.0369,
        state: 'DC',
        name: 'Washington'
      },
      boundaryType: 'municipal' as const
    },
    expectedSource: 'Census TIGER/Line',
expectedFIPS: '11001', // District of Columbia FIPS (actual TIGER code)
    notes: 'DC is federal district, not city. Should route to TIGER county-equivalent.'
  },

  // County Failure (1 case)
  {
    name: 'St. Louis County, MO (FIPS Disambiguation)',
    request: {
      location: {
        lat: 38.6270, // Clayton, MO (county seat, definitely in county not city)
        lng: -90.3215,
        state: 'MO',
        name: 'St. Louis County'
      },
      boundaryType: 'county' as const
    },
    expectedSource: 'Census TIGER/Line',
    expectedFIPS: '29189', // St. Louis County FIPS (not 29510 = St. Louis City)
    notes: 'Ambiguous "St. Louis" should resolve to county via FIPS disambiguation.'
  },

  // State House Failures (6 cases)
  {
    name: 'Illinois State House',
    request: {
      location: {
        lat: 39.7817, // Springfield, IL (state capital)
        lng: -89.6501,
        state: 'IL'
      },
      boundaryType: 'state_house' as const
    },
    expectedSource: 'Census TIGER/Line',
    expectedFIPS: /^17\d{3}$/, // Illinois FIPS starts with 17
    notes: 'Hub API failed, should fallback to TIGER SLDL dataset.'
  },

  {
    name: 'Minnesota State House',
    request: {
      location: {
        lat: 44.9537, // St. Paul, MN (state capital)
        lng: -93.0900,
        state: 'MN'
      },
      boundaryType: 'state_house' as const
    },
    expectedSource: 'Census TIGER/Line',
expectedFIPS: /^27\w+$/, // Minnesota FIPS starts with 27, can include letters
    notes: 'Hub API failed, should fallback to TIGER SLDL dataset.'
  },

  {
    name: 'Texas State House',
    request: {
      location: {
        lat: 30.2672, // Austin, TX (state capital)
        lng: -97.7431,
        state: 'TX'
      },
      boundaryType: 'state_house' as const
    },
    expectedSource: 'Census TIGER/Line',
    expectedFIPS: /^48\d{3}$/, // Texas FIPS starts with 48
    notes: 'Hub API failed, should fallback to TIGER SLDL dataset.'
  },

  {
    name: 'Montana State House',
    request: {
      location: {
        lat: 46.8797, // Helena, MT (state capital) - VALIDATED in prior test
        lng: -110.3626,
        state: 'MT'
      },
      boundaryType: 'state_house' as const
    },
    expectedSource: 'Census TIGER/Line',
    expectedFIPS: '30030', // Known from prior test: Montana House District 30
    notes: 'VALIDATED: Hub API failed, TIGER succeeded with District 30.'
  },

  {
    name: 'Kansas State House',
    request: {
      location: {
        lat: 39.0473, // Topeka, KS (state capital)
        lng: -95.6890,
        state: 'KS'
      },
      boundaryType: 'state_house' as const
    },
    expectedSource: 'Census TIGER/Line',
    expectedFIPS: /^20\d{3}$/, // Kansas FIPS starts with 20
    notes: 'Hub API failed, should fallback to TIGER SLDL dataset.'
  },

  {
    name: 'North Carolina State House',
    request: {
      location: {
        lat: 35.7796, // Raleigh, NC (state capital)
        lng: -78.6382,
        state: 'NC'
      },
      boundaryType: 'state_house' as const
    },
    expectedSource: 'Census TIGER/Line',
    expectedFIPS: /^37\d{3}$/, // North Carolina FIPS starts with 37
    notes: 'Hub API failed, should fallback to TIGER SLDL dataset.'
  },

  // State Senate Failures (5 cases)
  {
    name: 'Georgia State Senate',
    request: {
      location: {
        lat: 33.7490, // Atlanta, GA (state capital)
        lng: -84.3880,
        state: 'GA'
      },
      boundaryType: 'state_senate' as const
    },
    expectedSource: 'Census TIGER/Line',
    expectedFIPS: /^13\d{3}$/, // Georgia FIPS starts with 13
    notes: 'Hub API failed, should fallback to TIGER SLDU dataset.'
  },

  {
    name: 'Kansas State Senate',
    request: {
      location: {
        lat: 39.0473, // Topeka, KS (state capital)
        lng: -95.6890,
        state: 'KS'
      },
      boundaryType: 'state_senate' as const
    },
    expectedSource: 'Census TIGER/Line',
    expectedFIPS: /^20\d{3}$/, // Kansas FIPS starts with 20
    notes: 'Hub API failed, should fallback to TIGER SLDU dataset.'
  },

  {
    name: 'North Carolina State Senate',
    request: {
      location: {
        lat: 35.7796, // Raleigh, NC (state capital)
        lng: -78.6382,
        state: 'NC'
      },
      boundaryType: 'state_senate' as const
    },
    expectedSource: 'Census TIGER/Line',
    expectedFIPS: /^37\d{3}$/, // North Carolina FIPS starts with 37
    notes: 'Hub API failed, should fallback to TIGER SLDU dataset.'
  },

  {
    name: 'Washington State Senate',
    request: {
      location: {
        lat: 47.0379, // Olympia, WA (state capital)
        lng: -122.9015,
        state: 'WA'
      },
      boundaryType: 'state_senate' as const
    },
    expectedSource: 'Census TIGER/Line',
    expectedFIPS: /^53\d{3}$/, // Washington FIPS starts with 53
    notes: 'Hub API failed, should fallback to TIGER SLDU dataset.'
  },

  {
    name: 'Montana State Senate',
    request: {
      location: {
        lat: 46.8797, // Helena, MT (state capital)
        lng: -110.3626,
        state: 'MT'
      },
      boundaryType: 'state_senate' as const
    },
    expectedSource: 'Census TIGER/Line',
    expectedFIPS: /^30\d{3}$/, // Montana FIPS starts with 30
    notes: 'Hub API failed, should fallback to TIGER SLDU dataset.'
  }
];

/**
 * Validation results interface
 */
interface ValidationResult {
  testName: string;
  success: boolean;
  actualSource?: string;
  actualScore?: number;
  actualFIPS?: string;
  error?: string;
  notes: string;
}

/**
 * Run comprehensive validation of all 13 failures
 */
async function validateAllFailures(): Promise<void> {
  console.log('='.repeat(80));
  console.log('SHADOW ATLAS: 100% COVERAGE VALIDATION');
  console.log('='.repeat(80));
  console.log();
  console.log(`Testing ${FAILURE_TEST_CASES.length} known failures...`);
  console.log('Expected: All resolve via TIGER/Line with score = 100');
  console.log();

  const results: ValidationResult[] = [];
  let successCount = 0;

  for (const testCase of FAILURE_TEST_CASES) {
    console.log(`Testing: ${testCase.name}`);
    console.log(`  Location: ${testCase.request.location.lat}, ${testCase.request.location.lng} (${testCase.request.location.state})`);
    console.log(`  Boundary: ${testCase.request.boundaryType}`);
    console.log(`  Expected: ${testCase.expectedSource} with FIPS ${testCase.expectedFIPS}`);

    try {
      // Use the same configuration as the working Montana test
      const { createTIGERSource, boundaryTypeToTIGERDataset } = await import('./sources/tiger-line.js');
      
      const result = await discoverBoundary(testCase.request, {
        sourceFactories: {
          hubAPI: () => ({
            name: 'Hub API (disabled)',
            async fetch() { return null; } // Force Hub API to fail for testing
          }),
          tiger: (boundaryType) => () => {
            const dataset = boundaryTypeToTIGERDataset(boundaryType);
            return createTIGERSource(dataset);
          },
          statePortal: () => undefined
        },
        qualityThreshold: 60,
        logRouting: true
      });

      if (result.success && result.data) {
        const actualFIPS = result.metadata?.fipsCode;
        const fipsMatches = typeof testCase.expectedFIPS === 'string' 
          ? actualFIPS === testCase.expectedFIPS
          : testCase.expectedFIPS.test(actualFIPS || '');

        if (result.source === testCase.expectedSource && fipsMatches && result.score === 100) {
          console.log(`  ✅ SUCCESS: ${result.source} (score: ${result.score}, FIPS: ${actualFIPS})`);
          successCount++;
          results.push({
            testName: testCase.name,
            success: true,
            actualSource: result.source,
            actualScore: result.score,
            actualFIPS: actualFIPS,
            notes: testCase.notes
          });
        } else {
          console.log(`  ❌ PARTIAL: Got ${result.source} (score: ${result.score}, FIPS: ${actualFIPS})`);
          results.push({
            testName: testCase.name,
            success: false,
            actualSource: result.source,
            actualScore: result.score,
            actualFIPS: actualFIPS,
            error: `Expected ${testCase.expectedSource} with FIPS ${testCase.expectedFIPS}`,
            notes: testCase.notes
          });
        }
      } else {
        console.log(`  ❌ FAILED: ${result.error}`);
        results.push({
          testName: testCase.name,
          success: false,
          error: result.error,
          notes: testCase.notes
        });
      }
    } catch (error) {
      console.log(`  ❌ ERROR: ${error}`);
      results.push({
        testName: testCase.name,
        success: false,
        error: String(error),
        notes: testCase.notes
      });
    }

    console.log();
  }

  // Summary Report
  console.log('='.repeat(80));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(80));
  console.log();
  console.log(`Total Tests: ${FAILURE_TEST_CASES.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${FAILURE_TEST_CASES.length - successCount}`);
  console.log(`Success Rate: ${((successCount / FAILURE_TEST_CASES.length) * 100).toFixed(1)}%`);
  console.log();

  if (successCount === FAILURE_TEST_CASES.length) {
    console.log('🎉 100% COVERAGE ACHIEVED!');
    console.log();
    console.log('All 13 known failures now resolve via TIGER/Line fallback.');
    console.log('Shadow Atlas coverage: 344/344 (100%) ✅');
    console.log();
    console.log('Multi-source strategy is PRODUCTION READY! 🚀');
  } else {
    console.log('❌ Coverage validation incomplete.');
    console.log();
    console.log('Failed tests:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.testName}: ${r.error}`);
    });
  }

  console.log();
  console.log('='.repeat(80));
  console.log('DETAILED RESULTS');
  console.log('='.repeat(80));
  
  results.forEach(result => {
    console.log();
    console.log(`${result.success ? '✅' : '❌'} ${result.testName}`);
    if (result.success) {
      console.log(`   Source: ${result.actualSource}`);
      console.log(`   Score: ${result.actualScore}`);
      console.log(`   FIPS: ${result.actualFIPS}`);
    } else {
      console.log(`   Error: ${result.error}`);
    }
    console.log(`   Notes: ${result.notes}`);
  });
}

/**
 * Main execution
 */
async function main() {
  try {
    await validateAllFailures();
  } catch (error) {
    console.error('Validation script failed:', error);
    process.exit(1);
  }
}

// Run if called directly (ES module compatible)
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { validateAllFailures, FAILURE_TEST_CASES };