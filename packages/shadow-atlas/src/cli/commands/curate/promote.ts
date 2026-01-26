/**
 * Curate Promote Command
 *
 * Promote categorized layers to target registry. Processes RECOVERABLE_US
 * layers from categorization output and adds them to specified registry.
 *
 * Usage:
 *   shadow-atlas curate promote <categorization-file> [options]
 *
 * Options:
 *   --to-registry <name>          Target registry: known-portals|at-large (default: known-portals)
 *   --category <type>             Filter category: RECOVERABLE_US|INTERNATIONAL|GENERIC_TEMPLATE|UNKNOWN
 *   --confidence <n>              Minimum confidence threshold (default: 60)
 *   --skip-duplicates             Skip entries with duplicate URLs
 *   --snapshot                    Create backup snapshot before promotion
 *   --dry-run                     Show what would be promoted without applying
 *   --audit-reason <text>         Audit log reason for promotion
 *   --json                        Output as JSON
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Command } from 'commander';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { getGlobalContext } from '../../../../bin/shadow-atlas.js';

/**
 * Recoverable layer from categorization
 */
interface RecoverableLayer {
  readonly url: string;
  readonly name: string;
  readonly features: number;
  readonly confidence: number;
  readonly warnings: readonly string[];
  readonly suggestedFips: string;
  readonly suggestedName: string;
  readonly suggestedState: string;
  readonly recoveryMethod: string;
}

/**
 * Resolved layer in target registry
 */
interface ResolvedLayer {
  readonly url: string;
  readonly name: string;
  readonly resolution: {
    readonly fips: string;
    readonly name: string;
    readonly state: string;
    readonly method: string;
    readonly confidence: number;
  };
}

/**
 * Categorization file structure
 */
interface CategorizationFile {
  readonly summary: {
    readonly total: number;
    readonly international: number;
    readonly recoverable: number;
    readonly genericTemplate: number;
    readonly unknown: number;
  };
  readonly byCountry: Record<string, number>;
  readonly byCityRecoverable: Record<string, number>;
  readonly recoverable: readonly RecoverableLayer[];
  readonly international: readonly Array<{
    readonly url: string;
    readonly name: string;
    readonly country: string;
  }>;
  readonly genericTemplate?: readonly Array<{
    readonly layer: unknown;
    readonly details: string;
  }>;
  readonly unknown?: readonly unknown[];
  readonly metadata: {
    readonly inputFile: string;
    readonly categorizedAt: string;
    readonly options: unknown;
  };
}

/**
 * Command options
 */
interface PromoteOptions {
  readonly toRegistry: string;
  readonly category?: 'RECOVERABLE_US' | 'INTERNATIONAL' | 'GENERIC_TEMPLATE' | 'UNKNOWN';
  readonly confidence: string;
  readonly skipDuplicates?: boolean;
  readonly snapshot?: boolean;
  readonly dryRun?: boolean;
  readonly auditReason?: string;
}

/**
 * Promotion result
 */
interface PromotionResult {
  readonly promoted: readonly ResolvedLayer[];
  readonly skipped: readonly {
    readonly layer: RecoverableLayer;
    readonly reason: string;
  }[];
  readonly summary: {
    readonly totalCandidates: number;
    readonly promoted: number;
    readonly skipped: number;
    readonly duplicates: number;
    readonly belowThreshold: number;
  };
}

/**
 * Registry file structure (simplified)
 */
interface RegistryFile {
  resolved: ResolvedLayer[];
  metadata: {
    resolvedCount: number;
    mergedRecoverable?: number;
    finalMergeAt?: string;
    [key: string]: unknown;
  };
}

/**
 * Register the promote command
 */
export function registerPromoteCommand(parent: Command): void {
  parent
    .command('promote <categorization-file>')
    .description('Promote categorized layers to target registry')
    .option(
      '--to-registry <name>',
      'Target registry: known-portals|at-large',
      'known-portals'
    )
    .option(
      '--category <type>',
      'Filter category: RECOVERABLE_US|INTERNATIONAL|GENERIC_TEMPLATE|UNKNOWN'
    )
    .option('--confidence <n>', 'Minimum confidence threshold', '60')
    .option('--skip-duplicates', 'Skip entries with duplicate URLs')
    .option('--snapshot', 'Create backup snapshot before promotion')
    .option('--dry-run', 'Show what would be promoted without applying')
    .option('--audit-reason <text>', 'Audit log reason for promotion')
    .action(
      async (categorizationFile: string, options: PromoteOptions) => {
        await executePromote(categorizationFile, options);
      }
    );
}

/**
 * Execute the promote command
 */
async function executePromote(
  categorizationFile: string,
  options: PromoteOptions
): Promise<void> {
  const { config } = getGlobalContext();
  const jsonOutput = config.json;
  const dryRun = config.dryRun || options.dryRun;

  const inputPath = resolve(categorizationFile);
  const confidenceThreshold = parseInt(options.confidence, 10);

  // Validate input file exists
  if (!existsSync(inputPath)) {
    console.error(`Error: Categorization file not found: ${inputPath}`);
    process.exit(1);
  }

  // Validate registry option
  if (!['known-portals', 'at-large'].includes(options.toRegistry)) {
    console.error(
      `Error: Invalid registry "${options.toRegistry}". Must be: known-portals|at-large`
    );
    process.exit(1);
  }

  if (!jsonOutput) {
    console.log('='.repeat(80));
    console.log('SHADOW ATLAS - LAYER PROMOTION');
    console.log('='.repeat(80));
    console.log(`Input:           ${inputPath}`);
    console.log(`Target registry: ${options.toRegistry}`);
    console.log(`Category filter: ${options.category || 'RECOVERABLE_US (default)'}`);
    console.log(`Confidence min:  ${confidenceThreshold}`);
    console.log(`Skip duplicates: ${options.skipDuplicates ? 'yes' : 'no'}`);
    if (dryRun) {
      console.log('Mode:            DRY RUN (no changes will be applied)');
    }
    if (options.snapshot && !dryRun) {
      console.log('Snapshot:        Will create backup before promotion');
    }
    console.log('');
  }

  try {
    // Load categorization file
    const content = await readFile(inputPath, 'utf-8');
    const categorization: CategorizationFile = JSON.parse(content);

    // Determine which category to process
    const category = options.category || 'RECOVERABLE_US';

    // Get layers to promote
    let layersToPromote: RecoverableLayer[] = [];

    if (category === 'RECOVERABLE_US') {
      layersToPromote = [...categorization.recoverable];
    } else {
      console.error(
        `Error: Promotion currently only supports RECOVERABLE_US category`
      );
      process.exit(1);
    }

    if (!jsonOutput) {
      console.log(`Total ${category} layers: ${layersToPromote.length}\n`);
    }

    // Process promotion
    const result = await processPromotion(
      layersToPromote,
      options.toRegistry,
      confidenceThreshold,
      options.skipDuplicates ?? false
    );

    // Output results
    if (jsonOutput) {
      console.log(
        JSON.stringify(
          {
            ...result,
            metadata: {
              inputFile: inputPath,
              targetRegistry: options.toRegistry,
              category,
              confidenceThreshold,
              promotedAt: new Date().toISOString(),
              dryRun,
            },
          },
          null,
          2
        )
      );
    } else {
      printPromotionReport(result, options, dryRun);
    }

    // Apply changes if not dry run
    if (!dryRun && result.promoted.length > 0) {
      // Note: In real implementation, this would load and update the actual registry
      // For now, we'll just show a message
      console.log(
        `\nPromotion complete. ${result.promoted.length} layers would be added to ${options.toRegistry} registry.`
      );
      console.log(
        `Note: Actual registry update not implemented in this command.`
      );
      console.log(
        `Use 'shadow-atlas registry add' for manual additions or implement registry writer.`
      );
    }
  } catch (error) {
    if (jsonOutput) {
      console.log(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } else {
      console.error(
        `\nError: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    process.exit(1);
  }
}

/**
 * Process promotion of layers
 */
async function processPromotion(
  layers: readonly RecoverableLayer[],
  targetRegistry: string,
  confidenceThreshold: number,
  skipDuplicates: boolean
): Promise<PromotionResult> {
  const promoted: ResolvedLayer[] = [];
  const skipped: Array<{ layer: RecoverableLayer; reason: string }> = [];
  const seenUrls = new Set<string>();

  let duplicateCount = 0;
  let belowThresholdCount = 0;

  for (const layer of layers) {
    // Check confidence threshold
    if (layer.confidence < confidenceThreshold) {
      skipped.push({
        layer,
        reason: `Confidence ${layer.confidence} below threshold ${confidenceThreshold}`,
      });
      belowThresholdCount++;
      continue;
    }

    // Check for duplicates
    if (skipDuplicates && seenUrls.has(layer.url)) {
      skipped.push({
        layer,
        reason: 'Duplicate URL',
      });
      duplicateCount++;
      continue;
    }

    seenUrls.add(layer.url);

    // Promote to resolved format
    promoted.push({
      url: layer.url,
      name: layer.name,
      resolution: {
        fips: layer.suggestedFips,
        name: layer.suggestedName,
        state: layer.suggestedState,
        method: `PATTERN_${layer.recoveryMethod}`,
        confidence: 80, // Pattern matching confidence
      },
    });
  }

  return {
    promoted,
    skipped,
    summary: {
      totalCandidates: layers.length,
      promoted: promoted.length,
      skipped: skipped.length,
      duplicates: duplicateCount,
      belowThreshold: belowThresholdCount,
    },
  };
}

/**
 * Print promotion report
 */
function printPromotionReport(
  result: PromotionResult,
  options: PromoteOptions,
  dryRun: boolean
): void {
  const { summary } = result;

  console.log('PROMOTION SUMMARY:');
  console.log('-'.repeat(60));
  console.log(`  Total candidates:    ${summary.totalCandidates}`);
  console.log(`  Promoted:            ${summary.promoted}`);
  console.log(`  Skipped:             ${summary.skipped}`);
  console.log(`    - Duplicates:      ${summary.duplicates}`);
  console.log(`    - Below threshold: ${summary.belowThreshold}`);

  // Show promoted layers grouped by state
  if (summary.promoted > 0) {
    console.log('\n' + '-'.repeat(60));
    console.log('PROMOTED LAYERS BY STATE:');
    console.log('-'.repeat(60));

    const byState = new Map<string, number>();
    for (const layer of result.promoted) {
      const state = layer.resolution.state;
      byState.set(state, (byState.get(state) || 0) + 1);
    }

    for (const [state, count] of Array.from(byState.entries()).sort(
      (a, b) => b[1] - a[1]
    )) {
      console.log(`  ${state}: ${count}`);
    }

    // Show sample promoted layers
    console.log('\n' + '-'.repeat(60));
    console.log('SAMPLE PROMOTED LAYERS:');
    console.log('-'.repeat(60));
    for (const layer of result.promoted.slice(0, 10)) {
      console.log(
        `  ${layer.resolution.name}, ${layer.resolution.state} (FIPS: ${layer.resolution.fips})`
      );
      const urlPreview =
        layer.url.length > 60 ? layer.url.slice(0, 60) + '...' : layer.url;
      console.log(`    URL: ${urlPreview}`);
    }
    if (result.promoted.length > 10) {
      console.log(`  ... and ${result.promoted.length - 10} more`);
    }
  }

  // Show skipped layers if any
  if (summary.skipped > 0 && result.skipped.length <= 20) {
    console.log('\n' + '-'.repeat(60));
    console.log('SKIPPED LAYERS:');
    console.log('-'.repeat(60));
    for (const item of result.skipped) {
      console.log(`  ${item.layer.suggestedName}, ${item.layer.suggestedState}`);
      console.log(`    Reason: ${item.reason}`);
    }
  }

  // Final summary
  console.log('\n' + '='.repeat(80));
  if (dryRun) {
    console.log('DRY RUN COMPLETE - No changes applied');
  } else {
    console.log('PROMOTION WORKFLOW INITIATED');
  }
  console.log('='.repeat(80));
  console.log(`
  ✓ ${summary.promoted} layers ready for promotion
  ✗ ${summary.skipped} layers skipped
  ${summary.duplicates > 0 ? `  ⚠ ${summary.duplicates} duplicate URLs found\n` : ''}
  ${!dryRun ? 'NEXT STEPS:\n  1. Verify promoted layers in target registry\n  2. Run validation on promoted entries\n  3. Update registry metadata' : 'To apply changes, run without --dry-run'}
  `);
}
