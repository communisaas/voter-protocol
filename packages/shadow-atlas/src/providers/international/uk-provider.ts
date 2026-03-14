/**
 * UK Country Provider — Unified Boundaries + Officials + Validation
 *
 * Extends CountryProvider to provide:
 * - Boundary extraction from ONS ArcGIS (existing, unchanged)
 * - Officials extraction from UK Parliament Members API (new)
 * - Cell map stub for ONS output areas (Wave 3)
 * - 4-layer validation pipeline (new)
 *
 * DATA SOURCES:
 * - Boundaries: ONS (Office for National Statistics) ArcGIS REST — authority: national-statistics
 * - Officials: UK Parliament Members API — authority: electoral-commission
 *
 * COVERAGE:
 * - Westminster Parliamentary Constituencies: 650 (July 2024 boundary review)
 * - House of Commons MPs: 650
 *
 * API ENDPOINTS:
 * - Boundaries: https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BFC/FeatureServer/0
 * - Officials: https://members-api.parliament.uk/api/Members/Search
 *
 * NOTES:
 * - ONS code join: Parliament API does NOT return ONS codes. Join by matching
 *   constituency name from API against boundary name from boundary index.
 * - PIP diagnostic: UK MPs commonly have Westminster offices (House of Commons,
 *   London SW1A 0AA) which are OUTSIDE their constituency. PIP mismatches are
 *   expected and flagged but NOT treated as errors.
 * - Honorifics: Parliament API returns names with titles ("Rt Hon Sir", "Ms",
 *   "Dame"). Stripped for matching but preserved in display name.
 */

import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import {
  type InternationalExtractionResult,
  type LayerConfig,
  type ProviderHealth,
  type LayerExtractionResult,
} from './base-provider.js';
import { CountryProvider } from './country-provider.js';
import type {
  OfficialRecord,
  OfficialsExtractionResult,
  CellMapResult,
  StatisticalUnitType,
  ValidationReport,
  SourceConfig,
  GeocoderFn,
  PIPCheckFn,
} from './country-provider-types.js';
import { UKMPSchema } from './country-provider-types.js';
import { logger } from '../../core/utils/logger.js';

// ============================================================================
// UK-Specific Types
// ============================================================================

/**
 * UK layer types
 */
export type UKLayerType = 'parliamentary';

/**
 * UK country subdivision
 */
export type UKCountry = 'England' | 'Scotland' | 'Wales' | 'Northern Ireland';

/**
 * UK parliamentary constituency
 */
export interface UKConstituency {
  /** ONS code (e.g., 'E14001234' for England, 'S14000001' for Scotland) */
  readonly id: string;

  /** Constituency name (e.g., 'Aberavon', 'Aberdeen North') */
  readonly name: string;

  /** Boundary type (e.g., 'parliamentary') */
  readonly type: UKLayerType;

  /** Country within UK */
  readonly country: UKCountry;

  /** English region (England only) */
  readonly region?: string;

  /** GeoJSON geometry */
  readonly geometry: Polygon | MultiPolygon;

  /** Source metadata */
  readonly source: {
    readonly country: 'GB';
    readonly dataSource: 'ONS';
    readonly endpoint: string;
    readonly vintage: number;
    readonly retrievedAt: string;
    readonly authority: 'national-statistics';
  };

  /** Original properties from ONS */
  readonly properties: Record<string, unknown>;
}

/**
 * UK extraction result
 */
export interface UKExtractionResult extends LayerExtractionResult {
  readonly layer: UKLayerType;
  readonly boundaries: readonly UKConstituency[];
}

/**
 * Layer metadata from ArcGIS service
 */
export interface LayerMetadata {
  readonly name: string;
  readonly description: string;
  readonly geometryType: string;
  readonly featureCount: number;
  readonly maxRecordCount: number;
  readonly lastEditDate?: number;
}

// ============================================================================
// UK Official Record
// ============================================================================

/**
 * UK MP official record — extends base OfficialRecord with UK-specific fields
 */
export interface UKOfficial extends OfficialRecord {
  /** UK Parliament member ID */
  readonly parliamentId: number;

  /** Constituency name from Parliament API */
  readonly constituencyName: string;

  /** ONS constituency code (resolved from boundary data) */
  readonly constituencyOnsCode?: string;
}

// ============================================================================
// UK Parliament API Response Types
// ============================================================================

interface UKParliamentMember {
  value: {
    id: number;
    nameListAs: string;
    nameDisplayAs: string;
    nameFullTitle: string;
    nameAddressAs: string | null;
    latestParty: {
      id: number;
      name: string;
      abbreviation: string;
    };
    gender: string;
    latestHouseMembership: {
      membershipFrom: string;
      membershipFromId: number;
      house: number;
      membershipStartDate: string;
      membershipEndDate: string | null;
      membershipStatus: {
        statusIsActive: boolean;
      };
    };
    thumbnailUrl: string;
  };
}

interface UKSearchResponse {
  items: UKParliamentMember[];
  totalResults: number;
  skip: number;
  take: number;
}

interface UKContactEntry {
  type: string;
  typeDescription: string;
  typeId: number;
  isPreferred: boolean;
  isWebAddress: boolean;
  notes: string | null;
  line1: string | null;
  line2: string | null;
  line3: string | null;
  line4: string | null;
  line5: string | null;
  postcode: string | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
}

interface UKContactResponse {
  value: UKContactEntry[];
}

// ============================================================================
// UK Country Provider
// ============================================================================

/**
 * UK Country Provider — unified boundaries, officials, cell map, and validation
 *
 * Inherits boundary extraction from BaseInternationalProvider (via CountryProvider).
 * Adds officials extraction from UK Parliament Members API, cell map stub,
 * and 4-layer validation pipeline.
 */
export class UKCountryProvider extends CountryProvider<
  UKLayerType,
  UKConstituency,
  UKOfficial
> {
  readonly country = 'GB';
  readonly countryName = 'United Kingdom';
  readonly dataSource = 'ONS (Office for National Statistics)';
  readonly apiType = 'arcgis-rest' as const;
  readonly license = 'OGL';

  private readonly baseUrl = 'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services';

  private static readonly PARLIAMENT_API_BASE = 'https://members-api.parliament.uk/api';
  private static readonly PAGE_SIZE = 20;
  private static readonly RATE_LIMIT_MS = 200;
  private static readonly EXPECTED_MP_COUNT = 650;

  // --------------------------------------------------------------------------
  // CountryProvider abstract property implementations
  // --------------------------------------------------------------------------

  /** Officials data sources in priority order */
  readonly officialsSources: readonly SourceConfig[] = [
    {
      name: 'UK Parliament Members API',
      endpoint: `${UKCountryProvider.PARLIAMENT_API_BASE}/Members/Search`,
      authority: 'electoral-commission',
      priority: 1,
    },
  ];

  /** Expected official count per chamber */
  readonly expectedOfficialCounts: ReadonlyMap<string, number> = new Map([
    ['house-of-commons', UKCountryProvider.EXPECTED_MP_COUNT],
  ]);

  /** Statistical geography unit type for Tree 2 cell maps */
  readonly statisticalUnit: StatisticalUnitType = 'output-area';

  /**
   * Available boundary layers
   */
  readonly layers: ReadonlyMap<UKLayerType, LayerConfig<UKLayerType>> = new Map([
    [
      'parliamentary',
      {
        type: 'parliamentary',
        name: 'Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BFC',
        endpoint: 'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BFC/FeatureServer/0',
        expectedCount: 650,
        updateSchedule: 'event-driven',
        authority: 'national-statistics',
        vintage: 2024,
        lastVerified: '2024-07-04T00:00:00.000Z',
      },
    ],
  ]);

  constructor(options?: { retryAttempts?: number; retryDelayMs?: number }) {
    super(options);
  }

  // ==========================================================================
  // Boundary Extraction (preserved from original UKBoundaryProvider)
  // ==========================================================================

  /**
   * Extract all available layers
   */
  async extractAll(): Promise<InternationalExtractionResult<UKLayerType, UKConstituency>> {
    const startTime = Date.now();
    const parliamentary = await this.extractLayer('parliamentary');

    return {
      country: this.country,
      layers: [parliamentary],
      totalBoundaries: parliamentary.actualCount,
      successfulLayers: parliamentary.success ? 1 : 0,
      failedLayers: parliamentary.success ? 0 : 1,
      extractedAt: new Date(),
      providerVersion: '2.0.0',
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Extract specific layer
   */
  async extractLayer(layerType: UKLayerType): Promise<LayerExtractionResult<UKLayerType, UKConstituency>> {
    switch (layerType) {
      case 'parliamentary':
        return this.extractParliamentaryConstituencies();
      default:
        throw new Error(`Unsupported layer type: ${layerType}`);
    }
  }

  /**
   * Extract parliamentary constituencies
   */
  async extractParliamentaryConstituencies(): Promise<UKExtractionResult> {
    const startTime = Date.now();
    const layer = this.layers.get('parliamentary');

    if (!layer) {
      throw new Error('Parliamentary layer configuration missing');
    }

    const endpoint = this.buildLayerEndpoint(layer.name);

    try {
      logger.info('Extracting parliamentary constituencies', { country: 'UK' });
      // ArcGIS FeatureServer requires /query with parameters to return GeoJSON.
      // Full UK geometry is large (~20MB), so we paginate with geometry simplification.
      const queryUrl = `${endpoint}/query?where=1%3D1&outFields=*&f=geojson`;
      const geojson = await this.fetchGeoJSONPaginated(queryUrl, 200, 650, 0.0001);
      const constituencies = this.normalizeConstituencies(geojson, endpoint);
      const durationMs = Date.now() - startTime;

      logger.info('Parliamentary extraction complete', {
        country: 'UK',
        constituencyCount: constituencies.length,
        expectedCount: layer.expectedCount,
        durationMs
      });

      // Calculate confidence
      const confidence = this.calculateConfidence(
        constituencies.length,
        layer.expectedCount,
        layer.vintage,
        layer.authority
      );

      return {
        layer: 'parliamentary',
        success: true,
        boundaries: constituencies,
        expectedCount: layer.expectedCount,
        actualCount: constituencies.length,
        matched: constituencies.length === layer.expectedCount,
        confidence,
        extractedAt: new Date(),
        source: endpoint,
        durationMs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Parliamentary extraction failed', { country: 'UK', error: message });

      return this.createFailedResult(
        'parliamentary',
        message,
        layer.expectedCount,
        endpoint,
        startTime
      );
    }
  }

  /**
   * Check if data has changed since last extraction
   */
  async hasChangedSince(lastExtraction: Date): Promise<boolean> {
    try {
      const metadata = await this.getLayerMetadata('parliamentary');

      // If we have lastEditDate from ArcGIS, use it
      if (metadata.lastEditDate) {
        const lastEdit = new Date(metadata.lastEditDate);
        return lastEdit > lastExtraction;
      }

      // Fallback to base implementation (HTTP headers)
      return super.hasChangedSince(lastExtraction);
    } catch (error) {
      logger.warn('Could not check for changes', {
        country: 'UK',
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  /**
   * Health check for provider availability
   */
  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      const metadata = await this.getLayerMetadata('parliamentary');
      const latencyMs = Date.now() - startTime;

      // Check if feature count is reasonable
      if (metadata.featureCount === 0) {
        issues.push('Layer reports zero features');
      }

      return {
        available: true,
        latencyMs,
        lastChecked: new Date(),
        issues,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`Failed to fetch metadata: ${message}`);

      return {
        available: false,
        latencyMs: Date.now() - startTime,
        lastChecked: new Date(),
        issues,
      };
    }
  }

  /**
   * Get layer metadata from ArcGIS service
   */
  async getLayerMetadata(layer: UKLayerType): Promise<LayerMetadata> {
    const layerConfig = this.layers.get(layer);

    if (!layerConfig) {
      throw new Error(`Layer configuration missing for ${layer}`);
    }

    const endpoint = this.buildLayerEndpoint(layerConfig.name);
    const metadataUrl = `${endpoint}?f=json`;

    const response = await fetch(metadataUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      name?: string;
      description?: string;
      geometryType?: string;
      count?: number;
      maxRecordCount?: number;
      editingInfo?: { lastEditDate?: number };
    };

    return {
      name: data.name ?? layerConfig.name,
      description: data.description ?? '',
      geometryType: data.geometryType ?? 'esriGeometryPolygon',
      featureCount: data.count ?? 0,
      maxRecordCount: data.maxRecordCount ?? 2000,
      lastEditDate: data.editingInfo?.lastEditDate,
    };
  }

  // ==========================================================================
  // Officials Extraction (CountryProvider abstract method)
  // ==========================================================================

  /**
   * Extract UK MPs from Parliament Members API with boundary code resolution.
   *
   * Pipeline:
   * 1. Fetch all House of Commons members (paginated)
   * 2. Fetch contact details per member (rate-limited)
   * 3. Join constituency name against boundary index for ONS code resolution
   * 4. Return officials with resolved boundary codes + diagnostics
   *
   * @param boundaryIndex - Map of constituency name to UKConstituency boundary
   */
  async extractOfficials(
    boundaryIndex: Map<string, UKConstituency>
  ): Promise<OfficialsExtractionResult<UKOfficial>> {
    const startTime = Date.now();

    const { result: officials, attempts } = await this.trySourceChain(
      this.officialsSources,
      async (_source) => {
        return this.fetchFromParliamentAPI(boundaryIndex);
      }
    );

    const expectedCount = UKCountryProvider.EXPECTED_MP_COUNT;
    const durationMs = Date.now() - startTime;

    return {
      country: this.country,
      officials,
      expectedCount,
      actualCount: officials.length,
      matched: officials.length === expectedCount,
      confidence: this.calculateConfidence(
        officials.length,
        expectedCount,
        new Date().getFullYear(),
        'electoral-commission'
      ),
      sources: attempts,
      extractedAt: new Date(),
      durationMs,
    };
  }

  // ==========================================================================
  // Cell Map (CountryProvider abstract method — Wave 3 stub)
  // ==========================================================================

  /**
   * Build cell map for Tree 2 using ONS output areas.
   *
   * NOT YET IMPLEMENTED — ONS output area integration is Wave 3.
   * UK has ~188,000 output areas that need to be mapped to constituencies.
   */
  async buildCellMap(
    _boundaries: UKConstituency[]
  ): Promise<CellMapResult> {
    throw new Error('ONS output area integration pending (Wave 3)');
  }

  // ==========================================================================
  // Validation (CountryProvider abstract method)
  // ==========================================================================

  /**
   * Run 4-layer validation pipeline for UK data.
   *
   * Layer 1: Source authority — ONS (national-statistics) + Parliament API (electoral-commission)
   * Layer 2: Schema — validate officials against UKMPSchema (80% threshold)
   * Layer 3: Code resolution — match officials against boundary index by constituency name
   * Layer 4: PIP — geocode office addresses and check containment (diagnostic only)
   *
   * NOTE: UK MPs commonly have Westminster offices (House of Commons, London SW1A 0AA)
   * outside their constituency. PIP mismatches are expected and flagged but not errors.
   */
  async validate(
    boundaries: UKConstituency[],
    officials: UKOfficial[],
    geocoder?: GeocoderFn,
    pipCheck?: PIPCheckFn,
  ): Promise<ValidationReport> {

    // --- Layer 1: Source Authority ---
    const boundarySources = [{
      name: 'ONS ArcGIS',
      authority: 'national-statistics' as const,
      vintage: 2024,
    }];
    // Build a synthetic attempts array from officials sources that succeeded
    const officialAttempts = [{
      source: 'UK Parliament Members API',
      success: true,
      durationMs: 0,
    }];
    const sourceAuthority = this.assessSourceAuthority(boundarySources, officialAttempts);

    // --- Layer 2: Schema & Count Validation ---
    const expectedCount = UKCountryProvider.EXPECTED_MP_COUNT;
    const schemaValidation = this.validateSchema(
      officials,
      UKMPSchema,
      expectedCount,
    );

    // --- Layer 3: Boundary Code Resolution ---
    const boundaryIndex = new Map<string, UKConstituency>();
    for (const b of boundaries) {
      boundaryIndex.set(b.name, b);
    }
    const codeResolution = this.resolveBoundaryCodes(
      officials,
      boundaryIndex,
      (official) => official.constituencyName,
      normalizeConstituencyName,
    );

    // --- Layer 4: PIP Verification ---
    let pipVerification: ValidationReport['layers']['pipVerification'];
    if (geocoder && pipCheck) {
      pipVerification = await this.verifyPIP(officials, geocoder, pipCheck);
    } else {
      // No geocoder/PIP functions provided — skip all
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
  // Private: Boundary Helpers
  // ==========================================================================

  /**
   * Build layer endpoint URL
   */
  private buildLayerEndpoint(layerName: string): string {
    return `${this.baseUrl}/${layerName}/FeatureServer/0`;
  }

  /**
   * Normalize GeoJSON features to UKConstituency format
   */
  private normalizeConstituencies(geojson: FeatureCollection, endpoint: string): UKConstituency[] {
    return geojson.features
      .filter((f) => {
        // Must have valid polygon geometry
        return f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
      })
      .map((f) => {
        const props = f.properties ?? {};

        // Extract ONS code and name
        const onsCode = String(props.PCON24CD ?? props.PCONCD ?? props.code ?? '');
        const name = String(props.PCON24NM ?? props.PCONNM ?? props.name ?? 'Unknown Constituency');

        // Determine country from ONS code prefix
        const country = this.determineCountry(onsCode);

        // Extract region (England only)
        const region = props.RGN24NM ?? props.RGNNM ?? undefined;

        return {
          id: onsCode,
          name,
          type: 'parliamentary',
          country,
          region: country === 'England' ? String(region) : undefined,
          geometry: f.geometry as Polygon | MultiPolygon,
          source: {
            country: 'GB',
            dataSource: 'ONS',
            endpoint,
            vintage: 2024,
            retrievedAt: new Date().toISOString(),
            authority: 'national-statistics',
          },
          properties: props,
        };
      });
  }

  /**
   * Determine UK country from ONS code prefix
   *
   * ONS codes follow pattern: E (England), S (Scotland), W (Wales), N (Northern Ireland)
   */
  private determineCountry(onsCode: string): UKCountry {
    const prefix = onsCode.charAt(0).toUpperCase();

    switch (prefix) {
      case 'E':
        return 'England';
      case 'S':
        return 'Scotland';
      case 'W':
        return 'Wales';
      case 'N':
        return 'Northern Ireland';
      default:
        return 'England'; // Default fallback
    }
  }

  // ==========================================================================
  // Private: Parliament API Fetching
  // ==========================================================================

  /**
   * Fetch all MPs from UK Parliament Members API and resolve boundary codes.
   *
   * @param boundaryIndex - Map of constituency name to boundary for code resolution
   * @returns Array of UKOfficial records with resolved boundary codes
   */
  private async fetchFromParliamentAPI(
    boundaryIndex: Map<string, UKConstituency>
  ): Promise<UKOfficial[]> {
    // Step 1: Fetch all House of Commons members
    const members = await this.fetchAllMembers();
    logger.info('Fetched MPs from Parliament API', {
      country: 'UK',
      count: members.length,
    });

    // Step 2: Fetch contact details (rate-limited)
    const contactMap = new Map<number, {
      email: string | null;
      phone: string | null;
      officeAddress: string | null;
      websiteUrl: string | null;
    }>();

    let contactsFetched = 0;
    for (const m of members) {
      const contact = await this.fetchContactDetails(m.value.id);
      contactMap.set(m.value.id, contact);
      contactsFetched++;
      if (contactsFetched % 50 === 0) {
        logger.info('Fetching contact details', {
          country: 'UK',
          progress: `${contactsFetched}/${members.length}`,
        });
      }
      await rateLimitedDelay(UKCountryProvider.RATE_LIMIT_MS);
    }

    // Step 3: Build officials with boundary code resolution
    // Build a normalized lookup: normalized name → boundary
    const normalizedBoundaryIndex = new Map<string, UKConstituency>();
    for (const [name, boundary] of boundaryIndex) {
      normalizedBoundaryIndex.set(normalizeConstituencyName(name), boundary);
    }

    const officials: UKOfficial[] = members.map((m) => {
      const v = m.value;
      const { firstName, lastName } = parseName(v.nameDisplayAs);
      const contact = contactMap.get(v.id);
      const constituencyName = v.latestHouseMembership.membershipFrom;

      // Resolve boundary code by matching constituency name
      const normalizedName = normalizeConstituencyName(constituencyName);
      const matchedBoundary = normalizedBoundaryIndex.get(normalizedName);
      const boundaryCode = matchedBoundary?.id ?? null;
      const constituencyOnsCode = matchedBoundary?.id;

      return {
        id: String(v.id),
        name: v.nameDisplayAs,
        firstName: firstName ?? undefined,
        lastName: lastName ?? undefined,
        party: v.latestParty.name,
        chamber: 'house-of-commons',
        boundaryName: constituencyName,
        boundaryCode,
        email: contact?.email ?? undefined,
        phone: contact?.phone ?? undefined,
        officeAddress: contact?.officeAddress ?? undefined,
        websiteUrl: contact?.websiteUrl ?? undefined,
        photoUrl: v.thumbnailUrl,
        isActive: v.latestHouseMembership.membershipStatus.statusIsActive,
        parliamentId: v.id,
        constituencyName,
        constituencyOnsCode,
      };
    });

    const resolved = officials.filter(o => o.boundaryCode !== null).length;
    const unresolved = officials.length - resolved;
    logger.info('UK officials boundary code resolution', {
      country: 'UK',
      total: officials.length,
      resolved,
      unresolved,
    });

    return officials;
  }

  /**
   * Fetch all House of Commons members (paginated)
   */
  private async fetchAllMembers(): Promise<UKParliamentMember[]> {
    const allMembers: UKParliamentMember[] = [];
    let skip = 0;

    while (true) {
      const url =
        `${UKCountryProvider.PARLIAMENT_API_BASE}/Members/Search` +
        `?House=1&IsCurrentMember=true&skip=${skip}&take=${UKCountryProvider.PAGE_SIZE}`;

      logger.debug('Fetching MPs page', { country: 'UK', skip, take: UKCountryProvider.PAGE_SIZE });

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`Parliament API HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as UKSearchResponse;
      allMembers.push(...data.items);

      logger.debug('Fetched MPs page', {
        country: 'UK',
        fetched: data.items.length,
        total: allMembers.length,
        expected: data.totalResults,
      });

      if (allMembers.length >= data.totalResults || data.items.length === 0) {
        break;
      }

      skip += UKCountryProvider.PAGE_SIZE;
      await rateLimitedDelay(UKCountryProvider.RATE_LIMIT_MS);
    }

    return allMembers;
  }

  /**
   * Fetch contact details for a single member
   */
  private async fetchContactDetails(memberId: number): Promise<{
    email: string | null;
    phone: string | null;
    officeAddress: string | null;
    websiteUrl: string | null;
  }> {
    try {
      const url = `${UKCountryProvider.PARLIAMENT_API_BASE}/Members/${memberId}/Contact`;
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return { email: null, phone: null, officeAddress: null, websiteUrl: null };
      }

      const data = (await response.json()) as UKContactResponse;

      let email: string | null = null;
      let phone: string | null = null;
      let officeAddress: string | null = null;
      let websiteUrl: string | null = null;

      for (const entry of data.value) {
        if (entry.email && !email) {
          email = entry.email;
        }
        if (entry.phone && !phone) {
          phone = entry.phone;
        }
        if (entry.line1 && !officeAddress) {
          const parts = [entry.line1, entry.line2, entry.line3, entry.line4, entry.line5, entry.postcode]
            .filter(Boolean);
          officeAddress = parts.join(', ');
        }
        if (entry.isWebAddress && entry.line1 && !websiteUrl) {
          websiteUrl = entry.line1;
        }
      }

      return { email, phone, officeAddress, websiteUrl };
    } catch {
      return { email: null, phone: null, officeAddress: null, websiteUrl: null };
    }
  }
}

// ============================================================================
// Backward Compatibility Alias
// ============================================================================

/**
 * @deprecated Use UKCountryProvider instead. This alias is preserved for
 * backward compatibility with existing code that imports UKBoundaryProvider.
 */
export const UKBoundaryProvider = UKCountryProvider;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Rate-limited delay
 */
function rateLimitedDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Normalize constituency name for matching.
 *
 * - Lowercase
 * - Trim whitespace
 * - Normalize "and" / "&" variations
 * - Strip extra whitespace
 *
 * UK constituencies have unique names, so this simple normalization
 * is sufficient (no ambiguity expected).
 */
function normalizeConstituencyName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\band\b/g, '&')
    .replace(/\s+/g, ' ');
}

/**
 * Parse display name, stripping honorifics.
 *
 * "Ms Diane Abbott" -> { firstName: "Diane", lastName: "Abbott" }
 * "Rt Hon Sir Keir Starmer" -> { firstName: "Keir", lastName: "Starmer" }
 * "Dame Angela Eagle" -> { firstName: "Angela", lastName: "Eagle" }
 */
function parseName(displayName: string): { firstName: string | null; lastName: string | null } {
  const parts = displayName.split(' ');
  const honorifics = ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Sir', 'Dame', 'Rt', 'Hon', 'Lord', 'Lady', 'Prof'];

  // Strip honorifics from the beginning
  let startIdx = 0;
  while (startIdx < parts.length && honorifics.includes(parts[startIdx].replace(/\./g, ''))) {
    startIdx++;
  }

  const nameParts = parts.slice(startIdx);
  if (nameParts.length === 0) {
    return { firstName: null, lastName: null };
  }

  if (nameParts.length === 1) {
    return { firstName: nameParts[0], lastName: null };
  }

  return {
    firstName: nameParts[0],
    lastName: nameParts.slice(1).join(' '),
  };
}
