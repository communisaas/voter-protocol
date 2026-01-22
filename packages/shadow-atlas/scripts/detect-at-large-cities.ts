#!/usr/bin/env npx tsx
/**
 * Detect At-Large Cities via Web Research
 *
 * For quarantined "single-feature" entries, verify if the city actually uses
 * an at-large election system (no geographic districts).
 *
 * SOURCES (in priority order):
 * 1. City official website (council/elected-officials page)
 * 2. Ballotpedia
 * 3. State municipal code
 *
 * If confirmed at-large, entry moves from quarantine → at-large-cities.ts
 */

import { QUARANTINED_PORTALS } from '../src/core/registry/quarantined-portals.generated.js';
import { AT_LARGE_CITIES } from '../src/core/registry/at-large-cities.generated.js';

// Cities with "single-feature" pattern need at-large research
const SINGLE_FEATURE_ENTRIES = Object.values(QUARANTINED_PORTALS)
  .filter(p => p.matchedPattern === 'single-feature');

interface AtLargeResearchResult {
  fips: string;
  cityName: string;
  state: string;
  isAtLarge: boolean | null; // null = needs manual research
  councilSize: number | null;
  source: string | null;
  confidence: 'high' | 'medium' | 'low';
}

// Known at-large patterns from city names
const AT_LARGE_INDICATORS = [
  /township/i,
  /village/i,
  /borough/i,
  /town of/i,
];

// Known district-based patterns
const DISTRICT_INDICATORS = [
  /city of/i,
  /consolidated/i,
  /metro/i,
];

async function main() {
  console.log('=== AT-LARGE CITY DETECTION ===\n');
  console.log(`Single-feature entries to research: ${SINGLE_FEATURE_ENTRIES.length}\n`);

  const results: AtLargeResearchResult[] = [];

  for (const entry of SINGLE_FEATURE_ENTRIES) {
    // Check if already in at-large registry
    if (AT_LARGE_CITIES[entry.cityFips]) {
      console.log(`✅ ${entry.cityName}, ${entry.state} - Already in at-large registry`);
      continue;
    }

    // Heuristic analysis
    const nameIndicatesAtLarge = AT_LARGE_INDICATORS.some(p => p.test(entry.cityName));
    const nameIndicatesDistrict = DISTRICT_INDICATORS.some(p => p.test(entry.cityName));

    // Check if it's actually a county (these snuck in as single-feature)
    const isCounty = /county|parish/i.test(entry.cityName);

    if (isCounty) {
      console.log(`⏭️  ${entry.cityName}, ${entry.state} - County entry (skip)`);
      continue;
    }

    const likelyAtLarge = nameIndicatesAtLarge && !nameIndicatesDistrict;

    results.push({
      fips: entry.cityFips,
      cityName: entry.cityName,
      state: entry.state,
      isAtLarge: likelyAtLarge ? true : null,
      councilSize: null,
      source: likelyAtLarge ? 'name-heuristic' : null,
      confidence: likelyAtLarge ? 'low' : 'low',
    });

    const status = likelyAtLarge ? '🔍 LIKELY AT-LARGE' : '❓ NEEDS RESEARCH';
    console.log(`${status} ${entry.cityName}, ${entry.state} (${entry.cityFips})`);
  }

  // Summary
  console.log('\n=== RESEARCH QUEUE ===\n');

  const needsResearch = results.filter(r => r.isAtLarge === null);
  const likelyAtLarge = results.filter(r => r.isAtLarge === true);

  console.log(`Likely at-large (verify): ${likelyAtLarge.length}`);
  console.log(`Needs manual research: ${needsResearch.length}`);

  // Generate Ballotpedia research URLs
  console.log('\n=== BALLOTPEDIA RESEARCH URLS ===\n');

  for (const r of [...likelyAtLarge, ...needsResearch].slice(0, 10)) {
    const searchQuery = `${r.cityName} ${r.state} city council`.replace(/\s+/g, '+');
    console.log(`${r.cityName}, ${r.state}:`);
    console.log(`  https://ballotpedia.org/wiki/index.php?search=${encodeURIComponent(searchQuery)}`);
    console.log('');
  }

  // Generate at-large-cities.ts additions template
  console.log('\n=== TEMPLATE FOR at-large-cities.ts ===\n');
  console.log('// Add these entries after verification:\n');

  for (const r of likelyAtLarge.slice(0, 5)) {
    console.log(`  '${r.fips}': {`);
    console.log(`    cityName: '${r.cityName}',`);
    console.log(`    state: '${r.state}',`);
    console.log(`    councilSize: /* VERIFY */, // Research from city website`);
    console.log(`    electionMethod: 'at-large',`);
    console.log(`    source: '/* Ballotpedia or city website URL */',`);
    console.log(`  },\n`);
  }
}

main().catch(console.error);
