/**
 * @deprecated Import from './provenance/provenance-writer.js' instead
 * This file is a backward-compatibility shim and will be removed in v2.0
 *
 * MIGRATION PATH:
 * - appendProvenance() → ProvenanceWriter.append() (class-based API)
 * - CompactDiscoveryEntry interface → same in new location
 * - ProvenanceRecord type → same in new location
 * - BlockerCode enum → blocker codes are now strings (enum removed)
 * - AuthorityLevel enum → authority levels are now numbers 0-5 (enum removed)
 * - GranularityTier enum → granularity tiers are now numbers 0-4 (enum removed)
 *
 * NEW FEATURES in ./provenance/:
 * - Staging buffer for zero-contention writes
 * - Query interface with filters
 * - FIPS-based sharding (50-state parallelism)
 * - Statistics and analytics
 */

// Re-export types from new location
export type {
  ProvenanceRecord,
  CompactDiscoveryEntry,
  ProvenanceFilter,
} from './provenance/provenance-writer.js';

// Re-export the new class and singleton
export { ProvenanceWriter, provenanceWriter } from './provenance/provenance-writer.js';

/**
 * Legacy function wrapper for backward compatibility
 * Maps old appendProvenance() to new ProvenanceWriter.append()
 */
import { provenanceWriter } from './provenance/provenance-writer.js';
import type { CompactDiscoveryEntry } from './provenance/provenance-writer.js';

/**
 * @deprecated Use ProvenanceWriter.append() instead
 * This function is maintained for backward compatibility only.
 */
export async function appendProvenance(entry: CompactDiscoveryEntry): Promise<void> {
  // Use new class-based API with staging disabled for backward compatibility
  await provenanceWriter.append(entry, { staging: false });
}

/**
 * Legacy enums (deprecated - use string/number literals instead)
 */

/**
 * @deprecated Use string literals instead (e.g., 'no-council-layer')
 * Blocker codes from PROVENANCE-SPEC.md
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
 * @deprecated Use number literals 0-5 instead
 * Authority levels from PROVENANCE-SPEC.md
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
 * @deprecated Use number literals 0-4 instead
 * Granularity tiers from PROVENANCE-SPEC.md
 */
export enum GranularityTier {
  PRECINCT = 0,
  COUNCIL_DISTRICT = 1,
  MUNICIPAL_BOUNDARY = 2,
  COUNTY_SUBDIVISION = 3,
  COUNTY = 4,
}
