/**
 * SnapshotManager Unit Tests
 *
 * Tests for the versioned Atlas snapshot management system:
 * - createSnapshot() creates valid snapshot with monotonic version
 * - getLatest() returns most recent snapshot
 * - getByVersion() retrieves correct snapshot
 * - diff() computes layer changes correctly
 * - setIpfsCid() updates snapshot with CID
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SnapshotManager } from '../../../versioning/snapshot-manager.js';
import type { AtlasBuildResult, LayerValidationResult } from '../../../core/types.js';

const TEST_STORAGE_DIR = join(process.cwd(), 'test-output', 'snapshot-manager-test');

/**
 * Create a mock AtlasBuildResult for testing
 */
function createMockBuildResult(options?: {
  jobId?: string;
  merkleRoot?: bigint;
  totalBoundaries?: number;
  layers?: string[];
  duration?: number;
}): AtlasBuildResult {
  const layers = options?.layers ?? ['cd', 'county'];
  const layerCounts: Record<string, number> = {};
  const layerValidations: LayerValidationResult[] = [];

  for (const layer of layers) {
    const boundaryCount = layer === 'cd' ? 8 : 72;
    layerCounts[layer] = boundaryCount;
    layerValidations.push({
      layer,
      qualityScore: 95,
      boundaryCount,
      expectedCount: boundaryCount,
      validation: null,
    });
  }

  return {
    jobId: options?.jobId ?? 'test-job-12345',
    merkleRoot: options?.merkleRoot ?? 123456789n,
    totalBoundaries: options?.totalBoundaries ?? Object.values(layerCounts).reduce((a, b) => a + b, 0),
    layerCounts,
    layerValidations,
    treeDepth: 5,
    duration: options?.duration ?? 1500,
    timestamp: new Date(),
    treeType: 'flat',
  };
}

describe('SnapshotManager', () => {
  let manager: SnapshotManager;

  beforeEach(async () => {
    // Create test directory
    await mkdir(TEST_STORAGE_DIR, { recursive: true });

    // Create manager in file-based mode (no SQLite)
    manager = new SnapshotManager(TEST_STORAGE_DIR);
    await manager.initialize();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(TEST_STORAGE_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('createSnapshot', () => {
    it('should create valid snapshot with monotonic version starting at 1', async () => {
      const buildResult = createMockBuildResult();

      const snapshot = await manager.createSnapshot(buildResult, {
        tigerVintage: 2024,
        statesIncluded: ['55'],
      });

      // Verify snapshot structure
      expect(snapshot.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(snapshot.version).toBe(1);
      expect(snapshot.merkleRoot).toBe(123456789n);
      expect(snapshot.timestamp).toBeInstanceOf(Date);
      expect(snapshot.layerCounts).toEqual({ cd: 8, county: 72 });
    });

    it('should increment version for subsequent snapshots', async () => {
      const buildResult1 = createMockBuildResult({ merkleRoot: 111n });
      const buildResult2 = createMockBuildResult({ merkleRoot: 222n });
      const buildResult3 = createMockBuildResult({ merkleRoot: 333n });

      const snapshot1 = await manager.createSnapshot(buildResult1, { tigerVintage: 2024 });
      const snapshot2 = await manager.createSnapshot(buildResult2, { tigerVintage: 2024 });
      const snapshot3 = await manager.createSnapshot(buildResult3, { tigerVintage: 2024 });

      expect(snapshot1.version).toBe(1);
      expect(snapshot2.version).toBe(2);
      expect(snapshot3.version).toBe(3);
    });

    it('should populate metadata from build result', async () => {
      const buildResult = createMockBuildResult({
        jobId: 'custom-job-id',
        duration: 2500,
        layers: ['cd', 'sldu', 'county'],
      });

      const snapshot = await manager.createSnapshot(buildResult, {
        tigerVintage: 2024,
        statesIncluded: ['55', '01'],
        notes: 'Test snapshot for unit tests',
      });

      expect(snapshot.metadata.tigerVintage).toBe(2024);
      expect(snapshot.metadata.statesIncluded).toEqual(['55', '01']);
      expect(snapshot.metadata.layersIncluded).toContain('cd');
      expect(snapshot.metadata.layersIncluded).toContain('sldu');
      expect(snapshot.metadata.layersIncluded).toContain('county');
      expect(snapshot.metadata.buildDurationMs).toBe(2500);
      expect(snapshot.metadata.jobId).toBe('custom-job-id');
      expect(snapshot.metadata.notes).toBe('Test snapshot for unit tests');
    });

    it('should compute source checksums from layer validations', async () => {
      const buildResult = createMockBuildResult({ layers: ['cd', 'county'] });

      const snapshot = await manager.createSnapshot(buildResult, {
        tigerVintage: 2024,
      });

      expect(snapshot.metadata.sourceChecksums).toBeDefined();
      expect(typeof snapshot.metadata.sourceChecksums['cd']).toBe('string');
      expect(typeof snapshot.metadata.sourceChecksums['county']).toBe('string');
      expect(snapshot.metadata.sourceChecksums['cd'].length).toBe(64); // SHA-256 hex
    });

    it('should assign unique IDs to each snapshot', async () => {
      const buildResult = createMockBuildResult();

      const snapshot1 = await manager.createSnapshot(buildResult, { tigerVintage: 2024 });
      const snapshot2 = await manager.createSnapshot(buildResult, { tigerVintage: 2024 });
      const snapshot3 = await manager.createSnapshot(buildResult, { tigerVintage: 2024 });

      const ids = new Set([snapshot1.id, snapshot2.id, snapshot3.id]);
      expect(ids.size).toBe(3); // All unique
    });
  });

  describe('getLatest', () => {
    it('should return null when no snapshots exist', async () => {
      const latest = await manager.getLatest();
      expect(latest).toBeNull();
    });

    it('should return most recent snapshot', async () => {
      const buildResult1 = createMockBuildResult({ merkleRoot: 111n });
      const buildResult2 = createMockBuildResult({ merkleRoot: 222n });
      const buildResult3 = createMockBuildResult({ merkleRoot: 333n });

      await manager.createSnapshot(buildResult1, { tigerVintage: 2024 });
      await manager.createSnapshot(buildResult2, { tigerVintage: 2024 });
      const snapshot3 = await manager.createSnapshot(buildResult3, { tigerVintage: 2024 });

      const latest = await manager.getLatest();

      expect(latest).not.toBeNull();
      expect(latest!.id).toBe(snapshot3.id);
      expect(latest!.version).toBe(3);
      expect(latest!.merkleRoot).toBe(333n);
    });

    it('should return snapshot with full metadata', async () => {
      const buildResult = createMockBuildResult({
        layers: ['cd', 'sldu', 'county'],
      });

      await manager.createSnapshot(buildResult, {
        tigerVintage: 2024,
        statesIncluded: ['55', '01', '06'],
        notes: 'Full metadata test',
      });

      const latest = await manager.getLatest();

      expect(latest).not.toBeNull();
      expect(latest!.metadata.tigerVintage).toBe(2024);
      expect(latest!.metadata.statesIncluded).toEqual(['55', '01', '06']);
      expect(latest!.metadata.notes).toBe('Full metadata test');
    });
  });

  describe('getByVersion', () => {
    it('should return null for non-existent version', async () => {
      const snapshot = await manager.getByVersion(999);
      expect(snapshot).toBeNull();
    });

    it('should retrieve correct snapshot by version', async () => {
      const buildResult1 = createMockBuildResult({ merkleRoot: 111n });
      const buildResult2 = createMockBuildResult({ merkleRoot: 222n });
      const buildResult3 = createMockBuildResult({ merkleRoot: 333n });

      await manager.createSnapshot(buildResult1, { tigerVintage: 2024 });
      const snapshot2 = await manager.createSnapshot(buildResult2, { tigerVintage: 2024 });
      await manager.createSnapshot(buildResult3, { tigerVintage: 2024 });

      const retrieved = await manager.getByVersion(2);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(snapshot2.id);
      expect(retrieved!.version).toBe(2);
      expect(retrieved!.merkleRoot).toBe(222n);
    });

    it('should retrieve first version correctly', async () => {
      const buildResult = createMockBuildResult({ merkleRoot: 111n });
      const snapshot1 = await manager.createSnapshot(buildResult, { tigerVintage: 2024 });

      // Create more snapshots
      await manager.createSnapshot(createMockBuildResult({ merkleRoot: 222n }), { tigerVintage: 2024 });
      await manager.createSnapshot(createMockBuildResult({ merkleRoot: 333n }), { tigerVintage: 2024 });

      const retrieved = await manager.getByVersion(1);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(snapshot1.id);
      expect(retrieved!.merkleRoot).toBe(111n);
    });
  });

  describe('getById', () => {
    it('should return null for non-existent ID', async () => {
      const snapshot = await manager.getById('non-existent-id-12345');
      expect(snapshot).toBeNull();
    });

    it('should retrieve correct snapshot by ID', async () => {
      const buildResult1 = createMockBuildResult({ merkleRoot: 111n });
      const buildResult2 = createMockBuildResult({ merkleRoot: 222n });

      await manager.createSnapshot(buildResult1, { tigerVintage: 2024 });
      const snapshot2 = await manager.createSnapshot(buildResult2, { tigerVintage: 2024 });

      const retrieved = await manager.getById(snapshot2.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(snapshot2.id);
      expect(retrieved!.merkleRoot).toBe(222n);
    });
  });

  describe('list', () => {
    it('should return empty array when no snapshots exist', async () => {
      const snapshots = await manager.list(10, 0);
      expect(snapshots).toEqual([]);
    });

    it('should return snapshots sorted by version DESC', async () => {
      await manager.createSnapshot(createMockBuildResult({ merkleRoot: 111n }), { tigerVintage: 2024 });
      await manager.createSnapshot(createMockBuildResult({ merkleRoot: 222n }), { tigerVintage: 2024 });
      await manager.createSnapshot(createMockBuildResult({ merkleRoot: 333n }), { tigerVintage: 2024 });

      const snapshots = await manager.list(10, 0);

      expect(snapshots.length).toBe(3);
      expect(snapshots[0].version).toBe(3); // Most recent first
      expect(snapshots[1].version).toBe(2);
      expect(snapshots[2].version).toBe(1);
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await manager.createSnapshot(
          createMockBuildResult({ merkleRoot: BigInt(i + 1) }),
          { tigerVintage: 2024 }
        );
      }

      const snapshots = await manager.list(2, 0);

      expect(snapshots.length).toBe(2);
      expect(snapshots[0].version).toBe(5);
      expect(snapshots[1].version).toBe(4);
    });

    it('should respect offset parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await manager.createSnapshot(
          createMockBuildResult({ merkleRoot: BigInt(i + 1) }),
          { tigerVintage: 2024 }
        );
      }

      const snapshots = await manager.list(2, 2);

      expect(snapshots.length).toBe(2);
      expect(snapshots[0].version).toBe(3);
      expect(snapshots[1].version).toBe(2);
    });

    it('should include totalBoundaries in list entries', async () => {
      await manager.createSnapshot(
        createMockBuildResult({ layers: ['cd', 'county'] }),
        { tigerVintage: 2024 }
      );

      const snapshots = await manager.list(10, 0);

      expect(snapshots[0].totalBoundaries).toBe(80); // 8 + 72
    });
  });

  describe('diff', () => {
    it('should throw error for non-existent source version', async () => {
      await manager.createSnapshot(createMockBuildResult(), { tigerVintage: 2024 });

      await expect(manager.diff(999, 1)).rejects.toThrow('Snapshot version 999 not found');
    });

    it('should throw error for non-existent target version', async () => {
      await manager.createSnapshot(createMockBuildResult(), { tigerVintage: 2024 });

      await expect(manager.diff(1, 999)).rejects.toThrow('Snapshot version 999 not found');
    });

    it('should detect layers added', async () => {
      await manager.createSnapshot(
        createMockBuildResult({ layers: ['cd'], merkleRoot: 111n }),
        { tigerVintage: 2024, layersIncluded: ['cd'] }
      );

      await manager.createSnapshot(
        createMockBuildResult({ layers: ['cd', 'county'], merkleRoot: 222n }),
        { tigerVintage: 2024, layersIncluded: ['cd', 'county'] }
      );

      const diff = await manager.diff(1, 2);

      expect(diff.layersAdded).toContain('county');
      expect(diff.layersRemoved).toEqual([]);
    });

    it('should detect layers removed', async () => {
      await manager.createSnapshot(
        createMockBuildResult({ layers: ['cd', 'county'], merkleRoot: 111n }),
        { tigerVintage: 2024, layersIncluded: ['cd', 'county'] }
      );

      await manager.createSnapshot(
        createMockBuildResult({ layers: ['cd'], merkleRoot: 222n }),
        { tigerVintage: 2024, layersIncluded: ['cd'] }
      );

      const diff = await manager.diff(1, 2);

      expect(diff.layersRemoved).toContain('county');
      expect(diff.layersAdded).toEqual([]);
    });

    it('should detect layers modified (boundary count changed)', async () => {
      const buildResult1 = createMockBuildResult({ layers: ['cd'], merkleRoot: 111n });
      buildResult1.layerCounts['cd'] = 8;

      const buildResult2 = createMockBuildResult({ layers: ['cd'], merkleRoot: 222n });
      buildResult2.layerCounts['cd'] = 10;

      await manager.createSnapshot(buildResult1, { tigerVintage: 2024, layersIncluded: ['cd'] });
      await manager.createSnapshot(buildResult2, { tigerVintage: 2024, layersIncluded: ['cd'] });

      const diff = await manager.diff(1, 2);

      expect(diff.layersModified.length).toBe(1);
      expect(diff.layersModified[0].layer).toBe('cd');
      expect(diff.layersModified[0].fromCount).toBe(8);
      expect(diff.layersModified[0].toCount).toBe(10);
      expect(diff.layersModified[0].delta).toBe(2);
    });

    it('should detect states added', async () => {
      await manager.createSnapshot(
        createMockBuildResult({ merkleRoot: 111n }),
        { tigerVintage: 2024, statesIncluded: ['55'] }
      );

      await manager.createSnapshot(
        createMockBuildResult({ merkleRoot: 222n }),
        { tigerVintage: 2024, statesIncluded: ['55', '01', '06'] }
      );

      const diff = await manager.diff(1, 2);

      expect(diff.statesAdded).toContain('01');
      expect(diff.statesAdded).toContain('06');
      expect(diff.statesRemoved).toEqual([]);
    });

    it('should detect states removed', async () => {
      await manager.createSnapshot(
        createMockBuildResult({ merkleRoot: 111n }),
        { tigerVintage: 2024, statesIncluded: ['55', '01', '06'] }
      );

      await manager.createSnapshot(
        createMockBuildResult({ merkleRoot: 222n }),
        { tigerVintage: 2024, statesIncluded: ['55'] }
      );

      const diff = await manager.diff(1, 2);

      expect(diff.statesRemoved).toContain('01');
      expect(diff.statesRemoved).toContain('06');
      expect(diff.statesAdded).toEqual([]);
    });

    it('should detect merkle root changed', async () => {
      await manager.createSnapshot(
        createMockBuildResult({ merkleRoot: 111n }),
        { tigerVintage: 2024 }
      );

      await manager.createSnapshot(
        createMockBuildResult({ merkleRoot: 222n }),
        { tigerVintage: 2024 }
      );

      const diff = await manager.diff(1, 2);

      expect(diff.merkleRootChanged).toBe(true);
    });

    it('should detect merkle root unchanged', async () => {
      await manager.createSnapshot(
        createMockBuildResult({ merkleRoot: 111n }),
        { tigerVintage: 2024 }
      );

      await manager.createSnapshot(
        createMockBuildResult({ merkleRoot: 111n }), // Same root
        { tigerVintage: 2024 }
      );

      const diff = await manager.diff(1, 2);

      expect(diff.merkleRootChanged).toBe(false);
    });

    it('should compute boundary count delta', async () => {
      const buildResult1 = createMockBuildResult({ layers: ['cd'], merkleRoot: 111n });
      buildResult1.layerCounts['cd'] = 8;

      const buildResult2 = createMockBuildResult({ layers: ['cd', 'county'], merkleRoot: 222n });
      buildResult2.layerCounts['cd'] = 8;
      buildResult2.layerCounts['county'] = 72;

      await manager.createSnapshot(buildResult1, { tigerVintage: 2024, layersIncluded: ['cd'] });
      await manager.createSnapshot(buildResult2, { tigerVintage: 2024, layersIncluded: ['cd', 'county'] });

      const diff = await manager.diff(1, 2);

      expect(diff.boundaryCountDelta).toBe(72); // Added county layer
    });
  });

  describe('setIpfsCid', () => {
    it('should throw error for non-existent snapshot', async () => {
      await expect(
        manager.setIpfsCid('non-existent-id', 'QmTestCid123')
      ).rejects.toThrow('Snapshot non-existent-id not found');
    });

    it('should update snapshot with IPFS CID', async () => {
      const buildResult = createMockBuildResult({ merkleRoot: 111n });
      const snapshot = await manager.createSnapshot(buildResult, { tigerVintage: 2024 });

      // Initially no IPFS CID
      expect(snapshot.ipfsCid).toBeUndefined();

      // Update with CID
      await manager.setIpfsCid(snapshot.id, 'QmTestCid123456789');

      // Retrieve and verify
      const updated = await manager.getById(snapshot.id);
      expect(updated).not.toBeNull();
      expect(updated!.ipfsCid).toBe('QmTestCid123456789');
    });

    it('should preserve other snapshot data when updating CID', async () => {
      const buildResult = createMockBuildResult({
        merkleRoot: 111n,
        layers: ['cd', 'county'],
      });
      const snapshot = await manager.createSnapshot(buildResult, {
        tigerVintage: 2024,
        statesIncluded: ['55', '01'],
        notes: 'Original notes',
      });

      await manager.setIpfsCid(snapshot.id, 'QmTestCid123');

      const updated = await manager.getById(snapshot.id);
      expect(updated).not.toBeNull();
      expect(updated!.merkleRoot).toBe(111n);
      expect(updated!.version).toBe(snapshot.version);
      expect(updated!.metadata.tigerVintage).toBe(2024);
      expect(updated!.metadata.statesIncluded).toEqual(['55', '01']);
      expect(updated!.metadata.notes).toBe('Original notes');
    });
  });
});
