#!/usr/bin/env tsx
/**
 * Example: Full US Extraction Using ShadowAtlasService
 *
 * Demonstrates the complete extraction pipeline:
 * 1. Extract legislative boundaries from all configured states
 * 2. Validate extractions against authority registries
 * 3. Commit validated boundaries to Merkle tree
 * 4. Publish Merkle tree to IPFS
 *
 * USAGE:
 * ```bash
 * # Extract all states
 * tsx examples/full-extraction.ts
 *
 * # Extract specific states
 * tsx examples/full-extraction.ts --states WI,MI,TX
 *
 * # Resume from previous job
 * tsx examples/full-extraction.ts --resume <job-id>
 * ```
 *
 * TYPE SAFETY: All operations are strongly typed end-to-end.
 */

import { createShadowAtlasService } from '../core/factory.js';
import type { ExtractionScope } from '../core/types.js';

/**
 * Parse command line arguments
 */
interface Args {
  readonly scope: ExtractionScope;
  readonly resumeJobId?: string;
  readonly minPassRate: number;
  readonly continueOnError: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);

  // Parse --states flag
  const statesIndex = args.indexOf('--states');
  const states = statesIndex !== -1 && args[statesIndex + 1]
    ? args[statesIndex + 1].split(',').map(s => s.trim())
    : undefined;

  // Parse --resume flag
  const resumeIndex = args.indexOf('--resume');
  const resumeJobId = resumeIndex !== -1 && args[resumeIndex + 1]
    ? args[resumeIndex + 1]
    : undefined;

  // Parse --min-pass-rate flag
  const minPassRateIndex = args.indexOf('--min-pass-rate');
  const minPassRate = minPassRateIndex !== -1 && args[minPassRateIndex + 1]
    ? parseFloat(args[minPassRateIndex + 1])
    : 0.9;

  // Parse --continue-on-error flag
  const continueOnError = args.includes('--continue-on-error');

  // Determine scope
  const scope: ExtractionScope = states
    ? { type: 'state', states }
    : { type: 'country', country: 'US' };

  return {
    scope,
    resumeJobId,
    minPassRate,
    continueOnError,
  };
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Main extraction function
 */
async function main(): Promise<void> {
  const args = parseArgs();

  console.log('=== Shadow Atlas Full Extraction ===\n');

  // Create service with production configuration
  const atlas = createShadowAtlasService({
    extraction: {
      concurrency: 5,
      retryAttempts: 3,
      retryDelayMs: 2000,
      timeoutMs: 30_000,
    },
    validation: {
      minPassRate: args.minPassRate,
      crossValidate: true,
      storeResults: true,
    },
  });

  // Resume or start new extraction
  if (args.resumeJobId) {
    console.log(`Resuming extraction from job ${args.resumeJobId}...\n`);
    const result = await atlas.resumeExtraction(args.resumeJobId);
    printResults(result);
    return;
  }

  // Start new extraction
  console.log(`Starting extraction...`);
  console.log(`Scope: ${JSON.stringify(args.scope)}`);
  console.log(`Min pass rate: ${(args.minPassRate * 100).toFixed(0)}%`);
  console.log(`Continue on error: ${args.continueOnError}\n`);

  const result = await atlas.extract(args.scope, {
    minPassRate: args.minPassRate,
    continueOnError: args.continueOnError,
    onProgress: (progress) => {
      const pct = ((progress.completed / progress.total) * 100).toFixed(0);
      process.stdout.write(`\rProgress: ${progress.completed}/${progress.total} (${pct}%) - ${progress.currentItem}`);
    },
  });

  console.log('\n');
  printResults(result);
}

/**
 * Print extraction results
 */
function printResults(result: any): void {
  console.log('\n=== Extraction Complete ===\n');
  console.log(`Job ID: ${result.jobId}`);
  console.log(`Status: ${result.status}`);
  console.log(`Duration: ${formatDuration(result.duration)}\n`);

  console.log('--- Extraction Summary ---');
  console.log(`Total boundaries: ${result.extraction.totalBoundaries}`);
  console.log(`Successful: ${result.extraction.successfulExtractions}`);
  console.log(`Failed: ${result.extraction.failedExtractions.length}`);

  if (result.extraction.failedExtractions.length > 0) {
    console.log('\nFailed extractions:');
    for (const failure of result.extraction.failedExtractions.slice(0, 5)) {
      console.log(`  - ${failure.state} (${failure.layer}): ${failure.error}`);
    }
    if (result.extraction.failedExtractions.length > 5) {
      console.log(`  ... and ${result.extraction.failedExtractions.length - 5} more`);
    }
  }

  console.log('\n--- Validation Summary ---');
  console.log(`Passed: ${result.validation.passed}`);
  console.log(`Warned: ${result.validation.warned}`);
  console.log(`Failed: ${result.validation.failed}`);
  console.log(`Pass rate: ${(result.validation.passRate * 100).toFixed(1)}%`);

  if (result.commitment) {
    console.log('\n--- Merkle Commitment ---');
    console.log(`Snapshot ID: ${result.commitment.snapshotId}`);
    console.log(`Merkle root: ${result.commitment.merkleRoot}`);
    console.log(`Included boundaries: ${result.commitment.includedBoundaries}`);
    console.log(`Excluded boundaries: ${result.commitment.excludedBoundaries}`);

    if (result.commitment.ipfsCID) {
      console.log(`IPFS CID: ${result.commitment.ipfsCID}`);
      console.log(`IPFS URL: https://ipfs.io/ipfs/${result.commitment.ipfsCID}`);
    }
  }

  console.log('\n=== End of Report ===\n');
}

/**
 * Run with error handling
 */
main().catch((error) => {
  console.error('\n❌ Extraction failed:', error);
  process.exit(1);
});
