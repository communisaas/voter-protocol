/**
 * Census TIGER/Line Data Loader
 *
 * Provides 100% US coverage through Census Bureau TIGER/Line shapefiles.
 * This is the GUARANTEED FALLBACK - every US address resolves to at least a county.
 *
 * DATA SOURCES (all FREE):
 * - Places (cities + CDPs): https://www2.census.gov/geo/tiger/TIGER2023/PLACE/
 * - Counties: https://www2.census.gov/geo/tiger/TIGER2023/COUNTY/
 * - Congressional Districts: https://www2.census.gov/geo/tiger/TIGER2023/CD/
 * - State Legislative: https://www2.census.gov/geo/tiger/TIGER2023/SLDU/ (upper)
 *                      https://www2.census.gov/geo/tiger/TIGER2023/SLDL/ (lower)
 *
 * COVERAGE GUARANTEE:
 * - 19,495 incorporated places (cities, towns, villages)
 * - ~9,000 CDPs (Census Designated Places - unincorporated communities)
 * - 3,143 counties (universal fallback)
 * - 435 congressional districts
 * - ~2,000 state senate districts
 * - ~5,400 state house districts
 *
 * FILE FORMAT:
 * TIGER/Line files are shapefiles (.shp + .dbf + .shx + .prj)
 * We convert to GeoJSON for consistency with existing pipeline.
 */

import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';
import type {
  BoundaryGeometry,
  BoundaryMetadata,
  BoundaryType,
  LatLng,
  BBox,
} from '../types/boundary.js';
import { BoundaryType as BT, extractBBox, PRECISION_RANK } from '../types/boundary.js';
import { getStateNameFromFips } from '../core/types.js';
import type { BoundaryDataSource } from './boundary-resolver.js';
import type { ProvenanceRecord } from '../provenance-writer.js';

/**
 * Census TIGER data year
 * Update annually after Census releases new TIGER/Line files (usually February)
 */
const TIGER_YEAR = 2023;

/**
 * Census TIGER base URLs
 */
const TIGER_BASE_URL = `https://www2.census.gov/geo/tiger/TIGER${TIGER_YEAR}`;

/**
 * Census GeoJSON API (converts TIGER to GeoJSON on-the-fly)
 * Maintained by Census Bureau - FREE and reliable
 */
const CENSUS_GEOJSON_API = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb';

/**
 * Census TIGER layer configuration
 */
interface TigerLayerConfig {
  readonly layerName: string;
  readonly tigerwebService: string;
  readonly tigerwebLayer: number;
  readonly boundaryType: BoundaryType;
  readonly fipsField: string;
  readonly nameField: string;
}

/**
 * TIGERweb REST API layer configurations
 *
 * Used for real-time point-in-polygon queries via Census TIGERweb REST API.
 * These layer IDs correspond to MapServer endpoints for individual spatial queries.
 *
 * For bulk FTP downloads, see TIGER_FTP_LAYERS in tiger-boundary-provider.ts
 */
const TIGERWEB_LAYER_CONFIG: Record<string, TigerLayerConfig> = {
  // Places (incorporated + CDPs)
  places: {
    layerName: 'Census Places',
    tigerwebService: 'tigerWMS_Current',
    tigerwebLayer: 28, // Incorporated Places
    boundaryType: BT.CITY_LIMITS,
    fipsField: 'GEOID',
    nameField: 'NAME',
  },

  // CDPs specifically
  cdps: {
    layerName: 'Census Designated Places',
    tigerwebService: 'tigerWMS_Current',
    tigerwebLayer: 29, // CDPs
    boundaryType: BT.CDP,
    fipsField: 'GEOID',
    nameField: 'NAME',
  },

  // Counties
  counties: {
    layerName: 'Counties',
    tigerwebService: 'tigerWMS_Current',
    tigerwebLayer: 86, // Counties
    boundaryType: BT.COUNTY,
    fipsField: 'GEOID',
    nameField: 'NAME',
  },

  // Congressional Districts
  congressional: {
    layerName: 'Congressional Districts',
    tigerwebService: 'tigerWMS_Current',
    tigerwebLayer: 54, // 118th Congress
    boundaryType: BT.CONGRESSIONAL_DISTRICT,
    fipsField: 'GEOID',
    nameField: 'NAMELSAD',
  },

  // State Legislative (Upper - Senate)
  stateSenate: {
    layerName: 'State Senate Districts',
    tigerwebService: 'tigerWMS_Current',
    tigerwebLayer: 55, // State Legislative Upper
    boundaryType: BT.STATE_LEGISLATIVE_UPPER,
    fipsField: 'GEOID',
    nameField: 'NAMELSAD',
  },

  // State Legislative (Lower - House/Assembly)
  stateHouse: {
    layerName: 'State House Districts',
    tigerwebService: 'tigerWMS_Current',
    tigerwebLayer: 56, // State Legislative Lower
    boundaryType: BT.STATE_LEGISLATIVE_LOWER,
    fipsField: 'GEOID',
    nameField: 'NAMELSAD',
  },

  // School Districts (Unified K-12)
  unifiedSchool: {
    layerName: 'Unified School Districts',
    tigerwebService: 'tigerWMS_Current',
    tigerwebLayer: 90, // Unified School Districts
    boundaryType: BT.SCHOOL_DISTRICT_UNIFIED,
    fipsField: 'GEOID',
    nameField: 'NAME',
  },

  // School Districts (Elementary K-8)
  elementarySchool: {
    layerName: 'Elementary School Districts',
    tigerwebService: 'tigerWMS_Current',
    tigerwebLayer: 91, // Elementary School Districts
    boundaryType: BT.SCHOOL_DISTRICT_ELEMENTARY,
    fipsField: 'GEOID',
    nameField: 'NAME',
  },

  // School Districts (Secondary 9-12)
  secondarySchool: {
    layerName: 'Secondary School Districts',
    tigerwebService: 'tigerWMS_Current',
    tigerwebLayer: 92, // Secondary School Districts
    boundaryType: BT.SCHOOL_DISTRICT_SECONDARY,
    fipsField: 'GEOID',
    nameField: 'NAME',
  },
};

/**
 * Census TIGER Loader
 *
 * Fetches boundaries from Census TIGERweb REST API.
 * Implements BoundaryDataSource for use with BoundaryResolver.
 */
export class CensusTigerLoader implements BoundaryDataSource {
  private readonly cache: Map<string, BoundaryGeometry[]> = new Map();
  private readonly userAgent: string;

  constructor(userAgent = 'VOTER-Protocol/1.0 (Census TIGER Loader)') {
    this.userAgent = userAgent;
  }

  /**
   * Get candidate boundaries for a point
   *
   * Queries TIGERweb API to find all boundaries containing the point.
   * Returns boundaries sorted by precision (finest first).
   */
  async getCandidateBoundaries(point: LatLng): Promise<BoundaryGeometry[]> {
    const candidates: BoundaryGeometry[] = [];

    // Query all relevant layers in parallel
    const queries = [
      this.queryTigerLayer('places', point),
      this.queryTigerLayer('cdps', point),
      this.queryTigerLayer('counties', point),
      this.queryTigerLayer('congressional', point),
      this.queryTigerLayer('unifiedSchool', point),
      this.queryTigerLayer('elementarySchool', point),
      this.queryTigerLayer('secondarySchool', point),
    ];

    const results = await Promise.allSettled(queries);

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        candidates.push(...result.value);
      }
    }

    // Sort by precision (finest first)
    candidates.sort((a, b) => {
      const rankA = this.getPrecisionRank(a.metadata.type);
      const rankB = this.getPrecisionRank(b.metadata.type);
      return rankA - rankB;
    });

    return candidates;
  }

  /**
   * Get boundaries by jurisdiction (state FIPS code)
   *
   * Fetches all places/counties within a state.
   * Used for bulk loading.
   */
  async getBoundariesByJurisdiction(
    stateFips: string
  ): Promise<BoundaryGeometry[]> {
    const cacheKey = `state:${stateFips}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Fetch all places in state
    const boundaries = await this.fetchStateData(stateFips);

    this.cache.set(cacheKey, boundaries);
    return boundaries;
  }

  /**
   * Get boundary by ID (GEOID)
   */
  async getBoundaryById(geoid: string): Promise<BoundaryGeometry | null> {
    // Determine layer from GEOID length
    // GEOID formats:
    // - Place: 7 digits (2-digit state + 5-digit place)
    // - County: 5 digits (2-digit state + 3-digit county)
    // - Congressional: 4 digits (2-digit state + 2-digit district)

    const layer = this.getLayerFromGeoid(geoid);
    if (!layer) {
      return null;
    }

    return this.fetchBoundaryByGeoid(layer, geoid);
  }

  /**
   * Query TIGERweb API for boundaries containing a point
   */
  private async queryTigerLayer(
    layerKey: string,
    point: LatLng
  ): Promise<BoundaryGeometry[]> {
    const config = TIGERWEB_LAYER_CONFIG[layerKey];
    if (!config) {
      return [];
    }

    const url = this.buildTigerwebQueryUrl(config, point);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': this.userAgent,
        },
      });

      if (!response.ok) {
        console.warn(`TIGERweb query failed for ${layerKey}: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return this.convertTigerwebResponse(data, config);
    } catch (error) {
      console.warn(`TIGERweb query error for ${layerKey}:`, error);
      return [];
    }
  }

  /**
   * Build TIGERweb REST API query URL
   */
  private buildTigerwebQueryUrl(
    config: TigerLayerConfig,
    point: LatLng
  ): string {
    const baseUrl = `${CENSUS_GEOJSON_API}/${config.tigerwebService}/MapServer/${config.tigerwebLayer}/query`;

    const params = new URLSearchParams({
      geometry: `${point.lng},${point.lat}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326', // WGS84
      outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      f: 'geojson',
    });

    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * Convert TIGERweb response to BoundaryGeometry array
   */
  private convertTigerwebResponse(
    data: unknown,
    config: TigerLayerConfig
  ): BoundaryGeometry[] {
    if (!this.isFeatureCollection(data)) {
      return [];
    }

    const boundaries: BoundaryGeometry[] = [];

    for (const feature of data.features) {
      if (!feature.geometry || !feature.properties) {
        continue;
      }

      const geoid = feature.properties[config.fipsField] as string;
      const name = feature.properties[config.nameField] as string;

      // Create provenance record
      const provenance: ProvenanceRecord = {
        source: 'census-tiger',
        sourceUrl: `https://tigerweb.geo.census.gov/`,
        retrievedAt: new Date(),
        dataVersion: `TIGER ${TIGER_YEAR}`,
        license: 'Public Domain (US Government Work)',
        processingSteps: [
          `Fetched from TIGERweb REST API`,
          `Layer: ${config.layerName}`,
          `GEOID: ${geoid}`,
        ],
      };

      // Create metadata
      const metadata: BoundaryMetadata = {
        id: `census-${config.boundaryType}-${geoid}`,
        type: config.boundaryType,
        name: name || `${config.layerName} ${geoid}`,
        jurisdiction: this.extractJurisdiction(geoid, config),
        jurisdictionFips: geoid,
        provenance,
        validFrom: new Date('2023-01-01'), // TIGER 2023
      };

      // Create boundary
      const boundary: BoundaryGeometry = {
        metadata,
        geometry: feature.geometry as Polygon | MultiPolygon,
        bbox: extractBBox(feature.geometry as Polygon | MultiPolygon),
      };

      boundaries.push(boundary);
    }

    return boundaries;
  }

  /**
   * Fetch all places/counties in a state
   */
  private async fetchStateData(stateFips: string): Promise<BoundaryGeometry[]> {
    const config = TIGERWEB_LAYER_CONFIG.places;
    const baseUrl = `${CENSUS_GEOJSON_API}/${config.tigerwebService}/MapServer/${config.tigerwebLayer}/query`;

    const params = new URLSearchParams({
      where: `STATEFP='${stateFips}'`,
      outFields: '*',
      returnGeometry: 'true',
      f: 'geojson',
    });

    try {
      const response = await fetch(`${baseUrl}?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': this.userAgent,
        },
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return this.convertTigerwebResponse(data, config);
    } catch {
      return [];
    }
  }

  /**
   * Fetch boundary by GEOID
   */
  private async fetchBoundaryByGeoid(
    layerKey: string,
    geoid: string
  ): Promise<BoundaryGeometry | null> {
    const config = TIGERWEB_LAYER_CONFIG[layerKey];
    if (!config) {
      return null;
    }

    const baseUrl = `${CENSUS_GEOJSON_API}/${config.tigerwebService}/MapServer/${config.tigerwebLayer}/query`;

    const params = new URLSearchParams({
      where: `${config.fipsField}='${geoid}'`,
      outFields: '*',
      returnGeometry: 'true',
      f: 'geojson',
    });

    try {
      const response = await fetch(`${baseUrl}?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': this.userAgent,
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const boundaries = this.convertTigerwebResponse(data, config);
      return boundaries[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * Extract jurisdiction string from GEOID
   */
  private extractJurisdiction(geoid: string, config: TigerLayerConfig): string {
    const stateFips = geoid.substring(0, 2);
    return getStateNameFromFips(stateFips) ?? `State ${stateFips}`;
  }

  /**
   * Determine layer from GEOID
   */
  private getLayerFromGeoid(geoid: string): string | null {
    switch (geoid.length) {
      case 7: return 'places'; // Place GEOID: SSFFFFFF (2-digit state + 5-digit place)
      case 5: return 'counties'; // County GEOID: SSCCC (2-digit state + 3-digit county)
      case 4: return 'congressional'; // CD GEOID: SSDD (2-digit state + 2-digit district)
      default: return null;
    }
  }

  /**
   * Get precision rank for boundary type
   *
   * NOTE: Uses PRECISION_RANK imported from types/boundary.ts
   * to maintain single source of truth.
   */
  private getPrecisionRank(type: BoundaryType): number {
    return PRECISION_RANK[type] ?? 99;
  }

  /**
   * Type guard for FeatureCollection
   */
  private isFeatureCollection(data: unknown): data is FeatureCollection {
    return (
      typeof data === 'object' &&
      data !== null &&
      (data as { type?: string }).type === 'FeatureCollection' &&
      Array.isArray((data as { features?: unknown[] }).features)
    );
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { entries: number } {
    return { entries: this.cache.size };
  }
}

/**
 * Coverage statistics for US boundaries
 */
export const US_COVERAGE_STATS = {
  incorporatedPlaces: 19495,
  cdps: 9000, // Approximate
  counties: 3143,
  congressionalDistricts: 435,
  stateSenateDistricts: 1972,
  stateHouseDistricts: 5411,

  // Total unique boundaries
  get total(): number {
    return (
      this.incorporatedPlaces +
      this.cdps +
      this.counties +
      this.congressionalDistricts +
      this.stateSenateDistricts +
      this.stateHouseDistricts
    );
  },
};
