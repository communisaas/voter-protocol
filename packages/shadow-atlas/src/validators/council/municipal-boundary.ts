/**
 * Municipal Boundary Resolver
 *
 * Fetches authoritative city boundaries from TIGER/Census data.
 * These boundaries are the ground truth anchor for tessellation proofs.
 *
 * ARCHITECTURE:
 * - Primary source: Census TIGER PLACE boundaries (authoritative)
 * - Caching: In-memory LRU cache with file-backed persistence
 * - Fallback: State-level GIS portals for incorporated places
 *
 * WHY TIGER:
 * - Official US Census Bureau source
 * - Complete coverage of all incorporated places
 * - Standardized FIPS codes for reliable matching
 * - Annual updates (typically July)
 */

import type { Feature, Polygon, MultiPolygon } from 'geojson';

// =============================================================================
// Types
// =============================================================================

export interface MunicipalBoundary {
  /** Census PLACE FIPS code */
  readonly fips: string;

  /** Place name from Census */
  readonly name: string;

  /** State FIPS code */
  readonly stateFips: string;

  /** State abbreviation */
  readonly stateAbbr: string;

  /** Boundary polygon */
  readonly geometry: Feature<Polygon | MultiPolygon>;

  /** Total area (land + water) in square meters */
  readonly areaSqM: number;

  /** Land area in square meters (for coverage calculations) */
  readonly landAreaSqM: number;

  /** Water area in square meters */
  readonly waterAreaSqM: number;

  /** Data vintage (year) */
  readonly vintage: number;

  /** Retrieval timestamp */
  readonly retrievedAt: string;
}

export interface ResolutionResult {
  readonly success: boolean;
  readonly boundary: MunicipalBoundary | null;
  readonly error: string | null;
  readonly source: 'cache' | 'tiger' | 'fallback';
}

// =============================================================================
// TIGER Place Boundary Resolver
// =============================================================================

/**
 * TIGER Census Place URL builder
 *
 * Census TIGERweb provides authoritative place boundaries via REST API.
 * URL pattern: https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/28/query
 *
 * Layer 28 = Incorporated Places (in tigerWMS_Current service)
 */
function buildTigerPlaceUrl(stateFips: string, placeFips: string): string {
  // Full GEOID is stateFips + placeFips (e.g., "06" + "44000" = "0644000" for LA)
  const geoid = `${stateFips}${placeFips}`;

  const baseUrl =
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/28/query';

  const params = new URLSearchParams({
    where: `GEOID='${geoid}'`,
    outFields: 'GEOID,NAME,STATE,AREALAND,AREAWATER',
    f: 'geojson',
    outSR: '4326',
    returnGeometry: 'true',
  });

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Parse FIPS code into components
 *
 * Supports two formats:
 * - 7-digit city FIPS: 2-digit state + 5-digit place (e.g., "0667000" = San Francisco)
 * - 5-digit county FIPS: 2-digit state + 3-digit county (e.g., "06075" = SF County)
 */
interface ParsedFips {
  stateFips: string;
  entityFips: string;
  entityType: 'place' | 'county';
}

function parseFips(fips: string): ParsedFips | null {
  // 7-digit = city/place FIPS
  if (/^\d{7}$/.test(fips)) {
    return {
      stateFips: fips.slice(0, 2),
      entityFips: fips.slice(2),
      entityType: 'place',
    };
  }

  // 5-digit = county FIPS
  if (/^\d{5}$/.test(fips)) {
    return {
      stateFips: fips.slice(0, 2),
      entityFips: fips.slice(2),
      entityType: 'county',
    };
  }

  return null;
}

/**
 * State FIPS to abbreviation mapping
 */
const STATE_ABBR: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY', '72': 'PR',
};

/**
 * Consolidated city-counties: PLACE FIPS → COUNTY FIPS
 *
 * These jurisdictions merged city and county government.
 * Council districts cover the entire county, not just the Census Place.
 * We use county boundaries for validation instead.
 */
const CONSOLIDATED_CITY_COUNTIES: Record<string, { countyFips: string; name: string }> = {
  '1235000': { countyFips: '12031', name: 'Jacksonville-Duval' },      // Jacksonville, FL
  '4752006': { countyFips: '47037', name: 'Nashville-Davidson' },      // Nashville, TN
  '2148006': { countyFips: '21111', name: 'Louisville-Jefferson' },    // Louisville, KY
  '1836003': { countyFips: '18097', name: 'Indianapolis-Marion' },     // Indianapolis, IN
  '0820000': { countyFips: '08031', name: 'Denver' },                  // Denver, CO
  '0667000': { countyFips: '06075', name: 'San Francisco' },           // San Francisco, CA
  '0203000': { countyFips: '02020', name: 'Anchorage' },               // Anchorage, AK
  // NOTE: Honolulu REMOVED from consolidated city-counties
  // Honolulu County (15003) includes Northwestern Hawaiian Islands 1000km northwest of Oahu.
  // City council districts only cover Oahu island. Using county boundary causes 824km
  // centroid failures. Instead, Honolulu needs authoritative boundary from city GIS.
  // See AUTHORITATIVE_BOUNDARIES below for the correct configuration.
};

/**
 * Authoritative City Boundaries: Cities where we use their own GIS boundary
 *
 * TIGER PLACE boundaries sometimes don't match governance boundaries:
 * - Portland: TIGER includes areas not covered by council districts (74.5% coverage)
 * - Austin: TIGER includes ETJ (Extraterritorial Jurisdiction), 3x larger than city limits (23% coverage)
 * - NYC: TIGER boundary vintage doesn't align with 2022 redistricting (55% coverage)
 *
 * These cities publish their own authoritative boundaries that match their council districts.
 * We use these instead of TIGER for accurate tessellation validation.
 */
interface AuthoritativeBoundaryConfig {
  /** URL to fetch boundary GeoJSON */
  url: string;
  /** City name */
  name: string;
  /** Land area in sq meters (for coverage calculations, if known) */
  landAreaSqM?: number;
  /** Water area in sq meters (for coastal detection, if known) */
  waterAreaSqM?: number;
  /** Property name containing the boundary name (for validation) */
  nameField?: string;
  /** Reason for using authoritative boundary instead of TIGER */
  reason: string;
}

const AUTHORITATIVE_BOUNDARIES: Record<string, AuthoritativeBoundaryConfig> = {
  // Portland, OR - City's own boundary from Portland Maps
  // TIGER shows 74.5% coverage because it includes annexed areas not yet in council districts
  '4159000': {
    url: 'https://www.portlandmaps.com/arcgis/rest/services/Public/Boundaries/MapServer/13/query?where=1=1&outFields=*&returnGeometry=true&f=geojson',
    name: 'Portland',
    nameField: 'NAME',
    reason: 'TIGER includes annexed areas not covered by council districts (2023 redistricting based on 2020 Census)',
  },

  // NOTE: Austin (4805000) removed - the issue was the district layer, not the boundary.
  // BOUNDARIES_single_member_districts had incorrect geometry (union=75 sq mi).
  // Corrected to use Council_Districts layer (union=348 sq mi) which covers TIGER properly.
  // See known-portals.ts for the correct district URL.

  // NOTE: NYC (3651000) intentionally NOT included in authoritative boundaries
  // The borough boundary polygons from NYC Open Data have geometry winding issues
  // that cause turf.area to return negative values and turf.union to fail.
  // The 55% coverage against TIGER is a known limitation - NYC council districts
  // from the 2022 redistricting don't align with TIGER 2024 boundaries.
  // Manual verification confirms the district data is correct.
};

/**
 * TIGER County Boundary URL builder
 * Layer 82 = Counties in tigerWMS_Current
 */
function buildTigerCountyUrl(countyFips: string): string {
  const baseUrl =
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/82/query';

  const params = new URLSearchParams({
    where: `GEOID='${countyFips}'`,
    outFields: 'GEOID,NAME,STATE,AREALAND,AREAWATER',
    f: 'geojson',
    outSR: '4326',
    returnGeometry: 'true',
  });

  return `${baseUrl}?${params.toString()}`;
}

// =============================================================================
// Municipal Boundary Resolver
// =============================================================================

export class MunicipalBoundaryResolver {
  private readonly cache = new Map<string, MunicipalBoundary>();

  /**
   * Resolve municipal boundary by FIPS code
   *
   * Resolution order:
   * 1. Cache (if available)
   * 2. Authoritative city boundary (for cities with TIGER mismatches)
   * 3. Consolidated city-county boundary (for merged jurisdictions)
   * 4. TIGER PLACE boundary (default)
   *
   * @param fips - 7-digit Census PLACE FIPS code
   * @returns Resolution result with boundary or error
   */
  async resolve(fips: string): Promise<ResolutionResult> {
    // Check cache first
    const cached = this.cache.get(fips);
    if (cached) {
      return {
        success: true,
        boundary: cached,
        error: null,
        source: 'cache',
      };
    }

    // Parse FIPS
    const parsed = parseFips(fips);
    if (!parsed) {
      return {
        success: false,
        boundary: null,
        error: `Invalid FIPS format: ${fips} (expected 5 or 7 digits)`,
        source: 'tiger',
      };
    }

    // Check for authoritative city boundary (takes precedence over TIGER)
    // Only applies to place FIPS (7-digit)
    if (parsed.entityType === 'place') {
      const authoritative = AUTHORITATIVE_BOUNDARIES[fips];
      if (authoritative) {
        const result = await this.resolveAuthoritative(fips, authoritative, parsed);
        if (result.success) {
          return result;
        }
        // Fall through to TIGER if authoritative fails
      }
    }

    // Determine URL based on entity type
    let url: string;
    if (parsed.entityType === 'county') {
      // 5-digit county FIPS - use layer 82
      url = buildTigerCountyUrl(fips);
    } else {
      // 7-digit place FIPS - check for consolidated city-county
      const consolidated = CONSOLIDATED_CITY_COUNTIES[fips];
      url = consolidated
        ? buildTigerCountyUrl(consolidated.countyFips)
        : buildTigerPlaceUrl(parsed.stateFips, parsed.entityFips);
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'VOTER-Protocol/1.0 (Municipal-Boundary-Resolution)',
          Accept: 'application/geo+json, application/json',
        },
      });

      if (!response.ok) {
        return {
          success: false,
          boundary: null,
          error: `TIGER API returned ${response.status}`,
          source: 'tiger',
        };
      }

      const data = await response.json();

      // Validate response structure
      if (!data.features || data.features.length === 0) {
        const entityTypeName = parsed.entityType === 'county' ? 'county' : 'place';
        return {
          success: false,
          boundary: null,
          error: `No ${entityTypeName} found for FIPS ${fips}`,
          source: 'tiger',
        };
      }
      const consolidated = parsed.entityType === 'place' ? CONSOLIDATED_CITY_COUNTIES[fips] : null;

      const feature = data.features[0];
      const props = feature.properties || {};

      // Construct boundary record
      const landArea = Number(props.AREALAND) || 0;
      const waterArea = Number(props.AREAWATER) || 0;

      const boundary: MunicipalBoundary = {
        fips,
        name: consolidated ? consolidated.name : (props.NAME || 'Unknown'),
        stateFips: parsed.stateFips,
        stateAbbr: STATE_ABBR[parsed.stateFips] || 'XX',
        geometry: feature,
        areaSqM: landArea + waterArea,
        landAreaSqM: landArea,
        waterAreaSqM: waterArea,
        vintage: new Date().getFullYear(),
        retrievedAt: new Date().toISOString(),
      };

      // Cache result
      this.cache.set(fips, boundary);

      return {
        success: true,
        boundary,
        error: null,
        source: 'tiger',
      };
    } catch (error) {
      return {
        success: false,
        boundary: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        source: 'tiger',
      };
    }
  }

  /**
   * Resolve boundary from authoritative city source
   *
   * Used for cities where TIGER boundaries don't match governance boundaries:
   * - Portland: TIGER includes annexed areas not in council districts
   * - Austin: TIGER includes ETJ (Extraterritorial Jurisdiction)
   * - NYC: TIGER vintage doesn't match 2022 redistricting
   */
  private async resolveAuthoritative(
    fips: string,
    config: AuthoritativeBoundaryConfig,
    parsed: ParsedFips
  ): Promise<ResolutionResult> {
    try {
      const response = await fetch(config.url, {
        headers: {
          'User-Agent': 'VOTER-Protocol/1.0 (Authoritative-Boundary-Resolution)',
          Accept: 'application/geo+json, application/json',
        },
      });

      if (!response.ok) {
        return {
          success: false,
          boundary: null,
          error: `Authoritative source returned ${response.status} for ${config.name}`,
          source: 'fallback',
        };
      }

      const data = await response.json();

      // Validate response structure
      if (!data.features || data.features.length === 0) {
        return {
          success: false,
          boundary: null,
          error: `No features found in authoritative source for ${config.name}`,
          source: 'fallback',
        };
      }

      // Import turf for geometry operations
      const turf = await import('@turf/turf');

      // Rewind all features to ensure correct winding order (GeoJSON requires CCW exterior rings)
      // ArcGIS often returns CW polygons - use turf.rewind to normalize
      const rewoundFeatures = data.features.map((f: Feature<Polygon | MultiPolygon>) =>
        turf.rewind(f, { reverse: false, mutate: false }) as Feature<Polygon | MultiPolygon>
      );

      // For multi-feature responses (like NYC boroughs), compute union
      let geometry: Feature<Polygon | MultiPolygon>;
      if (rewoundFeatures.length === 1) {
        geometry = rewoundFeatures[0];
      } else {
        // Multiple features - union them into single boundary
        geometry = await this.unionFeaturesAsync(rewoundFeatures);
      }

      // Use configured areas or compute from geometry
      const computedArea = turf.area(geometry);

      const landArea = config.landAreaSqM ?? computedArea;
      const waterArea = config.waterAreaSqM ?? 0;

      const boundary: MunicipalBoundary = {
        fips,
        name: config.name,
        stateFips: parsed.stateFips,
        stateAbbr: STATE_ABBR[parsed.stateFips] || 'XX',
        geometry,
        areaSqM: landArea + waterArea,
        landAreaSqM: landArea,
        waterAreaSqM: waterArea,
        vintage: new Date().getFullYear(),
        retrievedAt: new Date().toISOString(),
      };

      // Cache result
      this.cache.set(fips, boundary);

      return {
        success: true,
        boundary,
        error: null,
        source: 'fallback', // 'fallback' indicates non-TIGER source
      };
    } catch (error) {
      return {
        success: false,
        boundary: null,
        error: `Authoritative resolution failed for ${config.name}: ${error instanceof Error ? error.message : 'Unknown'}`,
        source: 'fallback',
      };
    }
  }

  /**
   * Reverse polygon winding order (CW <-> CCW)
   * Used to fix ArcGIS polygons that have clockwise winding (which gives negative area in turf)
   */
  private reversePolygonWinding(feature: Feature<Polygon | MultiPolygon>): Feature<Polygon | MultiPolygon> {
    const geom = feature.geometry;
    const reversed = JSON.parse(JSON.stringify(feature)) as Feature<Polygon | MultiPolygon>;

    if (geom.type === 'Polygon') {
      // Reverse each ring
      (reversed.geometry as Polygon).coordinates = geom.coordinates.map(ring => [...ring].reverse());
    } else if (geom.type === 'MultiPolygon') {
      // Reverse each ring in each polygon
      (reversed.geometry as MultiPolygon).coordinates = geom.coordinates.map(polygon =>
        polygon.map(ring => [...ring].reverse())
      );
    }

    return reversed;
  }

  /**
   * Union multiple features into single boundary (for cities with multi-part boundaries)
   * This is now async to support dynamic ESM import of turf
   */
  private async unionFeaturesAsync(features: Feature<Polygon | MultiPolygon>[]): Promise<Feature<Polygon | MultiPolygon>> {
    if (features.length === 0) {
      throw new Error('Cannot union empty feature array');
    }

    if (features.length === 1) {
      return features[0];
    }

    const turf = await import('@turf/turf');

    let result = features[0];
    for (let i = 1; i < features.length; i++) {
      try {
        const union = turf.union(turf.featureCollection([result, features[i]]));
        if (union) {
          result = union as Feature<Polygon | MultiPolygon>;
        }
      } catch {
        // Continue with partial union
      }
    }

    return result;
  }

  /**
   * Batch resolve multiple boundaries
   */
  async resolveMany(fipsCodes: string[]): Promise<Map<string, ResolutionResult>> {
    const results = new Map<string, ResolutionResult>();

    // Process in parallel with concurrency limit
    const batchSize = 10;
    for (let i = 0; i < fipsCodes.length; i += batchSize) {
      const batch = fipsCodes.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map((fips) => this.resolve(fips)));

      for (let j = 0; j < batch.length; j++) {
        results.set(batch[j], batchResults[j]);
      }

      // Rate limiting
      if (i + batchSize < fipsCodes.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return results;
  }

  /**
   * Clear cache (for testing or forced refresh)
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * One-shot boundary resolution
 */
export async function resolveMunicipalBoundary(fips: string): Promise<ResolutionResult> {
  const resolver = new MunicipalBoundaryResolver();
  return resolver.resolve(fips);
}
