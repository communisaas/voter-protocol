#!/usr/bin/env tsx
/**
 * Verify round-trip fidelity: TypeScript → NDJSON → TypeScript
 *
 * Ensures no data loss during migration by comparing:
 * 1. Original TypeScript registry (pre-migration backup)
 * 2. Generated TypeScript (from NDJSON source)
 *
 * Checks:
 * - Portal count matches
 * - All FIPS codes present
 * - Critical fields preserved (cityName, state, featureCount, etc.)
 * - URLs intact
 * - Confidence scores preserved
 *
 * Usage: npm run verify:roundtrip
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');

interface PortalEntry {
  cityFips: string;
  cityName: string;
  state: string;
  portalType: string;
  downloadUrl: string;
  featureCount: number;
  lastVerified: string;
  confidence: number;
  discoveredBy: string;
  notes?: string;
}

interface ComparisonResult {
  passed: boolean;
  totalOriginal: number;
  totalGenerated: number;
  missingFips: string[];
  extraFips: string[];
  fieldMismatches: Array<{
    fips: string;
    field: string;
    original: unknown;
    generated: unknown;
  }>;
}

function parseTypescriptRegistry(filePath: string): Map<string, PortalEntry> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const entries = new Map<string, PortalEntry>();

  // Extract portal entries using regex
  const entryPattern = /'(\d{7})':\s*{([^}]+)}/gs;
  let match;

  while ((match = entryPattern.exec(content)) !== null) {
    const cityFips = match[1];
    const entryContent = match[2];

    const entry: Partial<PortalEntry> = { cityFips };

    // Parse fields
    const patterns = {
      cityName: /cityName:\s*'([^']+)'/,
      state: /state:\s*'([^']+)'/,
      portalType: /portalType:\s*'([^']+)'/,
      downloadUrl: /downloadUrl:\s*'([^']+)'/,
      featureCount: /featureCount:\s*(\d+)/,
      lastVerified: /lastVerified:\s*'([^']+)'/,
      confidence: /confidence:\s*(\d+)/,
      discoveredBy: /discoveredBy:\s*'([^']+)'/,
      notes: /notes:\s*'([^']+)'/,
    };

    Object.entries(patterns).forEach(([key, pattern]) => {
      const fieldMatch = entryContent.match(pattern);
      if (fieldMatch) {
        const value = fieldMatch[1];
        if (key === 'featureCount' || key === 'confidence') {
          (entry as Record<string, unknown>)[key] = parseInt(value, 10);
        } else {
          (entry as Record<string, unknown>)[key] = value;
        }
      }
    });

    if (entry.cityName && entry.state) {
      entries.set(cityFips, entry as PortalEntry);
    }
  }

  return entries;
}

function compareEntries(
  original: Map<string, PortalEntry>,
  generated: Map<string, PortalEntry>
): ComparisonResult {
  const result: ComparisonResult = {
    passed: true,
    totalOriginal: original.size,
    totalGenerated: generated.size,
    missingFips: [],
    extraFips: [],
    fieldMismatches: [],
  };

  // Check for missing FIPS codes
  for (const fips of original.keys()) {
    if (!generated.has(fips)) {
      result.missingFips.push(fips);
      result.passed = false;
    }
  }

  // Check for extra FIPS codes
  for (const fips of generated.keys()) {
    if (!original.has(fips)) {
      result.extraFips.push(fips);
      result.passed = false;
    }
  }

  // Compare field values for matching entries
  const criticalFields: Array<keyof PortalEntry> = [
    'cityName',
    'state',
    'portalType',
    'downloadUrl',
    'featureCount',
    'confidence',
    'discoveredBy',
  ];

  for (const [fips, originalEntry] of original) {
    const generatedEntry = generated.get(fips);
    if (!generatedEntry) continue;

    for (const field of criticalFields) {
      const originalValue = originalEntry[field];
      const generatedValue = generatedEntry[field];

      if (originalValue !== generatedValue) {
        result.fieldMismatches.push({
          fips,
          field,
          original: originalValue,
          generated: generatedValue,
        });
        result.passed = false;
      }
    }
  }

  return result;
}

function printResults(name: string, result: ComparisonResult): void {
  console.log(`\n📊 ${name} Comparison:`);
  console.log(`   Original: ${result.totalOriginal} entries`);
  console.log(`   Generated: ${result.totalGenerated} entries`);

  if (result.missingFips.length > 0) {
    console.log(`\n   ❌ Missing FIPS codes (${result.missingFips.length}):`);
    result.missingFips.slice(0, 10).forEach((fips) => {
      console.log(`      - ${fips}`);
    });
    if (result.missingFips.length > 10) {
      console.log(`      ... and ${result.missingFips.length - 10} more`);
    }
  }

  if (result.extraFips.length > 0) {
    console.log(`\n   ⚠️  Extra FIPS codes (${result.extraFips.length}):`);
    result.extraFips.slice(0, 10).forEach((fips) => {
      console.log(`      - ${fips}`);
    });
    if (result.extraFips.length > 10) {
      console.log(`      ... and ${result.extraFips.length - 10} more`);
    }
  }

  if (result.fieldMismatches.length > 0) {
    console.log(`\n   ❌ Field mismatches (${result.fieldMismatches.length}):`);
    result.fieldMismatches.slice(0, 10).forEach((mismatch) => {
      console.log(`      - ${mismatch.fips}.${mismatch.field}:`);
      console.log(`        Original:  ${JSON.stringify(mismatch.original)}`);
      console.log(`        Generated: ${JSON.stringify(mismatch.generated)}`);
    });
    if (result.fieldMismatches.length > 10) {
      console.log(`      ... and ${result.fieldMismatches.length - 10} more mismatches`);
    }
  }

  if (result.passed) {
    console.log('\n   ✅ Perfect round-trip fidelity!');
  } else {
    console.log('\n   ❌ Round-trip fidelity issues detected');
  }
}

async function main(): Promise<void> {
  console.log('🔍 Verifying round-trip fidelity...\n');

  const registryDir = path.join(REPO_ROOT, 'src/core/registry');

  // Check for backup files
  const backupDir = path.join(REPO_ROOT, 'archive/pre-ndjson-migration');
  const useBackup = fs.existsSync(backupDir);

  const originalKnownPath = useBackup
    ? path.join(backupDir, 'known-portals.ts')
    : path.join(registryDir, 'known-portals.ts.backup');

  const originalQuarantinedPath = useBackup
    ? path.join(backupDir, 'quarantined-portals.ts')
    : path.join(registryDir, 'quarantined-portals.ts.backup');

  if (!fs.existsSync(originalKnownPath) && !fs.existsSync(originalQuarantinedPath)) {
    console.error('❌ No backup files found for comparison.');
    console.error('   Expected either:');
    console.error(`     - ${backupDir}/known-portals.ts`);
    console.error(`     - ${registryDir}/known-portals.ts.backup`);
    console.error('\n   Create backups before running migration.');
    process.exit(1);
  }

  let allPassed = true;

  // Compare known-portals.ts
  if (fs.existsSync(originalKnownPath)) {
    console.log('📋 Comparing known-portals.ts...');
    const originalKnown = parseTypescriptRegistry(originalKnownPath);
    const generatedKnown = parseTypescriptRegistry(
      path.join(registryDir, 'known-portals.ts')
    );

    const knownResult = compareEntries(originalKnown, generatedKnown);
    printResults('Known Portals', knownResult);

    if (!knownResult.passed) {
      allPassed = false;
    }
  }

  // Compare quarantined-portals.ts
  if (fs.existsSync(originalQuarantinedPath)) {
    console.log('\n📋 Comparing quarantined-portals.ts...');
    const originalQuarantined = parseTypescriptRegistry(originalQuarantinedPath);
    const generatedQuarantined = parseTypescriptRegistry(
      path.join(registryDir, 'quarantined-portals.ts')
    );

    const quarantinedResult = compareEntries(originalQuarantined, generatedQuarantined);
    printResults('Quarantined Portals', quarantinedResult);

    if (!quarantinedResult.passed) {
      allPassed = false;
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  if (allPassed) {
    console.log('✨ Round-trip verification PASSED!');
    console.log('   All data preserved through NDJSON migration.');
    console.log('   Safe to commit NDJSON source + generated TypeScript.');
    process.exit(0);
  } else {
    console.log('❌ Round-trip verification FAILED!');
    console.log('   Data loss or corruption detected.');
    console.log('\n   Action required:');
    console.log('   1. Review migration logic in migrate-to-ndjson.ts');
    console.log('   2. Check NDJSON parsing in generate-typescript.ts');
    console.log('   3. Fix issues and re-run migration');
    console.log('   4. Verify again with: npm run verify:roundtrip');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Verification failed:', error);
  process.exit(1);
});
