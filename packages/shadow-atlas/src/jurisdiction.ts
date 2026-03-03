/**
 * Jurisdiction Abstraction Layer
 *
 * Defines the interface boundary between the jurisdiction-agnostic cryptographic
 * core (circuits, contracts, proof generation) and the jurisdiction-specific data
 * pipeline (cell resolution, district assignment, tree hydration).
 *
 * PROTOCOL CONSTANT — DISTRICT_SLOT_COUNT = 24:
 *
 *   The number 24 is a PROTOCOL-LEVEL constant, not a US-specific assumption.
 *   It is baked into three structural layers:
 *
 *     1. Noir circuit:  `districts: pub [Field; 24]`  (compile-time array size)
 *     2. Sponge hash:   `poseidon2_sponge_24()`       (24/rate=8 absorb rounds)
 *     3. Solidity:      `TWO_TREE_PUBLIC_INPUT_COUNT = 29`  (2 + 24 + 3)
 *
 *   Changing it requires recompiling circuits, regenerating Honk verifiers,
 *   and redeploying contracts. It is intentionally fixed.
 *
 *   24 slots provide sufficient capacity for any known governance structure:
 *     - United States:  13 slots used (federal → municipal → school → admin)
 *     - United Kingdom: ~6 slots (Westminster, devolved, council, ward, region, parish)
 *     - India:          ~8 slots (Lok Sabha, Vidhan Sabha, municipal, panchayat, district, block, tehsil, ward)
 *     - France:         ~7 slots (commune, canton, département, région, arrondissement, intercommunalité, circonscription)
 *     - Germany:        ~6 slots (Bundestag, Landtag, Kreis, Gemeinde, Bezirk, Ortsteil)
 *
 *   Unused slots MUST be 0n. The circuit, sponge hash, and contract verification
 *   all operate on the full 24-element array regardless of how many slots a
 *   jurisdiction uses. Zero-valued slots do not affect proof validity.
 *
 * ARCHITECTURE:
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  Jurisdiction-Agnostic (never changes per country)      │
 *   │                                                         │
 *   │  Noir circuit ─→ Poseidon2 sponge ─→ Honk verifier     │
 *   │  DistrictGate.sol ─→ VerifierRegistry ─→ DistrictRegistry│
 *   │  SparseMerkleTree ─→ buildCellMapTree()                 │
 *   │  TwoTreeNoirProver ─→ generateProof()                   │
 *   │                                                         │
 *   │  Input:  CellDistrictMapping[] (cellId + 24 bigints)    │
 *   │  Output: SMT root, proofs, on-chain verification        │
 *   └───────────────────────┬─────────────────────────────────┘
 *                           │
 *                   CellDistrictMapping[]
 *                           │
 *   ┌───────────────────────┴─────────────────────────────────┐
 *   │  Jurisdiction-Specific (one implementation per country)  │
 *   │                                                         │
 *   │  HydrationPipeline.hydrate() → CellDistrictMapping[]    │
 *   │                                                         │
 *   │  US: BAF → parse → BEF overlay → ward overlay → cells  │
 *   │  UK: ONS OA → OS boundary → constituency lookup → cells │
 *   │  IN: Census ward → EC data → delimitation → cells       │
 *   └─────────────────────────────────────────────────────────┘
 *
 * SPEC REFERENCE: TWO-TREE-ARCHITECTURE-SPEC.md, DISTRICT-TAXONOMY.md
 *
 * @packageDocumentation
 */

import type { CellDistrictMapping } from './tree-builder.js';

// ============================================================================
// Protocol Constants
// ============================================================================

/**
 * Number of district slots per cell.
 *
 * This is a PROTOCOL CONSTANT — not a jurisdiction-specific value.
 * It is structurally embedded in the Noir circuit ([Field; 24]),
 * the Poseidon2 sponge function (24/3 = 8 absorb rounds),
 * and the on-chain verifier (29 = 2 + 24 + 3 public inputs).
 *
 * All jurisdictions use the same 24 slots. Unused slots are 0n.
 * The circuit does not interpret slot semantics — it treats all
 * 24 values as opaque field elements hashed into a single commitment.
 */
export const PROTOCOL_DISTRICT_SLOTS = 24 as const;

/**
 * Two-tree public input count: user_root(1) + cell_map_root(1) + districts(24) + nullifier(1) + action_domain(1) + authority_level(1) = 29
 */
export const PROTOCOL_TWO_TREE_PUBLIC_INPUTS = 29 as const;

// ============================================================================
// Jurisdiction Configuration
// ============================================================================

/**
 * Slot definition within a jurisdiction's district taxonomy.
 *
 * Each jurisdiction maps its governance tiers to a subset of the 24 protocol slots.
 * Slots are protocol-level indices [0..23]; what they mean is jurisdiction-defined.
 */
export interface SlotDefinition {
  /** Human-readable name for this governance tier (e.g., "Congressional District", "Westminster Constituency") */
  readonly name: string;
  /** Whether this slot must be populated for a valid cell in this jurisdiction */
  readonly required: boolean;
  /** Governance category for grouping/display */
  readonly category: 'legislative' | 'executive' | 'judicial' | 'administrative' | 'education' | 'special';
}

/**
 * Jurisdiction configuration — the contract between a country's data pipeline
 * and the protocol-level cryptographic layer.
 *
 * Each jurisdiction declares:
 *   1. Which of the 24 protocol slots it uses
 *   2. What each slot represents in its governance structure
 *   3. How to encode its geographic unit IDs as field elements
 *   4. What tree depth suits its population/geographic scale
 *
 * The ZK circuit, contracts, and proof system never read this config.
 * It exists to guide data pipeline implementation and API labeling.
 */
export interface JurisdictionConfig {
  /** ISO 3166-1 alpha-3 country code (e.g., "USA", "GBR", "IND") */
  readonly country: string;

  /** Human-readable jurisdiction name */
  readonly name: string;

  /**
   * Slot definitions: maps protocol slot index → governance tier.
   * Only slots used by this jurisdiction should be present.
   * Missing slots default to 0n in CellDistrictMapping.
   */
  readonly slots: Readonly<Record<number, SlotDefinition>>;

  /**
   * Aliases: maps human-readable governance type names to slot indices.
   * Multiple aliases can map to the same slot (e.g., "cd" and "congressional" → 0).
   * Used by the serving layer for query filtering and display.
   */
  readonly aliases: Readonly<Record<string, number>>;

  /**
   * Recommended tree depth for this jurisdiction's scale.
   *   18: ≤260K cells (small countries, city-states)
   *   20: ≤1M cells   (medium countries, US states)
   *   22: ≤4M cells   (large countries, nationwide US)
   *   24: ≤16M cells  (very large countries, India/China)
   */
  readonly recommendedDepth: 18 | 20 | 22 | 24;

  /**
   * Encode a jurisdiction-specific geographic unit identifier as a BN254 field element.
   *
   * US: Census tract GEOID → bigint
   * UK: ONS Output Area code → bigint
   * Generic: any stable geographic unit ID → bigint (must be < BN254 modulus)
   *
   * The circuit treats cell_id as an opaque Field. This function bridges
   * from human-readable geographic identifiers to the cryptographic domain.
   */
  readonly encodeCellId: (unitId: string) => bigint;
}

// ============================================================================
// Hydration Pipeline Interface
// ============================================================================

/**
 * Hydration pipeline — the jurisdiction-specific data pipeline that produces
 * CellDistrictMapping[] from authoritative geographic/electoral data sources.
 *
 * This is the ONLY interface a new jurisdiction needs to implement.
 * Everything downstream (tree building, proof generation, on-chain verification)
 * consumes CellDistrictMapping[] and is jurisdiction-agnostic.
 *
 * Implementation contract:
 *   - Each mapping must have exactly PROTOCOL_DISTRICT_SLOTS (24) district values
 *   - Unused slots must be 0n
 *   - cellId must be encoded via the jurisdiction's encodeCellId()
 *   - District values in populated slots must be non-zero field elements
 *   - The same cellId must not appear twice in the output
 */
export interface HydrationPipeline {
  /** The jurisdiction this pipeline serves */
  readonly config: JurisdictionConfig;

  /**
   * Hydrate: load authoritative data and produce cell-district mappings.
   *
   * @param options - Pipeline-specific options (cache dirs, filters, etc.)
   * @returns Array of cell-district mappings ready for buildCellMapTree()
   */
  hydrate(options?: Record<string, unknown>): Promise<CellDistrictMapping[]>;
}

/**
 * Hydration result with statistics for pipeline observability.
 */
export interface HydrationResult {
  /** Cell-district mappings ready for tree building */
  readonly mappings: CellDistrictMapping[];
  /** Total geographic units processed (e.g., blocks, output areas) */
  readonly unitsProcessed: number;
  /** Total cells produced (may differ from units due to virtual cell splitting) */
  readonly cellCount: number;
  /** Per-slot population counts */
  readonly slotCoverage: ReadonlyMap<number, number>;
  /** Pipeline-specific statistics */
  readonly stats: Record<string, unknown>;
}

// ============================================================================
// US Jurisdiction Configuration
// ============================================================================

/**
 * Encode a US Census GEOID string as a BN254 field element.
 *
 * GEOIDs are numeric strings (e.g., "06075061200" for a CA tract).
 * Directly converted to bigint — safe since all GEOIDs are well within
 * BN254 field bounds (max ~2^253).
 *
 * For rare alphanumeric GEOIDs (some SLDU/SLDL codes), falls back to
 * UTF-8 byte packing (max 31 bytes = 248 bits).
 */
function encodeUsGeoid(geoid: string): bigint {
  if (/^\d+$/.test(geoid)) {
    return BigInt(geoid);
  }
  const bytes = Buffer.from(geoid, 'utf-8');
  if (bytes.length > 31) {
    throw new Error(`GEOID too long for field encoding: ${geoid} (${bytes.length} bytes)`);
  }
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

/**
 * United States jurisdiction configuration.
 *
 * 13 of 24 protocol slots are defined for Census BAF/BEF data plus the
 * city council ward overlay. Slot 22 (Tribal / Native Area) covers AIANNH
 * districts. Consolidated cities (concity) map to slot 5 (City).
 * Remaining slots are reserved for special districts (10-19) to be
 * populated via the ingestion platform's scanner infrastructure.
 *
 * Data sources:
 *   - Census Bureau Block Assignment Files (BAFs) — slots 0-5, 7-9, 20-21
 *   - Census Bureau Block Equivalency Files (BEFs) — slot 0 override for redistricted states
 *   - Municipal ArcGIS FeatureServers — slot 6 (city council wards)
 *   - TIGER/Line shapefiles — tract centroids for PIP overlay
 */
export const US_JURISDICTION: JurisdictionConfig = {
  country: 'USA',
  name: 'United States of America',

  slots: {
    // Core governance (federal → municipal)
    0:  { name: 'Congressional District',       required: true,  category: 'legislative' },
    1:  { name: 'Federal Senate',               required: true,  category: 'legislative' },
    2:  { name: 'State Senate',                 required: true,  category: 'legislative' },
    3:  { name: 'State House / Assembly',        required: false, category: 'legislative' },  // NE unicameral, DC
    4:  { name: 'County',                       required: true,  category: 'administrative' },
    5:  { name: 'City / Municipality',          required: false, category: 'administrative' },  // rural areas unincorporated
    6:  { name: 'City Council Ward',            required: false, category: 'legislative' },

    // Education
    7:  { name: 'Unified School District',      required: false, category: 'education' },
    8:  { name: 'Elementary School District',   required: false, category: 'education' },
    9:  { name: 'Secondary School District',    required: false, category: 'education' },
    10: { name: 'Community College District',   required: false, category: 'education' },

    // Special districts
    11: { name: 'Water / Sewer District',       required: false, category: 'special' },
    12: { name: 'Fire / EMS District',          required: false, category: 'special' },
    13: { name: 'Transit District',             required: false, category: 'special' },
    14: { name: 'Hospital District',            required: false, category: 'special' },
    15: { name: 'Library District',             required: false, category: 'special' },
    16: { name: 'Park / Recreation District',   required: false, category: 'special' },
    17: { name: 'Conservation District',        required: false, category: 'special' },
    18: { name: 'Utility District',             required: false, category: 'special' },
    19: { name: 'Judicial District',            required: false, category: 'judicial' },

    // Administrative
    20: { name: 'Township / MCD',               required: false, category: 'administrative' },
    21: { name: 'Voting Precinct',              required: false, category: 'administrative' },

    // Overflow
    22: { name: 'Tribal / Native Area',          required: false, category: 'administrative' },
    23: { name: 'Overflow 2',                   required: false, category: 'special' },
  },

  aliases: {
    // Core governance
    'congressional': 0, 'cd': 0,
    'federal_senate': 1, 'senate': 1,
    'state_senate': 2, 'sldu': 2,
    'state_house': 3, 'sldl': 3,
    'county': 4,
    'city': 5, 'place': 5, 'municipal': 5, 'concity': 5,
    'city_council': 6, 'ward': 6,

    // Education
    'school_unified': 7, 'unsd': 7,
    'school_elementary': 8, 'elsd': 8,
    'school_secondary': 9, 'scsd': 9,
    'community_college': 10,

    // Special districts
    'water_sewer': 11, 'fire_ems': 12, 'transit': 13,
    'hospital': 14, 'library': 15, 'park_recreation': 16,
    'conservation': 17, 'utility': 18, 'judicial': 19,

    // Administrative
    'township': 20, 'cousub': 20,
    'voting_precinct': 21, 'vtd': 21,

    // Tribal / Native governance
    'aiannh': 22,

    // Overflow
    'overflow_1': 22, 'overflow_2': 23,
  },

  recommendedDepth: 20,
  encodeCellId: encodeUsGeoid,
};

// ============================================================================
// Canada Jurisdiction Configuration
// ============================================================================

/**
 * Encode a StatCan Dissemination Area DGUID or riding code as a BN254 field element.
 *
 * DA DGUID format: "2021A0001XXXXX" (vintage + type + DA code).
 * Riding codes are 5-digit numeric (e.g., "35001" for an Ontario riding).
 * Both are safely numeric — direct BigInt conversion.
 *
 * ~56,000 DAs nationally + 338 ridings — well within field bounds.
 */
function encodeCanadaCellId(unitId: string): bigint {
  const numeric = unitId.replace(/\D/g, '');
  if (/^\d+$/.test(numeric)) {
    return BigInt(numeric);
  }
  // Fallback: UTF-8 byte packing (same as US)
  const bytes = Buffer.from(unitId, 'utf-8');
  if (bytes.length > 31) {
    throw new Error(`Canada unit ID too long for field encoding: ${unitId} (${bytes.length} bytes)`);
  }
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

/**
 * Canada jurisdiction configuration.
 *
 * 2 of 24 protocol slots are populated for the initial federal layer.
 * Slots 2-4 are reserved for provincial legislature, municipality, and ward
 * data to be populated in Phase B2+.
 *
 * Data sources:
 *   - Elections Canada / Represent API — slot 0 (federal electoral districts / ridings)
 *   - Statistics Canada — slot 1 (province/territory from DA geographic attributes)
 *   - Provincial legislatures — slot 2 (future: provincial electoral districts)
 *   - Municipal boundaries — slot 3 (future: municipality / arrondissement)
 *   - Municipal wards — slot 4 (future: ward / quartier)
 */
export const CA_JURISDICTION: JurisdictionConfig = {
  country: 'CAN',
  name: 'Canada',

  slots: {
    // Core governance (federal)
    0: { name: 'Federal Electoral District (Riding)',  required: true,  category: 'legislative' },
    1: { name: 'Province / Territory',                 required: true,  category: 'administrative' },

    // Provincial (Phase B2+)
    2: { name: 'Provincial Electoral District',        required: false, category: 'legislative' },
    3: { name: 'Municipality / Ville',                 required: false, category: 'administrative' },
    4: { name: 'Municipal Ward / Quartier',            required: false, category: 'legislative' },

    // Education (Phase B3+)
    5: { name: 'School Board / Commission scolaire',   required: false, category: 'education' },

    // Reserved (same semantic space as US for cross-country consistency)
    6:  { name: 'Health Region',                       required: false, category: 'administrative' },
    7:  { name: 'Census Division',                     required: false, category: 'administrative' },
  },

  aliases: {
    // Federal
    'riding': 0, 'fed': 0, 'electoral_district': 0, 'circonscription': 0,
    'federal_electoral_district': 0,
    'province': 1, 'territory': 1, 'prov': 1,

    // Provincial (future)
    'provincial_district': 2, 'ped': 2,
    'municipality': 3, 'ville': 3, 'city': 3,
    'ward': 4, 'quartier': 4,

    // Education (future)
    'school_board': 5, 'commission_scolaire': 5,

    // Administrative (future)
    'health_region': 6,
    'census_division': 7, 'cd': 7,
  },

  recommendedDepth: 18,  // 338 ridings + ~56K DAs → fits in 2^18 = 262K
  encodeCellId: encodeCanadaCellId,
};
