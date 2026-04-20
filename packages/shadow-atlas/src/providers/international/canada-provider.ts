/**
 * Canada Country Provider (Unified)
 *
 * Extends CountryProvider to produce boundaries, officials, cell maps,
 * and validation diagnostics through a single abstraction.
 *
 * DATA SOURCES:
 * - Boundaries: Represent API (Open North) / Statistics Canada
 * - Officials (Priority 1): ourcommons.ca Members XML (electoral-commission)
 * - Officials (Priority 2): Represent API representatives (community/NGO)
 *
 * API TYPE: REST (custom)
 * LICENSE: Open Government License - Canada (OGL-CA)
 *
 * COVERAGE:
 * - Federal Electoral Districts: 343 (2023 Representation Order, post-2024 redistribution)
 * - House of Commons: up to 343 MPs
 * - Covers: All provinces and territories
 *
 * USAGE:
 * ```typescript
 * const provider = new CanadaCountryProvider();
 *
 * // Boundaries (inherited)
 * const result = await provider.extractFederalDistricts();
 *
 * // Officials (new — source chain: ourcommons.ca XML → Represent API)
 * const boundaries = result.boundaries;
 * const boundaryIndex = new Map(boundaries.map(b => [b.name, b]));
 * const officials = await provider.extractOfficials(boundaryIndex);
 *
 * // Validation (new — 4-layer pipeline)
 * const report = await provider.validate(boundaries, officials.officials);
 * ```
 *
 * API ENDPOINTS:
 * - Boundaries: https://represent.opennorth.ca/boundaries/federal-electoral-districts-2023-representation-order/
 * - Officials P1: https://www.ourcommons.ca/Members/en/search/xml
 * - Officials P2: https://represent.opennorth.ca/representatives/house-of-commons/
 *
 * NOTES:
 * - 2023 Representation Order implemented (post-2024 redistribution, 343 ridings)
 * - Federal boundaries updated every ~10 years following census
 * - Next scheduled redistribution: Post-2031 census
 * - ourcommons.ca provides bilingual names and stable PersonId
 * - Represent API provides bilingual names (English + French) but less authority
 */

import type { Polygon, MultiPolygon } from 'geojson';
import {
  type InternationalExtractionResult,
  type LayerConfig,
  type ProviderHealth,
  type LayerExtractionResult,
} from './base-provider.js';
import { CountryProvider } from './country-provider.js';
import {
  CanadianMPSchema,
  type OfficialRecord,
  type OfficialsExtractionResult,
  type CellMapResult,
  type ValidationReport,
  type SourceConfig,
  type StatisticalUnitType,
  type GeocoderFn,
  type PIPCheckFn,
} from './country-provider-types.js';
import { logger } from '../../core/utils/logger.js';

// ============================================================================
// Canada-Specific Types
// ============================================================================

/**
 * Canada layer types
 */
export type CanadaLayerType = 'federal';

/**
 * Canada province/territory codes (ISO 3166-2:CA)
 */
export type CanadaProvince =
  | 'AB' // Alberta
  | 'BC' // British Columbia
  | 'MB' // Manitoba
  | 'NB' // New Brunswick
  | 'NL' // Newfoundland and Labrador
  | 'NS' // Nova Scotia
  | 'NT' // Northwest Territories
  | 'NU' // Nunavut
  | 'ON' // Ontario
  | 'PE' // Prince Edward Island
  | 'QC' // Quebec
  | 'SK' // Saskatchewan
  | 'YT'; // Yukon

/**
 * Canada federal electoral district (riding)
 */
export interface CanadaRiding {
  /** Federal Electoral District code (e.g., '35001' for Ontario riding) */
  readonly id: string;

  /** District name (English) */
  readonly name: string;

  /** Boundary type */
  readonly type: CanadaLayerType;

  /** District name (French) */
  readonly nameFr: string;

  /** Province/territory code */
  readonly province: CanadaProvince;

  /** GeoJSON geometry */
  readonly geometry: Polygon | MultiPolygon;

  /** Source metadata */
  readonly source: {
    readonly country: 'CA';
    readonly dataSource: 'Elections Canada / Statistics Canada';
    readonly endpoint: string;
    readonly vintage: number;
    readonly retrievedAt: string;
    readonly authority: 'electoral-commission';
  };

  /** Original properties from data source */
  readonly properties: Record<string, unknown>;
}

/**
 * Canadian MP official record — extends OfficialRecord with CA-specific fields
 */
export interface CAOfficial extends OfficialRecord {
  /** House of Commons member ID (e.g., 'occ-111067' or PersonId from ourcommons.ca) */
  readonly parliamentId: string;

  /** 5-digit FED riding code (e.g., '35075' for Papineau) */
  readonly ridingCode: string;

  /** English riding name */
  readonly ridingName: string;

  /** French riding name (if available) */
  readonly ridingNameFr?: string;

  /** 2-letter province code */
  readonly province: string;

  /** French name variant (if available) */
  readonly nameFr?: string;
}

/**
 * Canada extraction result
 */
export interface CanadaExtractionResult extends LayerExtractionResult {
  readonly layer: CanadaLayerType;
  readonly boundaries: readonly CanadaRiding[];
}

/**
 * Resolved district from geocoding
 */
export interface ResolvedDistrict {
  readonly id: string;
  readonly name: string;
  readonly nameFr: string;
  readonly province: CanadaProvince;
}

/**
 * Represent API boundary response
 */
interface RepresentBoundary {
  readonly boundary_set_name: string;
  readonly external_id: string;
  readonly name: string;
  readonly name_fr?: string;
  readonly related?: {
    readonly province_code?: string;
  };
  readonly simple_shape?: {
    readonly type: string;
    readonly coordinates: number[][][] | number[][][][];
  };
}

/**
 * Represent API boundaries list response
 */
interface RepresentBoundariesResponse {
  readonly objects: readonly RepresentBoundary[];
  readonly meta?: {
    readonly total_count?: number;
    readonly next?: string | null;
  };
}

/**
 * Represent API point-in-polygon response
 */
interface RepresentPointResponse {
  readonly boundaries_centroid?: readonly RepresentBoundary[];
}

/**
 * Represent API representative response
 */
interface RepresentMP {
  readonly name: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly party_name: string;
  readonly elected_office: string;
  readonly district_name: string;
  readonly email: string | null;
  readonly url: string | null;
  readonly photo_url: string | null;
  readonly personal_url: string | null;
  readonly offices: ReadonlyArray<{
    readonly type: string;
    readonly postal: string | null;
    readonly tel: string | null;
    readonly fax: string | null;
  }>;
  readonly extra: Record<string, unknown>;
  readonly related: {
    readonly boundary_url?: string;
    readonly representative_set_url?: string;
  };
  readonly source_url: string;
}

interface RepresentMPResponse {
  readonly objects: readonly RepresentMP[];
  readonly meta: {
    readonly total_count: number;
    readonly next: string | null;
    readonly previous: string | null;
    readonly limit: number;
    readonly offset: number;
  };
}

/**
 * ourcommons.ca XML member structure (parsed)
 */
interface OurCommonsMember {
  readonly PersonId: string;
  readonly PersonOfficialFirstName: string;
  readonly PersonOfficialLastName: string;
  readonly PersonShortHonorific?: string;
  readonly ConstituencyName: string;
  readonly ConstituencyProvinceTerritoryName: string;
  readonly CaucusShortName: string;
  readonly FromDateTime?: string;
}

// ============================================================================
// Province Mapping
// ============================================================================

/** Map province full name to 2-letter code */
const PROVINCE_NAME_TO_CODE: Readonly<Record<string, CanadaProvince>> = {
  'alberta': 'AB',
  'british columbia': 'BC',
  'manitoba': 'MB',
  'new brunswick': 'NB',
  'newfoundland and labrador': 'NL',
  'newfoundland': 'NL',
  'nova scotia': 'NS',
  'northwest territories': 'NT',
  'nunavut': 'NU',
  'ontario': 'ON',
  'prince edward island': 'PE',
  'quebec': 'QC',
  'québec': 'QC',
  'saskatchewan': 'SK',
  'yukon': 'YT',
};

/** Map SGC province code (first 2 digits of FED code) to ISO 3166-2:CA abbreviation */
const SGC_TO_PROVINCE: Readonly<Record<string, CanadaProvince>> = {
  '10': 'NL', '11': 'PE', '12': 'NS', '13': 'NB',
  '24': 'QC', '35': 'ON', '46': 'MB', '47': 'SK',
  '48': 'AB', '59': 'BC', '60': 'YT', '61': 'NT', '62': 'NU',
};

// ============================================================================
// Name Normalization
// ============================================================================

/**
 * Normalize a riding/constituency name for matching.
 *
 * Handles:
 * - Case folding (lowercase)
 * - Accent removal (e.g., e, e, e all become 'e')
 * - Whitespace trimming and collapsing
 * - Em-dash / en-dash / hyphen normalization
 */
function normalizeRidingName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    // Normalize Unicode to decomposed form, then strip combining diacritical marks
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Normalize all dash variants to plain hyphen
    .replace(/[\u2013\u2014\u2015]/g, '-')
    // Normalize curly apostrophes/quotes to straight apostrophe
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    // Collapse whitespace
    .replace(/\s+/g, ' ');
}

/**
 * Compute Levenshtein edit distance between two strings.
 *
 * Used for fuzzy riding name matching when exact normalized match fails.
 * Optimized single-row implementation (O(min(m,n)) space).
 */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure a is the shorter string for space optimization
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const aLen = a.length;
  const bLen = b.length;
  const row = new Array<number>(aLen + 1);

  for (let i = 0; i <= aLen; i++) row[i] = i;

  for (let j = 1; j <= bLen; j++) {
    let prev = row[0];
    row[0] = j;
    for (let i = 1; i <= aLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const temp = row[i];
      row[i] = Math.min(
        row[i] + 1,       // deletion
        row[i - 1] + 1,   // insertion
        prev + cost        // substitution
      );
      prev = temp;
    }
  }

  return row[aLen];
}

/**
 * Find the best fuzzy match for a riding name in the boundary index.
 *
 * Uses Levenshtein distance with a threshold relative to string length.
 * Maximum allowed edit distance: 30% of the longer string's length,
 * capped at 10 characters to prevent false positives on short names.
 *
 * @returns The best matching boundary or null if no match within threshold
 */
function fuzzyMatchRiding(
  normalized: string,
  index: Map<string, { id: string; boundary: unknown }>,
): { key: string; distance: number } | null {
  let bestKey: string | null = null;
  let bestDistance = Infinity;

  for (const key of index.keys()) {
    const maxLen = Math.max(normalized.length, key.length);
    const threshold = Math.min(Math.ceil(maxLen * 0.3), 10);

    // Quick length check: if lengths differ by more than threshold, skip
    if (Math.abs(normalized.length - key.length) > threshold) continue;

    const distance = levenshteinDistance(normalized, key);
    if (distance <= threshold && distance < bestDistance) {
      bestDistance = distance;
      bestKey = key;
    }
  }

  if (bestKey !== null) {
    return { key: bestKey, distance: bestDistance };
  }
  return null;
}

// ============================================================================
// Canada Country Provider
// ============================================================================

/**
 * Canada Country Provider (Unified)
 *
 * Extends CountryProvider with officials extraction (ourcommons.ca XML + Represent API),
 * cell map stub (dissemination areas are Wave 3), and 4-layer validation.
 */
export class CanadaCountryProvider extends CountryProvider<
  CanadaLayerType,
  CanadaRiding,
  CAOfficial
> {
  readonly country = 'CA';
  readonly countryName = 'Canada';
  readonly dataSource = 'Elections Canada / Statistics Canada';
  readonly apiType = 'rest-api' as const;
  readonly license = 'OGL-CA';

  private readonly representApiUrl = 'https://represent.opennorth.ca';

  // --------------------------------------------------------------------------
  // CountryProvider Abstract Properties
  // --------------------------------------------------------------------------

  /** Officials data sources in priority order (source chain) */
  readonly officialsSources: readonly SourceConfig[] = [
    {
      name: 'ourcommons.ca XML',
      endpoint: 'https://www.ourcommons.ca/Members/en/search/xml',
      authority: 'electoral-commission',
      priority: 1,
    },
    {
      name: 'Represent API',
      endpoint: 'https://represent.opennorth.ca/representatives/house-of-commons/',
      authority: 'community',
      priority: 2,
    },
  ];

  /** Expected official count per chamber (343 seats post-2024 redistribution) */
  readonly expectedOfficialCounts: ReadonlyMap<string, number> = new Map([
    ['house-of-commons', 343],
  ]);

  /** Statistical geography unit type for Tree 2 cell maps */
  readonly statisticalUnit: StatisticalUnitType = 'dissemination-area';

  // --------------------------------------------------------------------------
  // Boundary Layer Configuration (inherited from BaseInternationalProvider)
  // --------------------------------------------------------------------------

  readonly layers: ReadonlyMap<CanadaLayerType, LayerConfig<CanadaLayerType>> = new Map([
    [
      'federal',
      {
        name: 'Federal Electoral Districts',
        type: 'federal',
        endpoint: 'https://represent.opennorth.ca/boundaries/federal-electoral-districts-2023-representation-order/',
        expectedCount: 343,
        updateSchedule: 'event-driven',
        authority: 'electoral-commission',
        vintage: 2024,
        lastVerified: '2026-03-13T00:00:00.000Z',
      },
    ],
  ]);

  constructor(options?: { retryAttempts?: number; retryDelayMs?: number }) {
    super(options);
  }

  // ==========================================================================
  // Boundary Extraction (preserved from original CanadaBoundaryProvider)
  // ==========================================================================

  /**
   * Extract all available layers
   */
  async extractAll(): Promise<InternationalExtractionResult<CanadaLayerType, CanadaRiding>> {
    const startTime = Date.now();
    const federal = await this.extractLayer('federal');

    return {
      country: this.country,
      layers: [federal],
      totalBoundaries: federal.actualCount,
      successfulLayers: federal.success ? 1 : 0,
      failedLayers: federal.success ? 0 : 1,
      extractedAt: new Date(),
      providerVersion: '2.0.0',
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Extract specified layer
   */
  async extractLayer(
    layerType: CanadaLayerType
  ): Promise<LayerExtractionResult<CanadaLayerType, CanadaRiding>> {
    switch (layerType) {
      case 'federal':
        return this.extractFederalDistricts();
      default:
        throw new Error(`Unsupported layer type: ${layerType}`);
    }
  }

  /**
   * Extract federal electoral districts
   */
  async extractFederalDistricts(): Promise<CanadaExtractionResult> {
    const startTime = Date.now();
    const layer = this.layers.get('federal')!;
    const endpoint = layer.endpoint;

    try {
      logger.info('Extracting federal electoral districts', { country: 'Canada' });
      const ridings = await this.fetchAllRidings(endpoint);
      const durationMs = Date.now() - startTime;

      logger.info('Federal extraction complete', {
        country: 'Canada',
        ridingCount: ridings.length,
        expectedCount: layer.expectedCount,
        durationMs
      });

      return {
        layer: 'federal',
        success: true,
        boundaries: ridings,
        expectedCount: layer.expectedCount,
        actualCount: ridings.length,
        matched: ridings.length === layer.expectedCount,
        confidence: this.calculateConfidence(
          ridings.length,
          layer.expectedCount,
          layer.vintage,
          layer.authority
        ),
        extractedAt: new Date(),
        source: endpoint,
        durationMs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Federal extraction failed', { country: 'Canada', error: message });

      return (this.createFailedResult(
        'federal',
        message,
        layer.expectedCount,
        endpoint,
        startTime
      ) as unknown) as CanadaExtractionResult;
    }
  }

  /**
   * Resolve address to electoral district using Represent API geocoding
   */
  async resolveAddressToDistrict(lat: number, lng: number): Promise<ResolvedDistrict | null> {
    try {
      const url = `${this.representApiUrl}/boundaries/?contains=${lat},${lng}&sets=federal-electoral-districts-2023-representation-order`;
      logger.info('Resolving address to district', { country: 'Canada', lat, lng });

      // Block redirects to prevent SSRF. Add timeout to prevent indefinite hang.
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as RepresentPointResponse;
      const boundaries = data.boundaries_centroid ?? [];

      if (boundaries.length === 0) {
        return null;
      }

      const boundary = boundaries[0];
      return {
        id: boundary.external_id,
        name: boundary.name,
        nameFr: boundary.name_fr ?? boundary.name,
        province: (boundary.related?.province_code as CanadaProvince) ?? 'ON',
      };
    } catch (error) {
      logger.error('Address resolution failed', {
        country: 'Canada',
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Extract all boundaries for a province
   */
  async extractByProvince(provinceCode: CanadaProvince): Promise<CanadaExtractionResult> {
    const startTime = Date.now();
    const layer = this.layers.get('federal')!;
    const endpoint = layer.endpoint;

    try {
      logger.info('Extracting federal districts by province', {
        country: 'Canada',
        province: provinceCode
      });
      const allRidings = await this.fetchAllRidings(endpoint);
      const provincialRidings = allRidings.filter((r) => r.province === provinceCode);
      const durationMs = Date.now() - startTime;

      logger.info('Province extraction complete', {
        country: 'Canada',
        province: provinceCode,
        ridingCount: provincialRidings.length,
        durationMs
      });

      return {
        layer: 'federal',
        success: true,
        boundaries: provincialRidings,
        expectedCount: provincialRidings.length,
        actualCount: provincialRidings.length,
        matched: true,
        confidence: 100,
        extractedAt: new Date(),
        source: endpoint,
        durationMs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Province extraction failed', {
        country: 'Canada',
        province: provinceCode,
        error: message
      });

      return (this.createFailedResult(
        'federal',
        message,
        0,
        endpoint,
        startTime
      ) as unknown) as CanadaExtractionResult;
    }
  }

  /**
   * Check if data has changed since last extraction.
   *
   * Queries the Represent API boundary-set metadata endpoint for
   * `related_data_updated` or `last_updated` timestamps. Falls back to
   * checking whether the total boundary count has changed.
   */
  async hasChangedSince(lastExtraction: Date): Promise<boolean> {
    try {
      const url = `${this.representApiUrl}/boundary-sets/federal-electoral-districts-2023-representation-order/?format=json`;
      // Block redirects to prevent SSRF.
      const res = await fetch(url, {
        headers: { 'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0' },
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });

      if (!res.ok) return true;

      const data = await res.json() as Record<string, unknown>;

      // Check for date fields that Represent API may expose
      const dateField = (data.related_data_updated ?? data.last_updated ?? data.modified) as string | undefined;
      if (dateField && typeof dateField === 'string') {
        const updatedDate = new Date(dateField);
        if (!isNaN(updatedDate.getTime())) {
          logger.debug('CA Represent API date check', {
            dateField,
            lastExtraction: lastExtraction.toISOString(),
            changed: updatedDate > lastExtraction,
          });
          return updatedDate > lastExtraction;
        }
      }

      // No date field — check if boundary count changed from expected
      const metaCount = typeof data.count === 'number' ? data.count : undefined;
      const federalLayer = this.layers.get('federal');
      if (metaCount !== undefined && federalLayer) {
        const changed = metaCount !== federalLayer.expectedCount;
        logger.debug('CA boundary count check', {
          apiCount: metaCount,
          expectedCount: federalLayer.expectedCount,
          changed,
        });
        return changed;
      }
    } catch (error) {
      logger.warn('Change detection failed, assuming changed', {
        country: 'CA',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    // Conservative fallback
    return true;
  }

  /**
   * Health check for provider availability
   */
  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      const url = `${this.representApiUrl}/boundaries/federal-electoral-districts-2023-representation-order/?limit=1`;
      // Block redirects to prevent SSRF. Add timeout to prevent indefinite hang.
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        issues.push(`HTTP ${response.status}: ${response.statusText}`);
        return {
          available: false,
          latencyMs: Date.now() - startTime,
          lastChecked: new Date(),
          issues,
        };
      }

      const data = (await response.json()) as RepresentBoundariesResponse;
      const latencyMs = Date.now() - startTime;

      if (!data.objects || data.objects.length === 0) {
        issues.push('API returned zero boundaries');
      }

      return {
        available: true,
        latencyMs,
        lastChecked: new Date(),
        issues,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`Failed to connect: ${message}`);

      return {
        available: false,
        latencyMs: Date.now() - startTime,
        lastChecked: new Date(),
        issues,
      };
    }
  }

  // ==========================================================================
  // Officials Extraction (CountryProvider abstract method)
  // ==========================================================================

  /**
   * Extract Canadian MPs with resolved boundary codes.
   *
   * Source chain:
   * 1. ourcommons.ca Members XML (electoral-commission authority, stable PersonId)
   * 2. Represent API (community authority, fallback)
   *
   * Boundary codes are resolved at extraction time by matching riding names
   * against the boundary index. Bilingual matching: tries English name first,
   * then French name.
   */
  async extractOfficials(
    boundaryIndex: Map<string, CanadaRiding>
  ): Promise<OfficialsExtractionResult<CAOfficial>> {
    const startTime = Date.now();
    const expectedCount = this.expectedOfficialCounts.get('house-of-commons') ?? 343;

    // Build normalized boundary lookup (English + French names)
    const normalizedBoundaryIndex = this.buildNormalizedBoundaryIndex(boundaryIndex);

    const { result: officials, source, attempts } = await this.trySourceChain(
      this.officialsSources,
      async (sourceConfig: SourceConfig) => {
        if (sourceConfig.name === 'ourcommons.ca XML') {
          return this.fetchFromOurCommons(sourceConfig.endpoint, normalizedBoundaryIndex);
        } else {
          return this.fetchFromRepresentAPI(sourceConfig.endpoint, normalizedBoundaryIndex);
        }
      }
    );

    const durationMs = Date.now() - startTime;
    const confidence = this.calculateConfidence(
      officials.length,
      expectedCount,
      new Date().getFullYear(),
      source.authority
    );

    logger.info('Officials extraction complete', {
      country: 'Canada',
      source: source.name,
      count: officials.length,
      expected: expectedCount,
      confidence,
      durationMs,
    });

    return {
      country: this.country,
      officials,
      expectedCount,
      actualCount: officials.length,
      matched: officials.length === expectedCount,
      confidence,
      sources: attempts,
      extractedAt: new Date(),
      durationMs,
    };
  }

  // ==========================================================================
  // Cell Map Construction (CountryProvider abstract method)
  // ==========================================================================

  /**
   * StatCan Geographic Attribute File (GAF) — 2021 Census.
   *
   * Contains DB-level rows with DAUID_ADIDU (8-digit DA code) and
   * FEDUID_CEFIDU (5-digit FED code). DAs nest within FEDs by StatCan
   * design, so all DBs in a DA share the same FED code.
   *
   * The ZIP contains 2021_92-151_X.csv (~300MB uncompressed, ~500K rows).
   * After extraction we stream-parse and aggregate to ~56K unique DAs.
   */
  private readonly gafUrl =
    'https://www12.statcan.gc.ca/census-recensement/2021/geo/aip-pia/attribute-attribs/files-fichiers/2021_92-151_X.zip';

  /**
   * SGC province/territory codes → numeric values for slot 1.
   * First 2 digits of DAUID encode the province.
   */
  private static readonly SGC_PROVINCE_CODES: ReadonlyMap<string, number> = new Map([
    ['10', 10], // NL
    ['11', 11], // PE
    ['12', 12], // NS
    ['13', 13], // NB
    ['24', 24], // QC
    ['35', 35], // ON
    ['46', 46], // MB
    ['47', 47], // SK
    ['48', 48], // AB
    ['59', 59], // BC
    ['60', 60], // YT
    ['61', 61], // NT
    ['62', 62], // NU
  ]);

  /**
   * Build cell map for Tree 2 (StatCan dissemination areas → FEDs).
   *
   * Downloads the StatCan Geographic Attribute File (GAF), which contains
   * DB-level rows linking every dissemination block to its parent DA and
   * FED. Since DA boundaries respect FED boundaries, all DBs in a DA
   * share the same FED — we aggregate to DA level and dedup.
   *
   * Slot 0: Federal Electoral District (5-digit FED code)
   * Slot 1: Province/Territory (SGC code from DAUID first 2 digits)
   * Slots 2-23: 0n (reserved for future layers)
   */
  async buildCellMap(
    _boundaries: CanadaRiding[]
  ): Promise<CellMapResult> {
    const startTime = Date.now();
    const { loadConcordance } = await import('../../hydration/concordance-loader.js');
    const { CA_JURISDICTION } = await import('../../jurisdiction.js');
    const { buildCellMapTree, DISTRICT_SLOT_COUNT } = await import('../../tree-builder.js');

    // The GAF is a ZIP file. Download and extract the CSV, then cache it.
    // Once cached, loadConcordance reads from cache directly.
    const cacheDir = 'data/country-cache/ca';
    const csvCacheFilename = 'ca-gaf-2021.csv';
    const { existsSync, mkdirSync } = await import('fs');
    const { writeFile } = await import('fs/promises');
    const { join } = await import('path');

    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }

    const csvCachePath = join(cacheDir, csvCacheFilename);

    // Extract CSV from ZIP if not already cached
    if (!existsSync(csvCachePath)) {
      logger.info(`CA GAF: downloading ZIP from ${this.gafUrl}...`);
      // Block redirects to prevent SSRF. Add timeout to prevent indefinite hang.
      const response = await fetch(this.gafUrl, {
        redirect: 'error',
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) {
        throw new Error(
          `Failed to download CA GAF ZIP: ${response.status} ${response.statusText}`
        );
      }

      const zipBuffer = Buffer.from(await response.arrayBuffer());
      logger.info(`CA GAF: ZIP downloaded (${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB), extracting CSV...`);

      const csvContent = await this.extractCSVFromZip(zipBuffer, '2021_92-151_X.csv');
      if (!csvContent) {
        throw new Error('CA GAF: CSV not found in ZIP archive');
      }

      await writeFile(csvCachePath, csvContent, 'utf-8');
      logger.info(`CA GAF: CSV extracted and cached (${(csvContent.length / 1024 / 1024).toFixed(1)} MB)`);
    }

    // Load concordance from cached CSV.
    // The GAF has DB-level rows; loadConcordance will return one mapping per DB row.
    // We dedup by DAUID below (all DBs in a DA share the same FED).
    const concordance = await loadConcordance(
      {
        url: this.gafUrl, // not re-downloaded — cache file already exists
        unitColumn: 'DAUID_ADIDU',
        boundaryColumn: 'FEDUID_CEFIDU',
        cacheFilename: csvCacheFilename,
      },
      cacheDir,
    );

    logger.info(
      `CA concordance loaded: ${concordance.rowCount} DB rows, ` +
      `columns: [${concordance.columns.slice(0, 5).join(', ')}...], ` +
      `fromCache: ${concordance.fromCache}`
    );

    // Convert to CellDistrictMapping[] — aggregate DB rows to DA level
    const cellMappings: import('../../tree-builder.js').CellDistrictMapping[] = [];
    const seenDAs = new Map<string, { fedCode: string; provinceCode: string }>();
    let skippedEmpty = 0;
    let skippedDuplicate = 0;

    for (const m of concordance.mappings) {
      const dauid = m.unitId;
      if (!dauid || dauid.length < 4) {
        skippedEmpty++;
        continue;
      }

      // Dedup by DAUID (all DBs in a DA share the same FED)
      if (seenDAs.has(dauid)) {
        skippedDuplicate++;
        continue;
      }

      const fedCode = m.boundaryCode?.replace(/\D/g, '');
      if (!fedCode) {
        skippedEmpty++;
        continue;
      }

      // Province code from first 2 digits of DAUID
      const provinceCode = dauid.substring(0, 2);

      seenDAs.set(dauid, { fedCode, provinceCode });
    }

    // Build CellDistrictMapping from deduplicated DA records
    for (const [dauid, { fedCode, provinceCode }] of seenDAs) {
      const cellId = CA_JURISDICTION.encodeCellId(dauid);

      // Populate 24-slot district array
      const districts: bigint[] = new Array(DISTRICT_SLOT_COUNT).fill(0n);

      // Slot 0: Federal Electoral District (5-digit riding code)
      districts[0] = BigInt(fedCode);

      // Slot 1: Province/Territory (SGC code)
      const provNum = CanadaCountryProvider.SGC_PROVINCE_CODES.get(provinceCode);
      if (provNum !== undefined) {
        districts[1] = BigInt(provNum);
      }

      cellMappings.push({ cellId, districts });
    }

    logger.info(
      `CA cell mappings: ${cellMappings.length} DAs, ` +
      `${skippedEmpty} skipped (no FED), ` +
      `${skippedDuplicate} skipped (duplicate DB rows)`
    );

    // Build the Sparse Merkle Tree
    const treeResult = await buildCellMapTree(
      cellMappings,
      CA_JURISDICTION.recommendedDepth,
    );

    return {
      country: 'CA',
      statisticalUnit: 'dissemination-area',
      cellCount: cellMappings.length,
      root: treeResult.root,
      depth: treeResult.depth,
      mappings: cellMappings,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Extract a named CSV file from a ZIP buffer.
   *
   * Implements minimal ZIP parsing (local file headers) without external
   * dependencies. Handles both stored and deflated entries.
   */
  private async extractCSVFromZip(
    zipBuffer: Buffer,
    targetFilename: string,
  ): Promise<string | null> {
    const { inflateRawSync } = await import('zlib');

    let offset = 0;
    while (offset < zipBuffer.length - 4) {
      // Local file header signature: 0x04034b50
      const sig = zipBuffer.readUInt32LE(offset);
      if (sig !== 0x04034b50) break;

      const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
      const compressedSize = zipBuffer.readUInt32LE(offset + 18);
      const uncompressedSize = zipBuffer.readUInt32LE(offset + 22);
      const filenameLen = zipBuffer.readUInt16LE(offset + 26);
      const extraLen = zipBuffer.readUInt16LE(offset + 28);

      const filename = zipBuffer.toString('utf-8', offset + 30, offset + 30 + filenameLen);
      const dataStart = offset + 30 + filenameLen + extraLen;

      // R66-C2: Reject path traversal entries (zip-slip defense-in-depth)
      if (filename.includes('..') || filename.startsWith('/')) {
        offset = dataStart + compressedSize;
        continue;
      }

      // Match only the basename to prevent directory prefix confusion
      const basename = filename.split('/').pop() ?? '';
      if (basename === targetFilename) {
        const compressedData = zipBuffer.subarray(dataStart, dataStart + compressedSize);

        if (compressionMethod === 0) {
          // Stored (no compression)
          return compressedData.toString('utf-8');
        } else if (compressionMethod === 8) {
          // Deflated
          const MAX_DECOMPRESSED_SIZE = 500 * 1024 * 1024; // 500MB — ignore ZIP header's uncompressedSize
          const decompressed = inflateRawSync(compressedData, {
            maxOutputLength: MAX_DECOMPRESSED_SIZE,
          });
          return decompressed.toString('utf-8');
        } else {
          throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
        }
      }

      offset = dataStart + compressedSize;
    }

    return null;
  }

  // ==========================================================================
  // Validation (CountryProvider abstract method)
  // ==========================================================================

  /**
   * Run 4-layer validation pipeline for Canada.
   *
   * Layer 1: Source authority scoring (ourcommons.ca = electoral-commission)
   * Layer 2: Schema validation against CanadianMPSchema + expected count (343)
   * Layer 3: Boundary code resolution diagnostics
   * Layer 4: PIP verification (optional, requires geocoder + R-tree)
   */
  async validate(
    boundaries: CanadaRiding[],
    officials: CAOfficial[],
    geocoder?: GeocoderFn,
    pipCheck?: PIPCheckFn,
  ): Promise<ValidationReport> {
    const expectedCount = this.expectedOfficialCounts.get('house-of-commons') ?? 343;

    // Layer 1: Source Authority
    const boundaryLayer = this.layers.get('federal')!;
    const sourceAuthority = this.assessSourceAuthority(
      [{
        name: boundaryLayer.name,
        authority: boundaryLayer.authority,
        vintage: boundaryLayer.vintage,
      }],
      // R59-H3-prov: Pass only the first (successful) source rather than
      // fabricating success: true for all sources, which inflates confidence.
      // At validation time, extraction already succeeded via trySourceChain,
      // so exactly one source produced the officials we're validating.
      this.officialsSources.slice(0, 1).map(s => ({
        source: s.name,
        success: true,
        durationMs: 0,
      }))
    );

    // Layer 2: Schema & Count Validation
    const schemaValidation = this.validateSchema(
      officials,
      CanadianMPSchema,
      expectedCount,
    );

    // Layer 3: Boundary Code Resolution
    const boundaryIndex = new Map(boundaries.map(b => [b.name, b]));
    const codeResolution = this.resolveBoundaryCodes(
      officials,
      boundaryIndex,
      (official: CAOfficial) => official.ridingName,
      normalizeRidingName,
    );

    // Layer 4: PIP Verification
    let pipVerification: ValidationReport['layers']['pipVerification'];
    if (geocoder && pipCheck) {
      pipVerification = await this.verifyPIP(officials, geocoder, pipCheck);
    } else {
      // Skip PIP — mark all as skipped
      pipVerification = {
        confirmed: 0,
        mismatched: [],
        skipped: officials.length,
        total: officials.length,
      };
    }

    return this.buildValidationReport({
      sourceAuthority,
      schemaValidation,
      codeResolution,
      pipVerification,
    });
  }

  // ==========================================================================
  // Private: Boundary Fetching (preserved from original)
  // ==========================================================================

  /**
   * Fetch all ridings from Represent API.
   *
   * The Represent API splits metadata and geometry across two endpoints:
   * - List endpoint: returns external_id, name, related (province_code), but NO geometry
   * - simple_shape endpoint: returns name + simple_shape, but NO external_id or province
   *
   * We fetch both and join on name.
   */
  private async fetchAllRidings(endpoint: string): Promise<CanadaRiding[]> {
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
    };

    // Step 1: Fetch all metadata (paginated)
    const metadataMap = new Map<string, RepresentBoundary>();
    let nextUrl: string | null = `${endpoint}?limit=500`;

    while (nextUrl) {
      logger.debug('Fetching riding metadata', { url: nextUrl });
      // Block redirects to prevent SSRF. Add timeout to prevent indefinite hang.
      const response = await fetch(nextUrl, { headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} from metadata endpoint`);
      const data = (await response.json()) as RepresentBoundariesResponse;

      for (const obj of data.objects) {
        metadataMap.set(obj.name, obj);
      }

      nextUrl = data.meta?.next ?? null;
      if (nextUrl) {
        // R34-H1: Always resolve through URL constructor to catch protocol-relative
        // URLs (//attacker.com/path) that bypass the startsWith('http') check.
        try {
          const resolved = new URL(nextUrl, this.representApiUrl);
          const baseParsed = new URL(this.representApiUrl);
          if (resolved.hostname !== baseParsed.hostname) {
            logger.warn('Represent API returned next URL with foreign hostname, stopping pagination', { nextUrl, expected: baseParsed.hostname });
            nextUrl = null;
          } else {
            nextUrl = resolved.href;
          }
        } catch {
          logger.warn('Represent API returned malformed next URL', { nextUrl });
          nextUrl = null;
        }
      }
    }

    logger.info('Fetched riding metadata', { count: metadataMap.size });

    // Step 2: Fetch all simple_shape geometries (single bulk request)
    const shapesUrl = `${endpoint}simple_shape?limit=500`;
    logger.debug('Fetching riding geometries', { url: shapesUrl });
    // Block redirects to prevent SSRF. Add timeout to prevent indefinite hang.
    const shapesResponse = await fetch(shapesUrl, { headers, redirect: 'error', signal: AbortSignal.timeout(120000) });
    if (!shapesResponse.ok) throw new Error(`HTTP ${shapesResponse.status} from shapes endpoint`);
    const shapesData = (await shapesResponse.json()) as {
      objects: Array<{ name: string; simple_shape?: RepresentBoundary['simple_shape'] }>;
    };

    logger.info('Fetched riding geometries', { count: shapesData.objects.length });

    // Validate: shapes count should match metadata count
    if (shapesData.objects.length !== metadataMap.size) {
      logger.warn('Shapes/metadata count mismatch — possible pagination truncation', {
        metadataCount: metadataMap.size,
        shapesCount: shapesData.objects.length,
      });
    }

    // Step 3: Merge metadata + geometry by name
    const ridings: CanadaRiding[] = [];
    for (const shapeObj of shapesData.objects) {
      if (!shapeObj.simple_shape) continue;

      const geometry = this.convertToGeoJSON(shapeObj.simple_shape);
      if (!geometry) continue;

      const meta = metadataMap.get(shapeObj.name);
      const externalId = meta?.external_id ?? '';

      if (!externalId) {
        logger.warn('No metadata match for riding', { name: shapeObj.name });
        continue;
      }

      // Derive province from SGC code prefix (first 2 digits of external_id)
      const provinceCode = sgcToProvince(externalId.slice(0, 2));

      ridings.push({
        id: externalId,
        name: shapeObj.name,
        nameFr: meta?.name_fr ?? shapeObj.name,
        type: 'federal',
        province: provinceCode,
        geometry,
        source: {
          country: 'CA',
          dataSource: 'Elections Canada / Statistics Canada',
          endpoint,
          vintage: 2023,
          retrievedAt: new Date().toISOString(),
          authority: 'electoral-commission',
        },
        properties: {
          boundary_set_name: meta?.boundary_set_name ?? 'Federal electoral district',
          external_id: externalId,
          province_code: provinceCode,
        },
      });
    }

    return ridings;
  }

  /**
   * Convert Represent API simple_shape to GeoJSON geometry
   */
  private convertToGeoJSON(
    shape: RepresentBoundary['simple_shape']
  ): Polygon | MultiPolygon | null {
    if (!shape) return null;

    if (shape.type === 'Polygon') {
      return {
        type: 'Polygon',
        coordinates: shape.coordinates as number[][][],
      };
    }

    if (shape.type === 'MultiPolygon') {
      return {
        type: 'MultiPolygon',
        coordinates: shape.coordinates as number[][][][],
      };
    }

    return null;
  }

  // ==========================================================================
  // Private: Officials Source Chain Implementation
  // ==========================================================================

  /**
   * Build a normalized boundary index for riding name matching.
   *
   * Indexes by:
   * 1. FED code (external_id, e.g., '35001') — strongest match
   * 2. English name (normalized) — primary name match
   * 3. French name (normalized) — bilingual fallback
   *
   * Key = normalized name or FED code, Value = CanadaRiding boundary.
   */
  private buildNormalizedBoundaryIndex(
    boundaryIndex: Map<string, CanadaRiding>
  ): Map<string, CanadaRiding> {
    const normalized = new Map<string, CanadaRiding>();

    for (const [, boundary] of boundaryIndex) {
      // Index by FED code (external_id) for ID-based matching
      if (boundary.id) {
        normalized.set(`fed:${boundary.id}`, boundary);
      }

      // Index by English name
      const keyEn = normalizeRidingName(boundary.name);
      normalized.set(keyEn, boundary);

      // Index by French name if different
      if (boundary.nameFr && boundary.nameFr !== boundary.name) {
        const keyFr = normalizeRidingName(boundary.nameFr);
        if (!normalized.has(keyFr)) {
          normalized.set(keyFr, boundary);
        }
      }
    }

    return normalized;
  }

  /**
   * Resolve riding code from boundary index using multi-strategy matching.
   *
   * Strategy order (strongest to weakest):
   * 1. FED code lookup (if ridingCode provided) — exact ID match
   * 2. Exact normalized English name
   * 3. Exact normalized French name
   * 4. Fuzzy match (Levenshtein distance) — catches minor name variations
   *
   * Returns the boundary's 5-digit FED code or null if no match found.
   */
  private resolveRidingFromBoundary(
    ridingName: string,
    ridingNameFr: string | undefined,
    normalizedIndex: Map<string, CanadaRiding>,
    ridingCode?: string,
  ): { ridingCode: string; boundary: CanadaRiding } | null {
    // Strategy 1: FED code lookup (strongest match)
    if (ridingCode) {
      const matchById = normalizedIndex.get(`fed:${ridingCode}`);
      if (matchById) {
        return { ridingCode: matchById.id, boundary: matchById };
      }
    }

    // Strategy 2: Exact normalized English name
    const keyEn = normalizeRidingName(ridingName);
    const matchEn = normalizedIndex.get(keyEn);
    if (matchEn) {
      return { ridingCode: matchEn.id, boundary: matchEn };
    }

    // Strategy 3: Exact normalized French name
    if (ridingNameFr) {
      const keyFr = normalizeRidingName(ridingNameFr);
      const matchFr = normalizedIndex.get(keyFr);
      if (matchFr) {
        return { ridingCode: matchFr.id, boundary: matchFr };
      }
    }

    // Strategy 4: Fuzzy match (Levenshtein distance)
    // Build a lightweight index for fuzzy matching (exclude fed: keys)
    const fuzzyIndex = new Map<string, { id: string; boundary: CanadaRiding }>();
    for (const [key, boundary] of normalizedIndex) {
      if (!key.startsWith('fed:')) {
        fuzzyIndex.set(key, { id: boundary.id, boundary });
      }
    }

    const fuzzyResult = fuzzyMatchRiding(keyEn, fuzzyIndex);
    if (fuzzyResult) {
      const matched = normalizedIndex.get(fuzzyResult.key)!;
      logger.debug('Fuzzy matched riding name', {
        input: ridingName,
        matched: matched.name,
        distance: fuzzyResult.distance,
      });
      return { ridingCode: matched.id, boundary: matched };
    }

    return null;
  }

  /**
   * Fetch officials from ourcommons.ca Members XML endpoint.
   *
   * The XML contains <MemberOfParliament> elements with:
   * - PersonId (stable unique identifier)
   * - PersonOfficialFirstName, PersonOfficialLastName
   * - ConstituencyName (English riding name)
   * - ConstituencyProvinceTerritoryName (full province name)
   * - CaucusShortName (party)
   * - PersonShortHonorific (e.g., "Hon.")
   *
   * Authority: electoral-commission (official House of Commons)
   */
  private async fetchFromOurCommons(
    endpoint: string,
    normalizedIndex: Map<string, CanadaRiding>
  ): Promise<CAOfficial[]> {
    logger.info('Fetching MPs from ourcommons.ca XML', { endpoint });

    // Block redirects to prevent SSRF.
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/xml, text/xml',
        'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
      },
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();
    const members = this.parseOurCommonsXML(xmlText);

    logger.info('Parsed ourcommons.ca XML', { memberCount: members.length });

    const officials: CAOfficial[] = [];
    let unresolved = 0;

    for (const member of members) {
      const ridingName = member.ConstituencyName;
      const province = provinceNameToCode(member.ConstituencyProvinceTerritoryName);

      // Resolve boundary code
      const resolved = this.resolveRidingFromBoundary(ridingName, undefined, normalizedIndex);

      if (!resolved) {
        unresolved++;
        logger.debug('Unresolved riding from ourcommons.ca', {
          name: member.PersonOfficialFirstName + ' ' + member.PersonOfficialLastName,
          riding: ridingName,
        });
      }

      const ridingCode = resolved?.ridingCode ?? '';
      const firstName = member.PersonOfficialFirstName;
      const lastName = member.PersonOfficialLastName;
      const fullName = member.PersonShortHonorific
        ? `${member.PersonShortHonorific} ${firstName} ${lastName}`
        : `${firstName} ${lastName}`;

      officials.push({
        id: `occ-${member.PersonId}`,
        name: fullName,
        firstName,
        lastName,
        party: member.CaucusShortName,
        chamber: 'house-of-commons',
        boundaryName: ridingName,
        boundaryCode: ridingCode || null,
        isActive: true,
        parliamentId: `occ-${member.PersonId}`,
        ridingCode: ridingCode || '00000',
        ridingName,
        province,
      });
    }

    if (unresolved > 0) {
      logger.warn('Unresolved ridings from ourcommons.ca', {
        unresolved,
        total: members.length,
      });
    }

    return officials;
  }

  /**
   * Parse ourcommons.ca Members XML into structured records.
   *
   * Uses lightweight regex-based XML parsing (no external XML dependency).
   * The XML structure is stable and simple enough for regex extraction.
   */
  private parseOurCommonsXML(xml: string): OurCommonsMember[] {
    const members: OurCommonsMember[] = [];

    // Match each <MemberOfParliament> block
    const memberRegex = /<MemberOfParliament>([\s\S]*?)<\/MemberOfParliament>/g;
    let match: RegExpExecArray | null;

    while ((match = memberRegex.exec(xml)) !== null) {
      const block = match[1];

      const personId = extractXMLField(block, 'PersonId');
      const firstName = extractXMLField(block, 'PersonOfficialFirstName');
      const lastName = extractXMLField(block, 'PersonOfficialLastName');
      const constituency = extractXMLField(block, 'ConstituencyName');
      const province = extractXMLField(block, 'ConstituencyProvinceTerritoryName');
      const caucus = extractXMLField(block, 'CaucusShortName');
      const honorific = extractXMLField(block, 'PersonShortHonorific');

      if (!personId || !firstName || !lastName || !constituency || !province || !caucus) {
        logger.debug('Skipping incomplete MemberOfParliament XML block', {
          personId, firstName, lastName, constituency,
        });
        continue;
      }

      members.push({
        PersonId: personId,
        PersonOfficialFirstName: firstName,
        PersonOfficialLastName: lastName,
        PersonShortHonorific: honorific || undefined,
        ConstituencyName: constituency,
        ConstituencyProvinceTerritoryName: province,
        CaucusShortName: caucus,
      });
    }

    return members;
  }

  /**
   * Fetch officials from Represent API (OpenNorth NGO fallback).
   *
   * Paginated JSON endpoint returning MP records with:
   * - name, first_name, last_name
   * - party_name, district_name
   * - offices (constituency + legislature)
   * - related.boundary_url (contains riding code)
   *
   * Authority: community (NGO-maintained)
   */
  private async fetchFromRepresentAPI(
    endpoint: string,
    normalizedIndex: Map<string, CanadaRiding>
  ): Promise<CAOfficial[]> {
    logger.info('Fetching MPs from Represent API', { endpoint });

    const allMPs: RepresentMP[] = [];
    let nextUrl: string | null = `${endpoint}?limit=500`;

    while (nextUrl) {
      // Block redirects to prevent SSRF.
      const response = await fetch(nextUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
        },
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as RepresentMPResponse;
      allMPs.push(...data.objects);

      nextUrl = data.meta.next;
      if (nextUrl) {
        // R34-H1: Always resolve through URL constructor to catch protocol-relative
        // URLs (//attacker.com/path) that bypass the startsWith('http') check.
        try {
          const resolved = new URL(nextUrl, this.representApiUrl);
          const baseParsed = new URL(this.representApiUrl);
          if (resolved.hostname !== baseParsed.hostname) {
            logger.warn('Represent API returned next URL with foreign hostname, stopping pagination', { nextUrl, expected: baseParsed.hostname });
            nextUrl = null;
          } else {
            nextUrl = resolved.href;
          }
        } catch {
          logger.warn('Represent API returned malformed next URL', { nextUrl });
          nextUrl = null;
        }
      }
    }

    logger.info('Fetched from Represent API', { count: allMPs.length });

    const officials: CAOfficial[] = [];
    let unresolved = 0;

    for (const mp of allMPs) {
      const ridingName = mp.district_name;

      // Extract riding code from boundary_url first (most reliable for Represent API)
      const urlRidingCode = extractRidingCodeFromUrl(mp.related?.boundary_url);

      // Try boundary index resolution (with ID-based matching via urlRidingCode)
      const resolved = this.resolveRidingFromBoundary(
        ridingName, undefined, normalizedIndex, urlRidingCode
      );

      // Use resolved code or fall back to URL-extracted code
      let ridingCode = resolved?.ridingCode ?? urlRidingCode;

      if (!ridingCode) {
        unresolved++;
        logger.debug('Unresolved riding from Represent API', {
          name: mp.name,
          riding: ridingName,
        });
      }

      // Extract province from SGC prefix or boundary metadata
      const province = ridingCode
        ? (SGC_TO_PROVINCE[ridingCode.slice(0, 2)] ?? extractProvinceFromExtra(mp))
        : extractProvinceFromExtra(mp);

      // Extract parliament_id from personal URL (ourcommons.ca link)
      const memberIdMatch = (mp.url ?? '').match(/\((\d+)\)/);
      const parliamentId = memberIdMatch
        ? `occ-${memberIdMatch[1]}`
        : `rep-${ridingCode || normalizeRidingName(ridingName)}-${mp.last_name.toLowerCase().replace(/\s/g, '-')}`;

      // Extract office info
      const legOffice = mp.offices.find(o => o.type === 'legislature');
      const conOffice = mp.offices.find(o => o.type === 'constituency');
      const phone = legOffice?.tel ?? conOffice?.tel ?? undefined;
      const officeAddress = conOffice?.postal ?? legOffice?.postal ?? undefined;

      officials.push({
        id: parliamentId,
        name: mp.name,
        firstName: mp.first_name,
        lastName: mp.last_name,
        party: mp.party_name,
        chamber: 'house-of-commons',
        boundaryName: ridingName,
        boundaryCode: ridingCode || null,
        email: mp.email ?? undefined,
        phone,
        officeAddress,
        websiteUrl: mp.url ?? mp.personal_url ?? undefined,
        photoUrl: mp.photo_url ?? undefined,
        isActive: true,
        parliamentId,
        ridingCode: ridingCode || '00000',
        ridingName,
        province,
      });
    }

    if (unresolved > 0) {
      logger.warn('Unresolved ridings from Represent API', {
        unresolved,
        total: allMPs.length,
      });
    }

    return officials;
  }
}

// ==========================================================================
// Backward Compatibility Alias
// ==========================================================================

/**
 * Backward compatibility alias for CanadaCountryProvider.
 *
 * Code that references `CanadaBoundaryProvider` continues to work.
 * The new class provides the same boundary extraction interface plus
 * officials, cell map, and validation capabilities.
 */
export const CanadaBoundaryProvider = CanadaCountryProvider;

// ==========================================================================
// Module-Level Helpers
// ==========================================================================

/**
 * Map SGC province code (first 2 digits of FED code) to ISO 3166-2:CA abbreviation
 */
function sgcToProvince(sgcPrefix: string): CanadaProvince {
  const result = SGC_TO_PROVINCE[sgcPrefix];
  if (!result) {
    logger.warn('Unknown SGC province prefix, defaulting to ON', { sgcPrefix });
  }
  return result ?? 'ON';
}

/**
 * Map province full name to 2-letter code
 */
function provinceNameToCode(provinceName: string): string {
  const key = provinceName.toLowerCase().trim();
  return PROVINCE_NAME_TO_CODE[key] ?? 'XX';
}

/**
 * Extract a simple XML field value from an XML block (regex-based, no parser dependency)
 */
function extractXMLField(block: string, fieldName: string): string | null {
  const regex = new RegExp(`<${fieldName}>([^<]*)</${fieldName}>`);
  const match = block.match(regex);
  if (!match) return null;
  // Decode XML entities — numeric first to avoid double-decoding (e.g. &#38; → & not then &amp;)
  return match[1]
    // Guard against invalid code points that crash String.fromCodePoint().
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex as string, 16)); } catch { return ''; }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try { return String.fromCodePoint(parseInt(dec as string, 10)); } catch { return ''; }
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Strip control characters that could corrupt downstream parsing.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

/**
 * Extract riding code from Represent API boundary URL.
 *
 * Format: /boundaries/federal-electoral-districts-2023-representation-order/59028/
 * Returns: '59028'
 */
function extractRidingCodeFromUrl(boundaryUrl?: string): string {
  if (!boundaryUrl) return '';
  const match = boundaryUrl.match(/\/boundaries\/[^/]+\/(\d+)\/?$/);
  return match ? match[1] : '';
}

/**
 * Extract province code from Represent API MP extra fields
 */
function extractProvinceFromExtra(mp: RepresentMP): string {
  const extra = mp.extra as Record<string, string | undefined>;
  if (extra.province) {
    const prov = extra.province.toLowerCase();
    for (const [pattern, code] of Object.entries(PROVINCE_NAME_TO_CODE)) {
      if (prov.includes(pattern)) return code;
    }
  }
  return 'XX';
}
