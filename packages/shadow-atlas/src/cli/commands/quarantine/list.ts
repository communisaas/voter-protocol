/**
 * shadow-atlas quarantine list
 *
 * List all quarantined entries with filtering options.
 *
 * FILTERS:
 *   --pattern <code>    Filter by quarantine pattern
 *   --state <code>      Filter by state (e.g., CA, TX)
 *   --age <days>        Filter by quarantine age (minimum days)
 *   --resolvable        Show only entries with potential resolution paths
 *
 * OUTPUT:
 *   --json              Output as JSON
 *   --stats             Show statistics only
 *
 * EXAMPLES:
 *   shadow-atlas quarantine list
 *   shadow-atlas quarantine list --pattern cvra_gis_unavailable
 *   shadow-atlas quarantine list --resolvable --json
 *   shadow-atlas quarantine list --stats
 */

import type { QuarantineCommandContext } from './index.js';
import {
  parseNdjsonFile,
  getRegistryPath,
  getQuarantineStats,
  isResolvable,
  formatQuarantinedEntry,
  printTable,
  type NdjsonEntry,
  type QuarantinePattern,
} from '../../lib/quarantine.js';

interface ListOptions {
  pattern?: string;
  state?: string;
  age?: number;
  resolvable?: boolean;
  stats?: boolean;
}

function parseArgs(args: string[]): ListOptions {
  const options: ListOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--pattern' && i + 1 < args.length) {
      options.pattern = args[++i];
    } else if (arg === '--state' && i + 1 < args.length) {
      options.state = args[++i]?.toUpperCase();
    } else if (arg === '--age' && i + 1 < args.length) {
      options.age = parseInt(args[++i]!, 10);
    } else if (arg === '--resolvable') {
      options.resolvable = true;
    } else if (arg === '--stats') {
      options.stats = true;
    }
  }

  return options;
}

function calculateAgeDays(quarantinedAt: string): number {
  return Math.floor((Date.now() - new Date(quarantinedAt).getTime()) / (1000 * 60 * 60 * 24));
}

export async function listCommand(context: QuarantineCommandContext): Promise<number> {
  const options = parseArgs(context.args);

  try {
    // Stats-only mode
    if (options.stats) {
      const stats = await getQuarantineStats();

      if (context.options.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log('Quarantine Statistics');
        console.log('=====================');
        console.log(`Total entries: ${stats.total}`);
        console.log(`Average age: ${stats.avgAgeDays} days`);
        console.log('');

        if (stats.oldestEntry) {
          console.log(`Oldest: ${stats.oldestEntry.cityName} (${stats.oldestEntry.fips}) - ${stats.oldestEntry.ageDays} days`);
        }
        if (stats.newestEntry) {
          console.log(`Newest: ${stats.newestEntry.cityName} (${stats.newestEntry.fips}) - ${stats.newestEntry.ageDays} days`);
        }
        console.log('');

        console.log('By Pattern:');
        for (const [pattern, count] of Object.entries(stats.byPattern).sort((a, b) => b[1] - a[1])) {
          console.log(`  ${pattern}: ${count}`);
        }
        console.log('');

        console.log('By State:');
        for (const [state, count] of Object.entries(stats.byState).sort((a, b) => b[1] - a[1])) {
          console.log(`  ${state}: ${count}`);
        }
      }

      return 0;
    }

    // Load quarantined entries
    const quarantinedPath = getRegistryPath('quarantinedPortals');
    const { entries } = await parseNdjsonFile<NdjsonEntry>(quarantinedPath);

    // Apply filters
    let filteredEntries = Array.from(entries.entries());

    // Filter by pattern
    if (options.pattern) {
      filteredEntries = filteredEntries.filter(([_, entry]) => {
        return (entry.matchedPattern as string) === options.pattern;
      });
    }

    // Filter by state
    if (options.state) {
      filteredEntries = filteredEntries.filter(([_, entry]) => {
        return (entry.state as string) === options.state;
      });
    }

    // Filter by age
    if (options.age !== undefined) {
      filteredEntries = filteredEntries.filter(([_, entry]) => {
        const quarantinedAt = entry.quarantinedAt as string;
        if (!quarantinedAt) return false;
        return calculateAgeDays(quarantinedAt) >= options.age!;
      });
    }

    // Filter by resolvability
    if (options.resolvable) {
      filteredEntries = filteredEntries.filter(([_, entry]) => {
        const assessment = isResolvable(entry);
        return assessment.isResolvable;
      });
    }

    // Sort by quarantine date (newest first)
    filteredEntries.sort((a, b) => {
      const dateA = (a[1].quarantinedAt as string) || '';
      const dateB = (b[1].quarantinedAt as string) || '';
      return dateB.localeCompare(dateA);
    });

    // Output
    if (context.options.json) {
      const output = filteredEntries.map(([fips, entry]) => ({
        fips,
        cityName: entry.cityName,
        state: entry.state,
        pattern: entry.matchedPattern,
        reason: entry.quarantineReason,
        quarantinedAt: entry.quarantinedAt,
        ageDays: entry.quarantinedAt ? calculateAgeDays(entry.quarantinedAt as string) : null,
        downloadUrl: entry.downloadUrl,
        featureCount: entry.featureCount,
        ...(options.resolvable ? { assessment: isResolvable(entry) } : {}),
      }));

      console.log(JSON.stringify(output, null, 2));
    } else {
      // Table output
      if (filteredEntries.length === 0) {
        console.log('No quarantined entries found matching filters.');
        return 0;
      }

      console.log(`Found ${filteredEntries.length} quarantined entries:\n`);

      if (options.resolvable) {
        // Extended view with resolution assessment
        const headers = ['FIPS', 'City', 'State', 'Pattern', 'Age', 'Strategy', 'Conf'];
        const rows = filteredEntries.map(([fips, entry]) => {
          const formatted = formatQuarantinedEntry(entry);
          const assessment = isResolvable(entry);
          return [
            fips,
            formatted.city.slice(0, 20),
            formatted.state,
            formatted.pattern.slice(0, 20),
            formatted.age,
            assessment.suggestedStrategy.slice(0, 15),
            `${assessment.confidence}%`,
          ];
        });

        printTable(headers, rows, [7, 20, 5, 20, 5, 15, 5]);
      } else {
        // Standard view
        const headers = ['FIPS', 'City', 'State', 'Pattern', 'Age', 'Reason'];
        const rows = filteredEntries.map(([fips, entry]) => {
          const formatted = formatQuarantinedEntry(entry);
          return [
            fips,
            formatted.city.slice(0, 20),
            formatted.state,
            formatted.pattern.slice(0, 20),
            formatted.age,
            formatted.reason.slice(0, 40),
          ];
        });

        printTable(headers, rows, [7, 20, 5, 20, 5, 40]);
      }

      // Print summary
      console.log('');
      console.log(`Total: ${filteredEntries.length} entries`);

      // Show filter info
      const filters: string[] = [];
      if (options.pattern) filters.push(`pattern=${options.pattern}`);
      if (options.state) filters.push(`state=${options.state}`);
      if (options.age) filters.push(`age>=${options.age}d`);
      if (options.resolvable) filters.push('resolvable=true');

      if (filters.length > 0) {
        console.log(`Filters: ${filters.join(', ')}`);
      }
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
