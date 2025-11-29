#!/usr/bin/env npx tsx
/**
 * Bulk City Council District Discovery
 *
 * Systematically discovers council district boundaries for ALL US cities.
 *
 * USAGE:
 * ```bash
 * # Discover all major cities (100k+ population)
 * npx tsx scripts/discover-all-cities.ts --tier major
 *
 * # Discover specific state
 * npx tsx scripts/discover-all-cities.ts --state TX
 *
 * # Discover all cities (full bootstrap - ~12 hours)
 * npx tsx scripts/discover-all-cities.ts --tier all
 *
 * # Resume from previous run
 * npx tsx scripts/discover-all-cities.ts --resume
 * ```
 *
 * OUTPUT:
 * - Writes results to data/discovery-results-{timestamp}.json
 * - Logs progress to console
 * - Updates known-portals.ts with high-confidence discoveries
 *
 * STRATEGY:
 * 1. Load all Census places from TIGERweb API
 * 2. Filter by population tier and governance type
 * 3. Skip cities already in known-portals registry
 * 4. Query ArcGIS Hub API for council district data
 * 5. Fall back to Socrata for failures
 * 6. Validate downloads with PostDownloadValidator
 * 7. Write successful discoveries to registry
 */

import { CensusPlaceListLoader, POPULATION_TIERS } from '../registry/census-place-list.js';
import { KNOWN_PORTALS, type KnownPortal } from '../registry/known-portals.js';
import { ArcGISHubScanner } from '../scanners/arcgis-hub.js';
import { SocrataScanner } from '../scanners/socrata.js';
import { PostDownloadValidator } from '../acquisition/post-download-validator.js';
import type { PortalCandidate } from '../scanners/arcgis-hub.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * CLI arguments
 */
interface CliArgs {
  tier: 'major' | 'medium' | 'small' | 'very-small' | 'all';
  state?: string;
  resume: boolean;
  dryRun: boolean;
  limit?: number;
  concurrency: number;
  outputDir: string;
}

/**
 * Discovery result for a single city
 */
interface CityDiscoveryResult {
  readonly geoid: string;
  readonly cityName: string;
  readonly state: string;
  readonly population: number;
  readonly status: 'found' | 'not_found' | 'at_large' | 'error' | 'skipped';
  readonly portal?: KnownPortal;
  readonly errorMessage?: string;
  readonly candidatesAttempted: number;
  readonly durationMs: number;
}

/**
 * Batch discovery state (for resume)
 */
interface DiscoveryState {
  readonly startedAt: string;
  readonly tier: string;
  readonly state?: string;
  readonly totalCities: number;
  readonly processedCities: string[];
  readonly results: CityDiscoveryResult[];
}

/**
 * Parse CLI arguments
 */
function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  const result: CliArgs = {
    tier: 'major',
    resume: false,
    dryRun: false,
    concurrency: 5,
    outputDir: path.join(process.cwd(), 'services/shadow-atlas/data'),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--tier':
        result.tier = args[++i] as CliArgs['tier'];
        break;
      case '--state':
        result.state = args[++i];
        break;
      case '--resume':
        result.resume = true;
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--limit':
        result.limit = parseInt(args[++i], 10);
        break;
      case '--concurrency':
        result.concurrency = parseInt(args[++i], 10);
        break;
      case '--output-dir':
        result.outputDir = args[++i];
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  return result;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Bulk City Council District Discovery

USAGE:
  npx tsx scripts/discover-all-cities.ts [OPTIONS]

OPTIONS:
  --tier <tier>       Population tier to discover (major|medium|small|very-small|all)
                      Default: major (100k+ population)
  --state <abbr>      Only discover cities in specific state (e.g., TX, CA)
  --resume            Resume from previous run (uses latest state file)
  --dry-run           Print cities to discover without making API calls
  --limit <n>         Limit to first N cities (for testing)
  --concurrency <n>   Number of concurrent API requests (default: 5)
  --output-dir <dir>  Output directory for results (default: data/)
  --help              Show this help message

EXAMPLES:
  # Discover all major cities (500 cities, ~20 minutes)
  npx tsx scripts/discover-all-cities.ts --tier major

  # Discover Texas cities only
  npx tsx scripts/discover-all-cities.ts --state TX

  # Test with 10 cities
  npx tsx scripts/discover-all-cities.ts --tier major --limit 10

  # Full bootstrap (19,495 cities, ~12 hours)
  npx tsx scripts/discover-all-cities.ts --tier all
`);
}

/**
 * Download and validate a candidate URL
 */
async function downloadAndValidate(
  candidate: PortalCandidate
): Promise<{ valid: boolean; confidence: number; featureCount: number; reason?: string }> {
  try {
    const response = await fetch(candidate.downloadUrl, {
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return { valid: false, confidence: 0, featureCount: 0, reason: `HTTP ${response.status}` };
    }

    const geojson = await response.json();

    // Validate with PostDownloadValidator
    const validator = new PostDownloadValidator({
      minFeatures: 1,
      maxFeatures: 100, // Reject if >100 (likely precincts, not districts)
      requirePolygons: true,
      strictBounds: true,
    });

    const validation = validator.validate(geojson, {
      source: candidate.downloadUrl,
      city: candidate.title,
    });

    if (!validation.valid) {
      return {
        valid: false,
        confidence: validation.confidence,
        featureCount: 0,
        reason: validation.issues.join('; '),
      };
    }

    return {
      valid: true,
      confidence: validation.confidence,
      featureCount: validation.metadata.featureCount,
    };
  } catch (error) {
    return {
      valid: false,
      confidence: 0,
      featureCount: 0,
      reason: `Download error: ${(error as Error).message}`,
    };
  }
}

/**
 * Discover council districts for a single city
 */
async function discoverCity(
  city: { geoid: string; name: string; stateAbbr: string; population: number },
  arcgisScanner: ArcGISHubScanner,
  socrataScanner: SocrataScanner
): Promise<CityDiscoveryResult> {
  const startTime = Date.now();

  // Skip very small cities (likely at-large governance)
  // Only filter if we have population data (non-zero)
  if (city.population > 0 && city.population < 5000) {
    return {
      geoid: city.geoid,
      cityName: city.name,
      state: city.stateAbbr,
      population: city.population,
      status: 'at_large',
      errorMessage: 'Population < 5,000 - likely at-large governance',
      candidatesAttempted: 0,
      durationMs: Date.now() - startTime,
    };
  }

  // Already in registry?
  if (KNOWN_PORTALS[city.geoid]) {
    return {
      geoid: city.geoid,
      cityName: city.name,
      state: city.stateAbbr,
      population: city.population,
      status: 'skipped',
      errorMessage: 'Already in known-portals registry',
      candidatesAttempted: 0,
      durationMs: Date.now() - startTime,
    };
  }

  const cityTarget = {
    fips: city.geoid,
    name: city.name,
    state: city.stateAbbr,
  };

  try {
    // Run scanners in parallel
    const [arcgisCandidates, socrataCandidates] = await Promise.all([
      arcgisScanner.search(cityTarget).catch(() => []),
      socrataScanner.search(cityTarget).catch(() => []),
    ]);

    const allCandidates = [...arcgisCandidates, ...socrataCandidates];

    if (allCandidates.length === 0) {
      return {
        geoid: city.geoid,
        cityName: city.name,
        state: city.stateAbbr,
        population: city.population,
        status: 'not_found',
        errorMessage: 'No candidates found by any scanner',
        candidatesAttempted: 0,
        durationMs: Date.now() - startTime,
      };
    }

    // Sort by score and try each
    const sortedCandidates = allCandidates.sort((a, b) => b.score - a.score);

    for (let i = 0; i < Math.min(sortedCandidates.length, 5); i++) {
      const candidate = sortedCandidates[i];
      const validation = await downloadAndValidate(candidate);

      if (validation.valid && validation.confidence >= 60) {
        const portal: KnownPortal = {
          cityFips: city.geoid,
          cityName: city.name,
          state: city.stateAbbr,
          portalType:
            candidate.portalType === 'arcgis-hub' || candidate.portalType === 'arcgis-online'
              ? 'arcgis'
              : candidate.portalType === 'socrata'
                ? 'socrata'
                : 'municipal-gis',
          downloadUrl: candidate.downloadUrl,
          featureCount: validation.featureCount,
          lastVerified: new Date().toISOString(),
          confidence: validation.confidence,
          discoveredBy: 'automated',
          notes: `${city.name} ${city.stateAbbr} City Council Districts - Bulk discovery ${new Date().toISOString().split('T')[0]}`,
        };

        return {
          geoid: city.geoid,
          cityName: city.name,
          state: city.stateAbbr,
          population: city.population,
          status: 'found',
          portal,
          candidatesAttempted: i + 1,
          durationMs: Date.now() - startTime,
        };
      }
    }

    return {
      geoid: city.geoid,
      cityName: city.name,
      state: city.stateAbbr,
      population: city.population,
      status: 'not_found',
      errorMessage: `All ${Math.min(sortedCandidates.length, 5)} candidates failed validation`,
      candidatesAttempted: Math.min(sortedCandidates.length, 5),
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      geoid: city.geoid,
      cityName: city.name,
      state: city.stateAbbr,
      population: city.population,
      status: 'error',
      errorMessage: (error as Error).message,
      candidatesAttempted: 0,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Main discovery function
 */
async function main(): Promise<void> {
  const args = parseArgs();

  console.log('\n========================================');
  console.log('  BULK CITY COUNCIL DISTRICT DISCOVERY');
  console.log('========================================\n');

  // Initialize loaders and scanners
  const placeLoader = new CensusPlaceListLoader();
  const arcgisScanner = new ArcGISHubScanner();
  const socrataScanner = new SocrataScanner();

  // Load cities based on tier
  console.log(`Loading ${args.tier} cities from Census TIGERweb API...`);

  console.log(`Querying Census TIGERweb API...`);
  let cities = await placeLoader.loadByTier(args.tier);
  console.log(`Loaded ${cities.length} cities from Census API`);

  // Filter by state if specified
  if (args.state) {
    const stateUpper = args.state.toUpperCase();
    cities = cities.filter((c) => c.stateAbbr === stateUpper);
    console.log(`Filtered to ${stateUpper}: ${cities.length} cities`);
  }

  // Apply limit if specified
  if (args.limit) {
    cities = cities.slice(0, args.limit);
    console.log(`Limited to first ${args.limit} cities`);
  }

  // Sort by population (largest first)
  cities.sort((a, b) => b.population - a.population);

  const tierInfo = POPULATION_TIERS[args.tier === 'very-small' ? 'verySmall' : args.tier] ||
    POPULATION_TIERS.major;

  console.log(`\nDiscovery Plan:`);
  console.log(`  Tier: ${args.tier} (${tierInfo.description})`);
  console.log(`  Total cities: ${cities.length}`);
  console.log(`  Already in registry: ${cities.filter((c) => KNOWN_PORTALS[c.geoid]).length}`);
  console.log(`  To discover: ${cities.filter((c) => !KNOWN_PORTALS[c.geoid]).length}`);
  console.log(`  Expected success rate: ${Math.round(tierInfo.expectedDistrictCoverage * 100)}%`);
  console.log(`  Concurrency: ${args.concurrency}`);

  if (args.dryRun) {
    console.log('\n[DRY RUN] Would discover these cities:');
    for (const city of cities.slice(0, 20)) {
      const inRegistry = KNOWN_PORTALS[city.geoid] ? '[SKIP]' : '';
      console.log(
        `  ${city.name}, ${city.stateAbbr} (pop: ${city.population.toLocaleString()}) ${inRegistry}`
      );
    }
    if (cities.length > 20) {
      console.log(`  ... and ${cities.length - 20} more`);
    }
    return;
  }

  // Ensure output directory exists
  if (!fs.existsSync(args.outputDir)) {
    fs.mkdirSync(args.outputDir, { recursive: true });
  }

  // Process cities
  const results: CityDiscoveryResult[] = [];
  const startTime = Date.now();

  console.log('\nStarting discovery...\n');

  // Process in batches for concurrency control
  const BATCH_SIZE = args.concurrency;

  for (let i = 0; i < cities.length; i += BATCH_SIZE) {
    const batch = cities.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map((city) =>
        discoverCity(
          {
            geoid: city.geoid,
            name: city.name,
            stateAbbr: city.stateAbbr,
            population: city.population,
          },
          arcgisScanner,
          socrataScanner
        )
      )
    );

    results.push(...batchResults);

    // Log progress
    const found = results.filter((r) => r.status === 'found').length;
    const notFound = results.filter((r) => r.status === 'not_found').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const atLarge = results.filter((r) => r.status === 'at_large').length;
    const errors = results.filter((r) => r.status === 'error').length;

    const elapsed = (Date.now() - startTime) / 1000;
    const rate = results.length / elapsed;
    const remaining = (cities.length - results.length) / rate;

    console.log(
      `[${results.length}/${cities.length}] ` +
        `Found: ${found} | Not found: ${notFound} | Skipped: ${skipped} | At-large: ${atLarge} | Errors: ${errors} | ` +
        `ETA: ${Math.round(remaining / 60)}m`
    );

    // Log individual results
    for (const result of batchResults) {
      const icon =
        result.status === 'found'
          ? '✅'
          : result.status === 'skipped'
            ? '⏭️'
            : result.status === 'at_large'
              ? '🏛️'
              : result.status === 'error'
                ? '❌'
                : '❓';

      console.log(`  ${icon} ${result.cityName}, ${result.state} (${result.status})`);
    }

    // Rate limiting delay
    if (i + BATCH_SIZE < cities.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Write results
  const outputPath = path.join(
    args.outputDir,
    `discovery-results-${args.tier}-${new Date().toISOString().split('T')[0]}.json`
  );

  const output = {
    timestamp: new Date().toISOString(),
    tier: args.tier,
    state: args.state,
    summary: {
      total: cities.length,
      found: results.filter((r) => r.status === 'found').length,
      notFound: results.filter((r) => r.status === 'not_found').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      atLarge: results.filter((r) => r.status === 'at_large').length,
      errors: results.filter((r) => r.status === 'error').length,
      successRate:
        Math.round(
          (results.filter((r) => r.status === 'found').length /
            results.filter((r) => r.status !== 'skipped' && r.status !== 'at_large').length) *
            100
        ) || 0,
    },
    discoveries: results.filter((r) => r.status === 'found').map((r) => r.portal),
    failures: results
      .filter((r) => r.status === 'not_found' || r.status === 'error')
      .map((r) => ({
        geoid: r.geoid,
        cityName: r.cityName,
        state: r.state,
        population: r.population,
        reason: r.errorMessage,
        candidatesAttempted: r.candidatesAttempted,
      })),
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  // Summary
  console.log('\n========================================');
  console.log('  DISCOVERY COMPLETE');
  console.log('========================================\n');

  console.log(`Results:`);
  console.log(`  ✅ Found: ${output.summary.found}`);
  console.log(`  ❓ Not found: ${output.summary.notFound}`);
  console.log(`  ⏭️  Skipped (in registry): ${output.summary.skipped}`);
  console.log(`  🏛️  At-large: ${output.summary.atLarge}`);
  console.log(`  ❌ Errors: ${output.summary.errors}`);
  console.log(`  📈 Success rate: ${output.summary.successRate}%`);
  console.log(`\n💾 Results written to: ${outputPath}`);

  // List new discoveries
  if (output.discoveries.length > 0) {
    console.log(`\n🎉 NEW DISCOVERIES (add to known-portals.ts):`);
    for (const portal of output.discoveries) {
      console.log(`\n  '${portal?.cityFips}': {`);
      console.log(`    cityFips: '${portal?.cityFips}',`);
      console.log(`    cityName: '${portal?.cityName}',`);
      console.log(`    state: '${portal?.state}',`);
      console.log(`    portalType: '${portal?.portalType}',`);
      console.log(`    downloadUrl: '${portal?.downloadUrl}',`);
      console.log(`    featureCount: ${portal?.featureCount},`);
      console.log(`    lastVerified: '${portal?.lastVerified}',`);
      console.log(`    confidence: ${portal?.confidence},`);
      console.log(`    discoveredBy: 'automated',`);
      console.log(`    notes: '${portal?.notes}',`);
      console.log(`  },`);
    }
  }

  // Exit with appropriate code
  const targetSuccessRate = tierInfo.expectedDistrictCoverage * 100;
  if (output.summary.successRate >= targetSuccessRate * 0.8) {
    console.log(`\n🎉 SUCCESS! Hit ${Math.round(targetSuccessRate * 0.8)}%+ target`);
    process.exit(0);
  } else {
    console.log(`\n⚠️  Below ${Math.round(targetSuccessRate * 0.8)}% target`);
    process.exit(1);
  }
}

// Run if executed directly
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
