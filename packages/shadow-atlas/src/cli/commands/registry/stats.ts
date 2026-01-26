/**
 * Registry Stats Command
 *
 * Display registry statistics.
 *
 * Usage:
 *   shadow-atlas registry stats [options]
 *
 * Options:
 *   --format <fmt>      Output format: table|json (default: table)
 *   --detailed          Show detailed breakdowns
 *
 * @module cli/commands/registry/stats
 */

import { join } from 'path';
import {
  loadAllRegistries,
  type KnownPortalEntry,
  type QuarantinedPortalEntry,
  type AtLargeCityEntry,
  type QuarantinePattern,
} from '../../lib/ndjson.js';
import { printOutput, printError, formatters } from '../../lib/output.js';
import type { PortalType } from '../../../core/registry/known-portals.generated.js';

/**
 * Stats command options
 */
export interface StatsOptions {
  format?: 'table' | 'json';
  detailed?: boolean;
  dataDir?: string;
}

/**
 * Registry statistics
 */
interface RegistryStats {
  summary: {
    knownPortals: number;
    quarantinedPortals: number;
    atLargeCities: number;
    total: number;
  };
  stateDistribution: Record<string, { known: number; quarantined: number; atLarge: number }>;
  portalTypeDistribution: Record<PortalType, number>;
  quarantinePatternDistribution: Record<QuarantinePattern | string, number>;
  confidenceHistogram: {
    '0-20': number;
    '21-40': number;
    '41-60': number;
    '61-80': number;
    '81-100': number;
  };
  staleness: {
    fresh: number; // < 30 days
    recent: number; // 30-90 days
    stale: number; // > 90 days
    veryStale: number; // > 180 days
  };
  discoveredByDistribution: Record<string, number>;
}

/**
 * Calculate days since a date
 */
function daysSince(dateStr: string): number {
  const date = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Calculate statistics
 */
function calculateStats(
  knownPortals: Map<string, KnownPortalEntry>,
  quarantinedPortals: Map<string, QuarantinedPortalEntry>,
  atLargeCities: Map<string, AtLargeCityEntry>
): RegistryStats {
  const stats: RegistryStats = {
    summary: {
      knownPortals: knownPortals.size,
      quarantinedPortals: quarantinedPortals.size,
      atLargeCities: atLargeCities.size,
      total: knownPortals.size + quarantinedPortals.size + atLargeCities.size,
    },
    stateDistribution: {},
    portalTypeDistribution: {} as Record<PortalType, number>,
    quarantinePatternDistribution: {},
    confidenceHistogram: {
      '0-20': 0,
      '21-40': 0,
      '41-60': 0,
      '61-80': 0,
      '81-100': 0,
    },
    staleness: {
      fresh: 0,
      recent: 0,
      stale: 0,
      veryStale: 0,
    },
    discoveredByDistribution: {},
  };

  // Process known portals
  for (const entry of knownPortals.values()) {
    // State distribution
    if (!stats.stateDistribution[entry.state]) {
      stats.stateDistribution[entry.state] = { known: 0, quarantined: 0, atLarge: 0 };
    }
    stats.stateDistribution[entry.state].known++;

    // Portal type distribution
    if (!stats.portalTypeDistribution[entry.portalType]) {
      stats.portalTypeDistribution[entry.portalType] = 0;
    }
    stats.portalTypeDistribution[entry.portalType]++;

    // Confidence histogram
    const conf = entry.confidence;
    if (conf <= 20) stats.confidenceHistogram['0-20']++;
    else if (conf <= 40) stats.confidenceHistogram['21-40']++;
    else if (conf <= 60) stats.confidenceHistogram['41-60']++;
    else if (conf <= 80) stats.confidenceHistogram['61-80']++;
    else stats.confidenceHistogram['81-100']++;

    // Staleness
    const days = daysSince(entry.lastVerified);
    if (days < 30) stats.staleness.fresh++;
    else if (days < 90) stats.staleness.recent++;
    else if (days < 180) stats.staleness.stale++;
    else stats.staleness.veryStale++;

    // Discovered by
    const source = entry.discoveredBy || 'unknown';
    const normalizedSource = source.startsWith('wave-') ? 'wave-discovery' : source;
    if (!stats.discoveredByDistribution[normalizedSource]) {
      stats.discoveredByDistribution[normalizedSource] = 0;
    }
    stats.discoveredByDistribution[normalizedSource]++;
  }

  // Process quarantined portals
  for (const entry of quarantinedPortals.values()) {
    // State distribution
    if (!stats.stateDistribution[entry.state]) {
      stats.stateDistribution[entry.state] = { known: 0, quarantined: 0, atLarge: 0 };
    }
    stats.stateDistribution[entry.state].quarantined++;

    // Quarantine pattern distribution
    const pattern = entry.matchedPattern || 'unknown';
    if (!stats.quarantinePatternDistribution[pattern]) {
      stats.quarantinePatternDistribution[pattern] = 0;
    }
    stats.quarantinePatternDistribution[pattern]++;
  }

  // Process at-large cities
  for (const entry of atLargeCities.values()) {
    // State distribution
    if (!stats.stateDistribution[entry.state]) {
      stats.stateDistribution[entry.state] = { known: 0, quarantined: 0, atLarge: 0 };
    }
    stats.stateDistribution[entry.state].atLarge++;
  }

  return stats;
}

/**
 * Format stats as table
 */
function formatStatsAsTable(stats: RegistryStats, detailed: boolean): string {
  const lines: string[] = [];

  // Summary
  lines.push('Registry Summary');
  lines.push('='.repeat(50));
  lines.push(`Known Portals:      ${stats.summary.knownPortals.toString().padStart(6)}`);
  lines.push(`Quarantined:        ${stats.summary.quarantinedPortals.toString().padStart(6)}`);
  lines.push(`At-Large Cities:    ${stats.summary.atLargeCities.toString().padStart(6)}`);
  lines.push('-'.repeat(50));
  lines.push(`Total:              ${stats.summary.total.toString().padStart(6)}`);
  lines.push('');

  // Staleness
  lines.push('Data Freshness (Known Portals)');
  lines.push('-'.repeat(50));
  lines.push(`Fresh (<30 days):   ${stats.staleness.fresh.toString().padStart(6)}`);
  lines.push(`Recent (30-90d):    ${stats.staleness.recent.toString().padStart(6)}`);
  lines.push(`Stale (90-180d):    ${stats.staleness.stale.toString().padStart(6)}`);
  lines.push(`Very Stale (>180d): ${stats.staleness.veryStale.toString().padStart(6)}`);
  lines.push('');

  // Confidence histogram
  lines.push('Confidence Distribution (Known Portals)');
  lines.push('-'.repeat(50));
  const confTotal = Object.values(stats.confidenceHistogram).reduce((a, b) => a + b, 0);
  for (const [range, count] of Object.entries(stats.confidenceHistogram)) {
    const pct = confTotal > 0 ? ((count / confTotal) * 100).toFixed(1) : '0.0';
    const bar = '#'.repeat(Math.round((count / confTotal) * 30));
    lines.push(`${range.padEnd(8)} ${count.toString().padStart(4)} (${pct.padStart(5)}%) ${bar}`);
  }
  lines.push('');

  // Portal types
  lines.push('Portal Type Distribution');
  lines.push('-'.repeat(50));
  const sortedTypes = Object.entries(stats.portalTypeDistribution).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedTypes) {
    const pct = stats.summary.knownPortals > 0
      ? ((count / stats.summary.knownPortals) * 100).toFixed(1)
      : '0.0';
    lines.push(`${type.padEnd(18)} ${count.toString().padStart(4)} (${pct.padStart(5)}%)`);
  }
  lines.push('');

  // Quarantine patterns
  if (stats.summary.quarantinedPortals > 0) {
    lines.push('Quarantine Pattern Distribution');
    lines.push('-'.repeat(50));
    const sortedPatterns = Object.entries(stats.quarantinePatternDistribution).sort(
      (a, b) => b[1] - a[1]
    );
    for (const [pattern, count] of sortedPatterns) {
      const pct = ((count / stats.summary.quarantinedPortals) * 100).toFixed(1);
      lines.push(`${pattern.padEnd(25)} ${count.toString().padStart(3)} (${pct.padStart(5)}%)`);
    }
    lines.push('');
  }

  // State distribution (top 15)
  if (detailed) {
    lines.push('State Distribution (Top 15)');
    lines.push('-'.repeat(50));
    lines.push('State  Known  Quarantine  At-Large  Total');
    lines.push('-'.repeat(50));

    const sortedStates = Object.entries(stats.stateDistribution)
      .map(([state, counts]) => ({
        state,
        ...counts,
        total: counts.known + counts.quarantined + counts.atLarge,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);

    for (const { state, known, quarantined, atLarge, total } of sortedStates) {
      lines.push(
        `${state.padEnd(6)} ${known.toString().padStart(5)}  ${quarantined.toString().padStart(10)}  ${atLarge.toString().padStart(8)}  ${total.toString().padStart(5)}`
      );
    }
    lines.push('');

    // Discovery source distribution
    lines.push('Discovery Source Distribution');
    lines.push('-'.repeat(50));
    const sortedSources = Object.entries(stats.discoveredByDistribution).sort((a, b) => b[1] - a[1]);
    for (const [source, count] of sortedSources) {
      const pct = stats.summary.knownPortals > 0
        ? ((count / stats.summary.knownPortals) * 100).toFixed(1)
        : '0.0';
      lines.push(`${source.padEnd(20)} ${count.toString().padStart(4)} (${pct.padStart(5)}%)`);
    }
  }

  return lines.join('\n');
}

/**
 * Execute the stats command
 */
export async function statsCommand(options: StatsOptions = {}): Promise<void> {
  const format = options.format || 'table';
  const dataDir = options.dataDir || join(process.cwd(), 'data');

  try {
    // Load all registries
    const { knownPortals, quarantinedPortals, atLargeCities } = await loadAllRegistries(dataDir);

    // Calculate statistics
    const stats = calculateStats(
      knownPortals.entries,
      quarantinedPortals.entries,
      atLargeCities.entries
    );

    // Output based on format
    if (format === 'json') {
      printOutput(JSON.stringify(stats, null, 2));
    } else {
      printOutput(formatStatsAsTable(stats, options.detailed || false));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printError(`Failed to calculate stats: ${message}`);
    process.exit(2);
  }
}

/**
 * Parse CLI arguments
 */
export function parseStatsArgs(args: string[]): StatsOptions {
  const options: StatsOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--format':
      case '-f':
        if (nextArg && !nextArg.startsWith('-')) {
          options.format = nextArg as 'table' | 'json';
          i++;
        }
        break;

      case '--detailed':
      case '-d':
        options.detailed = true;
        break;

      case '--data-dir':
        if (nextArg && !nextArg.startsWith('-')) {
          options.dataDir = nextArg;
          i++;
        }
        break;
    }
  }

  return options;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log('Usage: shadow-atlas registry stats [options]');
  console.log('');
  console.log('Display registry statistics.');
  console.log('');
  console.log('Options:');
  console.log('  --format <fmt>      Output format: table|json (default: table)');
  console.log('  --detailed, -d      Show detailed breakdowns');
  console.log('');
  console.log('Examples:');
  console.log('  shadow-atlas registry stats');
  console.log('  shadow-atlas registry stats --detailed');
  console.log('  shadow-atlas registry stats --format json');
}

/**
 * CLI entry point
 */
export async function main(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const options = parseStatsArgs(args);
  await statsCommand(options);
}
