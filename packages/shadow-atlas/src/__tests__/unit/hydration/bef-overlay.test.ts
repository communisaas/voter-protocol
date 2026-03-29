/**
 * Tests for BEF overlay delimiter handling (H-5, R102-HYD-F02).
 *
 * Verifies that:
 * 1. Explicit comma delimiter parses real Census BEF files correctly (GEOID,CDFP)
 * 2. Missing delimiter throws (auto-detect removed in R102-HYD-F02)
 * 3. ZZ district codes are skipped
 */

import { describe, it, expect } from 'vitest';
import { overlayBEFs, REDISTRICTED_STATES } from '../../../hydration/bef-overlay.js';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BlockRecord } from '../../../hydration/baf-parser.js';

// ============================================================================
// Helpers
// ============================================================================

function makeBlock(blockId: string, stateFips: string): BlockRecord {
  return {
    blockId,
    stateFips,
    countyFips: '001',
    tractFips: '000100',
    blockFips: '1000',
    districts: new Map([[0, `${stateFips}01`]]),
  };
}

async function setupBefCache(
  befDir: string,
  stateFips: string,
  content: string,
): Promise<void> {
  const befSubDir = join(befDir, 'bef');
  await mkdir(befSubDir, { recursive: true });
  const filename = REDISTRICTED_STATES.get(stateFips)!;
  await writeFile(join(befSubDir, filename), content, 'utf-8');
}

// ============================================================================
// Tests
// ============================================================================

describe('BEF overlay delimiter handling', () => {
  let testDir: string;

  async function setup(): Promise<string> {
    testDir = join(tmpdir(), `bef-test-${Date.now().toString(36)}`);
    await mkdir(testDir, { recursive: true });
    return testDir;
  }

  async function cleanup(): Promise<void> {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  it('parses comma-delimited BEF with GEOID,CDFP header (real Census format)', async () => {
    const dir = await setup();
    try {
      // Real Census 119th Congress BEF format: comma-delimited, 15-digit GEOIDs
      const befContent = `GEOID,CDFP
010000000001000,02
010000000001001,03
`;
      await setupBefCache(dir, '01', befContent);

      const blocks = new Map<string, BlockRecord>();
      blocks.set('010000000001000', makeBlock('010000000001000', '01'));
      blocks.set('010000000001001', makeBlock('010000000001001', '01'));

      const result = await overlayBEFs(blocks, {
        cacheDir: dir,
        delimiter: ',',
        log: () => {},
      });

      expect(result.totalUpdated).toBe(2);
      expect(blocks.get('010000000001000')!.districts.get(0)).toBe('0102');
      expect(blocks.get('010000000001001')!.districts.get(0)).toBe('0103');
    } finally {
      await cleanup();
    }
  });

  it('parses comma-delimited BEF with 15-digit GEOIDs', async () => {
    const dir = await setup();
    try {
      // Comma-delimited BEF content with 15-digit GEOIDs
      const befContent = `GEOID,CDFP
010000000002000,04
010000000002001,05
`;
      await setupBefCache(dir, '01', befContent);

      const blocks = new Map<string, BlockRecord>();
      blocks.set('010000000002000', makeBlock('010000000002000', '01'));
      blocks.set('010000000002001', makeBlock('010000000002001', '01'));

      const result = await overlayBEFs(blocks, {
        cacheDir: dir,
        delimiter: ',',
        log: () => {},
      });

      expect(result.totalUpdated).toBe(2);
      expect(blocks.get('010000000002000')!.districts.get(0)).toBe('0104');
      expect(blocks.get('010000000002001')!.districts.get(0)).toBe('0105');
    } finally {
      await cleanup();
    }
  });

  it('throws when no explicit delimiter is provided (R102-HYD-F02)', async () => {
    const dir = await setup();
    try {
      const befContent = `GEOID,CDFP
010000000003000,06
`;
      await setupBefCache(dir, '01', befContent);

      const blocks = new Map<string, BlockRecord>();
      blocks.set('010000000003000', makeBlock('010000000003000', '01'));

      await expect(
        overlayBEFs(blocks, {
          cacheDir: dir,
          // No explicit delimiter — should throw
          log: () => {},
        }),
      ).rejects.toThrow('No explicit delimiter');
    } finally {
      await cleanup();
    }
  });

  it('skips ZZ district codes', async () => {
    const dir = await setup();
    try {
      const befContent = `GEOID,CDFP
010000000004000,ZZ
010000000004001,07
`;
      await setupBefCache(dir, '01', befContent);

      const blocks = new Map<string, BlockRecord>();
      blocks.set('010000000004000', makeBlock('010000000004000', '01'));
      blocks.set('010000000004001', makeBlock('010000000004001', '01'));

      const result = await overlayBEFs(blocks, {
        cacheDir: dir,
        delimiter: ',',
        log: () => {},
      });

      // ZZ should be skipped
      expect(result.totalUpdated).toBe(1);
      expect(blocks.get('010000000004000')!.districts.get(0)).toBe('0101'); // unchanged
      expect(blocks.get('010000000004001')!.districts.get(0)).toBe('0107');
    } finally {
      await cleanup();
    }
  });
});
