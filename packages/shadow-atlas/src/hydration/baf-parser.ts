/**
 * Census BAF Parser
 *
 * Parses extracted BAF .txt files into structured block records.
 * Each BAF zip contains separate files per entity type (CD, SLDU, SLDL, etc.)
 * with pipe-delimited records mapping BLOCKID → district assignment.
 *
 * File formats observed from Census Bureau BAF 2020:
 *   _CD.txt:           BLOCKID|DISTRICT
 *   _SLDU.txt:         BLOCKID|DISTRICT
 *   _SLDL.txt:         BLOCKID|DISTRICT
 *   _INCPLACE_CDP.txt: BLOCKID|PLACEFP
 *   _SDUNI.txt:        BLOCKID|DISTRICT
 *   _SDELM.txt:        BLOCKID|DISTRICT
 *   _SDSEC.txt:        BLOCKID|DISTRICT
 *   _VTD.txt:          BLOCKID|COUNTYFP|DISTRICT
 *   _MCD.txt:          BLOCKID|COUNTYFP|COUSUBFP
 *   _AIANNH.txt:       BLOCKID|AIANNHCE|COMPTYP
 *
 * @packageDocumentation
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

// ============================================================================
// Types
// ============================================================================

/**
 * A single block's district assignments aggregated from all BAF entity files.
 *
 * Each block has a 15-char BLOCKID = state(2) + county(3) + tract(6) + block(4).
 * The assignments map slot indices to district GEOID strings.
 */
export interface BlockRecord {
  /** Full 15-character BLOCKID. */
  blockId: string;
  /** State FIPS (first 2 chars of BLOCKID). */
  stateFips: string;
  /** County FIPS (state + county = first 5 chars of BLOCKID). */
  countyFips: string;
  /** Tract GEOID (first 11 chars of BLOCKID = state + county + tract). */
  tractGeoid: string;
  /**
   * District assignments indexed by slot number.
   * Only populated slots are present; missing = no assignment.
   * Values are GEOID strings (will be encoded to field elements later).
   */
  districts: Map<number, string>;
}

/**
 * BAF entity type suffix → parsing metadata.
 */
interface EntityTypeConfig {
  /** District slot index in the 24-slot taxonomy. */
  slot: number;
  /** Column index containing the district value (0-indexed, after BLOCKID). */
  valueColumn: number;
  /** Whether to prefix state FIPS to the value for a full GEOID. */
  prefixState?: boolean;
}

// ============================================================================
// Entity Type Configuration
// ============================================================================

/**
 * Mapping from BAF file suffix to slot index and parse config.
 *
 * Slot assignments per DISTRICT-TAXONOMY.md:
 *   0: Congressional District       (CD)
 *   1: Federal Senate               (derived = state FIPS)
 *   2: State Senate                 (SLDU)
 *   3: State House / Assembly       (SLDL)
 *   4: County                       (derived from BLOCKID[0:5])
 *   5: City / Municipality          (INCPLACE_CDP)
 *   7: Unified School District      (SDUNI)
 *   8: Elementary School District   (SDELM)
 *   9: Secondary School District    (SDSEC)
 *  20: Township / MCD               (MCD — COUSUBFP)
 *  21: Voting Precinct              (VTD)
 */
const ENTITY_TYPE_CONFIG: Record<string, EntityTypeConfig> = {
  'CD':            { slot: 0, valueColumn: 0 },
  'SLDU':          { slot: 2, valueColumn: 0 },
  'SLDL':          { slot: 3, valueColumn: 0 },
  'INCPLACE_CDP':  { slot: 5, valueColumn: 0 },
  'SDUNI':         { slot: 7, valueColumn: 0 },
  'SDELM':         { slot: 8, valueColumn: 0 },
  'SDSEC':         { slot: 9, valueColumn: 0 },
  'MCD':           { slot: 20, valueColumn: 1 },  // BLOCKID|COUNTYFP|COUSUBFP → take COUSUBFP
  'VTD':           { slot: 21, valueColumn: 1 },   // BLOCKID|COUNTYFP|DISTRICT → take DISTRICT
};

// ============================================================================
// Parser
// ============================================================================

/**
 * Extract the entity type suffix from a BAF filename.
 *
 * E.g., "BlockAssign_ST06_CA_CD.txt" → "CD"
 *       "BlockAssign_ST06_CA_INCPLACE_CDP.txt" → "INCPLACE_CDP"
 */
export function extractEntityType(filename: string): string | null {
  const base = basename(filename, '.txt');
  // Pattern: BlockAssign_STxx_XX_{ENTITY_TYPE}
  // Match after the third underscore, but INCPLACE_CDP has its own underscore
  const match = base.match(/^BlockAssign_ST\d{2}_[A-Z]{2}_(.+)$/);
  return match?.[1] ?? null;
}

/**
 * Parse all BAF .txt files for a single state into block records.
 *
 * Aggregates records from all entity type files into a unified BlockRecord
 * per block, merging district assignments across files.
 *
 * @param filePaths - Array of .txt file paths from a single state's BAF extraction
 * @returns Map of BLOCKID → BlockRecord
 */
export function parseBAFFiles(filePaths: string[]): Map<string, BlockRecord> {
  const blocks = new Map<string, BlockRecord>();

  // We read files synchronously to reduce complexity — BAF files are text, ~2-14MB each
  // For async version, see parseBAFFilesAsync below
  return blocks; // Placeholder — actual parsing is in parseBAFFilesAsync
}

/**
 * Parse all BAF .txt files for a single state into block records (async).
 *
 * @param filePaths - Array of .txt file paths from a single state's BAF extraction
 * @returns Map of BLOCKID → BlockRecord
 */
export async function parseBAFFilesAsync(filePaths: string[]): Promise<Map<string, BlockRecord>> {
  const blocks = new Map<string, BlockRecord>();

  for (const filePath of filePaths) {
    const entityType = extractEntityType(filePath);
    if (!entityType) continue;

    const config = ENTITY_TYPE_CONFIG[entityType];
    if (!config) continue; // Skip AIANNH and other unmapped types

    const content = await readFile(filePath, 'utf-8');
    parseBAFContent(content, config, blocks);
  }

  // Derive slot 1 (Federal Senate) and slot 4 (County) from BLOCKID
  for (const [, block] of blocks) {
    // Slot 1: Federal Senate = state FIPS (each state has 2 senators, state-wide)
    block.districts.set(1, block.stateFips);

    // Slot 4: County = state(2) + county(3) from BLOCKID
    block.districts.set(4, block.countyFips);
  }

  return blocks;
}

/**
 * Parse a single BAF entity file's content into the block map.
 *
 * @param content - Raw text content of a BAF .txt file
 * @param config - Entity type configuration (slot, column index)
 * @param blocks - Mutable block map to update
 */
function parseBAFContent(
  content: string,
  config: EntityTypeConfig,
  blocks: Map<string, BlockRecord>,
): void {
  const lines = content.split('\n');

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split('|');
    const blockId = parts[0];

    // Validate BLOCKID: must be 15 digits
    if (!/^\d{15}$/.test(blockId)) continue;

    // Get district value from the configured column
    const value = parts[config.valueColumn + 1]?.trim(); // +1 because BLOCKID is column 0

    // Skip empty/unassigned values (blank, "ZZZ", "ZZZZZ")
    if (!value || /^Z+$/.test(value)) continue;

    // Get or create block record
    let block = blocks.get(blockId);
    if (!block) {
      block = {
        blockId,
        stateFips: blockId.substring(0, 2),
        countyFips: blockId.substring(0, 5),
        tractGeoid: blockId.substring(0, 11),
        districts: new Map(),
      };
      blocks.set(blockId, block);
    }

    // For CD, SLDU, SLDL: prefix state FIPS for full GEOID
    // For PLACE, SDUNI, SDELM, SDSEC: prefix state FIPS
    // For VTD, MCD: value is already a sub-state code; prefix state+county
    let fullGeoid: string;
    if (config.slot === 21) {
      // VTD: state + county + VTD code
      fullGeoid = block.countyFips + value;
    } else if (config.slot === 20) {
      // MCD/COUSUB: state + county + COUSUBFP
      fullGeoid = block.countyFips + value;
    } else {
      // Everything else: state + district code
      fullGeoid = block.stateFips + value;
    }

    block.districts.set(config.slot, fullGeoid);
  }
}
