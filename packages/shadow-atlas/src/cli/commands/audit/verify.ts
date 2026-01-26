/**
 * Audit Verify Command
 *
 * Verify audit log integrity and consistency.
 *
 * Usage:
 *   shadow-atlas audit verify [options]
 *
 * Options:
 *   --fix              Fix issues when possible
 *   --verbose          Show detailed verification output
 *   --json             Output as JSON
 *
 * Verification checks:
 * 1. Valid JSON structure for all entries
 * 2. Required fields present (id, timestamp, action, fips, actor)
 * 3. Chronological ordering (timestamps in ascending order)
 * 4. No duplicate IDs
 * 5. Referenced FIPS codes exist in registries
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import type { Command } from 'commander';
import { readFile, writeFile } from 'fs/promises';
import {
  getAuditLogPath,
  type AuditEntry,
  type AuditAction,
} from '../../lib/audit.js';
import {
  loadAllRegistries,
  validateFips,
  type RegistryName,
} from '../../lib/ndjson.js';
import { loadConfig } from '../../lib/config.js';

/**
 * Verify options from CLI
 */
interface VerifyOptions {
  readonly fix?: boolean;
  readonly verbose?: boolean;
  readonly json?: boolean;
}

/**
 * Verification result
 */
interface VerificationResult {
  readonly valid: boolean;
  readonly totalEntries: number;
  readonly issues: Issue[];
  readonly fixed: number;
}

/**
 * Verification issue
 */
interface Issue {
  readonly line: number;
  readonly type:
    | 'invalid_json'
    | 'missing_field'
    | 'invalid_field'
    | 'duplicate_id'
    | 'chronology'
    | 'fips_not_found';
  readonly message: string;
  readonly entry?: AuditEntry;
  readonly fixed?: boolean;
}

/**
 * Register the verify command
 */
export function registerVerifyCommand(parent: Command): void {
  parent
    .command('verify')
    .description('Verify audit log integrity')
    .option('--fix', 'Fix issues when possible')
    .option('-v, --verbose', 'Show detailed verification output')
    .option('--json', 'Output as JSON')
    .action(async (options: VerifyOptions) => {
      await executeVerify(options);
    });
}

/**
 * Execute the verify command
 */
async function executeVerify(options: VerifyOptions): Promise<void> {
  try {
    // Load config
    const config = await loadConfig({});

    // NOTE: config.paths.data is './data/registries' but loadAllRegistries expects './data'
    // This is a known issue with the config structure. For now, use the parent directory.
    const dataDir = config.paths.data.endsWith('/registries')
      ? config.paths.data.replace(/\/registries$/, '')
      : config.paths.data;

    if (!options.json) {
      console.log('Verifying audit log integrity...');
      console.log('');
    }

    // Run verification
    const result = await verifyAuditLog(dataDir, options);

    // Output results
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printVerificationResult(result, options.verbose);
    }

    // Exit with appropriate code
    if (!result.valid) {
      process.exit(1);
    }
  } catch (error) {
    if (options.json) {
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
 * Verify audit log
 */
async function verifyAuditLog(
  dataDir: string,
  options: VerifyOptions
): Promise<VerificationResult> {
  const logPath = getAuditLogPath(dataDir);
  const issues: Issue[] = [];
  const entries: AuditEntry[] = [];
  const seenIds = new Set<string>();
  let totalEntries = 0;
  let fixed = 0;

  // Load registry data for FIPS validation
  const registries = await loadAllRegistries(dataDir);
  const allFips = new Set<string>();

  // Add FIPS from all registries
  Array.from(registries.knownPortals.entries.keys()).forEach((fips) =>
    allFips.add(fips)
  );
  Array.from(registries.quarantinedPortals.entries.keys()).forEach((fips) =>
    allFips.add(fips)
  );
  Array.from(registries.atLargeCities.entries.keys()).forEach((fips) =>
    allFips.add(fips)
  );

  // Read audit log
  let content: string;
  try {
    content = await readFile(logPath, 'utf-8');
  } catch {
    // Audit log doesn't exist yet - this is valid
    return {
      valid: true,
      totalEntries: 0,
      issues: [],
      fixed: 0,
    };
  }

  const lines = content.trim().split('\n').filter(Boolean);
  totalEntries = lines.length;

  // Verify each line
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];

    // Check 1: Valid JSON
    let entry: AuditEntry;
    try {
      entry = JSON.parse(line) as AuditEntry;
    } catch {
      issues.push({
        line: lineNum,
        type: 'invalid_json',
        message: `Invalid JSON at line ${lineNum}`,
      });
      continue;
    }

    // Check 2: Required fields
    const requiredFields: Array<keyof AuditEntry> = [
      'id',
      'timestamp',
      'action',
      'registry',
      'fips',
      'actor',
    ];

    for (const field of requiredFields) {
      if (!entry[field]) {
        issues.push({
          line: lineNum,
          type: 'missing_field',
          message: `Missing required field "${field}" at line ${lineNum}`,
          entry,
        });
      }
    }

    // Check 3: Valid field types
    if (entry.timestamp && isNaN(new Date(entry.timestamp).getTime())) {
      issues.push({
        line: lineNum,
        type: 'invalid_field',
        message: `Invalid timestamp at line ${lineNum}: ${entry.timestamp}`,
        entry,
      });
    }

    if (entry.action && !isValidAction(entry.action)) {
      issues.push({
        line: lineNum,
        type: 'invalid_field',
        message: `Invalid action at line ${lineNum}: ${entry.action}`,
        entry,
      });
    }

    if (entry.registry && !isValidRegistry(entry.registry)) {
      issues.push({
        line: lineNum,
        type: 'invalid_field',
        message: `Invalid registry at line ${lineNum}: ${entry.registry}`,
        entry,
      });
    }

    if (entry.fips) {
      const fipsValidation = validateFips(entry.fips);
      if (!fipsValidation.valid) {
        issues.push({
          line: lineNum,
          type: 'invalid_field',
          message: `Invalid FIPS format at line ${lineNum}: ${fipsValidation.error}`,
          entry,
        });
      }
    }

    // Check 4: Duplicate IDs
    if (entry.id) {
      if (seenIds.has(entry.id)) {
        issues.push({
          line: lineNum,
          type: 'duplicate_id',
          message: `Duplicate ID at line ${lineNum}: ${entry.id}`,
          entry,
        });
      }
      seenIds.add(entry.id);
    }

    // Check 5: FIPS exists in registries (non-critical warning)
    if (entry.fips && !allFips.has(entry.fips)) {
      issues.push({
        line: lineNum,
        type: 'fips_not_found',
        message: `FIPS ${entry.fips} at line ${lineNum} not found in any registry (may have been deleted)`,
        entry,
      });
    }

    entries.push(entry);
  }

  // Check 6: Chronological ordering
  for (let i = 1; i < entries.length; i++) {
    const prev = new Date(entries[i - 1].timestamp).getTime();
    const curr = new Date(entries[i].timestamp).getTime();

    if (curr < prev) {
      issues.push({
        line: i + 1,
        type: 'chronology',
        message: `Chronology violation at line ${i + 1}: timestamp is earlier than previous entry`,
        entry: entries[i],
      });
    }
  }

  // Fix issues if requested
  if (options.fix && issues.length > 0) {
    fixed = await fixIssues(logPath, entries, issues);
  }

  // Determine overall validity (warnings don't fail)
  const criticalIssues = issues.filter((i) => i.type !== 'fips_not_found');
  const valid = criticalIssues.length === 0;

  return {
    valid,
    totalEntries,
    issues,
    fixed,
  };
}

/**
 * Fix issues when possible
 */
async function fixIssues(
  logPath: string,
  entries: AuditEntry[],
  issues: Issue[]
): Promise<number> {
  let fixed = 0;

  // Sort chronology issues
  const chronologyIssues = issues.filter((i) => i.type === 'chronology');
  if (chronologyIssues.length > 0) {
    // Sort entries by timestamp
    const sorted = [...entries].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Write back to file
    const content = sorted.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await writeFile(logPath, content, 'utf-8');
    fixed += chronologyIssues.length;

    // Mark issues as fixed
    for (const issue of chronologyIssues) {
      (issue as { fixed?: boolean }).fixed = true;
    }
  }

  return fixed;
}

/**
 * Validate action type
 */
function isValidAction(action: string): action is AuditAction {
  const valid: AuditAction[] = [
    'add',
    'update',
    'delete',
    'quarantine',
    'restore',
    'promote',
    'migrate',
    'rollback',
  ];
  return valid.includes(action as AuditAction);
}

/**
 * Validate registry name
 */
function isValidRegistry(registry: string): registry is RegistryName {
  const valid: RegistryName[] = [
    'known-portals',
    'quarantined-portals',
    'at-large-cities',
  ];
  return valid.includes(registry as RegistryName);
}

/**
 * Print verification result
 */
function printVerificationResult(
  result: VerificationResult,
  verbose?: boolean
): void {
  console.log('Audit Log Verification');
  console.log('='.repeat(80));
  console.log(`Total entries: ${result.totalEntries}`);
  console.log(`Issues found: ${result.issues.length}`);
  console.log(`Status: ${result.valid ? 'VALID' : 'INVALID'}`);

  if (result.fixed > 0) {
    console.log(`Fixed: ${result.fixed} issues`);
  }

  console.log('');

  if (result.issues.length === 0) {
    console.log('No issues found. Audit log is valid.');
    return;
  }

  // Group issues by type
  const byType = new Map<string, Issue[]>();
  for (const issue of result.issues) {
    const issues = byType.get(issue.type) ?? [];
    issues.push(issue);
    byType.set(issue.type, issues);
  }

  console.log('Issues by type:');
  for (const [type, issues] of Array.from(byType.entries())) {
    const fixed = issues.filter((i) => i.fixed).length;
    const fixedStr = fixed > 0 ? ` (${fixed} fixed)` : '';
    console.log(`  ${type}: ${issues.length}${fixedStr}`);
  }

  console.log('');

  // Print detailed issues if verbose
  if (verbose) {
    console.log('Detailed issues:');
    console.log('-'.repeat(80));

    for (const issue of result.issues) {
      const fixedStr = issue.fixed ? ' [FIXED]' : '';
      console.log(`Line ${issue.line}: ${issue.type}${fixedStr}`);
      console.log(`  ${issue.message}`);
      if (issue.entry) {
        console.log(
          `  Entry: ${issue.entry.action} ${issue.entry.fips} by ${issue.entry.actor}`
        );
      }
      console.log('');
    }
  } else {
    // Show first few issues
    const criticalIssues = result.issues.filter(
      (i) => i.type !== 'fips_not_found'
    );
    const warnings = result.issues.filter((i) => i.type === 'fips_not_found');

    if (criticalIssues.length > 0) {
      console.log('Critical issues (first 5):');
      for (const issue of criticalIssues.slice(0, 5)) {
        const fixedStr = issue.fixed ? ' [FIXED]' : '';
        console.log(`  Line ${issue.line}: ${issue.message}${fixedStr}`);
      }

      if (criticalIssues.length > 5) {
        console.log(`  ... and ${criticalIssues.length - 5} more`);
      }
      console.log('');
    }

    if (warnings.length > 0) {
      console.log(`Warnings: ${warnings.length} FIPS codes not found in registries`);
      console.log('  (This is normal for deleted entries)');
      console.log('');
    }
  }

  console.log('Use --verbose to see all issues');
  console.log('Use --fix to automatically fix fixable issues');
}
