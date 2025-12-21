/**
 * State Batch Extractor
 *
 * Orchestrates legislative boundary extraction from state GIS portals.
 * Uses the state-gis-portals registry for endpoint configuration and
 * the provider base classes for API interaction.
 *
 * USAGE:
 * ```typescript
 * const extractor = new StateBatchExtractor();
 *
 * // Extract all legislative boundaries for Wisconsin
 * const result = await extractor.extractState('WI');
 *
 * // Extract congressional districts only
 * const cd = await extractor.extractLayer('WI', 'congressional');
 *
 * // Extract all configured states
 * const all = await extractor.extractAllStates();
 * ```
 *
 * AUTHORITY HIERARCHY:
 * During redistricting gaps (Jan-Jun of years ending in 2), state sources
 * may have newer data than TIGER. The extractor respects this hierarchy:
 * 1. state-redistricting-commission (WI LTSB, CO IRC)
 * 2. state-gis (TX TNRIS, FL, NC)
 * 3. census-tiger (fallback)
 *
 * @see state-gis-portals.ts for endpoint configuration
 * @see state-boundary-provider.ts for provider implementations
 * @see tiger-authority-rules.ts for precedence logic
 */

import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import {
  STATE_GIS_PORTALS,
  getStatesWithLegislativeData,
  getLegislativeEndpoint,
  type StateGISPortal,
  type LegislativeLayer,
  type LegislativeLayerType,
  type StateAuthorityLevel,
} from '../registry/state-gis-portals.js';

// Re-export types for external use
export type { LegislativeLayerType, StateAuthorityLevel } from '../registry/state-gis-portals.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Extracted boundary record (normalized output)
 */
export interface ExtractedBoundary {
  /** Unique identifier (GEOID format) */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** District/boundary type */
  readonly layerType: LegislativeLayerType;

  /** GeoJSON geometry */
  readonly geometry: Polygon | MultiPolygon;

  /** Source metadata */
  readonly source: {
    readonly state: string;
    readonly portalName: string;
    readonly endpoint: string;
    readonly authority: StateAuthorityLevel | 'state-gis';
    readonly vintage: number;
    readonly retrievedAt: string;
  };

  /** Original properties from source */
  readonly properties: Record<string, unknown>;
}

/**
 * Layer extraction result
 */
export interface LayerExtractionResult {
  readonly state: string;
  readonly layerType: LegislativeLayerType;
  readonly success: boolean;
  readonly featureCount: number;
  readonly expectedCount: number;
  readonly boundaries: readonly ExtractedBoundary[];
  readonly metadata: {
    readonly endpoint: string;
    readonly extractedAt: string;
    readonly durationMs: number;
  };
  readonly error?: string;
}

/**
 * State extraction result (all layers for one state)
 */
export interface StateExtractionResult {
  readonly state: string;
  readonly stateName: string;
  readonly authority: StateAuthorityLevel | undefined;
  readonly layers: readonly LayerExtractionResult[];
  readonly summary: {
    readonly totalBoundaries: number;
    readonly layersSucceeded: number;
    readonly layersFailed: number;
    readonly durationMs: number;
  };
}

/**
 * Batch extraction result (all states)
 */
export interface BatchExtractionResult {
  readonly states: readonly StateExtractionResult[];
  readonly summary: {
    readonly totalStates: number;
    readonly statesSucceeded: number;
    readonly statesFailed: number;
    readonly totalBoundaries: number;
    readonly durationMs: number;
  };
}

// ============================================================================
// State Batch Extractor
// ============================================================================

/**
 * State Batch Extractor
 *
 * Extracts legislative boundaries from state GIS portals using
 * the configured endpoints in state-gis-portals.ts.
 */
export class StateBatchExtractor {
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;

  constructor(options?: { retryAttempts?: number; retryDelayMs?: number }) {
    this.retryAttempts = options?.retryAttempts ?? 3;
    this.retryDelayMs = options?.retryDelayMs ?? 1000;
  }

  /**
   * Extract a single layer from a state
   */
  async extractLayer(
    state: string,
    layerType: LegislativeLayerType
  ): Promise<LayerExtractionResult> {
    const startTime = Date.now();
    const stateUpper = state.toUpperCase();

    const portal = STATE_GIS_PORTALS[stateUpper];
    if (!portal) {
      return this.failedResult(stateUpper, layerType, `State ${state} not found in registry`, startTime);
    }

    const layer = getLegislativeEndpoint(stateUpper, layerType);
    if (!layer) {
      return this.failedResult(stateUpper, layerType, `Layer ${layerType} not configured for ${state}`, startTime);
    }

    try {
      console.log(`[${portal.stateName}] Extracting ${layerType}...`);
      const stateFips = this.getStateFips(stateUpper);
      const geojson = await this.fetchGeoJSON(layer.endpoint, stateFips);
      const boundaries = this.normalizeFeatures(geojson, portal, layer);

      const durationMs = Date.now() - startTime;
      console.log(`[${portal.stateName}] ✓ ${layerType}: ${boundaries.length}/${layer.expectedCount} features (${durationMs}ms)`);

      return {
        state: stateUpper,
        layerType,
        success: true,
        featureCount: boundaries.length,
        expectedCount: layer.expectedCount,
        boundaries,
        metadata: {
          endpoint: layer.endpoint,
          extractedAt: new Date().toISOString(),
          durationMs,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${portal.stateName}] ✗ ${layerType}: ${message}`);
      return this.failedResult(stateUpper, layerType, message, startTime, layer.endpoint, layer.expectedCount);
    }
  }

  /**
   * Check if a layer should be skipped for a state
   *
   * Handles unicameral legislatures and special jurisdictions:
   * - Nebraska: Unicameral (49 senators, no state house)
   * - DC: City Council (8 wards, not a state legislature)
   */
  private shouldSkipLayer(state: string, layerType: LegislativeLayerType): boolean {
    const stateUpper = state.toUpperCase();

    // Nebraska: Unicameral legislature - no state house
    if (stateUpper === 'NE' && layerType === 'state_house') {
      console.log(`   Skipping ${layerType} for NE (unicameral legislature)`);
      return true;
    }

    // DC: City Council, not a state legislature - skip both chambers
    if (stateUpper === 'DC' && (layerType === 'state_senate' || layerType === 'state_house')) {
      console.log(`   Skipping ${layerType} for DC (city council, not state legislature)`);
      return true;
    }

    return false;
  }

  /**
   * Extract all configured layers for a state
   */
  async extractState(state: string): Promise<StateExtractionResult> {
    const startTime = Date.now();
    const stateUpper = state.toUpperCase();

    const portal = STATE_GIS_PORTALS[stateUpper];
    if (!portal) {
      return {
        state: stateUpper,
        stateName: state,
        authority: undefined,
        layers: [],
        summary: {
          totalBoundaries: 0,
          layersSucceeded: 0,
          layersFailed: 1,
          durationMs: Date.now() - startTime,
        },
      };
    }

    const layers = portal.legislativeDistrictLayers ?? [];
    const results: LayerExtractionResult[] = [];

    for (const layer of layers) {
      // Skip layers that don't apply to this state (unicameral, etc.)
      if (this.shouldSkipLayer(stateUpper, layer.type)) {
        continue;
      }
      const result = await this.extractLayer(stateUpper, layer.type);
      results.push(result);
    }

    const succeeded = results.filter(r => r.success).length;
    const totalBoundaries = results.reduce((sum, r) => sum + r.featureCount, 0);

    return {
      state: stateUpper,
      stateName: portal.stateName,
      authority: portal.legislativeAuthority,
      layers: results,
      summary: {
        totalBoundaries,
        layersSucceeded: succeeded,
        layersFailed: results.length - succeeded,
        durationMs: Date.now() - startTime,
      },
    };
  }

  /**
   * Extract all configured states
   */
  async extractAllStates(): Promise<BatchExtractionResult> {
    const startTime = Date.now();
    const statesWithData = getStatesWithLegislativeData();

    console.log(`\nExtracting ${statesWithData.length} states with legislative data...\n`);

    const results: StateExtractionResult[] = [];

    for (const portal of statesWithData) {
      console.log(`\n=== ${portal.stateName} (${portal.state}) ===`);
      const result = await this.extractState(portal.state);
      results.push(result);
    }

    const succeeded = results.filter(r => r.summary.layersFailed === 0).length;
    const totalBoundaries = results.reduce((sum, r) => sum.summary.totalBoundaries + r.summary.totalBoundaries, 0 as any);

    return {
      states: results,
      summary: {
        totalStates: statesWithData.length,
        statesSucceeded: succeeded,
        statesFailed: statesWithData.length - succeeded,
        totalBoundaries: typeof totalBoundaries === 'number' ? totalBoundaries : 0,
        durationMs: Date.now() - startTime,
      },
    };
  }

  /**
   * Fetch GeoJSON from endpoint with retry logic
   *
   * @param endpoint - Base endpoint URL
   * @param stateFips - State FIPS code for TIGERweb filtering
   */
  private async fetchGeoJSON(endpoint: string, stateFips?: string): Promise<FeatureCollection> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        // Build query URL based on endpoint type
        const url = this.buildQueryUrl(endpoint, stateFips);
        console.log(`   Fetching: ${url.substring(0, 80)}... (attempt ${attempt}/${this.retryAttempts})`);

        const response = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as FeatureCollection;

        if (!data.features || !Array.isArray(data.features)) {
          throw new Error('Invalid GeoJSON: missing features array');
        }

        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`   Attempt ${attempt} failed: ${lastError.message}`);

        if (attempt < this.retryAttempts) {
          const delay = Math.pow(2, attempt) * this.retryDelayMs;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError ?? new Error('Fetch failed');
  }

  /**
   * Build query URL based on endpoint format
   *
   * Handles:
   * - ArcGIS FeatureServer: Add /query?where=1=1&f=geojson
   * - ArcGIS MapServer: Add /query?where=1=1&f=geojson
   * - TIGERweb: Add state filter (where=STATE='XX')
   * - Socrata: Already has ?method=export&format=GeoJSON
   */
  private buildQueryUrl(endpoint: string, stateFips?: string): string {
    // Socrata endpoints already have query params
    if (endpoint.includes('method=export')) {
      return endpoint;
    }

    // TIGERweb Legislative endpoints need state filter
    if (endpoint.includes('tigerweb.geo.census.gov') && stateFips) {
      const separator = endpoint.includes('?') ? '&' : '/query?';
      return `${endpoint}${separator}where=STATE%3D%27${stateFips}%27&outFields=*&f=geojson`;
    }

    // ArcGIS FeatureServer/MapServer - add query params
    if (endpoint.includes('FeatureServer') || endpoint.includes('MapServer')) {
      const separator = endpoint.includes('?') ? '&' : '/query?';
      return `${endpoint}${separator}where=1%3D1&outFields=*&f=geojson`;
    }

    // Other endpoints - return as-is
    return endpoint;
  }

  /**
   * Normalize GeoJSON features to ExtractedBoundary format
   *
   * Filters out:
   * - Features without valid geometry
   * - TIGERweb "ZZ" districts (undefined/water areas)
   */
  private normalizeFeatures(
    geojson: FeatureCollection,
    portal: StateGISPortal,
    layer: LegislativeLayer
  ): ExtractedBoundary[] {
    return geojson.features
      .filter(f => {
        // Must have valid polygon geometry
        if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) {
          return false;
        }

        // Exclude TIGERweb "ZZ"/"ZZZ" pseudo-districts
        // These represent water areas (Lake Michigan in IL) or undefined legislative territories
        // Pattern: Congressional uses "ZZ" suffix, State Legislative uses "ZZZ" suffix
        // Examples: "17ZZ" (IL CD water), "17ZZZ" (IL state leg water)
        const geoid = String(f.properties?.GEOID ?? '');
        if (/ZZ+$/.test(geoid)) {
          console.debug(`   Filtering pseudo-district: ${geoid} (water/undefined area)`);
          return false;
        }

        return true;
      })
      .map(f => this.normalizeFeature(f, portal, layer));
  }

  /**
   * Normalize a single feature
   */
  private normalizeFeature(
    feature: Feature,
    portal: StateGISPortal,
    layer: LegislativeLayer
  ): ExtractedBoundary {
    const props = feature.properties ?? {};

    // Extract standard identifiers (multiple naming conventions)
    const geoid = this.extractGeoid(props, portal.state, layer.type);
    const name = this.extractName(props, layer.type);

    return {
      id: geoid,
      name,
      layerType: layer.type,
      geometry: feature.geometry as Polygon | MultiPolygon,
      source: {
        state: portal.state,
        portalName: portal.stateName,
        endpoint: layer.endpoint,
        authority: portal.legislativeAuthority ?? 'state-gis',
        vintage: layer.vintage,
        retrievedAt: new Date().toISOString(),
      },
      properties: props,
    };
  }

  /**
   * Extract GEOID from feature properties
   *
   * Handles multiple naming conventions across state portals:
   * - GEOID, GEOID20 (Census standard)
   * - DISTRICT, DISTRICTNO, DIST_NO (State conventions)
   * - CD, CD116, CD118 (Congressional district codes)
   * - SLDUST, SLDLST (State legislative upper/lower)
   */
  private extractGeoid(
    props: Record<string, unknown>,
    stateFips: string,
    layerType: LegislativeLayerType
  ): string {
    // Try standard GEOID first
    if (props['GEOID']) return String(props['GEOID']);
    if (props['GEOID20']) return String(props['GEOID20']);
    if (props['geoid']) return String(props['geoid']);

    // Build GEOID from state + district number
    const stateFipsCode = this.getStateFips(stateFips);
    let districtNum = '';

    // Congressional districts
    if (layerType === 'congressional') {
      districtNum = String(
        props['CD'] ?? props['CD118'] ?? props['CD116'] ?? props['DISTRICT'] ?? props['district'] ?? ''
      );
    }

    // State Senate
    if (layerType === 'state_senate') {
      districtNum = String(
        props['SLDUST'] ?? props['DISTRICT'] ?? props['DIST_NO'] ?? props['district'] ?? ''
      );
    }

    // State House
    if (layerType === 'state_house') {
      districtNum = String(
        props['SLDLST'] ?? props['DISTRICT'] ?? props['DIST_NO'] ?? props['district'] ?? ''
      );
    }

    // County
    if (layerType === 'county') {
      districtNum = String(
        props['COUNTYFP'] ?? props['COUNTY_FIPS'] ?? props['FIPS'] ?? props['fips'] ?? ''
      );
    }

    // Pad district number to standard width
    const paddedDistrict = districtNum.padStart(layerType === 'county' ? 3 : 2, '0');
    return `${stateFipsCode}${paddedDistrict}`;
  }

  /**
   * Extract name from feature properties
   */
  private extractName(props: Record<string, unknown>, layerType: LegislativeLayerType): string {
    // Try common name fields
    const nameFields = ['NAMELSAD', 'NAME', 'name', 'DISTRICT_NAME', 'district_name'];

    for (const field of nameFields) {
      if (props[field]) return String(props[field]);
    }

    // Fall back to district number
    const districtNum = props['DISTRICT'] ?? props['district'] ?? props['DIST_NO'] ?? '';
    if (districtNum) {
      const typeLabel = layerType === 'congressional' ? 'Congressional District'
        : layerType === 'state_senate' ? 'State Senate District'
          : layerType === 'state_house' ? 'State House District'
            : 'District';
      return `${typeLabel} ${districtNum}`;
    }

    return 'Unknown District';
  }

  /**
   * Get state FIPS code from state abbreviation
   *
   * Complete mapping for all 50 US states + DC.
   * FIPS codes are standardized by the US Census Bureau.
   */
  private getStateFips(state: string): string {
    const fipsMap: Record<string, string> = {
      'AL': '01', 'AK': '02', 'AZ': '04', 'AR': '05', 'CA': '06',
      'CO': '08', 'CT': '09', 'DE': '10', 'DC': '11', 'FL': '12',
      'GA': '13', 'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18',
      'IA': '19', 'KS': '20', 'KY': '21', 'LA': '22', 'ME': '23',
      'MD': '24', 'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28',
      'MO': '29', 'MT': '30', 'NE': '31', 'NV': '32', 'NH': '33',
      'NJ': '34', 'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38',
      'OH': '39', 'OK': '40', 'OR': '41', 'PA': '42', 'RI': '44',
      'SC': '45', 'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49',
      'VT': '50', 'VA': '51', 'WA': '53', 'WV': '54', 'WI': '55',
      'WY': '56',
    };
    return fipsMap[state.toUpperCase()] ?? '00';
  }

  /**
   * Create a failed result
   */
  private failedResult(
    state: string,
    layerType: LegislativeLayerType,
    error: string,
    startTime: number,
    endpoint?: string,
    expectedCount?: number
  ): LayerExtractionResult {
    return {
      state,
      layerType,
      success: false,
      featureCount: 0,
      expectedCount: expectedCount ?? 0,
      boundaries: [],
      metadata: {
        endpoint: endpoint ?? '',
        extractedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      },
      error,
    };
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Extract legislative boundaries for a single state
 */
export async function extractStateBoundaries(state: string): Promise<StateExtractionResult> {
  const extractor = new StateBatchExtractor();
  return extractor.extractState(state);
}

/**
 * Extract a specific layer from a state
 */
export async function extractLayer(
  state: string,
  layerType: LegislativeLayerType
): Promise<LayerExtractionResult> {
  const extractor = new StateBatchExtractor();
  return extractor.extractLayer(state, layerType);
}

/**
 * Extract all configured states
 */
export async function extractAllStateBoundaries(): Promise<BatchExtractionResult> {
  const extractor = new StateBatchExtractor();
  return extractor.extractAllStates();
}
