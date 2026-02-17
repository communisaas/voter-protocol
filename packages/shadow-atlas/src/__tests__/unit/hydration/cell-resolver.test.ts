import { describe, it, expect } from 'vitest';
import { resolveCells, type CellResolverStats } from '../../../hydration/cell-resolver.js';
import type { BlockRecord } from '../../../hydration/baf-parser.js';

// ============================================================================
// Helpers
// ============================================================================

function makeBlock(
  blockId: string,
  districts: Record<number, string>,
): [string, BlockRecord] {
  return [blockId, {
    blockId,
    stateFips: blockId.substring(0, 2),
    countyFips: blockId.substring(0, 5),
    tractGeoid: blockId.substring(0, 11),
    districts: new Map(Object.entries(districts).map(([k, v]) => [parseInt(k, 10), v])),
  }];
}

// ============================================================================
// Tests
// ============================================================================

describe('resolveCells', () => {
  it('should handle empty input', () => {
    const blocks = new Map<string, BlockRecord>();
    const { mappings, stats } = resolveCells(blocks);

    expect(mappings).toHaveLength(0);
    expect(stats.totalTracts).toBe(0);
    expect(stats.totalCells).toBe(0);
  });

  it('should create a single cell for uniform tract', () => {
    const blocks = new Map<string, BlockRecord>([
      makeBlock('060750001011000', { 0: '0614', 1: '06', 2: '06009', 4: '06075' }),
      makeBlock('060750001011001', { 0: '0614', 1: '06', 2: '06009', 4: '06075' }),
      makeBlock('060750001011002', { 0: '0614', 1: '06', 2: '06009', 4: '06075' }),
    ]);

    const { mappings, stats } = resolveCells(blocks);

    expect(mappings).toHaveLength(1);
    expect(stats.totalTracts).toBe(1);
    expect(stats.uniformTracts).toBe(1);
    expect(stats.splitTracts).toBe(0);
    expect(stats.virtualCells).toBe(0);
    expect(stats.totalCells).toBe(1);

    // Cell ID should encode the tract GEOID "06075000101"
    expect(mappings[0].cellId).toBe(BigInt('06075000101'));
    // Slot 0 = CD "0614"
    expect(mappings[0].districts[0]).toBe(BigInt('0614'));
    // Slot 1 = Senate "06"
    expect(mappings[0].districts[1]).toBe(BigInt('06'));
    // Slot 2 = State Senate "06009"
    expect(mappings[0].districts[2]).toBe(BigInt('06009'));
    // Slot 4 = County "06075"
    expect(mappings[0].districts[4]).toBe(BigInt('06075'));
  });

  it('should create virtual cells for split tract', () => {
    // Blocks in the same tract but different CDs
    const blocks = new Map<string, BlockRecord>([
      // 3 blocks in CD 14
      makeBlock('060750001011000', { 0: '0614', 1: '06', 2: '06009', 4: '06075' }),
      makeBlock('060750001011001', { 0: '0614', 1: '06', 2: '06009', 4: '06075' }),
      makeBlock('060750001011002', { 0: '0614', 1: '06', 2: '06009', 4: '06075' }),
      // 2 blocks in CD 13
      makeBlock('060750001011003', { 0: '0613', 1: '06', 2: '06009', 4: '06075' }),
      makeBlock('060750001011004', { 0: '0613', 1: '06', 2: '06009', 4: '06075' }),
    ]);

    const { mappings, stats } = resolveCells(blocks);

    expect(mappings).toHaveLength(2); // Two virtual cells
    expect(stats.totalTracts).toBe(1);
    expect(stats.uniformTracts).toBe(0);
    expect(stats.splitTracts).toBe(1);
    expect(stats.virtualCells).toBe(1); // Only the second cell is "virtual"
    expect(stats.totalCells).toBe(2);

    // Most common (3 blocks) gets the base GEOID
    const baseCell = mappings.find(m => m.cellId === BigInt('06075000101'));
    expect(baseCell).toBeDefined();
    expect(baseCell!.districts[0]).toBe(BigInt('0614'));

    // Less common (2 blocks) gets suffixed GEOID — virtual cell encoded as field
    // "06075000101_01" has underscore which triggers hex encoding
    const virtualCell = mappings.find(m => m.cellId !== BigInt('06075000101'));
    expect(virtualCell).toBeDefined();
    expect(virtualCell!.districts[0]).toBe(BigInt('0613'));
  });

  it('should handle multiple tracts independently', () => {
    const blocks = new Map<string, BlockRecord>([
      // Tract 1: uniform
      makeBlock('060750001011000', { 0: '0614', 1: '06' }),
      makeBlock('060750001011001', { 0: '0614', 1: '06' }),
      // Tract 2: uniform but different CD
      makeBlock('060750002011000', { 0: '0613', 1: '06' }),
      makeBlock('060750002011001', { 0: '0613', 1: '06' }),
    ]);

    const { mappings, stats } = resolveCells(blocks);

    expect(mappings).toHaveLength(2);
    expect(stats.totalTracts).toBe(2);
    expect(stats.uniformTracts).toBe(2);
    expect(stats.splitTracts).toBe(0);
  });

  it('should produce 24-slot district arrays', () => {
    const blocks = new Map<string, BlockRecord>([
      makeBlock('060750001011000', { 0: '0614', 1: '06', 2: '06009', 3: '06015', 4: '06075', 5: '0653000', 7: '0628050' }),
    ]);

    const { mappings } = resolveCells(blocks);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].districts).toHaveLength(24);

    // Populated slots
    expect(mappings[0].districts[0]).toBe(BigInt('0614'));
    expect(mappings[0].districts[5]).toBe(BigInt('0653000'));
    expect(mappings[0].districts[7]).toBe(BigInt('0628050'));

    // Unpopulated slots should be 0n
    expect(mappings[0].districts[6]).toBe(0n);
    expect(mappings[0].districts[8]).toBe(0n);
    expect(mappings[0].districts[22]).toBe(0n);
    expect(mappings[0].districts[23]).toBe(0n);
  });

  it('should handle three-way tract split', () => {
    const blocks = new Map<string, BlockRecord>([
      // 4 blocks in CD 14
      makeBlock('060750001011000', { 0: '0614' }),
      makeBlock('060750001011001', { 0: '0614' }),
      makeBlock('060750001011002', { 0: '0614' }),
      makeBlock('060750001011003', { 0: '0614' }),
      // 2 blocks in CD 13
      makeBlock('060750001011004', { 0: '0613' }),
      makeBlock('060750001011005', { 0: '0613' }),
      // 1 block in CD 12
      makeBlock('060750001011006', { 0: '0612' }),
    ]);

    const { mappings, stats } = resolveCells(blocks);

    expect(mappings).toHaveLength(3);
    expect(stats.splitTracts).toBe(1);
    expect(stats.virtualCells).toBe(2);

    // Most common (4 blocks) → base GEOID, then 2-block, then 1-block
    const cds = mappings.map(m => m.districts[0]);
    expect(cds).toContain(BigInt('0614'));
    expect(cds).toContain(BigInt('0613'));
    expect(cds).toContain(BigInt('0612'));
  });

  it('should handle blocks with no district assignments', () => {
    // Blocks with empty district maps (all slots will be 0n)
    const blocks = new Map<string, BlockRecord>([
      makeBlock('060750001011000', {}),
      makeBlock('060750001011001', {}),
    ]);

    const { mappings, stats } = resolveCells(blocks);

    expect(mappings).toHaveLength(1);
    expect(stats.uniformTracts).toBe(1);
    // All slots should be 0n
    expect(mappings[0].districts.every(d => d === 0n)).toBe(true);
  });
});
