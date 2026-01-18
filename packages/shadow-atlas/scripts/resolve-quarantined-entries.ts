#!/usr/bin/env npx tsx
/**
 * Resolve Quarantined Entries to Validated Data
 *
 * STRATEGY: For each quarantined entry, attempt to find authoritative replacement data.
 * Uses multi-path scanner strategy from authoritative-multi-path.ts
 *
 * RESOLUTION PATHS (priority order):
 * 1. Direct city portal (data.{city}.gov, gisdata.{city}.gov)
 * 2. State GIS office (authoritative redistricting data)
 * 3. County GIS (may have city subdivision layer)
 * 4. ArcGIS Hub search (different layer from same portal)
 * 5. Mark as at-large (if research confirms no geographic districts)
 *
 * VALIDATION BEFORE ADDING:
 * - Pre-validation sanity checks (centroid proximity, feature count)
 * - District count matches expected (from city website research)
 * - Tessellation proof passes
 */

import { QUARANTINED_PORTALS, type QuarantinedPortal } from '../src/core/registry/quarantined-portals.js';
import { EXPECTED_DISTRICT_COUNTS } from '../src/core/registry/district-count-registry.js';
import { AT_LARGE_CITIES } from '../src/core/registry/at-large-cities.js';

interface ResolutionCategory {
  name: string;
  description: string;
  resolutionStrategy: string;
  entries: QuarantinedPortal[];
}

async function main() {
  console.log('Analyzing quarantined entries for resolution paths...\n');

  const quarantined = Object.values(QUARANTINED_PORTALS);

  // Categorize by quarantine reason
  const categories: Record<string, ResolutionCategory> = {
    'county_for_city': {
      name: 'County Data for City',
      description: 'Source provides county-level data, not city-specific districts',
      resolutionStrategy: `
        1. Search city GIS portal directly (data.{city}.gov)
        2. Check state GIS for city council layer
        3. Contact city clerk for official GIS source
        4. If city has at-large system, add to at-large-cities.ts`,
      entries: [],
    },
    'regional_data_bleeding': {
      name: 'Regional/Metro Data',
      description: 'Source provides metro or regional planning district data',
      resolutionStrategy: `
        1. Identify the specific city's own GIS portal
        2. Search ArcGIS Hub for city-specific layer
        3. Check state GIS office for municipal boundaries
        4. May need WHERE clause to filter city from regional data`,
      entries: [],
    },
    'exclusivity_topology_error': {
      name: 'Topology Errors (Overlapping Districts)',
      description: 'Source data has overlapping polygons - GIS editing error',
      resolutionStrategy: `
        1. Report issue to city GIS department
        2. Search for alternative data vintage
        3. Attempt automated topology repair (risky)
        4. Use TIGER-based districts if available`,
      entries: [],
    },
    'containment_failure': {
      name: 'Containment Failure',
      description: 'Districts extend far outside city boundary',
      resolutionStrategy: `
        1. Check if city boundaries recently changed (annexation)
        2. Verify correct FIPS code match
        3. Look for more recent district vintage
        4. May need boundary vintage alignment`,
      entries: [],
    },
    'partial_data': {
      name: 'Partial Data',
      description: 'Source only contains some districts, not all',
      resolutionStrategy: `
        1. Search for complete layer on same portal
        2. Check if city has mixed system (some at-large)
        3. Contact city clerk for complete data`,
      entries: [],
    },
    'wrong_feature_count': {
      name: 'Wrong Feature Count',
      description: 'Feature count doesn\'t match expected district count',
      resolutionStrategy: `
        1. Verify expected count from city website
        2. Check for multi-part features (need dissolve)
        3. Check for extra features (mayor, at-large seats)
        4. Look for correct layer on same portal`,
      entries: [],
    },
    'single-feature': {
      name: 'Single Feature (At-Large Indicator)',
      description: 'Only 1 feature - city may be at-large',
      resolutionStrategy: `
        1. Research city council structure on Ballotpedia
        2. Check city website for district map
        3. If at-large confirmed, add to at-large-cities.ts
        4. If district-based, find correct layer`,
      entries: [],
    },
    'other': {
      name: 'Other Issues',
      description: 'Various data quality issues',
      resolutionStrategy: 'Manual investigation required',
      entries: [],
    },
  };

  // Categorize entries
  for (const entry of quarantined) {
    const pattern = entry.matchedPattern || 'other';
    const category = categories[pattern] || categories['other'];
    category.entries.push(entry);
  }

  // Report
  console.log('=== QUARANTINED ENTRIES BY CATEGORY ===\n');

  let totalResolvable = 0;
  let totalNeedsResearch = 0;

  for (const [key, category] of Object.entries(categories)) {
    if (category.entries.length === 0) continue;

    console.log(`📁 ${category.name} (${category.entries.length} entries)`);
    console.log(`   ${category.description}`);
    const strategyLine = category.resolutionStrategy.split('\n')[1];
    console.log(`   Strategy: ${strategyLine?.trim() ?? category.resolutionStrategy}`);
    console.log('');

    // Show first 5 entries
    for (const entry of category.entries.slice(0, 5)) {
      const hasExpectedCount = EXPECTED_DISTRICT_COUNTS[entry.cityFips];
      const isAtLarge = AT_LARGE_CITIES[entry.cityFips];
      const status = isAtLarge ? '✓ AT-LARGE' : hasExpectedCount ? '📊 HAS COUNT' : '❓ NEEDS RESEARCH';

      console.log(`   - ${entry.cityName}, ${entry.state} (${entry.cityFips}) [${status}]`);

      if (isAtLarge) totalResolvable++;
      else if (hasExpectedCount) totalResolvable++;
      else totalNeedsResearch++;
    }

    if (category.entries.length > 5) {
      console.log(`   ... and ${category.entries.length - 5} more`);
    }
    console.log('');
  }

  // Summary
  console.log('=== RESOLUTION SUMMARY ===\n');
  console.log(`Total quarantined: ${quarantined.length}`);
  console.log(`Already have expected count: ${totalResolvable} (can validate immediately)`);
  console.log(`Need research: ${totalNeedsResearch} (need city website verification)`);

  // High-value targets (major cities)
  console.log('\n=== HIGH-VALUE TARGETS (Population > 50k) ===\n');

  const highValue = quarantined.filter(e => {
    // Check if in Top 50 registry
    return EXPECTED_DISTRICT_COUNTS[e.cityFips];
  });

  for (const entry of highValue.slice(0, 10)) {
    const expected = EXPECTED_DISTRICT_COUNTS[entry.cityFips];
    console.log(`🎯 ${entry.cityName}, ${entry.state}`);
    console.log(`   FIPS: ${entry.cityFips}`);
    console.log(`   Expected districts: ${expected?.expectedDistrictCount ?? 'unknown'}`);
    console.log(`   Quarantine reason: ${entry.quarantineReason.slice(0, 80)}...`);
    console.log('');
  }
}

main().catch(console.error);
