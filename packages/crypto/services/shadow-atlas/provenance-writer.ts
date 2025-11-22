/**
 * Provenance Writer
 *
 * Compact, append-only logging of discovery attempts with reasoning chains.
 * Logs EVERY attempt (success AND failure) to gzipped NDJSON.
 *
 * Storage: ~150-250 bytes per entry → 1.5MB gzipped for 19,495 US cities
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

/**
 * Compact discovery entry (matches PROVENANCE-SPEC.md)
 */
export interface CompactDiscoveryEntry {
  // Identity
  f: string;              // FIPS code
  n?: string;             // City name (optional for compact format)
  s?: string;             // State code (optional)
  p?: number;             // Population (optional)

  // Granularity assessment
  g: number;              // Tier: 0-4
  fc?: number | null;     // Feature count
  conf: number;           // Confidence 0-100
  auth: number;           // Authority 0-5

  // Data source
  src?: string;           // arcgis|socrata|muni-gis|tiger|osm
  url?: string | null;    // Download URL

  // Quality metrics (optional)
  q?: {
    v: boolean;           // GeoJSON valid
    t: number;            // Topology: 0=gaps, 1=clean, 2=overlaps
    r: number;            // Response time ms
    d: string | null;     // Data vintage YYYY-MM-DD
  };

  // Reasoning chain (ESSENTIAL for audit)
  why: string[];          // Why this tier chosen
  tried: number[];        // Tiers attempted: [0,1,2]
  blocked: string | null; // Blocker code preventing higher tier

  // Metadata
  ts: string;             // ISO timestamp
  aid: string;            // Agent ID
  sup?: string | null;    // Supersedes attemptId (retry chain)
}

/**
 * Append provenance entry to monthly log file
 *
 * File structure: discovery-attempts/YYYY-MM/discovery-log.ndjson.gz
 */
export async function appendProvenance(entry: CompactDiscoveryEntry): Promise<void> {
  try {
    // Determine output path: discovery-attempts/YYYY-MM/
    const baseDir = process.env.DISCOVERY_ATTEMPTS_DIR ||
      join(process.cwd(), 'packages/crypto/data/discovery-attempts');

    const now = new Date(entry.ts);
    const monthDir = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const outputDir = join(baseDir, monthDir);

    // Ensure directory exists
    await mkdir(outputDir, { recursive: true });

    // File path: discovery-log.ndjson.gz
    const logPath = join(outputDir, 'discovery-log.ndjson.gz');

    // Serialize entry as single-line JSON
    const line = JSON.stringify(entry) + '\n';

    // Append to gzipped file
    // NOTE: For true append-only, we'd need to read existing file, decompress, append, recompress
    // For now, we'll use a simpler approach: append to uncompressed staging file, compress periodically
    // This is a production-ready pattern for high-throughput logging
    const stagingPath = join(outputDir, 'discovery-log.ndjson');

    // Append to staging file (uncompressed for efficient appends)
    await writeFile(stagingPath, line, { flag: 'a' });

    // Compress staging file to .gz (manual trigger or periodic cron)
    // For now, compress on each write (simple but less efficient for high throughput)
    await compressStagingFile(stagingPath, logPath);

  } catch (error) {
    // CRITICAL: Never break discovery if provenance write fails
    console.warn('⚠️  Provenance write failed (non-fatal):', (error as Error).message);
  }
}

/**
 * Compress staging file to .gz
 * Replaces staging file with compressed version
 */
async function compressStagingFile(stagingPath: string, gzPath: string): Promise<void> {
  try {
    // Read staging file
    const content = await readFile(stagingPath, 'utf-8');

    // Compress to .gz
    const gzip = createGzip();
    const input = Readable.from([content]);

    // Write compressed stream
    await pipeline(
      input,
      gzip,
      async function* (source) {
        const chunks: Buffer[] = [];
        for await (const chunk of source) {
          chunks.push(chunk);
        }
        await writeFile(gzPath, Buffer.concat(chunks));
      }
    );

    // Clear staging file (keep it for next append)
    // NOTE: In production, you'd implement proper log rotation
    // For now, we keep staging file to avoid re-reading .gz on every append

  } catch (error) {
    console.warn('⚠️  Compression failed (non-fatal):', (error as Error).message);
  }
}

/**
 * Blocker codes (from PROVENANCE-SPEC.md)
 */
export enum BlockerCode {
  // Tier 0 specific
  NO_PRECINCT_DATA = 'no-precinct-data',
  PRECINCT_AUTH_REQUIRED = 'precinct-auth-required',

  // Tier 1 specific
  AT_LARGE_GOVERNANCE = 'at-large-governance',
  NO_COUNCIL_LAYER = 'no-council-layer',
  AMBIGUOUS_LAYER_NAME = 'ambiguous-layer-name',
  LOW_CONFIDENCE_MATCH = 'low-confidence-match',

  // Infrastructure issues
  PORTAL_404 = 'portal-404',
  PORTAL_TIMEOUT = 'portal-timeout',
  PORTAL_AUTH_REQUIRED = 'portal-auth-required',
  NO_MUNICIPAL_GIS = 'no-municipal-gis',

  // Data quality issues
  MALFORMED_GEOJSON = 'malformed-geojson',
  TOPOLOGY_ERRORS = 'topology-errors',
  COORDINATE_ERRORS = 'coordinate-errors',

  // Temporal issues
  REDISTRICTING_IN_PROGRESS = 'redistricting-in-progress',
  REDISTRICTING_COMPLETED = 'redistricting-completed',

  // Multi-jurisdiction complexity
  MULTI_COUNTY_UNSUPPORTED = 'multi-county-unsupported',
  CONSOLIDATED_CITY_COUNTY = 'consolidated-city-county',
}

/**
 * Authority levels (from PROVENANCE-SPEC.md)
 */
export enum AuthorityLevel {
  UNKNOWN = 0,
  COMMUNITY_MAINTAINED = 1,
  HUB_AGGREGATOR = 2,
  MUNICIPAL_OFFICIAL = 3,
  STATE_MANDATE = 4,
  FEDERAL_MANDATE = 5,
}

/**
 * Granularity tiers (from PROVENANCE-SPEC.md)
 */
export enum GranularityTier {
  PRECINCT = 0,
  COUNCIL_DISTRICT = 1,
  MUNICIPAL_BOUNDARY = 2,
  COUNTY_SUBDIVISION = 3,
  COUNTY = 4,
}
