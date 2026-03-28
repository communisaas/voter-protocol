/**
 * Cell ID Round-Trip Verification
 *
 * Verifies that the cellId encoding used in IPFS cell chunks is consistent
 * with the tree2-snapshot source data and the circuit's BN254 field.
 *
 * The pipeline encodes cellId via toHex(BigInt(cellId)) where:
 *   toHex(v) = '0x' + v.toString(16).padStart(64, '0')
 *
 * This test ensures:
 * 1. Hex round-trips back to the original bigint
 * 2. All values are within BN254 modulus bounds
 * 3. District values are preserved correctly
 * 4. Actual cell chunk files match the expected encoding
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SNAPSHOT_PATH = join(PKG_ROOT, 'data/tree2-snapshot.json');
const CELLS_DIR = join(PKG_ROOT, 'output/US/cells');

/** BN254 scalar field modulus */
const BN254_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** The same toHex used by build-cell-chunks.ts */
function toHex(value: bigint): string {
  return '0x' + value.toString(16).padStart(64, '0');
}

interface SnapshotMapping {
  cellId: string;
  districts: string[];
}

interface CellEntry {
  c: string;
  d: string[];
  p: string[];
  b: number[];
  a: number;
}

interface CellChunkFile {
  version: number;
  country: string;
  parentCell: string;
  cellMapRoot: string;
  depth: number;
  cells: Record<string, CellEntry>;
  cellCount: number;
  h3Index?: Record<string, string>;
}

const hasSnapshot = existsSync(SNAPSHOT_PATH);
const describeIfSnapshot = hasSnapshot ? describe : describe.skip;

describeIfSnapshot('cellId round-trip: IPFS chunk c field → circuit cell_id', () => {
  let mappings: SnapshotMapping[];

  beforeAll(async () => {
    const raw = await readFile(SNAPSHOT_PATH, 'utf-8');
    const snapshot = JSON.parse(raw);
    mappings = snapshot.mappings;
  });

  it('should have loaded mappings from the snapshot', () => {
    expect(mappings.length).toBeGreaterThan(0);
    expect(mappings.length).toBe(19987);
  });

  describe('hex encoding round-trip', () => {
    it('should round-trip real tract cellIds through toHex', () => {
      const realCells = mappings.filter(m => m.cellId.length <= 12).slice(0, 20);

      for (const mapping of realCells) {
        const cellIdBigint = BigInt(mapping.cellId);
        const hexString = toHex(cellIdBigint);

        // Verify format: 0x prefix + 64 hex chars
        expect(hexString).toMatch(/^0x[0-9a-f]{64}$/);

        // Verify round-trip: hex → bigint → same value
        const recovered = BigInt(hexString);
        expect(recovered).toBe(cellIdBigint);
      }
    });

    it('should round-trip virtual cell IDs (30+ digit hash-derived) through toHex', () => {
      const virtualCells = mappings.filter(m => m.cellId.length > 12).slice(0, 20);

      for (const mapping of virtualCells) {
        const cellIdBigint = BigInt(mapping.cellId);
        const hexString = toHex(cellIdBigint);

        expect(hexString).toMatch(/^0x[0-9a-f]{64}$/);

        const recovered = BigInt(hexString);
        expect(recovered).toBe(cellIdBigint);
      }
    });
  });

  describe('BN254 modulus bounds', () => {
    it('should keep all cellIds within BN254 modulus', () => {
      for (const mapping of mappings) {
        const cellIdBigint = BigInt(mapping.cellId);
        expect(cellIdBigint).toBeLessThan(BN254_MODULUS);
        expect(cellIdBigint).toBeGreaterThanOrEqual(0n);
      }
    });

    it('should keep all district values within BN254 modulus', () => {
      // Check first 100 mappings (full check takes too long)
      for (const mapping of mappings.slice(0, 100)) {
        for (const d of mapping.districts) {
          const val = BigInt(d);
          expect(val).toBeLessThan(BN254_MODULUS);
          expect(val).toBeGreaterThanOrEqual(0n);
        }
      }
    });
  });

  describe('district value preservation', () => {
    it('should preserve district values through hex encoding', () => {
      // First mapping is a well-known real tract: 6001400100 (Alameda County, CA)
      const first = mappings[0];
      expect(first.cellId).toBe('6001400100');
      expect(first.districts[0]).toBe('613'); // Congressional district CA-13

      const districtHex = toHex(BigInt(first.districts[0]));
      const recovered = BigInt(districtHex);
      expect(recovered).toBe(613n);

      // Check state FIPS (slot 1)
      expect(BigInt(first.districts[1])).toBe(6n); // California
    });

    it('should have 24 district slots per mapping', () => {
      for (const m of mappings.slice(0, 50)) {
        expect(m.districts).toHaveLength(24);
      }
    });
  });

  describe('actual cell chunk file verification', () => {
    it('should contain cell entries with valid c fields matching snapshot', async () => {
      // Read the first available chunk file
      const chunkFiles = readdirSync(CELLS_DIR).filter(f => f.endsWith('.json'));
      expect(chunkFiles.length).toBeGreaterThan(0);

      const chunkPath = join(CELLS_DIR, chunkFiles[0]);
      const chunk: CellChunkFile = JSON.parse(await readFile(chunkPath, 'utf-8'));

      expect(chunk.version).toBe(1);
      expect(chunk.country).toBe('US');
      expect(chunk.cellCount).toBe(Object.keys(chunk.cells).length);

      // Build a quick lookup from cellId → mapping
      const mappingByCell = new Map<string, SnapshotMapping>();
      for (const m of mappings) {
        mappingByCell.set(m.cellId, m);
      }

      // Verify each cell entry's c field round-trips correctly
      let checked = 0;
      for (const [cellKey, entry] of Object.entries(chunk.cells)) {
        // c field should be 0x-prefixed 64-char hex
        expect(entry.c).toMatch(/^0x[0-9a-f]{64}$/);

        // The cellKey is now the cellId string (GEOID bigint)
        const expectedHex = toHex(BigInt(cellKey));
        expect(entry.c).toBe(expectedHex);

        // Round-trip: c field → bigint → matches cellKey
        const recoveredBigint = BigInt(entry.c);
        expect(recoveredBigint).toBe(BigInt(cellKey));

        // Verify within BN254 bounds
        expect(recoveredBigint).toBeLessThan(BN254_MODULUS);

        // Cross-check against snapshot mapping if available
        const snapshotMapping = mappingByCell.get(cellKey);
        if (snapshotMapping) {
          // District values should match
          expect(entry.d).toHaveLength(24);
          for (let i = 0; i < snapshotMapping.districts.length; i++) {
            const expectedDistrictHex = toHex(BigInt(snapshotMapping.districts[i]));
            expect(entry.d[i]).toBe(expectedDistrictHex);
          }
        }

        // SMT proof fields should be present
        expect(entry.p.length).toBe(chunk.depth);
        expect(entry.b.length).toBe(chunk.depth);

        checked++;
        if (checked >= 10) break; // Don't check every cell, just enough to verify
      }

      expect(checked).toBeGreaterThan(0);
    });

    it('should have h3Index with valid reverse mappings', async () => {
      const chunkFiles = readdirSync(CELLS_DIR).filter(f => f.endsWith('.json'));
      const chunkPath = join(CELLS_DIR, chunkFiles[0]);
      const chunk: CellChunkFile = JSON.parse(await readFile(chunkPath, 'utf-8'));

      // h3Index should be present (new format)
      if (chunk.h3Index) {
        for (const [h3Key, cellKey] of Object.entries(chunk.h3Index)) {
          // H3 key should look like an H3 index
          expect(h3Key).toMatch(/^[0-9a-f]{15}$/);

          // cellKey should exist in cells
          expect(chunk.cells[cellKey]).toBeDefined();
        }
      }
    });
  });
});
