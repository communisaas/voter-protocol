/**
 * Coverage Monitoring Example
 *
 * PURPOSE: Demonstrate how to use coverage analyzer for autonomous agent decisions
 * USAGE: tsx services/shadow-atlas/examples/coverage-monitoring.ts
 */

import {
  analyzeCoverage,
  getStaleData,
  getQualityMetrics,
  getBlockerAnalysis,
  type CityInput,
} from '../services/coverage-analyzer.js';

// Example: Monitor coverage for top 10 cities
const TOP_10_CITIES: readonly CityInput[] = [
  { fips: '3651000', name: 'New York City', state: 'NY', population: 8804190 },
  { fips: '0644000', name: 'Los Angeles', state: 'CA', population: 3898747 },
  { fips: '1714000', name: 'Chicago', state: 'IL', population: 2746388 },
  { fips: '4835000', name: 'Houston', state: 'TX', population: 2304580 },
  { fips: '0455000', name: 'Phoenix', state: 'AZ', population: 1608139 },
  { fips: '4260000', name: 'Philadelphia', state: 'PA', population: 1603797 },
  { fips: '4865000', name: 'San Antonio', state: 'TX', population: 1434625 },
  { fips: '0666000', name: 'San Diego', state: 'CA', population: 1386932 },
  { fips: '4819000', name: 'Dallas', state: 'TX', population: 1304379 },
  { fips: '0667000', name: 'San Jose', state: 'CA', population: 1013240 },
];

async function main() {
  console.log('=== Coverage Analysis for Top 10 Cities ===\n');

  // 1. Get overall coverage stats
  const coverage = await analyzeCoverage(TOP_10_CITIES);

  console.log(`Coverage: ${coverage.coveredCities}/${coverage.totalCities} (${coverage.coveragePercent.toFixed(1)}%)\n`);

  // 2. Identify gaps (cities needing discovery)
  if (coverage.topGaps.length > 0) {
    console.log('Cities needing discovery:');
    for (const gap of coverage.topGaps) {
      console.log(`  - ${gap.cityName}, ${gap.state} (pop: ${gap.population.toLocaleString()})`);
    }
    console.log();
  } else {
    console.log('✅ All cities covered!\n');
  }

  // 3. Check for stale data
  const stale = await getStaleData(90);
  if (stale.length > 0) {
    console.log(`⚠️  ${stale.length} cities have stale data (>90 days old)\n`);
  } else {
    console.log('✅ All data is fresh (<90 days old)\n');
  }

  // 4. Get quality metrics
  const quality = await getQualityMetrics();
  console.log('Quality Metrics:');
  console.log(`  Average Confidence: ${quality.avgConfidence.toFixed(1)}%`);
  console.log(`  Low Confidence (<70): ${quality.lowConfidence} cities\n`);

  // 5. Check for blockers
  const blockers = await getBlockerAnalysis();
  const blockerCount = Object.keys(blockers).length;
  if (blockerCount > 0) {
    console.log('Blockers preventing higher-tier coverage:');
    for (const [code, { count, examples }] of Object.entries(blockers)) {
      console.log(`  ${code}: ${count} cities`);
      if (examples.length > 0) {
        console.log(`    Examples: ${examples.slice(0, 3).join(', ')}`);
      }
    }
    console.log();
  } else {
    console.log('✅ No blockers detected\n');
  }

  // 6. Autonomous agent decision: Prioritize discovery
  console.log('=== Agent Decision: Discovery Priorities ===\n');

  if (coverage.topGaps.length > 0) {
    // Sort by population (highest priority first)
    const prioritized = [...coverage.topGaps]
      .sort((a, b) => b.population - a.population)
      .slice(0, 5);

    console.log('Top 5 discovery targets:');
    for (let i = 0; i < prioritized.length; i++) {
      const city = prioritized[i];
      console.log(
        `  ${i + 1}. ${city.cityName}, ${city.state} ` +
        `(pop: ${city.population.toLocaleString()})`
      );
    }
    console.log();
  }

  // 7. Quality improvement targets
  if (quality.lowConfidence > 0) {
    console.log('=== Quality Improvement Targets ===\n');
    console.log(`${quality.lowConfidence} cities have confidence <70%`);
    console.log('Consider re-validation or manual review.\n');
  }

  // 8. Freshness maintenance
  if (stale.length > 0) {
    console.log('=== Freshness Maintenance ===\n');
    const topStale = stale.slice(0, 5);
    console.log('Cities needing re-validation:');
    for (const city of topStale) {
      const age = Math.floor(
        (Date.now() - new Date(city.lastUpdated!).getTime()) / (24 * 60 * 60 * 1000)
      );
      console.log(`  - ${city.cityName}, ${city.state} (${age} days old)`);
    }
    console.log();
  }

  console.log('=== Analysis Complete ===\n');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
