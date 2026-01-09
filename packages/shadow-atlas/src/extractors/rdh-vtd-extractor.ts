/**
 * RDH VTD Extractor
 *
 * Extracts Voting Tabulation District (VTD) GEOIDs from Redistricting Data Hub.
 * This is the authoritative architectural component for VTD data ingestion.
 *
 * ARCHITECTURE:
 * - Uses RDH WordPress API for dataset discovery and download
 * - Caches shapefiles to `packages/crypto/data/rdh-cache/`
 * - Extracts GEOIDs using ogrinfo (requires GDAL)
 * - Outputs per-state JSON to `data/vtd-geoids/` for `vtd-loader.ts`
 *
 * DATA SOURCE: https://redistrictingdatahub.org (Princeton Gerrymandering Project)
 * UPDATE CADENCE: Post-election (Q1 of odd years), post-redistricting
 *
 * REPLACES: scripts/extract-vtd-geoids.mjs (orphaned script)
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile, access, readdir, unlink } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * State FIPS codes for all US states + DC
 */
export const STATE_FIPS: Record<string, string> = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06',
  CO: '08', CT: '09', DE: '10', DC: '11', FL: '12',
  GA: '13', HI: '15', ID: '16', IL: '17', IN: '18',
  IA: '19', KS: '20', KY: '21', LA: '22', ME: '23',
  MD: '24', MA: '25', MI: '26', MN: '27', MS: '28',
  MO: '29', MT: '30', NE: '31', NV: '32', NH: '33',
  NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38',
  OH: '39', OK: '40', OR: '41', PA: '42', RI: '44',
  SC: '45', SD: '46', TN: '47', TX: '48', UT: '49',
  VT: '50', VA: '51', WA: '53', WV: '54', WI: '55',
  WY: '56',
};

export const STATE_CODES = Object.keys(STATE_FIPS);

/**
 * Common GEOID field names across different VEST data formats
 * Order matters - prefer standard GEOID fields first
 */
const GEOID_FIELDS = [
  'GEOID20', 'GEOID', 'GEOID10', 'VTDST20', 'VTDST',
  'SRPREC_KEY', 'PRECINCT_ID', 'VTD_KEY', 'PCTNUM',
  'PRECINCTNA', 'PREC_ID', 'PRECINCT', 'PRECINCTID',
  'PRECINCT_I', 'VTD', 'VTDID', 'PREC', 'SOSPRECINC', 'PRECNAME',
  // State-specific fields
  'NAME20',     // CT, ME, VT
  'WARDID',     // WI
  'LABEL',      // WI fallback
  'PCODE',      // SC
  'CODE_NAME',  // SC fallback
  'NUMBER',     // MD
  'VOTESPRE',   // MD fallback
  'MUN_NAME',   // NJ
  'DISTRICT',   // AK, IA
  'NAME',       // Fallback for many states
];

/**
 * RDH API credentials
 */
export interface RDHCredentials {
  readonly username: string;
  readonly password: string;
}

/**
 * RDH dataset metadata
 */
export interface RDHDataset {
  readonly Title: string;
  readonly Filename: string;
  readonly URL: string;
  readonly Format: string;
  readonly SizeMB: number;
  readonly State: string;
}

/**
 * VTD extraction result for a single state
 */
export interface VTDExtractionResult {
  readonly stateCode: string;
  readonly stateFips: string;
  readonly geoidField: string;
  readonly count: number;
  readonly geoids: readonly string[];
  readonly source: string;
  readonly vintage: string;
  readonly extractedAt: string;
}

/**
 * VTD extractor options
 */
export interface VTDExtractorOptions {
  /** Cache directory for downloaded shapefiles */
  readonly cacheDir?: string;
  /** Output directory for extracted VTD JSON files */
  readonly outputDir?: string;
  /** Request timeout in milliseconds */
  readonly timeout?: number;
  /** API rate limit delay between states (ms) */
  readonly rateLimitDelay?: number;
  /** Force re-download even if cached */
  readonly forceRefresh?: boolean;
}

/**
 * RDH VTD Extractor
 *
 * Production-grade service for extracting VTD GEOIDs from Redistricting Data Hub.
 */
export class RDHVTDExtractor {
  private readonly RDH_API_URL = 'https://redistrictingdatahub.org/wp-json/download/list';
  private readonly credentials: RDHCredentials;
  private readonly cacheDir: string;
  private readonly outputDir: string;
  private readonly timeout: number;
  private readonly rateLimitDelay: number;
  private readonly forceRefresh: boolean;

  constructor(credentials: RDHCredentials, options: VTDExtractorOptions = {}) {
    this.credentials = credentials;
    this.cacheDir = options.cacheDir ?? join(__dirname, '../../packages/crypto/data/rdh-cache');
    this.outputDir = options.outputDir ?? join(__dirname, '../../data/vtd-geoids');
    this.timeout = options.timeout ?? 120000; // 2 minutes for large downloads
    this.rateLimitDelay = options.rateLimitDelay ?? 1500;
    this.forceRefresh = options.forceRefresh ?? false;
  }

  /**
   * Extract VTD GEOIDs for all states
   *
   * @param states - Optional list of state codes to process (defaults to all)
   * @returns Extraction results for each state
   */
  async extractAll(states?: readonly string[]): Promise<readonly VTDExtractionResult[]> {
    const targetStates = states ?? STATE_CODES;
    const results: VTDExtractionResult[] = [];

    console.log(`[RDHVTDExtractor] Processing ${targetStates.length} state(s)...`);

    for (const stateCode of targetStates) {
      try {
        const result = await this.extractState(stateCode);
        if (result) {
          results.push(result);
          // Write per-state JSON file for vtd-loader.ts
          await this.writeStateJSON(result);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[RDHVTDExtractor] Error processing ${stateCode}: ${message}`);
      }

      // Rate limit API calls
      await this.delay(this.rateLimitDelay);
    }

    // Write manifest file
    await this.writeManifest(results);

    return results;
  }

  /**
   * Extract VTD GEOIDs for a single state
   *
   * @param stateCode - Two-letter state code (e.g., "CA")
   * @returns Extraction result or null if no data available
   */
  async extractState(stateCode: string): Promise<VTDExtractionResult | null> {
    const stateFips = STATE_FIPS[stateCode];
    if (!stateFips) {
      console.warn(`[RDHVTDExtractor] Unknown state code: ${stateCode}`);
      return null;
    }

    console.log(`\n=== ${stateCode} (FIPS ${stateFips}) ===`);

    // Check for cached shapefile first
    let shpPath = await this.findCachedShapefile(stateCode);

    if (!shpPath || this.forceRefresh) {
      // Download from API
      const datasets = await this.listVTDDatasets(stateCode);
      if (datasets.length === 0) {
        console.log(`  No VTD datasets available`);
        return null;
      }

      console.log(`  Found ${datasets.length} VTD dataset(s)`);
      const best = datasets[0];
      console.log(`  Using: ${best.Title}`);

      const zipPath = await this.downloadFile(best, stateCode);
      shpPath = await this.unzipFile(zipPath, stateCode);
    }

    console.log(`  Shapefile: ${basename(shpPath)}`);

    // Detect GEOID field
    const geoidField = await this.detectGeoidField(shpPath);
    if (!geoidField) {
      console.error(`  ERROR: Could not detect GEOID field`);
      return null;
    }
    console.log(`  GEOID field: ${geoidField}`);

    // Extract GEOIDs
    const geoids = await this.extractGeoidsFromShapefile(shpPath, geoidField);
    console.log(`  Extracted: ${geoids.length} unique VTD GEOIDs`);

    return {
      stateCode,
      stateFips,
      geoidField,
      count: geoids.length,
      geoids,
      source: 'Redistricting Data Hub',
      vintage: '2020', // VEST 2020 data
      extractedAt: new Date().toISOString(),
    };
  }

  /**
   * List VTD datasets from RDH API for a state
   */
  private async listVTDDatasets(stateCode: string): Promise<readonly RDHDataset[]> {
    const params = new URLSearchParams({
      username: this.credentials.username,
      password: this.credentials.password,
      format: 'json',
      states: stateCode,
    });

    const response = await fetch(`${this.RDH_API_URL}?${params}`, {
      signal: AbortSignal.timeout(this.timeout),
    });

    const data = await response.json();

    if (!Array.isArray(data)) {
      console.error(`  API error for ${stateCode}:`, (data as { message?: string }).message ?? data);
      return [];
    }

    // Filter for VTD/precinct shapefiles
    const vtdDatasets = (data as RDHDataset[]).filter(d => {
      const title = (d.Title ?? '').toLowerCase();
      const filename = (d.Filename ?? '').toLowerCase();
      const isVTD = title.includes('vtd') || filename.includes('vtd') ||
                    title.includes('precinct') || filename.includes('precinct');
      const isShapefile = d.Format === 'SHP';
      return isVTD && isShapefile;
    });

    // Prefer 2020 VEST data, then 2022, then any
    vtdDatasets.sort((a, b) => {
      const scoreA = a.Title.includes('VEST 2020') ? 0 : a.Title.includes('VEST 2022') ? 1 : 2;
      const scoreB = b.Title.includes('VEST 2020') ? 0 : b.Title.includes('VEST 2022') ? 1 : 2;
      return scoreA - scoreB;
    });

    return vtdDatasets;
  }

  /**
   * Download a dataset file
   */
  private async downloadFile(dataset: RDHDataset, stateCode: string): Promise<string> {
    const stateDir = join(this.cacheDir, stateCode);
    await mkdir(stateDir, { recursive: true });

    const filePath = join(stateDir, dataset.Filename);

    // Check cache
    if (!this.forceRefresh) {
      try {
        await access(filePath);
        console.log(`  [CACHED] ${dataset.Filename}`);
        return filePath;
      } catch {
        // Not cached, download
      }
    }

    const downloadUrl = dataset.URL
      .replace('YOURUSERNAME', this.credentials.username)
      .replace('YOURPASSWORD', encodeURIComponent(this.credentials.password));

    console.log(`  Downloading ${dataset.Filename} (${dataset.SizeMB}MB)...`);

    const response = await fetch(downloadUrl, {
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));
    return filePath;
  }

  /**
   * Find cached shapefile for a state
   */
  private async findCachedShapefile(stateCode: string): Promise<string | null> {
    const stateDir = join(this.cacheDir, stateCode);

    try {
      const files = await readdir(stateDir);
      const shpFiles = files.filter(f => f.endsWith('.shp'));
      if (shpFiles.length > 0) {
        return join(stateDir, shpFiles[0]);
      }
    } catch {
      // Directory doesn't exist
    }

    return null;
  }

  /**
   * Unzip a shapefile archive
   */
  private async unzipFile(zipPath: string, stateCode: string): Promise<string> {
    const stateDir = join(this.cacheDir, stateCode);

    // Check if already unzipped
    const files = await readdir(stateDir);
    const shpFiles = files.filter(f => f.endsWith('.shp'));
    if (shpFiles.length > 0) {
      return join(stateDir, shpFiles[0]);
    }

    // Unzip
    await this.exec('unzip', ['-o', zipPath, '-d', stateDir]);

    // Find extracted shapefile
    const newFiles = await readdir(stateDir);
    const newShpFiles = newFiles.filter(f => f.endsWith('.shp'));
    if (newShpFiles.length === 0) {
      throw new Error('No .shp file found after unzip');
    }

    return join(stateDir, newShpFiles[0]);
  }

  /**
   * Detect GEOID field in shapefile
   */
  private async detectGeoidField(shpPath: string): Promise<string | null> {
    try {
      const info = await this.exec('ogrinfo', ['-al', '-so', shpPath]);

      for (const field of GEOID_FIELDS) {
        if (info.includes(`${field}:`)) {
          return field;
        }
      }

      // Fallback: look for any field containing 'prec' or 'vtd' or 'geoid'
      const lines = info.split('\n');
      for (const line of lines) {
        const match = line.match(/^(\w+): String/i);
        if (match) {
          const fieldName = match[1].toLowerCase();
          if (fieldName.includes('prec') || fieldName.includes('vtd') || fieldName.includes('geoid')) {
            return match[1];
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extract GEOIDs from shapefile using ogrinfo SQL DISTINCT
   */
  private async extractGeoidsFromShapefile(
    shpPath: string,
    geoidField: string
  ): Promise<readonly string[]> {
    try {
      const layerName = basename(shpPath, '.shp');
      const output = await this.exec('ogrinfo', [
        '-sql',
        `SELECT DISTINCT ${geoidField} FROM ${layerName} ORDER BY ${geoidField}`,
        shpPath,
      ]);

      // Parse ogrinfo output: "  FIELD (String) = value"
      const lines = output.split('\n');
      const geoids: string[] = [];
      const pattern = new RegExp(`${geoidField}.*= (.+)$`);

      for (const line of lines) {
        const match = line.match(pattern);
        if (match) {
          const geoid = match[1].trim();
          if (geoid && geoid !== '(null)') {
            // Escape for TypeScript string literals
            geoids.push(geoid);
          }
        }
      }

      return geoids;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  Error extracting GEOIDs: ${message}`);
      return [];
    }
  }

  /**
   * Write per-state JSON file for vtd-loader.ts consumption
   */
  private async writeStateJSON(result: VTDExtractionResult): Promise<void> {
    await mkdir(this.outputDir, { recursive: true });

    const jsonPath = join(this.outputDir, `${result.stateFips}.json`);
    const data = {
      stateFips: result.stateFips,
      count: result.count,
      geoids: result.geoids,
      timestamp: result.extractedAt,
      source: result.source,
      vintage: result.vintage,
    };

    await writeFile(jsonPath, JSON.stringify(data, null, 2));
    console.log(`  Wrote: ${jsonPath}`);
  }

  /**
   * Write extraction manifest
   */
  private async writeManifest(results: readonly VTDExtractionResult[]): Promise<void> {
    const manifest = {
      generated: new Date().toISOString(),
      source: 'Redistricting Data Hub',
      states: results.map(r => ({
        code: r.stateCode,
        fips: r.stateFips,
        geoidField: r.geoidField,
        count: r.count,
      })),
      totalVTDs: results.reduce((sum, r) => sum + r.count, 0),
    };

    const manifestPath = join(this.cacheDir, 'vtd-manifest.json');
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`\nManifest: ${manifestPath}`);
  }

  /**
   * Execute a shell command
   */
  private async exec(command: string, args: readonly string[]): Promise<string> {
    const { stdout } = await execFileAsync(command, [...args], {
      maxBuffer: 100 * 1024 * 1024, // 100MB for large outputs
    });
    return stdout;
  }

  /**
   * Delay helper for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Load RDH credentials from environment
 *
 * @returns Credentials or null if not configured
 */
export function loadRDHCredentials(): RDHCredentials | null {
  const username = process.env['RDH_USERNAME'];
  const password = process.env['RDH_PASSWORD'];

  if (!username || !password) {
    return null;
  }

  return { username, password };
}

/**
 * Create an extractor with environment credentials
 *
 * @param options - Extractor options
 * @returns Configured extractor or null if credentials missing
 */
export function createRDHVTDExtractor(
  options: VTDExtractorOptions = {}
): RDHVTDExtractor | null {
  const credentials = loadRDHCredentials();
  if (!credentials) {
    console.error('[RDHVTDExtractor] Missing RDH_USERNAME and/or RDH_PASSWORD environment variables');
    return null;
  }

  return new RDHVTDExtractor(credentials, options);
}
