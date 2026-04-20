#!/usr/bin/env tsx
/**
 * Build H3→District Mapping (Parallel)
 *
 * Multi-process H3 resolution-7 → district mapping for the entire US.
 * Moves the R-tree spatial lookup from runtime to build time.
 *
 * Usage:
 *   tsx scripts/build-h3-mapping.ts <dbPath> [outputDir]
 *
 * Optimizations over v1 single-threaded approach:
 *   1. child_process.fork — parallel PIP across CPU cores (~8x speedup)
 *   2. Ocean pre-filter — res-4 parent R-tree probe skips ocean cells (~20% reduction)
 *   3. Unbounded geometry cache — no LRU eviction, no repeated JSON.parse
 *   4. Raw GeoJSON geometry — skip turf Feature wrapping overhead
 *   5. Coordinate array reuse — avoid creating 4M+ GeoJSON Point objects
 *
 * Target: <30 min on 10-core machine (down from 8.5h single-threaded).
 *
 * Outputs:
 *   h3-district-mapping.json.br  - Brotli-compressed mapping
 *   h3-district-mapping-sample.json - First 1000 cells (for client integration testing)
 *   h3-mapping-metadata.json     - Build stats and schema info
 */

import { fork, type ChildProcess } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import type { Polygon, MultiPolygon, Position } from 'geojson';
import { polygonToCells, cellToLatLng, cellToParent } from 'h3-js';
import { brotliCompressSync, constants } from 'node:zlib';
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  unlinkSync,
  appendFileSync,
  openSync,
  writeSync,
  closeSync,
} from 'node:fs';
import { join } from 'node:path';
import { US_JURISDICTION, PROTOCOL_DISTRICT_SLOTS } from '../src/jurisdiction.js';

// ---- Configuration ----

const H3_RESOLUTION = 7;
const PARENT_RESOLUTION = 4;
const WORKER_COUNT = Math.max(1, cpus().length - 2);

/**
 * ZK ENCODING CONTRACT (signed off by proof):
 * - H3 cell IDs are 64-bit integers stored as lowercase hex (15-char)
 * - For BN254 circuit input: BigInt('0x' + h3CellId) — fits in 254-bit field
 * - Lowercase hex normalization is REQUIRED for deterministic dedup
 * - h3-js v4 already returns lowercase
 * - MAX_CELLS=16 at res-7 holds (typical postal bubble covers 2-5 cells)
 */

const US_REGIONS = [
  {
    name: 'contiguous',
    polygon: [
      [24.396308, -124.848974],
      [24.396308, -66.885444],
      [49.384358, -66.885444],
      [49.384358, -124.848974],
      [24.396308, -124.848974],
    ],
  },
  {
    name: 'hawaii',
    polygon: [
      [18.86546, -160.30539],
      [18.86546, -154.70916],
      [22.27041, -154.70916],
      [22.27041, -160.30539],
      [18.86546, -160.30539],
    ],
  },
  {
    name: 'alaska-main',
    polygon: [
      [51.0, -180.0],
      [51.0, -129.0],
      [71.5, -129.0],
      [71.5, -180.0],
      [51.0, -180.0],
    ],
  },
  {
    name: 'alaska-aleutians',
    polygon: [
      [51.0, 172.0],
      [51.0, 180.0],
      [55.5, 180.0],
      [55.5, 172.0],
      [51.0, 172.0],
    ],
  },
];

// ---- Slot Mapping ----

const PREFIX_TO_SLOT: Record<string, number> = {};
for (const [alias, slotIndex] of Object.entries(US_JURISDICTION.aliases)) {
  PREFIX_TO_SLOT[`${alias}-`] = slotIndex;
}
const SORTED_PREFIXES = Object.keys(PREFIX_TO_SLOT).sort(
  (a, b) => b.length - a.length
);

function districtIdToSlot(districtId: string): number {
  for (const prefix of SORTED_PREFIXES) {
    if (districtId.startsWith(prefix)) return PREFIX_TO_SLOT[prefix];
  }
  return -1;
}

// ---- Output Schema ----

type DistrictMapping = (string | null)[];

interface MappingOutput {
  version: number;
  resolution: number;
  generated: string;
  cellCount: number;
  slotNames: Record<number, string>;
  mapping: Record<string, DistrictMapping>;
}

// ---- IPC Protocol ----

interface WorkerInit {
  type: 'init';
  cells: string[];
  dbPath: string;
  tmpFile: string;
  workerId: number;
}

interface WorkerProgress {
  type: 'progress';
  workerId: number;
  processed: number;
  total: number;
  matched: number;
}

interface WorkerDone {
  type: 'done';
  workerId: number;
  tmpFile: string;
  matched: number;
  processed: number;
  noCandidate: number;
  cacheSize: number;
  cacheHits: number;
  cacheMisses: number;
  elapsedMs: number;
}

// ---- Detect if running as child worker ----
const IS_WORKER = process.env.__H3_WORKER__ === '1';

// ================================================================
// MAIN PROCESS
// ================================================================

if (!IS_WORKER) {
  async function main() {
    const dbPath = process.argv[2];
    if (!dbPath) {
      console.error(
        'Usage: tsx scripts/build-h3-mapping.ts <dbPath> [outputDir]'
      );
      console.error('  dbPath: path to shadow-atlas-full.db');
      process.exit(1);
    }

    const outputDir = process.argv[3] || './output';
    mkdirSync(outputDir, { recursive: true });

    console.log(`Database:    ${dbPath}`);
    console.log(`Output:      ${outputDir}`);
    console.log(`H3 res:      ${H3_RESOLUTION}`);
    console.log(`Workers:     ${WORKER_COUNT}`);
    console.log(`CPU cores:   ${cpus().length}`);
    console.log();

    const totalStart = Date.now();

    // ---- Step 1: Enumerate all H3 cells ----
    console.log('Step 1: Enumerating H3 cells...');
    const allCells = new Set<string>();

    for (const region of US_REGIONS) {
      const cells = polygonToCells([region.polygon], H3_RESOLUTION, false);
      console.log(
        `  ${region.name}: ${cells.length.toLocaleString()} cells`
      );
      for (const cell of cells) {
        allCells.add(cell);
      }
    }

    const cellArray = Array.from(allCells);
    console.log(`  Total unique: ${cellArray.length.toLocaleString()}`);
    console.log(
      `  Enum time: ${formatTime((Date.now() - totalStart) / 1000)}`
    );
    console.log();

    // ---- Step 2: Ocean pre-filter via res-4 parent probe ----
    console.log('Step 2: Ocean pre-filter (res-4 parent probe)...');
    const filterStart = Date.now();

    const db = new Database(dbPath, { readonly: true });
    db.pragma('journal_mode = WAL');

    const filteredCells: string[] = [];
    let oceanParents = 0;
    let parentCount = 0;

    try {
      const probeStmt = db.prepare(`
        SELECT 1 FROM rtree_index
        WHERE min_lon <= ? AND max_lon >= ? AND min_lat <= ? AND max_lat >= ?
        LIMIT 1
      `);

      // Group res-7 cells by their res-4 parent
      const parentToChildren = new Map<string, string[]>();
      for (const cell of cellArray) {
        const parent = cellToParent(cell, PARENT_RESOLUTION);
        let children = parentToChildren.get(parent);
        if (!children) {
          children = [];
          parentToChildren.set(parent, children);
        }
        children.push(cell);
      }
      console.log(
        `  Unique res-4 parents: ${parentToChildren.size.toLocaleString()}`
      );
      parentCount = parentToChildren.size;

      const EXPAND_DEG = 0.5;

      for (const [parent, children] of parentToChildren) {
        const [lat, lng] = cellToLatLng(parent);
        const hit = probeStmt.get(
          lng + EXPAND_DEG,
          lng - EXPAND_DEG,
          lat + EXPAND_DEG,
          lat - EXPAND_DEG
        );
        if (hit) {
          for (const child of children) {
            filteredCells.push(child);
          }
        } else {
          oceanParents++;
        }
      }
    } finally {
      db.close();
    }

    const removed = cellArray.length - filteredCells.length;
    const filterPct = ((removed / cellArray.length) * 100).toFixed(1);
    console.log(
      `  Ocean parents: ${oceanParents.toLocaleString()} / ${parentCount.toLocaleString()} (${((oceanParents / parentCount) * 100).toFixed(0)}%)`
    );
    console.log(
      `  Cells after filter: ${filteredCells.length.toLocaleString()} (removed ${removed.toLocaleString()}, ${filterPct}%)`
    );
    console.log(
      `  Filter time: ${formatTime((Date.now() - filterStart) / 1000)}`
    );
    console.log();

    // ---- Step 3: Fork worker processes ----
    console.log(`Step 3: Forking ${WORKER_COUNT} workers...`);
    const workerStart = Date.now();

    const workerFile = fileURLToPath(import.meta.url);

    // Get tsx flags to forward to child processes
    const tsxExecArgv = process.execArgv.filter(
      (arg, idx, arr) =>
        (arg === '--require' || arg === '--import') ||
        (idx > 0 &&
          (arr[idx - 1] === '--require' || arr[idx - 1] === '--import'))
    );

    const workerPromises: Promise<WorkerDone>[] = [];

    // Block-stride partitioning: distribute cells in blocks of BLOCK_SIZE,
    // assigned round-robin across workers. This balances load (like stride)
    // while preserving spatial locality within each block for cache hits.
    const BLOCK_SIZE = 500;
    const chunks: string[][] = Array.from({ length: WORKER_COUNT }, () => []);
    for (let i = 0; i < filteredCells.length; i++) {
      const blockIdx = Math.floor(i / BLOCK_SIZE);
      chunks[blockIdx % WORKER_COUNT].push(filteredCells[i]);
    }

    for (let i = 0; i < WORKER_COUNT; i++) {
      const chunk = chunks[i];
      if (chunk.length === 0) continue;

      const tmpFile = join(outputDir, `.worker-${i}-results.json`);

      const promise = new Promise<WorkerDone>((resolve, reject) => {
        const child: ChildProcess = fork(workerFile, [], {
          execArgv: tsxExecArgv,
          env: { ...process.env, __H3_WORKER__: '1' },
          stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
        });

        child.on('message', (msg: WorkerProgress | WorkerDone) => {
          if (msg.type === 'progress') {
            const elapsed = (Date.now() - workerStart) / 1000;
            const pct = ((msg.processed / msg.total) * 100).toFixed(0);
            console.log(
              `  W${msg.workerId}: ${msg.processed.toLocaleString()}/${msg.total.toLocaleString()} (${pct}%) | ${msg.matched.toLocaleString()} matched | ${formatTime(elapsed)}`
            );
          } else if (msg.type === 'done') {
            console.log(
              `  W${msg.workerId}: DONE — ${msg.matched.toLocaleString()} matched, ${msg.cacheSize.toLocaleString()} geo cached, ${formatTime(msg.elapsedMs / 1000)}`
            );
            resolve(msg);
          }
        });
        child.on('error', reject);
        child.on('exit', (code) => {
          if (code !== 0)
            reject(new Error(`Worker ${i} exited with code ${code}`));
        });

        // Send work assignment
        child.send({
          type: 'init',
          cells: chunk,
          dbPath,
          tmpFile,
          workerId: i,
        } satisfies WorkerInit);
      });

      workerPromises.push(promise);
    }

    const results = await Promise.all(workerPromises);
    console.log(
      `  Worker phase: ${formatTime((Date.now() - workerStart) / 1000)}`
    );
    console.log();

    // ---- Step 4: Merge results ----
    console.log('Step 4: Merging results...');
    const mergeStart = Date.now();

    const mapping: Record<string, DistrictMapping> = {};
    let totalMatched = 0;
    let totalNoCandidate = 0;
    let totalCacheHits = 0;
    let totalCacheMisses = 0;

    for (const result of results) {
      // Read NDJSON: each line is ["cellId", [slot0, slot1, ...]]
      const lines = readFileSync(result.tmpFile, 'utf-8').split('\n');
      for (const line of lines) {
        if (!line) continue;
        const [cell, districts] = JSON.parse(line) as [string, DistrictMapping];
        mapping[cell] = districts;
      }
      totalMatched += result.matched;
      totalNoCandidate += result.noCandidate;
      totalCacheHits += result.cacheHits;
      totalCacheMisses += result.cacheMisses;

      try {
        unlinkSync(result.tmpFile);
      } catch {
        /* cleanup best-effort */
      }
    }

    console.log(
      `  Merge time: ${formatTime((Date.now() - mergeStart) / 1000)}`
    );
    console.log();

    // ---- Step 5: Summary ----
    const totalElapsed = (Date.now() - totalStart) / 1000;
    console.log(`Processing complete in ${formatTime(totalElapsed)}`);
    console.log(
      `  Total enumerated: ${cellArray.length.toLocaleString()}`
    );
    console.log(
      `  Ocean-filtered:   ${removed.toLocaleString()} (${filterPct}%)`
    );
    console.log(
      `  Processed:        ${filteredCells.length.toLocaleString()}`
    );
    console.log(
      `  Matched:          ${totalMatched.toLocaleString()} cells`
    );
    console.log(
      `  No candidate:     ${totalNoCandidate.toLocaleString()} cells`
    );
    console.log(
      `  Geo cache total:  ${totalCacheHits.toLocaleString()} hits, ${totalCacheMisses.toLocaleString()} misses`
    );
    console.log();

    // ---- Step 6: Write outputs ----
    console.log('Step 6: Writing outputs...');

    const slotNames: Record<number, string> = {};
    for (const [idx, def] of Object.entries(US_JURISDICTION.slots)) {
      slotNames[Number(idx)] = def.name;
    }

    const output: MappingOutput = {
      version: 2,
      resolution: H3_RESOLUTION,
      generated: new Date().toISOString(),
      cellCount: Object.keys(mapping).length,
      slotNames,
      mapping,
    };

    writeOutputs(output, outputDir, mapping, {
      totalEnumerated: cellArray.length,
      oceanFiltered: removed,
      totalProcessed: filteredCells.length,
      totalMatched,
      totalNoCandidate,
      totalCacheHits,
      totalCacheMisses,
      workerCount: WORKER_COUNT,
      totalElapsedSec: totalElapsed,
    });
  }

  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

// ================================================================
// WORKER PROCESS
// ================================================================

if (IS_WORKER) {
  // FIFO geometry cache — bounded to prevent OOM.
  // 8 workers × 3000 entries × ~40KB avg = ~960MB total (fits in 16GB).
  // FIFO instead of LRU: get() is a simple Map.get (no reordering overhead).
  // With block-stride partitioning, FIFO works well — old blocks' districts
  // naturally get pushed out as new blocks' districts arrive.
  const GEO_CACHE_MAX = 3000;

  class FIFOGeoCache {
    private map = new Map<string, Polygon | MultiPolygon>();
    hits = 0;
    misses = 0;

    get(key: string): (Polygon | MultiPolygon) | undefined {
      const val = this.map.get(key);
      if (val !== undefined) {
        this.hits++;
        return val;
      }
      this.misses++;
      return undefined;
    }

    set(key: string, val: Polygon | MultiPolygon): void {
      if (this.map.size >= GEO_CACHE_MAX) {
        // Evict oldest (first inserted)
        const oldest = this.map.keys().next().value!;
        this.map.delete(oldest);
      }
      this.map.set(key, val);
    }

    get size() {
      return this.map.size;
    }
  }

  process.on('message', (msg: WorkerInit) => {
    if (msg.type !== 'init') return;

    const { cells, dbPath, tmpFile, workerId } = msg;
    const workerStart = Date.now();

    const db = new Database(dbPath, { readonly: true });
    db.pragma('journal_mode = WAL');

    const geoCache = new FIFOGeoCache();
    let matched = 0;
    let noCandidate = 0;

    try {
      const lookupStmt = db.prepare(`
        SELECT d.id, d.geometry
        FROM districts d
        JOIN rtree_index r ON d.rowid = r.id
        WHERE r.min_lon <= ? AND r.max_lon >= ?
          AND r.min_lat <= ? AND r.max_lat >= ?
      `);

      // Stream results to NDJSON temp file instead of accumulating in memory
      const fd = openSync(tmpFile, 'w');

      const coord: Position = [0, 0];

      try {
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          const [lat, lng] = cellToLatLng(cell);

          const candidates = lookupStmt.all(lng, lng, lat, lat) as Array<{
            id: string;
            geometry: string;
          }>;

          if (candidates.length === 0) {
            noCandidate++;
            if ((i + 1) % 100000 === 0) {
              process.send!({
                type: 'progress',
                workerId,
                processed: i + 1,
                total: cells.length,
                matched,
              } satisfies WorkerProgress);
            }
            continue;
          }

          coord[0] = lng;
          coord[1] = lat;
          const districts: DistrictMapping = new Array(
            PROTOCOL_DISTRICT_SLOTS
          ).fill(null);
          let hasAny = false;

          for (const candidate of candidates) {
            const slotIndex = districtIdToSlot(candidate.id);
            if (slotIndex === -1) continue;
            // Slot already filled — districts don't overlap within a layer,
            // so skip redundant geometry parse + PIP test.
            if (districts[slotIndex] !== null) continue;

            let geo = geoCache.get(candidate.id);
            if (!geo) {
              try {
                geo = JSON.parse(candidate.geometry) as Polygon | MultiPolygon;
                geoCache.set(candidate.id, geo);
              } catch {
                continue;
              }
            }

            if (booleanPointInPolygon(coord, geo)) {
              districts[slotIndex] = candidate.id;
              hasAny = true;
            }
          }

          if (hasAny) {
            // Write as NDJSON line: ["cellId", [slot0, slot1, ...]]
            writeSync(fd, JSON.stringify([cell, districts]) + '\n');
            matched++;
          }

          if ((i + 1) % 100000 === 0) {
            process.send!({
              type: 'progress',
              workerId,
              processed: i + 1,
              total: cells.length,
              matched,
            } satisfies WorkerProgress);
          }
        }
      } finally {
        closeSync(fd);
      }
    } finally {
      db.close();
    }

    process.send!(
      {
        type: 'done',
        workerId,
        tmpFile,
        matched,
        processed: cells.length,
        noCandidate,
        cacheSize: geoCache.size,
        cacheHits: geoCache.hits,
        cacheMisses: geoCache.misses,
        elapsedMs: Date.now() - workerStart,
      } satisfies WorkerDone,
      undefined,
      undefined,
      () => {
        process.exit(0);
      }
    );
  });
}

// ================================================================
// OUTPUT WRITING
// ================================================================

function writeOutputs(
  output: MappingOutput,
  outputDir: string,
  mapping: Record<string, DistrictMapping>,
  stats: {
    totalEnumerated: number;
    oceanFiltered: number;
    totalProcessed: number;
    totalMatched: number;
    totalNoCandidate: number;
    totalCacheHits: number;
    totalCacheMisses: number;
    workerCount: number;
    totalElapsedSec: number;
  }
) {
  const json = JSON.stringify(output);
  const uncompressedMB = json.length / 1024 / 1024;
  console.log(`  Uncompressed JSON: ${uncompressedMB.toFixed(1)} MB`);

  const compressed = brotliCompressSync(Buffer.from(json), {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: json.length,
    },
  });
  const compressedMB = compressed.length / 1024 / 1024;
  const brPath = join(outputDir, 'h3-district-mapping.json.br');
  writeFileSync(brPath, compressed);
  console.log(
    `  Brotli compressed:  ${compressedMB.toFixed(1)} MB → ${brPath}`
  );

  const sampleEntries = Object.entries(mapping).slice(0, 1000);
  const sample: MappingOutput = {
    ...output,
    cellCount: sampleEntries.length,
    mapping: Object.fromEntries(sampleEntries),
  };
  const samplePath = join(outputDir, 'h3-district-mapping-sample.json');
  writeFileSync(samplePath, JSON.stringify(sample, null, 2));
  console.log(`  Sample (1000 cells): ${samplePath}`);

  const uniqueDistrictsPerSlot: Record<string, number> = {};
  for (const [slotIdx, slotDef] of Object.entries(US_JURISDICTION.slots)) {
    const idx = Number(slotIdx);
    const uniqueIds = new Set(
      Object.values(mapping)
        .map((m) => m[idx])
        .filter(Boolean)
    );
    if (uniqueIds.size > 0) {
      uniqueDistrictsPerSlot[slotDef.name] = uniqueIds.size;
    }
  }

  const metadata = {
    version: output.version,
    resolution: output.resolution,
    generated: output.generated,
    totalCellsEnumerated: stats.totalEnumerated,
    oceanFiltered: stats.oceanFiltered,
    cellsProcessed: stats.totalProcessed,
    matchedCells: stats.totalMatched,
    noCandidateCells: stats.totalNoCandidate,
    uncompressedBytes: json.length,
    compressedBytes: compressed.length,
    compressionRatio: +(json.length / compressed.length).toFixed(1),
    slotsUsed: Object.keys(uniqueDistrictsPerSlot).length,
    totalSlots: PROTOCOL_DISTRICT_SLOTS,
    uniqueDistrictsPerSlot,
    performance: {
      workerCount: stats.workerCount,
      totalElapsedSec: Math.round(stats.totalElapsedSec),
      cellsPerSec: Math.round(
        stats.totalProcessed / stats.totalElapsedSec
      ),
      cacheHits: stats.totalCacheHits,
      cacheMisses: stats.totalCacheMisses,
    },
    regions: US_REGIONS.map((r) => r.name),
    schema: {
      description:
        'H3 cell index → district IDs. Each key is an H3 res-7 hex string. Values are 24-element arrays matching PROTOCOL_DISTRICT_SLOTS.',
      slotNames: output.slotNames,
      h3Format:
        'H3 resolution 7, hex string (15 chars, e.g., 872830828ffffff)',
      lookupPattern:
        'import { latLngToCell } from "h3-js"; const cell = latLngToCell(lat, lng, 7); const districts = mapping[cell]; // districts[0] = Congressional District, etc.',
    },
  };

  const metaPath = join(outputDir, 'h3-mapping-metadata.json');
  writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
  console.log(`  Metadata: ${metaPath}`);
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  const rmins = mins % 60;
  return `${hrs}h ${rmins}m`;
}
