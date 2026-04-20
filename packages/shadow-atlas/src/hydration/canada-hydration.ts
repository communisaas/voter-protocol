/**
 * Canada Hydration Pipeline
 *
 * Produces CellDistrictMapping[] from StatCan/Elections Canada data sources.
 * Implements the HydrationPipeline interface — the only contract needed to
 * plug Canada into the jurisdiction-agnostic tree building pipeline.
 *
 * Data sources:
 *   - Represent API (Open North) — federal electoral district boundaries (343 ridings)
 *   - StatCan geographic attribute file — DA → riding + province mapping
 *
 * Output: CellDistrictMapping[] ready for buildCellMapTree() — same downstream
 * pipeline as the US BAF/BEF hydration.
 *
 * Cell granularity: Federal Electoral District (riding) — 343 cells.
 * Each riding is one cell in Tree 2. Future phases may use finer-grained DAs (~56K).
 *
 * @packageDocumentation
 */

import type { CellDistrictMapping } from '../tree-builder.js';
import type { HydrationPipeline, HydrationResult } from '../jurisdiction.js';
import { CA_JURISDICTION, PROTOCOL_DISTRICT_SLOTS } from '../jurisdiction.js';
import { CanadaBoundaryProvider, type CanadaRiding } from '../providers/international/canada-provider.js';
import { logger } from '../core/utils/logger.js';

// ============================================================================
// Province → FIPS-like code mapping (for slot 1 encoding)
// ============================================================================

/**
 * StatCan province/territory SGC codes (Standard Geographic Classification).
 * These are 2-digit numeric codes analogous to US FIPS codes.
 */
const PROVINCE_SGC: Record<string, string> = {
  'NL': '10', // Newfoundland and Labrador
  'PE': '11', // Prince Edward Island
  'NS': '12', // Nova Scotia
  'NB': '13', // New Brunswick
  'QC': '24', // Quebec
  'ON': '35', // Ontario
  'MB': '46', // Manitoba
  'SK': '47', // Saskatchewan
  'AB': '48', // Alberta
  'BC': '59', // British Columbia
  'YT': '60', // Yukon
  'NT': '61', // Northwest Territories
  'NU': '62', // Nunavut
};

// ============================================================================
// Hydration Pipeline
// ============================================================================

export interface CanadaHydrationOptions {
  /** Only hydrate ridings in these provinces. Default: all provinces. */
  provinces?: string[];
  /** Use cached riding data instead of fetching from Represent API. */
  cachedRidings?: CanadaRiding[];
}

/**
 * Canada hydration pipeline.
 *
 * Fetches 343 federal electoral districts from Represent API and converts
 * each riding into a CellDistrictMapping with:
 *   - cellId = encoded riding code (e.g., BigInt("35001") for an Ontario riding)
 *   - districts[0] = riding code (slot 0: federal electoral district)
 *   - districts[1] = province SGC code (slot 1: province/territory)
 *   - districts[2..23] = 0n (unused slots)
 */
export class CanadaHydrationPipeline implements HydrationPipeline {
  readonly config = CA_JURISDICTION;
  private readonly provider: CanadaBoundaryProvider;

  constructor(provider?: CanadaBoundaryProvider) {
    this.provider = provider ?? new CanadaBoundaryProvider();
  }

  async hydrate(options?: CanadaHydrationOptions): Promise<CellDistrictMapping[]> {
    const result = await this.hydrateWithStats(options);
    return result.mappings;
  }

  async hydrateWithStats(options?: CanadaHydrationOptions): Promise<HydrationResult> {
    const startTime = Date.now();

    // Step 1: Get riding data
    let ridings: readonly CanadaRiding[];
    if (options?.cachedRidings) {
      ridings = options.cachedRidings;
      logger.info('Using cached riding data', { count: ridings.length });
    } else {
      logger.info('Fetching federal electoral districts from Represent API...');
      const extraction = await this.provider.extractFederalDistricts();
      if (!extraction.success) {
        throw new Error('Failed to fetch federal electoral districts from Represent API');
      }
      ridings = extraction.boundaries;
      logger.info('Fetched ridings', {
        count: ridings.length,
        expected: 343,
        matched: ridings.length === 343,
      });
    }

    // Step 2: Filter by province if requested
    let filteredRidings = ridings;
    if (options?.provinces && options.provinces.length > 0) {
      const provinceSet = new Set(options.provinces.map(p => p.toUpperCase()));
      filteredRidings = ridings.filter(r => provinceSet.has(r.province));
      logger.info('Filtered by province', {
        provinces: options.provinces,
        before: ridings.length,
        after: filteredRidings.length,
      });
    }

    // Step 3: Convert to CellDistrictMapping[]
    const mappings: CellDistrictMapping[] = [];
    const slotCoverage = new Map<number, number>();
    let skipped = 0;

    for (const riding of filteredRidings) {
      try {
        const mapping = this.ridingToMapping(riding);
        mappings.push(mapping);

        // Track slot coverage
        for (let i = 0; i < PROTOCOL_DISTRICT_SLOTS; i++) {
          if (mapping.districts[i] !== 0n) {
            slotCoverage.set(i, (slotCoverage.get(i) ?? 0) + 1);
          }
        }
      } catch (err) {
        logger.warn('Skipping riding due to encoding error', {
          ridingId: riding.id,
          error: err instanceof Error ? err.message : String(err),
        });
        skipped++;
      }
    }

    const durationMs = Date.now() - startTime;
    logger.info('Canada hydration complete', {
      mappings: mappings.length,
      skipped,
      durationMs,
      slot0Coverage: slotCoverage.get(0) ?? 0,
      slot1Coverage: slotCoverage.get(1) ?? 0,
    });

    return {
      mappings,
      unitsProcessed: filteredRidings.length,
      cellCount: mappings.length,
      slotCoverage,
      stats: {
        totalRidings: ridings.length,
        filteredRidings: filteredRidings.length,
        skipped,
        durationMs,
      },
    };
  }

  /**
   * Convert a single riding to a CellDistrictMapping.
   */
  private ridingToMapping(riding: CanadaRiding): CellDistrictMapping {
    // Cell ID = encoded riding code
    const cellId = this.config.encodeCellId(riding.id);

    // Initialize all 24 slots to 0n
    const districts: bigint[] = new Array(PROTOCOL_DISTRICT_SLOTS).fill(0n);

    // Slot 0: Federal Electoral District (riding code as bigint)
    districts[0] = BigInt(riding.id);

    // Slot 1: Province/Territory (SGC code as bigint)
    const provinceSgc = PROVINCE_SGC[riding.province];
    if (provinceSgc) {
      districts[1] = BigInt(provinceSgc);
    }

    return { cellId, districts };
  }
}
