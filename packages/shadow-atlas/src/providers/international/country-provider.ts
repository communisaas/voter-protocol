/**
 * Unified Country Provider
 *
 * Extends BaseInternationalProvider with officials extraction, cell map
 * construction, and 4-layer validation. One provider per country produces
 * boundaries, officials, cell maps, and validation diagnostics through
 * a single abstraction.
 *
 * ARCHITECTURE:
 * ```
 * CountryProvider<TLayer, TBoundary, TOfficial>
 *   extends BaseInternationalProvider<TLayer, TBoundary>
 *
 * Existing:  extractAll()        → boundaries → R-tree (PIP lookup)
 * New:       extractOfficials()  → officials with resolved boundary codes
 * New:       buildCellMap()      → statistical geography → SMT root (Tree 2)
 * New:       validate()          → 4-layer diagnostic report
 * ```
 *
 * SOURCE CHAIN PATTERN (not feature flags):
 * Each country declares data sources in priority order. The engine tries
 * in sequence, stops at first success. Graceful degradation, no flag
 * management. Adding a country = adding a provider with its source chain.
 *
 * @see country-provider-types.ts for all type definitions
 * @see memory/country-provider-unification.md for architectural spec
 */

import {
  BaseInternationalProvider,
  type InternationalBoundary,
  type AuthorityLevel,
} from './base-provider.js';
import type {
  OfficialRecord,
  OfficialsExtractionResult,
  CellMapResult,
  StatisticalUnitType,
  ValidationReport,
  SourceConfig,
  SourceAttempt,
  SourceAssessment,
  OfficialDiagnostic,
  PIPDiagnostic,
  GeocoderFn,
  PIPCheckFn,
} from './country-provider-types.js';
import { InternationalBoundarySchema } from './country-provider-types.js';
import { logger } from '../../core/utils/logger.js';

// ============================================================================
// Abstract Country Provider
// ============================================================================

/**
 * Unified Country Provider — one provider per country.
 *
 * Inherits boundary extraction from BaseInternationalProvider.
 * Adds officials extraction, cell map construction, and validation.
 *
 * Country-specific providers (AU, CA, UK, NZ) extend this class and
 * implement the abstract methods with their data source logic.
 *
 * @typeParam TLayerType - Boundary layer discriminator (e.g., 'federal', 'parliamentary')
 * @typeParam TBoundary - Country-specific boundary type
 * @typeParam TOfficial - Country-specific official type
 */
export abstract class CountryProvider<
  TLayerType extends string,
  TBoundary extends InternationalBoundary,
  TOfficial extends OfficialRecord
> extends BaseInternationalProvider<TLayerType, TBoundary> {

  /** Officials data sources in priority order (source chain) */
  abstract readonly officialsSources: readonly SourceConfig[];

  /** Expected official count per chamber */
  abstract readonly expectedOfficialCounts: ReadonlyMap<string, number>;

  /** Statistical geography unit type for Tree 2 cell maps */
  abstract readonly statisticalUnit: StatisticalUnitType;

  // ==========================================================================
  // Abstract Methods — Country Providers Implement These
  // ==========================================================================

  /**
   * Extract officials with resolved boundary codes.
   *
   * The boundary index is passed IN — code resolution happens at extraction
   * time, never deferred. Every official either resolves to a boundary code
   * or produces a diagnostic. No NULL boundary codes after this method
   * (except list MPs with no constituency).
   *
   * Uses source chain pattern internally: tries data sources in priority
   * order via {@link trySourceChain}.
   *
   * @param boundaryIndex - Map of boundary name → boundary object
   * @returns Officials with resolved codes + source chain execution log
   */
  abstract extractOfficials(
    boundaryIndex: Map<string, TBoundary>
  ): Promise<OfficialsExtractionResult<TOfficial>>;

  /**
   * Build cell map for Tree 2 (international Census equivalent).
   *
   * Each country's statistical geography (dissemination areas, output areas,
   * SA1s, meshblocks) maps cells to district slots. The output feeds into
   * `buildCellMapTree()` from tree-builder.ts.
   *
   * Pipeline:
   * 1. Download statistical geography boundaries (one-time, cached)
   * 2. For each unit: determine which electoral boundary contains its centroid
   * 3. Build 24-slot district array (slot assignment matches US convention)
   * 4. Return mappings for SMT construction
   *
   * @param boundaries - Electoral boundaries for centroid containment
   * @returns Cell-district mappings ready for tree builder
   */
  abstract buildCellMap(
    boundaries: TBoundary[]
  ): Promise<CellMapResult>;

  /**
   * Run 4-layer validation pipeline.
   *
   * All layers are diagnostic (flag issues, never hard-fail ingestion)
   * except Layer 2 (schema) which hard-fails below 80% threshold.
   *
   * Layers:
   * 1. Source Authority — confidence scoring via calculateConfidence()
   * 2. Schema & Count — zod validation + expected count comparison
   * 3. Boundary Code Resolution — name-match officials against boundary index
   * 4. PIP Verification — geocode office addresses, check against boundaries
   *
   * Layer 4 requires external services (geocoder + R-tree). If not provided,
   * PIP verification is skipped with all officials marked as skipped.
   *
   * @param boundaries - Extracted boundaries
   * @param officials - Extracted officials (with resolved boundary codes)
   * @param geocoder - Optional geocoder for Layer 4 PIP verification
   * @param pipCheck - Optional point-in-polygon check function
   * @returns Diagnostic report with per-layer results
   */
  abstract validate(
    boundaries: TBoundary[],
    officials: TOfficial[],
    geocoder?: GeocoderFn,
    pipCheck?: PIPCheckFn,
  ): Promise<ValidationReport>;

  // ==========================================================================
  // Source Chain Engine (Protected)
  // ==========================================================================

  /**
   * Try data sources in priority order, stop at first success.
   *
   * This is the core of the source chain pattern. Each country declares
   * its sources with priorities. The engine sorts by priority and tries
   * each in sequence. On failure, logs the error and continues to the
   * next source. On success, returns immediately with the result.
   *
   * Example (NZ):
   * ```
   * Priority 1: data.govt.nz CSV → success → return
   * Priority 2: Wikipedia parse  → (not tried)
   * Priority 3: parliament.nz    → (not tried)
   * ```
   *
   * @param sources - Data sources in priority order
   * @param attempt - Async function to try each source
   * @returns Result from first successful source + execution log
   * @throws Error if all sources fail
   */
  protected async trySourceChain<T>(
    sources: readonly SourceConfig[],
    attempt: (source: SourceConfig) => Promise<T>
  ): Promise<{ result: T; source: SourceConfig; attempts: readonly SourceAttempt[] }> {
    const attempts: SourceAttempt[] = [];
    const sorted = [...sources].sort((a, b) => a.priority - b.priority);

    for (const source of sorted) {
      const startTime = Date.now();
      try {
        logger.info('Trying data source', {
          country: this.country,
          source: source.name,
          priority: source.priority,
        });

        const result = await attempt(source);

        attempts.push({
          source: source.name,
          success: true,
          durationMs: Date.now() - startTime,
        });

        logger.info('Data source succeeded', {
          country: this.country,
          source: source.name,
        });

        return { result, source, attempts };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push({
          source: source.name,
          success: false,
          durationMs: Date.now() - startTime,
          error: message,
        });

        logger.warn('Data source failed, trying next', {
          country: this.country,
          source: source.name,
          error: message,
        });
      }
    }

    throw new Error(
      `All ${sources.length} data sources failed for ${this.country}: ` +
      attempts.map(a => `${a.source}: ${a.error}`).join('; ')
    );
  }

  // ==========================================================================
  // Layer 1: Source Authority Helper (Protected)
  // ==========================================================================

  /**
   * Assess source authority across boundary and officials sources.
   *
   * Scores each source by its AuthorityLevel, averages across all
   * sources used in this extraction.
   */
  protected assessSourceAuthority(
    boundarySources: readonly { name: string; authority: AuthorityLevel; vintage: number }[],
    officialAttempts: readonly SourceAttempt[]
  ): { confidence: number; sources: readonly SourceAssessment[] } {
    const assessments: SourceAssessment[] = [
      ...boundarySources.map(s => ({
        name: s.name,
        authority: s.authority,
        vintage: s.vintage,
        type: 'boundary' as const,
      })),
      ...officialAttempts
        .filter(s => s.success)
        .map(s => {
          const sourceConfig = this.officialsSources.find(os => os.name === s.source);
          return {
            name: s.source,
            authority: sourceConfig?.authority ?? ('community' as AuthorityLevel),
            vintage: new Date().getFullYear(),
            type: 'officials' as const,
          };
        }),
    ];

    const authorityScores: Record<AuthorityLevel, number> = {
      constitutional: 25,
      'electoral-commission': 22,
      'national-statistics': 20,
      'state-agency': 15,
      'municipal-agency': 10,
      commercial: 5,
      community: 0,
    };

    const avgAuthority = assessments.length > 0
      ? assessments.reduce((sum, a) => sum + authorityScores[a.authority], 0) / assessments.length
      : 0;

    return {
      confidence: Math.min(100, Math.round(avgAuthority * 4)),
      sources: assessments,
    };
  }

  // ==========================================================================
  // Layer 3: Boundary Code Resolution Helper (Protected)
  // ==========================================================================

  /**
   * Resolve boundary codes by name-matching officials against boundaries.
   *
   * Builds a normalized lookup from boundary names, then matches each
   * official's constituency/riding/division name against it. Returns
   * diagnostics for unresolved, ambiguous, and vacant boundaries.
   *
   * This method does NOT mutate officials — it reports diagnostics.
   * The actual code assignment happens in the country-specific
   * extractOfficials() implementation where officials are constructed
   * with their boundary codes.
   *
   * @param officials - Officials with constituency names
   * @param boundaryIndex - Map of boundary name → boundary object
   * @param nameExtractor - Function to get constituency name from official
   * @param nameNormalizer - Optional custom normalizer (default: lowercase + trim)
   */
  protected resolveBoundaryCodes<T extends OfficialRecord>(
    officials: readonly T[],
    boundaryIndex: Map<string, TBoundary>,
    nameExtractor: (official: T) => string,
    nameNormalizer?: (name: string) => string,
  ): {
    resolved: number;
    unmatched: readonly OfficialDiagnostic[];
    vacant: readonly string[];
    ambiguous: readonly OfficialDiagnostic[];
  } {
    const normalize = nameNormalizer ?? ((s: string) => s.toLowerCase().trim());
    const unmatched: OfficialDiagnostic[] = [];
    const ambiguous: OfficialDiagnostic[] = [];
    let resolved = 0;

    // Build normalized lookup (group by normalized name for ambiguity detection)
    const normalizedIndex = new Map<string, TBoundary[]>();
    for (const [name, boundary] of boundaryIndex) {
      const key = normalize(name);
      const existing = normalizedIndex.get(key) ?? [];
      existing.push(boundary);
      normalizedIndex.set(key, existing);
    }

    for (const official of officials) {
      const name = nameExtractor(official);
      if (!name) continue; // List MPs with no constituency

      const key = normalize(name);
      const matches = normalizedIndex.get(key);

      if (!matches || matches.length === 0) {
        unmatched.push({
          type: 'UNMATCHED_OFFICIAL',
          officialId: official.id,
          officialName: official.name,
          boundaryName: name,
        });
      } else if (matches.length > 1) {
        ambiguous.push({
          type: 'AMBIGUOUS_MATCH',
          officialId: official.id,
          officialName: official.name,
          boundaryName: name,
          details: `Matched ${matches.length} boundaries`,
        });
      } else {
        resolved++;
      }
    }

    // Find vacant boundaries (boundaries with no matching official)
    const officialBoundaryKeys = new Set(
      officials
        .map(o => nameExtractor(o))
        .filter(Boolean)
        .map(n => normalize(n))
    );
    const vacant = [...boundaryIndex.keys()]
      .filter(name => !officialBoundaryKeys.has(normalize(name)));

    return { resolved, unmatched, vacant, ambiguous };
  }

  // ==========================================================================
  // Layer 4: PIP Verification Helper (Protected)
  // ==========================================================================

  /**
   * Run Point-in-Polygon verification for officials with office addresses.
   *
   * Diagnostic only — mismatches are flagged for human review, not treated
   * as ingestion failures. UK MPs commonly have Westminster offices outside
   * their constituency. NZ list MPs often have no office address.
   *
   * Uses external geocoder and PIP functions injected by the caller,
   * keeping the provider independent of the serving layer.
   */
  protected async verifyPIP(
    officials: readonly TOfficial[],
    geocoder: GeocoderFn,
    pipCheck: PIPCheckFn,
  ): Promise<{
    confirmed: number;
    mismatched: readonly PIPDiagnostic[];
    skipped: number;
    total: number;
  }> {
    let confirmed = 0;
    let skipped = 0;
    const mismatched: PIPDiagnostic[] = [];

    for (const official of officials) {
      if (!official.officeAddress) {
        skipped++;
        continue;
      }
      if (!official.boundaryCode) {
        skipped++;
        continue;
      }

      try {
        const coords = await geocoder(official.officeAddress);
        if (!coords) {
          skipped++;
          continue;
        }

        const inBoundary = pipCheck(coords, official.boundaryCode);
        if (inBoundary) {
          confirmed++;
        } else {
          mismatched.push({
            type: 'PIP_MISMATCH',
            officialId: official.id,
            officialName: official.name,
            boundaryCode: official.boundaryCode,
            address: official.officeAddress,
            coordinates: coords,
          });
        }
      } catch {
        skipped++;
      }
    }

    return { confirmed, mismatched, skipped, total: officials.length };
  }

  // ==========================================================================
  // Composite Validation Report Builder (Protected)
  // ==========================================================================

  /**
   * Build a ValidationReport from individual layer results.
   *
   * Computes overall confidence as weighted composite:
   * - Source authority: 25%
   * - Schema validation: 25%
   * - Code resolution: 25%
   * - PIP verification: 25%
   *
   * Sets `blocking: true` only if schema validation fails (actual < 80% of expected).
   */
  protected buildValidationReport(
    layers: ValidationReport['layers']
  ): ValidationReport {
    // Schema: pass = 100, fail = 0
    const schemaScore = layers.schemaValidation.passed ? 100 : 0;

    // Code resolution: % successfully resolved
    const codeTotal = layers.codeResolution.resolved +
      layers.codeResolution.unmatched.length +
      layers.codeResolution.ambiguous.length;
    const codeScore = codeTotal > 0
      ? Math.round((layers.codeResolution.resolved / codeTotal) * 100)
      : 100;

    // PIP: % confirmed (exclude skipped from denominator)
    const pipChecked = layers.pipVerification.total - layers.pipVerification.skipped;
    const pipScore = pipChecked > 0
      ? Math.round((layers.pipVerification.confirmed / pipChecked) * 100)
      : 100;

    const overallConfidence = Math.round(
      layers.sourceAuthority.confidence * 0.25 +
      schemaScore * 0.25 +
      codeScore * 0.25 +
      pipScore * 0.25
    );

    return {
      country: this.country,
      timestamp: new Date(),
      layers,
      overallConfidence,
      blocking: !layers.schemaValidation.passed,
    };
  }

  // ==========================================================================
  // Schema Validation Helper (Protected)
  // ==========================================================================

  /**
   * Validate an array of records against a zod schema.
   *
   * Returns pass/fail based on 80% threshold: if actual valid records
   * are less than 80% of expected count, validation fails (blocks ingestion
   * to prevent silent data loss).
   *
   * @param records - Records to validate
   * @param schema - Zod schema to validate against
   * @param expectedCount - Expected total record count
   * @returns Schema validation result with errors
   */
  protected validateSchema<T>(
    records: readonly T[],
    schema: { safeParse: (data: unknown) => { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } } },
    expectedCount: number,
  ): {
    passed: boolean;
    errors: readonly { field: string; message: string; recordId?: string }[];
    recordCount: number;
    expectedCount: number;
  } {
    const errors: { field: string; message: string; recordId?: string }[] = [];

    for (const record of records) {
      const result = schema.safeParse(record);
      if (!result.success && result.error) {
        for (const issue of result.error.issues) {
          errors.push({
            field: issue.path.join('.'),
            message: issue.message,
            recordId: (record as Record<string, unknown>).id as string | undefined,
          });
        }
      }
    }

    // 80% threshold: fail if valid records < 80% of expected
    const validCount = records.length - new Set(errors.map(e => e.recordId)).size;
    const threshold = Math.floor(expectedCount * 0.8);
    const passed = validCount >= threshold;

    return {
      passed,
      errors,
      recordCount: records.length,
      expectedCount,
    };
  }

  // ==========================================================================
  // Boundary Schema Validation Helper (Protected)
  // ==========================================================================

  /**
   * Validate boundary geometries against schema.
   * Same 80% threshold as official validation.
   */
  protected validateBoundaries(
    boundaries: readonly InternationalBoundary[],
    expectedCount: number,
  ): {
    passed: boolean;
    errors: readonly { field: string; message: string; boundaryId?: string }[];
    validCount: number;
    expectedCount: number;
  } {
    const errors: { field: string; message: string; boundaryId?: string }[] = [];

    for (const boundary of boundaries) {
      const result = InternationalBoundarySchema.safeParse(boundary);
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({
            field: issue.path.join('.'),
            message: issue.message,
            boundaryId: boundary.id,
          });
        }
      }
    }

    // 80% threshold: fail if valid boundaries < 80% of expected
    const invalidIds = new Set(errors.map(e => e.boundaryId));
    const validCount = boundaries.length - invalidIds.size;
    const threshold = Math.floor(expectedCount * 0.8);
    const passed = validCount >= threshold;

    return { passed, errors, validCount, expectedCount };
  }
}
