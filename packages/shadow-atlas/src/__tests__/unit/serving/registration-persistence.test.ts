/**
 * Registration Service Persistence Tests (BR5-007)
 *
 * Tests that RegistrationService correctly persists state via InsertionLog
 * and can rebuild the tree from the log after restart.
 *
 * Uses real Poseidon2 hashing — no mocks.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { RegistrationService } from '../../../serving/registration-service';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

// Use depth=4 for fast tests (16 leaves max)
const TEST_DEPTH = 4;

function tmpLogPath(): string {
  const dir = join(tmpdir(), `reg-persist-test-${randomBytes(8).toString('hex')}`);
  return join(dir, 'insertion-log.ndjson');
}

describe('RegistrationService Persistence (BR5-007)', () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const p of cleanupPaths) {
      try {
        await fs.rm(p, { recursive: true });
      } catch { /* ignore */ }
    }
    cleanupPaths.length = 0;
  });

  it('creates insertion log file on startup', async () => {
    const logPath = tmpLogPath();
    cleanupPaths.push(join(logPath, '..'));

    const service = await RegistrationService.create(TEST_DEPTH, { path: logPath });

    const stat = await fs.stat(logPath);
    expect(stat.isFile()).toBe(true);

    await service.close();
  });

  it('writes to insertion log on each insertion', async () => {
    const logPath = tmpLogPath();
    cleanupPaths.push(join(logPath, '..'));

    const service = await RegistrationService.create(TEST_DEPTH, { path: logPath });

    await service.insertLeaf('0x' + '01'.padStart(64, '0'));
    await service.insertLeaf('0x' + '02'.padStart(64, '0'));
    await service.insertLeaf('0x' + '03'.padStart(64, '0'));

    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(3);

    // Verify first entry
    const entry = JSON.parse(lines[0]);
    expect(entry.index).toBe(0);
    expect(entry.leaf).toMatch(/^0x[0-9a-f]+$/);
    expect(typeof entry.ts).toBe('number');

    await service.close();
  });

  it('rebuilds identical tree state from insertion log', async () => {
    const logPath = tmpLogPath();
    cleanupPaths.push(join(logPath, '..'));

    // Phase 1: Insert leaves and record root
    const service1 = await RegistrationService.create(TEST_DEPTH, { path: logPath });

    const leaves = [
      '0x' + '0a'.padStart(64, '0'),
      '0x' + '0b'.padStart(64, '0'),
      '0x' + '0c'.padStart(64, '0'),
      '0x' + '0d'.padStart(64, '0'),
      '0x' + '0e'.padStart(64, '0'),
    ];

    for (const leaf of leaves) {
      await service1.insertLeaf(leaf);
    }

    const rootAfterInsert = service1.getRootHex();
    const leafCount1 = service1.leafCount;
    await service1.close();

    // Phase 2: Rebuild from log (simulate restart)
    const service2 = await RegistrationService.create(TEST_DEPTH, { path: logPath });

    // Verify identical state
    expect(service2.getRootHex()).toBe(rootAfterInsert);
    expect(service2.leafCount).toBe(leafCount1);

    // Verify proofs still work
    for (let i = 0; i < leaves.length; i++) {
      const proof = service2.getProof(i);
      expect(proof.leafIndex).toBe(i);
      expect(proof.userRoot).toBe(rootAfterInsert);
      expect(proof.userPath).toHaveLength(TEST_DEPTH);
    }

    await service2.close();
  });

  it('continues inserting after rebuild', async () => {
    const logPath = tmpLogPath();
    cleanupPaths.push(join(logPath, '..'));

    // Phase 1: Insert 3 leaves
    const service1 = await RegistrationService.create(TEST_DEPTH, { path: logPath });
    await service1.insertLeaf('0x' + '01'.padStart(64, '0'));
    await service1.insertLeaf('0x' + '02'.padStart(64, '0'));
    await service1.insertLeaf('0x' + '03'.padStart(64, '0'));
    const root3 = service1.getRootHex();
    await service1.close();

    // Phase 2: Rebuild and insert 2 more
    const service2 = await RegistrationService.create(TEST_DEPTH, { path: logPath });
    expect(service2.leafCount).toBe(3);
    expect(service2.getRootHex()).toBe(root3);

    await service2.insertLeaf('0x' + '04'.padStart(64, '0'));
    await service2.insertLeaf('0x' + '05'.padStart(64, '0'));

    expect(service2.leafCount).toBe(5);
    expect(service2.getRootHex()).not.toBe(root3);

    // Log should have 5 entries
    const content = await fs.readFile(logPath, 'utf8');
    expect(content.trim().split('\n')).toHaveLength(5);

    await service2.close();
  });

  it('rejects duplicates after rebuild (leafSet restored)', async () => {
    const logPath = tmpLogPath();
    cleanupPaths.push(join(logPath, '..'));

    const leaf = '0x' + '42'.padStart(64, '0');

    // Phase 1: Insert
    const service1 = await RegistrationService.create(TEST_DEPTH, { path: logPath });
    await service1.insertLeaf(leaf);
    await service1.close();

    // Phase 2: Rebuild — duplicate should be rejected
    const service2 = await RegistrationService.create(TEST_DEPTH, { path: logPath });
    await expect(service2.insertLeaf(leaf)).rejects.toThrow('DUPLICATE_LEAF');
    await service2.close();
  });

  it('handles empty log gracefully', async () => {
    const logPath = tmpLogPath();
    cleanupPaths.push(join(logPath, '..'));

    // Create empty log file
    await fs.mkdir(join(logPath, '..'), { recursive: true });
    await fs.writeFile(logPath, '');

    const service = await RegistrationService.create(TEST_DEPTH, { path: logPath });
    expect(service.leafCount).toBe(0);

    // Should work normally
    await service.insertLeaf('0x' + '01'.padStart(64, '0'));
    expect(service.leafCount).toBe(1);
    await service.close();
  });

  it('works without insertion log (backward compat)', async () => {
    // No logOptions — should work exactly as before
    const service = await RegistrationService.create(TEST_DEPTH);
    await service.insertLeaf('0x' + '01'.padStart(64, '0'));
    expect(service.leafCount).toBe(1);
    // No close() needed — no log to close
  });

  it('getInsertionLog returns null when no log configured', async () => {
    const service = await RegistrationService.create(TEST_DEPTH);
    expect(service.getInsertionLog()).toBeNull();
  });

  it('getInsertionLog returns log when configured', async () => {
    const logPath = tmpLogPath();
    cleanupPaths.push(join(logPath, '..'));

    const service = await RegistrationService.create(TEST_DEPTH, { path: logPath });
    expect(service.getInsertionLog()).not.toBeNull();
    await service.close();
  });
});
