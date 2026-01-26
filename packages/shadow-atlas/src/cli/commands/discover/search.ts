/**
 * Discover Search Command
 *
 * Search for new municipal GIS portals across multiple sources:
 * - ArcGIS Hub API
 * - Socrata Open Data
 * - Regional aggregators
 *
 * Usage:
 *   shadow-atlas discover search [options]
 *
 * Options:
 *   --source <type>       Source: arcgis-hub|socrata|regional|all (default: all)
 *   --state <code>        Filter by state (e.g., CA, TX)
 *   --city <name>         Search specific city
 *   --population-min <n>  Minimum population threshold
 *   --keywords <list>     Search keywords (comma-separated)
 *   --limit <n>           Maximum results (default: 100)
 *   --output <file>       Output file path
 *   --format <fmt>        Output format: json|ndjson|table (default: table)
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Command } from 'commander';
import { writeFile } from 'fs/promises';
import {
  searchAll,
  scoreCandidate,
  type SearchSource,
  type PortalCandidate,
} from '../../lib/discovery.js';

/**
 * Search options from CLI
 */
interface SearchOptions {
  readonly source: SearchSource;
  readonly state?: string;
  readonly city?: string;
  readonly populationMin?: string;
  readonly keywords?: string;
  readonly limit: string;
  readonly output?: string;
  readonly format: 'json' | 'ndjson' | 'table';
  readonly verbose?: boolean;
  readonly json?: boolean;
}

/**
 * Register the search command
 */
export function registerSearchCommand(parent: Command): void {
  parent
    .command('search')
    .description('Search for new municipal GIS portals')
    .option(
      '-s, --source <type>',
      'Source: arcgis-hub|socrata|regional|all',
      'all'
    )
    .option('--state <code>', 'Filter by state code (e.g., CA, TX)')
    .option('--city <name>', 'Search specific city')
    .option('--population-min <n>', 'Minimum population threshold')
    .option('-k, --keywords <list>', 'Search keywords (comma-separated)')
    .option('-l, --limit <n>', 'Maximum results', '100')
    .option('-o, --output <file>', 'Output file path')
    .option(
      '-f, --format <fmt>',
      'Output format: json|ndjson|table',
      'table'
    )
    .option('-v, --verbose', 'Verbose output')
    .option('--json', 'Output as JSON (shortcut for --format json)')
    .action(async (options: SearchOptions) => {
      await executeSearch(options);
    });
}

/**
 * Execute the search command
 */
async function executeSearch(options: SearchOptions): Promise<void> {
  const format = options.json ? 'json' : options.format;

  // Parse options
  const source = validateSource(options.source);
  const limit = parseInt(options.limit, 10);
  const populationMin = options.populationMin
    ? parseInt(options.populationMin, 10)
    : undefined;
  const keywords = options.keywords?.split(',').map((k) => k.trim());

  if (format === 'table') {
    console.log('\nShadow Atlas Portal Discovery');
    console.log('='.repeat(50));
    console.log(`Source: ${source}`);
    if (options.state) console.log(`State: ${options.state}`);
    if (options.city) console.log(`City: ${options.city}`);
    if (keywords) console.log(`Keywords: ${keywords.join(', ')}`);
    console.log(`Limit: ${limit}`);
    console.log('');
    console.log('Searching...\n');
  }

  try {
    const result = await searchAll(source, {
      state: options.state,
      city: options.city,
      populationMin,
      keywords,
      limit,
    });

    // Re-score candidates
    const scoredCandidates = result.candidates.map((candidate) => ({
      ...candidate,
      confidence: scoreCandidate(candidate),
    }));

    // Sort by score
    const sortedCandidates = [...scoredCandidates].sort(
      (a, b) => b.confidence - a.confidence
    );

    // Output results
    if (format === 'json') {
      const output = {
        timestamp: new Date().toISOString(),
        source,
        filters: {
          state: options.state,
          city: options.city,
          populationMin,
          keywords,
        },
        total: sortedCandidates.length,
        durationMs: result.durationMs,
        errors: result.errors,
        candidates: sortedCandidates,
      };

      if (options.output) {
        await writeFile(options.output, JSON.stringify(output, null, 2));
        console.log(`Results saved to: ${options.output}`);
      } else {
        console.log(JSON.stringify(output, null, 2));
      }
    } else if (format === 'ndjson') {
      const lines = sortedCandidates.map((c) => JSON.stringify(c));
      const content = lines.join('\n');

      if (options.output) {
        await writeFile(options.output, content);
        console.log(`Results saved to: ${options.output}`);
      } else {
        console.log(content);
      }
    } else {
      // Table format
      printSearchResults(sortedCandidates, result.durationMs, options.verbose);

      if (result.errors && result.errors.length > 0) {
        console.log('\nWarnings:');
        for (const error of result.errors) {
          console.log(`  - ${error}`);
        }
      }

      if (options.output) {
        const output = {
          timestamp: new Date().toISOString(),
          source,
          total: sortedCandidates.length,
          candidates: sortedCandidates,
        };
        await writeFile(options.output, JSON.stringify(output, null, 2));
        console.log(`\nResults also saved to: ${options.output}`);
      }
    }
  } catch (error) {
    if (format === 'json') {
      console.log(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } else {
      console.error(
        `\nError: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    process.exit(1);
  }
}

/**
 * Validate source option
 */
function validateSource(source: string): SearchSource {
  const valid: SearchSource[] = ['arcgis-hub', 'socrata', 'regional', 'all'];
  if (!valid.includes(source as SearchSource)) {
    throw new Error(
      `Invalid source: ${source}. Must be one of: ${valid.join(', ')}`
    );
  }
  return source as SearchSource;
}

/**
 * Print search results in table format
 */
function printSearchResults(
  candidates: readonly PortalCandidate[],
  durationMs: number,
  verbose?: boolean
): void {
  console.log(`Found ${candidates.length} candidates in ${durationMs}ms\n`);

  if (candidates.length === 0) {
    console.log('No candidates found matching criteria.');
    return;
  }

  // Print header
  console.log(
    'Score  Source        Name                                          Records'
  );
  console.log('-'.repeat(80));

  // Print each candidate
  for (const candidate of candidates) {
    const score = String(candidate.confidence).padStart(3);
    const source = candidate.portalType.substring(0, 12).padEnd(12);
    const name =
      candidate.name.length > 45
        ? candidate.name.substring(0, 42) + '...'
        : candidate.name.padEnd(45);
    const records =
      candidate.recordCount !== null ? String(candidate.recordCount) : '-';

    console.log(`[${score}]  ${source}  ${name}  ${records}`);

    if (verbose) {
      console.log(`       URL: ${candidate.url.substring(0, 70)}...`);
      console.log(`       Owner: ${candidate.owner}`);
      if (candidate.state) {
        console.log(`       State: ${candidate.state}`);
      }
      console.log('');
    }
  }

  // Summary by source
  const bySource = new Map<string, number>();
  for (const c of candidates) {
    const current = bySource.get(c.portalType) ?? 0;
    bySource.set(c.portalType, current + 1);
  }

  console.log('\nSummary by source:');
  for (const [source, count] of bySource) {
    console.log(`  ${source}: ${count}`);
  }

  // Confidence distribution
  const high = candidates.filter((c) => c.confidence >= 80).length;
  const medium = candidates.filter(
    (c) => c.confidence >= 60 && c.confidence < 80
  ).length;
  const low = candidates.filter((c) => c.confidence < 60).length;

  console.log('\nConfidence distribution:');
  console.log(`  High (80+): ${high}`);
  console.log(`  Medium (60-79): ${medium}`);
  console.log(`  Low (<60): ${low}`);
}
