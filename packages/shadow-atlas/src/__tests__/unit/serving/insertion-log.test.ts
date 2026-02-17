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
      const { entries } = await log.replay();
      expect(entries).toHaveLength(0);
    });

    it('returns entries in insertion order', async () => {
      const leaves = ['0x111', '0x222', '0x333', '0x444', '0x555'];
      for (let i = 0; i < leaves.length; i++) {
        await log.append({ leaf: leaves[i], index: i, ts: 1000 + i });
      }

      const { entries } = await log.replay();
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
      const { entries } = await log.replay();

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
      const { entries } = await log.replay();

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

      const { entries } = await log.replay();
      expect(entries).toHaveLength(3);
      expect(entries[2].leaf).toBe('0x333');
    });

    it('appends to existing log after reopen', async () => {
      await log.append({ leaf: '0x111', index: 0, ts: 1000 });
      await log.close();

      log = await InsertionLog.open({ path: logPath, fsync: false });
      await log.append({ leaf: '0x222', index: 1, ts: 1001 });

      const { entries } = await log.replay();
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

      const { entries } = await log.replay();
      expect(entries).toHaveLength(20);

      // All indices should be present (order may vary due to concurrency)
      const indices = new Set(entries.map(e => e.index));
      for (let i = 0; i < 20; i++) {
        expect(indices.has(i)).toBe(true);
      }
    });
  });

  describe('v2 integrity', () => {
    describe('hash chain integrity', () => {
      it('validates complete hash chain without signer', async () => {
        // Append 5 entries without a signer
        for (let i = 0; i < 5; i++) {
          await log.append({ leaf: `0x${i}`, index: i, ts: 1000 + i });
        }

        const { verification } = await log.replay();
        expect(verification.validChainLinks).toBe(5);
        expect(verification.brokenLinks).toBe(0);
        expect(verification.unsignedEntries).toBe(5);
        expect(verification.totalEntries).toBe(5);
      });

      it('detects tampering in middle of chain', async () => {
        // Append 5 entries
        for (let i = 0; i < 5; i++) {
          await log.append({ leaf: `0x${i}`, index: i, ts: 1000 + i });
        }
        await log.close();

        // Tamper with middle entry (change leaf but keep prevHash)
        const content = await fs.readFile(logPath, 'utf8');
        const lines = content.trim().split('\n');
        const middle = JSON.parse(lines[2]);
        middle.leaf = '0xTAMPERED';
        lines[2] = JSON.stringify(middle);
        await fs.writeFile(logPath, lines.join('\n') + '\n');

        // Reopen and replay
        log = await InsertionLog.open({ path: logPath, fsync: false });
        const { verification } = await log.replay();

        // The entry AFTER the tampered one will have wrong prevHash
        expect(verification.brokenLinks).toBeGreaterThanOrEqual(1);
      });
    });

    describe('signature verification', () => {
      it('signs and verifies entries round-trip', async () => {
        const { ServerSigner } = await import('../../../serving/signing');
        const signer = await ServerSigner.init(); // ephemeral key

        await log.close();
        log = await InsertionLog.open({ path: logPath, fsync: false, signer });

        // Append 3 signed entries
        await log.append({ leaf: '0xa', index: 0, ts: 1000 });
        await log.append({ leaf: '0xb', index: 1, ts: 1001 });
        await log.append({ leaf: '0xc', index: 2, ts: 1002 });

        const { verification } = await log.replay(signer);
        expect(verification.validSignatures).toBe(3);
        expect(verification.unsignedEntries).toBe(0);
        expect(verification.invalidSignatures).toBe(0);
        expect(verification.totalEntries).toBe(3);
      });

      it('detects signature tampering', async () => {
        const { ServerSigner } = await import('../../../serving/signing');
        const signer = await ServerSigner.init();

        await log.close();
        log = await InsertionLog.open({ path: logPath, fsync: false, signer });

        // Append 3 signed entries
        await log.append({ leaf: '0xa', index: 0, ts: 1000 });
        await log.append({ leaf: '0xb', index: 1, ts: 1001 });
        await log.append({ leaf: '0xc', index: 2, ts: 1002 });
        await log.close();

        // Tamper with entry 2's leaf but keep its signature
        const content = await fs.readFile(logPath, 'utf8');
        const lines = content.trim().split('\n');
        const entry = JSON.parse(lines[1]);
        entry.leaf = '0xTAMPERED';
        lines[1] = JSON.stringify(entry);
        await fs.writeFile(logPath, lines.join('\n') + '\n');

        // Reopen and replay with signer
        log = await InsertionLog.open({ path: logPath, fsync: false });
        const { verification } = await log.replay(signer);

        expect(verification.invalidSignatures).toBeGreaterThanOrEqual(1);
      });
    });

    describe('attestation hash support', () => {
      it('preserves attestationHash round-trip', async () => {
        await log.append({
          leaf: '0xabc',
          index: 0,
          ts: 1000,
          attestationHash: '0xdeadbeef'
        });

        const { entries } = await log.replay();
        expect(entries).toHaveLength(1);
        expect(entries[0].attestationHash).toBe('0xdeadbeef');
      });
    });

    describe('backward compatibility', () => {
      it('handles mixed v1 and v2 entries', async () => {
        const { ServerSigner } = await import('../../../serving/signing');
        const signer = await ServerSigner.init();

        await log.close();

        // Write 2 v1 entries manually (no prevHash, no sig)
        await fs.appendFile(logPath, '{"leaf":"0xv1a","index":0,"ts":1000}\n');
        await fs.appendFile(logPath, '{"leaf":"0xv1b","index":1,"ts":1001}\n');

        // Reopen with signer and append v2 entries
        log = await InsertionLog.open({ path: logPath, fsync: false, signer });
        await log.append({ leaf: '0xv2a', index: 2, ts: 1002 });
        await log.append({ leaf: '0xv2b', index: 3, ts: 1003 });
        await log.append({ leaf: '0xv2c', index: 4, ts: 1004 });

        const { verification } = await log.replay(signer);
        expect(verification.legacyEntries).toBe(2);
        expect(verification.validSignatures).toBe(3);
        expect(verification.totalEntries).toBe(5);
      });
    });

    describe('crash recovery detection', () => {
      it('sets lastEntryBroken=true when only last entry is corrupted', async () => {
        // Append 5 entries
        for (let i = 0; i < 5; i++) {
          await log.append({ leaf: `0x${i}`, index: i, ts: 1000 + i });
        }
        await log.close();

        // Corrupt ONLY the last entry's prevHash
        const content = await fs.readFile(logPath, 'utf8');
        const lines = content.trim().split('\n');
        const lastEntry = JSON.parse(lines[4]);
        lastEntry.prevHash = '0xCORRUPTED';
        lines[4] = JSON.stringify(lastEntry);
        await fs.writeFile(logPath, lines.join('\n') + '\n');

        // Reopen and replay
        log = await InsertionLog.open({ path: logPath, fsync: false });
        const { verification } = await log.replay();

        expect(verification.lastEntryBroken).toBe(true);
        expect(verification.brokenLinks).toBe(1);
      });

      it('sets lastEntryBroken=false when multiple entries are corrupted', async () => {
        // Append 5 entries
        for (let i = 0; i < 5; i++) {
          await log.append({ leaf: `0x${i}`, index: i, ts: 1000 + i });
        }
        await log.close();

        // Corrupt entries 2 and 4 (0-indexed)
        const content = await fs.readFile(logPath, 'utf8');
        const lines = content.trim().split('\n');
        
        const entry2 = JSON.parse(lines[2]);
        entry2.prevHash = '0xCORRUPT_A';
        lines[2] = JSON.stringify(entry2);

        const entry4 = JSON.parse(lines[4]);
        entry4.prevHash = '0xCORRUPT_B';
        lines[4] = JSON.stringify(entry4);

        await fs.writeFile(logPath, lines.join('\n') + '\n');

        // Reopen and replay
        log = await InsertionLog.open({ path: logPath, fsync: false });
        const { verification } = await log.replay();

        expect(verification.lastEntryBroken).toBe(false);
        expect(verification.brokenLinks).toBeGreaterThanOrEqual(2);
      });
    });
  });
});
