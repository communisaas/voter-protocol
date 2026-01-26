#!/usr/bin/env tsx
/**
 * Shadow Atlas CLI Entry Point
 *
 * Unified CLI for Shadow Atlas registry management, validation, discovery,
 * and data operations. Replaces 87 ad-hoc scripts with a production-grade
 * command-line interface.
 *
 * @module shadow-atlas-cli
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig, type CLIConfig } from '../src/cli/lib/config.js';
import { createCLILogger, type CLILogger } from '../src/cli/lib/logger.js';

// Command implementations - Registry
import { listCommand as registryListCommand } from '../src/cli/commands/registry/list.js';
import { getCommand as registryGetCommand } from '../src/cli/commands/registry/get.js';
import { addCommand as registryAddCommand } from '../src/cli/commands/registry/add.js';
import { updateCommand as registryUpdateCommand } from '../src/cli/commands/registry/update.js';
import { deleteCommand as registryDeleteCommand } from '../src/cli/commands/registry/delete.js';
import { statsCommand as registryStatsCommand } from '../src/cli/commands/registry/stats.js';
import { diffCommand as registryDiffCommand } from '../src/cli/commands/registry/diff.js';

// Command implementations - Validate
import { validateSingle, validateBatch, loadBatch } from '../src/cli/commands/validate/council.js';
import { validateSingleLayer, runCrossValidation } from '../src/cli/commands/validate/geoids.js';
import { validateRegistryBoundaries, validateGoldenBoundaries } from '../src/cli/commands/validate/boundaries.js';
import { checkCoverage, checkStaleness, checkUrlLiveness } from '../src/cli/commands/validate/registry.js';
import { spawn } from 'node:child_process';

// Command implementations - Quarantine
import { quarantineCommand } from '../src/cli/commands/quarantine/index.js';

// Command implementations - Codegen
import { runGenerate, runExtract, runVerify, runSync } from '../src/cli/commands/codegen/index.js';

// Command implementations - Migrate
import { runApply, runRollback, runStatus, runSnapshot } from '../src/cli/commands/migrate/index.js';

// Command implementations - Diagnose
import { runContainment, runCoverage, runOverlap, runHealth } from '../src/cli/commands/diagnose/index.js';

// Command implementations - Discover (registration pattern)
import { registerDiscoverCommands } from '../src/cli/commands/discover/index.js';

// Command implementations - Ingest (registration pattern)
import { registerIngestCommands } from '../src/cli/commands/ingest/index.js';

// Command implementations - Audit (registration pattern)
import { registerAuditCommands } from '../src/cli/commands/audit/index.js';

// Command implementations - Curate (registration pattern)
import { registerCurateCommands } from '../src/cli/commands/curate/index.js';

// ============================================================================
// Exit Codes (per spec)
// ============================================================================

export const EXIT_CODES = {
  SUCCESS: 0,
  WARNINGS: 1,
  ERRORS: 2,
  CONFIG_ERROR: 3,
  NETWORK_ERROR: 4,
  DATA_INTEGRITY_ERROR: 5,
  USER_CANCELLED: 10,
  UNKNOWN_COMMAND: 127,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

// ============================================================================
// Global State
// ============================================================================

export interface GlobalContext {
  config: CLIConfig;
  logger: CLILogger;
  startTime: number;
}

let globalContext: GlobalContext | null = null;

export function getGlobalContext(): GlobalContext {
  if (!globalContext) {
    throw new Error('Global context not initialized. Call initializeContext first.');
  }
  return globalContext;
}

// ============================================================================
// CLI Setup
// ============================================================================

function getVersion(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = join(__dirname, '..', 'package.json');
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function initializeContext(options: {
  verbose?: boolean;
  json?: boolean;
  dryRun?: boolean;
  config?: string;
  noAudit?: boolean;
  timeout?: number;
  concurrency?: number;
}): Promise<GlobalContext> {
  const startTime = Date.now();

  // Load configuration
  const config = await loadConfig({
    configPath: options.config,
    overrides: {
      verbose: options.verbose,
      json: options.json,
      dryRun: options.dryRun,
      noAudit: options.noAudit,
      timeout: options.timeout,
      concurrency: options.concurrency,
    },
  });

  // Create logger
  const logger = createCLILogger({
    level: config.verbose ? 'debug' : 'info',
    json: config.json,
  });

  globalContext = { config, logger, startTime };
  return globalContext;
}

function createProgram(): Command {
  const program = new Command();

  program
    .name('shadow-atlas')
    .description(
      'Shadow Atlas CLI - Unified tooling for geospatial voting district registry'
    )
    .version(getVersion(), '-V, --version', 'Output the version number')
    .option('-v, --verbose', 'Enable verbose output')
    .option('--json', 'Output as JSON (machine-readable)')
    .option('--dry-run', 'Show what would happen without executing')
    .option('--config <path>', 'Path to config file (default: .shadow-atlasrc)')
    .option('--no-audit', 'Skip audit logging (use sparingly)')
    .option('--timeout <ms>', 'Operation timeout in milliseconds', parseInt)
    .option('--concurrency <n>', 'Parallel operations limit', parseInt)
    .hook('preAction', async (thisCommand) => {
      const options = thisCommand.opts();
      try {
        await initializeContext(options);
      } catch (error) {
        console.error(
          `Configuration error: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(EXIT_CODES.CONFIG_ERROR);
      }
    });

  // ============================================================================
  // Registry Commands
  // ============================================================================

  const registry = program
    .command('registry')
    .description('Registry CRUD operations');

  registry
    .command('list')
    .description('List registry entries with filters')
    .option(
      '--registry <name>',
      'Registry: known-portals|quarantined|at-large',
      'known-portals'
    )
    .option('--state <code>', 'Filter by state (e.g., CA, TX)')
    .option('--portal-type <type>', 'Filter by portal type')
    .option('--confidence <n>', 'Minimum confidence score (0-100)', parseInt)
    .option('--stale <days>', 'Show entries not verified in N days', parseInt)
    .option('--limit <n>', 'Max results', parseInt)
    .option('--offset <n>', 'Pagination offset', parseInt)
    .option('--format <fmt>', 'Output format: table|json|ndjson|csv', 'table')
    .action(async (options) => {
      await registryListCommand({
        registry: options.registry,
        state: options.state,
        portalType: options.portalType,
        confidence: options.confidence,
        stale: options.stale,
        limit: options.limit,
        offset: options.offset,
        format: options.format,
      });
    });

  registry
    .command('get <fips>')
    .description('Get detailed information about a single entry')
    .option('--registry <name>', 'Which registry to search')
    .option('--include-history', 'Show modification history from audit log')
    .option('--validate', 'Run validation checks on entry')
    .action(async (fips, options) => {
      await registryGetCommand(fips, {
        registry: options.registry,
        includeHistory: options.includeHistory,
        validate: options.validate,
      });
    });

  registry
    .command('add')
    .description('Add a new entry to the registry')
    .requiredOption('--fips <code>', '7-digit Census PLACE FIPS')
    .requiredOption('--city <name>', 'City name')
    .requiredOption('--state <code>', 'State code')
    .requiredOption('--url <url>', 'Download URL')
    .requiredOption('--portal-type <type>', 'Portal type')
    .requiredOption('--count <n>', 'Feature count', parseInt)
    .option('--confidence <n>', 'Confidence score', parseInt, 60)
    .option('--discovered-by <source>', 'Discovery attribution', 'manual')
    .option('--notes <text>', 'Optional notes')
    .option('--skip-validation', 'Skip URL validation')
    .action(async (options) => {
      await registryAddCommand({
        fips: options.fips,
        city: options.city,
        state: options.state,
        url: options.url,
        portalType: options.portalType,
        count: options.count,
        confidence: options.confidence,
        discoveredBy: options.discoveredBy,
        notes: options.notes,
        skipValidation: options.skipValidation,
      });
    });

  registry
    .command('update <fips>')
    .description('Update fields on an existing entry')
    .option('--url <url>', 'Update download URL')
    .option('--count <n>', 'Update feature count', parseInt)
    .option('--confidence <n>', 'Update confidence score', parseInt)
    .option('--notes <text>', 'Update notes')
    .option('--last-verified', 'Update lastVerified to now')
    .option('--reason <text>', 'Audit log reason')
    .action(async (fips, options) => {
      await registryUpdateCommand(fips, {
        url: options.url,
        count: options.count,
        confidence: options.confidence,
        notes: options.notes,
        lastVerified: options.lastVerified,
        reason: options.reason,
      });
    });

  registry
    .command('delete <fips>')
    .description('Soft-delete an entry by moving to quarantine')
    .requiredOption('--reason <text>', 'Deletion reason')
    .option('--pattern <code>', 'Quarantine pattern code')
    .option('--hard', 'Hard delete (requires --force)')
    .option('--force', 'Confirm hard delete')
    .action(async (fips, options) => {
      await registryDeleteCommand(fips, {
        reason: options.reason,
        pattern: options.pattern,
        hard: options.hard,
        force: options.force,
      });
    });

  registry
    .command('stats')
    .description('Registry statistics')
    .option('--detailed', 'Show detailed breakdown')
    .action(async (options) => {
      await registryStatsCommand({
        detailed: options.detailed,
      });
    });

  registry
    .command('diff')
    .description('Show registry drift')
    .option('--baseline <file>', 'Baseline file for comparison')
    .option('--since <date>', 'Show changes since date')
    .action(async (options) => {
      await registryDiffCommand({
        baseline: options.baseline,
        since: options.since,
      });
    });

  // ============================================================================
  // Validate Commands
  // ============================================================================

  const validate = program
    .command('validate')
    .description('Validation pipeline');

  validate
    .command('council')
    .description('Council district tessellation validation')
    .option('--fips <code>', 'Validate single city by FIPS')
    .option('--url <url>', 'Override download URL')
    .option('--tier <level>', 'Validation tier: structure|sanity|full', 'full')
    .option('--batch <file>', 'Batch validation from JSON file')
    .option('--limit <n>', 'Max cities to validate (batch mode)', parseInt)
    .option('--expected <n>', 'Expected district count', parseInt)
    .option('--tolerance <pct>', 'Coverage tolerance override', parseFloat)
    .action(async (options) => {
      const { config } = getGlobalContext();
      if (options.batch) {
        const entries = await loadBatch(options.batch, options.limit);
        await validateBatch(null as any, entries, { tier: options.tier, tolerance: options.tolerance });
      } else if (options.fips) {
        await validateSingle(null as any, options.fips, options.url, {
          tier: options.tier,
          expectedCount: options.expected,
          tolerance: options.tolerance,
        });
      } else {
        console.error('Either --fips or --batch is required');
        process.exit(2);
      }
    });

  validate
    .command('geoids')
    .description('GEOID format/coverage validation')
    .option('--layer <type>', 'Layer: cd|sldu|sldl|county|unsd|elsd|scsd|vtd')
    .option('--state <code>', 'State FIPS (2-digit)')
    .option('--cross-validate', 'Compare TIGER vs state GIS')
    .option('--include-counts', 'Validate against expected counts')
    .action(async (options) => {
      if (options.crossValidate) {
        await runCrossValidation({ verbose: options.verbose });
      } else if (options.layer) {
        await validateSingleLayer(options.layer, options.state);
      } else {
        console.error('Either --layer or --cross-validate is required');
        process.exit(2);
      }
    });

  validate
    .command('boundaries')
    .description('Boundary download validation')
    .option('--source <type>', 'Source: all|golden|registry')
    .option('--sample <n>', 'Sample size for validation', parseInt)
    .action(async (options) => {
      if (options.source === 'golden') {
        await validateGoldenBoundaries({ sample: options.sample, verbose: options.verbose });
      } else {
        await validateRegistryBoundaries({ sample: options.sample, verbose: options.verbose });
      }
    });

  validate
    .command('registry')
    .description('Registry health checks')
    .option('--coverage <set>', 'Coverage set: top50|top100|all')
    .option('--check-urls', 'Validate URL liveness')
    .option('--check-downloads', 'Full download validation')
    .option('--stale-threshold <days>', 'Flag entries older than N days', parseInt)
    .action(async (options) => {
      const results: string[] = [];
      if (options.coverage) {
        const coverage = await checkCoverage(options.coverage);
        results.push(`Coverage (${options.coverage}): ${coverage.covered}/${coverage.total} cities`);
      }
      if (options.staleThreshold) {
        const stale = await checkStaleness(options.staleThreshold);
        results.push(`Stale entries (>${options.staleThreshold} days): ${stale.count}`);
      }
      if (options.checkUrls) {
        const urlResults = await checkUrlLiveness(options.concurrency || 10, options.verbose);
        results.push(`URL checks: ${urlResults.alive}/${urlResults.total} alive`);
      }
      if (results.length === 0) {
        console.log('Specify --coverage, --check-urls, or --stale-threshold');
      } else {
        results.forEach(r => console.log(r));
      }
    });

  validate
    .command('comprehensive')
    .description('Full validation suite')
    .option('--include-cross', 'Include TIGER cross-validation')
    .option('--include-freshness', 'Include freshness monitoring')
    .option('--include-vtd', 'Include VTD coverage checks')
    .option('--output <file>', 'Write report to file')
    .action(async (options) => {
      const args: string[] = [];
      if (options.includeCross) args.push('--include-cross');
      if (options.includeFreshness) args.push('--include-freshness');
      if (options.includeVtd) args.push('--include-vtd');
      if (options.output) args.push('--output', options.output);
      const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'commands', 'validate', 'comprehensive.ts');
      const child = spawn('npx', ['tsx', scriptPath, ...args], { stdio: 'inherit', shell: true });
      child.on('close', (code) => process.exit(code ?? 0));
    });

  validate
    .command('production-ready')
    .description('Pre-deploy checks')
    .option('--strict', 'Fail on any warnings')
    .action(async (options) => {
      const args: string[] = [];
      if (options.strict) args.push('--strict');
      const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'commands', 'validate', 'production-ready.ts');
      const child = spawn('npx', ['tsx', scriptPath, ...args], { stdio: 'inherit', shell: true });
      child.on('close', (code) => process.exit(code ?? 0));
    });

  validate
    .command('international')
    .description('ISO 3166-1 country registry verification')
    .option('--region <name>', 'Filter by region: americas|europe|asia-pacific|africa|middle-east')
    .option('--format <fmt>', 'Output format: table|json|csv', 'table')
    .option('-v, --verbose', 'Include sample lookups')
    .option('--no-providers', 'Skip provider coverage check')
    .option('--no-uniqueness', 'Skip uniqueness check')
    .action(async (options) => {
      const args: string[] = [];
      if (options.region) args.push('--region', options.region);
      if (options.format) args.push('--format', options.format);
      if (options.verbose) args.push('--verbose');
      if (options.providers === false) args.push('--no-providers');
      if (options.uniqueness === false) args.push('--no-uniqueness');
      const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'commands', 'validate', 'international.ts');
      const child = spawn('npx', ['tsx', scriptPath, ...args], { stdio: 'inherit', shell: true });
      child.on('close', (code) => process.exit(code ?? 0));
    });

  validate
    .command('fips')
    .description('FIPS resolution edge case testing')
    .option('--url <url>', 'Test single ArcGIS Feature Service URL')
    .option('--name <name>', 'Layer name (required with --url)')
    .option('--test-suite <name>', 'Run predefined suite: edge-cases|consolidated-cities|parishes|hawaii|all')
    .option('--from-file <path>', 'Load test cases from JSONL file')
    .option('--format <fmt>', 'Output format: table|json|csv|summary|junit', 'table')
    .option('-v, --verbose', 'Show detailed resolution diagnostics')
    .action(async (options) => {
      const args: string[] = [];
      if (options.url) args.push('--url', options.url);
      if (options.name) args.push('--name', options.name);
      if (options.testSuite) args.push('--test-suite', options.testSuite);
      if (options.fromFile) args.push('--from-file', options.fromFile);
      if (options.format) args.push('--format', options.format);
      if (options.verbose) args.push('--verbose');
      const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'commands', 'validate', 'fips.ts');
      const child = spawn('npx', ['tsx', scriptPath, ...args], { stdio: 'inherit', shell: true });
      child.on('close', (code) => process.exit(code ?? 0));
    });

  validate
    .command('discover-results')
    .description('Discovery output audit and classification')
    .option('--input <jsonl>', 'Input validated layers file', 'validated_layers.jsonl')
    .option('--threshold <num>', 'Confidence threshold for ACCEPT', '80')
    .option('--attribute-cities', 'Run city attribution on ambiguous layers')
    .option('--report <path>', 'Write detailed report (JSON)')
    .option('--show-samples', 'Include sample layers in each category')
    .option('--format <fmt>', 'Output format: summary|detailed|json', 'summary')
    .option('-v, --verbose', 'Verbose output with detailed reasoning')
    .action(async (options) => {
      const args: string[] = [];
      if (options.input) args.push('--input', options.input);
      if (options.threshold) args.push('--threshold', options.threshold);
      if (options.attributeCities) args.push('--attribute-cities');
      if (options.report) args.push('--report', options.report);
      if (options.showSamples) args.push('--show-samples');
      if (options.format) args.push('--format', options.format);
      if (options.verbose) args.push('--verbose');
      const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'commands', 'validate', 'discover-results.ts');
      const child = spawn('npx', ['tsx', scriptPath, ...args], { stdio: 'inherit', shell: true });
      child.on('close', (code) => process.exit(code ?? 0));
    });

  // ============================================================================
  // Quarantine Commands
  // ============================================================================

  const quarantine = program
    .command('quarantine')
    .description('Quarantine workflow');

  quarantine
    .command('add <fips>')
    .description('Move entry to quarantine')
    .requiredOption('--reason <text>', 'Detailed quarantine reason')
    .option('--pattern <code>', 'Pattern code for categorization')
    .action(async (fips, options) => {
      const { config } = getGlobalContext();
      const exitCode = await quarantineCommand('add', [fips, '--reason', options.reason, ...(options.pattern ? ['--pattern', options.pattern] : [])], {
        verbose: config.verbose,
        json: config.json,
        dryRun: config.dryRun,
      });
      if (exitCode !== 0) process.exit(exitCode);
    });

  quarantine
    .command('list')
    .description('List quarantined entries')
    .option('--pattern <code>', 'Filter by pattern code')
    .option('--state <code>', 'Filter by state')
    .option('--resolvable', 'Show only entries with potential resolution')
    .option('--age <days>', 'Filter by quarantine age', parseInt)
    .action(async (options) => {
      const { config } = getGlobalContext();
      const args: string[] = [];
      if (options.pattern) args.push('--pattern', options.pattern);
      if (options.state) args.push('--state', options.state);
      if (options.resolvable) args.push('--resolvable');
      if (options.age) args.push('--age', String(options.age));
      const exitCode = await quarantineCommand('list', args, {
        verbose: config.verbose,
        json: config.json,
        dryRun: config.dryRun,
      });
      if (exitCode !== 0) process.exit(exitCode);
    });

  quarantine
    .command('resolve <fips>')
    .description('Attempt automated resolution')
    .option('--search-strategy <s>', 'Resolution strategy: arcgis|socrata|manual')
    .option('--replacement-url <url>', 'Provide replacement URL directly')
    .option('--validate', 'Validate replacement before applying')
    .action(async (fips, options) => {
      const { config } = getGlobalContext();
      const args: string[] = [fips];
      if (options.searchStrategy) args.push('--search-strategy', options.searchStrategy);
      if (options.replacementUrl) args.push('--replacement-url', options.replacementUrl);
      if (options.validate) args.push('--validate');
      const exitCode = await quarantineCommand('resolve', args, {
        verbose: config.verbose,
        json: config.json,
        dryRun: config.dryRun,
      });
      if (exitCode !== 0) process.exit(exitCode);
    });

  quarantine
    .command('restore <fips>')
    .description('Restore quarantined entry to known-portals')
    .option('--url <url>', 'New URL (if original was bad)')
    .option('--validate', 'Validate before restoring')
    .option('--reason <text>', 'Audit log reason')
    .action(async (fips, options) => {
      const { config } = getGlobalContext();
      const args: string[] = [fips];
      if (options.url) args.push('--url', options.url);
      if (options.validate) args.push('--validate');
      if (options.reason) args.push('--reason', options.reason);
      const exitCode = await quarantineCommand('restore', args, {
        verbose: config.verbose,
        json: config.json,
        dryRun: config.dryRun,
      });
      if (exitCode !== 0) process.exit(exitCode);
    });

  quarantine
    .command('promote <fips>')
    .description('Promote quarantined entry to at-large registry')
    .requiredOption('--council-size <n>', 'Number of council seats', parseInt)
    .option('--election-method <m>', 'Election method: at-large|proportional', 'at-large')
    .requiredOption('--source <text>', 'Verification source')
    .option('--notes <text>', 'Additional notes')
    .action(async (fips, options) => {
      const { config } = getGlobalContext();
      const args: string[] = [fips, '--council-size', String(options.councilSize), '--source', options.source];
      if (options.electionMethod) args.push('--election-method', options.electionMethod);
      if (options.notes) args.push('--notes', options.notes);
      const exitCode = await quarantineCommand('promote', args, {
        verbose: config.verbose,
        json: config.json,
        dryRun: config.dryRun,
      });
      if (exitCode !== 0) process.exit(exitCode);
    });

  // ============================================================================
  // Discover Commands (wired via registration function)
  // ============================================================================
  registerDiscoverCommands(program);

  // ============================================================================
  // Ingest Commands (wired via registration function)
  // ============================================================================
  registerIngestCommands(program);

  // ============================================================================
  // Codegen Commands
  // ============================================================================

  const codegen = program
    .command('codegen')
    .description('Code generation');

  codegen
    .command('generate')
    .description('Generate TypeScript from NDJSON')
    .option('--registry <name>', 'Specific registry')
    .option('--verify', 'Verify round-trip after generation')
    .option('--check-only', 'Check if regeneration needed, do not write')
    .action(async (options) => {
      const result = await runGenerate({
        registry: options.registry,
        verify: options.verify,
        checkOnly: options.checkOnly,
      });
      if (!result.success) process.exit(2);
    });

  codegen
    .command('extract')
    .description('Extract NDJSON from TypeScript')
    .option('--registry <name>', 'Specific registry')
    .option('--output-dir <path>', 'Output directory')
    .action(async (options) => {
      const result = await runExtract({
        registry: options.registry,
        outputDir: options.outputDir,
      });
      if (!result.success) process.exit(2);
    });

  codegen
    .command('verify')
    .description('Verify round-trip fidelity')
    .option('--registry <name>', 'Specific registry')
    .option('--strict', 'Fail on any difference')
    .action(async (options) => {
      const result = await runVerify({
        registry: options.registry,
        strict: options.strict,
      });
      if (!result.success) process.exit(2);
    });

  codegen
    .command('sync')
    .description('Full sync workflow')
    .option('--direction <dir>', 'Direction: ndjson-to-ts|ts-to-ndjson')
    .action(async (options) => {
      const result = await runSync({
        direction: options.direction,
      });
      if (!result.success) process.exit(2);
    });

  // ============================================================================
  // Migrate Commands
  // ============================================================================

  const migrate = program
    .command('migrate')
    .description('Data migrations');

  migrate
    .command('apply <migration>')
    .description('Apply a migration')
    .option('--dry-run', 'Show changes without applying')
    .option('--force', 'Apply even if validation warns')
    .option('--snapshot', 'Create snapshot before applying')
    .action(async (migration, options) => {
      const { config } = getGlobalContext();
      const result = await runApply({
        migration,
        dryRun: config.dryRun || options.dryRun,
        force: options.force,
        snapshot: options.snapshot,
      });
      if (!result.success) process.exit(2);
    });

  migrate
    .command('rollback')
    .description('Rollback to a previous snapshot')
    .option('--to <snapshot>', 'Rollback to specific snapshot')
    .option('--steps <n>', 'Rollback N migrations', parseInt)
    .option('--list', 'List available snapshots')
    .action(async (options) => {
      const result = await runRollback({
        to: options.to,
        steps: options.steps,
        list: options.list,
      });
      if (!result.success) process.exit(2);
    });

  migrate
    .command('status')
    .description('Migration status')
    .action(async () => {
      const result = await runStatus();
      if (!result.success) process.exit(2);
    });

  migrate
    .command('snapshot')
    .description('Create snapshot')
    .option('--name <name>', 'Snapshot name')
    .option('--description <text>', 'Snapshot description')
    .action(async (options) => {
      const result = await runSnapshot({
        name: options.name,
        description: options.description,
      });
      if (!result.success) process.exit(2);
    });

  // ============================================================================
  // Diagnose Commands
  // ============================================================================

  const diagnose = program
    .command('diagnose')
    .description('Diagnostics and debugging');

  diagnose
    .command('containment <fips>')
    .description('Containment analysis')
    .option('--url <url>', 'Override download URL')
    .option('--boundary-source <s>', 'Boundary source: tiger|authoritative')
    .option('--output <file>', 'Write detailed report')
    .action(async (fips, options) => {
      const result = await runContainment({
        fips,
        url: options.url,
        boundarySource: options.boundarySource,
        output: options.output,
      });
      if (!result.success) process.exit(2);
    });

  diagnose
    .command('coverage <fips>')
    .description('Coverage analysis with deep failure diagnostics')
    .option('--include-water', 'Include water area analysis')
    .option('--vintage-compare', 'Compare across TIGER vintages')
    .option('--deep', 'Enable deep failure analysis')
    .option('--categorize', 'Categorize failure patterns (systemic vs one-off)')
    .option('--recovery-potential', 'Assess recovery potential for failures')
    .option('--layer-diagnostics', 'Show per-layer diagnostic details')
    .option('--limit <n>', 'Limit analysis to N layers', parseInt)
    .action(async (fips, options) => {
      const result = await runCoverage({
        fips,
        includeWater: options.includeWater,
        vintageCompare: options.vintageCompare,
        deep: options.deep,
        categorize: options.categorize,
        recoveryPotential: options.recoveryPotential,
        layerDiagnostics: options.layerDiagnostics,
        limit: options.limit,
      });
      if (!result.success) process.exit(2);
    });

  diagnose
    .command('overlap')
    .description('Overlap detection')
    .option('--fips <code>', 'Specific FIPS to analyze')
    .option('--threshold <sqm>', 'Overlap threshold in square meters', parseFloat)
    .action(async (options) => {
      const result = await runOverlap({
        fips: options.fips,
        threshold: options.threshold,
      });
      if (!result.success) process.exit(2);
    });

  diagnose
    .command('health')
    .description('System health check')
    .option('--component <name>', 'Check specific component')
    .option('--quick', 'Fast checks only (skip network)')
    .option('--metrics', 'Output metrics format')
    .option('--layers', 'Enable layer accessibility checks')
    .option('--sample-size <n>', 'Number of layers to sample (default: 50, max: 500)', parseInt)
    .action(async (options) => {
      const { config } = getGlobalContext();
      const result = await runHealth({
        component: options.component,
        quick: options.quick,
        verbose: config.verbose,
        json: config.json,
        metrics: options.metrics,
        layers: options.layers,
        sampleSize: options.sampleSize,
      });
      if (!result.success) process.exit(2);
    });

  // ============================================================================
  // Audit Commands (wired via registration function)
  // ============================================================================
  registerAuditCommands(program);

  // ============================================================================
  // Curate Commands (wired via registration function)
  // ============================================================================
  registerCurateCommands(program);

  return program;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (globalContext) {
      globalContext.logger.error('Command failed', {
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - globalContext.startTime,
      });
    } else {
      console.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    process.exit(EXIT_CODES.ERRORS);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(EXIT_CODES.ERRORS);
});
