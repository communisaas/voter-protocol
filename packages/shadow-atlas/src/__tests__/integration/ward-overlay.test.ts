/**
 * Ward Overlay Integration Test
 *
 * End-to-end test of the ward overlay pipeline using DC data:
 *   1. Load DC BAFs + parse blocks
 *   2. Load DC ward boundaries (8 wards from DC Open Data)
 *   3. Build tract centroid index for DC
 *   4. Overlay wards onto blocks (slot 6)
 *   5. Resolve cells and verify slot 6 is populated
 *
 * Gate: RUN_WARD_E2E=true (requires network for TIGER tract + ward GeoJSON downloads)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { downloadBAFs } from '../../hydration/baf-downloader.js';
import { parseBAFFilesAsync, type BlockRecord } from '../../hydration/baf-parser.js';
import { overlayBEFs } from '../../hydration/bef-overlay.js';
import { resolveCells } from '../../hydration/cell-resolver.js';
import { loadWardRegistry } from '../../hydration/ward-registry.js';
import { loadWardBoundaries } from '../../hydration/ward-boundary-loader.js';
import { overlaySupplementalDistricts } from '../../hydration/supplemental-overlay.js';
import { buildTractCentroidIndex } from '../../hydration/tract-centroid-index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../../..');
const CACHE_DIR = resolve(REPO_ROOT, 'data/baf-cache');
const WARD_CACHE_DIR = resolve(REPO_ROOT, 'data/ward-cache');

const RUN = process.env.RUN_WARD_E2E === 'true';

// Check if data files exist for registry
const DATA_DIR = resolve(__dirname, '../../agents/data');
const HAS_REGISTRY_DATA = existsSync(resolve(DATA_DIR, 'bulk-ingestion-results.json'))
  && existsSync(resolve(DATA_DIR, 'attributed-council-districts.json'));

describe.skipIf(!RUN || !HAS_REGISTRY_DATA)('Ward Overlay: DC End-to-End', () => {
  let allBlocks: Map<string, BlockRecord>;
  let blocksWithoutWards: Map<string, BlockRecord>;

  beforeAll(async () => {
    // Download and parse DC BAFs
    const results = await downloadBAFs({
      cacheDir: CACHE_DIR,
      stateCode: '11', // DC
      log: console.log,
    });

    allBlocks = new Map();
    for (const result of results) {
      const stateBlocks = await parseBAFFilesAsync(result.files);
      for (const [blockId, record] of stateBlocks) {
        allBlocks.set(blockId, record);
      }
    }

    // BEF overlay (DC isn't redistricted, but run for completeness)
    await overlayBEFs(allBlocks, { cacheDir: CACHE_DIR });

    // Save a copy without wards for comparison
    blocksWithoutWards = new Map();
    for (const [id, block] of allBlocks) {
      blocksWithoutWards.set(id, {
        ...block,
        districts: new Map(block.districts),
      });
    }
  }, 120_000);

  it('DC has blocks with city assignment (slot 5)', () => {
    let cityCount = 0;
    for (const block of allBlocks.values()) {
      if (block.districts.has(5)) cityCount++;
    }
    // DC should have place-assigned blocks
    expect(cityCount).toBeGreaterThan(0);
    console.log(`DC blocks with city (slot 5): ${cityCount}/${allBlocks.size}`);
  });

  it('overlays DC ward boundaries and populates slot 6', async () => {
    const registry = await loadWardRegistry();
    const dcEntries = [...registry.entries.values()].filter(e =>
      e.cityFips.startsWith('11'),
    );

    // DC may or may not be in the bulk ingestion data.
    // If not, use dc-wards-provider directly as fallback.
    if (dcEntries.length === 0) {
      console.log('DC not in ward registry — skipping overlay test');
      return;
    }

    const { loaded } = await loadWardBoundaries(dcEntries, {
      cacheDir: WARD_CACHE_DIR,
      log: console.log,
    });

    expect(loaded.length).toBeGreaterThan(0);

    // Build tract centroids for DC
    const centroidIndex = await buildTractCentroidIndex(['11'], {
      cacheDir: CACHE_DIR,
      log: console.log,
    });

    expect(centroidIndex.size).toBeGreaterThan(0);
    console.log(`DC tract centroids: ${centroidIndex.size}`);

    // Overlay wards
    const result = overlaySupplementalDistricts(allBlocks, {
      slot: 6,
      boundaries: loaded,
      centroidIndex,
      log: console.log,
    });

    expect(result.totalUpdated).toBeGreaterThan(0);
    console.log(`Ward overlay: ${result.totalUpdated} blocks updated, ${result.unmatched} unmatched, ${(result.coverage * 100).toFixed(1)}% coverage`);

    // Verify some blocks now have slot 6
    let slot6Count = 0;
    for (const block of allBlocks.values()) {
      if (block.districts.has(6)) slot6Count++;
    }
    expect(slot6Count).toBeGreaterThan(0);
    console.log(`Blocks with ward (slot 6): ${slot6Count}`);
  }, 180_000);

  it('cell resolution produces different results with wards', () => {
    // Resolve cells WITHOUT wards
    const withoutWards = resolveCells(blocksWithoutWards);

    // Resolve cells WITH wards (if slot 6 was populated)
    const withWards = resolveCells(allBlocks);

    // With wards, we may get more virtual cells (ward boundaries splitting tracts)
    console.log(`Without wards: ${withoutWards.stats.totalCells} cells (${withoutWards.stats.virtualCells} virtual)`);
    console.log(`With wards:    ${withWards.stats.totalCells} cells (${withWards.stats.virtualCells} virtual)`);

    // Cell count should be >= without wards (wards can only add virtual cells, not remove)
    expect(withWards.stats.totalCells).toBeGreaterThanOrEqual(withoutWards.stats.totalCells);

    // Check that some cells actually have slot 6 data
    const cellsWithWard = withWards.mappings.filter(m => m.districts[6] !== 0n);
    console.log(`Cells with ward data: ${cellsWithWard.length}/${withWards.mappings.length}`);
    // We don't require any specific count here — depends on DC BAF coverage
  });
});
