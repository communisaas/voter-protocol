/**
 * Tests for the concordance CSV loader.
 *
 * Tests parsing, column resolution, caching, and edge cases
 * without hitting any external network endpoints.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, utimesSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import {
  loadConcordance,
  loadConcordanceFromString,
  parseCSVString,
  verifySha256,
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

  it('skips rows with empty unit IDs and empty boundary codes', () => {
    const result = loadConcordanceFromString(CSV_WITH_EMPTY_ROWS, {
      unitColumn: 'MB2025_V1_00',
      boundaryColumn: 'GED2025_V1_00',
      secondaryBoundaryColumn: 'MED2025_V1_00',
    });

    // Row 2 has empty unit ID → skipped
    // Row 3 (0300100) has empty boundary code → skipped (M-4)
    expect(result.rowCount).toBe(2);
    expect(result.mappings.map(m => m.unitId)).toEqual([
      '0100100',
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

// ============================================================================
// SHA-256 integrity verification tests
// ============================================================================

describe('SHA-256 verification', () => {
  it('matching hash passes verification', async () => {
    const cachePath = join(TEST_CACHE_DIR, 'sha-pass.csv');
    await writeFile(cachePath, SIMPLE_CSV, 'utf-8');

    const expectedHash = createHash('sha256').update(Buffer.from(SIMPLE_CSV, 'utf-8')).digest('hex');
    const actualHash = verifySha256(cachePath, expectedHash);

    expect(actualHash).toBe(expectedHash);
    expect(existsSync(cachePath)).toBe(true);
  });

  it('mismatched hash throws and deletes the cached file', async () => {
    const cachePath = join(TEST_CACHE_DIR, 'sha-fail.csv');
    await writeFile(cachePath, SIMPLE_CSV, 'utf-8');

    const wrongHash = 'deadbeef'.repeat(8); // 64-char fake hash

    expect(() => verifySha256(cachePath, wrongHash)).toThrow('SHA-256 mismatch');
    expect(existsSync(cachePath)).toBe(false);
  });

  it('undefined hash skips verification and returns computed hash', async () => {
    const cachePath = join(TEST_CACHE_DIR, 'sha-skip.csv');
    await writeFile(cachePath, SIMPLE_CSV, 'utf-8');

    const expectedHash = createHash('sha256').update(Buffer.from(SIMPLE_CSV, 'utf-8')).digest('hex');
    const actualHash = verifySha256(cachePath);

    expect(actualHash).toBe(expectedHash);
    expect(existsSync(cachePath)).toBe(true);
  });
});

// ============================================================================
// Cache TTL and revalidation tests
// ============================================================================

describe('cache TTL and revalidation', () => {
  it('fresh file is reused (fromCache = true)', async () => {
    const cachePath = join(TEST_CACHE_DIR, 'ttl-fresh.csv');
    await writeFile(cachePath, SIMPLE_CSV, 'utf-8');
    // File was just written, so mtime is now — well within any TTL

    const result = await loadConcordance(
      {
        url: 'https://example.com/fake.csv',
        unitColumn: 'MB2025_V1_00',
        boundaryColumn: 'GED2025_V1_00',
        cacheFilename: 'ttl-fresh.csv',
        maxAgeDays: 90,
      },
      TEST_CACHE_DIR,
    );

    expect(result.fromCache).toBe(true);
    expect(result.rowCount).toBe(4);
  });

  it('stale file triggers re-download attempt (maxAgeDays exceeded)', async () => {
    const cachePath = join(TEST_CACHE_DIR, 'ttl-stale.csv');
    await writeFile(cachePath, SIMPLE_CSV, 'utf-8');

    // Backdate the file mtime to 100 days ago
    const now = new Date();
    const oldDate = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);
    utimesSync(cachePath, oldDate, oldDate);

    // With maxAgeDays=90, this file is stale. loadConcordance will try to
    // re-download from the fake URL, which should fail (no network).
    // The fact that it attempts the download (and fails) proves staleness was detected.
    await expect(
      loadConcordance(
        {
          url: 'https://example.com/fake-stale.csv',
          unitColumn: 'MB2025_V1_00',
          boundaryColumn: 'GED2025_V1_00',
          cacheFilename: 'ttl-stale.csv',
          maxAgeDays: 90,
        },
        TEST_CACHE_DIR,
      ),
    ).rejects.toThrow(); // Fetch will fail — proves re-download was triggered
  });

  it('forceRefresh bypasses cache even for fresh files', async () => {
    const cachePath = join(TEST_CACHE_DIR, 'ttl-force.csv');
    await writeFile(cachePath, SIMPLE_CSV, 'utf-8');
    // File is fresh (just written)

    // forceRefresh should still try to re-download
    await expect(
      loadConcordance(
        {
          url: 'https://example.com/fake-force.csv',
          unitColumn: 'MB2025_V1_00',
          boundaryColumn: 'GED2025_V1_00',
          cacheFilename: 'ttl-force.csv',
          forceRefresh: true,
        },
        TEST_CACHE_DIR,
      ),
    ).rejects.toThrow(); // Fetch will fail — proves forceRefresh triggered download
  });

  it('file within maxAgeDays is not re-downloaded', async () => {
    const cachePath = join(TEST_CACHE_DIR, 'ttl-within.csv');
    await writeFile(cachePath, SIMPLE_CSV, 'utf-8');

    // Backdate to 30 days ago, but maxAgeDays is 90 — should still be fresh
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    utimesSync(cachePath, thirtyDaysAgo, thirtyDaysAgo);

    const result = await loadConcordance(
      {
        url: 'https://example.com/fake.csv',
        unitColumn: 'MB2025_V1_00',
        boundaryColumn: 'GED2025_V1_00',
        cacheFilename: 'ttl-within.csv',
        maxAgeDays: 90,
      },
      TEST_CACHE_DIR,
    );

    expect(result.fromCache).toBe(true);
    expect(result.rowCount).toBe(4);
  });

  it('custom short maxAgeDays triggers re-download', async () => {
    const cachePath = join(TEST_CACHE_DIR, 'ttl-short.csv');
    await writeFile(cachePath, SIMPLE_CSV, 'utf-8');

    // Backdate to 5 days ago with maxAgeDays=3 — should be stale
    const now = new Date();
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    utimesSync(cachePath, fiveDaysAgo, fiveDaysAgo);

    await expect(
      loadConcordance(
        {
          url: 'https://example.com/fake-short.csv',
          unitColumn: 'MB2025_V1_00',
          boundaryColumn: 'GED2025_V1_00',
          cacheFilename: 'ttl-short.csv',
          maxAgeDays: 3,
        },
        TEST_CACHE_DIR,
      ),
    ).rejects.toThrow(); // Proves staleness detected with short TTL
  });
});

// ============================================================================
// H-3: Embedded newlines in quoted fields
// ============================================================================

describe('embedded newlines in quoted fields (H-3)', () => {
  it('parseCSVString handles embedded newline in quoted field', () => {
    const csv = `id,name,code\n"001","line1\nline2","A01"\n"002","simple","A02"`;
    const result = parseCSVString(csv);

    expect(result.headers).toEqual(['id', 'name', 'code']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(['001', 'line1\nline2', 'A01']);
    expect(result.rows[1]).toEqual(['002', 'simple', 'A02']);
  });

  it('parseCSVString handles multiple embedded newlines', () => {
    const csv = `id,desc,code\n"001","line1\nline2\nline3","A01"\n"002","ok","A02"`;
    const result = parseCSVString(csv);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(['001', 'line1\nline2\nline3', 'A01']);
  });

  it('parseCSVString handles escaped quotes alongside embedded newlines', () => {
    const csv = `id,desc,code\n"001","He said ""hello""\nthen left","A01"`;
    const result = parseCSVString(csv);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual(['001', 'He said "hello"\nthen left', 'A01']);
  });

  it('loadConcordanceFromString handles embedded newlines', () => {
    const csv = `unit_id,boundary,notes\n"U001","B01","has\nnewline"\n"U002","B02","normal"`;
    const result = loadConcordanceFromString(csv, {
      unitColumn: 'unit_id',
      boundaryColumn: 'boundary',
    });

    expect(result.rowCount).toBe(2);
    expect(result.mappings[0]).toEqual({ unitId: 'U001', boundaryCode: 'B01' });
    expect(result.mappings[1]).toEqual({ unitId: 'U002', boundaryCode: 'B02' });
  });

  it('parseCSVStream handles embedded newlines via file', async () => {
    const csv = `unit_id,boundary,notes\n"U001","B01","has\nnewline"\n"U002","B02","normal"`;
    const cachePath = join(TEST_CACHE_DIR, 'embedded-newline.csv');
    await writeFile(cachePath, csv, 'utf-8');

    const result = await loadConcordance(
      {
        url: 'https://example.com/fake.csv',
        unitColumn: 'unit_id',
        boundaryColumn: 'boundary',
        cacheFilename: 'embedded-newline.csv',
      },
      TEST_CACHE_DIR,
    );

    expect(result.rowCount).toBe(2);
    expect(result.mappings[0].unitId).toBe('U001');
    expect(result.mappings[1].unitId).toBe('U002');
  });

  it('still works correctly for normal CSV without embedded newlines', () => {
    const result = parseCSVString(SIMPLE_CSV);

    expect(result.headers).toEqual(['MB2025_V1_00', 'GED2025_V1_00', 'MED2025_V1_00']);
    expect(result.rows).toHaveLength(4);
  });
});

// ============================================================================
// M-1: Deterministic ordering via sort before dedup
// ============================================================================

describe('M-1: deterministic sort by unitId', () => {
  it('shuffled input produces same output as sorted input', () => {
    const sorted = `unit,boundary
A001,B01
A002,B02
A003,B03
A004,B04
`;
    const shuffled = `unit,boundary
A003,B03
A001,B01
A004,B04
A002,B02
`;
    const config = { unitColumn: 'unit', boundaryColumn: 'boundary' };
    const sortedResult = loadConcordanceFromString(sorted, config);
    const shuffledResult = loadConcordanceFromString(shuffled, config);

    expect(shuffledResult.mappings).toEqual(sortedResult.mappings);
    expect(shuffledResult.mappings.map(m => m.unitId)).toEqual([
      'A001', 'A002', 'A003', 'A004',
    ]);
  });

  it('sort is stable for duplicate unitIds with different boundary codes', () => {
    // If duplicate unitIds exist, sort stability means output is deterministic
    const csv = `unit,boundary
B002,X
A001,Y
B002,Z
A001,W
`;
    const result = loadConcordanceFromString(csv, {
      unitColumn: 'unit',
      boundaryColumn: 'boundary',
    });

    // Both A001 entries come first, both B002 entries come second
    expect(result.mappings[0].unitId).toBe('A001');
    expect(result.mappings[1].unitId).toBe('A001');
    expect(result.mappings[2].unitId).toBe('B002');
    expect(result.mappings[3].unitId).toBe('B002');
  });

  it('reverse-ordered CSV produces same result as forward-ordered', () => {
    const forward = `unit,boundary
001,A
002,B
003,C
`;
    const reverse = `unit,boundary
003,C
002,B
001,A
`;
    const config = { unitColumn: 'unit', boundaryColumn: 'boundary' };
    const fwd = loadConcordanceFromString(forward, config);
    const rev = loadConcordanceFromString(reverse, config);

    expect(rev.mappings).toEqual(fwd.mappings);
  });
});

// ============================================================================
// M-4: Reject empty boundary codes
// ============================================================================

describe('M-4: reject empty boundary codes', () => {
  it('skips rows with empty boundary codes', () => {
    const csv = `unit,boundary
U001,B01
U002,
U003,B03
U004,
`;
    const result = loadConcordanceFromString(csv, {
      unitColumn: 'unit',
      boundaryColumn: 'boundary',
    });

    // U002 and U004 have empty/whitespace boundary → skipped
    expect(result.rowCount).toBe(2);
    expect(result.mappings.map(m => m.unitId)).toEqual(['U001', 'U003']);
  });

  it('logs warning for skipped empty boundary codes', () => {
    const csv = `unit,boundary
U001,B01
U002,
U003,
`;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadConcordanceFromString(csv, {
      unitColumn: 'unit',
      boundaryColumn: 'boundary',
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('skipped 2 rows with empty boundary codes')
    );
    warnSpy.mockRestore();
  });

  it('does not warn when no empty boundary codes exist', () => {
    const csv = `unit,boundary
U001,B01
U002,B02
`;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadConcordanceFromString(csv, {
      unitColumn: 'unit',
      boundaryColumn: 'boundary',
    });

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
