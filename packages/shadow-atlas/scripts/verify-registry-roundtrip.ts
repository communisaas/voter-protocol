#!/usr/bin/env npx tsx
/**
 * Verify round-trip fidelity between NDJSON and generated TypeScript
 *
 * PURPOSE: Ensure data integrity when converting between formats
 *
 * CHECKS:
 * 1. Entry counts match between NDJSON source and generated TypeScript
 * 2. All FIPS keys are present in both
 * 3. Critical fields have identical values
 *
 * USAGE:
 *   npx tsx scripts/verify-registry-roundtrip.ts
 *   npm run registry:verify
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const NDJSON_DIR = join(ROOT_DIR, 'data', 'registries');
const GENERATED_DIR = join(ROOT_DIR, 'src', 'core', 'registry');

interface VerificationResult {
  file: string;
  ndjsonCount: number;
  generatedCount: number;
  matches: boolean;
  missingInGenerated: string[];
  missingInNdjson: string[];
  fieldMismatches: Array<{
    fips: string;
    field: string;
    ndjsonValue: unknown;
    generatedValue: unknown;
  }>;
}

/**
 * Parse NDJSON file and return entries as a Map
 */
async function parseNdjson(filename: string): Promise<Map<string, Record<string, unknown>>> {
  const filepath = join(NDJSON_DIR, filename);
  const content = await readFile(filepath, 'utf-8');
  const lines = content.trim().split('\n');

  const entries = new Map<string, Record<string, unknown>>();

  // Skip header (line 0)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const entry = JSON.parse(line) as Record<string, unknown>;
    const fips = entry._fips as string;
    // Remove _fips from entry for comparison (it's the key, not a data field)
    const { _fips, ...rest } = entry;
    entries.set(fips, rest);
  }

  return entries;
}

/**
 * Import generated TypeScript registry
 */
async function importGenerated(filename: string): Promise<Map<string, Record<string, unknown>>> {
  const filepath = join(GENERATED_DIR, filename);
  const module = await import(filepath);

  // Find the exported registry constant (KNOWN_PORTALS, QUARANTINED_PORTALS, or AT_LARGE_CITIES)
  const registryKey = Object.keys(module).find((k) => k.endsWith('PORTALS') || k.endsWith('CITIES'));
  if (!registryKey) {
    throw new Error(`No registry found in ${filename}`);
  }

  const registry = module[registryKey] as Record<string, Record<string, unknown>>;
  return new Map(Object.entries(registry));
}

/**
 * Compare two values for equality (deep comparison for objects/arrays)
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Verify a single registry file
 */
async function verifyRegistry(ndjsonFile: string, generatedFile: string): Promise<VerificationResult> {
  const ndjsonEntries = await parseNdjson(ndjsonFile);
  const generatedEntries = await importGenerated(generatedFile);

  const result: VerificationResult = {
    file: ndjsonFile,
    ndjsonCount: ndjsonEntries.size,
    generatedCount: generatedEntries.size,
    matches: true,
    missingInGenerated: [],
    missingInNdjson: [],
    fieldMismatches: [],
  };

  // Check for missing entries
  for (const fips of ndjsonEntries.keys()) {
    if (!generatedEntries.has(fips)) {
      result.missingInGenerated.push(fips);
      result.matches = false;
    }
  }

  for (const fips of generatedEntries.keys()) {
    if (!ndjsonEntries.has(fips)) {
      result.missingInNdjson.push(fips);
      result.matches = false;
    }
  }

  // Check field values for entries that exist in both
  for (const [fips, ndjsonEntry] of ndjsonEntries) {
    const generatedEntry = generatedEntries.get(fips);
    if (!generatedEntry) continue;

    for (const [field, ndjsonValue] of Object.entries(ndjsonEntry)) {
      const generatedValue = generatedEntry[field];

      if (!valuesEqual(ndjsonValue, generatedValue)) {
        result.fieldMismatches.push({
          fips,
          field,
          ndjsonValue,
          generatedValue,
        });
        result.matches = false;
      }
    }
  }

  return result;
}

async function main(): Promise<void> {
  console.log('Verifying registry round-trip fidelity...\n');

  const registries = [
    { ndjson: 'known-portals.ndjson', generated: 'known-portals.generated.ts' },
    { ndjson: 'quarantined-portals.ndjson', generated: 'quarantined-portals.generated.ts' },
    { ndjson: 'at-large-cities.ndjson', generated: 'at-large-cities.generated.ts' },
  ];

  let allPassed = true;

  for (const { ndjson, generated } of registries) {
    try {
      const result = await verifyRegistry(ndjson, generated);

      const status = result.matches ? '✓' : '✗';
      console.log(`${status} ${ndjson}`);
      console.log(`  NDJSON: ${result.ndjsonCount} entries`);
      console.log(`  Generated: ${result.generatedCount} entries`);

      if (!result.matches) {
        allPassed = false;

        if (result.missingInGenerated.length > 0) {
          console.log(`  Missing in generated: ${result.missingInGenerated.slice(0, 5).join(', ')}${result.missingInGenerated.length > 5 ? '...' : ''}`);
        }

        if (result.missingInNdjson.length > 0) {
          console.log(`  Missing in NDJSON: ${result.missingInNdjson.slice(0, 5).join(', ')}${result.missingInNdjson.length > 5 ? '...' : ''}`);
        }

        if (result.fieldMismatches.length > 0) {
          console.log(`  Field mismatches: ${result.fieldMismatches.length}`);
          for (const mismatch of result.fieldMismatches.slice(0, 3)) {
            console.log(`    ${mismatch.fips}.${mismatch.field}: ${JSON.stringify(mismatch.ndjsonValue)} !== ${JSON.stringify(mismatch.generatedValue)}`);
          }
        }
      }

      console.log('');
    } catch (error) {
      console.log(`✗ ${ndjson}`);
      console.log(`  Error: ${error instanceof Error ? error.message : String(error)}`);
      console.log('');
      allPassed = false;
    }
  }

  if (allPassed) {
    console.log('All registries verified successfully!');
  } else {
    console.log('Some registries failed verification.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Verification failed:', error);
  process.exit(1);
});
