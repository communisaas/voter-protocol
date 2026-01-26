/**
 * Shadow Atlas Provenance System - Integration Example
 *
 * Demonstrates complete workflow:
 * 1. Source registry lookup
 * 2. Conflict resolution
 * 3. Provenance logging
 */

import { SourceRegistry } from '../src/provenance/source-registry.js';
import { ConflictResolver } from '../src/provenance/conflict-resolver.js';
import { ProvenanceWriter } from '../src/provenance/provenance-writer.js';
import { BoundaryType } from '../src/core/types.js';
import type { SourceClaim } from '../src/provenance/conflict-resolver.js';
import type { CompactDiscoveryEntry } from '../src/provenance/provenance-writer.js';

/**
 * Example: Congressional District Resolution
 *
 * Shows how to:
 * 1. Select best source for congressional districts
 * 2. Resolve conflicts between Census TIGER and state authority
 * 3. Log the decision for audit trail
 */
async function exampleCongressionalDistrict(): Promise<void> {
  console.log('=== Congressional District Resolution Example ===\n');

  // 1. SOURCE REGISTRY: Select best source
  const registry = new SourceRegistry();
  const selected = await registry.selectSource(BoundaryType.CONGRESSIONAL_DISTRICT);

  console.log('Selected Source:');
  console.log(`  Name: ${'name' in selected.source ? selected.source.name : selected.source.entity}`);
  console.log(`  Primary: ${selected.isPrimary}`);
  console.log(`  Reason: ${selected.reason}`);
  console.log(`  Confidence: ${selected.confidence}/100`);
  console.log();

  // 2. CONFLICT RESOLUTION: Multiple sources disagree
  const resolver = new ConflictResolver();

  const censusClaim: SourceClaim = {
    sourceId: 'census-tiger-2024',
    sourceName: 'Census TIGER 2024',
    boundary: {}, // GeoJSON geometry would go here
    lastModified: Date.UTC(2024, 6, 1), // July 1, 2024
    isPrimary: false, // Aggregator
    authorityLevel: 3,
  };

  const stateAuthorityClaim: SourceClaim = {
    sourceId: 'ca-redistricting-2022',
    sourceName: 'CA Citizens Redistricting Commission',
    boundary: {}, // GeoJSON geometry would go here
    lastModified: Date.UTC(2022, 2, 15), // March 15, 2022
    isPrimary: true, // Primary authority
    authorityLevel: 5,
  };

  const result = await resolver.resolveConflict('us-ca-06', [
    censusClaim,
    stateAuthorityClaim,
  ]);

  console.log('Conflict Resolution:');
  console.log(`  Winner: ${result.winner.sourceName}`);
  console.log(`  Reason: ${result.decision.reason}`);
  console.log(`  Confidence: ${result.decision.confidence}/100`);
  console.log(`  Alternatives considered: ${result.decision.alternativesCounted}`);
  console.log(`  Rejected sources: ${result.decision.rejected.length}`);
  console.log();

  result.decision.rejected.forEach((rejected) => {
    console.log(`    - ${rejected.sourceId}: ${rejected.reason}`);
  });
  console.log();

  // 3. PROVENANCE LOGGING: Record the decision
  const writer = new ProvenanceWriter('./discovery-attempts');

  const entry: CompactDiscoveryEntry = {
    f: '0666000', // San Diego FIPS
    n: 'San Diego',
    s: 'CA',
    p: 1386932,
    g: 1, // Tier 1 (council district)
    fc: 9, // 9 districts
    conf: result.decision.confidence,
    auth: 5, // Primary authority (state redistricting)
    src: 'ca-redistricting',
    url: result.winner.sourceName,
    q: {
      v: true,
      t: 1,
      r: 250,
      d: '2022-03-15',
    },
    why: [
      'Selected primary authority over Census aggregator',
      `Confidence: ${result.decision.confidence}`,
      `Rejected ${result.decision.alternativesCounted} alternatives`,
    ],
    tried: [1],
    blocked: null,
    ts: new Date().toISOString(),
    aid: 'example-001',
  };

  console.log('Provenance Entry:');
  console.log(JSON.stringify(entry, null, 2));
  console.log();

  // Note: Comment out the actual write to avoid creating files in example
  // await writer.append(entry);
  console.log('(Entry not written - this is an example)');
}

/**
 * Example: Querying Provenance History
 *
 * Shows how to query historical decisions
 */
async function exampleQueryProvenance(): Promise<void> {
  console.log('\n=== Provenance Query Example ===\n');

  const writer = new ProvenanceWriter('./discovery-attempts');

  // Query high-confidence California discoveries
  const results = await writer.query({
    state: 'CA',
    minConfidence: 80,
    tier: 1,
  });

  console.log(`Found ${results.length} high-confidence tier-1 discoveries in CA`);

  // Get statistics
  const stats = await writer.getStats();
  console.log('\nProvenance Statistics:');
  console.log(`  Total entries: ${stats.totalEntries}`);
  console.log(`  Average confidence: ${stats.avgConfidence.toFixed(1)}/100`);
  console.log('\nBy Tier:');
  Object.entries(stats.byTier).forEach(([tier, count]) => {
    console.log(`    Tier ${tier}: ${count} entries`);
  });
  console.log('\nBy Authority:');
  Object.entries(stats.byAuthority).forEach(([auth, count]) => {
    const authNames = [
      'Unknown',
      'Community Maintained',
      'Hub Aggregator',
      'Municipal Official',
      'State Mandate',
      'Federal Mandate',
    ];
    console.log(`    ${authNames[Number(auth)]}: ${count} entries`);
  });
}

/**
 * Example: Source Registry Inspection
 *
 * Shows available sources for each boundary type
 */
function exampleSourceRegistry(): void {
  console.log('\n=== Source Registry Inspection ===\n');

  const registry = new SourceRegistry();
  const boundaryTypes = registry.getRegisteredBoundaryTypes();

  console.log('Registered Boundary Types:');
  boundaryTypes.forEach((type) => {
    const authority = registry.getAuthorityInfo(type);
    const aggregators = registry.getAggregators(type);

    console.log(`\n${type}:`);
    console.log(`  Authority: ${authority?.entity || 'None'}`);
    console.log(`  Legal Basis: ${authority?.legalBasis || 'N/A'}`);
    console.log(`  Aggregators: ${aggregators.length}`);

    aggregators.forEach((agg) => {
      console.log(`    - ${agg.name} (${agg.format}, lag: ${agg.lag})`);
    });
  });
}

/**
 * Run all examples
 */
async function main(): Promise<void> {
  try {
    await exampleCongressionalDistrict();
    exampleSourceRegistry();
    await exampleQueryProvenance();
  } catch (error) {
    console.error('Example failed:', error);
    process.exit(1);
  }
}

// Export examples for use in other modules
export { exampleCongressionalDistrict, exampleQueryProvenance, exampleSourceRegistry, main };
