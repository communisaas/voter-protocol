#!/usr/bin/env npx tsx
/**
 * Build Tree 2 (Cell-District Mapping Tree)
 *
 * CLI entry point for the full BAF→Tree 2 pipeline:
 *   1. Download Census BAF files (cached)
 *   2. Parse block-level district assignments
 *   3. Overlay 119th Congress BEFs for redistricted states
 *   3.5. (Optional) Overlay city council ward boundaries (slot 6)
 *   4. Resolve to tract-level cells (with virtual cells)
 *   5. Build Sparse Merkle Tree via buildCellMapTree()
 *   6. Export snapshot for the serving layer
 *
 * Usage:
 *   npx tsx packages/shadow-atlas/src/hydration/build-tree2.ts
 *   npx tsx packages/shadow-atlas/src/hydration/build-tree2.ts --state 06
 *   npx tsx packages/shadow-atlas/src/hydration/build-tree2.ts --cache-dir ./data/baf-cache --output ./data/tree2-snapshot.json
 *   npx tsx packages/shadow-atlas/src/hydration/build-tree2.ts --state 11 --include-wards
 *
 * @packageDocumentation
 */

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { atomicWriteFile } from '../core/utils/atomic-write.js';
import { downloadBAFs } from './baf-downloader.js';
import { parseBAFFilesAsync } from './baf-parser.js';
import { overlayBEFs, REDISTRICTED_STATES } from './bef-overlay.js';
import { resolveCells } from './cell-resolver.js';
import { buildCellMapTree } from '../tree-builder.js';
import { loadWardRegistry } from './ward-registry.js';
import { loadWardBoundaries } from './ward-boundary-loader.js';
import { loadWardsFromRTree } from './rtree-ward-reader.js';
import { overlaySupplementalDistricts } from './supplemental-overlay.js';
import { buildTractCentroidIndex } from './tract-centroid-index.js';
import { buildCellChunks, buildCellChunksManifestEntry } from '../distribution/build-cell-chunks.js';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CLIOptions {
  stateCode?: string;
  cacheDir: string;
  outputPath: string;
  depth: number;
  includeWards: boolean;
  wardCacheDir: string;
  wardsFromRTree?: string; // Path to shadow-atlas.db — read wards from R-tree instead of ArcGIS
  cellChunksDir?: string;  // Output directory for IPFS cell chunk files
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const opts: CLIOptions = {
    cacheDir: 'data/baf-cache',
    outputPath: 'data/tree2-snapshot.json',
    depth: 20,
    includeWards: false,
    wardCacheDir: 'data/ward-cache',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--state':
        opts.stateCode = args[++i];
        break;
      case '--cache-dir':
        opts.cacheDir = args[++i];
        break;
      case '--output':
        opts.outputPath = args[++i];
        break;
      case '--depth':
        opts.depth = parseInt(args[++i], 10);
        break;
      case '--include-wards':
        opts.includeWards = true;
        break;
      case '--ward-cache-dir':
        opts.wardCacheDir = args[++i];
        break;
      case '--wards-from-rtree':
        opts.wardsFromRTree = args[++i];
        opts.includeWards = true;
        break;
      case '--cells-dir':
        opts.cellChunksDir = args[++i];
        break;
      case '--help':
        console.log(`
Usage: build-tree2.ts [options]

Options:
  --state <FIPS>         Filter to a single state (e.g., "06" for CA)
  --cache-dir <path>     Directory for cached BAF downloads (default: data/baf-cache)
  --output <path>        Output snapshot file (default: data/tree2-snapshot.json)
  --depth <n>            SMT depth (default: 20)
  --include-wards        Overlay city council ward boundaries (slot 6)
  --ward-cache-dir <p>   Directory for cached ward data (default: data/ward-cache)
  --wards-from-rtree <p> Read wards from shadow-atlas.db (unified source, no ArcGIS download)
  --cells-dir <path>     Output IPFS cell chunk files (districts + SMT proofs per H3 parent)
  --help                 Show this help
`);
        process.exit(0);
    }
  }

  return opts;
}

// ============================================================================
// Main Pipeline
// ============================================================================

async function main(): Promise<void> {
  const opts = parseArgs();
  const startTime = Date.now();

  console.log('=== Tree 2 Builder: Census BAF Pipeline ===');
  console.log(`State filter: ${opts.stateCode ?? 'ALL'}`);
  console.log(`Cache dir:    ${opts.cacheDir}`);
  console.log(`Output:       ${opts.outputPath}`);
  console.log(`SMT depth:    ${opts.depth}`);
  console.log(`Wards:        ${opts.wardsFromRTree ? `YES (from R-tree: ${opts.wardsFromRTree})` : opts.includeWards ? 'YES (slot 6, ArcGIS)' : 'no'}`);
  console.log(`Cell chunks:  ${opts.cellChunksDir ?? 'no (use --cells-dir to enable)'}`);
  console.log();

  const baseSteps = opts.includeWards ? 6 : 5;
  const totalSteps = opts.cellChunksDir ? baseSteps + 1 : baseSteps;

  // Step 1: Download BAFs
  console.log(`[1/${totalSteps}] Downloading Census BAF files...`);
  const downloadResults = await downloadBAFs({
    cacheDir: opts.cacheDir,
    stateCode: opts.stateCode,
    log: console.log,
  });

  const cachedCount = downloadResults.filter(r => r.cached).length;
  const downloadedCount = downloadResults.length - cachedCount;
  console.log(`  → ${downloadedCount} downloaded, ${cachedCount} cached`);
  console.log();

  // Step 2: Parse BAF files
  console.log(`[2/${totalSteps}] Parsing BAF block records...`);
  const allBlocks = new Map<string, import('./baf-parser.js').BlockRecord>();

  for (const result of downloadResults) {
    const stateBlocks = await parseBAFFilesAsync(result.files);
    for (const [blockId, record] of stateBlocks) {
      allBlocks.set(blockId, record);
    }
    console.log(`  → ${result.stateAbbr}: ${stateBlocks.size.toLocaleString()} blocks`);
  }
  console.log(`  → Total: ${allBlocks.size.toLocaleString()} blocks`);
  console.log();

  // Step 3: Overlay BEFs
  console.log(`[3/${totalSteps}] Overlaying 119th Congress BEFs...`);
  const befResult = await overlayBEFs(allBlocks, {
    cacheDir: opts.cacheDir,
    delimiter: ',',
    log: console.log,
  });
  console.log(`  → ${befResult.totalUpdated.toLocaleString()} blocks updated in ${befResult.updatedByState.size} states`);
  console.log();

  // Step 3.5: Overlay ward boundaries (optional)
  let wardOverlayStats: { citiesCovered: number; totalBlocksUpdated: number; coverage: number } | null = null;

  if (opts.includeWards) {
    console.log(`[4/${totalSteps}] Overlaying city council ward boundaries (slot 6)...`);

    let loaded: import('./ward-boundary-loader.js').CityWardBoundaries[];

    if (opts.wardsFromRTree) {
      // Unified path: read wards from R-tree DB (single source of truth)
      console.log(`  → Reading wards from R-tree: ${opts.wardsFromRTree}`);
      const blockStateFips = new Set([...allBlocks.values()].map(b => b.stateFips));
      loaded = loadWardsFromRTree(opts.wardsFromRTree, blockStateFips);
      console.log(`  → Loaded ${loaded.length} cities from R-tree`);
    } else {
      // Legacy path: download from ArcGIS portals
      const registry = await loadWardRegistry();
      const blockStateFips = new Set([...allBlocks.values()].map(b => b.stateFips));
      const registryEntries = [...registry.entries.values()].filter(e =>
        blockStateFips.has(e.cityFips.slice(0, 2)),
      );

      console.log(`  → Registry: ${registryEntries.length} cities in ${blockStateFips.size} state(s)`);

      const wardResult = await loadWardBoundaries(registryEntries, {
        cacheDir: opts.wardCacheDir,
        log: console.log,
      });

      loaded = wardResult.loaded;
      if (wardResult.failed.length > 0) {
        console.log(`  → ${wardResult.failed.length} cities failed to load (skipped)`);
      }
    }

    if (loaded.length > 0) {
      // Build tract centroid index for states with ward-covered cities
      const wardStateFips = [...new Set(
        loaded.map(c => c.cityFips.slice(0, 2)),
      )];

      console.log(`  → Building tract centroid index for ${wardStateFips.length} state(s)...`);
      const centroidIndex = await buildTractCentroidIndex(wardStateFips, {
        cacheDir: opts.cacheDir,
        log: console.log,
      });

      const overlayResult = overlaySupplementalDistricts(allBlocks, {
        slot: 6,
        boundaries: loaded,
        centroidIndex,
        log: console.log,
      });

      wardOverlayStats = {
        citiesCovered: overlayResult.updatedByCity.size,
        totalBlocksUpdated: overlayResult.totalUpdated,
        coverage: overlayResult.coverage,
      };

      console.log(`  → ${overlayResult.totalUpdated.toLocaleString()} blocks updated across ${overlayResult.updatedByCity.size} cities`);
      console.log(`  → Coverage: ${(overlayResult.coverage * 100).toFixed(1)}% | Unmatched: ${overlayResult.unmatched.toLocaleString()}`);
    } else {
      console.log('  → No ward boundaries applicable to current state filter');
    }
    console.log();
  }

  // Step 4: Resolve cells
  console.log(`[${opts.includeWards ? 5 : 4}/${totalSteps}] Resolving block → tract cells...`);
  const { mappings, stats } = resolveCells(allBlocks);
  console.log(`  → ${stats.totalTracts.toLocaleString()} tracts`);
  console.log(`  → ${stats.uniformTracts.toLocaleString()} uniform, ${stats.splitTracts.toLocaleString()} split`);
  console.log(`  → ${stats.virtualCells.toLocaleString()} virtual cells created`);
  console.log(`  → ${stats.totalCells.toLocaleString()} total cells`);
  console.log();

  // Step 5: Build Tree 2
  console.log(`[${totalSteps}/${totalSteps}] Building Sparse Merkle Tree...`);
  const treeResult = await buildCellMapTree(mappings, opts.depth);
  console.log(`  → Root: 0x${treeResult.root.toString(16)}`);
  console.log(`  → Depth: ${treeResult.depth}`);
  console.log(`  → Cells: ${treeResult.cellCount.toLocaleString()}`);
  console.log();

  // Export snapshot (version 3 with vintage metadata)
  await mkdir(dirname(opts.outputPath), { recursive: true });
  const snapshot = {
    version: 3,
    generatedAt: new Date().toISOString(),
    stateFilter: opts.stateCode ?? null,
    root: '0x' + treeResult.root.toString(16),
    depth: treeResult.depth,
    cellCount: treeResult.cellCount,
    vintage: {
      label: '119th-congress',
      country: 'USA',
      effectiveDate: '2025-01-03',
      source: 'census-baf-2020+bef-119th',
    },
    stats,
    befOverlay: {
      redistrictedStates: [...REDISTRICTED_STATES.keys()],
      totalUpdated: befResult.totalUpdated,
    },
    wardOverlay: wardOverlayStats ?? { enabled: false },
    mappings: mappings.map(m => ({
      cellId: m.cellId.toString(),
      districts: m.districts.map(d => d.toString()),
    })),
  };

  await atomicWriteFile(opts.outputPath, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Snapshot written to ${opts.outputPath}`);

  // Step 6: Build IPFS cell chunks (districts + SMT proofs per H3 parent)
  if (opts.cellChunksDir) {
    console.log();
    console.log(`[${totalSteps}/${totalSteps}] Building IPFS cell chunks (districts + SMT proofs)...`);

    // Use tract centroids to map GEOID → H3 cell → H3 res-3 parent for grouping.
    // Tracts without centroids (virtual cells from split tracts) use GEOID prefix grouping.
    const { latLngToCell, cellToParent } = await import('h3-js');

    // Build centroid index for states in the current run
    const stateFilterSet = opts.stateCode
      ? [opts.stateCode]
      : [...new Set([...allBlocks.values()].map(b => b.stateFips))];

    console.log(`  → Building tract centroid index for ${stateFilterSet.length} state(s)...`);
    const centroidIndex = await buildTractCentroidIndex(stateFilterSet, {
      cacheDir: opts.cacheDir,
      log: (msg) => console.log(`    ${msg}`),
    });

    // Build GEOID → H3 mapping from centroids
    const geoidToH3Cache = new Map<string, string>();
    let centroidHits = 0;
    let centroidMisses = 0;

    const getH3ForGeoid = (geoid: string): string => {
      const cached = geoidToH3Cache.get(geoid);
      if (cached) return cached;

      const centroid = centroidIndex.getCentroid(geoid);
      if (centroid) {
        const h3Cell = latLngToCell(centroid[1], centroid[0], 7); // [lon, lat] → latLngToCell(lat, lng, res)
        geoidToH3Cache.set(geoid, h3Cell);
        centroidHits++;
        return h3Cell;
      }

      // Virtual cells (split tracts) may not have centroids.
      // Use the parent tract GEOID (first 11 digits) for lookup.
      const parentGeoid = geoid.slice(0, 11);
      if (parentGeoid !== geoid) {
        const parentCentroid = centroidIndex.getCentroid(parentGeoid);
        if (parentCentroid) {
          const h3Cell = latLngToCell(parentCentroid[1], parentCentroid[0], 7);
          geoidToH3Cache.set(geoid, h3Cell);
          centroidHits++;
          return h3Cell;
        }
      }

      // Fallback: use GEOID county prefix as group key
      centroidMisses++;
      const fallback = `geoid-${geoid.slice(0, 5)}`;
      geoidToH3Cache.set(geoid, fallback);
      return fallback;
    };

    const cellChunksResult = await buildCellChunks(treeResult, mappings, {
      country: 'US',
      groupFn: (cellId) => {
        const h3Cell = getH3ForGeoid(cellId.toString());
        // If it's an H3 index, group by res-3 parent. Otherwise it's a fallback key.
        return h3Cell.startsWith('geoid-') ? h3Cell : cellToParent(h3Cell, 3);
      },
      cellIdToKey: (cellId) => getH3ForGeoid(cellId.toString()),
      outputDir: opts.cellChunksDir,
      log: console.log,
    });

    console.log(`  → Centroid hits: ${centroidHits.toLocaleString()}, misses: ${centroidMisses.toLocaleString()}`);
    console.log(`  → ${cellChunksResult.totalChunks.toLocaleString()} chunks, ${cellChunksResult.totalCells.toLocaleString()} cells`);
    console.log(`  → Completed in ${(cellChunksResult.durationMs / 1000).toFixed(1)}s`);

    // Write manifest entry
    const manifestEntry = buildCellChunksManifestEntry(cellChunksResult, treeResult, 'US');
    const manifestPath = `${opts.cellChunksDir}/US/manifest-cells.json`;
    await mkdir(dirname(manifestPath), { recursive: true });
    await atomicWriteFile(manifestPath, JSON.stringify(manifestEntry, null, 2) + '\n');
    console.log(`  → Manifest written to ${manifestPath}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s.`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
