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

/** BN254 scalar field modulus — all field elements must be strictly less than this value */
export const BN254_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

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
    const result = BigInt(geoid);
    if (result >= BN254_MODULUS) {
      throw new Error(`Encoded cell ID exceeds BN254 field modulus: ${geoid}`);
    }
    return result;
  }
  const bytes = Buffer.from(geoid, 'utf-8');
  if (bytes.length > 31) {
    throw new Error(`GEOID too long for field encoding: ${geoid} (${bytes.length} bytes)`);
  }
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  if (result >= BN254_MODULUS) {
    throw new Error(`Encoded cell ID exceeds BN254 field modulus: ${geoid}`);
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
    const result = BigInt(numeric);
    if (result >= BN254_MODULUS) {
      throw new Error(`Encoded cell ID exceeds BN254 field modulus: ${unitId}`);
    }
    return result;
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
  if (result >= BN254_MODULUS) {
    throw new Error(`Encoded cell ID exceeds BN254 field modulus: ${unitId}`);
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

// ============================================================================
// New Zealand Jurisdiction Configuration
// ============================================================================

/**
 * Encode a Stats NZ meshblock code as a BN254 field element.
 *
 * Meshblock codes are 7-digit numeric strings (e.g., "0100100").
 * Directly converted to bigint — safe since all codes are well within
 * BN254 field bounds.
 */
function encodeNZCellId(mbCode: string): bigint {
  const numeric = mbCode.replace(/\D/g, '');
  if (/^\d+$/.test(numeric)) {
    const result = BigInt(numeric);
    if (result >= BN254_MODULUS) {
      throw new Error(`Encoded cell ID exceeds BN254 field modulus: ${mbCode}`);
    }
    return result;
  }
  // Fallback: UTF-8 byte packing
  const bytes = Buffer.from(mbCode, 'utf-8');
  if (bytes.length > 31) {
    throw new Error(`NZ meshblock code too long for field encoding: ${mbCode} (${bytes.length} bytes)`);
  }
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  if (result >= BN254_MODULUS) {
    throw new Error(`Encoded cell ID exceeds BN254 field modulus: ${mbCode}`);
  }
  return result;
}

/**
 * New Zealand jurisdiction configuration.
 *
 * 2 of 24 protocol slots are populated for the initial electoral layer.
 * Slot 0 = General Electorate, Slot 1 = Maori Electorate (dual coverage).
 * Slots 2-3 reserved for Regional Council and Territorial Authority.
 *
 * Data sources:
 *   - Stats NZ Datafinder — meshblock-to-electorate concordance CSV
 *   - Stats NZ ArcGIS — boundary geometries
 */
export const NZ_JURISDICTION: JurisdictionConfig = {
  country: 'NZL',
  name: 'New Zealand',

  slots: {
    0: { name: 'General Electorate',        required: true,  category: 'legislative' },
    1: { name: 'Māori Electorate',           required: false, category: 'legislative' },
    2: { name: 'Regional Council',           required: false, category: 'administrative' },
    3: { name: 'Territorial Authority',      required: false, category: 'administrative' },
  },

  aliases: {
    'general_electorate': 0, 'general': 0, 'ged': 0,
    'maori_electorate': 1, 'maori': 1, 'med': 1,
    'regional_council': 2, 'region': 2, 'rc': 2,
    'territorial_authority': 3, 'ta': 3, 'district': 3,
  },

  recommendedDepth: 18,  // ~57K meshblocks → fits in 2^18 = 262K
  encodeCellId: encodeNZCellId,
};

// ============================================================================
// Australia Jurisdiction Configuration
// ============================================================================

/**
 * Encode an ABS SA1 code as a BN254 field element.
 *
 * SA1 codes are 11-digit numeric strings (e.g., "10101100101").
 * Format: S + SA4(3) + SA3(5) + SA2(9) + SA1(11) — each level
 * prefixed by the state digit.
 * Directly converted to bigint — safe since all codes are well within
 * BN254 field bounds (max ~2^253).
 */
function encodeAuCellId(sa1Code: string): bigint {
  const numeric = sa1Code.replace(/\D/g, '');
  if (/^\d+$/.test(numeric)) {
    const result = BigInt(numeric);
    if (result >= BN254_MODULUS) {
      throw new Error(`Encoded cell ID exceeds BN254 field modulus: ${sa1Code}`);
    }
    return result;
  }
  // Fallback: UTF-8 byte packing
  const bytes = Buffer.from(sa1Code, 'utf-8');
  if (bytes.length > 31) {
    throw new Error(`AU SA1 code too long for field encoding: ${sa1Code} (${bytes.length} bytes)`);
  }
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  if (result >= BN254_MODULUS) {
    throw new Error(`Encoded cell ID exceeds BN254 field modulus: ${sa1Code}`);
  }
  return result;
}

/**
 * Australia jurisdiction configuration.
 *
 * 2 of 24 protocol slots are populated for the initial federal layer.
 * Slot 0 = Federal Division (CED), Slot 1 = State/Territory.
 * Slots 2+ reserved for state legislature, local government areas.
 *
 * Data sources:
 *   - ABS ASGS Ed. 3 — SA1-to-CED correspondence (from correspondences ZIP)
 *   - ABS ArcGIS — boundary geometries (CED 2024)
 */
export const AU_JURISDICTION: JurisdictionConfig = {
  country: 'AUS',
  name: 'Australia',

  slots: {
    0: { name: 'Federal Division (CED)',  required: true,  category: 'legislative' },
    1: { name: 'State / Territory',       required: true,  category: 'administrative' },
  },

  aliases: {
    'federal_division': 0, 'ced': 0, 'division': 0, 'electorate': 0,
    'state': 1, 'territory': 1, 'state_territory': 1,
  },

  recommendedDepth: 18,  // ~62K SA1s → fits in 2^18 = 262K
  encodeCellId: encodeAuCellId,
};

// ============================================================================
// United Kingdom Jurisdiction Configuration
// ============================================================================

/**
 * Encode an ONS geography code as a BN254 field element.
 *
 * UK codes are 9-character alphanumeric strings (e.g., "E00000001" for an
 * Output Area, "S13002849" for a Scottish ward). The letter prefix encodes
 * the country (E=England, W=Wales, S=Scotland, N=Northern Ireland) and type.
 *
 * Because codes are alphanumeric, pure numeric stripping would lose the
 * prefix and cause collisions (E14000001 vs S14000001). We byte-pack the
 * full UTF-8 string instead — safe since 9 bytes << 31-byte BN254 limit.
 */
function encodeGBCellId(code: string): bigint {
  const trimmed = code.trim();
  const bytes = Buffer.from(trimmed, 'utf-8');
  if (bytes.length > 31) {
    throw new Error(`GB code too long for field encoding: ${trimmed} (${bytes.length} bytes)`);
  }
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  if (result >= BN254_MODULUS) {
    throw new Error(`Encoded cell ID exceeds BN254 field modulus: ${trimmed}`);
  }
  return result;
}

/**
 * United Kingdom jurisdiction configuration.
 *
 * 1 of 24 protocol slots is populated for the initial parliamentary layer.
 * Slot 0 = Westminster Parliamentary Constituency.
 * Slots 1-3 reserved for regions, local authorities, and wards.
 *
 * Statistical units: Census 2021 Output Areas (England & Wales, ~189K)
 * supplemented by electoral wards (Scotland ~421, Northern Ireland ~474)
 * for complete UK coverage of all 650 constituencies.
 *
 * Data sources:
 *   - ONS Open Geography Portal — OA→PCON best-fit lookup (E&W)
 *   - ONS Open Geography Portal — Ward→PCON lookup (Scotland & NI gap-fill)
 *   - ONS ArcGIS — constituency boundary geometries
 */
export const GB_JURISDICTION: JurisdictionConfig = {
  country: 'GBR',
  name: 'United Kingdom',

  slots: {
    0: { name: 'Westminster Parliamentary Constituency', required: true,  category: 'legislative' },
    1: { name: 'Region / Devolved Nation',               required: false, category: 'administrative' },
    2: { name: 'Local Authority District',               required: false, category: 'administrative' },
    3: { name: 'Electoral Ward',                         required: false, category: 'administrative' },
  },

  aliases: {
    'westminster': 0, 'constituency': 0, 'parliamentary': 0, 'pcon': 0,
    'region': 1, 'devolved': 1, 'nation': 1,
    'local_authority': 2, 'la': 2, 'council': 2, 'lad': 2,
    'ward': 3, 'electoral_ward': 3,
  },

  recommendedDepth: 18,  // ~190K cells → fits in 2^18 = 262K
  encodeCellId: encodeGBCellId,
};
