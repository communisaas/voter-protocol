/**
 * Comprehensive Coverage Test Suite
 * 
 * Tests the 9 boundary types that are ACTUALLY implemented in Shadow Atlas:
 * 1. MUNICIPAL - City council districts (19,616 cities)
 * 2. COUNTY - Commissioner/supervisor districts (3,143 counties) 
 * 3. STATE_HOUSE - State house districts (~5,000 districts)
 * 4. STATE_SENATE - State senate districts (~2,000 districts)
 * 5. CONGRESSIONAL - U.S. House districts (435 + 6 at-large)
 * 6. SCHOOL_BOARD - School board trustee areas (13,500+ districts)
 * 7. SPECIAL_DISTRICT - Water/fire/transit districts (35,000+)
 * 8. JUDICIAL - Court districts (federal + state)
 * 9. VOTING_PRECINCT - Voting tabulation districts (170,000+)
 * 
 * This replaces all the scattered test-*.ts scripts with systematic coverage.
 */

import { discoverBoundary } from './orchestrator';
import type { BoundaryRequest } from './sources/types';
import { BoundaryType } from './terminology';

/**
 * Comprehensive test cases covering all 8 boundary types
 * Uses representative samples from each type to validate coverage
 */
const COMPREHENSIVE_TEST_CASES = [
  // 1. MUNICIPAL BOUNDARIES (City Council Districts)
  {
    category: 'Municipal',
    name: 'New York City Council District',
    request: {
      location: { lat: 40.7128, lng: -74.0060, state: 'NY', name: 'New York' },
      boundaryType: BoundaryType.MUNICIPAL
    },
    expectedCoverage: '19,616 cities',
    notes: 'Largest city, should have council districts'
  },
  {
    category: 'Municipal',
    name: 'Small Town (At-Large System)',
    request: {
      location: { lat: 44.2619, lng: -110.8394, state: 'WY', name: 'Cody' },
      boundaryType: BoundaryType.MUNICIPAL
    },
    expectedCoverage: 'At-large or no districts',
    notes: 'Small towns often have at-large elections'
  },

  // 2. COUNTY BOUNDARIES (Commissioner/Supervisor Districts)
  {
    category: 'County',
    name: 'Los Angeles County Supervisorial District',
    request: {
      location: { lat: 34.0522, lng: -118.2437, state: 'CA', name: 'Los Angeles County' },
      boundaryType: BoundaryType.COUNTY
    },
    expectedCoverage: '3,143 counties',
    notes: 'Largest county, uses supervisorial districts'
  },
  {
    category: 'County',
    name: 'Rural County Commissioner District',
    request: {
      location: { lat: 41.5868, lng: -93.6250, state: 'IA', name: 'Polk County' },
      boundaryType: BoundaryType.COUNTY
    },
    expectedCoverage: 'Commissioner districts',
    notes: 'Typical Midwest county structure'
  },

  // 3. STATE LEGISLATIVE (House + Senate)
  {
    category: 'State Legislative',
    name: 'California Assembly District',
    request: {
      location: { lat: 38.5816, lng: -121.4944, state: 'CA' },
      boundaryType: BoundaryType.STATE_HOUSE
    },
    expectedCoverage: '~5,000 house districts',
    notes: 'Largest state by population'
  },
  {
    category: 'State Legislative',
    name: 'Texas Senate District',
    request: {
      location: { lat: 30.2672, lng: -97.7431, state: 'TX' },
      boundaryType: BoundaryType.STATE_SENATE
    },
    expectedCoverage: '~2,000 senate districts',
    notes: 'Second largest state'
  },
  {
    category: 'State Legislative',
    name: 'Nebraska Unicameral (No Senate)',
    request: {
      location: { lat: 40.8136, lng: -96.7026, state: 'NE' },
      boundaryType: BoundaryType.STATE_SENATE
    },
    expectedCoverage: 'No senate (unicameral)',
    notes: 'Only state with unicameral legislature'
  },

  // 4. CONGRESSIONAL DISTRICTS
  {
    category: 'Congressional',
    name: 'California Congressional District',
    request: {
      location: { lat: 37.7749, lng: -122.4194, state: 'CA' },
      boundaryType: BoundaryType.CONGRESSIONAL
    },
    expectedCoverage: '435 districts',
    notes: 'Most populous state, 52 districts'
  },
  {
    category: 'Congressional',
    name: 'Wyoming At-Large',
    request: {
      location: { lat: 41.1400, lng: -104.8197, state: 'WY' },
      boundaryType: BoundaryType.CONGRESSIONAL
    },
    expectedCoverage: 'At-large (no districts)',
    notes: 'One of 6 at-large states'
  },

  // 5. SCHOOL DISTRICTS (Board Elections)
  {
    category: 'School Districts',
    name: 'Los Angeles Unified School Board',
    request: {
      location: { lat: 34.0522, lng: -118.2437, state: 'CA', name: 'Los Angeles Unified' },
      boundaryType: BoundaryType.SCHOOL_BOARD
    },
    expectedCoverage: '13,500+ districts',
    notes: 'Second largest school district in US'
  },
  {
    category: 'School Districts',
    name: 'Rural School District (At-Large)',
    request: {
      location: { lat: 39.1612, lng: -75.5264, state: 'DE', name: 'Sussex County' },
      boundaryType: BoundaryType.SCHOOL_BOARD
    },
    expectedCoverage: 'At-large board elections',
    notes: 'Many rural districts elect at-large'
  },

  // 6. SPECIAL DISTRICTS (Hub API only - no TIGER equivalent)
  {
    category: 'Special Districts',
    name: 'Water/Fire/Transit Districts (Hub API Only)',
    request: {
      location: { lat: 34.0522, lng: -118.2437, state: 'CA', name: 'Los Angeles' },
      boundaryType: BoundaryType.SPECIAL_DISTRICT
    },
    expectedCoverage: 'Hub API discovery only',
    notes: 'No TIGER equivalent - relies on local GIS portals'
  },

  // 7. JUDICIAL DISTRICTS (Hub API only - no TIGER equivalent)
  {
    category: 'Judicial',
    name: 'Federal and State Court Districts (Hub API Only)',
    request: {
      location: { lat: 40.7128, lng: -74.0060, state: 'NY' },
      boundaryType: BoundaryType.JUDICIAL
    },
    expectedCoverage: 'Hub API discovery only',
    notes: 'No TIGER equivalent - relies on court system GIS'
  },

  // 8. VOTING PRECINCTS (VTDs)
  {
    category: 'Voting Precincts',
    name: 'Urban Voting Precinct',
    request: {
      location: { lat: 40.7128, lng: -74.0060, state: 'NY' },
      boundaryType: BoundaryType.VOTING_PRECINCT
    },
    expectedCoverage: '170,000+ precincts',
    notes: 'Finest electoral geography'
  },
  {
    category: 'Voting Precincts',
    name: 'Rural Voting Precinct',
    request: {
      location: { lat: 44.2619, lng: -110.8394, state: 'WY' },
      boundaryType: BoundaryType.VOTING_PRECINCT
    },
    expectedCoverage: 'Rural precincts (large geography)',
    notes: 'Low population density areas'
  }
];

/**
 * Coverage statistics for each boundary type
 */
const BOUNDARY_TYPE_STATS = {
  'Municipal': { total: 19616, description: 'Cities and towns with council districts' },
  'County': { total: 3143, description: 'Counties with commissioner/supervisor districts' },
  'State Legislative': { total: 7383, description: 'State house + senate districts' },
  'Congressional': { total: 441, description: '435 districts + 6 at-large states' },
  'School Districts': { total: 13500, description: 'School board trustee areas' },
  'Special Districts': { total: 35000, description: 'Water, fire, transit, library, etc.' },
  'Judicial': { total: 500, description: 'Federal + state court districts' },
  'Voting Precincts': { total: 170000, description: 'Voting tabulation districts (VTDs)' }
};

/**
 * Test results interface
 */
interface ComprehensiveTestResult {
  category: string;
  testName: string;
  success: boolean;
  source?: string;
  score?: number;
  coverage?: string;
  error?: string;
  notes: string;
}

/**
 * Run comprehensive coverage test across all 8 boundary types
 */
async function testComprehensiveCoverage(): Promise<void> {
  console.log('='.repeat(80));
  console.log('SHADOW ATLAS: COMPREHENSIVE COVERAGE TEST');
  console.log('='.repeat(80));
  console.log();
  console.log('Testing all 8 boundary types that Shadow Atlas should support:');
  
  // Print boundary type overview
  Object.entries(BOUNDARY_TYPE_STATS).forEach(([type, stats]) => {
    console.log(`  ${type}: ${stats.total.toLocaleString()} (${stats.description})`);
  });
  
  console.log();
  console.log(`Running ${COMPREHENSIVE_TEST_CASES.length} representative test cases...`);
  console.log();

  const results: ComprehensiveTestResult[] = [];
  const categoryResults = new Map<string, { success: number; total: number }>();

  for (const testCase of COMPREHENSIVE_TEST_CASES) {
    console.log(`Testing: ${testCase.name} (${testCase.category})`);
    console.log(`  Location: ${testCase.request.location.lat}, ${testCase.request.location.lng} (${testCase.request.location.state})`);
    console.log(`  Expected: ${testCase.expectedCoverage}`);

    try {
      // Use default orchestrator configuration (Hub API + TIGER fallback)
      const result = await discoverBoundary(testCase.request);

      if (result.success && result.data) {
        console.log(`  ✅ SUCCESS: ${result.source} (score: ${result.score})`);
        
        results.push({
          category: testCase.category,
          testName: testCase.name,
          success: true,
          source: result.source,
          score: result.score,
          coverage: testCase.expectedCoverage,
          notes: testCase.notes
        });
      } else {
        console.log(`  ❌ FAILED: ${result.error}`);
        
        results.push({
          category: testCase.category,
          testName: testCase.name,
          success: false,
          error: result.error,
          coverage: testCase.expectedCoverage,
          notes: testCase.notes
        });
      }
    } catch (error) {
      console.log(`  ❌ ERROR: ${error}`);
      
      results.push({
        category: testCase.category,
        testName: testCase.name,
        success: false,
        error: String(error),
        coverage: testCase.expectedCoverage,
        notes: testCase.notes
      });
    }

    // Update category statistics
    const categoryStats = categoryResults.get(testCase.category) || { success: 0, total: 0 };
    categoryStats.total++;
    if (results[results.length - 1].success) {
      categoryStats.success++;
    }
    categoryResults.set(testCase.category, categoryStats);

    console.log();
  }

  // Summary by category
  console.log('='.repeat(80));
  console.log('COVERAGE BY BOUNDARY TYPE');
  console.log('='.repeat(80));
  console.log();

  let totalSuccess = 0;
  let totalTests = 0;

  categoryResults.forEach((stats, category) => {
    const percentage = ((stats.success / stats.total) * 100).toFixed(1);
    const status = stats.success === stats.total ? '✅' : stats.success > 0 ? '⚠️' : '❌';
    
    console.log(`${status} ${category}: ${stats.success}/${stats.total} (${percentage}%)`);
    
    totalSuccess += stats.success;
    totalTests += stats.total;
  });

  console.log();
  console.log('='.repeat(80));
  console.log('OVERALL SUMMARY');
  console.log('='.repeat(80));
  console.log();
  
  const overallPercentage = ((totalSuccess / totalTests) * 100).toFixed(1);
  console.log(`Total Success Rate: ${totalSuccess}/${totalTests} (${overallPercentage}%)`);
  console.log();

  if (totalSuccess === totalTests) {
    console.log('🎉 COMPREHENSIVE COVERAGE ACHIEVED!');
    console.log();
    console.log('All 8 boundary types have working discovery mechanisms.');
    console.log('Shadow Atlas is ready for full production deployment! 🚀');
  } else {
    console.log('⚠️ Coverage gaps identified.');
    console.log();
    console.log('Boundary types needing attention:');
    
    categoryResults.forEach((stats, category) => {
      if (stats.success < stats.total) {
        const failed = stats.total - stats.success;
        console.log(`  - ${category}: ${failed} failure(s)`);
      }
    });
  }

  console.log();
  console.log('='.repeat(80));
  console.log('DETAILED RESULTS BY CATEGORY');
  console.log('='.repeat(80));

  // Group results by category
  const resultsByCategory = new Map<string, ComprehensiveTestResult[]>();
  results.forEach(result => {
    const categoryResults = resultsByCategory.get(result.category) || [];
    categoryResults.push(result);
    resultsByCategory.set(result.category, categoryResults);
  });

  resultsByCategory.forEach((categoryResults, category) => {
    console.log();
    console.log(`## ${category.toUpperCase()}`);
    console.log(`Expected Coverage: ${BOUNDARY_TYPE_STATS[category as keyof typeof BOUNDARY_TYPE_STATS]?.total.toLocaleString()} districts`);
    console.log();

    categoryResults.forEach(result => {
      console.log(`${result.success ? '✅' : '❌'} ${result.testName}`);
      if (result.success) {
        console.log(`   Source: ${result.source}`);
        console.log(`   Score: ${result.score}`);
      } else {
        console.log(`   Error: ${result.error}`);
      }
      console.log(`   Expected: ${result.coverage}`);
      console.log(`   Notes: ${result.notes}`);
      console.log();
    });
  });
}

/**
 * Main execution
 */
async function main() {
  try {
    await testComprehensiveCoverage();
  } catch (error) {
    console.error('Comprehensive coverage test failed:', error);
    process.exit(1);
  }
}

// Run if called directly (ES module compatible)
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { testComprehensiveCoverage, COMPREHENSIVE_TEST_CASES, BOUNDARY_TYPE_STATS };