/**
 * shadow-atlas quarantine resolve <fips>
 *
 * Attempt automated resolution of a quarantined entry.
 *
 * OPTIONS:
 *   --search-strategy <s>  Resolution strategy: arcgis|socrata|manual
 *   --replacement-url <u>  Provide replacement URL directly
 *   --validate             Validate replacement before applying
 *   --apply                Apply resolution automatically (default: show recommendations)
 *
 * RESOLUTION STRATEGIES:
 *   arcgis   - Search ArcGIS Hub for city name + "council districts"
 *   socrata  - Search Socrata open data portals
 *   manual   - Provide replacement URL directly
 *
 * EXAMPLES:
 *   shadow-atlas quarantine resolve 0614218
 *   shadow-atlas quarantine resolve 0614218 --search-strategy arcgis
 *   shadow-atlas quarantine resolve 0614218 --replacement-url "https://..." --validate
 *   shadow-atlas quarantine resolve 0614218 --replacement-url "https://..." --apply
 */

import type { QuarantineCommandContext } from './index.js';
import {
  parseNdjsonFile,
  getRegistryPath,
  restoreFromQuarantine,
  isResolvable,
  validateUrl,
  searchArcGISHub,
  type NdjsonEntry,
} from '../../lib/quarantine.js';

type SearchStrategy = 'arcgis' | 'socrata' | 'manual';

interface ResolveOptions {
  searchStrategy?: SearchStrategy;
  replacementUrl?: string;
  validate?: boolean;
  apply?: boolean;
}

function parseArgs(args: string[]): { fips: string | null; options: ResolveOptions } {
  const options: ResolveOptions = {};
  let fips: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--search-strategy' && i + 1 < args.length) {
      options.searchStrategy = args[++i] as SearchStrategy;
    } else if (arg === '--replacement-url' && i + 1 < args.length) {
      options.replacementUrl = args[++i];
    } else if (arg === '--validate') {
      options.validate = true;
    } else if (arg === '--apply') {
      options.apply = true;
    } else if (!arg.startsWith('-') && !fips) {
      fips = arg;
    }
  }

  return { fips, options };
}

export async function resolveCommand(context: QuarantineCommandContext): Promise<number> {
  const { fips, options } = parseArgs(context.args);

  // Validate FIPS
  if (!fips) {
    console.error('Error: FIPS code is required');
    console.error('Usage: shadow-atlas quarantine resolve <fips> [--search-strategy <s>] [--replacement-url <url>]');
    return 2;
  }

  if (!/^\d{7}$/.test(fips)) {
    console.error(`Error: Invalid FIPS code format: ${fips}`);
    console.error('FIPS must be a 7-digit Census PLACE code');
    return 2;
  }

  // Validate search strategy
  if (options.searchStrategy && !['arcgis', 'socrata', 'manual'].includes(options.searchStrategy)) {
    console.error(`Error: Invalid search strategy: ${options.searchStrategy}`);
    console.error('Valid strategies: arcgis, socrata, manual');
    return 2;
  }

  try {
    // Load quarantined entry
    const quarantinedPath = getRegistryPath('quarantinedPortals');
    const { entries } = await parseNdjsonFile<NdjsonEntry>(quarantinedPath);

    const entry = entries.get(fips);
    if (!entry) {
      console.error(`Error: Entry not found in quarantined-portals: ${fips}`);
      return 5;
    }

    const cityName = entry.cityName as string;
    const state = entry.state as string;
    const pattern = (entry.matchedPattern as string) || 'other';

    console.log(`Resolving: ${cityName}, ${state} (${fips})`);
    console.log(`Pattern: ${pattern}`);
    console.log(`Reason: ${entry.quarantineReason}`);
    console.log('');

    // Assess resolvability
    const assessment = isResolvable(entry);

    if (context.options.verbose) {
      console.log('Resolution Assessment:');
      console.log(`  Resolvable: ${assessment.isResolvable}`);
      console.log(`  Suggested Strategy: ${assessment.suggestedStrategy}`);
      console.log(`  Confidence: ${assessment.confidence}%`);
      console.log('  Notes:');
      for (const note of assessment.notes) {
        console.log(`    - ${note}`);
      }
      console.log('');
    }

    // Handle replacement URL provided directly
    if (options.replacementUrl) {
      console.log('Replacement URL provided:', options.replacementUrl);
      console.log('');

      if (options.validate) {
        console.log('Validating URL...');
        const isValid = await validateUrl(options.replacementUrl);

        if (!isValid) {
          console.error('Error: URL validation failed');
          console.error('The URL is not accessible or returned an error.');

          if (context.options.json) {
            console.log(JSON.stringify({
              success: false,
              error: 'URL validation failed',
              url: options.replacementUrl,
            }));
          }

          return 4;
        }

        console.log('URL validation passed.');
        console.log('');
      }

      if (options.apply) {
        // Apply resolution (restore with new URL)
        if (context.options.dryRun) {
          console.log('[DRY RUN] Would restore entry with new URL. No changes made.');
          return 0;
        }

        const restoredEntry = await restoreFromQuarantine(
          fips,
          options.replacementUrl,
          options.validate,
          'cli',
          `Resolved with replacement URL: ${options.replacementUrl}`
        );

        if (context.options.json) {
          console.log(JSON.stringify({
            success: true,
            action: 'restore',
            fips,
            cityName: restoredEntry.cityName,
            state: restoredEntry.state,
            newUrl: options.replacementUrl,
          }, null, 2));
        } else {
          console.log(`Restored: ${restoredEntry.cityName}, ${restoredEntry.state} (${fips})`);
          console.log('Entry moved from quarantined-portals to known-portals.');
          console.log('Audit log updated.');
        }

        return 0;
      } else {
        console.log('Resolution prepared. Run with --apply to apply changes.');
        return 0;
      }
    }

    // Auto-search based on strategy
    const strategy: string = options.searchStrategy || assessment.suggestedStrategy;

    if (strategy === 'arcgis') {
      console.log(`Searching ArcGIS Hub for "${cityName}" "${state}" council districts...`);
      console.log('');

      const results = await searchArcGISHub(cityName, state);

      if (results.length === 0) {
        console.log('No results found on ArcGIS Hub.');
        console.log('');
        console.log('Suggestions:');
        console.log('  - Try different search terms manually');
        console.log('  - Check city official website for GIS portal');
        console.log('  - Search state GIS clearinghouse');

        if (context.options.json) {
          console.log(JSON.stringify({
            success: false,
            searchStrategy: 'arcgis',
            results: [],
            message: 'No results found',
          }));
        }

        return 1;
      }

      console.log(`Found ${results.length} potential matches:\n`);

      for (let i = 0; i < results.length; i++) {
        const result = results[i]!;
        console.log(`  ${i + 1}. ${result.title}`);
        console.log(`     URL: ${result.url}`);
        console.log(`     Confidence: ${result.confidence}%`);
        console.log('');
      }

      if (context.options.json) {
        console.log(JSON.stringify({
          success: true,
          searchStrategy: 'arcgis',
          fips,
          cityName,
          state,
          results,
        }, null, 2));
      } else {
        console.log('To apply a result, run:');
        console.log(`  shadow-atlas quarantine resolve ${fips} --replacement-url "<URL>" --validate --apply`);
      }

      return 0;
    }

    if (strategy === 'promote_to_at_large') {
      console.log('This entry appears to be at-large (single feature or confirmed at-large system).');
      console.log('');
      console.log('To promote to at-large registry, run:');
      console.log(`  shadow-atlas quarantine promote ${fips} --council-size <N> --source "<source>"`);
      console.log('');
      console.log('Make sure to verify on city website or Ballotpedia first.');

      if (context.options.json) {
        console.log(JSON.stringify({
          success: true,
          suggestedAction: 'promote',
          fips,
          cityName,
          state,
          assessment,
        }, null, 2));
      }

      return 0;
    }

    if (strategy === 'manual' || strategy === 'needs_research') {
      console.log('Manual resolution required.');
      console.log('');
      console.log('Suggestions:');
      console.log('  1. Check city official website for GIS data');
      console.log('  2. Contact city GIS department');
      console.log('  3. Search state GIS clearinghouse');
      console.log('  4. Check regional council of governments GIS');
      console.log('');
      console.log('Once you find a replacement URL, run:');
      console.log(`  shadow-atlas quarantine resolve ${fips} --replacement-url "<URL>" --validate --apply`);

      if (context.options.json) {
        console.log(JSON.stringify({
          success: false,
          suggestedAction: 'manual_research',
          fips,
          cityName,
          state,
          assessment,
        }, null, 2));
      }

      return 1;
    }

    // Socrata search (placeholder - would need Socrata API implementation)
    if (strategy === 'socrata') {
      console.log('Socrata search not yet implemented.');
      console.log('');
      console.log('Manual search: https://www.opendatanetwork.com/');
      console.log(`Search for: "${cityName}" "${state}" council districts`);

      return 1;
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);

    if (context.options.json) {
      console.log(JSON.stringify({
        success: false,
        error: message,
      }));
    }

    return 5;
  }
}
