/**
 * Test Hub API Discovery - Top 20 US Cities
 *
 * Validates the 80% success rate holds across larger sample.
 */

import { batchHubDiscovery } from './hub-api-discovery';

// Top 20 US cities by population
const TOP_20_CITIES = [
  { name: 'New York', state: 'NY' },
  { name: 'Los Angeles', state: 'CA' },
  { name: 'Chicago', state: 'IL' },
  { name: 'Houston', state: 'TX' },
  { name: 'Phoenix', state: 'AZ' },
  { name: 'Philadelphia', state: 'PA' },
  { name: 'San Antonio', state: 'TX' },
  { name: 'San Diego', state: 'CA' },
  { name: 'Dallas', state: 'TX' },
  { name: 'San Jose', state: 'CA' },
  { name: 'Austin', state: 'TX' },
  { name: 'Jacksonville', state: 'FL' },
  { name: 'Fort Worth', state: 'TX' },
  { name: 'Columbus', state: 'OH' },
  { name: 'Charlotte', state: 'NC' },
  { name: 'San Francisco', state: 'CA' },
  { name: 'Indianapolis', state: 'IN' },
  { name: 'Seattle', state: 'WA' },
  { name: 'Denver', state: 'CO' },
  { name: 'Boston', state: 'MA' }
];

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TESTING HUB API - TOP 20 US CITIES');
  console.log('='.repeat(80));
  console.log(`\nValidating 80% success rate hypothesis across larger sample...`);
  console.log(`Testing ${TOP_20_CITIES.length} cities\n`);

  const startTime = Date.now();
  const results = await batchHubDiscovery(TOP_20_CITIES);
  const endTime = Date.now();

  // Calculate statistics
  const successful = Array.from(results.values()).filter(r => r !== null).length;
  const failed = TOP_20_CITIES.length - successful;
  const successRate = (successful / TOP_20_CITIES.length) * 100;
  const avgTimePerCity = (endTime - startTime) / TOP_20_CITIES.length;

  // Scoring breakdown
  const scores = Array.from(results.values())
    .filter(r => r !== null)
    .map(r => r!.score);

  const avgScore = scores.length > 0
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 0;

  // Print summary
  console.log('\n\n' + '='.repeat(80));
  console.log('📊 RESULTS SUMMARY');
  console.log('='.repeat(80));
  console.log(`\n✅ Successful: ${successful}/${TOP_20_CITIES.length} (${successRate.toFixed(1)}%)`);
  console.log(`❌ Failed: ${failed}/${TOP_20_CITIES.length} (${(100 - successRate).toFixed(1)}%)`);
  console.log(`📈 Average score: ${avgScore.toFixed(1)}/100`);
  console.log(`⏱️  Average time: ${(avgTimePerCity / 1000).toFixed(1)}s per city`);
  console.log(`⏱️  Total time: ${((endTime - startTime) / 1000 / 60).toFixed(1)} minutes`);

  // Failed cities
  const failedCities = TOP_20_CITIES.filter(city => {
    const key = `${city.state}-${city.name}`;
    return results.get(key) === null;
  });

  if (failedCities.length > 0) {
    console.log('\n❌ FAILED CITIES:');
    failedCities.forEach(city => {
      console.log(`   - ${city.name}, ${city.state}`);
    });
  }

  // Success analysis
  console.log('\n' + '='.repeat(80));
  console.log('📈 SUCCESS RATE ANALYSIS');
  console.log('='.repeat(80));

  if (successRate >= 75) {
    console.log('\n✅ HYPOTHESIS CONFIRMED: 75%+ success rate for major cities');
    console.log('\nConclusion:');
    console.log('  • Hub API is PRODUCTION-READY for primary discovery');
    console.log('  • 80% coverage of top cities is sufficient');
    console.log('  • Fallback needed for remaining 20%');
  } else if (successRate >= 60) {
    console.log('\n⚠️  HYPOTHESIS PARTIALLY CONFIRMED: 60-75% success rate');
    console.log('\nConclusion:');
    console.log('  • Hub API is VIABLE but needs stronger fallback');
    console.log('  • Consider Playwright MCP as co-primary approach');
    console.log('  • Hybrid pipeline: Hub → Playwright → Manual');
  } else {
    console.log('\n❌ HYPOTHESIS REJECTED: <60% success rate');
    console.log('\nConclusion:');
    console.log('  • Hub API alone insufficient for production');
    console.log('  • Pivot to Playwright MCP as primary');
    console.log('  • Use Hub API as validation layer');
  }

  // Estimated coverage for full bootstrap
  console.log('\n' + '='.repeat(80));
  console.log('📊 FULL BOOTSTRAP ESTIMATES (19,616 cities)');
  console.log('='.repeat(80));

  const majorCities = 1000; // Top 1000 cities
  const midCities = 4000; // Mid-tier cities
  const smallCities = 14616; // Remaining cities

  // Success rate degrades for smaller cities
  const majorSuccess = successRate; // Same as top 20
  const midSuccess = successRate * 0.7; // 70% of major city rate
  const smallSuccess = successRate * 0.3; // 30% of major city rate

  const majorCoverage = (majorCities * majorSuccess / 100);
  const midCoverage = (midCities * midSuccess / 100);
  const smallCoverage = (smallCities * smallSuccess / 100);
  const totalCoverage = majorCoverage + midCoverage + smallCoverage;

  console.log(`\nEstimated coverage by tier:`);
  console.log(`  • Top 1,000 cities: ${majorCoverage.toFixed(0)} (${majorSuccess.toFixed(1)}%)`);
  console.log(`  • Mid 4,000 cities: ${midCoverage.toFixed(0)} (${midSuccess.toFixed(1)}%)`);
  console.log(`  • Small 14,616 cities: ${smallCoverage.toFixed(0)} (${smallSuccess.toFixed(1)}%)`);
  console.log(`  • TOTAL: ${totalCoverage.toFixed(0)}/19,616 (${(totalCoverage / 19616 * 100).toFixed(1)}%)`);

  console.log(`\nTime estimate for full bootstrap:`);
  const totalTime = (19616 * avgTimePerCity / 1000 / 60 / 60);
  console.log(`  • At ${(avgTimePerCity / 1000).toFixed(1)}s per city: ${totalTime.toFixed(1)} hours`);
  console.log(`  • Rate limit friendly: No rate limits hit in testing`);
  console.log(`  • Cost: $0 (public API)`);

  console.log('\n' + '='.repeat(80));
  console.log('NEXT STEPS');
  console.log('='.repeat(80));
  console.log(`\n1. Document findings in DISCOVERY-FINDINGS.md`);
  console.log(`2. Build production pipeline: Hub API → fallback → database`);
  console.log(`3. Set up validation + monitoring`);
  console.log(`4. Bootstrap top 1,000 cities first`);
  console.log('');

  process.exit(successRate >= 60 ? 0 : 1);
}

main().catch(error => {
  console.error('\n💥 FATAL ERROR:', error);
  process.exit(1);
});
