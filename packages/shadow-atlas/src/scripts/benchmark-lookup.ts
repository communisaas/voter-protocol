#!/usr/bin/env tsx
/**
 * District Lookup Benchmark
 *
 * Measures point-in-polygon lookup performance against shadow-atlas.db.
 * Runs N queries with random US coordinates, reports latency percentiles.
 *
 * Usage:
 *   npx tsx src/scripts/benchmark-lookup.ts
 *   npx tsx src/scripts/benchmark-lookup.ts --db ./data/shadow-atlas.db --queries 5000
 *   npx tsx src/scripts/benchmark-lookup.ts --multi  # Test lookupAll() instead of lookup()
 */

import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { DistrictLookupService } from '../serving/district-service.js';

const { values: args } = parseArgs({
  options: {
    db: { type: 'string', default: './data/shadow-atlas.db' },
    queries: { type: 'string', default: '1000' },
    multi: { type: 'boolean', default: false },
    warmup: { type: 'string', default: '50' },
  },
  strict: false,
});

const dbPath = args.db as string;
const totalQueries = parseInt(args.queries as string, 10);
const useMulti = args.multi as boolean;
const warmupCount = parseInt(args.warmup as string, 10);

if (isNaN(totalQueries) || totalQueries < 1) {
  console.error('--queries must be a positive integer');
  process.exit(1);
}
if (isNaN(warmupCount) || warmupCount < 0) {
  console.error('--warmup must be a non-negative integer');
  process.exit(1);
}

// US bounding box (CONUS + Alaska + Hawaii)
const US_REGIONS = [
  // CONUS (weight: 80%)
  { minLat: 24.5, maxLat: 49.5, minLon: -125.0, maxLon: -66.5, weight: 0.80 },
  // Alaska (weight: 10%)
  { minLat: 54.0, maxLat: 71.5, minLon: -170.0, maxLon: -130.0, weight: 0.10 },
  // Hawaii (weight: 5%)
  { minLat: 18.5, maxLat: 22.5, minLon: -160.5, maxLon: -154.5, weight: 0.05 },
  // Canadian coverage (weight: 5%)
  { minLat: 42.0, maxLat: 60.0, minLon: -141.0, maxLon: -52.0, weight: 0.05 },
];

function randomCoord(): { lat: number; lon: number } {
  const r = Math.random();
  let cumulative = 0;
  for (const region of US_REGIONS) {
    cumulative += region.weight;
    if (r < cumulative) {
      return {
        lat: region.minLat + Math.random() * (region.maxLat - region.minLat),
        lon: region.minLon + Math.random() * (region.maxLon - region.minLon),
      };
    }
  }
  // Fallback: CONUS
  const conus = US_REGIONS[0];
  return {
    lat: conus.minLat + Math.random() * (conus.maxLat - conus.minLat),
    lon: conus.minLon + Math.random() * (conus.maxLon - conus.minLon),
  };
}

// Known US locations for hit-rate testing
const KNOWN_LOCATIONS = [
  { name: 'San Francisco', lat: 37.7793, lon: -122.4193 },
  { name: 'New York City', lat: 40.7128, lon: -74.0060 },
  { name: 'Chicago', lat: 41.8781, lon: -87.6298 },
  { name: 'Houston', lat: 29.7604, lon: -95.3698 },
  { name: 'Phoenix', lat: 33.4484, lon: -112.0740 },
  { name: 'Washington DC', lat: 38.9072, lon: -77.0369 },
  { name: 'Los Angeles', lat: 34.0522, lon: -118.2437 },
  { name: 'Denver', lat: 39.7392, lon: -104.9903 },
  { name: 'Seattle', lat: 47.6062, lon: -122.3321 },
  { name: 'Miami', lat: 25.7617, lon: -80.1918 },
  { name: 'Ottawa', lat: 45.4215, lon: -75.6972 },
  { name: 'Anchorage', lat: 61.2181, lon: -149.9003 },
];

// ============================================================================
// Main
// ============================================================================

if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

console.log('═'.repeat(72));
console.log('  Shadow Atlas Lookup Benchmark');
console.log('═'.repeat(72));
console.log(`  Database:   ${dbPath}`);
console.log(`  Queries:    ${totalQueries}`);
console.log(`  Warmup:     ${warmupCount}`);
console.log(`  Mode:       ${useMulti ? 'lookupAll() (multi-hit)' : 'lookup() (single-hit)'}`);
console.log('─'.repeat(72));

const service = new DistrictLookupService(dbPath);

try {
  // Phase 1: Known location spot checks
  console.log('\n  SPOT CHECKS (known locations)');
  console.log('─'.repeat(72));

  for (const loc of KNOWN_LOCATIONS) {
    const result = useMulti
      ? service.lookupAll(loc.lat, loc.lon)
      : service.lookup(loc.lat, loc.lon);

    if (useMulti) {
      const multi = result as ReturnType<DistrictLookupService['lookupAll']>;
      const layers = multi.districts.map(d => d.id.split('-')[0]).join(', ');
      console.log(
        `  ${loc.name.padEnd(18)} ${multi.districts.length} hit(s)  ${multi.latencyMs.toFixed(1)}ms  [${layers}]`
      );
    } else {
      const single = result as ReturnType<DistrictLookupService['lookup']>;
      console.log(
        `  ${loc.name.padEnd(18)} ${(single.district ? single.district.id : 'MISS').padEnd(20)}  ${single.latencyMs.toFixed(1)}ms`
      );
    }
  }

  // Clear cache for benchmark
  service.clearCache();

  // Phase 2: Warmup
  console.log(`\n  WARMUP (${warmupCount} queries, results discarded)`);
  console.log('─'.repeat(72));

  for (let i = 0; i < warmupCount; i++) {
    const { lat, lon } = randomCoord();
    try {
      if (useMulti) {
        service.lookupAll(lat, lon);
      } else {
        service.lookup(lat, lon);
      }
    } catch {
      // Invalid coordinates possible from random generation
    }
  }
  console.log('  Done.');
  service.clearCache();

  // Phase 3: Benchmark
  console.log(`\n  BENCHMARK (${totalQueries} random queries, mixed cold→warm LRU)`);
  console.log('─'.repeat(72));

  let hits = 0;
  let misses = 0;
  const latencies: number[] = [];
  const startTotal = performance.now();

  for (let i = 0; i < totalQueries; i++) {
    const { lat, lon } = randomCoord();
    try {
      if (useMulti) {
        const result = service.lookupAll(lat, lon);
        latencies.push(result.latencyMs);
        if (result.districts.length > 0) hits++;
        else misses++;
      } else {
        const result = service.lookup(lat, lon);
        latencies.push(result.latencyMs);
        if (result.district) hits++;
        else misses++;
      }
    } catch {
      misses++;
    }
  }

  const totalTime = performance.now() - startTotal;

  // Compute percentiles
  latencies.sort((a, b) => a - b);
  const p = (pct: number) => {
    if (latencies.length === 0) return 0;
    const idx = Math.ceil(latencies.length * pct) - 1;
    return latencies[Math.max(0, idx)];
  };

  const metrics = service.getMetrics();

  console.log(`\n  RESULTS`);
  console.log('═'.repeat(72));
  console.log(`  Total time:     ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`  Queries/sec:    ${(totalQueries / (totalTime / 1000)).toFixed(0)}`);
  console.log(`  Hits:           ${hits} (${((hits / totalQueries) * 100).toFixed(1)}%)`);
  console.log(`  Misses:         ${misses} (${((misses / totalQueries) * 100).toFixed(1)}%)`);
  console.log(`  Cache hit rate: ${(metrics.cacheHitRate * 100).toFixed(1)}%`);
  console.log(`  Cache size:     ${metrics.cacheSize}`);
  console.log();
  console.log(`  Latency (ms):`);
  console.log(`    p50:  ${p(0.50).toFixed(2)}`);
  console.log(`    p75:  ${p(0.75).toFixed(2)}`);
  console.log(`    p90:  ${p(0.90).toFixed(2)}`);
  console.log(`    p95:  ${p(0.95).toFixed(2)}`);
  console.log(`    p99:  ${p(0.99).toFixed(2)}`);
  console.log(`    max:  ${p(1.0).toFixed(2)}`);
  console.log();

  // Pass/fail against target
  const p95 = p(0.95);
  if (p95 < 50) {
    console.log(`  PASS: p95 ${p95.toFixed(2)}ms < 50ms target`);
  } else {
    console.log(`  FAIL: p95 ${p95.toFixed(2)}ms >= 50ms target`);
  }
  console.log('═'.repeat(72));
} finally {
  service.close();
}
