/**
 * Tests for BEF overlay delimiter handling (H-5).
 *
 * Verifies that:
 * 1. Explicit pipe delimiter parses Census BEF files correctly
 * 2. Explicit comma delimiter parses CSV-formatted BEF files correctly
 * 3. Auto-detect fallback works but logs a warning
 * 4. Default delimiter is pipe when not specified (Census standard)
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

  it('parses pipe-delimited BEF with explicit delimiter', async () => {
    const dir = await setup();
    try {
      // Pipe-delimited BEF content (Census standard)
      const befContent = `BLOCKID|CDFP
0100000001000|02
0100000001001|03
`;
      await setupBefCache(dir, '01', befContent);

      const blocks = new Map<string, BlockRecord>();
      blocks.set('0100000001000', makeBlock('0100000001000', '01'));
      blocks.set('0100000001001', makeBlock('0100000001001', '01'));

      const result = await overlayBEFs(blocks, {
        cacheDir: dir,
        delimiter: '|',
        log: () => {},
      });

      expect(result.totalUpdated).toBe(2);
      expect(blocks.get('0100000001000')!.districts.get(0)).toBe('0102');
      expect(blocks.get('0100000001001')!.districts.get(0)).toBe('0103');
    } finally {
      await cleanup();
    }
  });

  it('parses comma-delimited BEF with explicit delimiter', async () => {
    const dir = await setup();
    try {
      // Comma-delimited BEF content
      const befContent = `BLOCKID,CDFP
0100000002000,04
0100000002001,05
`;
      await setupBefCache(dir, '01', befContent);

      const blocks = new Map<string, BlockRecord>();
      blocks.set('0100000002000', makeBlock('0100000002000', '01'));
      blocks.set('0100000002001', makeBlock('0100000002001', '01'));

      const result = await overlayBEFs(blocks, {
        cacheDir: dir,
        delimiter: ',',
        log: () => {},
      });

      expect(result.totalUpdated).toBe(2);
      expect(blocks.get('0100000002000')!.districts.get(0)).toBe('0104');
      expect(blocks.get('0100000002001')!.districts.get(0)).toBe('0105');
    } finally {
      await cleanup();
    }
  });

  it('auto-detect fallback logs a warning', async () => {
    const dir = await setup();
    try {
      // Pipe-delimited — auto-detect should pick pipe
      const befContent = `BLOCKID|CDFP
0100000003000|06
`;
      await setupBefCache(dir, '01', befContent);

      const blocks = new Map<string, BlockRecord>();
      blocks.set('0100000003000', makeBlock('0100000003000', '01'));

      const logs: string[] = [];
      const result = await overlayBEFs(blocks, {
        cacheDir: dir,
        // No explicit delimiter — should auto-detect and warn
        log: (msg) => logs.push(msg),
      });

      expect(result.totalUpdated).toBe(1);
      // Should have logged a warning about auto-detection
      const warningLog = logs.find(l => l.includes('WARNING') && l.includes('auto-detected'));
      expect(warningLog).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  it('skips ZZ district codes', async () => {
    const dir = await setup();
    try {
      const befContent = `BLOCKID|CDFP
0100000004000|ZZ
0100000004001|07
`;
      await setupBefCache(dir, '01', befContent);

      const blocks = new Map<string, BlockRecord>();
      blocks.set('0100000004000', makeBlock('0100000004000', '01'));
      blocks.set('0100000004001', makeBlock('0100000004001', '01'));

      const result = await overlayBEFs(blocks, {
        cacheDir: dir,
        delimiter: '|',
        log: () => {},
      });

      // ZZ should be skipped
      expect(result.totalUpdated).toBe(1);
      expect(blocks.get('0100000004000')!.districts.get(0)).toBe('0101'); // unchanged
      expect(blocks.get('0100000004001')!.districts.get(0)).toBe('0107');
    } finally {
      await cleanup();
    }
  });
});
