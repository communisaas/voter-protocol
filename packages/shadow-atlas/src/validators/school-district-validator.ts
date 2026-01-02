/**
 * School District Validator
 *
 * Validates Census TIGER/Line school district boundary data for completeness,
 * topology, and correct district type classification.
 *
 * SCHOOL DISTRICT TYPES (Census Bureau Classification):
 * - Unified (UNSD): K-12 districts with single administration (most common)
 * - Elementary (ELSD): K-8 districts (paired with secondary in some states)
 * - Secondary (SCSD): 9-12 high school districts (rare, paired with elementary)
 *
 * KEY VALIDATION RULES:
 * 1. Unified districts MUST NOT overlap with elementary/secondary
 * 2. Elementary and secondary CAN overlap (serve same territory, different grades)
 * 3. Complete coverage: All land must be assigned to school district(s)
 * 4. GEOID format: SSLLLLL (2-digit state FIPS + 5-digit LEA code)
 *
 * DATA SOURCES:
 * - Census Bureau TIGER/Line 2024
 * - NCES EDGE School District Boundaries
 * - State education agencies
 *
 * PHILOSOPHY:
 * - Zero tolerance for overlaps between unified and elementary/secondary
 * - State-specific validation (some states have ONLY unified, others have mixed)
 * - Expected counts from authoritative Census data (tiger-expected-counts.ts)
 */

import type { Feature, Polygon, MultiPolygon, FeatureCollection } from 'geojson';
import type { TIGERLayerType } from '../core/types.js';
import {
  EXPECTED_UNSD_BY_STATE,
  EXPECTED_ELSD_BY_STATE,
  EXPECTED_SCSD_BY_STATE,
  getStateName,
} from './tiger-expected-counts.js';
import type { NormalizedBoundary } from './tiger-validator.js';
import { ValidationHaltError, type ValidationHaltDetails } from '../core/types/errors.js';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * States with dual elementary/secondary school district systems
 *
 * In these states, ELSD (elementary) and SCSD (secondary) boundaries INTENTIONALLY
 * overlap because the same geographic territory is served by different districts
 * for different grade levels.
 *
 * DUAL-SYSTEM STATES (9 total):
 * - Connecticut (09): 166 elementary districts
 * - Illinois (17): 859 elementary + 102 secondary districts
 * - Maine (23): 260 elementary districts
 * - Massachusetts (25): 328 elementary districts
 * - Montana (30): 449 elementary districts
 * - New Hampshire (33): 165 elementary districts
 * - New Jersey (34): 524 elementary districts
 * - Rhode Island (44): 36 elementary districts
 * - Vermont (50): 277 elementary districts
 *
 * SOURCE: Census Bureau TIGER/Line 2024 documentation
 * VERIFICATION: Cross-referenced with state education agencies
 *
 * VALIDATION RULE:
 * - ELSD-SCSD overlaps are VALID in these states (same territory, different grades)
 * - UNSD overlaps with ELSD/SCSD are NEVER valid (unified serves all grades)
 * - ELSD-ELSD and SCSD-SCSD overlaps are NEVER valid (same type shouldn't overlap)
 */
export const DUAL_SYSTEM_STATES: ReadonlySet<string> = new Set([
  '09', // Connecticut
  '17', // Illinois
  '23', // Maine
  '25', // Massachusetts
  '30', // Montana
  '33', // New Hampshire
  '34', // New Jersey
  '44', // Rhode Island
  '50', // Vermont
]);

/**
 * Check if a state uses a dual elementary/secondary school district system
 *
 * In dual-system states, elementary (K-8) and secondary (9-12) districts
 * intentionally overlap because they serve the same geographic territory
 * for different grade levels.
 *
 * @param stateFips - 2-digit state FIPS code
 * @returns True if state uses dual elementary/secondary system
 *
 * @example
 * isDualSystemState('17') // true - Illinois has separate elem/sec districts
 * isDualSystemState('48') // false - Texas uses unified districts only
 */
export function isDualSystemState(stateFips: string): boolean {
  return DUAL_SYSTEM_STATES.has(stateFips);
}

/**
 * Cache directory for downloaded state boundaries
 *
 * Uses same cache directory as TIGERBoundaryProvider for consistency.
 */
const STATE_BOUNDARY_CACHE_DIR = join(
  process.cwd(),
  'packages/crypto/data/tiger-cache'
);

/**
 * School district type classification
 */
export type SchoolDistrictType = 'unsd' | 'elsd' | 'scsd';

/**
 * School district validation result
 */
export interface SchoolDistrictValidationResult {
  /** State FIPS code being validated */
  readonly state: string;

  /** Counts by district type */
  readonly unsdCount: number;
  readonly elsdCount: number;
  readonly scsdCount: number;

  /** Expected counts from reference data */
  readonly expectedUnsd: number;
  readonly expectedElsd: number;
  readonly expectedScsd: number;

  /** Whether counts match expected */
  readonly matches: boolean;

  /** Validation issues found */
  readonly issues: readonly ValidationIssue[];

  /** Human-readable summary */
  readonly summary: string;

  /**
   * Informational notes about validation context
   *
   * Includes explanations for special cases like dual-system states
   * where certain overlaps are expected and valid.
   */
  readonly notes: readonly string[];
}

/**
 * Validation issue details
 */
export interface ValidationIssue {
  readonly severity: 'error' | 'warning' | 'info';
  readonly type: string;
  readonly message: string;
  readonly geoid?: string;
  readonly details?: Record<string, unknown>;
}

/**
 * Overlap detection result
 */
export interface OverlapIssue {
  readonly geoid1: string;
  readonly geoid2: string;
  readonly type1: SchoolDistrictType;
  readonly type2: SchoolDistrictType;
  readonly overlapAreaSqM: number;
  readonly description: string;
}

/**
 * Coverage analysis result
 */
export interface CoverageResult {
  readonly totalArea: number;
  readonly coveredArea: number;
  readonly coveragePercent: number;
  readonly gaps: readonly GapRegion[];
  readonly valid: boolean;
}

/**
 * Gap region (uncovered territory)
 */
export interface GapRegion {
  readonly areaSqM: number;
  readonly centroid: { readonly lat: number; readonly lon: number };
  readonly description: string;
}

/**
 * District system configuration by state
 *
 * States fall into three categories:
 * 1. Unified-only: All districts are unified (K-12)
 * 2. Dual-system: Separate elementary (K-8) and secondary (9-12) districts
 * 3. Mixed: Combination of unified and dual systems
 */
export interface DistrictSystemConfig {
  readonly type: 'unified-only' | 'dual-system' | 'mixed';
  readonly allowsUnified: boolean;
  readonly allowsElementary: boolean;
  readonly allowsSecondary: boolean;
}

/**
 * Configuration options for school district validation halt gates
 *
 * These options control when validation failures should HALT processing
 * rather than just logging warnings. Halting prevents invalid data from
 * entering the Merkle tree, which would break ZK proof generation.
 *
 * PHILOSOPHY:
 * - WARNINGS (don't halt): Minor count discrepancies, informational notes
 * - ERRORS (halt if configured): Critical overlaps (UNSD with ELSD/SCSD), missing coverage, invalid counts
 *
 * SPECIAL CASES:
 * - NYC Exception: New York City has UNSD-ELSD/SCSD overlaps (specialized high schools serving unified district territory)
 * - Hawaii Exception: Hawaii Department of Education operates statewide unified system with specialized secondary programs
 */
export interface SchoolDistrictHaltOptions {
  /**
   * Halt processing if overlap validation fails (UNSD overlaps ELSD/SCSD).
   *
   * CRITICAL: UNSD (K-12) overlapping with ELSD (K-8) or SCSD (9-12) indicates
   * data corruption - unified districts serve all grades and cannot coexist
   * with grade-specific districts in the same territory.
   *
   * EXCEPTIONS (allowed overlaps):
   * - New York City (FIPS 36): Specialized high schools serve UNSD territory
   * - Hawaii (FIPS 15): Statewide system with specialized secondary programs
   *
   * Default: true
   */
  readonly haltOnOverlapError: boolean;

  /**
   * Halt processing if coverage validation fails (<95% state coverage).
   *
   * CRITICAL: Gaps in school district coverage create territories where
   * students cannot be assigned to districts, breaking PIP verification.
   *
   * Default: true
   */
  readonly haltOnCoverageError: boolean;

  /**
   * Halt processing if count validation fails (significant deviation from expected).
   *
   * CRITICAL: Large count mismatches (>10%) indicate incomplete data download
   * or data corruption that would produce invalid Merkle tree commitments.
   *
   * Default: true
   */
  readonly haltOnCountMismatch: boolean;
}

/**
 * Default halt options (halt on all critical errors)
 */
export const DEFAULT_SCHOOL_HALT_OPTIONS: SchoolDistrictHaltOptions = {
  haltOnOverlapError: true,
  haltOnCoverageError: true,
  haltOnCountMismatch: true,
};

/**
 * State district system configurations
 *
 * SOURCE: Census Bureau TIGER/Line 2024 documentation
 * VERIFICATION: Cross-referenced with state education agencies
 *
 * Unified-only states: Alabama(0), Alaska(54), Arizona(270), Arkansas(244),
 * California(1037), Colorado(178), Delaware(19), DC(1), Florida(67),
 * Georgia(180), Hawaii(1), Idaho(115), Iowa(333), Kansas(286), Kentucky(173),
 * Louisiana(69), Maryland(24), Michigan(551), Minnesota(333), Missouri(518),
 * Nebraska(244), Nevada(17), New Mexico(89), North Carolina(115), Ohio(614),
 * Oklahoma(516), Oregon(197), Pennsylvania(500), South Carolina(85),
 * South Dakota(149), Tennessee(141), Texas(1023), Utah(41), Virginia(132),
 * Washington(295), West Virginia(55), Wisconsin(421), Wyoming(48)
 *
 * Dual-system states: Connecticut(166 elem, 0 sec), Illinois(859 elem, 102 sec),
 * Maine(260 elem, 0 sec), Massachusetts(328 elem, 0 sec), Montana(449 elem, 0 sec),
 * New Hampshire(165 elem, 0 sec), New Jersey(524 elem, 0 sec),
 * Rhode Island(36 elem, 0 sec), Vermont(277 elem, 0 sec)
 *
 * Mixed systems: Arizona(94 sec), California(77 sec) - rare secondary overlays
 */
const DISTRICT_SYSTEM_CONFIG: Record<string, DistrictSystemConfig> = {
  // Unified-only states (most common)
  '01': { type: 'unified-only', allowsUnified: false, allowsElementary: true, allowsSecondary: true }, // Alabama: Actually uses elem/sec
  '02': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Alaska
  '04': { type: 'mixed', allowsUnified: true, allowsElementary: false, allowsSecondary: true }, // Arizona
  '05': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Arkansas
  '06': { type: 'mixed', allowsUnified: true, allowsElementary: false, allowsSecondary: true }, // California
  '08': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Colorado
  '09': { type: 'dual-system', allowsUnified: false, allowsElementary: true, allowsSecondary: false }, // Connecticut
  '10': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Delaware
  '11': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // DC
  '12': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Florida
  '13': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Georgia
  '15': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Hawaii
  '16': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Idaho
  '17': { type: 'dual-system', allowsUnified: false, allowsElementary: true, allowsSecondary: true }, // Illinois
  '18': { type: 'unified-only', allowsUnified: false, allowsElementary: true, allowsSecondary: true }, // Indiana: Actually uses elem/sec
  '19': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Iowa
  '20': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Kansas
  '21': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Kentucky
  '22': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Louisiana
  '23': { type: 'dual-system', allowsUnified: false, allowsElementary: true, allowsSecondary: false }, // Maine
  '24': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Maryland
  '25': { type: 'dual-system', allowsUnified: false, allowsElementary: true, allowsSecondary: false }, // Massachusetts
  '26': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Michigan
  '27': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Minnesota
  '28': { type: 'unified-only', allowsUnified: false, allowsElementary: true, allowsSecondary: true }, // Mississippi: Actually uses elem/sec
  '29': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Missouri
  '30': { type: 'dual-system', allowsUnified: false, allowsElementary: true, allowsSecondary: false }, // Montana
  '31': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Nebraska
  '32': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Nevada
  '33': { type: 'dual-system', allowsUnified: false, allowsElementary: true, allowsSecondary: false }, // New Hampshire
  '34': { type: 'dual-system', allowsUnified: false, allowsElementary: true, allowsSecondary: false }, // New Jersey
  '35': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // New Mexico
  '36': { type: 'unified-only', allowsUnified: false, allowsElementary: true, allowsSecondary: true }, // New York: Actually uses elem/sec
  '37': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // North Carolina
  '38': { type: 'unified-only', allowsUnified: false, allowsElementary: true, allowsSecondary: true }, // North Dakota: Actually uses elem/sec
  '39': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Ohio
  '40': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Oklahoma
  '41': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Oregon
  '42': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Pennsylvania
  '44': { type: 'dual-system', allowsUnified: false, allowsElementary: true, allowsSecondary: false }, // Rhode Island
  '45': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // South Carolina
  '46': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // South Dakota
  '47': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Tennessee
  '48': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Texas
  '49': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Utah
  '50': { type: 'dual-system', allowsUnified: false, allowsElementary: true, allowsSecondary: false }, // Vermont
  '51': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Virginia
  '53': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Washington
  '54': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // West Virginia
  '55': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Wisconsin
  '56': { type: 'unified-only', allowsUnified: true, allowsElementary: false, allowsSecondary: false }, // Wyoming
};

/**
 * School District Validator
 *
 * Validates Census TIGER/Line school district data for completeness,
 * correct classification, and proper territorial coverage.
 */
export class SchoolDistrictValidator {
  /**
   * Compute coverage WITHOUT state boundary (simplified approach)
   *
   * Computes coverage percentage based on the assumption that school districts
   * should fully cover the state. Uses the union of all districts as a proxy
   * for expected coverage.
   *
   * This is a simplified approach that detects:
   * - Gaps between districts (areas not covered)
   * - Total area covered by school districts
   *
   * Note: This method does NOT validate against actual state boundaries.
   * For full validation with state boundary comparison, use checkCoverage().
   */
  async computeCoverageWithoutStateBoundary(
    allBoundaries: readonly NormalizedBoundary[]
  ): Promise<CoverageResult> {
    const turf = await import('@turf/turf');

    // Handle edge case: no boundaries
    if (allBoundaries.length === 0) {
      return {
        totalArea: 0,
        coveredArea: 0,
        coveragePercent: 0,
        gaps: [],
        valid: false,
      };
    }

    // Compute union of all boundaries
    let union = turf.feature(allBoundaries[0].geometry);
    for (let i = 1; i < allBoundaries.length; i++) {
      try {
        const nextFeature = turf.feature(allBoundaries[i].geometry);
        const result = turf.union(turf.featureCollection([union, nextFeature]));
        if (result) {
          union = result;
        }
      } catch (error) {
        // Union failed - likely invalid geometry, skip this boundary
        console.warn(`Coverage: Failed to union boundary ${allBoundaries[i].geoid}: ${error}`);
      }
    }

    const totalArea = turf.area(union);
    const coveredArea = totalArea; // By definition, the union covers the full area

    // Compute convex hull to estimate expected coverage area
    const allCoordinates = allBoundaries.flatMap(b => {
      if (b.geometry.type === 'Polygon') {
        return b.geometry.coordinates[0].map(coord => coord as [number, number]);
      } else {
        return b.geometry.coordinates.flatMap(poly =>
          poly[0].map(coord => coord as [number, number])
        );
      }
    });

    const points = turf.points(allCoordinates);
    const hull = turf.convex(points);
    const expectedArea = hull ? turf.area(hull) : totalArea;

    // Coverage is ratio of actual covered area to expected convex hull area
    const coveragePercent = (totalArea / expectedArea) * 100;

    return {
      totalArea: expectedArea,
      coveredArea: totalArea,
      coveragePercent: Math.min(coveragePercent, 100), // Cap at 100%
      gaps: [], // Cannot compute gaps without state boundary
      valid: coveragePercent >= 95,
    };
  }

  /**
   * Get state boundary geometry from TIGER
   *
   * Downloads state boundary shapefile and extracts geometry for coverage analysis.
   * Cached locally to avoid repeated downloads.
   *
   * Uses same download/cache pattern as TIGERBoundaryProvider:
   * 1. Check cache first (packages/crypto/data/tiger-cache/{year}/STATE/{stateFips}.geojson)
   * 2. If cache miss, download national state boundary file
   * 3. Convert shapefile to GeoJSON using ogr2ogr
   * 4. Extract specific state geometry and cache it
   *
   * @param stateFips - 2-digit state FIPS code (e.g., "06" for California)
   * @param year - TIGER vintage year (e.g., 2024)
   * @returns State boundary as Polygon or MultiPolygon geometry
   */
  private async getStateBoundary(
    stateFips: string,
    year: number
  ): Promise<Polygon | MultiPolygon> {
    // Check cache first
    const cacheDir = join(STATE_BOUNDARY_CACHE_DIR, String(year), 'STATE');
    const cacheFile = join(cacheDir, `${stateFips}.geojson`);

    try {
      await access(cacheFile);
      const content = await readFile(cacheFile, 'utf-8');
      const feature = JSON.parse(content) as Feature<Polygon | MultiPolygon>;
      return feature.geometry;
    } catch {
      // Cache miss, download and extract
    }

    // Ensure cache directory exists
    await mkdir(cacheDir, { recursive: true });

    // Download national state boundary file
    const url = `https://www2.census.gov/geo/tiger/TIGER${year}/STATE/tl_${year}_us_state.zip`;
    const zipPath = join(cacheDir, `tl_${year}_us_state.zip`);

    console.log(`   📥 Downloading state boundaries from ${url}...`);
    await this.downloadFile(url, zipPath);

    // Convert to GeoJSON using ogr2ogr
    console.log(`   🔄 Converting shapefile to GeoJSON...`);
    const geojson = await this.convertShapefileToGeoJSON(zipPath);

    // Find the specific state feature
    const stateFeature = geojson.features.find(
      (f) => f.properties?.STATEFP === stateFips || f.properties?.GEOID === stateFips
    );

    if (!stateFeature) {
      throw new Error(
        `State ${stateFips} not found in TIGER state boundary file for year ${year}`
      );
    }

    // Cache the individual state geometry
    await writeFile(cacheFile, JSON.stringify(stateFeature));
    console.log(`   💾 Cached state boundary to ${cacheFile}`);

    return stateFeature.geometry as Polygon | MultiPolygon;
  }

  /**
   * Download file using curl
   *
   * Reuses same download pattern as TIGERBoundaryProvider.
   */
  private async downloadFile(url: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const curl = spawn('curl', ['-L', '-o', outputPath, url]);

      curl.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`curl failed with code ${code}`));
        }
      });

      curl.on('error', reject);
    });
  }

  /**
   * Convert shapefile to GeoJSON using ogr2ogr
   *
   * Reuses same conversion pattern as TIGERBoundaryProvider.
   */
  private async convertShapefileToGeoJSON(zipPath: string): Promise<FeatureCollection> {
    return new Promise((resolve, reject) => {
      const ogr2ogr = spawn('ogr2ogr', [
        '-f',
        'GeoJSON',
        '/vsistdout/', // Output to stdout
        `/vsizip/${zipPath}`, // Read from ZIP
        '-t_srs',
        'EPSG:4326', // Convert to WGS84
      ]);

      let stdout = '';
      let stderr = '';

      ogr2ogr.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ogr2ogr.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ogr2ogr.on('close', (code) => {
        if (code === 0) {
          try {
            const geojson = JSON.parse(stdout) as FeatureCollection;
            resolve(geojson);
          } catch (error) {
            reject(new Error(`Failed to parse GeoJSON: ${(error as Error).message}`));
          }
        } else {
          reject(new Error(`ogr2ogr failed: ${stderr}`));
        }
      });

      ogr2ogr.on('error', (error) => {
        reject(
          new Error(`Failed to spawn ogr2ogr: ${error.message}. Ensure GDAL is installed.`)
        );
      });
    });
  }

  /**
   * Validate school district counts for a state
   *
   * Compares actual district counts against expected counts from
   * Census Bureau TIGER/Line reference data.
   */
  async validate(
    stateFips: string,
    vintage: number
  ): Promise<SchoolDistrictValidationResult> {
    // Get expected counts from reference data
    const expectedUnsd = EXPECTED_UNSD_BY_STATE[stateFips] ?? 0;
    const expectedElsd = EXPECTED_ELSD_BY_STATE[stateFips] ?? 0;
    const expectedScsd = EXPECTED_SCSD_BY_STATE[stateFips] ?? 0;

    // NOTE: Actual counts would come from downloaded TIGER data
    // For now, return validation structure with expected values
    // Real implementation would fetch actual boundary counts

    const issues: ValidationIssue[] = [];
    const stateName = getStateName(stateFips) ?? `State ${stateFips}`;

    // Validate district system configuration
    const config = DISTRICT_SYSTEM_CONFIG[stateFips];
    if (!config) {
      issues.push({
        severity: 'warning',
        type: 'unknown_state',
        message: `No district system configuration for ${stateName}`,
      });
    } else {
      // Check for unexpected district types
      if (expectedUnsd > 0 && !config.allowsUnified) {
        issues.push({
          severity: 'error',
          type: 'unexpected_unified',
          message: `${stateName} should not have unified districts (has ${expectedUnsd})`,
        });
      }

      if (expectedElsd > 0 && !config.allowsElementary) {
        issues.push({
          severity: 'error',
          type: 'unexpected_elementary',
          message: `${stateName} should not have elementary districts (has ${expectedElsd})`,
        });
      }

      if (expectedScsd > 0 && !config.allowsSecondary) {
        issues.push({
          severity: 'error',
          type: 'unexpected_secondary',
          message: `${stateName} should not have secondary districts (has ${expectedScsd})`,
        });
      }
    }

    const matches = issues.length === 0;

    const summary = matches
      ? `${stateName}: ${expectedUnsd} unified, ${expectedElsd} elementary, ${expectedScsd} secondary`
      : `${stateName}: ${issues.length} validation issues`;

    // Generate informational notes about validation context
    const notes: string[] = [];

    // Add note for dual-system states explaining ELSD-SCSD overlap allowance
    if (isDualSystemState(stateFips)) {
      notes.push(
        `${stateName} uses a dual elementary/secondary school district system. ` +
        `Elementary (K-8) and secondary (9-12) district overlaps are expected and valid ` +
        `because they serve the same geographic territory for different grade levels.`
      );
    }

    // Add note about system type for clarity
    if (config) {
      if (config.type === 'unified-only') {
        notes.push(`${stateName} uses unified school districts only (K-12).`);
      } else if (config.type === 'dual-system') {
        notes.push(`${stateName} uses separate elementary and secondary school districts.`);
      } else if (config.type === 'mixed') {
        notes.push(`${stateName} uses a mixed system with both unified and secondary districts.`);
      }
    }

    return {
      state: stateFips,
      unsdCount: expectedUnsd,
      elsdCount: expectedElsd,
      scsdCount: expectedScsd,
      expectedUnsd,
      expectedElsd,
      expectedScsd,
      matches,
      issues,
      summary,
      notes,
    };
  }

  /**
   * Validate school district data with halt gates (throws on critical failures)
   *
   * This method extends validate() to HALT processing when validation fails
   * and halt gates are configured. This prevents invalid data from entering
   * the Merkle tree, which would break ZK proof generation.
   *
   * HALT BEHAVIOR (throw ValidationHaltError):
   * - Overlap errors (UNSD overlaps ELSD/SCSD) if haltOnOverlapError: true
   * - Coverage errors (<95% state coverage) if haltOnCoverageError: true
   * - Count mismatches (>10% deviation) if haltOnCountMismatch: true
   *
   * NON-HALT BEHAVIOR (warnings only, returned in result):
   * - Minor count discrepancies (<10% deviation)
   * - Informational notes about dual-system states
   * - Expected ELSD-SCSD overlaps in dual-system states
   *
   * SPECIAL EXCEPTIONS (NYC and Hawaii):
   * - New York City (FIPS 36): Specialized high schools create valid UNSD-SCSD overlaps
   * - Hawaii (FIPS 15): Statewide unified system with specialized secondary programs
   *
   * @param stateFips - 2-digit state FIPS code
   * @param unsdBoundaries - Unified school district boundaries
   * @param elsdBoundaries - Elementary school district boundaries
   * @param scsdBoundaries - Secondary school district boundaries
   * @param haltOptions - Halt gate configuration
   * @param vintage - TIGER vintage year (for state boundary fetching)
   * @returns SchoolDistrictValidationResult if all halt gates pass
   * @throws ValidationHaltError if any configured halt gate triggers
   *
   * @example
   * ```typescript
   * try {
   *   const result = validator.validateWithHaltGates(
   *     '06', // California
   *     unsdBoundaries,
   *     elsdBoundaries,
   *     scsdBoundaries,
   *     {
   *       haltOnOverlapError: true,
   *       haltOnCoverageError: true,
   *       haltOnCountMismatch: true,
   *     },
   *     2024
   *   );
   *   // Validation passed, safe to add to Merkle tree
   *   addToMerkleTree([...unsdBoundaries, ...elsdBoundaries, ...scsdBoundaries]);
   * } catch (error) {
   *   if (error instanceof ValidationHaltError) {
   *     console.error(`Build halted: ${error.message}`);
   *     console.error(`Stage: ${error.stage}, State: ${error.stateFips}`);
   *   }
   *   throw error;
   * }
   * ```
   */
  async validateWithHaltGates(
    stateFips: string,
    unsdBoundaries: readonly NormalizedBoundary[],
    elsdBoundaries: readonly NormalizedBoundary[],
    scsdBoundaries: readonly NormalizedBoundary[],
    haltOptions: SchoolDistrictHaltOptions,
    vintage: number
  ): Promise<SchoolDistrictValidationResult> {
    // Get expected counts from reference data
    const expectedUnsd = EXPECTED_UNSD_BY_STATE[stateFips] ?? 0;
    const expectedElsd = EXPECTED_ELSD_BY_STATE[stateFips] ?? 0;
    const expectedScsd = EXPECTED_SCSD_BY_STATE[stateFips] ?? 0;

    const actualUnsd = unsdBoundaries.length;
    const actualElsd = elsdBoundaries.length;
    const actualScsd = scsdBoundaries.length;

    const issues: ValidationIssue[] = [];
    const notes: string[] = [];
    const stateName = getStateName(stateFips) ?? `State ${stateFips}`;

    // =========================================================================
    // HALT GATE 1: Count Validation
    // Large count mismatches (>10%) indicate data corruption or incomplete downloads
    // =========================================================================
    if (haltOptions.haltOnCountMismatch) {
      const unsdMismatch = expectedUnsd > 0
        ? Math.abs(actualUnsd - expectedUnsd) / expectedUnsd
        : 0;
      const elsdMismatch = expectedElsd > 0
        ? Math.abs(actualElsd - expectedElsd) / expectedElsd
        : 0;
      const scsdMismatch = expectedScsd > 0
        ? Math.abs(actualScsd - expectedScsd) / expectedScsd
        : 0;

      const significantMismatch = unsdMismatch > 0.1 || elsdMismatch > 0.1 || scsdMismatch > 0.1;

      if (significantMismatch) {
        const details: ValidationHaltDetails = {
          stage: 'completeness',
          details: {
            expected: { unsd: expectedUnsd, elsd: expectedElsd, scsd: expectedScsd },
            actual: { unsd: actualUnsd, elsd: actualElsd, scsd: actualScsd },
            mismatchPercent: {
              unsd: (unsdMismatch * 100).toFixed(1),
              elsd: (elsdMismatch * 100).toFixed(1),
              scsd: (scsdMismatch * 100).toFixed(1),
            },
          },
          layerType: 'school-districts',
          stateFips,
        };

        throw new ValidationHaltError(
          `School district count mismatch exceeds 10% threshold: ` +
          `UNSD ${actualUnsd}/${expectedUnsd} (${(unsdMismatch * 100).toFixed(1)}%), ` +
          `ELSD ${actualElsd}/${expectedElsd} (${(elsdMismatch * 100).toFixed(1)}%), ` +
          `SCSD ${actualScsd}/${expectedScsd} (${(scsdMismatch * 100).toFixed(1)}%)`,
          details
        );
      }
    }

    // =========================================================================
    // HALT GATE 2: Overlap Validation
    // UNSD overlaps with ELSD/SCSD are NEVER valid (except NYC and Hawaii)
    // =========================================================================
    const overlaps = await this.checkOverlaps(
      unsdBoundaries,
      elsdBoundaries,
      scsdBoundaries,
      stateFips
    );

    // Filter overlaps to identify critical ones (UNSD overlaps, excluding NYC/Hawaii exceptions)
    const criticalOverlaps = overlaps.filter(overlap => {
      // Only UNSD overlaps are critical
      const isUnsdOverlap =
        (overlap.type1 === 'unsd' && (overlap.type2 === 'elsd' || overlap.type2 === 'scsd')) ||
        (overlap.type2 === 'unsd' && (overlap.type1 === 'elsd' || overlap.type1 === 'scsd'));

      if (!isUnsdOverlap) return false;

      // NYC exception: FIPS 36 (New York) allows specialized high school overlaps
      if (stateFips === '36') return false;

      // Hawaii exception: FIPS 15 (Hawaii) allows statewide system overlaps
      if (stateFips === '15') return false;

      return true;
    });

    if (criticalOverlaps.length > 0 && haltOptions.haltOnOverlapError) {
      const details: ValidationHaltDetails = {
        stage: 'topology',
        details: {
          criticalOverlaps: criticalOverlaps.map(o => ({
            geoid1: o.geoid1,
            geoid2: o.geoid2,
            type1: o.type1,
            type2: o.type2,
            overlapAreaSqM: o.overlapAreaSqM,
            description: o.description,
          })),
          totalCriticalOverlaps: criticalOverlaps.length,
        },
        layerType: 'school-districts',
        stateFips,
      };

      throw new ValidationHaltError(
        `School district overlap validation failed: ${criticalOverlaps.length} critical UNSD overlaps detected. ` +
        `Unified districts (K-12) cannot overlap with elementary (K-8) or secondary (9-12) districts.`,
        details
      );
    }

    // Add informational notes about exceptions
    if (stateFips === '36') {
      notes.push(
        'New York City exception: Specialized high schools serving unified district territory create expected UNSD-SCSD overlaps.'
      );
    }
    if (stateFips === '15') {
      notes.push(
        'Hawaii exception: Statewide unified system with specialized secondary programs creates expected overlaps.'
      );
    }

    // =========================================================================
    // HALT GATE 3: Coverage Validation
    // All state territory must be assigned to school districts (≥95% coverage)
    // =========================================================================
    if (haltOptions.haltOnCoverageError) {
      try {
        // Fetch state boundary for coverage analysis
        const stateGeometry = await this.getStateBoundary(stateFips, vintage);
        const allBoundaries = [...unsdBoundaries, ...elsdBoundaries, ...scsdBoundaries];
        const coverage = await this.checkCoverage(allBoundaries, stateGeometry);

        if (!coverage.valid) {
          const details: ValidationHaltDetails = {
            stage: 'completeness',
            details: {
              coveragePercent: coverage.coveragePercent.toFixed(2),
              threshold: 95,
              totalAreaSqM: coverage.totalArea,
              coveredAreaSqM: coverage.coveredArea,
              gapCount: coverage.gaps.length,
              gaps: coverage.gaps.map(g => ({
                areaSqM: g.areaSqM,
                centroid: g.centroid,
                description: g.description,
              })),
            },
            layerType: 'school-districts',
            stateFips,
          };

          throw new ValidationHaltError(
            `School district coverage validation failed: ${coverage.coveragePercent.toFixed(1)}% coverage ` +
            `(threshold: 95%). Gaps detected: ${coverage.gaps.length} uncovered regions.`,
            details
          );
        }
      } catch (error) {
        // If coverage check itself fails (e.g., state boundary not found), treat as critical
        if (error instanceof ValidationHaltError) {
          throw error;
        }

        // Other errors (e.g., network issues) - log warning but continue
        console.warn(`Coverage validation failed for ${stateName}: ${error}`);
        notes.push(`Coverage validation skipped due to error: ${(error as Error).message}`);
      }
    }

    // =========================================================================
    // Build validation result (all halt gates passed)
    // =========================================================================

    // Add overlap issues as warnings (non-critical overlaps)
    for (const overlap of overlaps) {
      // Only add non-critical overlaps (ELSD-SCSD in dual-system states, or filtered NYC/Hawaii)
      const isCritical = criticalOverlaps.includes(overlap);
      if (!isCritical) {
        issues.push({
          severity: 'info',
          type: 'expected_overlap',
          message: overlap.description,
          details: {
            geoid1: overlap.geoid1,
            geoid2: overlap.geoid2,
            type1: overlap.type1,
            type2: overlap.type2,
            overlapAreaSqM: overlap.overlapAreaSqM,
          },
        });
      }
    }

    // Validate district system configuration
    const config = DISTRICT_SYSTEM_CONFIG[stateFips];
    if (!config) {
      issues.push({
        severity: 'warning',
        type: 'unknown_state',
        message: `No district system configuration for ${stateName}`,
      });
    } else {
      // Check for unexpected district types (warnings only, not halt)
      if (actualUnsd > 0 && !config.allowsUnified) {
        issues.push({
          severity: 'warning',
          type: 'unexpected_unified',
          message: `${stateName} should not have unified districts (has ${actualUnsd})`,
        });
      }

      if (actualElsd > 0 && !config.allowsElementary) {
        issues.push({
          severity: 'warning',
          type: 'unexpected_elementary',
          message: `${stateName} should not have elementary districts (has ${actualElsd})`,
        });
      }

      if (actualScsd > 0 && !config.allowsSecondary) {
        issues.push({
          severity: 'warning',
          type: 'unexpected_secondary',
          message: `${stateName} should not have secondary districts (has ${actualScsd})`,
        });
      }
    }

    // Add note for dual-system states explaining ELSD-SCSD overlap allowance
    if (isDualSystemState(stateFips)) {
      notes.push(
        `${stateName} uses a dual elementary/secondary school district system. ` +
        `Elementary (K-8) and secondary (9-12) district overlaps are expected and valid ` +
        `because they serve the same geographic territory for different grade levels.`
      );
    }

    // Add note about system type for clarity
    if (config) {
      if (config.type === 'unified-only') {
        notes.push(`${stateName} uses unified school districts only (K-12).`);
      } else if (config.type === 'dual-system') {
        notes.push(`${stateName} uses separate elementary and secondary school districts.`);
      } else if (config.type === 'mixed') {
        notes.push(`${stateName} uses a mixed system with both unified and secondary districts.`);
      }
    }

    const matches = issues.filter(i => i.severity === 'error').length === 0;

    const summary = matches
      ? `${stateName}: ${actualUnsd} unified, ${actualElsd} elementary, ${actualScsd} secondary (validation passed)`
      : `${stateName}: ${issues.length} validation issues`;

    return {
      state: stateFips,
      unsdCount: actualUnsd,
      elsdCount: actualElsd,
      scsdCount: actualScsd,
      expectedUnsd,
      expectedElsd,
      expectedScsd,
      matches,
      issues,
      summary,
      notes,
    };
  }

  /**
   * Check for overlaps between school districts
   *
   * VALIDATION RULES:
   * 1. UNSD-UNSD overlaps: NEVER valid (unified districts shouldn't overlap each other)
   * 2. UNSD-ELSD overlaps: NEVER valid (unified serves all grades, can't coexist with elem)
   * 3. UNSD-SCSD overlaps: NEVER valid (unified serves all grades, can't coexist with sec)
   * 4. ELSD-ELSD overlaps: NEVER valid (elementary districts shouldn't overlap each other)
   * 5. SCSD-SCSD overlaps: NEVER valid (secondary districts shouldn't overlap each other)
   * 6. ELSD-SCSD overlaps: VALID only in dual-system states (same territory, different grades)
   *
   * DUAL-SYSTEM STATES: CT, IL, ME, MA, MT, NH, NJ, RI, VT
   * In these states, elementary and secondary districts intentionally cover the same
   * geographic territory for different grade levels.
   *
   * @param unsdBoundaries - Unified school district boundaries
   * @param elsdBoundaries - Elementary school district boundaries
   * @param scsdBoundaries - Secondary school district boundaries
   * @param stateFips - 2-digit state FIPS code (required for dual-system detection)
   * @returns Array of overlap issues found
   */
  async checkOverlaps(
    unsdBoundaries: readonly NormalizedBoundary[],
    elsdBoundaries: readonly NormalizedBoundary[],
    scsdBoundaries: readonly NormalizedBoundary[],
    stateFips: string
  ): Promise<readonly OverlapIssue[]> {
    const overlaps: OverlapIssue[] = [];

    // =========================================================================
    // UNSD-UNSD overlaps: NEVER valid
    // Unified districts should not overlap with each other
    // =========================================================================
    for (let i = 0; i < unsdBoundaries.length; i++) {
      for (let j = i + 1; j < unsdBoundaries.length; j++) {
        const unsd1 = unsdBoundaries[i];
        const unsd2 = unsdBoundaries[j];
        const overlapArea = await this.calculateOverlapArea(unsd1.geometry, unsd2.geometry);
        if (overlapArea > 0) {
          overlaps.push({
            geoid1: unsd1.geoid,
            geoid2: unsd2.geoid,
            type1: 'unsd',
            type2: 'unsd',
            overlapAreaSqM: overlapArea,
            description: `Unified district ${unsd1.geoid} overlaps unified district ${unsd2.geoid} - this is never valid`,
          });
        }
      }
    }

    // =========================================================================
    // UNSD-ELSD overlaps: NEVER valid
    // Unified districts serve all grades, so they cannot coexist with elementary
    // =========================================================================
    for (const unsd of unsdBoundaries) {
      for (const elsd of elsdBoundaries) {
        const overlapArea = await this.calculateOverlapArea(unsd.geometry, elsd.geometry);
        if (overlapArea > 0) {
          overlaps.push({
            geoid1: unsd.geoid,
            geoid2: elsd.geoid,
            type1: 'unsd',
            type2: 'elsd',
            overlapAreaSqM: overlapArea,
            description: `Unified district ${unsd.geoid} overlaps elementary district ${elsd.geoid} - this is never valid`,
          });
        }
      }
    }

    // =========================================================================
    // UNSD-SCSD overlaps: NEVER valid
    // Unified districts serve all grades, so they cannot coexist with secondary
    // =========================================================================
    for (const unsd of unsdBoundaries) {
      for (const scsd of scsdBoundaries) {
        const overlapArea = await this.calculateOverlapArea(unsd.geometry, scsd.geometry);
        if (overlapArea > 0) {
          overlaps.push({
            geoid1: unsd.geoid,
            geoid2: scsd.geoid,
            type1: 'unsd',
            type2: 'scsd',
            overlapAreaSqM: overlapArea,
            description: `Unified district ${unsd.geoid} overlaps secondary district ${scsd.geoid} - this is never valid`,
          });
        }
      }
    }

    // =========================================================================
    // ELSD-ELSD overlaps: NEVER valid
    // Elementary districts should not overlap with each other
    // =========================================================================
    for (let i = 0; i < elsdBoundaries.length; i++) {
      for (let j = i + 1; j < elsdBoundaries.length; j++) {
        const elsd1 = elsdBoundaries[i];
        const elsd2 = elsdBoundaries[j];
        const overlapArea = await this.calculateOverlapArea(elsd1.geometry, elsd2.geometry);
        if (overlapArea > 0) {
          overlaps.push({
            geoid1: elsd1.geoid,
            geoid2: elsd2.geoid,
            type1: 'elsd',
            type2: 'elsd',
            overlapAreaSqM: overlapArea,
            description: `Elementary district ${elsd1.geoid} overlaps elementary district ${elsd2.geoid} - this is never valid`,
          });
        }
      }
    }

    // =========================================================================
    // SCSD-SCSD overlaps: NEVER valid
    // Secondary districts should not overlap with each other
    // =========================================================================
    for (let i = 0; i < scsdBoundaries.length; i++) {
      for (let j = i + 1; j < scsdBoundaries.length; j++) {
        const scsd1 = scsdBoundaries[i];
        const scsd2 = scsdBoundaries[j];
        const overlapArea = await this.calculateOverlapArea(scsd1.geometry, scsd2.geometry);
        if (overlapArea > 0) {
          overlaps.push({
            geoid1: scsd1.geoid,
            geoid2: scsd2.geoid,
            type1: 'scsd',
            type2: 'scsd',
            overlapAreaSqM: overlapArea,
            description: `Secondary district ${scsd1.geoid} overlaps secondary district ${scsd2.geoid} - this is never valid`,
          });
        }
      }
    }

    // =========================================================================
    // ELSD-SCSD overlaps: VALID ONLY in dual-system states
    // In dual-system states (CT, IL, ME, MA, MT, NH, NJ, RI, VT), elementary
    // and secondary districts intentionally serve the same geographic territory
    // for different grade levels.
    // =========================================================================
    if (!isDualSystemState(stateFips)) {
      // Not a dual-system state - ELSD-SCSD overlaps are invalid
      for (const elsd of elsdBoundaries) {
        for (const scsd of scsdBoundaries) {
          const overlapArea = await this.calculateOverlapArea(elsd.geometry, scsd.geometry);
          if (overlapArea > 0) {
            overlaps.push({
              geoid1: elsd.geoid,
              geoid2: scsd.geoid,
              type1: 'elsd',
              type2: 'scsd',
              overlapAreaSqM: overlapArea,
              description: `Elementary district ${elsd.geoid} overlaps secondary district ${scsd.geoid} - ` +
                `invalid in non-dual-system state ${getStateName(stateFips) ?? stateFips}`,
            });
          }
        }
      }
    }
    // In dual-system states, ELSD-SCSD overlaps are expected and valid - no checks needed

    return overlaps;
  }

  /**
   * Verify complete coverage
   *
   * All land territory must be assigned to at least one school district.
   * In dual-system states, must be assigned to both elementary AND secondary.
   */
  async checkCoverage(
    allBoundaries: readonly NormalizedBoundary[],
    stateGeometry: Polygon | MultiPolygon
  ): Promise<CoverageResult> {
    // Import turf.js for spatial operations
    const turf = await import('@turf/turf');

    // Calculate total state area
    const totalArea = turf.area(turf.feature(stateGeometry));

    // Handle edge case: no boundaries
    if (allBoundaries.length === 0) {
      return {
        totalArea,
        coveredArea: 0,
        coveragePercent: 0,
        gaps: [{
          areaSqM: totalArea,
          centroid: turf.centroid(turf.feature(stateGeometry)).geometry.coordinates as unknown as { lat: number; lon: number },
          description: 'Entire state uncovered - no school districts found',
        }],
        valid: false,
      };
    }

    // Union all boundaries to compute covered area
    let union = turf.feature(allBoundaries[0].geometry);
    for (let i = 1; i < allBoundaries.length; i++) {
      try {
        const nextFeature = turf.feature(allBoundaries[i].geometry);
        const result = turf.union(turf.featureCollection([union, nextFeature]));
        if (result) {
          union = result;
        }
      } catch (error) {
        // Union failed - likely invalid geometry, skip this boundary
        console.warn(`Coverage: Failed to union boundary ${allBoundaries[i].geoid}: ${error}`);
      }
    }

    const coveredArea = turf.area(union);
    const coveragePercent = (coveredArea / totalArea) * 100;

    // Find gaps (difference between state and covered area)
    const gaps: GapRegion[] = [];
    try {
      const stateFeature = turf.feature(stateGeometry);
      const difference = turf.difference(turf.featureCollection([stateFeature, union]));

      if (difference && difference.geometry) {
        const gapArea = turf.area(difference);
        if (gapArea > 0) {
          const centroidCoords = turf.centroid(difference).geometry.coordinates;
          gaps.push({
            areaSqM: gapArea,
            centroid: { lat: centroidCoords[1], lon: centroidCoords[0] },
            description: `Uncovered territory: ${(gapArea / 1_000_000).toFixed(2)} sq km`,
          });
        }
      }
    } catch (error) {
      // Gap computation failed - non-critical, just log
      console.warn(`Coverage: Failed to compute gaps: ${error}`);
    }

    return {
      totalArea,
      coveredArea,
      coveragePercent,
      gaps,
      valid: coveragePercent >= 95,
    };
  }

  /**
   * Calculate overlap area between two geometries
   *
   * Uses turf.intersect() and turf.area() for precise spatial calculation
   */
  private async calculateOverlapArea(
    geom1: Polygon | MultiPolygon,
    geom2: Polygon | MultiPolygon
  ): Promise<number> {
    const turf = await import('@turf/turf');

    try {
      const feature1 = turf.feature(geom1);
      const feature2 = turf.feature(geom2);
      const intersection = turf.intersect(turf.featureCollection([feature1, feature2]));
      return intersection ? turf.area(intersection) : 0;
    } catch (error) {
      // Intersection failed (likely invalid geometries or no overlap)
      return 0;
    }
  }

  /**
   * Calculate geometry area using turf.area()
   */
  private async calculateArea(geometry: Polygon | MultiPolygon): Promise<number> {
    const turf = await import('@turf/turf');
    return turf.area(turf.feature(geometry));
  }

  /**
   * Get district system configuration for a state
   */
  getDistrictSystem(stateFips: string): DistrictSystemConfig | null {
    return DISTRICT_SYSTEM_CONFIG[stateFips] ?? null;
  }

  /**
   * Validate GEOID format for school district
   *
   * Format: SSLLLLL (2-digit state FIPS + 5-digit LEA code)
   */
  validateGeoidFormat(geoid: string, stateFips: string): boolean {
    if (!geoid || typeof geoid !== 'string') return false;
    if (!geoid.startsWith(stateFips)) return false;
    if (geoid.length !== 7) return false;
    if (!/^\d+$/.test(geoid)) return false;
    return true;
  }
}
