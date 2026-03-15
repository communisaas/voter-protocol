import { describe, it, expect, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadCellMapStateFromSnapshot, loadSnapshotWithVintage } from '../../../hydration/snapshot-loader';
import { buildCellMapTree, toCellMapState, DISTRICT_SLOT_COUNT } from '../../../tree-builder';
import { generateMockMappings } from '../../../cell-district-loader';

describe('loadCellMapStateFromSnapshot', () => {
  let testDir: string;

  async function setup() {
    testDir = join(tmpdir(), `snapshot-test-${Date.now().toString(36)}`);
    await mkdir(testDir, { recursive: true });
    return testDir;
  }

  afterEach(async () => {
    if (testDir) await rm(testDir, { recursive: true, force: true });
  });

  // Test 1: Round-trip — build, serialize, load, verify root matches
  it('should round-trip a small CellMapState', async () => {
    await setup();
    const mappings = generateMockMappings(5, '06');
    const result = await buildCellMapTree(mappings, 20);
    const originalState = toCellMapState(result);

    // Serialize to snapshot
    const snapshot = {
      version: 2,
      generatedAt: new Date().toISOString(),
      stateFilter: null,
      root: '0x' + result.root.toString(16),
      depth: result.depth,
      cellCount: result.cellCount,
      stats: {},
      befOverlay: { redistrictedStates: [], totalUpdated: 0 },
      mappings: mappings.map(m => ({
        cellId: m.cellId.toString(),
        districts: m.districts.map(d => d.toString()),
      })),
    };

    const snapshotPath = join(testDir, 'tree2-snapshot.json');
    await writeFile(snapshotPath, JSON.stringify(snapshot));

    // Load and verify
    const loaded = await loadCellMapStateFromSnapshot(snapshotPath);
    expect(loaded.root).toBe(originalState.root);
    expect(loaded.depth).toBe(originalState.depth);
    expect(loaded.commitments.size).toBe(originalState.commitments.size);
    expect(loaded.districtMap.size).toBe(originalState.districtMap.size);
  });

  // Test 2: districtMap contents match after round-trip
  it('should preserve district arrays', async () => {
    await setup();
    const mappings = generateMockMappings(3, '11');
    const result = await buildCellMapTree(mappings, 20);

    const snapshot = {
      version: 2,
      generatedAt: new Date().toISOString(),
      root: '0x' + result.root.toString(16),
      depth: result.depth,
      cellCount: result.cellCount,
      mappings: mappings.map(m => ({
        cellId: m.cellId.toString(),
        districts: m.districts.map(d => d.toString()),
      })),
    };

    const snapshotPath = join(testDir, 'tree2-snapshot.json');
    await writeFile(snapshotPath, JSON.stringify(snapshot));

    const loaded = await loadCellMapStateFromSnapshot(snapshotPath);

    for (const mapping of mappings) {
      const cellIdStr = mapping.cellId.toString();
      const loadedDistricts = loaded.districtMap.get(cellIdStr);
      expect(loadedDistricts).toBeDefined();
      expect(loadedDistricts!.length).toBe(DISTRICT_SLOT_COUNT);
      for (let i = 0; i < DISTRICT_SLOT_COUNT; i++) {
        expect(loadedDistricts![i]).toBe(mapping.districts[i]);
      }
    }
  });

  // Test 3: Rejects version 1 snapshot
  it('should reject version 1 snapshot', async () => {
    await setup();
    const snapshot = { version: 1, root: '0x0', depth: 20, cellCount: 0 };
    const snapshotPath = join(testDir, 'v1-snapshot.json');
    await writeFile(snapshotPath, JSON.stringify(snapshot));

    await expect(loadCellMapStateFromSnapshot(snapshotPath))
      .rejects.toThrow('version 1 does not include mappings');
  });

  // Test 4: Rejects empty mappings
  it('should reject snapshot with empty mappings', async () => {
    await setup();
    const snapshot = { version: 2, root: '0x0', depth: 20, cellCount: 0, mappings: [] };
    const snapshotPath = join(testDir, 'empty-snapshot.json');
    await writeFile(snapshotPath, JSON.stringify(snapshot));

    await expect(loadCellMapStateFromSnapshot(snapshotPath))
      .rejects.toThrow('no mappings');
  });

  // Test 5: Detects corrupted snapshot (wrong root)
  it('should detect corrupted snapshot with wrong root', async () => {
    await setup();
    const mappings = generateMockMappings(3, '06');
    const result = await buildCellMapTree(mappings, 20);

    const snapshot = {
      version: 2,
      root: '0xdeadbeef', // Wrong root
      depth: result.depth,
      cellCount: result.cellCount,
      mappings: mappings.map(m => ({
        cellId: m.cellId.toString(),
        districts: m.districts.map(d => d.toString()),
      })),
    };

    const snapshotPath = join(testDir, 'corrupt-snapshot.json');
    await writeFile(snapshotPath, JSON.stringify(snapshot));

    await expect(loadCellMapStateFromSnapshot(snapshotPath))
      .rejects.toThrow('root mismatch');
  });

  // Test 6: Proof generation works after loading
  it('should produce valid proofs after loading', async () => {
    await setup();
    const mappings = generateMockMappings(5, '06');
    const result = await buildCellMapTree(mappings, 20);

    const snapshot = {
      version: 2,
      root: '0x' + result.root.toString(16),
      depth: result.depth,
      cellCount: result.cellCount,
      mappings: mappings.map(m => ({
        cellId: m.cellId.toString(),
        districts: m.districts.map(d => d.toString()),
      })),
    };

    const snapshotPath = join(testDir, 'tree2-snapshot.json');
    await writeFile(snapshotPath, JSON.stringify(snapshot));

    const loaded = await loadCellMapStateFromSnapshot(snapshotPath);

    // Generate a proof for the first cell
    const cellId = mappings[0].cellId;
    const proof = await loaded.tree.getProof(cellId);
    expect(proof.siblings).toHaveLength(20);
    expect(proof.pathBits).toHaveLength(20);
  });

  // Test 7: On-chain root verification — matching root passes
  it('should pass when expectedRoot matches recomputed root', async () => {
    await setup();
    const mappings = generateMockMappings(3, '06');
    const result = await buildCellMapTree(mappings, 20);

    const snapshot = {
      version: 2,
      root: '0x' + result.root.toString(16),
      depth: result.depth,
      cellCount: result.cellCount,
      mappings: mappings.map(m => ({
        cellId: m.cellId.toString(),
        districts: m.districts.map(d => d.toString()),
      })),
    };

    const snapshotPath = join(testDir, 'on-chain-match.json');
    await writeFile(snapshotPath, JSON.stringify(snapshot));

    // Pass the correct root as expectedRoot — should succeed
    const loaded = await loadCellMapStateFromSnapshot(snapshotPath, {
      expectedRoot: result.root,
    });
    expect(loaded.root).toBe(result.root);
  });

  // Test 8: On-chain root verification — mismatched root throws
  it('should reject when expectedRoot does not match', async () => {
    await setup();
    const mappings = generateMockMappings(3, '06');
    const result = await buildCellMapTree(mappings, 20);

    const snapshot = {
      version: 2,
      root: '0x' + result.root.toString(16),
      depth: result.depth,
      cellCount: result.cellCount,
      mappings: mappings.map(m => ({
        cellId: m.cellId.toString(),
        districts: m.districts.map(d => d.toString()),
      })),
    };

    const snapshotPath = join(testDir, 'on-chain-mismatch.json');
    await writeFile(snapshotPath, JSON.stringify(snapshot));

    // Pass a wrong root — should throw
    await expect(
      loadCellMapStateFromSnapshot(snapshotPath, {
        expectedRoot: 0xdeadbeefn,
      })
    ).rejects.toThrow('On-chain root verification failed');
  });

  // Test 9: Omitting expectedRoot skips on-chain verification (backward compatible)
  it('should skip on-chain verification when expectedRoot is omitted', async () => {
    await setup();
    const mappings = generateMockMappings(3, '06');
    const result = await buildCellMapTree(mappings, 20);

    const snapshot = {
      version: 2,
      root: '0x' + result.root.toString(16),
      depth: result.depth,
      cellCount: result.cellCount,
      mappings: mappings.map(m => ({
        cellId: m.cellId.toString(),
        districts: m.districts.map(d => d.toString()),
      })),
    };

    const snapshotPath = join(testDir, 'no-on-chain.json');
    await writeFile(snapshotPath, JSON.stringify(snapshot));

    // No expectedRoot — should load successfully without on-chain check
    const loaded = await loadCellMapStateFromSnapshot(snapshotPath);
    expect(loaded.root).toBe(result.root);
  });

  // Test 10: loadSnapshotWithVintage also supports expectedRoot
  it('should verify expectedRoot via loadSnapshotWithVintage', async () => {
    await setup();
    const mappings = generateMockMappings(3, '06');
    const result = await buildCellMapTree(mappings, 20);

    const snapshot = {
      version: 3,
      root: '0x' + result.root.toString(16),
      depth: result.depth,
      cellCount: result.cellCount,
      vintage: {
        label: 'test',
        country: 'USA',
        effectiveDate: '2025-01-01',
        source: 'test',
      },
      mappings: mappings.map(m => ({
        cellId: m.cellId.toString(),
        districts: m.districts.map(d => d.toString()),
      })),
    };

    const snapshotPath = join(testDir, 'vintage-on-chain.json');
    await writeFile(snapshotPath, JSON.stringify(snapshot));

    // Matching root
    const loaded = await loadSnapshotWithVintage(snapshotPath, {
      expectedRoot: result.root,
    });
    expect(loaded.state.root).toBe(result.root);
    expect(loaded.vintage?.label).toBe('test');

    // Mismatched root
    await expect(
      loadSnapshotWithVintage(snapshotPath, {
        expectedRoot: 0xbadcafen,
      })
    ).rejects.toThrow('On-chain root verification failed');
  });
});
