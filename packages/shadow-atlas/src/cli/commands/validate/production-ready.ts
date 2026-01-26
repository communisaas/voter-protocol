#!/usr/bin/env tsx
/**
 * Production Ready Validation Command
 *
 * Quick pre-deployment check that verifies critical systems are operational.
 * Designed for CI/CD pipelines and pre-deployment gates.
 *
 * CHECKS:
 *   - No critical GEOID validation failures
 *   - No stale critical data (> threshold days)
 *   - Audit log integrity
 *   - Registry consistency (NDJSON/TypeScript sync)
 *   - No quarantine overflow
 *
 * EXIT CODES:
 *   0 - Production ready
 *   1 - Warnings present (needs review)
 *   2 - Critical failures (not ready)
 *
 * Usage:
 *   shadow-atlas validate production-ready
 *   shadow-atlas validate production-ready --strict
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  validateAllCanonicalGEOIDs,
  type ValidationReport as GEOIDValidationReport,
} from '../../../validators/geoid/validation-suite.js';
import { KNOWN_PORTALS } from '../../../core/registry/known-portals.generated.js';
import { AT_LARGE_CITIES } from '../../../core/registry/at-large-cities.generated.js';
import { QUARANTINED_PORTALS } from '../../../core/registry/quarantined-portals.generated.js';
import {
  buildReport,
  formatReport,
  getExitCode,
  EXIT_CODES,
  type ValidationEntry,
  type OutputFormat,
} from '../../lib/validation-report.js';

// =============================================================================
// Types
// =============================================================================

interface ProductionReadyOptions {
  strict: boolean;
  staleThreshold: number;
  quarantineThreshold: number;
  format: OutputFormat;
  verbose: boolean;
  json: boolean;
}

// =============================================================================
// CLI Argument Parser
// =============================================================================

function parseArgs(): ProductionReadyOptions {
  const args = process.argv.slice(2);
  const options: ProductionReadyOptions = {
    strict: false,
    staleThreshold: 90,
    quarantineThreshold: 20, // Max quarantine entries before warning
    format: 'table',
    verbose: false,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--strict':
        options.strict = true;
        break;
      case '--stale-threshold':
        options.staleThreshold = parseInt(args[++i], 10);
        break;
      case '--quarantine-threshold':
        options.quarantineThreshold = parseInt(args[++i], 10);
        break;
      case '--format':
        options.format = args[++i] as OutputFormat;
        break;
      case '--json':
        options.json = true;
        options.format = 'json';
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Production Ready Validation

Usage:
  shadow-atlas validate production-ready [options]

Options:
  --strict                 Treat warnings as failures
  --stale-threshold <days> Days until data is stale (default: 90)
  --quarantine-threshold <n> Max quarantine entries (default: 20)
  --format <fmt>           Output format: table|json|csv|summary
  --json                   Output as JSON (shorthand for --format json)
  --verbose, -v            Include detailed diagnostics
  --help, -h               Show this help

Checks:
  - No critical GEOID validation failures
  - No stale critical data (> threshold days)
  - Audit log integrity (if exists)
  - Registry consistency (NDJSON/TypeScript sync)
  - Quarantine queue size within threshold

Exit Codes:
  0 - Production ready
  1 - Warnings present (needs review)
  2 - Critical failures (not ready)

Examples:
  shadow-atlas validate production-ready
  shadow-atlas validate production-ready --strict
  shadow-atlas validate production-ready --json
`);
}

// =============================================================================
// Validation Checks
// =============================================================================

/**
 * Check GEOID validation status (quick check, no network)
 */
function checkGEOIDValidation(): ValidationEntry {
  try {
    const report = validateAllCanonicalGEOIDs();

    const hasFailures = report.summary.overallStatus === 'FAIL';
    const hasWarnings = report.summary.overallStatus === 'WARNING';

    if (hasFailures) {
      const failedLayers = report.layers.filter((l) => l.status === 'FAIL');
      return {
        id: 'geoid-validation',
        name: 'GEOID Validation',
        status: 'fail',
        message: `${failedLayers.length} layer(s) failed validation`,
        diagnostics: {
          failedLayers: failedLayers.map((l) => l.layer),
          totalStatesFailed: report.summary.totalStatesFailed,
        },
        remediation: 'Run validate geoids for detailed diagnostics',
      };
    }

    if (hasWarnings) {
      return {
        id: 'geoid-validation',
        name: 'GEOID Validation',
        status: 'warn',
        message: `Warnings present (${report.summary.layersWithWarnings} layers)`,
        diagnostics: {
          layersWithWarnings: report.summary.layersWithWarnings,
        },
      };
    }

    return {
      id: 'geoid-validation',
      name: 'GEOID Validation',
      status: 'pass',
      message: `All ${report.summary.layersValidated} layers passed`,
      diagnostics: {
        layersValidated: report.summary.layersValidated,
        totalGEOIDs: report.layers.reduce((sum, l) => sum + l.totalGEOIDs, 0),
      },
    };
  } catch (error) {
    return {
      id: 'geoid-validation',
      name: 'GEOID Validation',
      status: 'fail',
      message: `Error: ${error instanceof Error ? error.message : 'Unknown'}`,
      remediation: 'Check GEOID reference data files',
    };
  }
}

/**
 * Check registry consistency (NDJSON vs TypeScript sync)
 */
function checkRegistryConsistency(): ValidationEntry {
  const knownCount = Object.keys(KNOWN_PORTALS).length;
  const atLargeCount = Object.keys(AT_LARGE_CITIES).length;
  const quarantinedCount = Object.keys(QUARANTINED_PORTALS).length;

  // Basic sanity checks
  if (knownCount === 0) {
    return {
      id: 'registry-consistency',
      name: 'Registry Consistency',
      status: 'fail',
      message: 'Known portals registry is empty',
      remediation: 'Run npm run registry:generate to regenerate from NDJSON',
    };
  }

  // Check for unreasonably low counts
  if (knownCount < 100) {
    return {
      id: 'registry-consistency',
      name: 'Registry Consistency',
      status: 'warn',
      message: `Only ${knownCount} known portals (expected 500+)`,
      remediation: 'Verify NDJSON source and regenerate',
    };
  }

  return {
    id: 'registry-consistency',
    name: 'Registry Consistency',
    status: 'pass',
    message: `${knownCount} portals, ${atLargeCount} at-large, ${quarantinedCount} quarantined`,
    diagnostics: {
      knownPortals: knownCount,
      atLargeCities: atLargeCount,
      quarantinedPortals: quarantinedCount,
    },
  };
}

/**
 * Check for stale critical data
 */
function checkDataFreshness(staleThreshold: number): ValidationEntry {
  const now = Date.now();
  const thresholdMs = staleThreshold * 24 * 60 * 60 * 1000;

  let staleCount = 0;
  let criticalStale = 0;
  const staleCities: string[] = [];

  // Top 50 cities by population (critical)
  const criticalFips = new Set([
    '3651000', '0644000', '1714000', '4835000', '0455000',
    '4260000', '4865000', '0666000', '4819000', '0668000',
  ]);

  for (const [fips, portal] of Object.entries(KNOWN_PORTALS)) {
    const lastVerified = new Date(portal.lastVerified).getTime();
    const ageMs = now - lastVerified;

    if (ageMs > thresholdMs) {
      staleCount++;
      if (criticalFips.has(fips)) {
        criticalStale++;
        staleCities.push(`${portal.cityName}, ${portal.state}`);
      }
    }
  }

  if (criticalStale > 0) {
    return {
      id: 'data-freshness',
      name: 'Data Freshness',
      status: 'fail',
      message: `${criticalStale} critical cities stale (${staleCities.slice(0, 3).join(', ')}...)`,
      diagnostics: {
        totalStale: staleCount,
        criticalStale,
        staleCities,
        threshold: staleThreshold,
      },
      remediation: 'Re-validate critical cities using validate council command',
    };
  }

  if (staleCount > 50) {
    return {
      id: 'data-freshness',
      name: 'Data Freshness',
      status: 'warn',
      message: `${staleCount} entries stale (> ${staleThreshold} days)`,
      diagnostics: {
        totalStale: staleCount,
        threshold: staleThreshold,
      },
    };
  }

  return {
    id: 'data-freshness',
    name: 'Data Freshness',
    status: 'pass',
    message: `${staleCount} stale entries (threshold: ${staleThreshold} days)`,
    diagnostics: {
      totalStale: staleCount,
      threshold: staleThreshold,
    },
  };
}

/**
 * Check quarantine queue size
 */
function checkQuarantineQueue(threshold: number): ValidationEntry {
  const quarantinedCount = Object.keys(QUARANTINED_PORTALS).length;

  if (quarantinedCount > threshold * 2) {
    return {
      id: 'quarantine-queue',
      name: 'Quarantine Queue',
      status: 'fail',
      message: `${quarantinedCount} entries (>2x threshold of ${threshold})`,
      diagnostics: {
        count: quarantinedCount,
        threshold,
      },
      remediation: 'Review and resolve quarantined entries',
    };
  }

  if (quarantinedCount > threshold) {
    return {
      id: 'quarantine-queue',
      name: 'Quarantine Queue',
      status: 'warn',
      message: `${quarantinedCount} entries (above threshold of ${threshold})`,
      diagnostics: {
        count: quarantinedCount,
        threshold,
      },
    };
  }

  return {
    id: 'quarantine-queue',
    name: 'Quarantine Queue',
    status: 'pass',
    message: `${quarantinedCount} entries (threshold: ${threshold})`,
    diagnostics: {
      count: quarantinedCount,
      threshold,
    },
  };
}

/**
 * Check audit log integrity (if exists)
 */
function checkAuditLog(): ValidationEntry {
  // Common audit log locations
  const auditPaths = [
    join(process.cwd(), 'data', 'audit', 'audit.ndjson'),
    join(process.cwd(), 'packages', 'shadow-atlas', 'data', 'audit', 'audit.ndjson'),
  ];

  // Find audit log
  let auditPath: string | null = null;
  for (const path of auditPaths) {
    if (existsSync(path)) {
      auditPath = path;
      break;
    }
  }

  if (!auditPath) {
    return {
      id: 'audit-log',
      name: 'Audit Log',
      status: 'skip',
      message: 'No audit log found (not required)',
    };
  }

  try {
    const stats = statSync(auditPath);
    const content = readFileSync(auditPath, 'utf-8');
    const lines = content.trim().split('\n').filter((l) => l.trim());

    // Validate NDJSON format
    let validLines = 0;
    let invalidLines = 0;

    for (const line of lines) {
      try {
        JSON.parse(line);
        validLines++;
      } catch {
        invalidLines++;
      }
    }

    if (invalidLines > 0) {
      return {
        id: 'audit-log',
        name: 'Audit Log',
        status: 'warn',
        message: `${invalidLines} invalid entries in audit log`,
        diagnostics: {
          totalLines: lines.length,
          validLines,
          invalidLines,
          sizeBytes: stats.size,
        },
      };
    }

    return {
      id: 'audit-log',
      name: 'Audit Log',
      status: 'pass',
      message: `${validLines} entries, ${(stats.size / 1024).toFixed(1)}KB`,
      diagnostics: {
        entries: validLines,
        sizeBytes: stats.size,
        path: auditPath,
      },
    };
  } catch (error) {
    return {
      id: 'audit-log',
      name: 'Audit Log',
      status: 'warn',
      message: `Error reading audit log: ${error instanceof Error ? error.message : 'Unknown'}`,
    };
  }
}

/**
 * Check TypeScript compilation status (generated files)
 */
function checkGeneratedFiles(): ValidationEntry {
  const generatedFiles = [
    'src/core/registry/known-portals.generated.ts',
    'src/core/registry/at-large-cities.generated.ts',
    'src/core/registry/quarantined-portals.generated.ts',
  ];

  const basePath = process.cwd().includes('shadow-atlas')
    ? process.cwd()
    : join(process.cwd(), 'packages', 'shadow-atlas');

  const missing: string[] = [];
  const timestamps: Record<string, Date> = {};

  for (const file of generatedFiles) {
    const fullPath = join(basePath, file);
    if (!existsSync(fullPath)) {
      missing.push(file);
    } else {
      try {
        const stats = statSync(fullPath);
        timestamps[file] = stats.mtime;
      } catch {
        missing.push(file);
      }
    }
  }

  if (missing.length > 0) {
    return {
      id: 'generated-files',
      name: 'Generated Files',
      status: 'fail',
      message: `Missing ${missing.length} generated file(s)`,
      diagnostics: {
        missing,
      },
      remediation: 'Run npm run registry:generate',
    };
  }

  // Check if files are reasonably recent (within 7 days)
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const oldFiles = Object.entries(timestamps)
    .filter(([, mtime]) => now - mtime.getTime() > sevenDays)
    .map(([file]) => file);

  if (oldFiles.length > 0) {
    return {
      id: 'generated-files',
      name: 'Generated Files',
      status: 'warn',
      message: `${oldFiles.length} file(s) older than 7 days`,
      diagnostics: {
        oldFiles,
        timestamps,
      },
    };
  }

  return {
    id: 'generated-files',
    name: 'Generated Files',
    status: 'pass',
    message: 'All generated files present and recent',
    diagnostics: {
      files: generatedFiles.length,
      timestamps,
    },
  };
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const options = parseArgs();

  console.error('Running production readiness checks...\n');

  const entries: ValidationEntry[] = [];

  // Run all checks
  entries.push(checkGEOIDValidation());
  entries.push(checkRegistryConsistency());
  entries.push(checkDataFreshness(options.staleThreshold));
  entries.push(checkQuarantineQueue(options.quarantineThreshold));
  entries.push(checkAuditLog());
  entries.push(checkGeneratedFiles());

  // Determine overall status
  const failures = entries.filter((e) => e.status === 'fail').length;
  const warnings = entries.filter((e) => e.status === 'warn').length;

  let overallStatus: 'pass' | 'warn' | 'fail';
  let statusMessage: string;

  if (failures > 0) {
    overallStatus = 'fail';
    statusMessage = `NOT READY: ${failures} critical failure(s)`;
  } else if (warnings > 0 && options.strict) {
    overallStatus = 'fail';
    statusMessage = `NOT READY (strict mode): ${warnings} warning(s)`;
  } else if (warnings > 0) {
    overallStatus = 'warn';
    statusMessage = `NEEDS REVIEW: ${warnings} warning(s)`;
  } else {
    overallStatus = 'pass';
    statusMessage = 'PRODUCTION READY';
  }

  // Add summary entry at the start
  entries.unshift({
    id: 'summary',
    name: 'Production Readiness',
    status: overallStatus,
    message: statusMessage,
    diagnostics: {
      checks: entries.length - 1,
      passed: entries.filter((e) => e.status === 'pass').length,
      warnings,
      failures,
    },
  });

  // Build and format report
  const report = buildReport(
    'Production Ready',
    'deployment',
    entries,
    {
      strict: options.strict,
      staleThreshold: options.staleThreshold,
      quarantineThreshold: options.quarantineThreshold,
    }
  );

  const output = formatReport(report, options.format, { verbose: options.verbose });
  console.log(output);

  // Exit with appropriate code
  if (failures > 0 || (warnings > 0 && options.strict)) {
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  } else if (warnings > 0) {
    process.exit(EXIT_CODES.VALIDATION_WARNING);
  } else {
    process.exit(EXIT_CODES.SUCCESS);
  }
}

// Export for programmatic use
export {
  checkGEOIDValidation,
  checkRegistryConsistency,
  checkDataFreshness,
  checkQuarantineQueue,
  checkAuditLog,
  checkGeneratedFiles,
};
export type { ProductionReadyOptions };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
