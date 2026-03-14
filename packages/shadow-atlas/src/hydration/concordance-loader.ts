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

import { existsSync, mkdirSync } from 'fs';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

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
 * Parse a CSV file line-by-line using streaming to handle large files.
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
  let lineNum = 0;

  for await (const line of rl) {
    lineNum++;
    // Skip empty lines and BOM
    const cleaned = line.replace(/^\uFEFF/, '').trim();
    if (!cleaned) continue;

    const fields = parseCSVLine(cleaned, delimiter);

    if (lineNum === 1) {
      headers = fields;
    } else {
      rows.push(fields);
    }
  }

  return { headers, rows };
}

/**
 * Parse CSV content from a string (for small files or testing).
 */
export function parseCSVString(
  content: string,
  delimiter: string = ',',
): { headers: string[]; rows: string[][] } {
  const lines = content.split(/\r?\n/);
  let headers: string[] = [];
  const rows: string[][] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/^\uFEFF/, '').trim();
    if (!line) continue;

    const fields = parseCSVLine(line, delimiter);

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
 */
async function downloadToCache(url: string, cachePath: string): Promise<void> {
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

  // Download if not cached
  let fromCache = true;
  if (!existsSync(cachePath)) {
    fromCache = false;
    await downloadToCache(config.url, cachePath);
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
