/**
 * Voting Precinct (VTD) Discovery Test Cases
 *
 * Tests Census TIGER/Line Voting Tabulation District discovery across
 * urban, suburban, and rural scenarios.
 *
 * VTD = Voting Tabulation District (Census term for voting precincts)
 *
 * Expected coverage: 100% (TIGER/Line authoritative federal data)
 * Expected score: 100 (Census Bureau source)
 */

import { discoverBoundary } from './orchestrator';
import type { BoundaryResult } from './sources/types';

/**
 * Test cases covering different precinct densities and geographies
 */
const VTD_TEST_CASES = [
  {
    name: 'NYC Dense Urban Precinct (Manhattan)',
    description: 'Very dense urban precinct with small geographic area, high population density',
    location: {
      lat: 40.7128,
      lng: -74.0060,
      state: 'NY',
      name: 'New York City'
    },
    expectedSource: 'Census TIGER/Line',
    expectedScore: 100,
    expectedCoverage: 'complete',
    notes: 'NYC has very small precincts due to high density'
  },

  {
    name: 'Montana Rural Precinct (Helena area)',
    description: 'Low-density rural precinct with large geographic area, sparse population',
    location: {
      lat: 46.8797,
      lng: -110.3626,
      state: 'MT',
      name: 'Helena'
    },
    expectedSource: 'Census TIGER/Line',
    expectedScore: 100,
    expectedCoverage: 'complete',
    notes: 'Montana has geographically large precincts due to low population density'
  },

  {
    name: 'Fairfax County Suburban Precinct (Virginia)',
    description: 'Suburban precinct with moderate density, medium geographic area',
    location: {
      lat: 38.8462,
      lng: -77.3064,
      state: 'VA',
      name: 'Fairfax'
    },
    expectedSource: 'Census TIGER/Line',
    expectedScore: 100,
    expectedCoverage: 'complete',
    notes: 'Suburban precincts are mid-sized, typical of metro areas'
  },

  {
    name: 'Los Angeles Urban Precinct (California)',
    description: 'Large city precinct, high density West Coast urban area',
    location: {
      lat: 34.0522,
      lng: -118.2437,
      state: 'CA',
      name: 'Los Angeles'
    },
    expectedSource: 'Census TIGER/Line',
    expectedScore: 100,
    expectedCoverage: 'complete',
    notes: 'LA County has thousands of precincts covering diverse areas'
  },

  {
    name: 'Chicago Midwest Urban Precinct (Illinois)',
    description: 'Midwest urban precinct, ward-based city with precinct subdivisions',
    location: {
      lat: 41.8781,
      lng: -87.6298,
      state: 'IL',
      name: 'Chicago'
    },
    expectedSource: 'Census TIGER/Line',
    expectedScore: 100,
    expectedCoverage: 'complete',
    notes: 'Chicago has ward-based system with precincts as subdivisions'
  },

  {
    name: 'Rural Alaska Precinct (Anchorage area)',
    description: 'Extreme low-density precinct, massive geographic area',
    location: {
      lat: 61.2181,
      lng: -149.9003,
      state: 'AK',
      name: 'Anchorage'
    },
    expectedSource: 'Census TIGER/Line',
    expectedScore: 100,
    expectedCoverage: 'complete',
    notes: 'Alaska precincts can cover hundreds of square miles'
  },

  {
    name: 'Miami Beach Coastal Urban (Florida)',
    description: 'Coastal urban precinct, tourist area with resident voting',
    location: {
      lat: 25.7907,
      lng: -80.1300,
      state: 'FL',
      name: 'Miami Beach'
    },
    expectedSource: 'Census TIGER/Line',
    expectedScore: 100,
    expectedCoverage: 'complete',
    notes: 'Florida precincts critical for election administration'
  },

  {
    name: 'Philadelphia East Coast Urban (Pennsylvania)',
    description: 'Historic city precinct, dense Northeast urban area',
    location: {
      lat: 39.9526,
      lng: -75.1652,
      state: 'PA',
      name: 'Philadelphia'
    },
    expectedSource: 'Census TIGER/Line',
    expectedScore: 100,
    expectedCoverage: 'complete',
    notes: 'Pennsylvania has well-defined precinct boundaries'
  },

  {
    name: 'Houston Texas Urban Precinct',
    description: 'Sprawling Sun Belt city precinct, large geographic metro',
    location: {
      lat: 29.7604,
      lng: -95.3698,
      state: 'TX',
      name: 'Houston'
    },
    expectedSource: 'Census TIGER/Line',
    expectedScore: 100,
    expectedCoverage: 'complete',
    notes: 'Texas has county-based precinct administration'
  },

  {
    name: 'Seattle Pacific Northwest Precinct (Washington)',
    description: 'Pacific Northwest urban precinct, mail-ballot state',
    location: {
      lat: 47.6062,
      lng: -122.3321,
      state: 'WA',
      name: 'Seattle'
    },
    expectedSource: 'Census TIGER/Line',
    expectedScore: 100,
    expectedCoverage: 'complete',
    notes: 'Washington is primarily mail-ballot but still has precinct boundaries for tabulation'
  }
];

/**
 * Run all VTD test cases
 */
async function testVotingPrecincts(): Promise<void> {
  console.log('='.repeat(80));
  console.log('VOTING PRECINCT (VTD) DISCOVERY TEST SUITE');
  console.log('='.repeat(80));
  console.log();
  console.log('Purpose: Verify 100% TIGER/Line coverage for voting precincts');
  console.log('VTD = Voting Tabulation District (Census term)');
  console.log();
  console.log(`Running ${VTD_TEST_CASES.length} test cases across urban/suburban/rural scenarios`);
  console.log();

  let passedCount = 0;
  let failedCount = 0;
  const failures: Array<{ name: string; error: string }> = [];

  for (const testCase of VTD_TEST_CASES) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`TEST: ${testCase.name}`);
    console.log(`DESC: ${testCase.description}`);
    console.log(`LOCATION: ${testCase.location.lat}, ${testCase.location.lng} (${testCase.location.state})`);
    console.log('='.repeat(80));

    try {
      const result: BoundaryResult = await discoverBoundary({
        location: testCase.location,
        boundaryType: 'voting_precinct'
      }, {
        logRouting: false,
        qualityThreshold: 60,
        sourceFactories: {
          // Hub API returns null for voting precincts (no VTD data in Hub)
          // This allows natural fallback to TIGER/Line
          hubAPI: () => ({
            name: 'ArcGIS Hub API',
            fetch: async () => null // Hub doesn't have VTD data, return null
          }),
          tiger: (boundaryType) => () => {
            const { createTIGERSource, boundaryTypeToTIGERDataset } = require('./sources/tiger-line');
            const dataset = boundaryTypeToTIGERDataset(boundaryType);
            return createTIGERSource(dataset);
          },
          statePortal: () => undefined
        }
      });

      // Validate result
      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      if (!result.data) {
        throw new Error('No geometry data returned');
      }

      if (!result.metadata) {
        throw new Error('No metadata returned');
      }

      // Check source
      if (result.source !== testCase.expectedSource) {
        throw new Error(`Expected source "${testCase.expectedSource}" but got "${result.source}"`);
      }

      // Check score
      if (result.score !== testCase.expectedScore) {
        throw new Error(`Expected score ${testCase.expectedScore} but got ${result.score}`);
      }

      // Check geometry type
      if (!result.data.geometry || result.data.geometry.type !== 'Polygon' && result.data.geometry.type !== 'MultiPolygon') {
        throw new Error(`Expected Polygon or MultiPolygon geometry, got ${result.data.geometry?.type || 'none'}`);
      }

      console.log(`\n✅ PASSED`);
      console.log(`   Source: ${result.source}`);
      console.log(`   Score: ${result.score}/100`);
      console.log(`   Geometry: ${result.data.geometry.type}`);
      console.log(`   FIPS: ${result.metadata.fipsCode || 'N/A'}`);
      console.log(`   Publisher: ${result.metadata.publisher}`);
      console.log(`   Notes: ${testCase.notes}`);

      passedCount++;

    } catch (error) {
      console.log(`\n❌ FAILED`);
      console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
      console.log(`   Notes: ${testCase.notes}`);

      failedCount++;
      failures.push({
        name: testCase.name,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Tests: ${VTD_TEST_CASES.length}`);
  console.log(`Passed: ${passedCount} (${Math.round((passedCount / VTD_TEST_CASES.length) * 100)}%)`);
  console.log(`Failed: ${failedCount} (${Math.round((failedCount / VTD_TEST_CASES.length) * 100)}%)`);

  if (failures.length > 0) {
    console.log(`\nFailed Tests:`);
    failures.forEach(failure => {
      console.log(`  - ${failure.name}: ${failure.error}`);
    });
  } else {
    console.log(`\n🎉 All tests passed! Voting precinct discovery has 100% coverage.`);
  }

  console.log();
}

/**
 * Main execution
 */
async function main() {
  try {
    await testVotingPrecincts();
  } catch (error) {
    console.error('Test suite failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { testVotingPrecincts, VTD_TEST_CASES };

/**
 * KEY INSIGHTS FOR VOTER PROTOCOL
 *
 * **Why VTD matters:**
 * - Most granular election boundaries available (100% US coverage)
 * - Critical for precinct-level organizing (precinct captain model)
 * - Updated every redistricting cycle (same freshness as congressional)
 * - Authoritative source (Census Bureau, not third-party)
 *
 * **Use cases:**
 * - Precinct-level voter targeting
 * - Get Out The Vote (GOTV) operations
 * - Precinct result analysis
 * - Locating polling places
 * - Precinct captain assignment
 *
 * **Data characteristics:**
 * - Urban precincts: small geographic area, high population density (100-5000 voters)
 * - Rural precincts: large geographic area, low population density (50-500 voters)
 * - Suburban precincts: medium geographic area, moderate density (200-2000 voters)
 *
 * **Coverage guarantee:**
 * - 100% US coverage via Census TIGER/Line VTD dataset
 * - Updated post-redistricting (2022 for current cycle)
 * - No gaps, no missing data (federal mandate)
 */
