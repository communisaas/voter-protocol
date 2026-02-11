/**
 * Insertion Log Tests (BR5-007)
 *
 * Tests the append-only NDJSON insertion log for Tree 1 persistence.
 * Covers: file creation, append, replay, export, crash safety.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InsertionLog, type InsertionLogEntry } from '../../../serving/insertion-log';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

// Unique temp directory per test run
function tmpLogPath(): string {
  const dir = join(tmpdir(), `insertion-log-test-${randomBytes(8).toString('hex')}`);
  return join(dir, 'insertion-log.ndjson');
}

describe('InsertionLog', () => {
  let logPath: string;
  let log: InsertionLog;

  beforeEach(async () => {
    logPath = tmpLogPath();
    log = await InsertionLog.open({ path: logPath, fsync: false });
  });

  afterEach(async () => {
    await log.close();
    // Clean up
    try {
      await fs.rm(join(logPath, '..'), { recursive: true });
    } catch { /* ignore */ }
  });

  describe('open', () => {
    it('creates log file and parent directories', async () => {
      const stat = await fs.stat(logPath);
      expect(stat.isFile()).toBe(true);
    });

    it('starts with zero entries on new file', () => {
      expect(log.count).toBe(0);
    });

    it('reports correct path', () => {
      expect(log.path).toBe(logPath);
    });
  });

  describe('append', () => {
    it('increments entry count', async () => {
      await log.append({ leaf: '0xabc', index: 0, ts: 1000 });
      expect(log.count).toBe(1);

      await log.append({ leaf: '0xdef', index: 1, ts: 1001 });
      expect(log.count).toBe(2);
    });

    it('writes valid NDJSON lines', async () => {
      await log.append({ leaf: '0xabc', index: 0, ts: 1000 });
      await log.append({ leaf: '0xdef', index: 1, ts: 1001 });

      const content = await fs.readFile(logPath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);

      const first = JSON.parse(lines[0]);
      expect(first.leaf).toBe('0xabc');
      expect(first.index).toBe(0);
      expect(first.ts).toBe(1000);

      const second = JSON.parse(lines[1]);
      expect(second.leaf).toBe('0xdef');
      expect(second.index).toBe(1);
    });
  });

  describe('replay', () => {
    it('returns empty array for empty log', async () => {
      const entries = await log.replay();
      expect(entries).toHaveLength(0);
    });

    it('returns entries in insertion order', async () => {
      const leaves = ['0x111', '0x222', '0x333', '0x444', '0x555'];
      for (let i = 0; i < leaves.length; i++) {
        await log.append({ leaf: leaves[i], index: i, ts: 1000 + i });
      }

      const entries = await log.replay();
      expect(entries).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(entries[i].leaf).toBe(leaves[i]);
        expect(entries[i].index).toBe(i);
      }
    });

    it('skips malformed lines', async () => {
      // Write some valid entries then corrupt the file
      await log.append({ leaf: '0xaaa', index: 0, ts: 1000 });
      await log.close();

      // Append garbage line
      await fs.appendFile(logPath, 'THIS IS NOT JSON\n');
      await fs.appendFile(logPath, '{"leaf":"0xbbb","index":1,"ts":1001}\n');

      // Reopen and replay
      log = await InsertionLog.open({ path: logPath, fsync: false });
      const entries = await log.replay();

      // Should have 2 valid entries (skipping the garbage)
      expect(entries).toHaveLength(2);
      expect(entries[0].leaf).toBe('0xaaa');
      expect(entries[1].leaf).toBe('0xbbb');
    });

    it('skips entries with missing fields', async () => {
      await log.close();

      // Write entry with missing 'ts' field
      await fs.appendFile(logPath, '{"leaf":"0xaaa","index":0}\n');
      // Valid entry
      await fs.appendFile(logPath, '{"leaf":"0xbbb","index":1,"ts":1001}\n');

      log = await InsertionLog.open({ path: logPath, fsync: false });
      const entries = await log.replay();

      expect(entries).toHaveLength(1);
      expect(entries[0].leaf).toBe('0xbbb');
    });
  });

  describe('export', () => {
    it('exports the full log as a Buffer', async () => {
      await log.append({ leaf: '0xabc', index: 0, ts: 1000 });
      await log.append({ leaf: '0xdef', index: 1, ts: 1001 });

      const buffer = await log.export();
      const content = buffer.toString('utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);
    });
  });

  describe('persistence across open/close', () => {
    it('preserves entries after close and reopen', async () => {
      await log.append({ leaf: '0x111', index: 0, ts: 1000 });
      await log.append({ leaf: '0x222', index: 1, ts: 1001 });
      await log.append({ leaf: '0x333', index: 2, ts: 1002 });
      await log.close();

      // Reopen
      log = await InsertionLog.open({ path: logPath, fsync: false });
      expect(log.count).toBe(3);

      const entries = await log.replay();
      expect(entries).toHaveLength(3);
      expect(entries[2].leaf).toBe('0x333');
    });

    it('appends to existing log after reopen', async () => {
      await log.append({ leaf: '0x111', index: 0, ts: 1000 });
      await log.close();

      log = await InsertionLog.open({ path: logPath, fsync: false });
      await log.append({ leaf: '0x222', index: 1, ts: 1001 });

      const entries = await log.replay();
      expect(entries).toHaveLength(2);
      expect(entries[0].leaf).toBe('0x111');
      expect(entries[1].leaf).toBe('0x222');
    });
  });

  describe('concurrent writes', () => {
    it('serializes concurrent appends correctly', async () => {
      // Fire 20 appends concurrently
      const promises = Array.from({ length: 20 }, (_, i) =>
        log.append({ leaf: `0x${i.toString(16).padStart(4, '0')}`, index: i, ts: 1000 + i })
      );
      await Promise.all(promises);

      expect(log.count).toBe(20);

      const entries = await log.replay();
      expect(entries).toHaveLength(20);

      // All indices should be present (order may vary due to concurrency)
      const indices = new Set(entries.map(e => e.index));
      for (let i = 0; i < 20; i++) {
        expect(indices.has(i)).toBe(true);
      }
    });
  });
});
