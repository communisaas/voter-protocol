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

import { mkdir } from 'node:fs/promises';
import { openSync, writeSync, closeSync } from 'node:fs';
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
  /**
   * Map from group key (parent cell) to the CellChunkFile.
   *
   * When `outputDir` is set, the `cells` field of each entry is
   * emptied after the chunk is written to disk to keep peak memory
   * bounded — the file on disk is the source of truth. Consumers that
   * need per-cell data should re-read the file, or use the inline
   * `districtIndex` below which is built during the same pass.
   */
  chunks: ReadonlyMap<string, CellChunkFile>;
  /**
   * District-by-slot reverse index built inline while emitting
   * chunks, so callers no longer need to walk `chunks[*].cells` to
   * reconstruct it. Maps slot → districtHex → set-of-chunk-keys, plus
   * a field-element → raw-GEOID label map.
   */
  districtIndex: DistrictIndex;
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

  // Build chunk files.
  //
  // Previously this kept every chunk in a `chunks: Map<string, CellChunkFile>`
  // until the function returned, then walked the map a second time to write.
  // At full-US scale that's 1.88M cells × ~3 KB (cellId + 24 district hex +
  // 22 sibling hex + path bits) ≈ 5.6 GB resident before any writes — the
  // job OOM'd at 12 GB heap a few minutes into this step.
  //
  // The streaming form below writes each chunk to disk inside the per-group
  // loop and drops it from memory immediately. The returned `chunks` map now
  // holds compact summaries ({cellCount, optional h3Index, optional cells})
  // — callers that need full per-cell data should re-read from disk.
  const generated = new Date().toISOString();
  const rootHex = toHex(treeResult.root);
  const chunks = new Map<string, CellChunkFile>();
  let proofErrors = 0;
  let chunkWriteCount = 0;
  const LOG_INTERVAL = 100;

  // District index built inline so we don't need a second pass over
  // chunks. Sets are converted to arrays at the end.
  const indexSlots: Record<string, Record<string, Set<string>>> = {};
  const indexLabels = new Map<string, string>();
  // Field-element → raw-GEOID label, derived from the original mappings.
  // Computed once up front because mappings is the source of bigint values.
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
  const ZERO_HEX = '0x' + '0'.repeat(64);

  const cellsDir = options.outputDir
    ? join(options.outputDir, options.country, 'cells')
    : null;
  if (cellsDir) {
    await mkdir(cellsDir, { recursive: true });
  }

  for (const [groupKey, entries] of groups) {
    const cells: Record<string, CellEntry> = {};
    const h3Index: Record<string, string> = {};

    for (const entry of entries) {
      try {
        const proof = await treeResult.tree.getProof(entry.cellId);
        const districtsHex = entry.mapping.districts.map(toHex);

        cells[entry.key] = {
          c: toHex(entry.cellId),
          d: districtsHex,
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

        // Accumulate district index inline (instead of a second pass
        // over chunks.cells after this loop).
        for (let slot = 0; slot < districtsHex.length; slot++) {
          const dHex = districtsHex[slot];
          if (dHex === ZERO_HEX) continue;
          const slotKey = String(slot);
          if (!indexSlots[slotKey]) indexSlots[slotKey] = {};
          if (!indexSlots[slotKey][dHex]) indexSlots[slotKey][dHex] = new Set();
          indexSlots[slotKey][dHex].add(groupKey);
          if (!indexLabels.has(dHex)) {
            indexLabels.set(dHex, fieldToGeoid.get(dHex) ?? dHex);
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

    // Write to disk immediately when an output directory is provided,
    // then store only a summary in `chunks` so the cells are GC-eligible
    // before we move to the next group. Callers that explicitly want to
    // hold full chunks in memory can omit outputDir.
    //
    // We stream the chunk JSON cell-by-cell rather than calling
    // JSON.stringify(chunk) once: outlier urban H3 res-3 groups can
    // contain 100K+ cells × ~5 KB JSON each, which blows past Node's
    // ~512 MB single-string cap (RangeError: Invalid string length).
    // Per-cell stringify keeps peak allocation bounded to one cell.
    if (cellsDir) {
      const filePath = join(cellsDir, `${groupKey}.json`);
      const fd = openSync(filePath, 'w');
      try {
        // Header fields (small).
        writeSync(fd, '{');
        writeSync(fd, `"version":${JSON.stringify(chunk.version)},`);
        writeSync(fd, `"country":${JSON.stringify(chunk.country)},`);
        writeSync(fd, `"parentCell":${JSON.stringify(chunk.parentCell)},`);
        writeSync(fd, `"cellMapRoot":${JSON.stringify(chunk.cellMapRoot)},`);
        writeSync(fd, `"depth":${JSON.stringify(chunk.depth)},`);
        writeSync(fd, `"generated":${JSON.stringify(chunk.generated)},`);
        writeSync(fd, `"cellCount":${JSON.stringify(chunk.cellCount)},`);
        if (hasH3Index) {
          writeSync(fd, `"h3Index":${JSON.stringify(h3Index)},`);
        }
        // Cells map: emit one key:value at a time.
        writeSync(fd, '"cells":{');
        let firstCell = true;
        for (const [k, v] of Object.entries(cells)) {
          if (!firstCell) writeSync(fd, ',');
          firstCell = false;
          writeSync(fd, JSON.stringify(k));
          writeSync(fd, ':');
          writeSync(fd, JSON.stringify(v));
        }
        writeSync(fd, '}}');
      } finally {
        closeSync(fd);
      }
      // Replace `cells` with an empty record so consumers iterating
      // `result.chunks` don't accidentally rely on per-cell data; the
      // file on disk is the source of truth.
      chunks.set(groupKey, {
        ...chunk,
        cells: {},
      });
      chunkWriteCount++;
      if (chunkWriteCount % LOG_INTERVAL === 0 || chunkWriteCount === groups.size) {
        log(`  → wrote ${chunkWriteCount}/${groups.size} chunks`);
      }
    } else {
      // No outputDir: keep chunk in memory (back-compat with in-process callers).
      chunks.set(groupKey, chunk);
    }
  }

  if (proofErrors > 0) {
    log(`  ⚠ ${proofErrors} cells failed proof generation`);
  }
  if (cellsDir) {
    log(`  → Wrote ${chunks.size} chunk files to ${cellsDir}`);
  }

  // Materialize district index from inline-accumulated sets.
  const indexSlotsOut: Record<string, Record<string, string[]>> = {};
  for (const [slotKey, ds] of Object.entries(indexSlots)) {
    indexSlotsOut[slotKey] = {};
    for (const [hex, keys] of Object.entries(ds)) {
      indexSlotsOut[slotKey][hex] = [...keys];
    }
  }
  const districtIndex: DistrictIndex = {
    version: 1,
    generated,
    slots: indexSlotsOut,
    labels: Object.fromEntries(indexLabels),
  };

  const durationMs = Date.now() - startTime;
  const totalCells = [...chunks.values()].reduce((sum, c) => sum + c.cellCount, 0);

  return {
    totalChunks: chunks.size,
    totalCells,
    chunks,
    districtIndex,
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
