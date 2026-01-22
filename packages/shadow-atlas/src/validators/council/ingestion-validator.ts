/**
 * Unified Ingestion Validator
 *
 * ARCHITECTURE:
 * Wires existing validators into a single ingestion pipeline with configurable validation tiers.
 * Zero redundancy - delegates to existing pre-validation, tessellation, and boundary resolvers.
 *
 * VALIDATION TIERS (configurable per-city):
 *   TIER_STRUCTURE  - HTTP fetch + GeoJSON structure (current bulk-ingest behavior)
 *   TIER_SANITY     - + Pre-validation sanity checks (centroid, feature count) [~10ms]
 *   TIER_FULL       - + Tessellation proof (geometric axioms) [~500-2000ms]
 *
 * USAGE:
 *   const validator = new IngestionValidator();
 *   const result = await validator.validate(fips, url, ValidationTier.SANITY);
 *
 * DESIGN PRINCIPLES:
 *   - Fail-fast: Cheaper checks run first
 *   - No redundancy: All geometric logic delegates to existing validators
 *   - Configurable: Tier selection balances speed vs. thoroughness
 *   - Auditable: Full diagnostics at every stage
 */

import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import {
  runSanityChecks,
  type SanityCheckResult,
  type SanityCheckOptions,
} from './pre-validation-sanity.js';
import {
  TessellationProofValidator,
  type TessellationProof,
} from './tessellation-proof.js';
import {
  MunicipalBoundaryResolver,
  type MunicipalBoundary,
  type ResolutionResult,
} from './municipal-boundary.js';
import { EXPECTED_DISTRICT_COUNTS, type DistrictCountRecord, type GovernanceType } from '../../core/registry/district-count-registry.js';
import { AT_LARGE_CITIES } from '../../core/registry/at-large-cities.generated.js';
import { QUARANTINED_PORTALS } from '../../core/registry/quarantined-portals.generated.js';

// ═══════════════════════════════════════════════════════════════════════════
// FIPS CORRECTION REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maps incorrect county FIPS (5-digit) to correct city FIPS (7-digit)
 *
 * ROOT CAUSE: Discovery pipeline sometimes assigns county FIPS codes to city data.
 * This causes sanity checks to fail because the boundary resolver fetches county
 * geometry instead of city geometry.
 *
 * EXAMPLES:
 * - Farmington, NM data mapped to Torrance County (35057) instead of city (3525800)
 * - Hermiston, OR data mapped to Umatilla County (41059) instead of city (4159470)
 * - Honolulu city data mapped to Honolulu County (15003) which includes Northwestern
 *   Hawaiian Islands 1000km away, causing 824km centroid failure
 */
const FIPS_CORRECTIONS: Record<string, { correctFips: string; cityName: string; reason: string }> = {
  // Farmington, NM - Layer says "2022 Farmington City Council Districts"
  // but FIPS assigned to Torrance County (different county entirely, 258km away)
  '35057': {
    correctFips: '3525800',
    cityName: 'Farmington',
    reason: 'County FIPS (Torrance County) used for Farmington city data. Farmington is in San Juan County.',
  },

  // Hermiston, OR - Layer says "City_Council_Wards"
  // but FIPS assigned to Umatilla County (parent county)
  '41059': {
    correctFips: '4133700',
    cityName: 'Hermiston',
    reason: 'County FIPS (Umatilla County) used for Hermiston city council ward data.',
  },

  // Honolulu, HI - Consolidated city-county, but county boundary includes
  // Northwestern Hawaiian Islands 1000km away. Use Urban Honolulu CDP FIPS.
  '15003': {
    correctFips: '1571550',
    cityName: 'Honolulu',
    reason: 'County FIPS includes Northwestern Hawaiian Islands 1000km away. Use Urban Honolulu CDP.',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION TIERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validation tier determines how deeply to validate before accepting ingestion
 */
export enum ValidationTier {
  /** HTTP fetch + GeoJSON structure only (~1-2s) */
  STRUCTURE = 'structure',

  /** + Pre-validation sanity checks (~10ms additional) */
  SANITY = 'sanity',

  /** + Full tessellation proof (~500-2000ms additional) */
  FULL = 'full',
}

/**
 * Authority level for data sources (0-5 scale)
 * Higher = more trustworthy
 */
export enum AuthorityLevel {
  UNKNOWN = 0,
  COMMUNITY_MAINTAINED = 1,
  COMMERCIAL_AGGREGATOR = 2,
  MUNICIPAL_OFFICIAL = 3,
  STATE_MANDATE = 4,
  FEDERAL_MANDATE = 5,
}

// ═══════════════════════════════════════════════════════════════════════════
// RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Failure stage indicates where validation stopped
 */
export type IngestionFailureStage =
  | 'fetch_error'
  | 'structure_invalid'
  | 'quarantined'
  | 'at_large_city'
  | 'sanity_check_fail'
  | 'boundary_fail'
  | 'tessellation_fail'
  | null;

/**
 * Complete ingestion validation result
 */
export interface IngestionValidationResult {
  /** Whether the candidate passed all requested validation tiers */
  readonly valid: boolean;

  /** Where validation failed (null if valid) */
  readonly failureStage: IngestionFailureStage;

  /** Validation tier that was requested */
  readonly requestedTier: ValidationTier;

  /** Validation tier that was actually reached */
  readonly achievedTier: ValidationTier | null;

  /** City identification */
  readonly city: {
    readonly fips: string;
    readonly name: string | null;
    readonly state: string | null;
  };

  /** Feature count diagnostics */
  readonly featureCount: {
    readonly actual: number;
    readonly expected: number | null;
    readonly governanceType: GovernanceType | 'unknown';
  };

  /** Authority level of the data source */
  readonly authorityLevel: AuthorityLevel;

  /** Sanity check results (if SANITY tier or higher was reached) */
  readonly sanityCheck: SanityCheckResult | null;

  /** Tessellation proof (if FULL tier was reached) */
  readonly tessellationProof: TessellationProof | null;

  /** Municipal boundary (if resolved) */
  readonly boundary: MunicipalBoundary | null;

  /** Human-readable status message */
  readonly status: string;

  /** Actionable remediation guidance (if failed) */
  readonly remediation: string | null;

  /** FIPS correction applied (if any) */
  readonly fipsCorrection: {
    readonly originalFips: string;
    readonly correctedFips: string;
    readonly reason: string;
  } | null;

  /** Processing time in milliseconds */
  readonly processingTimeMs: number;
}

/**
 * Options for ingestion validation
 */
export interface IngestionValidationOptions {
  /** Validation tier (default: SANITY) */
  tier?: ValidationTier;

  /** Sanity check thresholds (uses defaults if not provided) */
  sanityOptions?: SanityCheckOptions;

  /** Timeout for HTTP fetch in milliseconds (default: 30000) */
  fetchTimeoutMs?: number;

  /** Skip quarantine check (default: false) */
  skipQuarantineCheck?: boolean;

  /** Skip at-large check (default: false) */
  skipAtLargeCheck?: boolean;

  /** Authority level of the source (default: UNKNOWN) */
  authorityLevel?: AuthorityLevel;
}

// ═══════════════════════════════════════════════════════════════════════════
// INGESTION VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Unified ingestion validator that wires existing validation components
 */
export class IngestionValidator {
  private readonly boundaryResolver: MunicipalBoundaryResolver;
  private readonly tessellationValidator: TessellationProofValidator;

  constructor() {
    this.boundaryResolver = new MunicipalBoundaryResolver();
    this.tessellationValidator = new TessellationProofValidator();
  }

  /**
   * Validate a candidate data source for ingestion
   *
   * @param fips - 7-digit Census PLACE FIPS code
   * @param url - Direct download URL for district GeoJSON
   * @param options - Validation options
   * @returns Validation result with diagnostics
   */
  async validate(
    fips: string,
    url: string,
    options: IngestionValidationOptions = {}
  ): Promise<IngestionValidationResult> {
    const startTime = Date.now();
    const tier = options.tier ?? ValidationTier.SANITY;
    const authorityLevel = options.authorityLevel ?? AuthorityLevel.UNKNOWN;

    // ─────────────────────────────────────────────────────────────────────
    // FIPS CORRECTION (pre-gate)
    // ─────────────────────────────────────────────────────────────────────
    const originalFips = fips;
    let fipsCorrection: IngestionValidationResult['fipsCorrection'] = null;

    const correction = FIPS_CORRECTIONS[fips];
    if (correction) {
      fips = correction.correctFips;
      fipsCorrection = {
        originalFips,
        correctedFips: correction.correctFips,
        reason: correction.reason,
      };
    }

    // Initialize result template
    const baseResult = {
      requestedTier: tier,
      authorityLevel,
      city: { fips, name: null as string | null, state: null as string | null },
      featureCount: {
        actual: 0,
        expected: null as number | null,
        governanceType: 'unknown' as GovernanceType | 'unknown',
      },
      sanityCheck: null as SanityCheckResult | null,
      tessellationProof: null as TessellationProof | null,
      boundary: null as MunicipalBoundary | null,
      fipsCorrection,
    };

    // ─────────────────────────────────────────────────────────────────────
    // GATE 0: Registry Checks (instant)
    // ─────────────────────────────────────────────────────────────────────

    // Check quarantine
    if (!options.skipQuarantineCheck && QUARANTINED_PORTALS[fips]) {
      const quarantined = QUARANTINED_PORTALS[fips];
      return this.fail(baseResult, 'quarantined', startTime, tier, null, {
        status: `City ${fips} is quarantined: ${quarantined.quarantineReason}`,
        remediation: `Resolve quarantine issue before ingestion. Pattern: ${quarantined.matchedPattern}`,
        city: { fips, name: quarantined.cityName, state: quarantined.state },
      });
    }

    // Check at-large registry
    if (!options.skipAtLargeCheck && AT_LARGE_CITIES[fips]) {
      const atLarge = AT_LARGE_CITIES[fips];
      return this.fail(baseResult, 'at_large_city', startTime, tier, null, {
        status: `City ${fips} uses at-large elections - no geographic districts`,
        remediation: `At-large cities don't need district data. Council size: ${atLarge.councilSize}`,
        city: { fips, name: atLarge.cityName, state: atLarge.state },
        featureCount: {
          actual: 0,
          expected: null,
          governanceType: 'at-large',
        },
      });
    }

    // Get expected district count
    const registryRecord = EXPECTED_DISTRICT_COUNTS[fips];
    const expectedCount = registryRecord?.expectedDistrictCount ?? null;
    const governanceType = registryRecord?.governanceType ?? 'unknown';

    if (registryRecord) {
      baseResult.city = {
        fips,
        name: registryRecord.cityName,
        state: registryRecord.state,
      };
    }

    baseResult.featureCount = {
      actual: 0,
      expected: expectedCount,
      governanceType,
    };

    // ─────────────────────────────────────────────────────────────────────
    // TIER 1: Structure Validation (HTTP fetch + GeoJSON parse)
    // ─────────────────────────────────────────────────────────────────────

    let districts: FeatureCollection<Polygon | MultiPolygon>;
    try {
      districts = await this.fetchDistricts(url, options.fetchTimeoutMs ?? 30000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown fetch error';
      return this.fail(baseResult, 'fetch_error', startTime, tier, null, {
        status: `Failed to fetch district GeoJSON: ${message}`,
        remediation: 'Check URL validity and network connectivity',
      });
    }

    // Validate structure
    const structureValidation = this.validateStructure(districts);
    if (!structureValidation.valid) {
      const errorResult = structureValidation as { valid: false; error: string; featureCount: number };
      return this.fail(baseResult, 'structure_invalid', startTime, tier, null, {
        status: errorResult.error,
        remediation: 'Fix GeoJSON structure issues',
        featureCount: { ...baseResult.featureCount, actual: errorResult.featureCount },
      });
    }

    baseResult.featureCount = {
      ...baseResult.featureCount,
      actual: structureValidation.featureCount,
    };

    // TIER_STRUCTURE complete - return if that's all that was requested
    if (tier === ValidationTier.STRUCTURE) {
      return this.pass(baseResult, startTime, ValidationTier.STRUCTURE, {
        status: `Structure validation passed: ${structureValidation.featureCount} features`,
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // TIER 2: Sanity Checks (pre-validation)
    // ─────────────────────────────────────────────────────────────────────

    // Sanity checks require municipal boundary
    let boundaryResult: ResolutionResult;
    try {
      boundaryResult = await this.boundaryResolver.resolve(fips);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown boundary error';
      return this.fail(baseResult, 'boundary_fail', startTime, tier, ValidationTier.STRUCTURE, {
        status: `Failed to resolve municipal boundary: ${message}`,
        remediation: 'Check FIPS code validity or TIGER API availability',
      });
    }

    if (!boundaryResult.success || !boundaryResult.boundary) {
      return this.fail(baseResult, 'boundary_fail', startTime, tier, ValidationTier.STRUCTURE, {
        status: `Municipal boundary not found: ${boundaryResult.error}`,
        remediation: 'Verify FIPS code matches a valid Census PLACE',
        city: boundaryResult.boundary
          ? { fips, name: boundaryResult.boundary.name, state: boundaryResult.boundary.stateAbbr }
          : baseResult.city,
      });
    }

    const boundary = boundaryResult.boundary;
    baseResult.boundary = boundary;
    baseResult.city = { fips, name: boundary.name, state: boundary.stateAbbr };

    // Run sanity checks (uses existing pre-validation-sanity.ts)
    const sanityResult = runSanityChecks(
      districts,
      boundary,
      expectedCount ?? structureValidation.featureCount, // Use actual count if no expected
      options.sanityOptions
    );

    baseResult.sanityCheck = sanityResult;

    if (!sanityResult.passed) {
      return this.fail(baseResult, 'sanity_check_fail', startTime, tier, ValidationTier.STRUCTURE, {
        status: `Pre-validation failed: ${sanityResult.failReason}`,
        remediation: this.getSanityRemediation(sanityResult),
      });
    }

    // TIER_SANITY complete - return if that's all that was requested
    if (tier === ValidationTier.SANITY) {
      return this.pass(baseResult, startTime, ValidationTier.SANITY, {
        status: `Sanity checks passed: ${structureValidation.featureCount} features, centroid ${sanityResult.checks.centroidProximity.distanceKm.toFixed(1)}km from city`,
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // TIER 3: Tessellation Proof (full geometric validation)
    // ─────────────────────────────────────────────────────────────────────

    const proof = this.tessellationValidator.prove(
      districts,
      boundary.geometry,
      expectedCount ?? structureValidation.featureCount,
      boundary.landAreaSqM,
      undefined, // authoritativeDistrictArea
      boundary.waterAreaSqM,
      fips
    );

    baseResult.tessellationProof = proof;

    if (!proof.valid) {
      return this.fail(baseResult, 'tessellation_fail', startTime, tier, ValidationTier.SANITY, {
        status: `Tessellation proof failed: ${proof.reason}`,
        remediation: this.getTessellationRemediation(proof),
      });
    }

    // TIER_FULL complete
    return this.pass(baseResult, startTime, ValidationTier.FULL, {
      status: `Full validation passed: ${proof.diagnostics.coverageRatio.toFixed(1)}% coverage, ${proof.diagnostics.districtCount} districts`,
    });
  }

  /**
   * Batch validate multiple candidates
   *
   * @param candidates - Array of { fips, url } pairs
   * @param options - Validation options (applied to all)
   * @param concurrency - Max concurrent validations (default: 5)
   * @returns Map of FIPS → validation result
   */
  async validateBatch(
    candidates: Array<{ fips: string; url: string; authorityLevel?: AuthorityLevel }>,
    options: Omit<IngestionValidationOptions, 'authorityLevel'> = {},
    concurrency = 5
  ): Promise<Map<string, IngestionValidationResult>> {
    const results = new Map<string, IngestionValidationResult>();
    const queue = [...candidates];

    const worker = async () => {
      while (queue.length > 0) {
        const candidate = queue.shift();
        if (!candidate) break;

        const result = await this.validate(candidate.fips, candidate.url, {
          ...options,
          authorityLevel: candidate.authorityLevel,
        });
        results.set(candidate.fips, result);
      }
    };

    // Run workers in parallel
    await Promise.all(Array(Math.min(concurrency, candidates.length)).fill(null).map(worker));

    return results;
  }

  /**
   * Generate batch validation summary
   */
  summarizeBatch(results: Map<string, IngestionValidationResult>): BatchValidationSummary {
    const entries = Array.from(results.values());

    const failuresByStage: Record<string, number> = {};
    const failedCities: Array<{ fips: string; name: string | null; stage: string; reason: string }> = [];

    for (const result of entries) {
      if (!result.valid && result.failureStage) {
        failuresByStage[result.failureStage] = (failuresByStage[result.failureStage] || 0) + 1;
        failedCities.push({
          fips: result.city.fips,
          name: result.city.name,
          stage: result.failureStage,
          reason: result.status,
        });
      }
    }

    const passed = entries.filter((r) => r.valid);
    const avgProcessingTime = entries.reduce((sum, r) => sum + r.processingTimeMs, 0) / entries.length;

    return {
      totalCandidates: entries.length,
      passed: passed.length,
      failed: entries.length - passed.length,
      passRate: (passed.length / entries.length) * 100,
      failuresByStage,
      failedCities,
      avgProcessingTimeMs: Math.round(avgProcessingTime),
      byTier: {
        structure: entries.filter((r) => r.achievedTier === ValidationTier.STRUCTURE).length,
        sanity: entries.filter((r) => r.achievedTier === ValidationTier.SANITY).length,
        full: entries.filter((r) => r.achievedTier === ValidationTier.FULL).length,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════

  private async fetchDistricts(
    url: string,
    timeoutMs: number
  ): Promise<FeatureCollection<Polygon | MultiPolygon>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      return data as FeatureCollection<Polygon | MultiPolygon>;
    } finally {
      clearTimeout(timeout);
    }
  }

  private validateStructure(
    data: unknown
  ): { valid: true; featureCount: number } | { valid: false; error: string; featureCount: number } {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Response is not a valid object', featureCount: 0 };
    }

    const fc = data as FeatureCollection;
    if (fc.type !== 'FeatureCollection') {
      return { valid: false, error: `Expected FeatureCollection, got ${fc.type}`, featureCount: 0 };
    }

    if (!Array.isArray(fc.features)) {
      return { valid: false, error: 'features is not an array', featureCount: 0 };
    }

    const featureCount = fc.features.length;
    if (featureCount === 0) {
      return { valid: false, error: 'FeatureCollection is empty', featureCount: 0 };
    }

    if (featureCount > 100) {
      return { valid: false, error: `Too many features (${featureCount}) - likely wrong dataset`, featureCount };
    }

    // Check at least one feature has geometry
    const hasGeometry = fc.features.some((f: Feature) => f.geometry?.type);
    if (!hasGeometry) {
      return { valid: false, error: 'No features have valid geometry', featureCount };
    }

    return { valid: true, featureCount };
  }

  private getSanityRemediation(result: SanityCheckResult): string {
    if (!result.checks.centroidProximity.passed) {
      return `District centroid is ${result.checks.centroidProximity.distanceKm.toFixed(0)}km from city center (threshold: ${result.checks.centroidProximity.threshold}km). This data may be for a different city/region.`;
    }
    if (!result.checks.featureCount.passed) {
      const ratio = result.checks.featureCount.ratio;
      return `Feature count ratio is ${ratio.toFixed(1)}x (${result.checks.featureCount.actual} actual vs ${result.checks.featureCount.expected} expected). Check if this is neighborhood/precinct data instead of council districts.`;
    }
    return 'Unknown sanity check failure';
  }

  private getTessellationRemediation(proof: TessellationProof): string {
    switch (proof.failedAxiom) {
      case 'containment':
        return `${((proof.diagnostics.outsideBoundaryArea / proof.diagnostics.districtUnionArea) * 100).toFixed(1)}% of district area is outside city boundary. Check for boundary vintage mismatch or wrong city data.`;
      case 'exclusivity':
        return `Districts overlap by ${proof.diagnostics.totalOverlapArea.toLocaleString()} sq meters. Check for topology errors or duplicate features.`;
      case 'exhaustivity':
        return `Districts cover only ${(proof.diagnostics.coverageRatio * 100).toFixed(1)}% of city (need 85%+). Missing ${proof.diagnostics.uncoveredArea.toLocaleString()} sq meters.`;
      case 'cardinality':
        return `Expected ${proof.diagnostics.expectedCount} districts, got ${proof.diagnostics.districtCount}. Verify correct layer and expected count.`;
      default:
        return proof.reason ?? 'Unknown tessellation failure';
    }
  }

  private fail(
    baseResult: Partial<IngestionValidationResult>,
    stage: IngestionFailureStage,
    startTime: number,
    requestedTier: ValidationTier,
    achievedTier: ValidationTier | null,
    overrides: Partial<IngestionValidationResult>
  ): IngestionValidationResult {
    return {
      valid: false,
      failureStage: stage,
      requestedTier,
      achievedTier,
      city: baseResult.city ?? { fips: '', name: null, state: null },
      featureCount: baseResult.featureCount ?? { actual: 0, expected: null, governanceType: 'unknown' },
      authorityLevel: baseResult.authorityLevel ?? AuthorityLevel.UNKNOWN,
      sanityCheck: baseResult.sanityCheck ?? null,
      tessellationProof: baseResult.tessellationProof ?? null,
      boundary: baseResult.boundary ?? null,
      status: 'Validation failed',
      remediation: null,
      fipsCorrection: baseResult.fipsCorrection ?? null,
      processingTimeMs: Date.now() - startTime,
      ...overrides,
    };
  }

  private pass(
    baseResult: Partial<IngestionValidationResult>,
    startTime: number,
    achievedTier: ValidationTier,
    overrides: Partial<IngestionValidationResult>
  ): IngestionValidationResult {
    return {
      valid: true,
      failureStage: null,
      requestedTier: baseResult.requestedTier ?? achievedTier,
      achievedTier,
      city: baseResult.city ?? { fips: '', name: null, state: null },
      featureCount: baseResult.featureCount ?? { actual: 0, expected: null, governanceType: 'unknown' },
      authorityLevel: baseResult.authorityLevel ?? AuthorityLevel.UNKNOWN,
      sanityCheck: baseResult.sanityCheck ?? null,
      tessellationProof: baseResult.tessellationProof ?? null,
      boundary: baseResult.boundary ?? null,
      status: 'Validation passed',
      remediation: null,
      fipsCorrection: baseResult.fipsCorrection ?? null,
      processingTimeMs: Date.now() - startTime,
      ...overrides,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCH SUMMARY TYPE
// ═══════════════════════════════════════════════════════════════════════════

export interface BatchValidationSummary {
  totalCandidates: number;
  passed: number;
  failed: number;
  passRate: number;
  failuresByStage: Record<string, number>;
  failedCities: Array<{
    fips: string;
    name: string | null;
    stage: string;
    reason: string;
  }>;
  avgProcessingTimeMs: number;
  byTier: {
    structure: number;
    sanity: number;
    full: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVENIENCE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate a single candidate for ingestion
 */
export async function validateForIngestion(
  fips: string,
  url: string,
  options?: IngestionValidationOptions
): Promise<IngestionValidationResult> {
  const validator = new IngestionValidator();
  return validator.validate(fips, url, options);
}

/**
 * Validate a batch of candidates for ingestion
 */
export async function validateBatchForIngestion(
  candidates: Array<{ fips: string; url: string; authorityLevel?: AuthorityLevel }>,
  options?: Omit<IngestionValidationOptions, 'authorityLevel'>,
  concurrency?: number
): Promise<{ results: Map<string, IngestionValidationResult>; summary: BatchValidationSummary }> {
  const validator = new IngestionValidator();
  const results = await validator.validateBatch(candidates, options, concurrency);
  const summary = validator.summarizeBatch(results);
  return { results, summary };
}
