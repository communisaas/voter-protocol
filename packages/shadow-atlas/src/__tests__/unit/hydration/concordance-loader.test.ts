/**
 * Tests for the concordance CSV loader.
 *
 * Tests parsing, column resolution, caching, and edge cases
 * without hitting any external network endpoints.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import {
  loadConcordance,
  loadConcordanceFromString,
  parseCSVString,
} from '../../../hydration/concordance-loader.js';

// ============================================================================
// Test fixtures
// ============================================================================

const SIMPLE_CSV = `MB2025_V1_00,GED2025_V1_00,MED2025_V1_00
0100100,01,65
0100200,01,65
0200100,02,66
0300100,03,
`;

const TAB_DELIMITED_CSV = `unit_id\tboundary_code
OA001\tE14001089
OA002\tE14001090
OA003\tE14001091
`;

const QUOTED_CSV = `id,name,boundary
"001","Auckland, Central","01"
"002","Wellington ""Capital""","02"
"003","Christchurch",03
`;

const EMPTY_CSV = `MB2025_V1_00,GED2025_V1_00
`;

const CSV_WITH_EMPTY_ROWS = `MB2025_V1_00,GED2025_V1_00,MED2025_V1_00
0100100,01,65
,02,66
0300100,,67
0400100,04,
`;

const CSV_WITH_BOM = `\uFEFFMB2025_V1_00,GED2025_V1_00
0100100,01
0100200,02
`;

// ============================================================================
// Temp directory management
// ============================================================================

const TEST_CACHE_DIR = join(
  process.cwd(),
  'data',
  'test-cache',
  `concordance-test-${Date.now()}`,
);

beforeEach(() => {
  if (!existsSync(TEST_CACHE_DIR)) {
    mkdirSync(TEST_CACHE_DIR, { recursive: true });
  }
});

afterEach(() => {
  if (existsSync(TEST_CACHE_DIR)) {
    rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
  }
});

// ============================================================================
// parseCSVString tests
// ============================================================================

describe('parseCSVString', () => {
  it('parses simple CSV correctly', () => {
    const result = parseCSVString(SIMPLE_CSV);

    expect(result.headers).toEqual(['MB2025_V1_00', 'GED2025_V1_00', 'MED2025_V1_00']);
    expect(result.rows).toHaveLength(4);
    expect(result.rows[0]).toEqual(['0100100', '01', '65']);
    expect(result.rows[1]).toEqual(['0100200', '01', '65']);
    expect(result.rows[2]).toEqual(['0200100', '02', '66']);
    expect(result.rows[3]).toEqual(['0300100', '03', '']);
  });

  it('parses tab-delimited CSV', () => {
    const result = parseCSVString(TAB_DELIMITED_CSV, '\t');

    expect(result.headers).toEqual(['unit_id', 'boundary_code']);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual(['OA001', 'E14001089']);
  });

  it('handles quoted fields with commas and escaped quotes', () => {
    const result = parseCSVString(QUOTED_CSV);

    expect(result.headers).toEqual(['id', 'name', 'boundary']);
    expect(result.rows[0]).toEqual(['001', 'Auckland, Central', '01']);
    expect(result.rows[1]).toEqual(['002', 'Wellington "Capital"', '02']);
    expect(result.rows[2]).toEqual(['003', 'Christchurch', '03']);
  });

  it('handles BOM prefix', () => {
    const result = parseCSVString(CSV_WITH_BOM);

    expect(result.headers).toEqual(['MB2025_V1_00', 'GED2025_V1_00']);
    expect(result.rows).toHaveLength(2);
  });

  it('returns empty rows for empty CSV (header only)', () => {
    const result = parseCSVString(EMPTY_CSV);

    expect(result.headers).toEqual(['MB2025_V1_00', 'GED2025_V1_00']);
    expect(result.rows).toHaveLength(0);
  });
});

// ============================================================================
// loadConcordanceFromString tests
// ============================================================================

describe('loadConcordanceFromString', () => {
  it('parses simple concordance mappings', () => {
    const result = loadConcordanceFromString(SIMPLE_CSV, {
      unitColumn: 'MB2025_V1_00',
      boundaryColumn: 'GED2025_V1_00',
    });

    expect(result.rowCount).toBe(4);
    expect(result.mappings[0]).toEqual({
      unitId: '0100100',
      boundaryCode: '01',
    });
    expect(result.fromCache).toBe(false);
  });

  it('parses dual-slot mapping (NZ general + Maori)', () => {
    const result = loadConcordanceFromString(SIMPLE_CSV, {
      unitColumn: 'MB2025_V1_00',
      boundaryColumn: 'GED2025_V1_00',
      secondaryBoundaryColumn: 'MED2025_V1_00',
    });

    expect(result.rowCount).toBe(4);

    // Row with both general and Maori
    expect(result.mappings[0]).toEqual({
      unitId: '0100100',
      boundaryCode: '01',
      secondaryBoundaryCode: '65',
    });

    // Row with only general (no Maori)
    expect(result.mappings[3]).toEqual({
      unitId: '0300100',
      boundaryCode: '03',
    });
    expect(result.mappings[3].secondaryBoundaryCode).toBeUndefined();
  });

  it('skips rows with empty unit IDs', () => {
    const result = loadConcordanceFromString(CSV_WITH_EMPTY_ROWS, {
      unitColumn: 'MB2025_V1_00',
      boundaryColumn: 'GED2025_V1_00',
      secondaryBoundaryColumn: 'MED2025_V1_00',
    });

    // Row 2 has empty unit ID, should be skipped
    expect(result.rowCount).toBe(3);
    expect(result.mappings.map(m => m.unitId)).toEqual([
      '0100100',
      '0300100',
      '0400100',
    ]);
  });

  it('throws on missing unit column', () => {
    expect(() =>
      loadConcordanceFromString(SIMPLE_CSV, {
        unitColumn: 'NONEXISTENT',
        boundaryColumn: 'GED2025_V1_00',
      })
    ).toThrow('Unit column "NONEXISTENT" not found');
    expect(() =>
      loadConcordanceFromString(SIMPLE_CSV, {
        unitColumn: 'NONEXISTENT',
        boundaryColumn: 'GED2025_V1_00',
      })
    ).toThrow('Available columns: MB2025_V1_00, GED2025_V1_00, MED2025_V1_00');
  });

  it('throws on missing boundary column', () => {
    expect(() =>
      loadConcordanceFromString(SIMPLE_CSV, {
        unitColumn: 'MB2025_V1_00',
        boundaryColumn: 'NONEXISTENT',
      })
    ).toThrow('Boundary column "NONEXISTENT" not found');
  });

  it('throws on missing secondary boundary column', () => {
    expect(() =>
      loadConcordanceFromString(SIMPLE_CSV, {
        unitColumn: 'MB2025_V1_00',
        boundaryColumn: 'GED2025_V1_00',
        secondaryBoundaryColumn: 'NONEXISTENT',
      })
    ).toThrow('Secondary boundary column "NONEXISTENT" not found');
  });

  it('handles tab-delimited files', () => {
    const result = loadConcordanceFromString(TAB_DELIMITED_CSV, {
      unitColumn: 'unit_id',
      boundaryColumn: 'boundary_code',
      delimiter: '\t',
    });

    expect(result.rowCount).toBe(3);
    expect(result.mappings[0]).toEqual({
      unitId: 'OA001',
      boundaryCode: 'E14001089',
    });
  });

  it('returns empty mappings for empty CSV', () => {
    const result = loadConcordanceFromString(EMPTY_CSV, {
      unitColumn: 'MB2025_V1_00',
      boundaryColumn: 'GED2025_V1_00',
    });

    expect(result.rowCount).toBe(0);
    expect(result.mappings).toEqual([]);
  });
});

// ============================================================================
// loadConcordance (file-based) tests
// ============================================================================

describe('loadConcordance', () => {
  it('reads from cache when file exists', async () => {
    // Write a pre-cached file
    const cachePath = join(TEST_CACHE_DIR, 'test-concordance.csv');
    await writeFile(cachePath, SIMPLE_CSV, 'utf-8');

    const result = await loadConcordance(
      {
        url: 'https://example.com/fake.csv',
        unitColumn: 'MB2025_V1_00',
        boundaryColumn: 'GED2025_V1_00',
        cacheFilename: 'test-concordance.csv',
      },
      TEST_CACHE_DIR,
    );

    expect(result.fromCache).toBe(true);
    expect(result.rowCount).toBe(4);
    expect(result.mappings[0].unitId).toBe('0100100');
    expect(result.mappings[0].boundaryCode).toBe('01');
  });

  it('reads dual-slot from cached file', async () => {
    const cachePath = join(TEST_CACHE_DIR, 'nz-dual.csv');
    await writeFile(cachePath, SIMPLE_CSV, 'utf-8');

    const result = await loadConcordance(
      {
        url: 'https://example.com/fake.csv',
        unitColumn: 'MB2025_V1_00',
        boundaryColumn: 'GED2025_V1_00',
        secondaryBoundaryColumn: 'MED2025_V1_00',
        cacheFilename: 'nz-dual.csv',
      },
      TEST_CACHE_DIR,
    );

    expect(result.fromCache).toBe(true);
    expect(result.mappings[0].secondaryBoundaryCode).toBe('65');
    expect(result.mappings[3].secondaryBoundaryCode).toBeUndefined();
  });

  it('handles large CSV files via streaming', async () => {
    // Generate a larger CSV to test streaming
    const lines = ['MB_CODE,GED_CODE'];
    for (let i = 0; i < 10000; i++) {
      lines.push(`${String(i).padStart(7, '0')},${String(i % 64).padStart(2, '0')}`);
    }
    const largeCsv = lines.join('\n');

    const cachePath = join(TEST_CACHE_DIR, 'large-test.csv');
    await writeFile(cachePath, largeCsv, 'utf-8');

    const result = await loadConcordance(
      {
        url: 'https://example.com/large.csv',
        unitColumn: 'MB_CODE',
        boundaryColumn: 'GED_CODE',
        cacheFilename: 'large-test.csv',
      },
      TEST_CACHE_DIR,
    );

    expect(result.rowCount).toBe(10000);
    expect(result.mappings[0].unitId).toBe('0000000');
    expect(result.mappings[9999].unitId).toBe('0009999');
  });

  it('creates cache directory if it does not exist', async () => {
    const nestedDir = join(TEST_CACHE_DIR, 'nested', 'deep');
    const cachePath = join(nestedDir, 'pre-placed.csv');

    // Pre-create the nested dir and place the file
    mkdirSync(nestedDir, { recursive: true });
    await writeFile(cachePath, SIMPLE_CSV, 'utf-8');

    const result = await loadConcordance(
      {
        url: 'https://example.com/fake.csv',
        unitColumn: 'MB2025_V1_00',
        boundaryColumn: 'GED2025_V1_00',
        cacheFilename: 'pre-placed.csv',
      },
      nestedDir,
    );

    expect(result.rowCount).toBe(4);
  });
});
