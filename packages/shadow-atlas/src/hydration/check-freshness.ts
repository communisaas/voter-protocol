#!/usr/bin/env npx tsx
/**
 * Standalone CLI to check data freshness across all countries.
 *
 * Usage:
 *   npx tsx packages/shadow-atlas/src/hydration/check-freshness.ts
 *   npx tsx packages/shadow-atlas/src/hydration/check-freshness.ts --db custom.db
 */

import { checkFreshness } from './freshness-monitor.js';

function main(): void {
  const args = process.argv.slice(2);
  let dbPath = 'data/shadow-atlas.db';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) {
      dbPath = args[++i];
    } else if (args[i] === '--help') {
      console.log(`
Usage: check-freshness.ts [options]

Options:
  --db <path>   SQLite database path (default: data/shadow-atlas.db)
  --help        Show this help
`);
      process.exit(0);
    }
  }

  const reports = checkFreshness(dbPath);

  console.log('=== Shadow Atlas Data Freshness ===');
  console.log();

  // Table header
  const header = [
    'Country'.padEnd(9),
    'Source'.padEnd(22),
    'Last Ingestion'.padEnd(25),
    'Age'.padEnd(8),
    'Status',
  ].join('');
  console.log(header);

  for (const r of reports) {
    const lastStr = r.lastIngestion ? r.lastIngestion.toISOString().replace(/\.\d{3}Z$/, 'Z') : '\u2014';
    const ageStr = r.ageInDays !== null ? `${r.ageInDays}d` : '\u2014';

    const statusLabels: Record<string, string> = {
      'fresh': 'FRESH',
      'stale-warn': 'STALE (warn)',
      'stale-critical': 'STALE (critical)',
      'never-ingested': 'NEVER INGESTED',
    };
    const statusStr = statusLabels[r.status] ?? r.status;

    const row = [
      r.country.padEnd(9),
      r.source.padEnd(22),
      lastStr.padEnd(25),
      ageStr.padEnd(8),
      statusStr,
    ].join('');
    console.log(row);
  }

  // Exit with non-zero if any critical staleness
  const hasCritical = reports.some(r => r.status === 'stale-critical' || r.status === 'never-ingested');
  if (hasCritical) {
    console.log();
    console.log('WARNING: One or more countries have critical staleness or have never been ingested.');
    process.exit(1);
  }
}

main();
