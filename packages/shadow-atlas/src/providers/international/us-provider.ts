/**
 * US Country Provider — Unified Boundaries + Officials + Validation
 *
 * Extends CountryProvider to provide:
 * - Boundary extraction via Census TIGERweb ArcGIS REST (cd layer)
 * - Officials extraction from unitedstates/congress-legislators YAML
 * - Cell map stub (US already has Tree 2 via build-tree2.ts)
 * - 4-layer validation pipeline
 *
 * DATA SOURCES:
 * - Boundaries: US Census Bureau TIGER/Line — authority: constitutional
 *   The existing TIGERBoundaryProvider handles full multi-layer US extraction
 *   (cd, sldu, sldl, county, place, etc.). This provider wraps the federal
 *   legislative layer (cd) for the unified CountryProvider interface.
 * - Officials: unitedstates/congress-legislators YAML (CC0, GitHub) — authority: constitutional
 *
 * COVERAGE:
 * - Congressional Districts: 435 (+ 6 non-voting delegates)
 * - House of Representatives: 435 voting + 6 delegates = 441
 * - Senate: 100
 * - Total officials: 541
 *
 * BOUNDARY ID FORMAT:
 * - Congressional Districts: cd-SSDD (state FIPS + district, e.g., cd-0601 = CA-01)
 * - State Legislative Upper: sldu-SSNNN
 * - State Legislative Lower: sldl-SSNNN
 *
 * NOTES:
 * - US boundaries are primarily managed through the standalone TIGER pipeline
 *   (tiger-boundary-provider.ts, state-boundary-provider.ts). This provider
 *   unifies the officials extraction under the CountryProvider abstraction.
 * - US is at L5 readiness — the most mature country. ZK proofs work.
 * - Cell map (Tree 2) is already built via build-tree2.ts using census tracts.
 * - The extractAll() method fetches congressional districts from TIGERweb
 *   ArcGIS REST for the unified pipeline. Full TIGER extraction (11 layers)
 *   remains in the standalone pipeline.
 *
 * @see ingest-legislators.ts for the original standalone officials script
 * @see tiger-boundary-provider.ts for the full TIGER extraction pipeline
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
import { USFederalMemberSchema } from './country-provider-types.js';
import { logger } from '../../core/utils/logger.js';
import { STATE_TO_FIPS, TERRITORIES } from '../../db/fips-codes.js';

// ============================================================================
// US-Specific Types
// ============================================================================

/**
 * US layer types for the unified provider.
 *
 * The full TIGER pipeline supports 11+ layers. This provider focuses on
 * the federal legislative layers relevant to the officials pipeline.
 */
export type USLayerType = 'congressional';

/**
 * US congressional district boundary
 */
export interface USDistrict {
  /** District GEOID (e.g., '0601' for CA-01) */
  readonly id: string;

  /** District name (e.g., 'Congressional District 1') */
  readonly name: string;

  /** Boundary type */
  readonly type: USLayerType;

  /** State FIPS code */
  readonly stateFips: string;

  /** State abbreviation */
  readonly stateAbbr: string;

  /** District number (padded to 2 digits) */
  readonly district: string;

  /** GeoJSON geometry */
  readonly geometry: Polygon | MultiPolygon;

  /** Source metadata */
  readonly source: {
    readonly country: 'US';
    readonly dataSource: 'Census TIGER';
    readonly endpoint: string;
    readonly vintage: number;
    readonly retrievedAt: string;
    readonly authority: 'constitutional';
  };

  /** Original properties from TIGER */
  readonly properties: Record<string, unknown>;
}

/**
 * US extraction result
 */
export interface USExtractionResult extends LayerExtractionResult {
  readonly layer: USLayerType;
  readonly boundaries: readonly USDistrict[];
}

// ============================================================================
// US Official Record
// ============================================================================

/**
 * US federal official record — extends base OfficialRecord with congress-specific fields
 */
export interface USOfficial extends OfficialRecord {
  /** Bioguide ID (e.g., 'A000055') */
  readonly bioguideId: string;

  /** Chamber: house or senate */
  readonly chamber: 'house' | 'senate';

  /** Two-letter state abbreviation */
  readonly state: string;

  /** District number (House only, padded to 2 digits) */
  readonly district?: string;

  /** Senate class (1, 2, or 3) — Senate only */
  readonly senateClass?: number;

  /** State FIPS code */
  readonly stateFips: string;

  /** Congressional district GEOID (state FIPS + district) — House only */
  readonly cdGeoid?: string;

  /** CWC (Communicating with Congress) code — House only */
  readonly cwcCode?: string;

  /** Whether the member has voting rights */
  readonly isVoting: boolean;

  /** Delegate type for non-voting members */
  readonly delegateType?: string;

  /** Contact form URL */
  readonly contactFormUrl?: string;
}

// ============================================================================
// Congress-Legislators YAML Types
// ============================================================================

interface LegislatorYaml {
  id: {
    bioguide: string;
    thomas?: string;
    lis?: string;
    govtrack?: number;
    opensecrets?: string;
    fec?: string[];
  };
  name: {
    first: string;
    last: string;
    middle?: string;
    suffix?: string;
    nickname?: string;
    official_full?: string;
  };
  bio: {
    birthday?: string;
    gender?: string;
  };
  terms: TermYaml[];
}

interface TermYaml {
  type: 'rep' | 'sen';
  start: string;
  end: string;
  state: string;
  district?: number;
  class?: number;
  party: string;
  url?: string;
  address?: string;
  phone?: string;
  contact_form?: string;
  office?: string;
  state_rank?: string;
}

// At-large states (single congressional district)
const AT_LARGE_STATES = new Set(['AK', 'DE', 'MT', 'ND', 'SD', 'VT', 'WY']);

// ============================================================================
// TIGERweb ArcGIS REST Constants
// ============================================================================

const TIGERWEB_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb';
const CD_LAYER_URL = `${TIGERWEB_BASE}/tigerWMS_Current/MapServer/54`;
const EXPECTED_CD_COUNT = 444; // 435 districts + 6 non-voting delegate districts + 3 at-large redistricted

// ============================================================================
// Congress-Legislators Constants
// ============================================================================

const LEGISLATORS_URL =
  'https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml';
const EXPECTED_TOTAL_OFFICIALS = 541; // 435 House + 100 Senate + 6 delegates

// ============================================================================
// US Country Provider
// ============================================================================

/**
 * US Country Provider — unified boundaries, officials, cell map, and validation
 *
 * Wraps the US-specific data sources (TIGER boundaries, congress-legislators YAML)
 * under the unified CountryProvider abstraction.
 *
 * NOTE: US is the most mature country in the system (L5 readiness). The full
 * TIGER pipeline (11 layers, 95K+ districts) is handled by TIGERBoundaryProvider.
 * This provider focuses on the federal legislative layer + officials for the
 * unified hydration pipeline.
 */
export class USCountryProvider extends CountryProvider<
  USLayerType,
  USDistrict,
  USOfficial
> {
  readonly country = 'US';
  readonly countryName = 'United States';
  readonly dataSource = 'US Census Bureau TIGER/Line + Congress Legislators';
  readonly apiType = 'census-api' as const;
  readonly license = 'CC0-1.0';

  // --------------------------------------------------------------------------
  // CountryProvider abstract property implementations
  // --------------------------------------------------------------------------

  /** Officials data sources in priority order */
  readonly officialsSources: readonly SourceConfig[] = [
    {
      name: 'unitedstates/congress-legislators YAML',
      endpoint: LEGISLATORS_URL,
      authority: 'constitutional',
      priority: 1,
    },
  ];

  /** Expected official count per chamber */
  readonly expectedOfficialCounts: ReadonlyMap<string, number> = new Map([
    ['house', 435],
    ['senate', 100],
    ['delegates', 6],
  ]);

  /** Statistical geography unit type for Tree 2 cell maps */
  readonly statisticalUnit: StatisticalUnitType = 'census-tract';

  /**
   * Available boundary layers
   *
   * Only congressional districts are exposed through the unified provider.
   * Full TIGER extraction (sldu, sldl, county, place, etc.) remains in
   * the standalone TIGERBoundaryProvider pipeline.
   */
  readonly layers: ReadonlyMap<USLayerType, LayerConfig<USLayerType>> = new Map([
    [
      'congressional',
      {
        type: 'congressional',
        name: 'Congressional Districts (119th Congress)',
        endpoint: CD_LAYER_URL,
        expectedCount: EXPECTED_CD_COUNT,
        updateSchedule: 'decennial',
        authority: 'constitutional',
        vintage: 2024,
        lastVerified: '2024-01-01T00:00:00.000Z',
        notes: '119th Congress — 435 voting districts + 6 non-voting delegate districts (layer 54)',
      },
    ],
  ]);

  constructor(options?: { retryAttempts?: number; retryDelayMs?: number }) {
    super(options);
  }

  // ==========================================================================
  // Boundary Extraction
  // ==========================================================================

  /**
   * Extract all available layers (congressional districts from TIGERweb)
   */
  async extractAll(): Promise<InternationalExtractionResult<USLayerType, USDistrict>> {
    const startTime = Date.now();
    const congressional = await this.extractLayer('congressional');

    return {
      country: this.country,
      layers: [congressional],
      totalBoundaries: congressional.actualCount,
      successfulLayers: congressional.success ? 1 : 0,
      failedLayers: congressional.success ? 0 : 1,
      extractedAt: new Date(),
      providerVersion: '1.0.0',
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Extract specific layer
   */
  async extractLayer(layerType: USLayerType): Promise<LayerExtractionResult<USLayerType, USDistrict>> {
    switch (layerType) {
      case 'congressional':
        return this.extractCongressionalDistricts();
      default:
        throw new Error(`Unsupported layer type: ${layerType}`);
    }
  }

  /**
   * Extract congressional districts from TIGERweb ArcGIS REST
   */
  private async extractCongressionalDistricts(): Promise<USExtractionResult> {
    const startTime = Date.now();
    const layer = this.layers.get('congressional');

    if (!layer) {
      throw new Error('Congressional layer configuration missing');
    }

    try {
      logger.info('Extracting congressional districts', { country: 'US' });

      const queryUrl = `${CD_LAYER_URL}/query?where=1%3D1&outFields=*&f=geojson`;
      const geojson = await this.fetchGeoJSONPaginated(queryUrl, 200, EXPECTED_CD_COUNT, 0.001);
      const districts = this.normalizeDistricts(geojson, CD_LAYER_URL);
      const durationMs = Date.now() - startTime;

      logger.info('Congressional district extraction complete', {
        country: 'US',
        districtCount: districts.length,
        expectedCount: layer.expectedCount,
        durationMs,
      });

      const confidence = this.calculateConfidence(
        districts.length,
        layer.expectedCount,
        layer.vintage,
        layer.authority,
      );

      return {
        layer: 'congressional',
        success: true,
        boundaries: districts,
        expectedCount: layer.expectedCount,
        actualCount: districts.length,
        matched: districts.length === layer.expectedCount,
        confidence,
        extractedAt: new Date(),
        source: CD_LAYER_URL,
        durationMs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Congressional district extraction failed', { country: 'US', error: message });

      return this.createFailedResult(
        'congressional',
        message,
        layer.expectedCount,
        CD_LAYER_URL,
        startTime,
      );
    }
  }

  /**
   * Check if data has changed since last extraction
   */
  async hasChangedSince(lastExtraction: Date): Promise<boolean> {
    // TIGER data updates annually — check via base HTTP header method
    return super.hasChangedSince(lastExtraction);
  }

  /**
   * Health check for provider availability
   */
  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      // Test TIGERweb availability
      // Block redirects to prevent SSRF via compromised upstream.
      const response = await fetch(`${CD_LAYER_URL}?f=json`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
        },
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });

      if (!response.ok) {
        issues.push(`TIGERweb HTTP ${response.status}: ${response.statusText}`);
      }

      return {
        available: response.ok,
        latencyMs: Date.now() - startTime,
        lastChecked: new Date(),
        issues,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`TIGERweb connection failed: ${message}`);

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
   * Extract US federal officials from congress-legislators YAML.
   *
   * Pipeline:
   * 1. Fetch legislators-current.yaml from GitHub
   * 2. Parse YAML into structured records
   * 3. Build boundary codes using cd-SSDD format
   * 4. Resolve House members against boundary index
   * 5. Return officials with resolved boundary codes + diagnostics
   *
   * @param boundaryIndex - Map of district name/id to USDistrict boundary
   */
  async extractOfficials(
    boundaryIndex: Map<string, USDistrict>,
  ): Promise<OfficialsExtractionResult<USOfficial>> {
    const startTime = Date.now();

    const { result: officials, attempts } = await this.trySourceChain(
      this.officialsSources,
      async (_source) => {
        return this.fetchFromCongressLegislators(boundaryIndex);
      },
    );

    const expectedCount = EXPECTED_TOTAL_OFFICIALS;
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
        'constitutional',
      ),
      sources: attempts,
      extractedAt: new Date(),
      durationMs,
    };
  }

  // ==========================================================================
  // Cell Map (CountryProvider abstract method — US already has Tree 2)
  // ==========================================================================

  /**
   * Build cell map for Tree 2 using census tracts.
   *
   * NOT IMPLEMENTED via this provider — US Tree 2 cell maps are already
   * built through the standalone build-tree2.ts pipeline, which maps
   * ~85,000 census tracts to congressional districts. This provider
   * exposes the stub for interface compliance.
   *
   * @see packages/shadow-atlas/src/tree-builder.ts
   */
  async buildCellMap(
    _boundaries: USDistrict[],
  ): Promise<CellMapResult> {
    throw new Error(
      'US cell map is built via the standalone build-tree2.ts pipeline. ' +
      'Use buildCellMapTree() from tree-builder.ts with census tract data.'
    );
  }

  // ==========================================================================
  // Validation (CountryProvider abstract method)
  // ==========================================================================

  /**
   * Run 4-layer validation pipeline for US data.
   *
   * Layer 1: Source authority — Census TIGER (constitutional) + congress-legislators (constitutional)
   * Layer 2: Schema — validate officials against USFederalMemberSchema (80% threshold)
   * Layer 3: Code resolution — match officials against boundary index by cd-SSDD code
   * Layer 4: PIP — geocode office addresses and check containment (diagnostic only)
   */
  async validate(
    boundaries: USDistrict[],
    officials: USOfficial[],
    geocoder?: GeocoderFn,
    pipCheck?: PIPCheckFn,
  ): Promise<ValidationReport> {

    // --- Layer 1: Source Authority ---
    const boundarySources = [{
      name: 'Census TIGER',
      authority: 'constitutional' as const,
      vintage: 2024,
    }];
    const officialAttempts = [{
      source: 'unitedstates/congress-legislators YAML',
      success: true,
      durationMs: 0,
    }];
    const sourceAuthority = this.assessSourceAuthority(boundarySources, officialAttempts);

    // --- Layer 2: Schema & Count Validation ---
    const schemaValidation = this.validateSchema(
      officials,
      USFederalMemberSchema,
      EXPECTED_TOTAL_OFFICIALS,
    );

    // --- Layer 3: Boundary Code Resolution ---
    // For US, code resolution is done by cd-SSDD GEOID matching, not name matching.
    // Build a GEOID-keyed index from boundaries.
    const geoidIndex = new Map<string, USDistrict>();
    for (const b of boundaries) {
      geoidIndex.set(b.id, b);
    }

    // House members resolve by cdGeoid, Senate members have no district boundary
    const houseOfficials = officials.filter(o => o.chamber === 'house');
    const codeResolution = this.resolveBoundaryCodes(
      houseOfficials,
      geoidIndex,
      (official) => official.cdGeoid ?? '',
      (code) => code.trim(),
    );

    // --- Layer 4: PIP Verification ---
    let pipVerification: ValidationReport['layers']['pipVerification'];
    if (geocoder && pipCheck) {
      pipVerification = await this.verifyPIP(officials, geocoder, pipCheck);
    } else {
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
   * Normalize GeoJSON features to USDistrict format
   */
  private normalizeDistricts(geojson: FeatureCollection, endpoint: string): USDistrict[] {
    return geojson.features
      .filter((f) => {
        return f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
      })
      .map((f) => {
        const props = f.properties ?? {};

        // TIGERweb CD properties: GEOID, BASENAME, STATE, CD, LSAD, etc.
        const geoid = String(props.GEOID ?? props.CD119 ?? props.CD116 ?? '');
        const stateFips = geoid.substring(0, 2);
        const district = geoid.substring(2, 4);
        const stateAbbr = FIPS_TO_STATE_ABBR[stateFips] ?? '';
        const name = String(
          props.BASENAME ?? props.NAMELSAD ?? props.NAME ?? `Congressional District ${district}`,
        );

        return {
          id: geoid,
          name,
          type: 'congressional' as USLayerType,
          stateFips,
          stateAbbr,
          district,
          geometry: f.geometry as Polygon | MultiPolygon,
          source: {
            country: 'US' as const,
            dataSource: 'Census TIGER',
            endpoint,
            vintage: 2024,
            retrievedAt: new Date().toISOString(),
            authority: 'constitutional' as const,
          },
          properties: props,
        };
      });
  }

  // ==========================================================================
  // Private: Congress-Legislators Fetching
  // ==========================================================================

  /**
   * Fetch and parse congress-legislators YAML, resolving boundary codes.
   *
   * @param boundaryIndex - Map of boundary id/name to boundary for code resolution
   * @returns Array of USOfficial records
   */
  private async fetchFromCongressLegislators(
    boundaryIndex: Map<string, USDistrict>,
  ): Promise<USOfficial[]> {
    // Step 1: Fetch YAML
    logger.info('Fetching congress-legislators YAML', { country: 'US' });
    // Block redirects to prevent SSRF via compromised upstream.
    const response = await fetch(LEGISLATORS_URL, {
      headers: { 'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0' },
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch legislators: ${response.status} ${response.statusText}`);
    }

    const yamlText = await response.text();
    logger.info('Fetched congress-legislators YAML', {
      country: 'US',
      sizeKB: (yamlText.length / 1024).toFixed(1),
    });

    // Step 2: Parse YAML
    // Dynamic import to avoid bundling yaml parser when not needed
    const { parse: parseYaml } = await import('yaml');
    const raw = parseYaml(yamlText);

    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error(`Expected YAML array of legislators, got ${typeof raw}`);
    }

    const legislators = raw as LegislatorYaml[];
    logger.info('Parsed congress-legislators', {
      country: 'US',
      count: legislators.length,
    });

    // Step 3: Build boundary GEOID index for code resolution
    const geoidIndex = new Map<string, USDistrict>();
    for (const [_key, boundary] of boundaryIndex) {
      geoidIndex.set(boundary.id, boundary);
    }

    // Step 4: Map to USOfficial records
    const officials: USOfficial[] = [];

    for (const leg of legislators) {
      if (!leg.terms || leg.terms.length === 0) continue;

      const currentTerm = leg.terms[leg.terms.length - 1];
      if (!currentTerm) continue;

      const bioguide = leg.id.bioguide;
      const stateAbbr = currentTerm.state;
      const chamber: 'house' | 'senate' = currentTerm.type === 'sen' ? 'senate' : 'house';

      // Build display name
      const officialName = leg.name.official_full
        || `${leg.name.first} ${leg.name.last}${leg.name.suffix ? ' ' + leg.name.suffix : ''}`;

      // District (House only)
      let district: string | undefined;
      if (chamber === 'house') {
        if (currentTerm.district !== undefined && currentTerm.district !== null) {
          district = currentTerm.district.toString().padStart(2, '0');
        } else if (AT_LARGE_STATES.has(stateAbbr) || TERRITORIES.has(stateAbbr)) {
          district = '00';
        }
      }

      // FIPS codes
      const stateFips = STATE_TO_FIPS[stateAbbr] ?? '';

      // Congressional district GEOID (state FIPS + district)
      let cdGeoid: string | undefined;
      if (chamber === 'house' && stateFips && district) {
        cdGeoid = `${stateFips}${district}`;
      }

      // Boundary code resolution
      let boundaryCode: string | null = null;
      let boundaryName = '';

      if (chamber === 'house' && cdGeoid) {
        // House members resolve by GEOID
        const matchedBoundary = geoidIndex.get(cdGeoid);
        boundaryCode = matchedBoundary?.id ?? cdGeoid;
        boundaryName = matchedBoundary?.name ?? `${stateAbbr}-${district}`;
      } else if (chamber === 'senate') {
        // Senate members don't have a specific district boundary
        // Use state FIPS as boundary code (maps to the state)
        boundaryCode = stateFips || null;
        boundaryName = stateAbbr;
      }

      // CWC code (House only)
      let cwcCode: string | undefined;
      if (chamber === 'house' && district) {
        cwcCode = `H${stateAbbr}${district}`;
      }

      // Voting status
      const isTerritory = TERRITORIES.has(stateAbbr);
      const isVoting = !isTerritory;
      let delegateType: string | undefined;
      if (isTerritory && chamber === 'house') {
        delegateType = stateAbbr === 'PR' ? 'resident_commissioner' : 'delegate';
      }

      // Party normalization
      const party = normalizeParty(currentTerm.party);

      officials.push({
        // OfficialRecord base fields
        id: bioguide,
        name: officialName,
        firstName: leg.name.first,
        lastName: leg.name.last,
        party,
        chamber,
        boundaryName,
        boundaryCode,
        phone: currentTerm.phone ?? undefined,
        officeAddress: currentTerm.address ?? currentTerm.office ?? undefined,
        websiteUrl: currentTerm.url ?? undefined,
        isActive: true,

        // USOfficial-specific fields
        bioguideId: bioguide,
        state: stateAbbr,
        district,
        senateClass: currentTerm.class ?? undefined,
        stateFips,
        cdGeoid,
        cwcCode,
        isVoting,
        delegateType,
        contactFormUrl: currentTerm.contact_form ?? undefined,
      });
    }

    // Log stats
    const house = officials.filter(o => o.chamber === 'house');
    const senate = officials.filter(o => o.chamber === 'senate');
    const delegates = officials.filter(o => !o.isVoting);
    logger.info('US officials parsed', {
      country: 'US',
      total: officials.length,
      house: house.length,
      senate: senate.length,
      delegates: delegates.length,
      withBoundaryCode: officials.filter(o => o.boundaryCode !== null).length,
    });

    return officials;
  }
}

// ============================================================================
// Backward Compatibility Alias
// ============================================================================

/**
 * @deprecated Use USCountryProvider instead. This alias is preserved for
 * backward compatibility with existing code that may import USBoundaryProvider.
 */
export const USBoundaryProvider = USCountryProvider;

// ============================================================================
// Utility: FIPS to State Abbreviation Lookup
// ============================================================================

/**
 * Reverse lookup from FIPS code to state abbreviation.
 * Derived from STATE_TO_FIPS in fips-codes.ts.
 */
const FIPS_TO_STATE_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_TO_FIPS).map(([state, fips]) => [fips, state]),
);

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Normalize party name for consistency.
 */
function normalizeParty(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower === 'democrat' || lower === 'democratic') return 'Democrat';
  if (lower === 'republican') return 'Republican';
  if (lower === 'independent' || lower === 'libertarian' || lower === 'green') return raw;
  return raw;
}
