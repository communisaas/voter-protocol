#!/usr/bin/env tsx
/**
 * Build Output Validator — Chunked Atlas Pipeline Quality Gate
 *
 * Validates the output directory produced by build-chunked-mapping.ts and
 * export-officials.ts before data is pinned to IPFS. Runs 7 checks that
 * must ALL PASS to proceed.
 *
 * Single-pass architecture — each chunk file is read exactly once
 * (N+M+1 total reads instead of 4N+M+1).
 *
 * Usage:
 * tsx scripts/validate-build.ts <outputDir> [--country US] [--strict] [--json]
 *
 * Options:
 * outputDir Path to the build output directory (e.g.,./output)
 * --country Which country to validate (default: US, can be repeated)
 * --strict Fail on warnings (not just errors)
 * --json Output results as JSON instead of human-readable
 *
 * Exit codes:
 * 0 All checks passed
 * 1 One or more checks failed
 * 2 Usage error (bad arguments, missing directory)
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { cellToParent } from 'h3-js';
import {
  US_JURISDICTION,
  CA_JURISDICTION,
  GB_JURISDICTION,
  AU_JURISDICTION,
  NZ_JURISDICTION,
  PROTOCOL_DISTRICT_SLOTS,
} from '../src/jurisdiction.js';
import type { JurisdictionConfig } from '../src/jurisdiction.js';

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
// Security Helpers
// ============================================================================

/** Valid ISO 3166-1 alpha-2 country codes supported by the pipeline. */
const VALID_COUNTRIES = new Set(['US', 'CA', 'GB', 'AU', 'NZ']);

/** Verify resolved path stays within expectedRoot. Returns null if contained, error message if not. */
function checkContainment(resolvedPath: string, expectedRoot: string): string | null {
  const normalizedPath = resolve(resolvedPath);
  const normalizedRoot = resolve(expectedRoot);
  if (!normalizedPath.startsWith(normalizedRoot + '/') && normalizedPath !== normalizedRoot) {
    return `Path escapes build directory: ${resolvedPath}`;
  }
  return null;
}

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

/**
 * Accumulates all data from a single pass over every chunk file.
 * Used to synthesize CheckResult objects for checks 2, 3, 4, 5 (chunk part), and 7.
 */
interface ChunkAccumulator {
  // Check 2: Checksums
  sha256Verified: number;
  sha256Mismatches: number;
  sha256MismatchDetails: string[];

  // Check 3: Coverage
  allCells: Set<string>;
  duplicateCells: string[];
  totalCellsFromChunks: number;

  // Check 4: Format
  chunksChecked: number;
  failedChunks: number;
  formatFailures: string[];

  // Check 5: Primary district codes from slot[0] (all countries)
  primaryDistricts: Set<string>;

  // Check 7: Cross-chunk
  cellOwnership: Map<string, string>;
  crossChunkDuplicates: string[];
  cellCountMismatches: number;
  cellCountMismatchDetails: string[];
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
      const upperVal = val.toUpperCase();
      if (!VALID_COUNTRIES.has(upperVal)) {
        printUsageAndExit(`Unknown country code: ${val}. Valid: ${[...VALID_COUNTRIES].join(', ')}`);
      }
      countries.push(upperVal);
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

/** Per-country expected cell counts. null = skip deviation check (no baseline established). */
const EXPECTED_CELLS: Record<string, number | null> = {
  US: 1_883_843,
  CA: null,  // baseline TBD — first multi-country build
  GB: null,
  AU: null,
  NZ: null,
};

/** Per-country deviation thresholds. Mature countries get tighter bounds. */
const DEVIATION_THRESHOLDS: Record<string, number> = {
  US: 0.05,    // 5% — mature, well-established
  CA: 0.15,    // 15% — newer
  GB: 0.15,
  AU: 0.15,
  NZ: 0.15,
};

/** Per-country jurisdiction configs for slot alignment checks. */
const JURISDICTIONS: Record<string, JurisdictionConfig> = {
  US: US_JURISDICTION,
  CA: CA_JURISDICTION,
  GB: GB_JURISDICTION,
  AU: AU_JURISDICTION,
  NZ: NZ_JURISDICTION,
};

// ============================================================================
// Check 1: Manifest Integrity (reads manifest.json only — no chunk reads)
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
    const containmentErr = checkContainment(chunkPath, join(outputDir, countryDir(country)));
    if (containmentErr) {
      // Skip this chunk — don't read outside the build directory
      missingFields++;
      continue;
    }
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
// Single-Pass Chunk Processing (replaces checks 2, 3, 4, 5-chunk, 7)
// ============================================================================

function processAllChunks(
  outputDir: string,
  country: string,
  manifest: ManifestFile,
): ChunkAccumulator {
  const acc: ChunkAccumulator = {
    // Check 2
    sha256Verified: 0,
    sha256Mismatches: 0,
    sha256MismatchDetails: [],
    // Check 3
    allCells: new Set<string>(),
    duplicateCells: [],
    totalCellsFromChunks: 0,
    // Check 4
    chunksChecked: 0,
    failedChunks: 0,
    formatFailures: [],
    // Check 5 (cross-ref)
    primaryDistricts: new Set<string>(),
    // Check 7
    cellOwnership: new Map<string, string>(),
    crossChunkDuplicates: [],
    cellCountMismatches: 0,
    cellCountMismatchDetails: [],
  };

  const isNZ = country.toUpperCase() === 'NZ';
  const chunkEntries = Object.entries(manifest.chunks);

  for (const [, entry] of chunkEntries) {
    const chunkPath = join(outputDir, countryDir(country), entry.path);
    const containmentErr = checkContainment(chunkPath, join(outputDir, countryDir(country)));
    if (containmentErr) continue;
    if (!existsSync(chunkPath)) continue;

    // === SINGLE READ as Buffer ===
    const rawBuffer = readFileSync(chunkPath);

    // --- Check 2: SHA-256 from raw bytes ---
    const actualHash = createHash('sha256').update(rawBuffer).digest('hex');
    if (actualHash !== entry.sha256) {
      acc.sha256Mismatches++;
      if (acc.sha256MismatchDetails.length < 5) {
        acc.sha256MismatchDetails.push(
          `${entry.path}: expected ${entry.sha256.slice(0, 12)}..., got ${actualHash.slice(0, 12)}...`,
        );
      }
    } else {
      acc.sha256Verified++;
    }

    // === SINGLE JSON parse from the same buffer ===
    let chunk: ChunkFile;
    try {
      chunk = JSON.parse(rawBuffer.toString('utf-8'));
    } catch (parseErr) {
      acc.failedChunks++;
      if (acc.formatFailures.length < 5) {
        acc.formatFailures.push(`${entry.path}: invalid JSON — ${(parseErr as Error).message}`);
      }
      continue;
    }

    if (!chunk.cells) {
      acc.failedChunks++;
      if (acc.formatFailures.length < 5) {
        acc.formatFailures.push(`${entry.path}: missing cells`);
      }
      continue;
    }

    acc.chunksChecked++;

    const cellEntries = Object.entries(chunk.cells);
    const cellIds = Object.keys(chunk.cells);
    const actualCellCount = cellIds.length;

    // --- Check 3: Coverage ---
    acc.totalCellsFromChunks += actualCellCount;
    for (const cellId of cellIds) {
      if (acc.allCells.has(cellId)) {
        if (acc.duplicateCells.length < 10) {
          acc.duplicateCells.push(cellId);
        }
      } else {
        acc.allCells.add(cellId);
      }
    }

    // --- Check 4: Format validation ---
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

    // Cell-level format checks
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

      // --- Check 5: Extract primary district codes from slot[0] for all countries ---
      if (slots[0] !== null && slots[0] !== undefined) {
        acc.primaryDistricts.add(slots[0]);
      }
      // NZ special case: also extract slot[1] (Māori electorates)
      if (isNZ && slots[1] !== null && slots[1] !== undefined) {
        acc.primaryDistricts.add(slots[1]);
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
      acc.failedChunks++;
      if (acc.formatFailures.length < 10) {
        acc.formatFailures.push(`${entry.path}: ${chunkErrors.join(', ')}`);
      }
    }

    // --- Check 7: Cross-chunk consistency ---
    // Cell count match
    if (actualCellCount !== entry.cellCount) {
      acc.cellCountMismatches++;
      if (acc.cellCountMismatchDetails.length < 5) {
        acc.cellCountMismatchDetails.push(
          `${entry.path}: manifest says ${entry.cellCount}, actual ${actualCellCount}`,
        );
      }
    }

    // Cross-chunk duplicates
    for (const cellId of cellIds) {
      const existing = acc.cellOwnership.get(cellId);
      if (existing !== undefined) {
        if (acc.crossChunkDuplicates.length < 10) {
          acc.crossChunkDuplicates.push(`${cellId} in both ${existing} and ${entry.path}`);
        }
      } else {
        acc.cellOwnership.set(cellId, entry.path);
      }
    }
  }

  return acc;
}

// ============================================================================
// Check Result Synthesizers (from ChunkAccumulator)
// ============================================================================

/** Synthesize Check 2 result from accumulator. */
function synthesizeChunkChecksums(acc: ChunkAccumulator): CheckResult {
  const name = 'Chunk Checksums';

  if (acc.sha256Mismatches > 0) {
    return {
      name,
      status: 'fail',
      message: `${acc.sha256Mismatches} checksum mismatch(es) — data corruption or stale manifest`,
      details: { verified: acc.sha256Verified, mismatches: acc.sha256Mismatches, examples: acc.sha256MismatchDetails },
    };
  }

  return {
    name,
    status: 'pass',
    message: `All ${acc.sha256Verified} chunk checksums verified`,
    details: { verified: acc.sha256Verified },
  };
}

/** Synthesize Check 3 result from accumulator. */
function synthesizeCoverageCompleteness(
  acc: ChunkAccumulator,
  country: string,
  manifest: ManifestFile,
): CheckResult {
  const name = 'Coverage Completeness';
  const failures: string[] = [];
  const warnings: string[] = [];

  if (acc.duplicateCells.length > 0) {
    failures.push(`${acc.duplicateCells.length}+ duplicate cell(s) found across chunks (e.g., ${acc.duplicateCells.slice(0, 3).join(', ')})`);
  }

  if (acc.allCells.size !== manifest.totalCells) {
    failures.push(
      `Cell count mismatch: manifest says ${manifest.totalCells}, actual unique cells = ${acc.allCells.size}`,
    );
  }

  // Per-country deviation check (skips countries with no baseline)
  const expected = EXPECTED_CELLS[country.toUpperCase()] ?? null;
  if (expected !== null) {
    const threshold = DEVIATION_THRESHOLDS[country.toUpperCase()] ?? 0.15;
    const deviation = Math.abs(acc.allCells.size - expected) / expected;
    if (deviation > threshold) {
      warnings.push(
        `Cell count ${acc.allCells.size} deviates ${(deviation * 100).toFixed(1)}% from expected ${expected}`,
      );
    }
  }

  if (failures.length > 0) {
    return {
      name,
      status: 'fail',
      message: failures.join('; '),
      details: { uniqueCells: acc.allCells.size, manifestTotal: manifest.totalCells, duplicateExamples: acc.duplicateCells.slice(0, 5) },
    };
  }

  if (warnings.length > 0) {
    return {
      name,
      status: 'warn',
      message: warnings.join('; '),
      details: { uniqueCells: acc.allCells.size, manifestTotal: manifest.totalCells },
    };
  }

  return {
    name,
    status: 'pass',
    message: `${acc.allCells.size} unique cells, no duplicates, matches manifest totalCells`,
    details: { uniqueCells: acc.allCells.size },
  };
}

/** Synthesize Check 4 result from accumulator. */
function synthesizeChunkFormat(acc: ChunkAccumulator): CheckResult {
  const name = 'Chunk Format Validation';

  if (acc.failedChunks > 0) {
    return {
      name,
      status: 'fail',
      message: `${acc.failedChunks} chunk(s) have format violations`,
      details: { chunksChecked: acc.chunksChecked, failedChunks: acc.failedChunks, examples: acc.formatFailures },
    };
  }

  return {
    name,
    status: 'pass',
    message: `All ${acc.chunksChecked} chunks have valid format, correct slot counts, and matching H3 parents`,
    details: { chunksChecked: acc.chunksChecked },
  };
}

/** Synthesize Check 7 result from accumulator. */
function synthesizeCrossChunkConsistency(
  acc: ChunkAccumulator,
  manifest: ManifestFile,
): CheckResult {
  const name = 'Cross-Chunk Consistency';
  const failures: string[] = [];

  if (acc.crossChunkDuplicates.length > 0) {
    failures.push(
      `${acc.crossChunkDuplicates.length}+ cell(s) appear in multiple chunks (e.g., ${acc.crossChunkDuplicates[0]})`,
    );
  }

  if (acc.cellCountMismatches > 0) {
    failures.push(
      `${acc.cellCountMismatches} chunk(s) have cellCount mismatch between manifest and actual data`,
    );
  }

  if (acc.totalCellsFromChunks !== manifest.totalCells) {
    failures.push(
      `Sum of chunk cellCounts (${acc.totalCellsFromChunks}) != manifest totalCells (${manifest.totalCells})`,
    );
  }

  if (failures.length > 0) {
    return {
      name,
      status: 'fail',
      message: failures.join('; '),
      details: {
        chunksChecked: acc.chunksChecked,
        totalCellsFromChunks: acc.totalCellsFromChunks,
        manifestTotalCells: manifest.totalCells,
        crossChunkDuplicates: acc.crossChunkDuplicates.slice(0, 5),
        cellCountMismatchDetails: acc.cellCountMismatchDetails,
      },
    };
  }

  return {
    name,
    status: 'pass',
    message: `${acc.chunksChecked} chunks, ${acc.totalCellsFromChunks} cells, clean partitioning, totals match`,
    details: { chunksChecked: acc.chunksChecked, totalCellsFromChunks: acc.totalCellsFromChunks },
  };
}

// ============================================================================
// Check 5: Officials Completeness (reads officials files + uses accumulator)
// ============================================================================

function checkOfficialsCompleteness(
  outputDir: string,
  country: string,
  acc: ChunkAccumulator,
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

  // R5-H3: Build a lookup from filename → expected SHA-256 from manifest
  const expectedHashes = new Map<string, string>();
  if (manifest.officials?.entries) {
    for (const entry of manifest.officials.entries) {
      // entry.file is e.g. "officials/CA-12.json" — extract just the filename
      const parts = entry.file.split('/');
      const baseName = parts[parts.length - 1];
      expectedHashes.set(baseName, entry.sha256);
    }
  }

  const failures: string[] = [];
  const warnings: string[] = [];
  let validFiles = 0;
  let hashesVerified = 0;
  const officialDistrictCodes = new Set<string>();

  for (const fileName of entries) {
    const filePath = join(officialsDir, fileName);

    // Read raw content once — used for both SHA-256 verification and JSON parse
    let rawContent: string;
    try {
      rawContent = readFileSync(filePath, 'utf-8');
    } catch (readErr) {
      failures.push(`${fileName}: cannot read file — ${(readErr as Error).message}`);
      continue;
    }

    // R5-H3: Verify SHA-256 against manifest before parsing
    const expectedHash = expectedHashes.get(fileName);
    if (expectedHash) {
      const actualHash = createHash('sha256').update(rawContent, 'utf-8').digest('hex');
      if (actualHash !== expectedHash) {
        failures.push(
          `${fileName}: SHA-256 mismatch (expected ${expectedHash}, got ${actualHash})`,
        );
        continue;
      }
      hashesVerified++;
    }

    let officials: OfficialsFile;
    try {
      officials = JSON.parse(rawContent) as OfficialsFile;
    } catch (parseErr) {
      failures.push(`${fileName}: invalid JSON — ${(parseErr as Error).message}`);
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

  // Cross-reference primary districts from chunk slot[0] data against officials files
  if (acc.primaryDistricts.size > 0) {
    const missingOfficials: string[] = [];
    for (const cd of acc.primaryDistricts) {
      if (!officialDistrictCodes.has(cd)) {
        if (missingOfficials.length < 10) {
          missingOfficials.push(cd);
        }
      }
    }

    if (missingOfficials.length > 0) {
      warnings.push(
        `${missingOfficials.length} district(s) in mapping have no officials file (e.g., ${missingOfficials.slice(0, 5).join(', ')})`,
      );
    }
  }

  if (failures.length > 0) {
    return {
      name,
      status: 'fail',
      message: `${failures.length} officials file(s) have errors`,
      details: { validFiles, totalFiles: entries.length, hashesVerified, failures: failures.slice(0, 10), warnings: warnings.slice(0, 10) },
    };
  }

  if (warnings.length > 0) {
    return {
      name,
      status: 'warn',
      message: `${validFiles} officials files valid; ${warnings.length} warning(s)`,
      details: { validFiles, totalFiles: entries.length, hashesVerified, warnings: warnings.slice(0, 10) },
    };
  }

  return {
    name,
    status: 'pass',
    message: `All ${validFiles} officials files valid, ${hashesVerified} SHA-256 hashes verified`,
    details: { validFiles, totalFiles: entries.length, hashesVerified, districtsCovered: officialDistrictCodes.size },
  };
}

// ============================================================================
// Check 6: Slot Alignment (metadata only — no chunk reads)
// ============================================================================

function checkSlotAlignment(
  country: string,
  manifest: ManifestFile,
): CheckResult {
  const name = 'Slot Alignment';
  const countryKey = country.toUpperCase();

  const jurisdiction = JURISDICTIONS[countryKey];
  if (!jurisdiction) {
    return {
      name,
      status: 'warn',
      message: `Slot alignment check skipped for country "${country}" — no jurisdiction config found`,
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
  const jurisdictionSlots = jurisdiction.slots;

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
      mismatches.push(`Slot ${idx} ("${manifestSlots[idx]}"): present in manifest but not in ${countryKey} jurisdiction slots`);
    }
  }

  if (mismatches.length > 0) {
    return {
      name,
      status: 'warn',
      message: `${mismatches.length} slot name mismatch(es) between manifest and ${countryKey} jurisdiction`,
      details: { mismatches },
    };
  }

  return {
    name,
    status: 'pass',
    message: `All ${Object.keys(jurisdictionSlots).length} slot names match ${countryKey} jurisdiction definition`,
    details: { slotsChecked: Object.keys(jurisdictionSlots).length },
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

    // === SINGLE PASS over all chunk files ===
    const acc = processAllChunks(outputDir, country, manifest);

    // Check 2: Chunk Checksums (synthesized from accumulator)
    const check2 = synthesizeChunkChecksums(acc);
    check2.name = `[${country}] ${check2.name}`;
    allChecks.push(check2);

    // Check 3: Coverage Completeness (synthesized from accumulator)
    const check3 = synthesizeCoverageCompleteness(acc, country, manifest);
    check3.name = `[${country}] ${check3.name}`;
    allChecks.push(check3);

    // Check 4: Chunk Format Validation (synthesized from accumulator)
    const check4 = synthesizeChunkFormat(acc);
    check4.name = `[${country}] ${check4.name}`;
    allChecks.push(check4);

    // Check 5: Officials Completeness (reads officials files, uses accumulator for cross-ref)
    const check5 = checkOfficialsCompleteness(outputDir, country, acc, manifest);
    check5.name = `[${country}] ${check5.name}`;
    allChecks.push(check5);

    // Check 6: Slot Alignment (metadata only)
    const check6 = checkSlotAlignment(country, manifest);
    check6.name = `[${country}] ${check6.name}`;
    allChecks.push(check6);

    // Check 7: Cross-Chunk Consistency (synthesized from accumulator)
    const check7 = synthesizeCrossChunkConsistency(acc, manifest);
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
