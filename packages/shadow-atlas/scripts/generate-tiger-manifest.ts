#!/usr/bin/env npx tsx
/**
 * Generate TIGER Manifest Checksums
 *
 * Downloads TIGER files from Census Bureau and computes SHA-256 checksums.
 * Updates the tiger-manifest.ts file with verified checksums.
 *
 * USAGE:
 *   npx tsx scripts/generate-tiger-manifest.ts
 *   npx tsx scripts/generate-tiger-manifest.ts --vintage 2024
 *   npx tsx scripts/generate-tiger-manifest.ts --file county
 *   npx tsx scripts/generate-tiger-manifest.ts --dry-run
 *
 * OPTIONS:
 *   --vintage <year>  TIGER vintage year (default: 2024)
 *   --file <key>      Only generate checksum for specific file
 *   --dry-run         Print checksums without updating manifest
 *   --verify-only     Only verify existing checksums (no download)
 *   --timeout <ms>    Download timeout in milliseconds (default: 300000)
 *
 * SECURITY:
 * - Downloads directly from Census Bureau FTP
 * - Computes SHA-256 checksums from downloaded data
 * - Outputs manifest entries for manual verification
 *
 * TYPE SAFETY: Nuclear-level strictness.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// Configuration
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, '../src/providers/tiger-manifest.ts');

/**
 * Files to generate checksums for
 *
 * Add new TIGER files here as needed.
 * Format: { key: string, path: string } where path is relative to TIGER base URL
 */
const TIGER_FILES_2024: readonly { key: string; path: string }[] = [
  // National files
  { key: 'cd119', path: '/CD/tl_2024_us_cd119.zip' },
  { key: 'county', path: '/COUNTY/tl_2024_us_county.zip' },
  { key: 'state', path: '/STATE/tl_2024_us_state.zip' },
  { key: 'aiannh', path: '/AIANNH/tl_2024_us_aiannh.zip' },
  { key: 'cbsa', path: '/CBSA/tl_2024_us_cbsa.zip' },
  { key: 'mil', path: '/MIL/tl_2024_us_mil.zip' },
  { key: 'zcta520', path: '/ZCTA520/tl_2024_us_zcta520.zip' },
  { key: 'uac', path: '/UAC/tl_2024_us_uac.zip' },
];

const TIGER_FILES_2023: readonly { key: string; path: string }[] = [
  { key: 'cd118', path: '/CD/tl_2023_us_cd118.zip' },
  { key: 'county', path: '/COUNTY/tl_2023_us_county.zip' },
  { key: 'state', path: '/STATE/tl_2023_us_state.zip' },
];

// ============================================================================
// Types
// ============================================================================

interface ChecksumResult {
  key: string;
  sha256: string;
  size: number;
  url: string;
  success: boolean;
  error?: string;
}

interface GeneratorOptions {
  vintage: string;
  fileKey?: string;
  dryRun: boolean;
  verifyOnly: boolean;
  timeout: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Compute SHA-256 checksum of data
 */
function computeSHA256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Download file and compute checksum
 */
async function downloadAndHash(
  url: string,
  timeout: number
): Promise<{ sha256: string; size: number }> {
  console.log(`  Downloading: ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'VOTER-Protocol/1.0 (Shadow Atlas Manifest Generator)',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = Buffer.from(await response.arrayBuffer());
    const sha256 = computeSHA256(data);

    console.log(`  Downloaded: ${data.length} bytes`);
    console.log(`  SHA-256:    ${sha256}`);

    return { sha256, size: data.length };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Generate checksums for a vintage
 */
async function generateChecksums(options: GeneratorOptions): Promise<ChecksumResult[]> {
  const { vintage, fileKey, timeout } = options;

  const baseUrl = `https://www2.census.gov/geo/tiger/TIGER${vintage}`;
  const files = vintage === '2024' ? TIGER_FILES_2024 : TIGER_FILES_2023;

  // Filter to specific file if requested
  const filesToProcess = fileKey ? files.filter((f) => f.key === fileKey) : files;

  if (fileKey && filesToProcess.length === 0) {
    console.error(`Error: File key '${fileKey}' not found in manifest`);
    process.exit(1);
  }

  console.log(`\nGenerating checksums for TIGER ${vintage}`);
  console.log(`Files to process: ${filesToProcess.length}`);
  console.log('='.repeat(60));

  const results: ChecksumResult[] = [];

  for (const file of filesToProcess) {
    const url = `${baseUrl}${file.path}`;
    console.log(`\n[${file.key}]`);

    try {
      const { sha256, size } = await downloadAndHash(url, timeout);

      results.push({
        key: file.key,
        sha256,
        size,
        url,
        success: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ERROR: ${errorMessage}`);

      results.push({
        key: file.key,
        sha256: '',
        size: 0,
        url,
        success: false,
        error: errorMessage,
      });
    }
  }

  return results;
}

/**
 * Format results as manifest entries
 */
function formatManifestEntries(results: ChecksumResult[]): string {
  const entries = results
    .filter((r) => r.success)
    .map((r) => {
      return `    ${r.key}: {
      path: '${r.url.split('/').pop()}',
      sha256: '${r.sha256}',
      size: ${r.size},
      url: '${r.url}',
      verifiedAt: '${new Date().toISOString()}',
    }`;
    });

  return entries.join(',\n');
}

/**
 * Update manifest file with new checksums
 */
async function updateManifestFile(
  results: ChecksumResult[],
  vintage: string
): Promise<void> {
  const manifestContent = await fs.readFile(MANIFEST_PATH, 'utf-8');

  // This is a simple update - in production, use proper AST manipulation
  let updatedContent = manifestContent;

  for (const result of results) {
    if (!result.success) continue;

    // Update sha256 value
    const sha256Pattern = new RegExp(
      `(${result.key}:\\s*{[^}]*sha256:\\s*)'[^']*'`,
      'g'
    );
    updatedContent = updatedContent.replace(sha256Pattern, `$1'${result.sha256}'`);

    // Update size value
    const sizePattern = new RegExp(
      `(${result.key}:\\s*{[^}]*size:\\s*)\\d+`,
      'g'
    );
    updatedContent = updatedContent.replace(sizePattern, `$1${result.size}`);
  }

  await fs.writeFile(MANIFEST_PATH, updatedContent);
  console.log(`\nManifest updated: ${MANIFEST_PATH}`);
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(): GeneratorOptions {
  const args = process.argv.slice(2);

  const options: GeneratorOptions = {
    vintage: '2024',
    dryRun: false,
    verifyOnly: false,
    timeout: 300000, // 5 minutes
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--vintage' && args[i + 1]) {
      options.vintage = args[++i];
    } else if (arg === '--file' && args[i + 1]) {
      options.fileKey = args[++i];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--verify-only') {
      options.verifyOnly = true;
    } else if (arg === '--timeout' && args[i + 1]) {
      options.timeout = parseInt(args[++i], 10);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Generate TIGER Manifest Checksums

Downloads TIGER files from Census Bureau and computes SHA-256 checksums.

USAGE:
  npx tsx scripts/generate-tiger-manifest.ts [options]

OPTIONS:
  --vintage <year>   TIGER vintage year (default: 2024)
  --file <key>       Only generate checksum for specific file (e.g., county)
  --dry-run          Print checksums without updating manifest file
  --verify-only      Only verify existing checksums against manifest
  --timeout <ms>     Download timeout in milliseconds (default: 300000)
  --help, -h         Show this help message

EXAMPLES:
  # Generate all 2024 checksums
  npx tsx scripts/generate-tiger-manifest.ts

  # Generate only county checksum
  npx tsx scripts/generate-tiger-manifest.ts --file county

  # Dry run - print checksums without updating
  npx tsx scripts/generate-tiger-manifest.ts --dry-run

  # Generate 2023 checksums
  npx tsx scripts/generate-tiger-manifest.ts --vintage 2023
`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('TIGER Manifest Checksum Generator');
  console.log('='.repeat(60));

  const options = parseArgs();

  console.log(`\nConfiguration:`);
  console.log(`  Vintage:     ${options.vintage}`);
  console.log(`  File:        ${options.fileKey ?? 'all'}`);
  console.log(`  Dry run:     ${options.dryRun}`);
  console.log(`  Verify only: ${options.verifyOnly}`);
  console.log(`  Timeout:     ${options.timeout}ms`);

  if (options.verifyOnly) {
    console.log('\n[verify-only mode not yet implemented]');
    console.log('Run without --verify-only to generate checksums.');
    return;
  }

  const results = await generateChecksums(options);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`  Successful: ${successful.length}`);
  console.log(`  Failed:     ${failed.length}`);

  if (failed.length > 0) {
    console.log('\nFailed files:');
    for (const f of failed) {
      console.log(`  - ${f.key}: ${f.error}`);
    }
  }

  // Output manifest entries
  console.log('\n' + '='.repeat(60));
  console.log('MANIFEST ENTRIES');
  console.log('='.repeat(60));
  console.log('\nAdd these entries to tiger-manifest.ts:\n');
  console.log(formatManifestEntries(results));

  // Update manifest file unless dry run
  if (!options.dryRun && successful.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('UPDATING MANIFEST FILE');
    console.log('='.repeat(60));

    try {
      await updateManifestFile(results, options.vintage);
      console.log('\nManifest file updated successfully!');
    } catch (error) {
      console.error(`\nFailed to update manifest: ${error}`);
      console.log('\nPlease manually update the manifest with the entries above.');
    }
  }

  if (options.dryRun) {
    console.log('\n[Dry run - manifest not updated]');
  }

  console.log('\nDone!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
