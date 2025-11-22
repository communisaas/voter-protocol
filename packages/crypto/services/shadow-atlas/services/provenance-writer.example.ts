/**
 * Provenance Writer - Example Usage
 *
 * Demonstrates how to use the provenance writer for autonomous discovery agents
 */

import {
  appendProvenance,
  queryProvenance,
  getProvenanceStats,
  type ProvenanceEntry,
} from './provenance-writer.js';

/**
 * Example: Agent discovers council districts for San Diego
 */
async function exampleSuccessfulDiscovery(): Promise<void> {
  const entry: ProvenanceEntry = {
    // Identity
    f: '0666000',              // FIPS code
    n: 'San Diego',            // City name (optional, for human readability)
    s: 'CA',                   // State code (optional)
    p: 1386932,                // Population (optional)

    // Granularity assessment
    g: 1,                      // Tier 1 (council districts)
    fc: 9,                     // 9 districts found
    conf: 85,                  // 85% confidence
    auth: 3,                   // Authority level 3 (municipal official)

    // Data source
    src: 'muni-gis',           // Source type
    url: 'https://seshat.datasd.org/sde/council_districts/downloads/council_dists_datasd.geojson',

    // Quality metrics
    q: {
      v: true,                 // GeoJSON valid
      t: 1,                    // Topology clean
      r: 474,                  // Response time 474ms
      d: '2021-12-14',         // Data vintage
    },

    // Reasoning chain
    why: [
      'T0 blocked: No precinct data available',
      'T1 success: Found 9 council districts',
      'Authority verified: Municipal GIS portal',
      'Quality check: All districts have valid geometries',
    ],

    // Discovery tracking
    tried: [0, 1],             // Attempted tiers 0 and 1
    blocked: null,             // No blocker (success)

    // Metadata
    ts: '2025-11-19T07:42:00Z', // ISO timestamp
    aid: 'agt-001',            // Agent ID
  };

  await appendProvenance(entry);
  console.log('✓ Logged successful discovery for San Diego');
}

/**
 * Example: Agent encounters at-large governance (expected Tier 2)
 */
async function exampleAtLargeGovernance(): Promise<void> {
  const entry: ProvenanceEntry = {
    f: '0807850',
    n: 'Boulder',
    s: 'CO',
    p: 108090,
    g: 2,                      // Tier 2 (municipal boundary)
    fc: 1,                     // Single polygon
    conf: 100,                 // 100% confidence (this is correct for at-large)
    auth: 5,                   // Authority level 5 (federal Census TIGER)
    src: 'tiger',
    url: 'https://www2.census.gov/geo/tiger/TIGER2023/PLACE/tl_2023_08_place.zip',
    q: {
      v: true,
      t: 1,
      r: 850,
      d: '2023-01-01',
    },
    why: [
      'T0 blocked: At-large elections (no precincts)',
      'T1 blocked: At-large council (no districts)',
      'T2 success: Municipal boundary from Census TIGER',
      'T2 optimal for at-large cities',
    ],
    tried: [0, 1, 2],
    blocked: 'at-large-governance', // Expected blocker (not a failure)
    ts: '2025-11-19T08:00:00Z',
    aid: 'agt-002',
  };

  await appendProvenance(entry);
  console.log('✓ Logged at-large governance for Boulder');
}

/**
 * Example: Agent encounters portal 404 (retry candidate)
 */
async function examplePortal404(): Promise<void> {
  const entry: ProvenanceEntry = {
    f: '1234567',
    n: 'Example City',
    s: 'TX',
    p: 50000,
    g: 4,                      // Fell back to Tier 4 (county)
    fc: 1,
    conf: 45,                  // Low confidence (not ideal)
    auth: 1,                   // Authority level 1 (community maintained)
    why: [
      'T0 unavailable: No precinct data',
      'T1 blocked: Portal returned 404',
      'T2 blocked: No municipal GIS portal',
      'T3 unavailable: County subdivision data incomplete',
      'T4 fallback: Using county boundary (low confidence)',
    ],
    tried: [0, 1, 2, 3, 4],
    blocked: 'portal-404',     // Blocker code (retry candidate)
    ts: '2025-11-19T09:00:00Z',
    aid: 'agt-003',
  };

  await appendProvenance(entry);
  console.log('✓ Logged portal 404 for Example City (retry in 30 days)');
}

/**
 * Example: Query high-confidence Tier 1 discoveries in California
 */
async function exampleQueryTier1California(): Promise<void> {
  const results = await queryProvenance({
    tier: 1,
    state: 'CA',
    minConfidence: 80,
  });

  console.log(`\nFound ${results.length} Tier 1 California cities with confidence ≥80%:`);
  for (const entry of results) {
    console.log(`  - ${entry.n} (${entry.f}): ${entry.fc} districts, confidence ${entry.conf}%`);
  }
}

/**
 * Example: Find all cities blocked by at-large governance
 */
async function exampleQueryAtLarge(): Promise<void> {
  const results = await queryProvenance({
    blockerCode: 'at-large-governance',
  });

  console.log(`\nFound ${results.length} at-large cities (expected Tier 2):`);
  for (const entry of results) {
    console.log(`  - ${entry.n} (${entry.f}): ${entry.s}`);
  }
}

/**
 * Example: Find retry candidates (portal failures)
 */
async function exampleQueryRetryCandidates(): Promise<void> {
  const results = await queryProvenance({
    blockerCode: 'portal-404',
  });

  console.log(`\nFound ${results.length} cities with portal failures (retry candidates):`);
  for (const entry of results) {
    const daysSince = Math.floor(
      (Date.now() - new Date(entry.ts).getTime()) / (1000 * 60 * 60 * 24)
    );
    console.log(`  - ${entry.n} (${entry.f}): ${daysSince} days since attempt`);
  }
}

/**
 * Example: Get overall statistics
 */
async function exampleGetStats(): Promise<void> {
  const stats = await getProvenanceStats();

  console.log('\nProvenance Statistics:');
  console.log(`  Total entries: ${stats.totalEntries}`);
  console.log(`  Average confidence: ${stats.avgConfidence.toFixed(1)}%`);
  console.log('\n  By Tier:');
  for (const [tier, count] of Object.entries(stats.byTier)) {
    console.log(`    Tier ${tier}: ${count} cities`);
  }
  console.log('\n  By Authority:');
  for (const [auth, count] of Object.entries(stats.byAuthority)) {
    console.log(`    Level ${auth}: ${count} cities`);
  }
  console.log('\n  Blockers:');
  for (const [blocker, count] of Object.entries(stats.byBlocker)) {
    console.log(`    ${blocker}: ${count} cities`);
  }
}

/**
 * Run all examples
 */
async function main(): Promise<void> {
  console.log('Provenance Writer Examples\n');

  // Write examples
  await exampleSuccessfulDiscovery();
  await exampleAtLargeGovernance();
  await examplePortal404();

  // Query examples
  await exampleQueryTier1California();
  await exampleQueryAtLarge();
  await exampleQueryRetryCandidates();

  // Stats example
  await exampleGetStats();
}

// Uncomment to run examples:
// main().catch(console.error);
