#!/usr/bin/env npx tsx
/**
 * Build Tree 2 (Cell-District Mapping Tree)
 *
 * CLI entry point for the full BAF→Tree 2 pipeline:
 *   1. Download Census BAF files (cached)
 *   2. Parse block-level district assignments
 *   3. Overlay 119th Congress BEFs for redistricted states
 *   4. Resolve to tract-level cells (with virtual cells)
 *   5. Build Sparse Merkle Tree via buildCellMapTree()
 *   6. Export snapshot for the serving layer
 *
 * Usage:
 *   npx tsx packages/shadow-atlas/src/hydration/build-tree2.ts
 *   npx tsx packages/shadow-atlas/src/hydration/build-tree2.ts --state 06
 *   npx tsx packages/shadow-atlas/src/hydration/build-tree2.ts --cache-dir ./data/baf-cache --output ./data/tree2-snapshot.json
 *
 * @packageDocumentation
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { downloadBAFs } from './baf-downloader.js';
import { parseBAFFilesAsync } from './baf-parser.js';
import { overlayBEFs, REDISTRICTED_STATES } from './bef-overlay.js';
import { resolveCells } from './cell-resolver.js';
import { buildCellMapTree } from '../dual-tree-builder.js';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CLIOptions {
  stateCode?: string;
  cacheDir: string;
  outputPath: string;
  depth: number;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const opts: CLIOptions = {
    cacheDir: 'data/baf-cache',
    outputPath: 'data/tree2-snapshot.json',
    depth: 20,
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
      case '--help':
        console.log(`
Usage: build-tree2.ts [options]

Options:
  --state <FIPS>      Filter to a single state (e.g., "06" for CA)
  --cache-dir <path>  Directory for cached BAF downloads (default: data/baf-cache)
  --output <path>     Output snapshot file (default: data/tree2-snapshot.json)
  --depth <n>         SMT depth (default: 20)
  --help              Show this help
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
  console.log();

  // Step 1: Download BAFs
  console.log('[1/5] Downloading Census BAF files...');
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
  console.log('[2/5] Parsing BAF block records...');
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
  console.log('[3/5] Overlaying 119th Congress BEFs...');
  const befResult = await overlayBEFs(allBlocks, {
    cacheDir: opts.cacheDir,
    log: console.log,
  });
  console.log(`  → ${befResult.totalUpdated.toLocaleString()} blocks updated in ${befResult.updatedByState.size} states`);
  console.log();

  // Step 4: Resolve cells
  console.log('[4/5] Resolving block → tract cells...');
  const { mappings, stats } = resolveCells(allBlocks);
  console.log(`  → ${stats.totalTracts.toLocaleString()} tracts`);
  console.log(`  → ${stats.uniformTracts.toLocaleString()} uniform, ${stats.splitTracts.toLocaleString()} split`);
  console.log(`  → ${stats.virtualCells.toLocaleString()} virtual cells created`);
  console.log(`  → ${stats.totalCells.toLocaleString()} total cells`);
  console.log();

  // Step 5: Build Tree 2
  console.log('[5/5] Building Sparse Merkle Tree...');
  const treeResult = await buildCellMapTree(mappings, opts.depth);
  console.log(`  → Root: 0x${treeResult.root.toString(16)}`);
  console.log(`  → Depth: ${treeResult.depth}`);
  console.log(`  → Cells: ${treeResult.cellCount.toLocaleString()}`);
  console.log();

  // Export snapshot
  await mkdir(dirname(opts.outputPath), { recursive: true });
  const snapshot = {
    version: 2,
    generatedAt: new Date().toISOString(),
    stateFilter: opts.stateCode ?? null,
    root: '0x' + treeResult.root.toString(16),
    depth: treeResult.depth,
    cellCount: treeResult.cellCount,
    stats,
    befOverlay: {
      redistrictedStates: [...REDISTRICTED_STATES.keys()],
      totalUpdated: befResult.totalUpdated,
    },
    mappings: mappings.map(m => ({
      cellId: m.cellId.toString(),
      districts: m.districts.map(d => d.toString()),
    })),
  };

  await writeFile(opts.outputPath, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Snapshot written to ${opts.outputPath}`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s.`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
