/**
 * Freshness Check Tool - CLI Interface
 *
 * PURPOSE: Monitor data freshness and generate revalidation queue
 * USAGE: npm run atlas:check-freshness
 */

import { getRevalidationQueue, getFreshnessStats } from '../services/freshness-tracker.js';

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║       SHADOW ATLAS FRESHNESS CHECK                  ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const stats = await getFreshnessStats();

  console.log('═══ FRESHNESS STATISTICS ===\n');
  console.log(`Total Entries:         ${stats.total}`);
  console.log(
    `✅ Fresh (<90 days):    ${stats.fresh} (${((stats.fresh / stats.total) * 100).toFixed(1)}%)`
  );
  console.log(
    `⚠️  Aging (90-180):     ${stats.aging} (${((stats.aging / stats.total) * 100).toFixed(1)}%)`
  );
  console.log(
    `🔶 Stale (180-365):    ${stats.stale} (${((stats.stale / stats.total) * 100).toFixed(1)}%)`
  );
  console.log(
    `🚨 Critical (>365):    ${stats.critical} (${((stats.critical / stats.total) * 100).toFixed(1)}%)`
  );
  console.log(`\nNeeds Revalidation:    ${stats.needsRevalidation}\n`);

  const queue = await getRevalidationQueue();

  if (queue.length > 0) {
    console.log(`═══ REVALIDATION QUEUE (${queue.length} cities) ===\n`);

    for (const entry of queue.slice(0, 20)) {
      const age = entry.dataAge.toString();
      const statusIcon = {
        critical: '🚨',
        stale: '🔶',
        aging: '⚠️',
        fresh: '✅',
        unknown: '❓',
      }[entry.status];

      console.log(
        `${statusIcon} ${(entry.cityName || entry.fips).padEnd(25)} ` +
          `${entry.state?.padEnd(2) || '  '} ` +
          `${age.padStart(4)} days old ` +
          `TIER ${entry.tier}`
      );
    }

    if (queue.length > 20) {
      console.log(`\n... and ${queue.length - 20} more\n`);
    }

    // State-level breakdown
    console.log('\n═══ STATE BREAKDOWN ===\n');

    const stateEntries = Object.entries(stats.byState).sort(
      ([, a], [, b]) => b.critical + b.stale - (a.critical + a.stale)
    );

    for (const [state, stateCounts] of stateEntries.slice(0, 10)) {
      const total = stateCounts.fresh + stateCounts.aging + stateCounts.stale + stateCounts.critical;
      const needsAttention = stateCounts.stale + stateCounts.critical;
      const percentage = ((needsAttention / total) * 100).toFixed(0);

      if (needsAttention > 0) {
        console.log(
          `${state}: ${needsAttention}/${total} stale/critical (${percentage}%) - ` +
            `${stateCounts.critical} critical, ${stateCounts.stale} stale`
        );
      }
    }

    console.log();
  } else {
    console.log('✅ All data is fresh - no revalidation needed\n');
  }
}

main().catch((error: Error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
