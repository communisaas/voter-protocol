#!/usr/bin/env tsx
/**
 * Query Retry Candidates - CLI Tool
 *
 * PURPOSE: Inspect retry candidates and statistics
 * USAGE:
 *   npm run atlas:retry-stats              # Show summary statistics
 *   npm run atlas:retry-candidates         # List retry-eligible cities
 *   npm run atlas:retry-blocker <code>     # Show candidates for specific blocker
 *
 * EXAMPLES:
 *   npm run atlas:retry-stats
 *   npm run atlas:retry-candidates
 *   npm run atlas:retry-blocker portal-404
 *   npm run atlas:retry-blocker no-council-layer
 */

import {
  getRetryCandidates,
  getRetryStats,
  getRetryCandidatesByBlocker,
} from '../services/retry-orchestrator.js';

/**
 * Print retry statistics summary
 */
async function printStats(baseDir: string): Promise<void> {
  const stats = await getRetryStats(baseDir);

  console.log('\n=== Shadow Atlas Retry Statistics ===\n');
  console.log(`Total Blocked:    ${stats.totalBlocked}`);
  console.log(`Retry Eligible:   ${stats.retryEligible}`);
  console.log(`Never Retry:      ${stats.neverRetry}`);
  console.log('\n=== By Blocker Code ===\n');

  // Sort by count (descending)
  const sorted = Object.entries(stats.byBlocker).sort((a, b) => b[1].count - a[1].count);

  for (const [code, { count, retryPolicy }] of sorted) {
    console.log(`${code.padEnd(30)} ${String(count).padStart(5)} cities  (${retryPolicy})`);
  }

  console.log('');
}

/**
 * Print retry candidates list
 */
async function printCandidates(baseDir: string, limit: number = 20): Promise<void> {
  const candidates = await getRetryCandidates(baseDir);

  console.log(`\n=== Retry Candidates (${candidates.length}) ===\n`);

  if (candidates.length === 0) {
    console.log('No cities eligible for retry at this time.');
    console.log('');
    return;
  }

  for (const candidate of candidates.slice(0, limit)) {
    const cityDisplay = candidate.cityName || candidate.fips;
    const stateDisplay = candidate.state?.padEnd(2) || '  ';
    const lastAttemptDate = new Date(candidate.lastAttempt).toLocaleDateString();
    const nextRetryDate = new Date(candidate.nextRetryAfter).toLocaleDateString();

    console.log(
      `${cityDisplay.padEnd(30)} ${stateDisplay} ` +
        `${candidate.blockerCode.padEnd(25)} ` +
        `attempt ${candidate.attemptCount} ` +
        `(${candidate.retryPolicy})` +
        `\n  Last: ${lastAttemptDate}, Next: ${nextRetryDate}, Pop: ${candidate.priority.toLocaleString()}\n`
    );
  }

  if (candidates.length > limit) {
    console.log(`... and ${candidates.length - limit} more`);
  }

  console.log('');
}

/**
 * Print retry candidates for specific blocker code
 */
async function printByBlocker(blockerCode: string, baseDir: string): Promise<void> {
  if (!blockerCode) {
    console.error('Error: Blocker code required');
    console.log('Usage: npm run atlas:retry-blocker <code>');
    console.log('');
    console.log('Examples:');
    console.log('  npm run atlas:retry-blocker portal-404');
    console.log('  npm run atlas:retry-blocker no-council-layer');
    console.log('');
    return;
  }

  const candidates = await getRetryCandidatesByBlocker(blockerCode, baseDir);

  console.log(`\n=== Retry Candidates for '${blockerCode}' (${candidates.length}) ===\n`);

  if (candidates.length === 0) {
    console.log(`No cities with blocker '${blockerCode}' are eligible for retry.`);
    console.log('');
    return;
  }

  for (const candidate of candidates) {
    const cityDisplay = candidate.cityName || candidate.fips;
    const stateDisplay = candidate.state?.padEnd(2) || '  ';
    const lastAttemptDate = new Date(candidate.lastAttempt).toLocaleString();
    const nextRetryDate = new Date(candidate.nextRetryAfter).toLocaleString();

    console.log(
      `${cityDisplay.padEnd(30)} ${stateDisplay} ` +
        `attempt ${candidate.attemptCount} ` +
        `pop ${candidate.priority.toLocaleString().padStart(10)}`
    );
    console.log(`  Last attempt: ${lastAttemptDate}`);
    console.log(`  Next retry:   ${nextRetryDate}\n`);
  }

  console.log('');
}

/**
 * Print usage help
 */
function printHelp(): void {
  console.log('\n=== Shadow Atlas Retry Query Tool ===\n');
  console.log('Usage:');
  console.log('  npm run atlas:retry-stats              # Show summary statistics');
  console.log('  npm run atlas:retry-candidates         # List retry-eligible cities');
  console.log('  npm run atlas:retry-blocker <code>     # Show candidates for specific blocker');
  console.log('');
  console.log('Examples:');
  console.log('  npm run atlas:retry-stats');
  console.log('  npm run atlas:retry-candidates');
  console.log('  npm run atlas:retry-blocker portal-404');
  console.log('  npm run atlas:retry-blocker no-council-layer');
  console.log('');
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const command = process.argv[2] || 'stats';
  const baseDir = process.env.DISCOVERY_ATTEMPTS_DIR || './discovery-attempts';

  switch (command) {
    case 'stats':
      await printStats(baseDir);
      break;
    case 'candidates':
      await printCandidates(baseDir);
      break;
    case 'blocker':
      await printByBlocker(process.argv[3], baseDir);
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
