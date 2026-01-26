#!/usr/bin/env npx tsx
/**
 * Diagnose Health Command
 *
 * Run system health checks for Shadow Atlas.
 *
 * USAGE:
 *   shadow-atlas diagnose health [options]
 *
 * OPTIONS:
 *   --component <name>  Check specific component
 *   --quick             Fast checks only (skip network)
 *
 * EXAMPLES:
 *   shadow-atlas diagnose health
 *   shadow-atlas diagnose health --quick
 *   shadow-atlas diagnose health --component registry
 *
 * @module cli/commands/diagnose/health
 */

import {
  runHealthCheck,
  type HealthReport,
} from '../../lib/diagnostics.js';

// ============================================================================
// Types
// ============================================================================

export interface HealthOptions {
  readonly component?: string;
  readonly quick?: boolean;
  readonly verbose?: boolean;
  readonly json?: boolean;
  readonly layers?: boolean;
  readonly sampleSize?: number;
}

export interface HealthResult {
  readonly success: boolean;
  readonly report?: HealthReport;
  readonly error?: string;
}

// ============================================================================
// Command Implementation
// ============================================================================

/**
 * Run the health command
 */
export async function runHealth(options: HealthOptions = {}): Promise<HealthResult> {
  const { component, quick = false, verbose = false, json = false, layers = false, sampleSize = 50 } = options;

  if (!json) {
    console.log('Running health checks...\n');
    if (quick) {
      console.log('Mode: Quick (skipping network checks)\n');
    }
    if (component) {
      console.log(`Component: ${component}\n`);
    }
    if (layers) {
      console.log(`Layer Accessibility: Enabled (sample size: ${sampleSize})\n`);
    }
  }

  try {
    const report = await runHealthCheck({ component, quick, layers, sampleSize });

    if (!json) {
      printReport(report, verbose);
    }

    if (json) {
      console.log(JSON.stringify({ success: true, report }, null, 2));
    }

    return { success: report.overall === 'healthy', report };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (!json) {
      console.error(`Health check failed: ${errorMessage}`);
    }

    if (json) {
      console.log(JSON.stringify({ success: false, error: errorMessage }, null, 2));
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Print health report to console
 */
function printReport(report: HealthReport, verbose: boolean): void {
  const overallIcons = {
    healthy: '[HEALTHY]',
    degraded: '[DEGRADED]',
    unhealthy: '[UNHEALTHY]',
  };
  const overallIcon = overallIcons[report.overall];

  const statusIcons = {
    pass: '[ok]',
    fail: '[FAIL]',
    warn: '[warn]',
    skip: '[skip]',
  };

  console.log('='.repeat(60));
  console.log(`  Shadow Atlas Health Report                  ${overallIcon}`);
  console.log('='.repeat(60));
  console.log('');

  // Checks
  console.log('Health Checks:');
  console.log('-'.repeat(60));

  for (const check of report.checks) {
    const icon = statusIcons[check.status];
    const duration = check.duration_ms > 0 ? ` (${check.duration_ms}ms)` : '';
    console.log(`  ${icon} ${check.name}${duration}`);
    console.log(`       ${check.message}`);

    if (verbose && check.details) {
      for (const [key, value] of Object.entries(check.details)) {
        console.log(`       ${key}: ${JSON.stringify(value)}`);
      }
    }
  }
  console.log('');

  // Metrics summary
  console.log('Metrics:');
  console.log('-'.repeat(60));

  const { registryIntegrity, quarantineQueue, snapshotCount } = report.metrics;

  console.log('  Registry Entries:');
  console.log(`    Known Portals:     ${registryIntegrity.knownPortals}`);
  console.log(`    Quarantined:       ${registryIntegrity.quarantined}`);
  console.log(`    At-Large:          ${registryIntegrity.atLarge}`);
  console.log(`    Sync Status:       ${registryIntegrity.syncStatus}`);
  console.log('');

  console.log('  Quarantine Queue:');
  console.log(`    Size:              ${quarantineQueue.size}`);
  if (quarantineQueue.oldestEntry) {
    console.log(`    Oldest Entry:      ${quarantineQueue.oldestEntry}`);
  }
  if (Object.keys(quarantineQueue.byPattern).length > 0 && verbose) {
    console.log('    By Pattern:');
    for (const [pattern, count] of Object.entries(quarantineQueue.byPattern)) {
      console.log(`      ${pattern}: ${count}`);
    }
  }
  console.log('');

  console.log('  Snapshots:');
  console.log(`    Available:         ${snapshotCount}`);
  console.log('');

  if (report.metrics.cacheStatus.lastRefresh) {
    console.log('  Cache:');
    console.log(`    Last Refresh:      ${report.metrics.cacheStatus.lastRefresh}`);
    if (report.metrics.cacheStatus.tigerCacheAge !== undefined) {
      console.log(`    TIGER Cache Age:   ${report.metrics.cacheStatus.tigerCacheAge} hours`);
    }
    console.log('');
  }

  if (report.metrics.layerAccessibility) {
    console.log('  Layer Accessibility:');
    console.log(`    Sample Size:       ${report.metrics.layerAccessibility.sampleSize}`);
    console.log(`    Accessible:        ${report.metrics.layerAccessibility.accessibleCount} (${report.metrics.layerAccessibility.accessibilityRate}%)`);
    console.log(`    Inaccessible:      ${report.metrics.layerAccessibility.inaccessibleCount}`);
    console.log(`    Timeout:           ${report.metrics.layerAccessibility.timeoutCount}`);
    console.log(`    Error:             ${report.metrics.layerAccessibility.errorCount}`);
    console.log(`    Data Available:    ${report.metrics.layerAccessibility.dataAvailabilityRate}%`);
    console.log('');
  }

  // Summary
  console.log('='.repeat(60));
  console.log(`  Timestamp: ${report.timestamp}`);
  console.log(`  Overall: ${report.overall.toUpperCase()}`);
  console.log('='.repeat(60));

  // Recommendations
  const failedChecks = report.checks.filter((c) => c.status === 'fail');
  const warnChecks = report.checks.filter((c) => c.status === 'warn');

  if (failedChecks.length > 0 || warnChecks.length > 0) {
    console.log('');
    console.log('Recommendations:');

    for (const check of failedChecks) {
      console.log(`  - Fix: ${check.name} - ${check.message}`);
    }

    for (const check of warnChecks) {
      console.log(`  - Review: ${check.name} - ${check.message}`);
    }
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function parseArgs(args: readonly string[]): HealthOptions {
  const options: HealthOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--component':
        (options as { component: string }).component = args[++i];
        break;

      case '--quick':
        (options as { quick: boolean }).quick = true;
        break;

      case '--verbose':
      case '-v':
        (options as { verbose: boolean }).verbose = true;
        break;

      case '--json':
        (options as { json: boolean }).json = true;
        break;

      case '--layers':
        (options as { layers: boolean }).layers = true;
        break;

      case '--sample-size':
        (options as { sampleSize: number }).sampleSize = parseInt(args[++i], 10);
        break;

      case '--help':
      case '-h':
        printHelp();
        process.exit(0);

      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
shadow-atlas diagnose health - Run system health checks

USAGE:
  shadow-atlas diagnose health [options]

OPTIONS:
  --component <name>    Check specific component only
  --quick               Fast checks only (skip network/external)
  --verbose, -v         Show detailed check results
  --json                Output results as JSON
  --layers              Enable layer accessibility checks
  --sample-size <n>     Number of layers to sample (default: 50, max: 500)
  --help, -h            Show this help message

COMPONENTS:
  registry              Registry integrity and counts
  sync                  NDJSON/TypeScript synchronization
  cache                 Cache freshness (TIGER data)
  quarantine            Quarantine queue status
  snapshots             Snapshot availability
  connectivity          External service connectivity
  layers                Layer accessibility (external endpoint checks)

HEALTH STATUS:
  healthy               All checks pass
  degraded              Some warnings, but operational
  unhealthy             Critical failures detected

EXAMPLES:
  # Full health check
  shadow-atlas diagnose health

  # Quick check (no network)
  shadow-atlas diagnose health --quick

  # Check specific component
  shadow-atlas diagnose health --component registry

  # Check layer accessibility (50 samples)
  shadow-atlas diagnose health --layers

  # Check layer accessibility with custom sample size
  shadow-atlas diagnose health --layers --sample-size 100

  # JSON output for monitoring
  shadow-atlas diagnose health --json
`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  runHealth(options)
    .then((result) => {
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Health check failed:', error);
      process.exit(1);
    });
}
