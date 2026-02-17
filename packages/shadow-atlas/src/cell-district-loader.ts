/**
 * Cell-District Mapping Loader
 *
 * Loads census tract to district mappings from Census Block Assignment Files (BAFs)
 * and transforms them into the CellDistrictMapping format needed by the dual-tree builder.
 *
 * Data pipeline: BAF download → parse → BEF overlay → cell resolution → CellDistrictMapping[]
 *
 * The 24-slot district taxonomy is defined in DISTRICT-TAXONOMY.md:
 *   Slot 0:  Congressional District
 *   Slot 1:  Federal Senate (state-wide)
 *   Slot 2:  State Senate
 *   Slot 3:  State House / Assembly
 *   Slot 4:  County
 *   Slot 5:  City / Municipality
 *   Slot 6:  City Council Ward
 *   Slot 7:  Unified School District
 *   Slot 8:  Elementary School District
 *   Slot 9:  Secondary School District
 *   Slot 10: Community College District
 *   Slot 11: Water/Sewer District
 *   Slot 12: Fire/EMS District
 *   Slot 13: Transit District
 *   Slot 14: Hospital District
 *   Slot 15: Library District
 *   Slot 16: Park/Recreation District
 *   Slot 17: Conservation District
 *   Slot 18: Utility District
 *   Slot 19: Judicial District
 *   Slot 20: Township
 *   Slot 21: Voting Precinct
 *   Slot 22: Overflow 1 (additional special districts)
 *   Slot 23: Overflow 2 (international/supranational)
 *
 * SPEC REFERENCE: DISTRICT-TAXONOMY.md, TWO-TREE-ARCHITECTURE-SPEC.md Section 3
 *
 * @packageDocumentation
 */

import { DISTRICT_SLOT_COUNT, type CellDistrictMapping } from './dual-tree-builder.js';
import { downloadBAFs } from './hydration/baf-downloader.js';
import { parseBAFFilesAsync } from './hydration/baf-parser.js';
import { overlayBEFs } from './hydration/bef-overlay.js';
import { resolveCells } from './hydration/cell-resolver.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for loading cell-district mappings.
 */
export interface CellDistrictLoaderOptions {
  /** Filter to a specific state (2-digit FIPS code, e.g., "06" for California) */
  stateCode?: string;

  /**
   * Which district types to include.
   * Defaults to all available types.
   * Valid values: 'congressional', 'state_senate', 'state_house',
   *               'county', 'city', 'school_unified', 'school_elementary',
   *               'school_secondary', 'township', 'voting_precinct'
   */
  districtTypes?: string[];
}

/**
 * Raw district assignment for a single cell (census tract).
 * Collected from multiple TIGER layers, then assembled into
 * the 24-slot array.
 */
export interface RawCellDistricts {
  /** Census Tract GEOID (e.g., "06075061200") */
  tractGeoid: string;

  /** State FIPS code (e.g., "06") */
  stateFips: string;

  /**
   * District assignments by type.
   * Key is the district type, value is the GEOID of the district.
   * Multiple assignments per type are allowed for split tracts.
   */
  assignments: Map<string, string>;
}

/**
 * District type to slot index mapping.
 *
 * Maps TIGER layer names and common district type identifiers
 * to their canonical slot in the 24-slot taxonomy.
 */
export const DISTRICT_TYPE_TO_SLOT: Record<string, number> = {
  // Core governance
  'congressional': 0,
  'cd': 0,
  'federal_senate': 1,
  'senate': 1,
  'state_senate': 2,
  'sldu': 2,
  'state_house': 3,
  'sldl': 3,
  'county': 4,
  'city': 5,
  'place': 5,
  'city_council': 6,

  // Education
  'school_unified': 7,
  'unsd': 7,
  'school_elementary': 8,
  'elsd': 8,
  'school_secondary': 9,
  'scsd': 9,
  'community_college': 10,

  // Special districts - core
  'water_sewer': 11,
  'fire_ems': 12,
  'transit': 13,
  'hospital': 14,
  'library': 15,
  'park_recreation': 16,

  // Special districts - extended
  'conservation': 17,
  'utility': 18,
  'judicial': 19,

  // Administrative
  'township': 20,
  'cousub': 20,
  'voting_precinct': 21,
  'vtd': 21,

  // Overflow
  'overflow_1': 22,
  'overflow_2': 23,
};

// ============================================================================
// GEOID Encoding
// ============================================================================

/**
 * Encode a GEOID string as a BN254 field element.
 *
 * GEOIDs are numeric strings (e.g., "06075061200" for a CA tract).
 * We encode them directly as bigint, which is safe since all GEOID
 * values are well within BN254 field bounds (max ~2^253).
 *
 * If the GEOID contains non-numeric characters (rare edge case),
 * we hash the UTF-8 bytes into a 248-bit value.
 *
 * @param geoid - GEOID string
 * @returns bigint field element
 */
export function encodeGeoidAsField(geoid: string): bigint {
  // Fast path: numeric GEOIDs (vast majority)
  if (/^\d+$/.test(geoid)) {
    return BigInt(geoid);
  }

  // Slow path: non-numeric GEOIDs - pack UTF-8 bytes
  // This handles alphanumeric GEOIDs like some SLDU/SLDL codes
  const bytes = Buffer.from(geoid, 'utf-8');

  // Ensure we don't exceed 31 bytes (248 bits < BN254 field)
  if (bytes.length > 31) {
    throw new Error(`GEOID too long for field encoding: ${geoid} (${bytes.length} bytes)`);
  }

  return BigInt('0x' + bytes.toString('hex'));
}

// ============================================================================
// Mock Loader (for development / testing)
// ============================================================================

/**
 * Generate mock cell-district mappings for testing.
 *
 * Creates synthetic census tract to district mappings with
 * realistic GEOID structure and district assignments.
 *
 * @param count - Number of mock mappings to generate
 * @param stateCode - State FIPS code (default: "06" California)
 * @returns Array of CellDistrictMapping
 */
export function generateMockMappings(
  count: number,
  stateCode: string = '06',
): CellDistrictMapping[] {
  const mappings: CellDistrictMapping[] = [];

  for (let i = 0; i < count; i++) {
    // Generate realistic tract GEOID: SS + CCC + TTTTTT
    // SS = state FIPS, CCC = county FIPS, TTTTTT = tract number
    const county = String(1 + (i % 58)).padStart(3, '0');
    const tract = String(100000 + i * 100).padStart(6, '0');
    const tractGeoid = `${stateCode}${county}${tract}`;

    // Build 24-slot district array
    const districts: bigint[] = new Array(DISTRICT_SLOT_COUNT).fill(0n);

    // Slot 0: Congressional district (1-52 for CA)
    districts[0] = BigInt(1 + (i % 52));

    // Slot 1: Federal Senate (state-wide = state FIPS)
    districts[1] = BigInt(stateCode);

    // Slot 2: State Senate (1-40 for CA)
    districts[2] = BigInt(1 + (i % 40));

    // Slot 3: State House (1-80 for CA)
    districts[3] = BigInt(1 + (i % 80));

    // Slot 4: County
    districts[4] = BigInt(county);

    // Slot 5: City (place FIPS - synthetic)
    districts[5] = BigInt(stateCode + String(10000 + (i % 500)).padStart(5, '0'));

    // Slots 6-23: Sparse assignments (most are 0n)
    // Slot 7: Unified school district (some tracts)
    if (i % 3 === 0) {
      districts[7] = BigInt(stateCode + String(90000 + (i % 200)).padStart(5, '0'));
    }

    const cellId = encodeGeoidAsField(tractGeoid);
    mappings.push({ cellId, districts });
  }

  return mappings;
}

// ============================================================================
// BAF Pipeline Loader
// ============================================================================

/**
 * Load cell-district mappings from Census Block Assignment Files.
 *
 * Full pipeline:
 * 1. Download BAF zip files from Census Bureau (cached)
 * 2. Parse pipe-delimited block records per entity type
 * 3. Overlay 119th Congress BEFs for redistricted states
 * 4. Resolve blocks to tract-level cells (with virtual cells for boundary splits)
 *
 * @param options - Loader configuration (stateCode to filter, cacheDir for downloads)
 * @returns Array of CellDistrictMapping ready for buildCellMapTree()
 */
export async function loadCellDistrictMappings(
  options: CellDistrictLoaderOptions & { cacheDir?: string } = {},
): Promise<CellDistrictMapping[]> {
  const cacheDir = options.cacheDir ?? 'data/baf-cache';

  // Step 1: Download BAFs
  const downloadResults = await downloadBAFs({
    cacheDir,
    stateCode: options.stateCode,
  });

  // Step 2: Parse all states' BAF files
  const allBlocks = new Map<string, import('./hydration/baf-parser.js').BlockRecord>();

  for (const result of downloadResults) {
    const stateBlocks = await parseBAFFilesAsync(result.files);
    for (const [blockId, record] of stateBlocks) {
      allBlocks.set(blockId, record);
    }
  }

  // Step 3: Overlay BEFs for redistricted states (119th Congress)
  await overlayBEFs(allBlocks, { cacheDir });

  // Step 4: Resolve to tract-level cells
  const { mappings } = resolveCells(allBlocks);

  return mappings;
}

// ============================================================================
// Raw District Converter
// ============================================================================

/**
 * Convert raw district assignments to CellDistrictMapping format.
 *
 * This is the main entry point for integrating with external spatial
 * join tools. Pass in raw district assignments (from PostGIS, GDAL,
 * or Turf.js point-in-polygon) and get back properly encoded mappings.
 *
 * @param rawDistricts - Array of raw district assignments per tract
 * @returns Array of CellDistrictMapping
 */
export function fromRawDistricts(rawDistricts: RawCellDistricts[]): CellDistrictMapping[] {
  return rawDistricts.map(raw => {
    const districts: bigint[] = new Array(DISTRICT_SLOT_COUNT).fill(0n);

    // Map each assignment to its slot
    for (const [type, geoid] of raw.assignments) {
      const slot = DISTRICT_TYPE_TO_SLOT[type.toLowerCase()];
      if (slot !== undefined && slot < DISTRICT_SLOT_COUNT) {
        districts[slot] = encodeGeoidAsField(geoid);
      }
    }

    return {
      cellId: encodeGeoidAsField(raw.tractGeoid),
      districts,
    };
  });
}

/**
 * Get the slot index for a district type.
 *
 * @param districtType - District type name or TIGER layer code
 * @returns Slot index (0-23) or undefined if not mapped
 */
export function getSlotForDistrictType(districtType: string): number | undefined {
  return DISTRICT_TYPE_TO_SLOT[districtType.toLowerCase()];
}
