/**
 * SyncService Tests (BR5-007 / SA-008)
 *
 * Tests the IPFS sync service for insertion log persistence.
 * Covers: initialization, metadata persistence, upload notification, recovery.
 *
 * Uses mock pinning services to avoid real network calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncService, type PinnedLogMetadata } from '../../../serving/sync-service';
import { InsertionLog } from '../../../serving/insertion-log';
import type { IPinningService } from '../../../distribution/regional-pinning-service';
import type { PinResult, PinningServiceType, Region } from '../../../distribution/types';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

// ============================================================================
// Mock Pinning Service
// ============================================================================

function createMockPinningService(
  type: PinningServiceType = 'storacha',
  shouldSucceed = true,
): IPinningService {
  return {
    type,
    region: 'americas-east' as Region,
    pin: vi.fn(async (): Promise<PinResult> => {
      if (!shouldSucceed) {
        return {
          success: false,
          cid: '',
          service: type,
          region: 'americas-east' as Region,
          pinnedAt: new Date(),
          sizeBytes: 0,
          durationMs: 10,
          error: 'Mock pin failure',
        };
      }
      return {
        success: true,
        cid: `Qm${randomBytes(16).toString('hex')}`,
        service: type,
        region: 'americas-east' as Region,
        pinnedAt: new Date(),
        sizeBytes: 100,
        durationMs: 50,
      };
    }),
    verify: vi.fn(async () => true),
    unpin: vi.fn(async () => {}),
    healthCheck: vi.fn(async () => true),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function tmpDir(): string {
  return join(tmpdir(), `sync-test-${randomBytes(8).toString('hex')}`);
}

async function createTestLog(dir: string, entries: number): Promise<InsertionLog> {
  const logPath = join(dir, 'test-insertion-log.ndjson');
  const log = await InsertionLog.open({ path: logPath, fsync: false });
  for (let i = 0; i < entries; i++) {
    await log.append({
      leaf: `0x${(i + 1).toString(16).padStart(64, '0')}`,
      index: i,
      ts: Date.now(),
    });
  }
  return log;
}

// ============================================================================
// Tests
// ============================================================================

describe('SyncService', () => {
  let dataDir: string;
  const cleanupDirs: string[] = [];

  beforeEach(async () => {
    dataDir = tmpDir();
    cleanupDirs.push(dataDir);
  });

  afterEach(async () => {
    for (const dir of cleanupDirs) {
      try {
        await fs.rm(dir, { recursive: true });
      } catch { /* ignore */ }
    }
    cleanupDirs.length = 0;
  });

  describe('init', () => {
    it('creates data directory', async () => {
      const sync = new SyncService({ dataDir });
      await sync.init();

      const stat = await fs.stat(dataDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('loads existing metadata on init', async () => {
      // Pre-create metadata
      await fs.mkdir(dataDir, { recursive: true });
      const metadata: PinnedLogMetadata = {
        cid: 'QmTestCID123',
        entryCount: 42,
        uploadedAt: Date.now(),
        services: ['storacha'],
      };
      await fs.writeFile(
        join(dataDir, 'latest-log-cid.json'),
        JSON.stringify(metadata),
      );

      const sync = new SyncService({ dataDir });
      await sync.init();

      expect(sync.getLatestMetadata()).not.toBeNull();
      expect(sync.getLatestMetadata()!.cid).toBe('QmTestCID123');
      expect(sync.getLatestMetadata()!.entryCount).toBe(42);
    });

    it('starts with null metadata when no prior state', async () => {
      const sync = new SyncService({ dataDir });
      await sync.init();

      expect(sync.getLatestMetadata()).toBeNull();
    });
  });

  describe('uploadLog', () => {
    it('uploads to all pinning services', async () => {
      const mockStoracha = createMockPinningService('storacha');
      const mockLighthouse = createMockPinningService('lighthouse' as PinningServiceType);

      const sync = new SyncService({
        dataDir,
        pinningServices: [mockStoracha, mockLighthouse],
      });
      await sync.init();

      const log = await createTestLog(dataDir, 5);
      const result = await sync.uploadLog(log);

      expect(result).not.toBeNull();
      expect(result!.cid).toMatch(/^Qm/);
      expect(result!.entryCount).toBe(5);
      expect(result!.services).toHaveLength(2);
      expect(mockStoracha.pin).toHaveBeenCalledOnce();
      expect(mockLighthouse.pin).toHaveBeenCalledOnce();

      await log.close();
    });

    it('persists metadata to disk after upload', async () => {
      const mockService = createMockPinningService();
      const sync = new SyncService({
        dataDir,
        pinningServices: [mockService],
      });
      await sync.init();

      const log = await createTestLog(dataDir, 3);
      await sync.uploadLog(log);

      // Read metadata file directly
      const metadataContent = await fs.readFile(
        join(dataDir, 'latest-log-cid.json'),
        'utf8',
      );
      const metadata = JSON.parse(metadataContent);
      expect(metadata.cid).toMatch(/^Qm/);
      expect(metadata.entryCount).toBe(3);

      await log.close();
    });

    it('succeeds when at least one service works', async () => {
      const goodService = createMockPinningService('storacha', true);
      const badService = createMockPinningService('pinata', false);

      const sync = new SyncService({
        dataDir,
        pinningServices: [goodService, badService],
      });
      await sync.init();

      const log = await createTestLog(dataDir, 2);
      const result = await sync.uploadLog(log);

      expect(result).not.toBeNull();
      expect(result!.services).toContain('storacha');
      expect(result!.services).not.toContain('pinata');

      await log.close();
    });

    it('returns null when all services fail', async () => {
      const badService1 = createMockPinningService('storacha', false);
      const badService2 = createMockPinningService('pinata', false);

      const sync = new SyncService({
        dataDir,
        pinningServices: [badService1, badService2],
      });
      await sync.init();

      const log = await createTestLog(dataDir, 2);
      const result = await sync.uploadLog(log);

      expect(result).toBeNull();
      await log.close();
    });

    it('returns null when no services configured', async () => {
      const sync = new SyncService({ dataDir });
      await sync.init();

      const log = await createTestLog(dataDir, 2);
      const result = await sync.uploadLog(log);

      expect(result).toBeNull();
      await log.close();
    });
  });

  describe('notifyInsertion', () => {
    it('triggers upload after uploadInterval insertions', async () => {
      const mockService = createMockPinningService();
      const sync = new SyncService({
        dataDir,
        pinningServices: [mockService],
        uploadInterval: 3,
      });
      await sync.init();

      const log = await createTestLog(dataDir, 5);

      // First 2 notifications — no upload
      sync.notifyInsertion(log);
      sync.notifyInsertion(log);
      expect(mockService.pin).not.toHaveBeenCalled();

      // 3rd notification — triggers upload
      sync.notifyInsertion(log);

      // Wait for async fire-and-forget
      await new Promise(r => setTimeout(r, 100));
      expect(mockService.pin).toHaveBeenCalledOnce();

      await log.close();
    });
  });

  describe('legacy compat', () => {
    it('start() and stop() do not throw', () => {
      const sync = new SyncService({ dataDir });
      expect(() => sync.start()).not.toThrow();
      expect(() => sync.stop()).not.toThrow();
    });

    it('getLatestSnapshot returns null with no uploads', async () => {
      const sync = new SyncService({ dataDir });
      await sync.init();
      const snapshot = await sync.getLatestSnapshot();
      expect(snapshot).toBeNull();
    });

    it('listSnapshots returns latest after upload', async () => {
      const mockService = createMockPinningService();
      const sync = new SyncService({
        dataDir,
        pinningServices: [mockService],
      });
      await sync.init();

      const log = await createTestLog(dataDir, 2);
      await sync.uploadLog(log);

      const snapshots = await sync.listSnapshots();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].cid).toMatch(/^Qm/);

      await log.close();
    });
  });
});
