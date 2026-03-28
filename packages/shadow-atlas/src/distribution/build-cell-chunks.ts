/**
 * Build Cell Chunk Files for IPFS Distribution
 *
 * Generates CellChunkFile JSON files containing combined district data + SMT proofs,
 * grouped by a caller-provided grouping key (typically H3 res-3 parent cell).
 *
 * Each chunk gives the client everything needed for client-side ZK proof generation:
 *   - districts[24] (circuit public input)
 *   - SMT siblings (circuit private input: cell_map_path)
 *   - path direction bits (circuit private input: cell_map_path_bits)
 *   - Tree 2 root (circuit public input: cell_map_root)
 *
 * This eliminates the cell_id privacy leak in `GET /cell-proof?cell_id=X`.
 *
 * Usage (from build-tree2.ts):
 *   const chunks = await buildCellChunks(treeResult, mappings, {
 *     country: 'US',
 *     groupFn: (cellId) => cellToParent(geoidToH3(cellId), 3),
 *     cellIdToKey: (cellId) => geoidToH3(cellId),
 *   });
 *
 * @packageDocumentation
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CellMapTreeResult, CellDistrictMapping } from '../tree-builder.js';
import type { CellChunkFile, CellEntry } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface BuildCellChunksOptions {
  /** ISO 3166-1 alpha-2 country code (e.g., "US") */
  country: string;

  /**
   * Map a tree cellId (bigint) to the grouping key (string).
   * For H3-based grouping: `(cellId) => cellToParent(geoidToH3(cellId), 3)`
   * For prefix-based grouping: `(cellId) => cellId.toString().slice(0, 5)`
   */
  groupFn: (cellId: bigint) => string;

  /**
   * Map a tree cellId (bigint) to the chunk lookup key (string).
   * This is the key used inside `cells: Record<string, CellEntry>`.
   * For H3-based: `(cellId) => geoidToH3(cellId)` (H3 cell index)
   * For simple: `(cellId) => cellId.toString()` (bigint as string)
   *
   * Defaults to `cellId.toString()` if not provided.
   */
  cellIdToKey?: (cellId: bigint) => string;

  /**
   * Optional: Map a tree cellId (bigint) to its H3 res-7 cell index.
   * Used to build the `h3Index` reverse mapping in each chunk, enabling
   * O(1) lat/lng lookups in the browser. Returns undefined for virtual cells.
   */
  h3Fn?: (cellId: bigint) => string | undefined;

  /** Output directory for chunk files. Files written to `{outputDir}/{country}/cells/` */
  outputDir?: string;

  /** Optional logger */
  log?: (msg: string) => void;
}

export interface BuildCellChunksResult {
  /** Number of chunk files produced */
  totalChunks: number;
  /** Total number of cells across all chunks */
  totalCells: number;
  /** Map from group key (parent cell) to the CellChunkFile */
  chunks: ReadonlyMap<string, CellChunkFile>;
  /** Duration in milliseconds */
  durationMs: number;
}

// ============================================================================
// Hex Encoding
// ============================================================================

function toHex(value: bigint): string {
  return '0x' + value.toString(16).padStart(64, '0');
}

// ============================================================================
// Main Builder
// ============================================================================

/**
 * Build cell chunk files from a CellMapTreeResult.
 *
 * For each cell in the tree:
 *   1. Gets the SMT proof (siblings + pathBits + attempt)
 *   2. Retrieves the 24 district values
 *   3. Groups by the caller's grouping function
 *   4. Serializes each group as a CellChunkFile
 *   5. Optionally writes to disk
 */
export async function buildCellChunks(
  treeResult: CellMapTreeResult,
  mappings: readonly CellDistrictMapping[],
  options: BuildCellChunksOptions,
): Promise<BuildCellChunksResult> {
  const startTime = Date.now();
  const log = options.log ?? (() => {});
  const cellIdToKey = options.cellIdToKey ?? ((id: bigint) => id.toString());

  // Group mappings by the grouping key
  const groups = new Map<string, { key: string; cellId: bigint; mapping: CellDistrictMapping }[]>();

  for (const mapping of mappings) {
    const groupKey = options.groupFn(mapping.cellId);
    const lookupKey = cellIdToKey(mapping.cellId);
    let group = groups.get(groupKey);
    if (!group) {
      group = [];
      groups.set(groupKey, group);
    }
    group.push({ key: lookupKey, cellId: mapping.cellId, mapping });
  }

  log(`  → ${groups.size} groups from ${mappings.length} cells`);

  // Build chunk files
  const generated = new Date().toISOString();
  const rootHex = toHex(treeResult.root);
  const chunks = new Map<string, CellChunkFile>();
  let proofErrors = 0;

  for (const [groupKey, entries] of groups) {
    const cells: Record<string, CellEntry> = {};
    const h3Index: Record<string, string> = {};

    for (const entry of entries) {
      try {
        const proof = await treeResult.tree.getProof(entry.cellId);

        cells[entry.key] = {
          c: toHex(entry.cellId),
          d: entry.mapping.districts.map(toHex),
          p: proof.siblings.map(s => toHex(s as bigint)),
          b: [...proof.pathBits],
          a: proof.attempt ?? 0,
        };

        // Build H3 reverse index if h3Fn is provided
        if (options.h3Fn) {
          const h3Key = options.h3Fn(entry.cellId);
          if (h3Key) {
            h3Index[h3Key] = entry.key;
          }
        }
      } catch (err) {
        proofErrors++;
        log(`  ⚠ Proof generation failed for cell ${entry.cellId}: ${err}`);
      }
    }

    const cellCount = Object.keys(cells).length;
    if (cellCount === 0) continue;

    const hasH3Index = Object.keys(h3Index).length > 0;
    const chunk: CellChunkFile = {
      version: 1,
      country: options.country,
      parentCell: groupKey,
      cellMapRoot: rootHex,
      depth: treeResult.depth,
      generated,
      cells,
      cellCount,
      ...(hasH3Index ? { h3Index } : {}),
    };

    chunks.set(groupKey, chunk);
  }

  if (proofErrors > 0) {
    log(`  ⚠ ${proofErrors} cells failed proof generation`);
  }

  // Write to disk if outputDir provided
  if (options.outputDir) {
    const cellsDir = join(options.outputDir, options.country, 'cells');
    await mkdir(cellsDir, { recursive: true });

    for (const [groupKey, chunk] of chunks) {
      const filePath = join(cellsDir, `${groupKey}.json`);
      await writeFile(filePath, JSON.stringify(chunk), 'utf-8');
    }

    log(`  → Wrote ${chunks.size} chunk files to ${cellsDir}`);
  }

  const durationMs = Date.now() - startTime;
  const totalCells = [...chunks.values()].reduce((sum, c) => sum + c.cellCount, 0);

  return {
    totalChunks: chunks.size,
    totalCells,
    chunks,
    durationMs,
  };
}

/**
 * Build a manifest entry for cell chunks.
 *
 * Returns the `cells` section to be merged into the existing ChunkManifest.
 */
export function buildCellChunksManifestEntry(
  result: BuildCellChunksResult,
  treeResult: CellMapTreeResult,
  country: string,
): {
  depth: number;
  cellMapRoot: string;
  totalChunks: number;
  chunks: Record<string, { path: string; cellCount: number }>;
} {
  const chunkEntries: Record<string, { path: string; cellCount: number }> = {};

  for (const [groupKey, chunk] of result.chunks) {
    chunkEntries[groupKey] = {
      path: `${country}/cells/${groupKey}.json`,
      cellCount: chunk.cellCount,
    };
  }

  return {
    depth: treeResult.depth,
    cellMapRoot: toHex(treeResult.root),
    totalChunks: result.totalChunks,
    chunks: chunkEntries,
  };
}

// ============================================================================
// District Index Builder
// ============================================================================

/**
 * A district index entry: maps a field element to the chunk keys containing it.
 *
 * Published at `{rootCID}/{country}/district-index.json`.
 * The browser fetches this once, then does O(1) lookups.
 */
export interface DistrictIndex {
  /** Schema version */
  version: 1;
  /** ISO 8601 generation timestamp */
  generated: string;
  /**
   * Per-slot index: slot number → { fieldElementHex → chunkKey[] }
   *
   * Example:
   *   "0": {                                    // slot 0 = Congressional District
   *     "0x...0264": ["832830fffffffff", ...],  // GEOID 0612 → CA-12
   *     "0x...0265": ["832831fffffffff", ...],  // GEOID 0613 → CA-13
   *   },
   *   "2": {                                    // slot 2 = State Senate
   *     "0x...1781": ["832830fffffffff", ...],  // GEOID 6017
   *   }
   *
   * Only slots with real (non-zero) data are included.
   */
  slots: Record<string, Record<string, string[]>>;
  /**
   * Reverse lookup: fieldElementHex → human-readable label.
   * Built from the raw GEOID values (not all have human-readable forms).
   *
   * Example: "0x...0264" → "0612"
   *
   * The browser uses slotNames from the main manifest to label the slot,
   * and this table to decode the raw GEOID for display or matching.
   */
  labels: Record<string, string>;
}

/**
 * Build a district index from the generated cell chunks.
 *
 * Scans every cell in every chunk, extracts non-zero district values
 * from all 24 slots, and maps each unique (slot, districtHex) pair
 * to the list of chunk keys containing cells with that district.
 *
 * The browser uses this to go from "user's verified district" → chunk key
 * in O(1) instead of scanning all chunks.
 */
export function buildDistrictIndex(
  result: BuildCellChunksResult,
  mappings: readonly CellDistrictMapping[],
): DistrictIndex {
  const slots: Record<string, Record<string, Set<string>>> = {};
  const labels = new Map<string, string>();

  // Build a reverse map: fieldElementHex → raw GEOID string
  // from the original mappings (which have the bigint values)
  const fieldToGeoid = new Map<string, string>();
  for (const m of mappings) {
    for (const d of m.districts) {
      if (d !== 0n) {
        const hex = toHex(d);
        if (!fieldToGeoid.has(hex)) {
          fieldToGeoid.set(hex, d.toString());
        }
      }
    }
  }

  // Scan all chunks
  for (const [chunkKey, chunk] of result.chunks) {
    for (const entry of Object.values(chunk.cells)) {
      for (let slot = 0; slot < entry.d.length; slot++) {
        const districtHex = entry.d[slot];
        // Skip zero values (empty slots)
        if (districtHex === '0x' + '0'.repeat(64)) continue;

        const slotKey = String(slot);
        if (!slots[slotKey]) slots[slotKey] = {};
        if (!slots[slotKey][districtHex]) slots[slotKey][districtHex] = new Set();
        slots[slotKey][districtHex].add(chunkKey);

        // Store label
        if (!labels.has(districtHex)) {
          labels.set(districtHex, fieldToGeoid.get(districtHex) ?? districtHex);
        }
      }
    }
  }

  // Convert Sets to arrays
  const slotsOut: Record<string, Record<string, string[]>> = {};
  for (const [slotKey, districts] of Object.entries(slots)) {
    slotsOut[slotKey] = {};
    for (const [hex, chunkKeys] of Object.entries(districts)) {
      slotsOut[slotKey][hex] = [...chunkKeys];
    }
  }

  const labelsOut: Record<string, string> = {};
  for (const [hex, label] of labels) {
    labelsOut[hex] = label;
  }

  return {
    version: 1,
    generated: new Date().toISOString(),
    slots: slotsOut,
    labels: labelsOut,
  };
}
