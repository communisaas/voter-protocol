/**
 * County Discovery Test - Phase 2
 *
 * Quick test script to validate county district discovery across diverse governance models
 */

import { searchHubForCountyDistricts } from './hub-api-discovery';

interface CountyTest {
  name: string;
  state: string;
  expectedTerminology?: string;
  notes?: string;
}

// Test counties representing different governance models
const TEST_COUNTIES: CountyTest[] = [
  {
    name: 'Los Angeles',
    state: 'CA',
    expectedTerminology: 'supervisorial districts',
    notes: 'California supervisorial model - 5 districts'
  },
  {
    name: 'Cook',
    state: 'IL',
    expectedTerminology: 'commissioner districts',
    notes: 'Commissioner model - 17 districts (Chicago area)'
  },
  {
    name: 'Harris',
    state: 'TX',
    expectedTerminology: 'commissioner precincts',
    notes: 'Texas uses "precincts" for commissioner districts (Houston area)'
  },
  {
    name: 'Maricopa',
    state: 'AZ',
    expectedTerminology: 'supervisorial districts',
    notes: 'Arizona supervisorial model (Phoenix area)'
  },
  {
    name: 'San Diego',
    state: 'CA',
    expectedTerminology: 'supervisorial districts',
    notes: 'California supervisorial model - coastal county'
  }
];

async function testCountyDiscovery() {
  console.log('\n' + '='.repeat(80));
  console.log('🏛️  COUNTY DISTRICT DISCOVERY TEST (Phase 2)');
  console.log('='.repeat(80));
  console.log(`\nTesting ${TEST_COUNTIES.length} counties with diverse governance models\n`);

  const results: Array<{ county: CountyTest; success: boolean; terminology?: string; score?: number }> = [];

  for (const county of TEST_COUNTIES) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Testing: ${county.name} County, ${county.state}`);
    console.log(`Expected: ${county.expectedTerminology || 'unknown'}`);
    console.log(`Notes: ${county.notes || 'N/A'}`);
    console.log('='.repeat(80));

    try {
      const result = await searchHubForCountyDistricts(county.name, county.state);

      if (result) {
        const terminology = result.metadata.terminologyUsed || 'unknown';
        console.log(`\n✅ SUCCESS!`);
        console.log(`   Found with: "${terminology}"`);
        console.log(`   Score: ${result.score}/100`);
        console.log(`   URL: ${result.url.substring(0, 80)}...`);

        results.push({
          county,
          success: true,
          terminology,
          score: result.score
        });
      } else {
        console.log(`\n❌ FAILED - No data found`);
        results.push({
          county,
          success: false
        });
      }
    } catch (error) {
      console.log(`\n❌ ERROR: ${error}`);
      results.push({
        county,
        success: false
      });
    }

    // Rate limiting - be respectful to Hub API
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Summary
  const successCount = results.filter(r => r.success).length;
  const successRate = (successCount / results.length * 100);

  console.log('\n\n' + '='.repeat(80));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`\n✅ Successful: ${successCount}/${results.length} (${successRate.toFixed(1)}%)`);
  console.log(`❌ Failed: ${results.length - successCount}/${results.length} (${(100 - successRate).toFixed(1)}%)`);

  if (successCount > 0) {
    console.log(`\n🎯 Terminology Breakdown:`);
    const termCounts = new Map<string, number>();
    results.filter(r => r.success && r.terminology).forEach(r => {
      const count = termCounts.get(r.terminology!) || 0;
      termCounts.set(r.terminology!, count + 1);
    });

    Array.from(termCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([term, count]) => {
        console.log(`   ${count} counties: "${term}"`);
      });
  }

  if (successRate >= 80) {
    console.log(`\n🎉 EXCELLENT: ${successRate.toFixed(1)}% success rate exceeds 80% target!`);
  } else if (successRate >= 60) {
    console.log(`\n✅ GOOD: ${successRate.toFixed(1)}% success rate`);
  } else {
    console.log(`\n⚠️  WARNING: ${successRate.toFixed(1)}% success rate below 60%`);
  }

  console.log('');
}

// Run test
testCountyDiscovery().catch(error => {
  console.error('\n💥 FATAL ERROR:', error);
  process.exit(1);
});
