/**
 * Cell Resolver — Block-to-Tract Aggregation with Virtual Cells
 *
 * Aggregates block-level BAF records to tract-level cells for Tree 2.
 * Census tracts are the cell granularity for the voter protocol (depth 20).
 *
 * When all blocks within a tract agree on their district assignments,
 * the tract maps to a single cell. When blocks disagree (tract straddles
 * a district boundary), virtual cells are created — one per unique
 * district-assignment combination — achieving 100% accuracy.
 *
 * Virtual cell GEOIDs: tractGeoid + "_" + 2-digit suffix (e.g., "06075012300_01")
 *
 * @packageDocumentation
 */

import { DISTRICT_SLOT_COUNT, type CellDistrictMapping } from '../dual-tree-builder.js';
import { encodeGeoidAsField } from '../cell-district-loader.js';
import type { BlockRecord } from './baf-parser.js';

// ============================================================================
// Types
// ============================================================================

export interface CellResolverStats {
  /** Total census tracts processed. */
  totalTracts: number;
  /** Tracts where all blocks agree (single cell). */
  uniformTracts: number;
  /** Tracts where blocks disagree (split into virtual cells). */
  splitTracts: number;
  /** Total virtual cells created from split tracts. */
  virtualCells: number;
  /** Total cells (uniform tracts + virtual cells). */
  totalCells: number;
}

// ============================================================================
// Resolver
// ============================================================================

/**
 * Resolve block records to tract-level cells.
 *
 * Algorithm:
 * 1. Group all blocks by tract GEOID (BLOCKID[0:11])
 * 2. For each tract, collect unique district assignment vectors
 * 3. If all blocks agree → single cell with tract GEOID
 * 4. If blocks disagree → create virtual cells, one per unique combination
 *    - Most common combination gets the base tract GEOID (no suffix)
 *    - Others get tract GEOID + "_01", "_02", etc.
 *
 * @param blocks - Block records from BAF parsing
 * @returns Cell-district mappings and statistics
 */
export function resolveCells(
  blocks: Map<string, BlockRecord>,
): { mappings: CellDistrictMapping[]; stats: CellResolverStats } {
  // Step 1: Group blocks by tract
  const tractGroups = new Map<string, BlockRecord[]>();

  for (const [, block] of blocks) {
    const existing = tractGroups.get(block.tractGeoid);
    if (existing) {
      existing.push(block);
    } else {
      tractGroups.set(block.tractGeoid, [block]);
    }
  }

  const mappings: CellDistrictMapping[] = [];
  let uniformTracts = 0;
  let splitTracts = 0;
  let virtualCells = 0;

  // Step 2: Process each tract
  for (const [tractGeoid, tractBlocks] of tractGroups) {
    // Build district vector fingerprint for each block
    const fingerprints = new Map<string, { districts: Map<number, string>; count: number }>();

    for (const block of tractBlocks) {
      const fp = districtFingerprint(block.districts);
      const existing = fingerprints.get(fp);
      if (existing) {
        existing.count++;
      } else {
        fingerprints.set(fp, { districts: new Map(block.districts), count: 1 });
      }
    }

    if (fingerprints.size === 1) {
      // Uniform tract — all blocks agree
      const [, { districts }] = [...fingerprints.entries()][0];
      mappings.push(createCellMapping(tractGeoid, districts));
      uniformTracts++;
    } else {
      // Split tract — create virtual cells
      splitTracts++;

      // Sort by block count descending — most common gets base GEOID
      const sorted = [...fingerprints.entries()].sort((a, b) => b[1].count - a[1].count);

      for (let j = 0; j < sorted.length; j++) {
        const [, { districts }] = sorted[j];
        const cellGeoid = j === 0
          ? tractGeoid  // Most common gets base GEOID
          : `${tractGeoid}_${String(j).padStart(2, '0')}`;

        mappings.push(createCellMapping(cellGeoid, districts));

        if (j > 0) virtualCells++;
      }
    }
  }

  const stats: CellResolverStats = {
    totalTracts: tractGroups.size,
    uniformTracts,
    splitTracts,
    virtualCells,
    totalCells: mappings.length,
  };

  return { mappings, stats };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a canonical fingerprint from a district assignment map.
 * Used to group blocks with identical assignments.
 */
function districtFingerprint(districts: Map<number, string>): string {
  const parts: string[] = [];
  for (let slot = 0; slot < DISTRICT_SLOT_COUNT; slot++) {
    parts.push(districts.get(slot) ?? '');
  }
  return parts.join('|');
}

/**
 * Convert a district assignment map to a CellDistrictMapping.
 */
function createCellMapping(
  geoid: string,
  districts: Map<number, string>,
): CellDistrictMapping {
  const districtArray: bigint[] = new Array(DISTRICT_SLOT_COUNT).fill(0n);

  for (const [slot, value] of districts) {
    if (slot >= 0 && slot < DISTRICT_SLOT_COUNT && value) {
      districtArray[slot] = encodeGeoidAsField(value);
    }
  }

  return {
    cellId: encodeGeoidAsField(geoid),
    districts: districtArray,
  };
}
