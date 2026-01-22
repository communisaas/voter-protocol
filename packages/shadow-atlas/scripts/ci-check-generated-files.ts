#!/usr/bin/env npx tsx
/**
 * CI Check: Verify generated files are up-to-date with NDJSON sources
 *
 * PURPOSE: Prevent manual edits to generated files by ensuring they
 * match what would be generated from the NDJSON source files.
 *
 * WORKFLOW:
 * 1. Store current generated file hashes
 * 2. Regenerate TypeScript from NDJSON
 * 3. Compare hashes
 * 4. Fail if any differences (someone edited generated files directly)
 *
 * USAGE:
 *   npx tsx scripts/ci-check-generated-files.ts
 *   npm run registry:ci-check
 *
 * EXIT CODES:
 *   0 - Generated files are up-to-date
 *   1 - Generated files are out of sync (need regeneration)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const GENERATED_DIR = join(ROOT_DIR, 'src', 'core', 'registry');

const GENERATED_FILES = [
  'known-portals.generated.ts',
  'quarantined-portals.generated.ts',
  'at-large-cities.generated.ts',
];

/**
 * Calculate SHA-256 hash of a file, ignoring timestamp lines
 */
async function hashFile(filepath: string): Promise<string> {
  const content = await readFile(filepath, 'utf-8');

  // Remove timestamp lines for comparison (they change on every generation)
  const normalizedContent = content
    .split('\n')
    .filter((line) => !line.includes('Generated:') && !line.includes('_extracted'))
    .join('\n');

  return createHash('sha256').update(normalizedContent).digest('hex');
}

async function main(): Promise<void> {
  console.log('CI Check: Verifying generated files are up-to-date...\n');

  // Step 1: Store current hashes
  const beforeHashes: Record<string, string> = {};
  for (const file of GENERATED_FILES) {
    try {
      beforeHashes[file] = await hashFile(join(GENERATED_DIR, file));
    } catch (error) {
      console.log(`  ⚠ File not found: ${file}`);
      beforeHashes[file] = 'NOT_FOUND';
    }
  }

  // Step 2: Regenerate from NDJSON
  console.log('Regenerating files from NDJSON...');
  try {
    execSync('npm run registry:generate', {
      cwd: ROOT_DIR,
      stdio: 'pipe',
    });
  } catch (error) {
    console.error('Failed to regenerate files:', error);
    process.exit(1);
  }

  // Step 3: Compare hashes
  const afterHashes: Record<string, string> = {};
  for (const file of GENERATED_FILES) {
    try {
      afterHashes[file] = await hashFile(join(GENERATED_DIR, file));
    } catch (error) {
      afterHashes[file] = 'NOT_FOUND';
    }
  }

  // Step 4: Report results
  let hasChanges = false;
  console.log('\nResults:');

  for (const file of GENERATED_FILES) {
    const before = beforeHashes[file];
    const after = afterHashes[file];

    if (before === 'NOT_FOUND' && after !== 'NOT_FOUND') {
      console.log(`  ✗ ${file} - NEW (needs to be committed)`);
      hasChanges = true;
    } else if (before !== 'NOT_FOUND' && after === 'NOT_FOUND') {
      console.log(`  ✗ ${file} - DELETED (regeneration failed)`);
      hasChanges = true;
    } else if (before !== after) {
      console.log(`  ✗ ${file} - OUT OF SYNC`);
      console.log(`    Before: ${before.slice(0, 16)}...`);
      console.log(`    After:  ${after.slice(0, 16)}...`);
      hasChanges = true;
    } else {
      console.log(`  ✓ ${file} - up-to-date`);
    }
  }

  if (hasChanges) {
    console.log('\n❌ CI CHECK FAILED');
    console.log('');
    console.log('Generated files are out of sync with NDJSON sources.');
    console.log('');
    console.log('If you edited the NDJSON files, run:');
    console.log('  npm run registry:generate');
    console.log('');
    console.log('Then commit the updated generated files.');
    console.log('');
    console.log('DO NOT edit the .generated.ts files directly!');
    console.log('Edit the NDJSON source files instead.');
    process.exit(1);
  }

  console.log('\n✓ CI CHECK PASSED');
  console.log('Generated files are in sync with NDJSON sources.');
}

main().catch((error) => {
  console.error('CI check failed:', error);
  process.exit(1);
});
