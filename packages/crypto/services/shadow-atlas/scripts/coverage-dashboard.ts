/**
 * Coverage Dashboard - CLI Monitoring Tool
 *
 * PURPOSE: Real-time coverage monitoring
 * USAGE: npm run shadow-atlas:dashboard
 *
 * CRITICAL TYPE SAFETY: Dashboard drives agent decisions. Wrong stats = wasted budget.
 */

import {
  analyzeCoverage,
  getStaleData,
  getQualityMetrics,
  getBlockerAnalysis,
  type CityInput,
} from '../services/coverage-analyzer.js';
import { getRegistryStats } from '../registry/known-portals.js';

// TOP 50 US CITIES (Census 2020 population estimates)
// SOURCE: US Census Bureau, Population Estimates Program
const TOP_50_CITIES: readonly CityInput[] = [
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
  { fips: '4805000', name: 'Austin', state: 'TX', population: 961855 },
  { fips: '4827000', name: 'Fort Worth', state: 'TX', population: 918915 },
  { fips: '3918000', name: 'Columbus', state: 'OH', population: 905748 },
  { fips: '0667000', name: 'San Francisco', state: 'CA', population: 873965 },
  { fips: '3712000', name: 'Charlotte', state: 'NC', population: 874579 },
  { fips: '1836003', name: 'Indianapolis', state: 'IN', population: 887642 },
  { fips: '5363000', name: 'Seattle', state: 'WA', population: 737015 },
  { fips: '0820000', name: 'Denver', state: 'CO', population: 715522 },
  { fips: '1150000', name: 'Washington', state: 'DC', population: 689545 },
  { fips: '2511000', name: 'Boston', state: 'MA', population: 675647 },
  { fips: '4827000', name: 'El Paso', state: 'TX', population: 678815 },
  { fips: '2622000', name: 'Detroit', state: 'MI', population: 639111 },
  { fips: '4752006', name: 'Nashville', state: 'TN', population: 689447 },
  { fips: '3455000', name: 'Memphis', state: 'TN', population: 633104 },
  { fips: '4159000', name: 'Portland', state: 'OR', population: 652503 },
  { fips: '4045000', name: 'Oklahoma City', state: 'OK', population: 681054 },
  { fips: '3240000', name: 'Las Vegas', state: 'NV', population: 641676 },
  { fips: '2148006', name: 'Louisville', state: 'KY', population: 633045 },
  { fips: '2404000', name: 'Baltimore', state: 'MD', population: 585708 },
  { fips: '5553000', name: 'Milwaukee', state: 'WI', population: 577222 },
  { fips: '0313000', name: 'Albuquerque', state: 'NM', population: 564559 },
  { fips: '4245000', name: 'Tucson', state: 'AZ', population: 548073 },
  { fips: '0464000', name: 'Fresno', state: 'CA', population: 542107 },
  { fips: '0653000', name: 'Oakland', state: 'CA', population: 440646 },
  { fips: '4855000', name: 'Mesa', state: 'AZ', population: 504258 },
  { fips: '0664000', name: 'Sacramento', state: 'CA', population: 524943 },
  { fips: '1316000', name: 'Atlanta', state: 'GA', population: 498715 },
  { fips: '2938000', name: 'Kansas City', state: 'MO', population: 508090 },
  { fips: '0830000', name: 'Colorado Springs', state: 'CO', population: 478961 },
  { fips: '3537000', name: 'Omaha', state: 'NE', population: 486051 }, // Fixed FIPS from 3137000
  { fips: '3755000', name: 'Raleigh', state: 'NC', population: 467665 },
  { fips: '2255000', name: 'Miami', state: 'FL', population: 442241 },
  { fips: '0466000', name: 'Long Beach', state: 'CA', population: 466742 },
  { fips: '1245000', name: 'Virginia Beach', state: 'VA', population: 459470 },
  { fips: '2743000', name: 'Minneapolis', state: 'MN', population: 429954 },
  { fips: '4170000', name: 'Tampa', state: 'FL', population: 399700 },
  { fips: '0438000', name: 'Bakersfield', state: 'CA', population: 403455 },
  { fips: '4835000', name: 'Arlington', state: 'TX', population: 398121 },
  { fips: '2255000', name: 'New Orleans', state: 'LA', population: 383997 },
  { fips: '4974000', name: 'Wichita', state: 'KS', population: 397532 },
] as const;

/**
 * Format large numbers with K/M suffix
 */
function formatPopulation(pop: number): string {
  if (pop >= 1_000_000) {
    return `${(pop / 1_000_000).toFixed(1)}M`;
  }
  return `${Math.round(pop / 1000)}K`;
}

/**
 * Print dashboard header
 */
function printHeader(): void {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║       SHADOW ATLAS COVERAGE DASHBOARD               ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
}

/**
 * Print overall coverage statistics
 */
async function printOverallCoverage(): Promise<void> {
  console.log('═══ OVERALL COVERAGE (Top 50 Cities) ═══\n');

  const stats = await analyzeCoverage(TOP_50_CITIES);

  console.log(`Total Cities:     ${stats.totalCities}`);
  console.log(`Covered Cities:   ${stats.coveredCities}`);
  console.log(`Coverage:         ${stats.coveragePercent.toFixed(1)}%`);
  console.log(`Need Discovery:   ${stats.totalCities - stats.coveredCities}\n`);
}

/**
 * Print granularity tier breakdown
 */
async function printTierBreakdown(): Promise<void> {
  console.log('═══ BY GRANULARITY TIER ═══\n');

  const stats = await analyzeCoverage(TOP_50_CITIES);

  const tierNames = ['Precincts', 'Districts', 'Municipal', 'Subdivision', 'County'];

  for (const [tier, count] of Object.entries(stats.byTier)) {
    const tierName = tierNames[Number(tier)] || 'Unknown';
    console.log(`TIER ${tier} (${tierName}): ${count} cities`);
  }
  console.log();
}

/**
 * Print top coverage gaps
 */
async function printTopGaps(): Promise<void> {
  console.log('═══ TOP COVERAGE GAPS (by population) ═══\n');

  const stats = await analyzeCoverage(TOP_50_CITIES);

  for (const gap of stats.topGaps.slice(0, 10)) {
    const pop = formatPopulation(gap.population).padStart(8);
    const status =
      gap.dataSource === 'none'
        ? 'NO DATA'
        : `TIER ${gap.tier}`;

    console.log(
      `${gap.cityName.padEnd(25)} ${gap.state} ` +
      `${pop} ` +
      `${status}`
    );
  }
  console.log();
}

/**
 * Print stale data warning
 */
async function printStaleData(): Promise<void> {
  console.log('═══ STALE DATA (>90 days) ═══\n');

  const stale = await getStaleData(90);

  if (stale.length === 0) {
    console.log('✅ No stale data detected\n');
  } else {
    for (const city of stale.slice(0, 5)) {
      const age = Math.floor((Date.now() - new Date(city.lastUpdated!).getTime()) / (24 * 60 * 60 * 1000));
      console.log(`${city.cityName.padEnd(25)} ${city.state}  ${age} days old`);
    }
    if (stale.length > 5) {
      console.log(`\n... and ${stale.length - 5} more\n`);
    } else {
      console.log();
    }
  }
}

/**
 * Print state coverage breakdown
 */
async function printStateBreakdown(): Promise<void> {
  console.log('═══ BY STATE (Top 10) ═══\n');

  const stats = await analyzeCoverage(TOP_50_CITIES);

  const statesSorted = Object.entries(stats.byState)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);

  for (const [state, { total, covered }] of statesSorted) {
    const percent = ((covered / total) * 100).toFixed(0);
    console.log(
      `${state.padEnd(15)} ${String(covered).padStart(3)}/${String(total).padStart(3)} ` +
      `(${String(percent).padStart(3)}%)`
    );
  }
  console.log();
}

/**
 * Print quality metrics
 */
async function printQualityMetrics(): Promise<void> {
  console.log('═══ QUALITY METRICS ═══\n');

  const quality = await getQualityMetrics();

  console.log(`Average Confidence:   ${quality.avgConfidence.toFixed(1)}%`);
  console.log(`Low Confidence (<70): ${quality.lowConfidence} cities`);
  console.log();

  console.log('By Tier:');
  for (const [tier, metrics] of Object.entries(quality.byTier)) {
    console.log(
      `  TIER ${tier}: ${metrics.count} cities, ` +
      `${metrics.avgConfidence.toFixed(1)}% avg confidence`
    );
  }
  console.log();
}

/**
 * Print blocker analysis
 */
async function printBlockerAnalysis(): Promise<void> {
  console.log('═══ BLOCKERS PREVENTING HIGHER-TIER COVERAGE ═══\n');

  const blockers = await getBlockerAnalysis();

  const sorted = Object.entries(blockers)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  if (sorted.length === 0) {
    console.log('✅ No blockers detected\n');
  } else {
    for (const [code, { count, examples }] of sorted) {
      console.log(`${code.padEnd(30)} ${count} cities`);
      if (examples.length > 0) {
        console.log(`  Examples: ${examples.join(', ')}`);
      }
    }
    console.log();
  }
}

/**
 * Print known portals registry stats
 */
async function printRegistryStats(): Promise<void> {
  console.log('═══ KNOWN PORTALS REGISTRY ═══\n');

  const stats = getRegistryStats();

  console.log(`Total Entries:        ${stats.total}`);
  console.log(`Fresh (<90 days):     ${stats.fresh}`);
  console.log(`Stale (>90 days):     ${stats.stale}`);
  console.log(`Average Confidence:   ${stats.avgConfidence.toFixed(1)}%`);
  console.log();

  console.log('By Portal Type:');
  for (const [type, count] of Object.entries(stats.byPortalType)) {
    console.log(`  ${type.padEnd(20)} ${count}`);
  }
  console.log();
}

/**
 * Main dashboard function
 */
async function printDashboard(): Promise<void> {
  printHeader();

  await printOverallCoverage();
  await printTierBreakdown();
  await printTopGaps();
  await printStaleData();
  await printStateBreakdown();
  await printQualityMetrics();
  await printBlockerAnalysis();
  await printRegistryStats();

  console.log('═══ END OF DASHBOARD ═══\n');
}

// Execute dashboard
printDashboard().catch((error) => {
  console.error('Dashboard error:', error);
  process.exit(1);
});
