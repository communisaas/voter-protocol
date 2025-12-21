#!/usr/bin/env npx tsx
/**
 * Shadow Atlas Observability CLI
 *
 * Simple command-line interface for querying metrics and health.
 * No external CLI frameworks needed.
 *
 * USAGE:
 *   npx tsx observability/cli.ts health           # Show health summary
 *   npx tsx observability/cli.ts errors           # Show recent errors
 *   npx tsx observability/cli.ts stats            # Show extraction stats
 *   npx tsx observability/cli.ts cleanup          # Clean old metrics
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { createMetricsStore } from './metrics.js';
import type { HealthSummary, AggregatedMetric } from './metrics.js';

// ============================================================================
// CLI Commands
// ============================================================================

interface Command {
  readonly name: string;
  readonly description: string;
  readonly run: (args: readonly string[]) => Promise<void>;
}

const commands: readonly Command[] = [
  {
    name: 'health',
    description: 'Show health summary for the last 24 hours',
    run: async () => {
      const store = createMetricsStore();
      try {
        const health = store.getHealthSummary(24);
        printHealth(health);
      } finally {
        store.close();
      }
    },
  },
  {
    name: 'errors',
    description: 'Show recent errors',
    run: async (args) => {
      const limit = parseInt(args[0] ?? '20', 10);
      const store = createMetricsStore();
      try {
        const errors = store.getRecentErrors(limit);
        printErrors(errors);
      } finally {
        store.close();
      }
    },
  },
  {
    name: 'stats',
    description: 'Show extraction statistics',
    run: async (args) => {
      const hours = parseInt(args[0] ?? '24', 10);
      const store = createMetricsStore();
      try {
        const success = store.getAggregated('extraction_success', hours);
        const failure = store.getAggregated('extraction_failure', hours);
        const duration = store.getAggregated('job_duration', hours);
        const boundaries = store.getAggregated('boundary_count', hours);

        printStats({ success, failure, duration, boundaries, hours });
      } finally {
        store.close();
      }
    },
  },
  {
    name: 'providers',
    description: 'Show provider health',
    run: async (args) => {
      const hours = parseInt(args[0] ?? '24', 10);
      const store = createMetricsStore();
      try {
        const latency = store.getAggregated('provider_latency', hours);
        const errors = store.getAggregated('provider_error', hours);
        const checks = store.getAggregated('health_check', hours);

        printProviders({ latency, errors, checks, hours });
      } finally {
        store.close();
      }
    },
  },
  {
    name: 'cleanup',
    description: 'Clean up old metrics (default: 30 days)',
    run: async () => {
      const store = createMetricsStore();
      try {
        const deleted = store.cleanup();
        console.log(`Cleaned up ${deleted} old metric entries`);
      } finally {
        store.close();
      }
    },
  },
  {
    name: 'summarize',
    description: 'Generate daily summary for today',
    run: async () => {
      const store = createMetricsStore();
      try {
        store.generateDailySummary();
        console.log('Daily summary generated');
      } finally {
        store.close();
      }
    },
  },
];

// ============================================================================
// Output Formatters
// ============================================================================

function printHealth(health: HealthSummary): void {
  const status = health.healthy ? '✅ HEALTHY' : '❌ UNHEALTHY';

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log(`║  Shadow Atlas Health Summary                    ${status}  ║`);
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(
    `║  Extraction Success Rate:  ${formatPercent(health.extractionSuccessRate).padEnd(32)}║`
  );
  console.log(
    `║  Validation Pass Rate:     ${formatPercent(health.validationPassRate).padEnd(32)}║`
  );
  console.log(
    `║  Avg Job Duration:         ${formatDuration(health.avgJobDurationMs).padEnd(32)}║`
  );
  console.log('╠═══════════════════════════════════════════════════════════╣');

  // Provider availability
  console.log('║  Provider Availability:                                   ║');
  for (const [provider, available] of Object.entries(health.providerAvailability)) {
    const icon = available ? '✓' : '✗';
    console.log(`║    ${icon} ${provider.padEnd(54)}║`);
  }

  // Issues
  if (health.issues.length > 0) {
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log('║  Issues:                                                  ║');
    for (const issue of health.issues) {
      console.log(`║    ⚠ ${issue.substring(0, 52).padEnd(52)}║`);
    }
  }

  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(
    `║  Last Check: ${health.lastCheckAt.toISOString().padEnd(44)}║`
  );
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
}

function printErrors(
  errors: Array<{
    type: string;
    labels: Record<string, string>;
    recordedAt: Date;
  }>
): void {
  if (errors.length === 0) {
    console.log('\n✅ No recent errors\n');
    return;
  }

  console.log(`\n❌ Recent Errors (${errors.length})\n`);
  console.log('─'.repeat(80));

  for (const error of errors) {
    const time = error.recordedAt.toISOString().replace('T', ' ').substring(0, 19);
    const labels = Object.entries(error.labels)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    console.log(`[${time}] ${error.type}`);
    console.log(`  ${labels}`);
  }
  console.log('─'.repeat(80) + '\n');
}

function printStats(data: {
  success: AggregatedMetric;
  failure: AggregatedMetric;
  duration: AggregatedMetric;
  boundaries: AggregatedMetric;
  hours: number;
}): void {
  const total = data.success.count + data.failure.count;
  const successRate = total > 0 ? data.success.count / total : 1;

  console.log(`\n📊 Extraction Statistics (last ${data.hours}h)\n`);
  console.log('─'.repeat(50));
  console.log(`  Successful Extractions:  ${data.success.count}`);
  console.log(`  Failed Extractions:      ${data.failure.count}`);
  console.log(`  Success Rate:            ${formatPercent(successRate)}`);
  console.log('─'.repeat(50));
  console.log(`  Avg Duration:            ${formatDuration(data.duration.avg)}`);
  console.log(`  Min Duration:            ${formatDuration(data.duration.min)}`);
  console.log(`  Max Duration:            ${formatDuration(data.duration.max)}`);
  console.log('─'.repeat(50));
  console.log(`  Total Boundaries:        ${data.boundaries.sum.toLocaleString()}`);
  console.log(`  Avg per Extraction:      ${Math.round(data.boundaries.avg).toLocaleString()}`);
  console.log('─'.repeat(50) + '\n');
}

function printProviders(data: {
  latency: AggregatedMetric;
  errors: AggregatedMetric;
  checks: AggregatedMetric;
  hours: number;
}): void {
  const availability =
    data.checks.count > 0 ? data.checks.sum / data.checks.count : 1;

  console.log(`\n🌐 Provider Health (last ${data.hours}h)\n`);
  console.log('─'.repeat(50));
  console.log(`  Health Checks:           ${data.checks.count}`);
  console.log(`  Availability:            ${formatPercent(availability)}`);
  console.log(`  Error Count:             ${data.errors.count}`);
  console.log('─'.repeat(50));
  console.log(`  Avg Latency:             ${formatDuration(data.latency.avg)}`);
  console.log(`  Min Latency:             ${formatDuration(data.latency.min)}`);
  console.log(`  Max Latency:             ${formatDuration(data.latency.max)}`);
  console.log('─'.repeat(50) + '\n');
}

// ============================================================================
// Helpers
// ============================================================================

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function printUsage(): void {
  console.log('\nShadow Atlas Observability CLI\n');
  console.log('Usage: npx tsx observability/cli.ts <command> [args]\n');
  console.log('Commands:');
  for (const cmd of commands) {
    console.log(`  ${cmd.name.padEnd(12)} ${cmd.description}`);
  }
  console.log('\nExamples:');
  console.log('  npx tsx observability/cli.ts health');
  console.log('  npx tsx observability/cli.ts errors 50');
  console.log('  npx tsx observability/cli.ts stats 48');
  console.log('');
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const commandName = args[0];

  if (!commandName || commandName === '--help' || commandName === '-h') {
    printUsage();
    process.exit(0);
  }

  const command = commands.find((c) => c.name === commandName);

  if (!command) {
    console.error(`Unknown command: ${commandName}`);
    printUsage();
    process.exit(1);
  }

  try {
    await command.run(args.slice(1));
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main().catch(console.error);
