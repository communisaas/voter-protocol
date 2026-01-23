/**
 * Tessellation Provenance Writer
 *
 * Records tessellation validation results in the provenance pipeline.
 * Integrates the 4-axiom tessellation proof (exclusivity, exhaustivity,
 * containment, cardinality) with persistent provenance storage.
 *
 * THEOREM: Council districts are correct iff they tessellate the municipal boundary.
 *
 * STORAGE STRATEGY:
 * - Tessellation proofs are stored alongside discovery provenance
 * - Geometry hash ensures validation results match current data
 * - Binary validity with full diagnostic metadata for debugging
 *
 * CRITICAL TYPE SAFETY: Validation results are audit trail evidence.
 * Missing or incorrect data breaks verification of district correctness.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { createHash } from 'crypto';
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';

import { logger } from '../core/utils/logger.js';
import type { TessellationProof } from '../validators/council/tessellation-proof.js';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// =============================================================================
// Types
// =============================================================================

/**
 * Axiom results - individual pass/fail for each tessellation axiom
 */
export interface AxiomResults {
  /** No overlapping districts */
  readonly exclusivity: boolean;
  /** Complete coverage of municipal boundary */
  readonly exhaustivity: boolean;
  /** All districts within city boundary */
  readonly containment: boolean;
  /** Expected count matches actual */
  readonly cardinality: boolean;
}

/**
 * Diagnostic measurements from tessellation validation
 */
export interface TessellationDiagnostics {
  readonly districtCount: number;
  readonly expectedCount: number;
  readonly totalOverlapArea: number;
  readonly uncoveredArea: number;
  readonly outsideBoundaryArea: number;
  readonly municipalArea: number;
  readonly districtUnionArea: number;
  readonly coverageRatio: number;
}

/**
 * Complete tessellation proof record for provenance storage
 *
 * Includes all information needed to:
 * 1. Verify validation was performed correctly
 * 2. Reproduce validation with same data (via geometry hash)
 * 3. Diagnose failures with detailed measurements
 */
export interface TessellationProofRecord {
  /** Binary validity - all four axioms passed */
  readonly validated: boolean;

  /** ISO timestamp when validation was performed */
  readonly validatedAt: string;

  /** SHA-256 hash of district geometry (integrity verification) */
  readonly geometryHash: string;

  /** Individual axiom results */
  readonly axiomResults: AxiomResults;

  /** Quantitative measurements */
  readonly diagnostics: TessellationDiagnostics;

  /** Which axiom failed (null if all passed) */
  readonly failedAxiom: 'exclusivity' | 'exhaustivity' | 'containment' | 'cardinality' | null;

  /** Human-readable failure explanation */
  readonly failureReason: string | null;

  /** Districts involved in failure */
  readonly problematicDistricts: readonly string[];

  /** Validator version for reproducibility */
  readonly validatorVersion: string;
}

/**
 * Compact tessellation validation entry for NDJSON storage
 *
 * Field names abbreviated for storage efficiency (~200-300 bytes per entry)
 */
export interface CompactTessellationEntry {
  /** FIPS code (7 chars) */
  readonly f: string;

  /** City name (optional) */
  readonly n?: string;

  /** State code (2 chars) */
  readonly s?: string;

  /** Validation passed */
  readonly v: boolean;

  /** Validated at (ISO timestamp) */
  readonly vat: string;

  /** Geometry hash (SHA-256, 64 chars) */
  readonly gh: string;

  /** Axiom results: e=exclusivity, x=exhaustivity, c=containment, k=cardinality */
  readonly ax: {
    readonly e: boolean;
    readonly x: boolean;
    readonly c: boolean;
    readonly k: boolean;
  };

  /** Diagnostics (compact) */
  readonly dg: {
    readonly dc: number; // districtCount
    readonly ec: number; // expectedCount
    readonly ov: number; // overlap (sq m)
    readonly uc: number; // uncovered (sq m)
    readonly ob: number; // outside boundary (sq m)
    readonly ma: number; // municipal area (sq m)
    readonly da: number; // district union area (sq m)
    readonly cr: number; // coverage ratio
  };

  /** Failed axiom (null = all passed) */
  readonly fa: 'e' | 'x' | 'c' | 'k' | null;

  /** Failure reason (truncated) */
  readonly fr: string | null;

  /** Problematic districts */
  readonly pd: readonly string[];

  /** Validator version */
  readonly vv: string;

  /** Agent ID */
  readonly aid: string;
}

/**
 * Query filter for tessellation validation entries
 */
export interface TessellationValidationFilter {
  /** Filter by FIPS code */
  readonly fips?: string;

  /** Filter by state code */
  readonly state?: string;

  /** Filter by validation status */
  readonly validated?: boolean;

  /** Filter by failed axiom */
  readonly failedAxiom?: 'exclusivity' | 'exhaustivity' | 'containment' | 'cardinality';

  /** Start date (ISO string) */
  readonly startDate?: string;

  /** End date (ISO string) */
  readonly endDate?: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Current validator version */
const VALIDATOR_VERSION = 'v1.0.0';

/** Failed axiom code mapping (compact -> full) */
const AXIOM_CODE_MAP: Record<'e' | 'x' | 'c' | 'k', 'exclusivity' | 'exhaustivity' | 'containment' | 'cardinality'> = {
  e: 'exclusivity',
  x: 'exhaustivity',
  c: 'containment',
  k: 'cardinality',
};

/** Reverse axiom code mapping (full -> compact) */
const AXIOM_REVERSE_MAP: Record<'exclusivity' | 'exhaustivity' | 'containment' | 'cardinality', 'e' | 'x' | 'c' | 'k'> = {
  exclusivity: 'e',
  exhaustivity: 'x',
  containment: 'c',
  cardinality: 'k',
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Compute SHA-256 hash of district geometry
 *
 * Used to verify that validation results match current data.
 * If geometry changes, hash changes, and previous validation is invalid.
 *
 * @param districts - District feature collection
 * @returns 64-character hex string
 */
export function computeGeometryHash(
  districts: FeatureCollection<Polygon | MultiPolygon>
): string {
  // Normalize geometry to canonical JSON (sorted keys, no whitespace)
  const canonical = JSON.stringify(
    districts.features.map((f) => ({
      type: f.geometry.type,
      coordinates: f.geometry.coordinates,
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  );

  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Convert TessellationProof to provenance record
 *
 * @param proof - Tessellation proof result from validator
 * @param geometryHash - SHA-256 hash of district geometry
 * @returns Complete provenance record
 */
export function proofToRecord(
  proof: TessellationProof,
  geometryHash: string
): TessellationProofRecord {
  // Derive axiom results from proof
  // If valid, all axioms passed. If invalid, determine which failed.
  const axiomResults: AxiomResults = proof.valid
    ? { exclusivity: true, exhaustivity: true, containment: true, cardinality: true }
    : {
        exclusivity: proof.failedAxiom !== 'exclusivity',
        exhaustivity: proof.failedAxiom !== 'exhaustivity',
        containment: proof.failedAxiom !== 'containment',
        cardinality: proof.failedAxiom !== 'cardinality',
      };

  return {
    validated: proof.valid,
    validatedAt: new Date().toISOString(),
    geometryHash,
    axiomResults,
    diagnostics: {
      districtCount: proof.diagnostics.districtCount,
      expectedCount: proof.diagnostics.expectedCount,
      totalOverlapArea: proof.diagnostics.totalOverlapArea,
      uncoveredArea: proof.diagnostics.uncoveredArea,
      outsideBoundaryArea: proof.diagnostics.outsideBoundaryArea,
      municipalArea: proof.diagnostics.municipalArea,
      districtUnionArea: proof.diagnostics.districtUnionArea,
      coverageRatio: proof.diagnostics.coverageRatio,
    },
    failedAxiom: proof.failedAxiom,
    failureReason: proof.reason,
    problematicDistricts: proof.problematicDistricts,
    validatorVersion: VALIDATOR_VERSION,
  };
}

/**
 * Convert provenance record to compact storage format
 *
 * @param record - Full provenance record
 * @param fips - FIPS code
 * @param agentId - Agent ID
 * @param cityName - City name (optional)
 * @param state - State code (optional)
 * @returns Compact entry for NDJSON storage
 */
export function recordToCompact(
  record: TessellationProofRecord,
  fips: string,
  agentId: string,
  cityName?: string,
  state?: string
): CompactTessellationEntry {
  return {
    f: fips,
    ...(cityName && { n: cityName }),
    ...(state && { s: state }),
    v: record.validated,
    vat: record.validatedAt,
    gh: record.geometryHash,
    ax: {
      e: record.axiomResults.exclusivity,
      x: record.axiomResults.exhaustivity,
      c: record.axiomResults.containment,
      k: record.axiomResults.cardinality,
    },
    dg: {
      dc: record.diagnostics.districtCount,
      ec: record.diagnostics.expectedCount,
      ov: Math.round(record.diagnostics.totalOverlapArea),
      uc: Math.round(record.diagnostics.uncoveredArea),
      ob: Math.round(record.diagnostics.outsideBoundaryArea),
      ma: Math.round(record.diagnostics.municipalArea),
      da: Math.round(record.diagnostics.districtUnionArea),
      cr: Math.round(record.diagnostics.coverageRatio * 10000) / 10000, // 4 decimal places
    },
    fa: record.failedAxiom ? AXIOM_REVERSE_MAP[record.failedAxiom] : null,
    fr: record.failureReason ? record.failureReason.substring(0, 200) : null,
    pd: record.problematicDistricts,
    vv: record.validatorVersion,
    aid: agentId,
  };
}

/**
 * Convert compact entry back to full record
 *
 * @param entry - Compact storage entry
 * @returns Full provenance record
 */
export function compactToRecord(entry: CompactTessellationEntry): TessellationProofRecord {
  return {
    validated: entry.v,
    validatedAt: entry.vat,
    geometryHash: entry.gh,
    axiomResults: {
      exclusivity: entry.ax.e,
      exhaustivity: entry.ax.x,
      containment: entry.ax.c,
      cardinality: entry.ax.k,
    },
    diagnostics: {
      districtCount: entry.dg.dc,
      expectedCount: entry.dg.ec,
      totalOverlapArea: entry.dg.ov,
      uncoveredArea: entry.dg.uc,
      outsideBoundaryArea: entry.dg.ob,
      municipalArea: entry.dg.ma,
      districtUnionArea: entry.dg.da,
      coverageRatio: entry.dg.cr,
    },
    failedAxiom: entry.fa ? AXIOM_CODE_MAP[entry.fa] : null,
    failureReason: entry.fr,
    problematicDistricts: entry.pd,
    validatorVersion: entry.vv,
  };
}

// =============================================================================
// Tessellation Provenance Writer
// =============================================================================

/**
 * File lock for concurrent write protection
 */
class FileLock {
  private lockPath: string;
  private lockHandle: fs.FileHandle | null = null;
  private maxRetries = 50;
  private retryDelayMs = 100;

  constructor(filePath: string) {
    this.lockPath = `${filePath}.lock`;
  }

  async acquire(): Promise<void> {
    if (this.lockHandle) {
      try {
        await this.lockHandle.close();
      } catch {
        // Ignore cleanup errors
      }
      this.lockHandle = null;
    }

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        this.lockHandle = await fs.open(this.lockPath, 'wx');
        return;
      } catch {
        if (attempt === this.maxRetries - 1) {
          throw new Error(`Failed to acquire lock after ${this.maxRetries} attempts`);
        }
        const delay = this.retryDelayMs * (1 + Math.random());
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async release(): Promise<void> {
    if (this.lockHandle) {
      try {
        await this.lockHandle.close();
      } catch {
        // Log but don't throw
      } finally {
        this.lockHandle = null;
      }
    }

    try {
      await fs.unlink(this.lockPath);
    } catch {
      // Safe to ignore
    }
  }
}

/**
 * Tessellation Provenance Writer
 *
 * Records and queries tessellation validation results with:
 * - FIPS-based sharding (50-state parallelism)
 * - Gzip compression for storage efficiency
 * - File locking for concurrent write safety
 * - Query interface with filters
 */
export class TessellationProvenanceWriter {
  private baseDir: string;

  constructor(baseDir: string = './provenance') {
    this.baseDir = baseDir;
  }

  /**
   * Record tessellation validation result
   *
   * @param fips - City FIPS code
   * @param proof - Tessellation proof result
   * @param districts - District feature collection (for geometry hash)
   * @param agentId - Agent that performed validation
   * @param cityName - City name (optional)
   * @param state - State code (optional)
   */
  async recordValidation(
    fips: string,
    proof: TessellationProof,
    districts: FeatureCollection<Polygon | MultiPolygon>,
    agentId: string,
    cityName?: string,
    state?: string
  ): Promise<TessellationProofRecord> {
    // Compute geometry hash for integrity verification
    const geometryHash = computeGeometryHash(districts);

    // Convert proof to full record
    const record = proofToRecord(proof, geometryHash);

    // Convert to compact format for storage
    const entry = recordToCompact(record, fips, agentId, cityName, state);

    // Validate entry structure
    this.validateEntry(entry);

    // Append to compressed log
    await this.appendEntry(entry);

    logger.info('Recorded tessellation validation', {
      fips,
      validated: record.validated,
      failedAxiom: record.failedAxiom,
      coverageRatio: record.diagnostics.coverageRatio.toFixed(4),
    });

    return record;
  }

  /**
   * Query tessellation validation entries
   *
   * @param filter - Query filters
   * @returns Matching compact entries
   */
  async query(filter: TessellationValidationFilter = {}): Promise<CompactTessellationEntry[]> {
    const results: CompactTessellationEntry[] = [];
    const logsToScan = await this.getLogsToScan(filter.startDate, filter.endDate);

    for (const logPath of logsToScan) {
      try {
        const compressed = await fs.readFile(logPath);
        const decompressed = await gunzip(compressed);
        const lines = decompressed.toString('utf-8').split('\n').filter((line) => line.trim());

        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as CompactTessellationEntry;

            if (this.matchesFilter(entry, filter)) {
              results.push(entry);
            }
          } catch {
            // Skip malformed entries
          }
        }
      } catch {
        // Log file doesn't exist or is corrupted
      }
    }

    return results;
  }

  /**
   * Get latest validation result for a city
   *
   * @param fips - City FIPS code
   * @returns Latest validation record or null
   */
  async getLatestValidation(fips: string): Promise<TessellationProofRecord | null> {
    const entries = await this.query({ fips });

    if (entries.length === 0) {
      return null;
    }

    // Sort by validation timestamp (descending) and take latest
    const sorted = [...entries].sort((a, b) => b.vat.localeCompare(a.vat));
    return compactToRecord(sorted[0]);
  }

  /**
   * Check if validation is current (geometry hash matches)
   *
   * @param fips - City FIPS code
   * @param districts - Current district geometry
   * @returns True if latest validation matches current geometry
   */
  async isValidationCurrent(
    fips: string,
    districts: FeatureCollection<Polygon | MultiPolygon>
  ): Promise<boolean> {
    const latest = await this.getLatestValidation(fips);

    if (!latest) {
      return false;
    }

    const currentHash = computeGeometryHash(districts);
    return latest.geometryHash === currentHash;
  }

  /**
   * Get validation statistics
   */
  async getStats(): Promise<{
    totalValidations: number;
    passed: number;
    failed: number;
    byFailedAxiom: Record<string, number>;
    avgCoverageRatio: number;
  }> {
    const entries = await this.query({});

    const stats = {
      totalValidations: entries.length,
      passed: 0,
      failed: 0,
      byFailedAxiom: {} as Record<string, number>,
      avgCoverageRatio: 0,
    };

    let totalCoverage = 0;

    for (const entry of entries) {
      if (entry.v) {
        stats.passed++;
      } else {
        stats.failed++;
        if (entry.fa) {
          const axiom = AXIOM_CODE_MAP[entry.fa];
          stats.byFailedAxiom[axiom] = (stats.byFailedAxiom[axiom] || 0) + 1;
        }
      }
      totalCoverage += entry.dg.cr;
    }

    stats.avgCoverageRatio = entries.length > 0 ? totalCoverage / entries.length : 0;

    return stats;
  }

  // ========== Private Methods ==========

  private validateEntry(entry: CompactTessellationEntry): void {
    if (!entry.f || entry.f.length < 2) {
      throw new Error(`Invalid FIPS code: ${entry.f}`);
    }

    if (typeof entry.v !== 'boolean') {
      throw new Error('Validation status must be boolean');
    }

    if (!entry.vat.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/)) {
      throw new Error(`Invalid ISO timestamp: ${entry.vat}`);
    }

    if (!entry.gh.match(/^[a-f0-9]{64}$/)) {
      throw new Error(`Invalid geometry hash: ${entry.gh}`);
    }

    if (!entry.aid) {
      throw new Error('Agent ID is required');
    }
  }

  private async appendEntry(entry: CompactTessellationEntry): Promise<void> {
    const logPath = this.getShardedLogPath(entry.f);

    // Ensure directory exists
    await fs.mkdir(path.dirname(logPath), { recursive: true });

    const lock = new FileLock(logPath);

    try {
      await lock.acquire();

      // Read existing compressed data
      let existingData = '';
      try {
        const compressed = await fs.readFile(logPath);
        const decompressed = await gunzip(compressed);
        existingData = decompressed.toString('utf-8');
      } catch {
        existingData = '';
      }

      // Append new entry
      const newLine = JSON.stringify(entry) + '\n';
      const updatedData = existingData + newLine;

      // Compress and write
      const compressed = await gzip(Buffer.from(updatedData, 'utf-8'));
      await fs.writeFile(logPath, compressed);
    } finally {
      await lock.release();
    }
  }

  private getShardedLogPath(fips: string): string {
    const shard = fips.substring(0, 2);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const monthDir = path.join(this.baseDir, `${year}-${month}`);
    return path.join(monthDir, `tessellation-log-${shard}.ndjson.gz`);
  }

  private async getLogsToScan(startDate?: string, endDate?: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
      const monthDirs = entries.filter((e) => e.isDirectory() && e.name.match(/^\d{4}-\d{2}$/));

      const logPaths: string[] = [];

      for (const dir of monthDirs) {
        const monthPath = path.join(this.baseDir, dir.name);

        if (startDate && dir.name < startDate.substring(0, 7)) continue;
        if (endDate && dir.name > endDate.substring(0, 7)) continue;

        const shardFiles = await fs.readdir(monthPath);
        const shardLogs = shardFiles
          .filter((f) => f.match(/^tessellation-log-\d{2}\.ndjson\.gz$/))
          .map((f) => path.join(monthPath, f));

        logPaths.push(...shardLogs);
      }

      return logPaths;
    } catch {
      return [];
    }
  }

  private matchesFilter(
    entry: CompactTessellationEntry,
    filter: TessellationValidationFilter
  ): boolean {
    if (filter.fips && entry.f !== filter.fips) return false;
    if (filter.state && entry.s !== filter.state) return false;
    if (filter.validated !== undefined && entry.v !== filter.validated) return false;
    if (filter.failedAxiom) {
      const code = AXIOM_REVERSE_MAP[filter.failedAxiom];
      if (entry.fa !== code) return false;
    }
    if (filter.startDate && entry.vat < filter.startDate) return false;
    if (filter.endDate && entry.vat > filter.endDate) return false;

    return true;
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Validate and record tessellation proof in one operation
 *
 * This is the recommended entry point for production use:
 * 1. Runs tessellation validation
 * 2. Records result to provenance log
 * 3. Returns validation result
 *
 * @param fips - City FIPS code
 * @param districts - Council district features
 * @param municipalBoundary - City boundary polygon
 * @param expectedCount - Expected number of districts
 * @param agentId - Agent performing validation
 * @param options - Optional metadata
 * @returns Validation result with provenance record
 */
export async function validateAndRecord(
  fips: string,
  districts: FeatureCollection<Polygon | MultiPolygon>,
  municipalBoundary: Feature<Polygon | MultiPolygon>,
  expectedCount: number,
  agentId: string,
  options?: {
    cityName?: string;
    state?: string;
    landAreaSqM?: number;
    waterAreaSqM?: number;
    provenanceDir?: string;
  }
): Promise<{
  proof: TessellationProof;
  record: TessellationProofRecord;
  geometryHash: string;
}> {
  // Import validator dynamically to avoid circular deps
  const { TessellationProofValidator } = await import('../validators/council/tessellation-proof.js');

  // Run tessellation validation
  const validator = new TessellationProofValidator();
  const proof = validator.prove(
    districts,
    municipalBoundary,
    expectedCount,
    options?.landAreaSqM,
    undefined, // authoritativeDistrictArea
    options?.waterAreaSqM,
    fips
  );

  // Compute geometry hash
  const geometryHash = computeGeometryHash(districts);

  // Record to provenance log
  const writer = options?.provenanceDir
    ? new TessellationProvenanceWriter(options.provenanceDir)
    : tessellationProvenanceWriter;

  const record = await writer.recordValidation(
    fips,
    proof,
    districts,
    agentId,
    options?.cityName,
    options?.state
  );

  return { proof, record, geometryHash };
}

/**
 * Batch validate and record multiple cities
 *
 * @param cities - Array of city validation inputs
 * @param agentId - Agent performing validation
 * @param options - Optional configuration
 * @returns Array of validation results
 */
export async function batchValidateAndRecord(
  cities: Array<{
    fips: string;
    districts: FeatureCollection<Polygon | MultiPolygon>;
    municipalBoundary: Feature<Polygon | MultiPolygon>;
    expectedCount: number;
    cityName?: string;
    state?: string;
    landAreaSqM?: number;
    waterAreaSqM?: number;
  }>,
  agentId: string,
  options?: {
    provenanceDir?: string;
    continueOnError?: boolean;
  }
): Promise<Array<{
  fips: string;
  success: boolean;
  proof?: TessellationProof;
  record?: TessellationProofRecord;
  error?: string;
}>> {
  const results: Array<{
    fips: string;
    success: boolean;
    proof?: TessellationProof;
    record?: TessellationProofRecord;
    error?: string;
  }> = [];

  for (const city of cities) {
    try {
      const { proof, record } = await validateAndRecord(
        city.fips,
        city.districts,
        city.municipalBoundary,
        city.expectedCount,
        agentId,
        {
          cityName: city.cityName,
          state: city.state,
          landAreaSqM: city.landAreaSqM,
          waterAreaSqM: city.waterAreaSqM,
          provenanceDir: options?.provenanceDir,
        }
      );

      results.push({
        fips: city.fips,
        success: true,
        proof,
        record,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.warn('Failed to validate city', {
        fips: city.fips,
        error: errorMessage,
      });

      results.push({
        fips: city.fips,
        success: false,
        error: errorMessage,
      });

      if (!options?.continueOnError) {
        throw error;
      }
    }
  }

  return results;
}

// =============================================================================
// Singleton Export
// =============================================================================

export const tessellationProvenanceWriter = new TessellationProvenanceWriter();
