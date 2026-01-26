/**
 * Shared constants for Shadow Atlas Merkle tree operations
 *
 * CONSOLIDATION: These constants were duplicated across:
 * - merkle-tree.ts (AUTHORITY_LEVELS)
 * - global-merkle-tree.ts (GLOBAL_AUTHORITY_LEVELS)
 * - multi-layer-builder.ts (imported from merkle-tree.ts)
 *
 * Now centralized here for single source of truth.
 */

// ============================================================================
// Authority Levels
// ============================================================================

/**
 * Authority levels for provenance tracking
 * Higher number = more authoritative source
 *
 * Used to weight trust in boundary data based on its origin.
 * Critical for audit trails and legal compliance.
 */
export const AUTHORITY_LEVELS = {
  FEDERAL_MANDATE: 5,      // US Census TIGER, national statistical agencies
  STATE_OFFICIAL: 4,       // State GIS clearinghouse, provincial agencies
  MUNICIPAL_OFFICIAL: 3,   // Official city/county GIS
  COMMUNITY_VERIFIED: 2,   // Community sources with validation
  UNVERIFIED: 1,           // Unverified sources
} as const;

export type AuthorityLevel = typeof AUTHORITY_LEVELS[keyof typeof AUTHORITY_LEVELS];

// ============================================================================
// Circuit Depths
// ============================================================================

/**
 * Supported circuit depths for Merkle trees
 *
 * These depths correspond to compiled Noir circuits.
 * Depth determines tree capacity: 2^depth leaves.
 *
 * - 18: 262,144 addresses (small districts)
 * - 20: 1,048,576 addresses (medium districts)
 * - 22: 4,194,304 addresses (large districts)
 * - 24: 16,777,216 addresses (mega districts)
 */
export type CircuitDepth = 18 | 20 | 22 | 24;
export const CIRCUIT_DEPTHS = [18, 20, 22, 24] as const;

// ============================================================================
// Tree Defaults
// ============================================================================

/**
 * Default tree depth for Merkle tree construction
 *
 * Changed from 12 to 20 to match circuit requirements.
 * Depth 20 supports up to 1,048,576 addresses per tree.
 */
export const DEFAULT_TREE_DEPTH = 20;

/**
 * Default batch size for parallel operations
 *
 * Controls concurrency during:
 * - Leaf hashing (geometry → Poseidon hash)
 * - Tree construction (level-by-level pair hashing)
 *
 * 64 chosen as balance between parallelism and memory pressure.
 */
export const DEFAULT_BATCH_SIZE = 64;

// ============================================================================
// Jurisdiction-Based Depth Selection
// ============================================================================

/**
 * ISO 3166-1 alpha-3 country codes mapped to circuit depths
 *
 * Based on electoral population and district granularity analysis:
 * - Small countries/city-states: Depth 18 (262K capacity)
 * - Medium countries: Depth 20 (1M capacity)
 * - Large countries: Depth 22 (4M capacity)
 * - Very large countries: Depth 24 (16M capacity)
 *
 * REFERENCE: specs/DISTRICT-TAXONOMY.md Section 4.2
 */
export const COUNTRY_DEPTH_MAPPING: Record<string, CircuitDepth> = {
  // === DEPTH 18: Small Countries & City-States (≤262K districts) ===
  // European microstates
  AND: 18, // Andorra
  LIE: 18, // Liechtenstein
  MCO: 18, // Monaco
  SMR: 18, // San Marino
  VAT: 18, // Vatican City

  // Pacific island nations
  FSM: 18, // Micronesia
  MHL: 18, // Marshall Islands
  NRU: 18, // Nauru
  PLW: 18, // Palau
  TUV: 18, // Tuvalu

  // Caribbean nations
  ATG: 18, // Antigua and Barbuda
  BRB: 18, // Barbados
  DMA: 18, // Dominica
  GRD: 18, // Grenada
  KNA: 18, // Saint Kitts and Nevis
  LCA: 18, // Saint Lucia
  VCT: 18, // Saint Vincent

  // === DEPTH 20: Medium Countries (≤1M districts) ===
  // Western Europe
  AUT: 20, // Austria
  BEL: 20, // Belgium
  CHE: 20, // Switzerland
  DNK: 20, // Denmark
  FIN: 20, // Finland
  IRL: 20, // Ireland
  NOR: 20, // Norway
  PRT: 20, // Portugal
  SWE: 20, // Sweden

  // UK and territories
  GBR: 20, // United Kingdom

  // Eastern Europe
  CZE: 20, // Czech Republic
  HUN: 20, // Hungary
  POL: 20, // Poland
  SVK: 20, // Slovakia

  // Asia-Pacific
  NZL: 20, // New Zealand
  SGP: 20, // Singapore
  TWN: 20, // Taiwan

  // Middle East
  ISR: 20, // Israel

  // Americas
  CAN: 20, // Canada
  CHL: 20, // Chile
  COL: 20, // Colombia

  // === DEPTH 22: Large Countries (≤4M districts) ===
  // Major democracies
  AUS: 22, // Australia
  DEU: 22, // Germany
  ESP: 22, // Spain
  FRA: 22, // France
  ITA: 22, // Italy
  JPN: 22, // Japan
  KOR: 22, // South Korea
  MEX: 22, // Mexico
  USA: 22, // United States

  // Large emerging democracies
  ARG: 22, // Argentina
  BRA: 22, // Brazil (state level)
  ZAF: 22, // South Africa

  // === DEPTH 24: Very Large Countries (≤16M districts) ===
  // Mega-population countries (national PR systems, fine-grained local)
  CHN: 24, // China
  IND: 24, // India
  IDN: 24, // Indonesia
  PAK: 24, // Pakistan
  NGA: 24, // Nigeria
  BGD: 24, // Bangladesh
  RUS: 24, // Russia
} as const;

/**
 * Default depth for countries not explicitly mapped
 *
 * Depth 20 provides good balance:
 * - Supports most medium-sized democracies
 * - Reasonable proving time (~15-30s on mobile)
 * - Safe default for unknown jurisdictions
 */
export const DEFAULT_JURISDICTION_DEPTH: CircuitDepth = 20;

/**
 * Select circuit depth based on jurisdiction (country code)
 *
 * Uses pre-defined mapping based on electoral population analysis.
 * Falls back to DEFAULT_JURISDICTION_DEPTH for unknown countries.
 *
 * @param countryCode - ISO 3166-1 alpha-3 country code (e.g., "USA", "GBR")
 * @returns Appropriate circuit depth for the jurisdiction
 */
export function selectDepthForJurisdiction(countryCode: string): CircuitDepth {
  const upperCode = countryCode.toUpperCase();
  return COUNTRY_DEPTH_MAPPING[upperCode] ?? DEFAULT_JURISDICTION_DEPTH;
}

/**
 * Get capacity for a given depth
 *
 * @param depth - Circuit depth
 * @returns Maximum number of leaves (addresses) the tree can hold
 */
export function getCapacityForDepth(depth: CircuitDepth): number {
  return 2 ** depth;
}

/**
 * Validate that an address count fits within a given depth
 *
 * @param addressCount - Number of addresses
 * @param depth - Circuit depth
 * @returns true if addressCount ≤ 2^depth
 */
export function validateDepthForCount(addressCount: number, depth: CircuitDepth): boolean {
  return addressCount <= getCapacityForDepth(depth);
}
