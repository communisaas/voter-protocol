/**
 * Country Provider Types
 *
 * Types for the unified CountryProvider abstraction that merges
 * boundary extraction, officials ingestion, cell map construction,
 * and 4-layer validation into a single provider per country.
 *
 * These types are the shared contract between:
 * - Country-specific provider implementations (AU, CA, UK, NZ)
 * - The unified hydrate-country CLI
 * - The 4-layer validation pipeline
 * - The Tree 2 cell map builder
 *
 * @see country-provider.ts for the abstract class
 * @see memory/country-provider-unification.md for architectural spec
 */

import { z } from 'zod';
import type { AuthorityLevel } from './base-provider.js';
import type { CellDistrictMapping } from '../../tree-builder.js';

// Re-export for convenience — callers get everything from one import
export type { CellDistrictMapping };

// ============================================================================
// Source Chain Pattern
// ============================================================================

/**
 * Data source configuration for source chain fallback.
 *
 * Each country declares sources in priority order. The engine tries in
 * sequence, stops at first success. This replaces feature flags for batch
 * ingestion — adding a country = adding a provider with its source chain.
 */
export interface SourceConfig {
  /** Human-readable source name (e.g., 'ourcommons.ca XML', 'Represent API') */
  readonly name: string;

  /** Base endpoint URL */
  readonly endpoint: string;

  /** Authority level of this source */
  readonly authority: AuthorityLevel;

  /** Priority order — lower number = tried first */
  readonly priority: number;
}

/**
 * Record of a single source attempt during chain execution
 */
export interface SourceAttempt {
  readonly source: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly recordCount?: number;
  readonly error?: string;
}

// ============================================================================
// Officials Types
// ============================================================================

/**
 * Base official record — all country-specific officials extend this.
 *
 * Maps to the common fields across federal_members, canada_mps,
 * uk_mps, au_mps, and nz_mps SQLite tables.
 */
export interface OfficialRecord {
  /** Primary key (bioguide_id, parliament_id, aph_id, etc.) */
  readonly id: string;

  /** Full display name */
  readonly name: string;

  /** First name (if parseable) */
  readonly firstName?: string;

  /** Last name (if parseable) */
  readonly lastName?: string;

  /** Political party */
  readonly party: string;

  /** Chamber (for bicameral: 'house', 'senate'; for unicameral: undefined) */
  readonly chamber?: string;

  /** Constituency/riding/division/electorate name */
  readonly boundaryName: string;

  /** Resolved boundary code from Layer 3 (null only for list MPs) */
  readonly boundaryCode: string | null;

  /** Contact email */
  readonly email?: string;

  /** Office phone */
  readonly phone?: string;

  /** Office address (used for PIP verification) */
  readonly officeAddress?: string;

  /** Official website URL */
  readonly websiteUrl?: string;

  /** Photo URL */
  readonly photoUrl?: string;

  /** Currently serving */
  readonly isActive: boolean;
}

/**
 * Result from extractOfficials()
 */
export interface OfficialsExtractionResult<TOfficial extends OfficialRecord = OfficialRecord> {
  readonly country: string;
  readonly officials: readonly TOfficial[];
  readonly expectedCount: number;
  readonly actualCount: number;
  readonly matched: boolean;
  readonly confidence: number;

  /** Source chain execution log */
  readonly sources: readonly SourceAttempt[];

  readonly extractedAt: Date;
  readonly durationMs: number;
}

// ============================================================================
// Cell Map Types (Tree 2)
// ============================================================================

/**
 * Statistical geography unit type per country.
 * These are the Census-equivalent units used for Tree 2 cell maps.
 */
export type StatisticalUnitType =
  | 'census-tract'        // US: ~85,000 tracts
  | 'dissemination-area'  // Canada: ~56,000 DAs (Statistics Canada)
  | 'output-area'         // UK: ~188,000 OAs (ONS Census geography)
  | 'sa1'                 // Australia: ~62,000 SA1s (ABS ASGS)
  | 'meshblock';          // NZ: ~53,000 meshblocks (Stats NZ)

/**
 * Result from buildCellMap()
 */
export interface CellMapResult {
  readonly country: string;
  readonly statisticalUnit: StatisticalUnitType;
  readonly cellCount: number;
  readonly root: bigint;
  readonly depth: number;
  readonly mappings: readonly CellDistrictMapping[];
  readonly durationMs: number;
}

// ============================================================================
// Validation Types (4-Layer Pipeline)
// ============================================================================

// --- Layer 1: Source Authority ---

export interface SourceAssessment {
  readonly name: string;
  readonly authority: AuthorityLevel;
  readonly vintage: number;
  readonly type: 'boundary' | 'officials';
}

// --- Layer 2: Schema & Count Validation ---

export interface SchemaError {
  readonly field: string;
  readonly message: string;
  readonly recordId?: string;
}

// --- Layer 3: Boundary Code Resolution ---

export type OfficialDiagnosticType =
  | 'UNMATCHED_OFFICIAL'   // Official's constituency matches no boundary
  | 'AMBIGUOUS_MATCH'      // Official name matches multiple boundaries
  | 'CODE_MISMATCH';       // Official's pre-existing code conflicts with boundary

export interface OfficialDiagnostic {
  readonly type: OfficialDiagnosticType;
  readonly officialId: string;
  readonly officialName: string;
  readonly boundaryName: string;
  readonly details?: string;
}

// --- Layer 4: PIP Verification (Diagnostic Only) ---

export type PIPDiagnosticType =
  | 'PIP_CONFIRMED'         // Office address geocodes within claimed boundary
  | 'PIP_MISMATCH'          // Office address geocodes outside boundary
  | 'PIP_SKIP_NO_ADDRESS'   // No office address available (common for NZ list MPs)
  | 'PIP_SKIP_GEOCODE_FAIL' // Address could not be geocoded
  | 'PIP_SECONDARY_OFFICE'; // Multiple offices, at least one in-boundary

export interface PIPDiagnostic {
  readonly type: PIPDiagnosticType;
  readonly officialId: string;
  readonly officialName: string;
  readonly boundaryCode: string;
  readonly address?: string;
  readonly coordinates?: { readonly lat: number; readonly lng: number };
}

// --- Composite ValidationReport ---

export interface ValidationReport {
  readonly country: string;
  readonly timestamp: Date;
  readonly layers: {
    readonly sourceAuthority: {
      readonly confidence: number;
      readonly sources: readonly SourceAssessment[];
    };
    readonly schemaValidation: {
      readonly passed: boolean;
      readonly errors: readonly SchemaError[];
      readonly recordCount: number;
      readonly expectedCount: number;
    };
    readonly codeResolution: {
      readonly resolved: number;
      readonly unmatched: readonly OfficialDiagnostic[];
      readonly vacant: readonly string[];
      readonly ambiguous: readonly OfficialDiagnostic[];
    };
    readonly pipVerification: {
      readonly confirmed: number;
      readonly mismatched: readonly PIPDiagnostic[];
      readonly skipped: number;
      readonly total: number;
    };
  };
  /** Weighted composite: authority 25%, schema 25%, codes 25%, PIP 25% */
  readonly overallConfidence: number;
  /** true only if schema layer fails 80% threshold */
  readonly blocking: boolean;
}

// ============================================================================
// Country-Specific Expected Counts
// ============================================================================

export interface ChamberCount {
  readonly count: number;
  readonly chamber: string;
  readonly note: string;
  /** If true, count is approximate (e.g., NZ list MPs vary by election) */
  readonly approximate?: boolean;
}

export const EXPECTED_OFFICIAL_COUNTS: Readonly<Record<string, readonly ChamberCount[]>> = {
  US: [
    { count: 435, chamber: 'house', note: 'House of Representatives' },
    { count: 100, chamber: 'senate', note: 'Senate' },
    { count: 6, chamber: 'house', note: 'Non-voting delegates' },
  ],
  CA: [
    { count: 338, chamber: 'house-of-commons', note: 'House of Commons' },
  ],
  GB: [
    { count: 650, chamber: 'house-of-commons', note: 'House of Commons' },
  ],
  AU: [
    { count: 151, chamber: 'house-of-representatives', note: 'House of Representatives' },
  ],
  NZ: [
    { count: 65, chamber: 'general', note: 'General electorate MPs' },
    { count: 7, chamber: 'maori', note: 'Māori electorate MPs' },
    { count: 51, chamber: 'list', note: 'List MPs', approximate: true },
  ],
};

// ============================================================================
// Geocoder / PIP Function Types
// ============================================================================

/** Geocoding function — resolves an address to coordinates */
export type GeocoderFn = (address: string) => Promise<{ lat: number; lng: number } | null>;

/** Point-in-polygon check — tests if a point falls within a boundary */
export type PIPCheckFn = (point: { lat: number; lng: number }, boundaryCode: string) => boolean;

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Base official schema — shared fields validated for every country.
 * Country-specific schemas extend this with additional fields.
 */
export const BaseOfficialSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  party: z.string().min(1),
  chamber: z.string().optional(),
  boundaryName: z.string(),
  boundaryCode: z.string().nullable(),
  email: z.string().optional(),
  phone: z.string().optional(),
  officeAddress: z.string().optional(),
  websiteUrl: z.string().optional(),
  photoUrl: z.string().optional(),
  isActive: z.boolean(),
});

/** US Federal Member */
export const USFederalMemberSchema = BaseOfficialSchema.extend({
  bioguideId: z.string().regex(/^[A-Z]\d{6}$/),
  chamber: z.enum(['house', 'senate']),
  state: z.string().length(2),
  district: z.string().optional(),
  senateClass: z.number().int().min(1).max(3).optional(),
  stateFips: z.string().length(2),
  cdGeoid: z.string().optional(),
});

/** Canadian MP */
export const CanadianMPSchema = BaseOfficialSchema.extend({
  parliamentId: z.string().min(1),
  ridingCode: z.string().regex(/^\d{5}$/),
  ridingName: z.string().min(1),
  ridingNameFr: z.string().optional(),
  province: z.string().length(2),
  nameFr: z.string().optional(),
});

/** UK MP */
export const UKMPSchema = BaseOfficialSchema.extend({
  parliamentId: z.number().int().positive(),
  constituencyName: z.string().min(1),
  constituencyOnsCode: z.string().optional(),
});

/** Australian MP */
export const AustralianMPSchema = BaseOfficialSchema.extend({
  aphId: z.string().min(1),
  divisionName: z.string().min(1),
  divisionCode: z.string().optional(),
  state: z.enum(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']),
});

/** NZ MP */
export const NZMPSchema = BaseOfficialSchema.extend({
  parliamentId: z.string().min(1),
  electorateName: z.string().optional(),
  electorateCode: z.string().optional(),
  electorateType: z.enum(['general', 'maori', 'list']),
});
