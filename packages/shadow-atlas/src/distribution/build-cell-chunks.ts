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

    for (const entry of entries) {
      try {
        const proof = await treeResult.tree.getProof(entry.cellId);

        cells[entry.key] = {
          d: entry.mapping.districts.map(toHex),
          p: proof.siblings.map(s => toHex(s as bigint)),
          b: [...proof.pathBits],
          a: proof.attempt ?? 0,
        };
      } catch (err) {
        proofErrors++;
        log(`  ⚠ Proof generation failed for cell ${entry.cellId}: ${err}`);
      }
    }

    const cellCount = Object.keys(cells).length;
    if (cellCount === 0) continue;

    const chunk: CellChunkFile = {
      version: 1,
      country: options.country,
      parentCell: groupKey,
      cellMapRoot: rootHex,
      depth: treeResult.depth,
      generated,
      cells,
      cellCount,
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
