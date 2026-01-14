#!/usr/bin/env npx tsx
/**
 * Analyze Coverage Gap
 *
 * Compare existing classified layers against Census top 1,000 cities
 * to identify which cities are missing council district data.
 *
 * Output:
 * - Missing cities by population tier
 * - Geographic distribution of gaps
 * - Priority targets for manual research
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../core/utils/logger.js';

interface CensusPlace {
  readonly fips: string;
  readonly name: string;
  readonly state: string;
  readonly population: number;
  readonly rank: number;
}

interface ClassifiedLayer {
  readonly service_url: string;
  readonly layer_name: string;
  readonly district_type?: string;
  readonly governance_level?: string;
  // ... other fields
}

/**
 * Extract city name from layer metadata (fuzzy matching)
 */
function extractCityFromLayer(layer: Record<string, unknown>): string | null {
  const layerName = String(layer.layer_name ?? '').toLowerCase();
  const serviceUrl = String(layer.service_url ?? '').toLowerCase();

  // Try to extract city name from various patterns
  // This is heuristic - may have false positives/negatives

  // Common patterns in layer names: "Seattle City Council", "Portland Council Districts"
  const cityMatch = layerName.match(/([a-z\s]+)\s+(city|town|municipal)\s+(council|district)/i);
  if (cityMatch) {
    return cityMatch[1].trim();
  }

  // URL patterns: gis.cityname.gov, cityname.maps.arcgis.com
  const urlMatch = serviceUrl.match(/gis\.([a-z-]+)\.(gov|us|org|com)/);
  if (urlMatch) {
    return urlMatch[1].replace(/-/g, ' ');
  }

  return null;
}

/**
 * Normalize city name for comparison
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z]/g, '');
}

async function main(): Promise<void> {
  const dataDir = join(__dirname, 'data');

  // Load Census top 1,000 cities
  const censusFile = join(__dirname, '../data/us-cities-top-1000.json');
  const censusPlaces = JSON.parse(readFileSync(censusFile, 'utf-8')) as CensusPlace[];

  logger.info('='.repeat(70));
  logger.info('COVERAGE GAP ANALYSIS');
  logger.info('='.repeat(70));
  logger.info(`Census places (top 1,000): ${censusPlaces.length}`);

  // Load existing classified layers
  const classifiedFile = join(dataDir, 'comprehensive_classified_layers.jsonl');
  const content = readFileSync(classifiedFile, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  const classifiedLayers = lines.map(line => JSON.parse(line) as Record<string, unknown>);

  logger.info(`Existing classified layers: ${classifiedLayers.length}`);
  logger.info('');

  // Filter for municipal (city) council districts only
  const cityCouncilLayers = classifiedLayers.filter(layer =>
    layer.district_type === 'city_council' ||
    (String(layer.layer_name ?? '').toLowerCase().includes('city council') &&
     layer.governance_level === 'municipal')
  );

  logger.info(`City council layers: ${cityCouncilLayers.length}`);
  logger.info('');

  // Extract city names from classified layers
  const discoveredCityNames = new Set<string>();
  for (const layer of cityCouncilLayers) {
    const cityName = extractCityFromLayer(layer);
    if (cityName) {
      discoveredCityNames.add(normalizeName(cityName));
    }
  }

  logger.info(`Discovered cities (estimated): ${discoveredCityNames.size}`);
  logger.info('');

  // Find missing cities
  const missingCities: CensusPlace[] = [];
  const coveredCities: CensusPlace[] = [];

  for (const place of censusPlaces) {
    const normalized = normalizeName(place.name);

    // Check if this city appears in discovered set
    if (discoveredCityNames.has(normalized)) {
      coveredCities.push(place);
    } else {
      missingCities.push(place);
    }
  }

  logger.info('Coverage Statistics:');
  logger.info(`  Covered cities: ${coveredCities.length} (${((coveredCities.length / censusPlaces.length) * 100).toFixed(1)}%)`);
  logger.info(`  Missing cities: ${missingCities.length} (${((missingCities.length / censusPlaces.length) * 100).toFixed(1)}%)`);
  logger.info('');

  // Analyze missing cities by population tier
  const tier1 = missingCities.filter(c => c.population >= 500000);  // Major cities
  const tier2 = missingCities.filter(c => c.population >= 250000 && c.population < 500000);  // Large cities
  const tier3 = missingCities.filter(c => c.population >= 100000 && c.population < 250000);  // Medium cities
  const tier4 = missingCities.filter(c => c.population < 100000);  // Smaller cities

  logger.info('Missing Cities by Population Tier:');
  logger.info(`  Tier 1 (pop >= 500k): ${tier1.length} cities`);
  logger.info(`  Tier 2 (pop 250k-500k): ${tier2.length} cities`);
  logger.info(`  Tier 3 (pop 100k-250k): ${tier3.length} cities`);
  logger.info(`  Tier 4 (pop < 100k): ${tier4.length} cities`);
  logger.info('');

  // Priority targets (Tier 1 + Tier 2 for manual research)
  const priorityTargets = [...tier1, ...tier2];

  logger.info(`Priority targets for manual research: ${priorityTargets.length} cities`);
  logger.info('');

  logger.info('Top 20 Missing Cities (by population):');
  for (const place of missingCities.slice(0, 20)) {
    logger.info(`  ${place.rank}. ${place.name}, ${place.state} (pop: ${place.population.toLocaleString()})`);
  }

  // Geographic distribution
  const missingByState = new Map<string, number>();
  for (const place of missingCities) {
    missingByState.set(place.state, (missingByState.get(place.state) || 0) + 1);
  }

  logger.info('\nTop 10 States with Missing Cities:');
  const sortedStates = Array.from(missingByState.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  for (const [state, count] of sortedStates) {
    logger.info(`  ${state}: ${count} missing cities`);
  }

  // Save detailed report
  const report = {
    total_census_places: censusPlaces.length,
    total_classified_layers: classifiedLayers.length,
    city_council_layers: cityCouncilLayers.length,
    estimated_covered_cities: coveredCities.length,
    missing_cities_count: missingCities.length,
    coverage_percent: ((coveredCities.length / censusPlaces.length) * 100).toFixed(1),
    missing_by_tier: {
      tier1_over_500k: tier1.length,
      tier2_250k_500k: tier2.length,
      tier3_100k_250k: tier3.length,
      tier4_under_100k: tier4.length,
    },
    missing_by_state: Object.fromEntries(sortedStates),
    priority_targets: priorityTargets.map(p => ({
      rank: p.rank,
      name: p.name,
      state: p.state,
      population: p.population,
    })),
    top_20_missing: missingCities.slice(0, 20).map(p => ({
      rank: p.rank,
      name: p.name,
      state: p.state,
      population: p.population,
    })),
  };

  const reportFile = join(dataDir, 'coverage_gap_analysis.json');
  writeFileSync(reportFile, JSON.stringify(report, null, 2));

  logger.info('\n' + '='.repeat(70));
  logger.info('ANALYSIS COMPLETE');
  logger.info('='.repeat(70));
  logger.info(`Report saved: ${reportFile}`);
  logger.info('');
  logger.info('RECOMMENDED NEXT STEPS:');
  logger.info('1. Manual research for Tier 1 missing cities (high value targets)');
  logger.info('2. Search ArcGIS Hub with alternate query terms (e.g., "ward boundaries")');
  logger.info('3. Check state/county GIS portals for cities without direct servers');
  logger.info('4. Document findings in curated registry');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('Error:', error);
    process.exit(1);
  });
