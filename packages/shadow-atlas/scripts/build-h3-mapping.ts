#!/usr/bin/env tsx
/**
 * Build H3→District Mapping
 *
 * Pre-computes the H3 resolution-7 → district mapping for the entire US.
 * Moves the R-tree spatial lookup from runtime to build time.
 *
 * Usage:
 *   tsx scripts/build-h3-mapping.ts <dbPath> [outputDir]
 *
 * Arguments:
 *   dbPath    - Path to shadow-atlas-full.db (3.6GB SQLite with R-tree index)
 *   outputDir - Output directory (default: ./output)
 *
 * Outputs:
 *   h3-district-mapping.json.br  - Brotli-compressed mapping (target: 3-5 MB)
 *   h3-district-mapping-sample.json - First 1000 cells (for client integration testing)
 *   h3-mapping-metadata.json     - Build stats and schema info
 *
 * Requirements:
 *   - Node.js 20+, 8GB RAM (GitHub Actions runner compatible)
 *   - shadow-atlas-full.db with populated districts table + rtree_index
 *   - h3-js v4 (devDependency)
 *
 * Performance:
 *   - ~2.2M H3 cells across contiguous US + Alaska + Hawaii
 *   - ~30-60 min on GHA runner (depends on geometry complexity)
 *   - Geometry LRU cache keeps memory bounded to ~500MB
 */

import Database from 'better-sqlite3';
import * as turf from '@turf/turf';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import { polygonToCells, cellToLatLng } from 'h3-js';
import { brotliCompressSync, constants } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { US_JURISDICTION, PROTOCOL_DISTRICT_SLOTS } from '../src/jurisdiction.js';

// ---- Configuration ----

const H3_RESOLUTION = 7;

/**
 * ZK ENCODING CONTRACT (signed off by proof):
 * - H3 cell IDs are 64-bit integers stored as lowercase hex (15-char, e.g., '872830828ffffff')
 * - For BN254 circuit input: BigInt('0x' + h3CellId) — fits trivially in 254-bit field
 * - Lowercase hex normalization is REQUIRED for deterministic dedup and sorting
 * - h3-js v4 already returns lowercase — no conversion needed in this script
 * - MAX_CELLS=16 at res-7 holds (typical postal bubble covers 2-5 cells)
 */

/**
 * US bounding boxes for H3 cell enumeration.
 * Coordinates are [lat, lng] pairs (h3-js native format, isGeoJSON=false).
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

/**
 * Build PREFIX_TO_SLOT from US_JURISDICTION.aliases.
 *
 * The R-tree district IDs use the format `{prefix}-{geoid}` (e.g., "cd-0601", "sldu-06001").
 * US_JURISDICTION.aliases maps alias names to slot indices (e.g., { cd: 0, sldu: 2 }).
 * We build a lookup: for each alias, create a prefix pattern `{alias}-` → slot index.
 *
 * Some aliases share a slot (e.g., 'congressional' and 'cd' both → slot 0).
 * The R-tree only uses certain prefixes — others (like 'congressional') are display aliases.
 * We include all aliases so the lookup is complete; non-matching prefixes simply never hit.
 */
const PREFIX_TO_SLOT: Record<string, number> = {};
for (const [alias, slotIndex] of Object.entries(US_JURISDICTION.aliases)) {
  PREFIX_TO_SLOT[`${alias}-`] = slotIndex;
}

/**
 * Sorted prefixes by length (longest first) for greedy matching.
 * Ensures "school_unified-" matches before "school-" if both existed.
 */
const SORTED_PREFIXES = Object.keys(PREFIX_TO_SLOT).sort((a, b) => b.length - a.length);

/**
 * Find the slot index for a district ID by matching its prefix.
 * Returns -1 if no matching prefix found (unknown district type).
 */
function districtIdToSlot(districtId: string): number {
  for (const prefix of SORTED_PREFIXES) {
    if (districtId.startsWith(prefix)) {
      return PREFIX_TO_SLOT[prefix];
    }
  }
  return -1;
}

// ---- Output Schema ----

/**
 * Per-cell district mapping — 24-element array matching PROTOCOL_DISTRICT_SLOTS.
 * Each index corresponds to a slot in US_JURISDICTION.slots.
 * null = no district data for that slot.
 */
type DistrictMapping = (string | null)[];

/**
 * Top-level output format.
 * This is the schema that bedrock (communique client) consumes.
 */
interface MappingOutput {
  /** Schema version (increment on breaking changes) */
  version: number;
  /** H3 resolution used */
  resolution: number;
  /** ISO-8601 build timestamp */
  generated: string;
  /** Number of cells with at least one district match */
  cellCount: number;
  /** Slot names (index → human-readable name) from jurisdiction config */
  slotNames: Record<number, string>;
  /** H3 cell index → district IDs (24-element array) */
  mapping: Record<string, DistrictMapping>;
}

// ---- LRU Geometry Cache ----

class GeometryCache {
  private cache = new Map<
    string,
    Feature<Polygon | MultiPolygon>
  >();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string) {
    const val = this.cache.get(key);
    if (val) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, val);
    }
    return val;
  }

  set(
    key: string,
    val: Feature<Polygon | MultiPolygon>
  ) {
    this.cache.delete(key);
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, val);
  }

  get size() {
    return this.cache.size;
  }
}

// ---- Main ----

function main() {
  const dbPath = process.argv[2];
  if (!dbPath) {
    console.error('Usage: tsx scripts/build-h3-mapping.ts <dbPath> [outputDir]');
    console.error('  dbPath: path to shadow-atlas-full.db');
    process.exit(1);
  }

  const outputDir = process.argv[3] || './output';
  mkdirSync(outputDir, { recursive: true });

  console.log(`Database: ${dbPath}`);
  console.log(`Output:   ${outputDir}`);
  console.log(`H3 resolution: ${H3_RESOLUTION}`);
  console.log();

  const db = new Database(dbPath, { readonly: true });
  db.pragma('journal_mode = WAL');

  // Prepare R-tree lookup — returns candidate districts whose bounding box contains the point
  const lookupStmt = db.prepare(`
    SELECT d.id, d.geometry
    FROM districts d
    JOIN rtree_index r ON d.rowid = r.id
    WHERE r.min_lon <= ? AND r.max_lon >= ?
      AND r.min_lat <= ? AND r.max_lat >= ?
  `);

  const geoCache = new GeometryCache(5000);
  let cacheHits = 0;
  let cacheMisses = 0;

  // Step 1: Enumerate all H3 cells across US regions
  console.log('Enumerating H3 cells...');
  const allCells = new Set<string>();

  for (const region of US_REGIONS) {
    const cells = polygonToCells([region.polygon], H3_RESOLUTION, false);
    console.log(`  ${region.name}: ${cells.length.toLocaleString()} cells`);
    for (const cell of cells) {
      allCells.add(cell);
    }
  }

  const cellArray = Array.from(allCells);
  console.log(`Total unique cells: ${cellArray.length.toLocaleString()}`);
  console.log();

  // Step 2: Map each cell to its districts
  const mapping: Record<string, DistrictMapping> = {};
  let processed = 0;
  let matched = 0;
  let noCandidate = 0;
  const startTime = Date.now();

  for (const cell of cellArray) {
    const [lat, lng] = cellToLatLng(cell);

    // R-tree bounding box filter
    const candidates = lookupStmt.all(lng, lng, lat, lat) as Array<{
      id: string;
      geometry: string;
    }>;

    if (candidates.length === 0) {
      noCandidate++;
      processed++;
      if (processed % 100000 === 0)
        logProgress(processed, cellArray.length, matched, startTime);
      continue;
    }

    const point = turf.point([lng, lat]);
    const districts: DistrictMapping = new Array(PROTOCOL_DISTRICT_SLOTS).fill(null);
    let hasAny = false;

    for (const candidate of candidates) {
      // Map district ID prefix to slot index
      const slotIndex = districtIdToSlot(candidate.id);
      if (slotIndex === -1) continue; // Unknown district type

      try {
        // Check geometry cache first
        let feature = geoCache.get(candidate.id);
        if (feature) {
          cacheHits++;
        } else {
          cacheMisses++;
          const geometry = JSON.parse(candidate.geometry);
          feature =
            geometry.type === 'Polygon'
              ? turf.polygon(geometry.coordinates)
              : turf.multiPolygon(geometry.coordinates);
          geoCache.set(candidate.id, feature);
        }

        if (turf.booleanPointInPolygon(point, feature)) {
          districts[slotIndex] = candidate.id;
          hasAny = true;
        }
      } catch {
        // Skip malformed geometries
        continue;
      }
    }

    if (hasAny) {
      mapping[cell] = districts;
      matched++;
    }

    processed++;
    if (processed % 100000 === 0)
      logProgress(processed, cellArray.length, matched, startTime);
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log();
  console.log(`Processing complete in ${formatTime(elapsed)}`);
  console.log(`  Matched:      ${matched.toLocaleString()} cells`);
  console.log(`  No candidate: ${noCandidate.toLocaleString()} cells (ocean/outside US)`);
  console.log(`  Geo cache:    ${cacheHits.toLocaleString()} hits, ${cacheMisses.toLocaleString()} misses (${geoCache.size} entries)`);
  console.log();

  db.close();

  // Step 3: Write outputs
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

  writeOutputs(output, outputDir, mapping);
}

function writeOutputs(
  output: MappingOutput,
  outputDir: string,
  mapping: Record<string, DistrictMapping>
) {
  // 3a. Brotli-compressed full mapping
  const json = JSON.stringify(output);
  const uncompressedMB = json.length / 1024 / 1024;
  console.log(`Uncompressed JSON: ${uncompressedMB.toFixed(1)} MB`);

  const compressed = brotliCompressSync(Buffer.from(json), {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: json.length,
    },
  });
  const compressedMB = compressed.length / 1024 / 1024;
  const brPath = join(outputDir, 'h3-district-mapping.json.br');
  writeFileSync(brPath, compressed);
  console.log(`Brotli compressed:  ${compressedMB.toFixed(1)} MB → ${brPath}`);

  // 3b. Sample (first 1000 cells for bedrock testing)
  const sampleEntries = Object.entries(mapping).slice(0, 1000);
  const sample: MappingOutput = {
    ...output,
    cellCount: sampleEntries.length,
    mapping: Object.fromEntries(sampleEntries),
  };
  const samplePath = join(outputDir, 'h3-district-mapping-sample.json');
  writeFileSync(samplePath, JSON.stringify(sample, null, 2));
  console.log(`Sample (1000 cells): ${samplePath}`);

  // 3c. Metadata
  // Count unique district IDs per slot
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
    totalCellsEnumerated: Object.keys(mapping).length,
    matchedCells: output.cellCount,
    uncompressedBytes: json.length,
    compressedBytes: compressed.length,
    compressionRatio: +(json.length / compressed.length).toFixed(1),
    slotsUsed: Object.keys(uniqueDistrictsPerSlot).length,
    totalSlots: PROTOCOL_DISTRICT_SLOTS,
    uniqueDistrictsPerSlot,
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
  console.log(`Metadata: ${metaPath}`);
}

function logProgress(
  processed: number,
  total: number,
  matched: number,
  startTime: number
) {
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = processed / elapsed;
  const eta = (total - processed) / rate;
  const pct = ((processed / total) * 100).toFixed(1);
  console.log(
    `  ${processed.toLocaleString()}/${total.toLocaleString()} (${pct}%) | ` +
      `${matched.toLocaleString()} matched | ` +
      `${Math.round(rate).toLocaleString()} cells/sec | ` +
      `ETA: ${formatTime(eta)}`
  );
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

main();
