#!/usr/bin/env tsx
/**
 * Build Output Validator — Chunked Atlas Pipeline Quality Gate
 *
 * Validates the output directory produced by build-chunked-mapping.ts and
 * export-officials.ts before data is pinned to IPFS. Runs 7 checks that
 * must ALL PASS to proceed.
 *
 * Usage:
 *   tsx scripts/validate-build.ts <outputDir> [--country US] [--strict] [--json]
 *
 * Options:
 *   outputDir     Path to the build output directory (e.g., ./output)
 *   --country     Which country to validate (default: US, can be repeated)
 *   --strict      Fail on warnings (not just errors)
 *   --json        Output results as JSON instead of human-readable
 *
 * Exit codes:
 *   0  All checks passed
 *   1  One or more checks failed
 *   2  Usage error (bad arguments, missing directory)
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { cellToParent } from 'h3-js';
import { US_JURISDICTION, PROTOCOL_DISTRICT_SLOTS } from '../src/jurisdiction.js';

// ============================================================================
// ANSI Color Codes
// ============================================================================

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

// ============================================================================
// Types
// ============================================================================

interface ChunkFile {
  version: 1;
  country: string;
  layer: string;
  parentCell: string;
  resolution: number;
  cells: Record<string, (string | null)[]>;
}

interface ManifestFile {
  version: 1;
  generated: string;
  country: string;
  totalCells: number;
  totalChunks: number;
  resolution: number;
  slotNames: Record<number, string>;
  chunks: Record<string, ChunkManifestEntry>;
  officials?: {
    total_districts: number;
    total_officials: number;
    entries: OfficialManifestEntry[];
  };
}

interface ChunkManifestEntry {
  path: string;
  cellCount: number;
  sha256: string;
}

interface OfficialManifestEntry {
  file: string;
  district_code: string;
  official_count: number;
  sha256: string;
}

interface OfficialsFile {
  version: 1;
  country: string;
  district_code: string;
  officials: unknown[];
  generated: string;
}

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: Record<string, unknown>;
}

interface ValidationResult {
  timestamp: string;
  outputDir: string;
  countries: string[];
  checks: CheckResult[];
  passed: boolean;
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(argv: string[]): {
  outputDir: string;
  countries: string[];
  strict: boolean;
  json: boolean;
} {
  const args = argv.slice(2);
  let outputDir = '';
  const countries: string[] = [];
  let strict = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--country') {
      const val = args[++i];
      if (!val) {
        printUsageAndExit('--country requires a value');
      }
      countries.push(val);
    } else if (arg === '--strict') {
      strict = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg.startsWith('-')) {
      printUsageAndExit(`Unknown flag: ${arg}`);
    } else if (!outputDir) {
      outputDir = arg;
    } else {
      printUsageAndExit(`Unexpected argument: ${arg}`);
    }
  }

  if (!outputDir) {
    printUsageAndExit('Missing required argument: outputDir');
  }

  if (countries.length === 0) {
    countries.push('US');
  }

  return { outputDir: resolve(outputDir), countries, strict, json };
}

function printUsageAndExit(error: string): never {
  console.error(`Error: ${error}\n`);
  console.error('Usage: tsx scripts/validate-build.ts <outputDir> [--country US] [--strict] [--json]');
  process.exit(2);
}

// ============================================================================
// Utility Helpers
// ============================================================================

/** Compute SHA-256 hex digest of a file's contents. */
function sha256File(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/** Safely parse JSON from a file path. Returns null on failure. */
function safeParseJsonFile<T>(filePath: string): { data: T | null; error: string | null } {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return { data: JSON.parse(raw) as T, error: null };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

/**
 * Map country CLI code to directory name.
 * The output directory uses 2-letter codes (US, CA, etc.).
 */
function countryDir(country: string): string {
  return country.toUpperCase();
}

/**
 * Expected US cell count from the last known build.
 * Used for deviation warnings in Check 3.
 */
const EXPECTED_US_CELLS = 1_883_843;

/** Deviation threshold for cell count warning (5%). */
const DEVIATION_THRESHOLD = 0.05;

// ============================================================================
// Check 1: Manifest Integrity
// ============================================================================

function checkManifestIntegrity(
  outputDir: string,
  country: string,
): CheckResult {
  const name = 'Manifest Integrity';
  const manifestPath = join(outputDir, countryDir(country), 'manifest.json');

  if (!existsSync(manifestPath)) {
    return {
      name,
      status: 'fail',
      message: `Manifest not found: ${manifestPath}`,
    };
  }

  const { data: manifest, error } = safeParseJsonFile<ManifestFile>(manifestPath);
  if (error || !manifest) {
    return {
      name,
      status: 'fail',
      message: `Manifest is not valid JSON: ${error}`,
    };
  }

  const failures: string[] = [];

  if (manifest.version !== 1) {
    failures.push(`Expected version 1, got ${manifest.version}`);
  }
  if (typeof manifest.totalCells !== 'number' || manifest.totalCells <= 0) {
    failures.push(`totalCells must be > 0, got ${manifest.totalCells}`);
  }
  if (typeof manifest.totalChunks !== 'number' || manifest.totalChunks <= 0) {
    failures.push(`totalChunks must be > 0, got ${manifest.totalChunks}`);
  }

  // Validate every chunk entry has required fields
  const chunkEntries = Object.entries(manifest.chunks ?? {});
  let missingFields = 0;
  let missingFiles = 0;
  const missingFilePaths: string[] = [];

  for (const [key, entry] of chunkEntries) {
    if (!entry.path || typeof entry.path !== 'string') {
      missingFields++;
      continue;
    }
    if (typeof entry.cellCount !== 'number') {
      missingFields++;
      continue;
    }
    if (!entry.sha256 || typeof entry.sha256 !== 'string') {
      missingFields++;
      continue;
    }

    // Check the chunk file actually exists on disk
    const chunkPath = join(outputDir, countryDir(country), entry.path);
    if (!existsSync(chunkPath)) {
      missingFiles++;
      if (missingFilePaths.length < 5) {
        missingFilePaths.push(entry.path);
      }
    }
  }

  if (missingFields > 0) {
    failures.push(`${missingFields} chunk entries missing required fields (path, cellCount, sha256)`);
  }
  if (missingFiles > 0) {
    failures.push(`${missingFiles} chunk files listed in manifest do not exist on disk (e.g., ${missingFilePaths.join(', ')})`);
  }

  if (failures.length > 0) {
    return {
      name,
      status: 'fail',
      message: failures.join('; '),
      details: { chunkCount: chunkEntries.length, failures },
    };
  }

  return {
    name,
    status: 'pass',
    message: `Manifest valid: ${chunkEntries.length} chunks, ${manifest.totalCells} cells`,
    details: {
      totalCells: manifest.totalCells,
      totalChunks: manifest.totalChunks,
      chunkEntriesCount: chunkEntries.length,
    },
  };
}

// ============================================================================
// Check 2: Chunk Checksums
// ============================================================================

function checkChunkChecksums(
  outputDir: string,
  country: string,
  manifest: ManifestFile,
): CheckResult {
  const name = 'Chunk Checksums';
  const chunkEntries = Object.entries(manifest.chunks);
  let verified = 0;
  let mismatches = 0;
  const mismatchDetails: string[] = [];

  for (const [key, entry] of chunkEntries) {
    const chunkPath = join(outputDir, countryDir(country), entry.path);
    if (!existsSync(chunkPath)) {
      // Already caught by Check 1 — skip silently here
      continue;
    }

    const actual = sha256File(chunkPath);
    if (actual !== entry.sha256) {
      mismatches++;
      if (mismatchDetails.length < 5) {
        mismatchDetails.push(
          `${entry.path}: expected ${entry.sha256.slice(0, 12)}..., got ${actual.slice(0, 12)}...`,
        );
      }
    } else {
      verified++;
    }
  }

  if (mismatches > 0) {
    return {
      name,
      status: 'fail',
      message: `${mismatches} checksum mismatch(es) — data corruption or stale manifest`,
      details: { verified, mismatches, examples: mismatchDetails },
    };
  }

  return {
    name,
    status: 'pass',
    message: `All ${verified} chunk checksums verified`,
    details: { verified },
  };
}

// ============================================================================
// Check 3: Coverage Completeness
// ============================================================================

function checkCoverageCompleteness(
  outputDir: string,
  country: string,
  manifest: ManifestFile,
): CheckResult {
  const name = 'Coverage Completeness';
  const allCells = new Set<string>();
  const duplicates: string[] = [];
  let totalFromChunks = 0;

  const chunkEntries = Object.entries(manifest.chunks);

  for (const [, entry] of chunkEntries) {
    const chunkPath = join(outputDir, countryDir(country), entry.path);
    if (!existsSync(chunkPath)) continue;

    const { data: chunk } = safeParseJsonFile<ChunkFile>(chunkPath);
    if (!chunk || !chunk.cells) continue;

    const cellIds = Object.keys(chunk.cells);
    totalFromChunks += cellIds.length;

    for (const cellId of cellIds) {
      if (allCells.has(cellId)) {
        if (duplicates.length < 10) {
          duplicates.push(cellId);
        }
      } else {
        allCells.add(cellId);
      }
    }
  }

  const failures: string[] = [];
  const warnings: string[] = [];

  if (duplicates.length > 0) {
    failures.push(`${duplicates.length}+ duplicate cell(s) found across chunks (e.g., ${duplicates.slice(0, 3).join(', ')})`);
  }

  if (allCells.size !== manifest.totalCells) {
    failures.push(
      `Cell count mismatch: manifest says ${manifest.totalCells}, actual unique cells = ${allCells.size}`,
    );
  }

  // US-specific deviation check
  if (country.toUpperCase() === 'US') {
    const deviation = Math.abs(allCells.size - EXPECTED_US_CELLS) / EXPECTED_US_CELLS;
    if (deviation > DEVIATION_THRESHOLD) {
      warnings.push(
        `Cell count ${allCells.size} deviates ${(deviation * 100).toFixed(1)}% from expected ${EXPECTED_US_CELLS}`,
      );
    }
  }

  if (failures.length > 0) {
    return {
      name,
      status: 'fail',
      message: failures.join('; '),
      details: { uniqueCells: allCells.size, manifestTotal: manifest.totalCells, duplicateExamples: duplicates.slice(0, 5) },
    };
  }

  if (warnings.length > 0) {
    return {
      name,
      status: 'warn',
      message: warnings.join('; '),
      details: { uniqueCells: allCells.size, manifestTotal: manifest.totalCells },
    };
  }

  return {
    name,
    status: 'pass',
    message: `${allCells.size} unique cells, no duplicates, matches manifest totalCells`,
    details: { uniqueCells: allCells.size },
  };
}

// ============================================================================
// Check 4: Chunk Format Validation
// ============================================================================

function checkChunkFormat(
  outputDir: string,
  country: string,
  manifest: ManifestFile,
): CheckResult {
  const name = 'Chunk Format Validation';
  const chunkEntries = Object.entries(manifest.chunks);
  let chunksChecked = 0;
  const failures: string[] = [];
  let failedChunks = 0;

  for (const [, entry] of chunkEntries) {
    const chunkPath = join(outputDir, countryDir(country), entry.path);
    if (!existsSync(chunkPath)) continue;

    const { data: chunk, error } = safeParseJsonFile<ChunkFile>(chunkPath);
    if (error || !chunk) {
      failedChunks++;
      if (failures.length < 5) {
        failures.push(`${entry.path}: invalid JSON — ${error}`);
      }
      continue;
    }

    chunksChecked++;
    const chunkErrors: string[] = [];

    // Structural checks
    if (chunk.version !== 1) {
      chunkErrors.push(`version=${chunk.version}, expected 1`);
    }
    if (!chunk.country) {
      chunkErrors.push('missing country');
    }
    if (!chunk.layer) {
      chunkErrors.push('missing layer');
    }
    if (!chunk.parentCell) {
      chunkErrors.push('missing parentCell');
    }
    if (chunk.resolution !== 7) {
      chunkErrors.push(`resolution=${chunk.resolution}, expected 7`);
    }

    // Cell-level checks
    const cellEntries = Object.entries(chunk.cells ?? {});
    let slotViolations = 0;
    let parentMismatches = 0;
    let nullOnlyCells = 0;

    for (const [cellId, slots] of cellEntries) {
      // Check slot count
      if (!Array.isArray(slots) || slots.length !== PROTOCOL_DISTRICT_SLOTS) {
        slotViolations++;
        continue;
      }

      // Check H3 parent
      try {
        const parent = cellToParent(cellId, 3);
        if (parent !== chunk.parentCell) {
          parentMismatches++;
        }
      } catch {
        // cellToParent may throw on invalid H3 — count as parent mismatch
        parentMismatches++;
      }

      // Check for null-only cells
      const hasNonNull = slots.some((s) => s !== null);
      if (!hasNonNull) {
        nullOnlyCells++;
      }
    }

    if (slotViolations > 0) {
      chunkErrors.push(`${slotViolations} cell(s) don't have exactly ${PROTOCOL_DISTRICT_SLOTS} slots`);
    }
    if (parentMismatches > 0) {
      chunkErrors.push(`${parentMismatches} cell(s) have H3 res-3 parent != chunk parentCell "${chunk.parentCell}"`);
    }
    if (nullOnlyCells > 0) {
      chunkErrors.push(`${nullOnlyCells} cell(s) have all-null slots (should have been filtered)`);
    }

    if (chunkErrors.length > 0) {
      failedChunks++;
      if (failures.length < 10) {
        failures.push(`${entry.path}: ${chunkErrors.join(', ')}`);
      }
    }
  }

  if (failedChunks > 0) {
    return {
      name,
      status: 'fail',
      message: `${failedChunks} chunk(s) have format violations`,
      details: { chunksChecked, failedChunks, examples: failures },
    };
  }

  return {
    name,
    status: 'pass',
    message: `All ${chunksChecked} chunks have valid format, correct slot counts, and matching H3 parents`,
    details: { chunksChecked },
  };
}

// ============================================================================
// Check 5: Officials Completeness
// ============================================================================

function checkOfficialsCompleteness(
  outputDir: string,
  country: string,
  manifest: ManifestFile,
): CheckResult {
  const name = 'Officials Completeness';
  const officialsDir = join(outputDir, countryDir(country), 'officials');

  if (!existsSync(officialsDir)) {
    return {
      name,
      status: 'warn',
      message: 'No officials/ directory found — skipping officials validation',
    };
  }

  let entries: string[];
  try {
    entries = readdirSync(officialsDir).filter((f) => f.endsWith('.json'));
  } catch {
    return {
      name,
      status: 'fail',
      message: `Cannot read officials directory: ${officialsDir}`,
    };
  }

  if (entries.length === 0) {
    return {
      name,
      status: 'warn',
      message: 'Officials directory exists but contains no JSON files',
    };
  }

  const failures: string[] = [];
  const warnings: string[] = [];
  let validFiles = 0;
  const officialDistrictCodes = new Set<string>();

  for (const fileName of entries) {
    const filePath = join(officialsDir, fileName);
    const { data: officials, error } = safeParseJsonFile<OfficialsFile>(filePath);

    if (error || !officials) {
      failures.push(`${fileName}: invalid JSON — ${error}`);
      continue;
    }

    if (officials.version !== 1) {
      failures.push(`${fileName}: version=${officials.version}, expected 1`);
      continue;
    }
    if (!officials.country) {
      failures.push(`${fileName}: missing country`);
      continue;
    }
    if (!officials.district_code) {
      failures.push(`${fileName}: missing district_code`);
      continue;
    }
    if (!Array.isArray(officials.officials)) {
      failures.push(`${fileName}: officials is not an array`);
      continue;
    }

    if (officials.officials.length === 0) {
      warnings.push(`${fileName}: district ${officials.district_code} has 0 officials`);
    }

    officialDistrictCodes.add(officials.district_code);
    validFiles++;
  }

  // US-specific: cross-reference congressional districts (slot 0) from chunk data
  if (country.toUpperCase() === 'US') {
    const congressionalDistricts = new Set<string>();
    const chunkEntries = Object.entries(manifest.chunks);

    for (const [, entry] of chunkEntries) {
      const chunkPath = join(outputDir, countryDir(country), entry.path);
      if (!existsSync(chunkPath)) continue;

      const { data: chunk } = safeParseJsonFile<ChunkFile>(chunkPath);
      if (!chunk || !chunk.cells) continue;

      for (const [, slots] of Object.entries(chunk.cells)) {
        if (Array.isArray(slots) && slots[0] !== null && slots[0] !== undefined) {
          congressionalDistricts.add(slots[0]);
        }
      }
    }

    const missingOfficials: string[] = [];
    for (const cd of congressionalDistricts) {
      if (!officialDistrictCodes.has(cd)) {
        if (missingOfficials.length < 10) {
          missingOfficials.push(cd);
        }
      }
    }

    if (missingOfficials.length > 0) {
      warnings.push(
        `${missingOfficials.length} congressional district(s) in mapping have no officials file (e.g., ${missingOfficials.slice(0, 5).join(', ')})`,
      );
    }
  }

  if (failures.length > 0) {
    return {
      name,
      status: 'fail',
      message: `${failures.length} officials file(s) have errors`,
      details: { validFiles, totalFiles: entries.length, failures: failures.slice(0, 10), warnings: warnings.slice(0, 10) },
    };
  }

  if (warnings.length > 0) {
    return {
      name,
      status: 'warn',
      message: `${validFiles} officials files valid; ${warnings.length} warning(s)`,
      details: { validFiles, totalFiles: entries.length, warnings: warnings.slice(0, 10) },
    };
  }

  return {
    name,
    status: 'pass',
    message: `All ${validFiles} officials files valid`,
    details: { validFiles, totalFiles: entries.length, districtsCovered: officialDistrictCodes.size },
  };
}

// ============================================================================
// Check 6: Slot Alignment
// ============================================================================

function checkSlotAlignment(
  country: string,
  manifest: ManifestFile,
): CheckResult {
  const name = 'Slot Alignment';

  // Only US has a jurisdiction config to check against currently
  if (country.toUpperCase() !== 'US') {
    return {
      name,
      status: 'pass',
      message: `Slot alignment check skipped for country "${country}" (no jurisdiction config)`,
    };
  }

  const manifestSlots = manifest.slotNames;
  if (!manifestSlots || typeof manifestSlots !== 'object') {
    return {
      name,
      status: 'fail',
      message: 'Manifest is missing slotNames',
    };
  }

  const mismatches: string[] = [];
  const jurisdictionSlots = US_JURISDICTION.slots;

  // Check every slot defined in the jurisdiction config
  for (const [idxStr, slotDef] of Object.entries(jurisdictionSlots)) {
    const idx = Number(idxStr);
    const manifestName = manifestSlots[idx];
    const expectedName = slotDef.name;

    if (manifestName === undefined) {
      mismatches.push(`Slot ${idx} ("${expectedName}"): missing from manifest slotNames`);
    } else if (manifestName !== expectedName) {
      mismatches.push(`Slot ${idx}: manifest="${manifestName}", jurisdiction="${expectedName}"`);
    }
  }

  // Also check for extra slots in manifest that aren't in the jurisdiction
  for (const idxStr of Object.keys(manifestSlots)) {
    const idx = Number(idxStr);
    if (!(idx in jurisdictionSlots)) {
      mismatches.push(`Slot ${idx} ("${manifestSlots[idx]}"): present in manifest but not in US_JURISDICTION.slots`);
    }
  }

  if (mismatches.length > 0) {
    return {
      name,
      status: 'warn',
      message: `${mismatches.length} slot name mismatch(es) between manifest and US_JURISDICTION`,
      details: { mismatches },
    };
  }

  return {
    name,
    status: 'pass',
    message: `All ${Object.keys(jurisdictionSlots).length} slot names match US_JURISDICTION definition`,
    details: { slotsChecked: Object.keys(jurisdictionSlots).length },
  };
}

// ============================================================================
// Check 7: Cross-Chunk Consistency
// ============================================================================

function checkCrossChunkConsistency(
  outputDir: string,
  country: string,
  manifest: ManifestFile,
): CheckResult {
  const name = 'Cross-Chunk Consistency';
  const chunkEntries = Object.entries(manifest.chunks);
  const cellOwnership = new Map<string, string>(); // cellId → chunk path
  const crossChunkDuplicates: string[] = [];
  let cellCountMismatches = 0;
  const cellCountMismatchDetails: string[] = [];
  let totalCellsFromChunks = 0;
  let chunksChecked = 0;

  for (const [, entry] of chunkEntries) {
    const chunkPath = join(outputDir, countryDir(country), entry.path);
    if (!existsSync(chunkPath)) continue;

    const { data: chunk } = safeParseJsonFile<ChunkFile>(chunkPath);
    if (!chunk || !chunk.cells) continue;

    chunksChecked++;
    const cellIds = Object.keys(chunk.cells);
    const actualCellCount = cellIds.length;

    // Check cellCount matches actual
    if (actualCellCount !== entry.cellCount) {
      cellCountMismatches++;
      if (cellCountMismatchDetails.length < 5) {
        cellCountMismatchDetails.push(
          `${entry.path}: manifest says ${entry.cellCount}, actual ${actualCellCount}`,
        );
      }
    }

    totalCellsFromChunks += actualCellCount;

    // Check for cross-chunk duplicates
    for (const cellId of cellIds) {
      const existing = cellOwnership.get(cellId);
      if (existing !== undefined) {
        if (crossChunkDuplicates.length < 10) {
          crossChunkDuplicates.push(`${cellId} in both ${existing} and ${entry.path}`);
        }
      } else {
        cellOwnership.set(cellId, entry.path);
      }
    }
  }

  const failures: string[] = [];

  if (crossChunkDuplicates.length > 0) {
    failures.push(
      `${crossChunkDuplicates.length}+ cell(s) appear in multiple chunks (e.g., ${crossChunkDuplicates[0]})`,
    );
  }

  if (cellCountMismatches > 0) {
    failures.push(
      `${cellCountMismatches} chunk(s) have cellCount mismatch between manifest and actual data`,
    );
  }

  if (totalCellsFromChunks !== manifest.totalCells) {
    failures.push(
      `Sum of chunk cellCounts (${totalCellsFromChunks}) != manifest totalCells (${manifest.totalCells})`,
    );
  }

  if (failures.length > 0) {
    return {
      name,
      status: 'fail',
      message: failures.join('; '),
      details: {
        chunksChecked,
        totalCellsFromChunks,
        manifestTotalCells: manifest.totalCells,
        crossChunkDuplicates: crossChunkDuplicates.slice(0, 5),
        cellCountMismatchDetails,
      },
    };
  }

  return {
    name,
    status: 'pass',
    message: `${chunksChecked} chunks, ${totalCellsFromChunks} cells, clean partitioning, totals match`,
    details: { chunksChecked, totalCellsFromChunks },
  };
}

// ============================================================================
// Output Formatting
// ============================================================================

function statusIcon(status: CheckResult['status']): string {
  switch (status) {
    case 'pass':
      return `${GREEN}PASS${RESET}`;
    case 'fail':
      return `${RED}FAIL${RESET}`;
    case 'warn':
      return `${YELLOW}WARN${RESET}`;
  }
}

function printHumanResult(result: ValidationResult): void {
  console.log(`\n${BOLD}=== Build Validation ===${RESET}`);
  console.log(`${DIM}Timestamp:  ${result.timestamp}${RESET}`);
  console.log(`${DIM}Output dir: ${result.outputDir}${RESET}`);
  console.log(`${DIM}Countries:  ${result.countries.join(', ')}${RESET}`);
  console.log();

  for (const check of result.checks) {
    console.log(`  [${statusIcon(check.status)}] ${BOLD}${check.name}${RESET}`);
    console.log(`         ${check.message}`);
    if (check.status === 'fail' && check.details) {
      const detailEntries = Object.entries(check.details);
      for (const [key, value] of detailEntries) {
        if (Array.isArray(value) && value.length > 0) {
          console.log(`         ${DIM}${key}:${RESET}`);
          for (const item of value.slice(0, 5)) {
            console.log(`           ${DIM}- ${item}${RESET}`);
          }
          if (value.length > 5) {
            console.log(`           ${DIM}... and ${value.length - 5} more${RESET}`);
          }
        }
      }
    }
  }

  console.log();
  if (result.passed) {
    console.log(`${GREEN}${BOLD}ALL CHECKS PASSED${RESET} — safe to pin to IPFS`);
  } else {
    const failCount = result.checks.filter((c) => c.status === 'fail').length;
    const warnCount = result.checks.filter((c) => c.status === 'warn').length;
    console.log(
      `${RED}${BOLD}VALIDATION FAILED${RESET} — ${failCount} failure(s), ${warnCount} warning(s)`,
    );
  }
  console.log();
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const { outputDir, countries, strict, json } = parseArgs(process.argv);

  // Verify output directory exists
  if (!existsSync(outputDir)) {
    if (json) {
      console.log(JSON.stringify({ error: `Output directory does not exist: ${outputDir}` }));
    } else {
      console.error(`Error: Output directory does not exist: ${outputDir}`);
    }
    process.exit(2);
  }

  const allChecks: CheckResult[] = [];

  for (const country of countries) {
    const countryPath = join(outputDir, countryDir(country));
    if (!existsSync(countryPath)) {
      allChecks.push({
        name: `[${country}] Directory Check`,
        status: 'fail',
        message: `Country directory not found: ${countryPath}`,
      });
      continue;
    }

    // Load manifest once — several checks need it
    const manifestPath = join(countryPath, 'manifest.json');
    const { data: manifest } = safeParseJsonFile<ManifestFile>(manifestPath);

    // Check 1: Manifest Integrity
    const check1 = checkManifestIntegrity(outputDir, country);
    check1.name = `[${country}] ${check1.name}`;
    allChecks.push(check1);

    // If manifest failed to load, we can't run the remaining checks
    if (!manifest || check1.status === 'fail') {
      const skippedNames = [
        'Chunk Checksums',
        'Coverage Completeness',
        'Chunk Format Validation',
        'Officials Completeness',
        'Slot Alignment',
        'Cross-Chunk Consistency',
      ];
      for (const skipName of skippedNames) {
        allChecks.push({
          name: `[${country}] ${skipName}`,
          status: 'fail',
          message: 'Skipped — manifest is invalid or missing',
        });
      }
      continue;
    }

    // Check 2: Chunk Checksums
    const check2 = checkChunkChecksums(outputDir, country, manifest);
    check2.name = `[${country}] ${check2.name}`;
    allChecks.push(check2);

    // Check 3: Coverage Completeness
    const check3 = checkCoverageCompleteness(outputDir, country, manifest);
    check3.name = `[${country}] ${check3.name}`;
    allChecks.push(check3);

    // Check 4: Chunk Format Validation
    const check4 = checkChunkFormat(outputDir, country, manifest);
    check4.name = `[${country}] ${check4.name}`;
    allChecks.push(check4);

    // Check 5: Officials Completeness
    const check5 = checkOfficialsCompleteness(outputDir, country, manifest);
    check5.name = `[${country}] ${check5.name}`;
    allChecks.push(check5);

    // Check 6: Slot Alignment
    const check6 = checkSlotAlignment(country, manifest);
    check6.name = `[${country}] ${check6.name}`;
    allChecks.push(check6);

    // Check 7: Cross-Chunk Consistency
    const check7 = checkCrossChunkConsistency(outputDir, country, manifest);
    check7.name = `[${country}] ${check7.name}`;
    allChecks.push(check7);
  }

  // Determine overall pass/fail
  const hasFailures = allChecks.some((c) => c.status === 'fail');
  const hasWarnings = allChecks.some((c) => c.status === 'warn');
  const passed = strict ? !hasFailures && !hasWarnings : !hasFailures;

  const result: ValidationResult = {
    timestamp: new Date().toISOString(),
    outputDir,
    countries,
    checks: allChecks,
    passed,
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHumanResult(result);
  }

  process.exit(passed ? 0 : 1);
}

main();
