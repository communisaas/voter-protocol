/**
 * Concordance CSV Loader
 *
 * Generic utility for downloading and parsing concordance tables that map
 * statistical geography units (meshblocks, output areas, SA1s, dissemination
 * areas) to electoral boundaries.
 *
 * All 4 international countries publish pre-built concordance CSVs. This
 * loader handles download, caching, and parsing without external dependencies.
 *
 * @packageDocumentation
 */

import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'fs';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { createHash } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

export interface ConcordanceConfig {
  /** Download URL for the concordance CSV */
  url: string;
  /** CSV column name for the statistical unit ID */
  unitColumn: string;
  /** CSV column name for the boundary/district code */
  boundaryColumn: string;
  /** Optional secondary boundary column (e.g., NZ Maori electorate) */
  secondaryBoundaryColumn?: string;
  /** CSV delimiter (default: ',') */
  delimiter?: string;
  /** Cache filename override (derived from URL if not provided) */
  cacheFilename?: string;
  /** Expected SHA-256 hex digest. When set, downloaded files are verified and deleted on mismatch. */
  sha256?: string;
  /** Maximum cache age in days before re-downloading (default: 90) */
  maxAgeDays?: number;
  /** Bypass cache entirely and force a fresh download */
  forceRefresh?: boolean;
}

export interface ConcordanceMapping {
  unitId: string;
  boundaryCode: string;
  secondaryBoundaryCode?: string;
}

export interface ConcordanceResult {
  mappings: ConcordanceMapping[];
  rowCount: number;
  columns: string[];
  fromCache: boolean;
}

// ============================================================================
// CSV Parsing (no external dependencies)
// ============================================================================

/**
 * Parse a single CSV line, handling quoted fields.
 * Handles fields wrapped in double quotes that may contain the delimiter.
 */
function parseCSVLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote ("")
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip next quote
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

/**
 * Count unescaped quotes in a string.
 * Escaped quotes ("") count as zero unescaped quotes.
 */
function countUnescapedQuotes(line: string): number {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (i + 1 < line.length && line[i + 1] === '"') {
        i++; // skip escaped quote pair
      } else {
        count++;
      }
    }
  }
  return count;
}

/**
 * Parse a CSV file line-by-line using streaming to handle large files.
 * Handles embedded newlines inside quoted fields by accumulating lines
 * until quote state is balanced.
 * Returns parsed rows with column headers.
 */
async function parseCSVStream(
  filePath: string,
  delimiter: string,
): Promise<{ headers: string[]; rows: string[][] }> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let headers: string[] = [];
  const rows: string[][] = [];
  let isFirstRecord = true;
  let pendingLine = '';

  for await (const line of rl) {
    // Strip BOM from very first line
    const cleaned = isFirstRecord && !pendingLine
      ? line.replace(/^\uFEFF/, '')
      : line;

    if (pendingLine) {
      // We're accumulating a multi-line quoted field
      pendingLine += '\n' + cleaned;
    } else {
      // Skip blank lines only when not inside a quoted field
      if (!cleaned.trim()) continue;
      pendingLine = cleaned;
    }

    // Check if quotes are balanced (even number of unescaped quotes)
    if (countUnescapedQuotes(pendingLine) % 2 !== 0) {
      // Odd quotes — we're inside a quoted field that spans lines, keep accumulating
      continue;
    }

    const fields = parseCSVLine(pendingLine, delimiter);
    pendingLine = '';

    if (isFirstRecord) {
      headers = fields;
      isFirstRecord = false;
    } else {
      rows.push(fields);
    }
  }

  // Handle trailing accumulated line (unbalanced quotes at EOF)
  if (pendingLine) {
    const fields = parseCSVLine(pendingLine, delimiter);
    if (isFirstRecord) {
      headers = fields;
    } else {
      rows.push(fields);
    }
  }

  return { headers, rows };
}

/**
 * Parse CSV content from a string (for small files or testing).
 * Handles embedded newlines inside quoted fields.
 */
export function parseCSVString(
  content: string,
  delimiter: string = ',',
): { headers: string[]; rows: string[][] } {
  const lines = content.split(/\r?\n/);
  let headers: string[] = [];
  const rows: string[][] = [];
  let pendingLine = '';

  for (const rawLine of lines) {
    const line = !headers.length && !pendingLine
      ? rawLine.replace(/^\uFEFF/, '')
      : rawLine;

    if (pendingLine) {
      pendingLine += '\n' + line;
    } else {
      // Skip blank lines only when not inside a quoted field
      if (!line.trim()) continue;
      pendingLine = line;
    }

    // Check if quotes are balanced
    if (countUnescapedQuotes(pendingLine) % 2 !== 0) {
      continue;
    }

    const fields = parseCSVLine(pendingLine, delimiter);
    pendingLine = '';

    if (headers.length === 0) {
      headers = fields;
    } else {
      rows.push(fields);
    }
  }

  // Handle trailing accumulated line
  if (pendingLine) {
    const fields = parseCSVLine(pendingLine, delimiter);
    if (headers.length === 0) {
      headers = fields;
    } else {
      rows.push(fields);
    }
  }

  return { headers, rows };
}

// ============================================================================
// Core Loader
// ============================================================================

/**
 * Derive a cache filename from a URL.
 */
function cacheFilenameFromUrl(url: string): string {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/');
  const lastPart = pathParts[pathParts.length - 1] || 'concordance';
  // Sanitize for filesystem
  return lastPart.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Download a file from a URL and save to cache.
 * If expectedSha256 is provided, verifies the file after writing and removes it on mismatch.
 */
async function downloadToCache(url: string, cachePath: string, expectedSha256?: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download concordance CSV from ${url}: ${response.status} ${response.statusText}`
    );
  }

  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`Empty response from ${url}`);
  }

  // Ensure directory exists
  const dir = cachePath.substring(0, cachePath.lastIndexOf('/'));
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  await writeFile(cachePath, text, 'utf-8');

  // SHA-256 verification
  if (expectedSha256) {
    const fileContent = readFileSync(cachePath);
    const actualHash = createHash('sha256').update(fileContent).digest('hex');
    if (actualHash !== expectedSha256) {
      unlinkSync(cachePath);
      throw new Error(
        `SHA-256 mismatch for ${url}: expected ${expectedSha256}, got ${actualHash}. File removed.`
      );
    }
  }
}

/**
 * Verify SHA-256 of an already-cached file.
 * Returns the computed hash, or throws on mismatch if expectedSha256 is set.
 */
export function verifySha256(filePath: string, expectedSha256?: string): string {
  const fileContent = readFileSync(filePath);
  const actualHash = createHash('sha256').update(fileContent).digest('hex');
  if (expectedSha256 && actualHash !== expectedSha256) {
    unlinkSync(filePath);
    throw new Error(
      `SHA-256 mismatch for ${filePath}: expected ${expectedSha256}, got ${actualHash}. File removed.`
    );
  }
  return actualHash;
}

/**
 * Load concordance mappings from a CSV file.
 *
 * Downloads from URL if not cached, reads from cache otherwise.
 * Parses via line-by-line streaming for large files.
 *
 * @param config - Concordance CSV configuration
 * @param cacheDir - Directory for cached downloads
 * @returns Parsed concordance mappings
 * @throws Error if required columns are missing or download fails
 */
export async function loadConcordance(
  config: ConcordanceConfig,
  cacheDir: string,
): Promise<ConcordanceResult> {
  const delimiter = config.delimiter ?? ',';
  const filename = config.cacheFilename ?? cacheFilenameFromUrl(config.url);
  const cachePath = join(cacheDir, filename);

  // Ensure cache directory exists
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  // Download if not cached, stale, or force-refreshed
  let fromCache = true;
  if (config.forceRefresh || !existsSync(cachePath)) {
    fromCache = false;
    await downloadToCache(config.url, cachePath, config.sha256);
  } else {
    // Check cache staleness by mtime
    const stats = statSync(cachePath);
    const ageMs = Date.now() - stats.mtimeMs;
    const maxAgeMs = (config.maxAgeDays ?? 90) * 24 * 60 * 60 * 1000;
    if (ageMs >= maxAgeMs) {
      console.log(`Cache stale (${Math.floor(ageMs / 86400000)}d old, max ${config.maxAgeDays ?? 90}d): re-downloading`);
      fromCache = false;
      await downloadToCache(config.url, cachePath, config.sha256);
    }
  }

  // Parse CSV via streaming
  const { headers, rows } = await parseCSVStream(cachePath, delimiter);

  // Resolve column indices
  const unitIdx = headers.indexOf(config.unitColumn);
  const boundaryIdx = headers.indexOf(config.boundaryColumn);
  const secondaryIdx = config.secondaryBoundaryColumn
    ? headers.indexOf(config.secondaryBoundaryColumn)
    : -1;

  if (unitIdx === -1) {
    throw new Error(
      `Unit column "${config.unitColumn}" not found in CSV. ` +
      `Available columns: ${headers.join(', ')}`
    );
  }

  if (boundaryIdx === -1) {
    throw new Error(
      `Boundary column "${config.boundaryColumn}" not found in CSV. ` +
      `Available columns: ${headers.join(', ')}`
    );
  }

  if (config.secondaryBoundaryColumn && secondaryIdx === -1) {
    throw new Error(
      `Secondary boundary column "${config.secondaryBoundaryColumn}" not found in CSV. ` +
      `Available columns: ${headers.join(', ')}`
    );
  }

  // Map rows to ConcordanceMapping
  const mappings: ConcordanceMapping[] = [];
  for (const row of rows) {
    const unitId = row[unitIdx]?.trim() ?? '';
    if (!unitId) continue; // Skip rows with empty unit IDs

    const boundaryCode = row[boundaryIdx]?.trim() ?? '';
    const mapping: ConcordanceMapping = { unitId, boundaryCode };

    if (secondaryIdx >= 0) {
      const secondaryCode = row[secondaryIdx]?.trim() ?? '';
      if (secondaryCode) {
        mapping.secondaryBoundaryCode = secondaryCode;
      }
    }

    mappings.push(mapping);
  }

  return {
    mappings,
    rowCount: mappings.length,
    columns: headers,
    fromCache,
  };
}

/**
 * Load concordance mappings from a CSV string (for testing or inline data).
 *
 * Same column-resolution logic as loadConcordance but operates on a string
 * instead of a file.
 *
 * @param csvContent - Raw CSV content
 * @param config - Column configuration (url is ignored)
 * @returns Parsed concordance mappings
 */
export function loadConcordanceFromString(
  csvContent: string,
  config: Pick<ConcordanceConfig, 'unitColumn' | 'boundaryColumn' | 'secondaryBoundaryColumn' | 'delimiter'>,
): ConcordanceResult {
  const delimiter = config.delimiter ?? ',';
  const { headers, rows } = parseCSVString(csvContent, delimiter);

  const unitIdx = headers.indexOf(config.unitColumn);
  const boundaryIdx = headers.indexOf(config.boundaryColumn);
  const secondaryIdx = config.secondaryBoundaryColumn
    ? headers.indexOf(config.secondaryBoundaryColumn)
    : -1;

  if (unitIdx === -1) {
    throw new Error(
      `Unit column "${config.unitColumn}" not found in CSV. ` +
      `Available columns: ${headers.join(', ')}`
    );
  }

  if (boundaryIdx === -1) {
    throw new Error(
      `Boundary column "${config.boundaryColumn}" not found in CSV. ` +
      `Available columns: ${headers.join(', ')}`
    );
  }

  if (config.secondaryBoundaryColumn && secondaryIdx === -1) {
    throw new Error(
      `Secondary boundary column "${config.secondaryBoundaryColumn}" not found in CSV. ` +
      `Available columns: ${headers.join(', ')}`
    );
  }

  const mappings: ConcordanceMapping[] = [];
  for (const row of rows) {
    const unitId = row[unitIdx]?.trim() ?? '';
    if (!unitId) continue;

    const boundaryCode = row[boundaryIdx]?.trim() ?? '';
    const mapping: ConcordanceMapping = { unitId, boundaryCode };

    if (secondaryIdx >= 0) {
      const secondaryCode = row[secondaryIdx]?.trim() ?? '';
      if (secondaryCode) {
        mapping.secondaryBoundaryCode = secondaryCode;
      }
    }

    mappings.push(mapping);
  }

  return {
    mappings,
    rowCount: mappings.length,
    columns: headers,
    fromCache: false,
  };
}

// ============================================================================
// Hash Recording
// ============================================================================

/**
 * Download a concordance CSV and print its SHA-256 hash for inclusion in the
 * sources manifest. Does not persist the file — use for initial hash capture.
 *
 * @param url - URL to download
 * @param cacheDir - Directory to temporarily store the file
 * @returns Hex SHA-256 digest
 */
export async function recordHash(url: string, cacheDir: string): Promise<string> {
  const filename = cacheFilenameFromUrl(url);
  const cachePath = join(cacheDir, filename);

  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  // Download without hash check
  await downloadToCache(url, cachePath);

  const fileContent = readFileSync(cachePath);
  const hash = createHash('sha256').update(fileContent).digest('hex');
  return hash;
}
