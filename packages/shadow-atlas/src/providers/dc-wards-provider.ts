/**
 * DC Ward Boundaries Provider
 *
 * Provides official Washington DC ward boundaries from DC Open Data.
 * DC has 8 wards that serve as city council districts.
 *
 * Data Source:
 * - DC Open Data: https://opendata.dc.gov/datasets/ward-from-2022
 * - ArcGIS REST API: https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Administrative_Other_Boundaries_WebMercator/MapServer/53
 *
 * DC Special Cases:
 * - FIPS 11 (District of Columbia)
 * - Not a state, but functions as one for most federal purposes
 * - SLDU = 0, SLDL = 0 (unicameral council, different from state legislatures)
 * - 8 wards = 8 council members (single-member districts)
 *
 * Authority: Municipal government official boundaries (DC Office of Planning)
 * Cost: $0 (public domain / open data)
 * Update Frequency: Event-driven (redistricting after each decennial census)
 *
 * Use Cases:
 * - DC city council district verification for constituent contact
 * - Ward-based civic engagement tracking
 * - Local government representation mapping
 */

import { createHash } from 'node:crypto';
import type {
  BoundaryProvider,
  RawBoundaryFile,
  NormalizedBoundary,
  ProviderSourceMetadata,
  UpdateMetadata,
  DownloadParams,
} from '../core/types/provider.js';
import type { AdministrativeLevel } from '../core/types/discovery.js';
import type {
  FeatureCollection,
  Feature,
  Polygon,
  MultiPolygon,
  Geometry,
} from 'geojson';
import { logger } from '../core/utils/logger.js';

/** DC FIPS code */
const DC_FIPS = '11';

/** Expected number of DC wards */
const EXPECTED_WARD_COUNT = 8;

/** DC Open Data version (last redistricting year) */
const DATA_VERSION = '2022';

/**
 * DC Ward property fields from ArcGIS API
 */
interface DCWardProperties {
  /** Ward number (1-8) */
  WARD: string;
  /** Ward name (e.g., "Ward 1") */
  NAME: string;
  /** Area in square meters */
  AREASQMI?: number;
  /** Population (if available) */
  POP100?: number;
  /** Unique identifier */
  OBJECTID?: number;
  /** Shape area */
  SHAPE_Area?: number;
  /** Shape length */
  SHAPE_Length?: number;
  /** Additional properties from ArcGIS */
  [key: string]: unknown;
}

/**
 * DC Ward Boundary Provider
 *
 * Implements BoundaryProvider interface for Washington DC ward boundaries.
 * DC wards are city council districts, NOT state legislative districts.
 */
export class DCWardsProvider implements BoundaryProvider {
  // BoundaryProvider interface requirements
  readonly countryCode = 'US';
  readonly name = 'DC Open Data Ward Boundaries';
  readonly source = 'https://opendata.dc.gov/datasets/ward-from-2022';
  readonly updateSchedule = 'event-driven' as const;
  readonly administrativeLevels: readonly AdministrativeLevel[] = ['ward'] as const;

  /**
   * DC Open Data ArcGIS REST API endpoint for ward boundaries
   *
   * Layer 53 = Ward - 2022 (current ward boundaries after 2020 census redistricting)
   * Service: Administrative_Other_Boundaries_WebMercator
   * Query parameters:
   * - where=1%3D1: Select all features
   * - outFields=*: Return all fields
   * - f=geojson: Output format (returns WGS84 coordinates)
   */
  private readonly WARDS_API_URL =
    'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Administrative_Other_Boundaries_WebMercator/MapServer/53/query?where=1%3D1&outFields=*&f=geojson';

  /**
   * Alternative endpoint for checking data freshness
   */
  private readonly METADATA_API_URL =
    'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Administrative_Other_Boundaries_WebMercator/MapServer/53?f=json';

  /**
   * Download DC ward boundaries from ArcGIS REST API
   */
  async download(_params: DownloadParams): Promise<RawBoundaryFile[]> {
    logger.info('Downloading DC ward boundaries from DC Open Data');

    const response = await fetch(this.WARDS_API_URL);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch DC wards: ${response.status} ${response.statusText}`
      );
    }

    const geojson = (await response.json()) as FeatureCollection;

    // Validate response structure
    if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
      throw new Error('Invalid GeoJSON response from DC Open Data API');
    }

    logger.info('Downloaded ward features', { featureCount: geojson.features.length });

    const geojsonBuffer = Buffer.from(JSON.stringify(geojson), 'utf-8');

    return [
      {
        url: this.WARDS_API_URL,
        format: 'geojson',
        data: geojsonBuffer,
        metadata: {
          source: 'DC Open Data',
          provider: 'DCWardsProvider',
          authority: 'municipal-agency',
          retrieved: new Date().toISOString(),
          checksum: this.computeChecksum(geojsonBuffer),
          layer: 'dc_ward',
          scope: 'municipal',
          stateFips: DC_FIPS,
        },
      },
    ];
  }

  /**
   * Transform raw GeoJSON to normalized boundaries
   */
  async transform(raw: RawBoundaryFile[]): Promise<NormalizedBoundary[]> {
    const boundaries: NormalizedBoundary[] = [];

    for (const file of raw) {
      const geojson = JSON.parse(file.data.toString('utf-8')) as FeatureCollection<
        Polygon | MultiPolygon,
        DCWardProperties
      >;

      for (const feature of geojson.features) {
        const props = feature.properties || {};
        const boundary = this.transformFeature(feature, props);

        if (boundary) {
          boundaries.push(boundary);
        }
      }
    }

    // Validate exactly 8 wards
    if (boundaries.length !== EXPECTED_WARD_COUNT) {
      throw new Error(
        `Expected ${EXPECTED_WARD_COUNT} DC wards, got ${boundaries.length}`
      );
    }

    // Validate ward numbers 1-8
    const wardNumbers = boundaries
      .map((b) => Number.parseInt(b.id.slice(-1), 10))
      .sort((a, b) => a - b);

    const expectedNumbers = [1, 2, 3, 4, 5, 6, 7, 8];
    if (JSON.stringify(wardNumbers) !== JSON.stringify(expectedNumbers)) {
      throw new Error(
        `Invalid ward numbers: expected ${expectedNumbers.join(',')}, got ${wardNumbers.join(',')}`
      );
    }

    logger.info('Transformed DC ward boundaries', { boundaryCount: boundaries.length });

    return boundaries;
  }

  /**
   * Transform a single GeoJSON feature to normalized boundary
   */
  private transformFeature(
    feature: Feature<Geometry, DCWardProperties>,
    props: DCWardProperties
  ): NormalizedBoundary | null {
    // Extract ward number from properties (API may return string or number)
    let wardNumberStr: string | undefined;

    if (props.WARD !== undefined && props.WARD !== null) {
      wardNumberStr = String(props.WARD);
    } else if (props.NAME) {
      wardNumberStr = props.NAME.replace(/\D/g, '');
    }

    if (!wardNumberStr) {
      logger.warn('Skipping feature with missing ward number', { properties: props });
      return null;
    }

    // Validate geometry type
    if (
      feature.geometry.type !== 'Polygon' &&
      feature.geometry.type !== 'MultiPolygon'
    ) {
      logger.warn('Skipping ward with invalid geometry', {
        ward: wardNumberStr,
        geometryType: feature.geometry.type
      });
      return null;
    }

    // Build unique ID: DC FIPS (11) + Ward number (01-08)
    const wardNumberPadded = wardNumberStr.padStart(2, '0');
    const id = `${DC_FIPS}${wardNumberPadded}`;

    // Determine name
    const name = props.NAME || `Ward ${wardNumberStr}`;

    return {
      id,
      name,
      level: 'ward',
      parentId: DC_FIPS, // DC is the parent
      geometry: feature.geometry as Polygon | MultiPolygon,
      population: props.POP100,
      properties: {
        wardNumber: Number.parseInt(wardNumberStr, 10),
        stateFips: DC_FIPS,
        entityFips: wardNumberPadded,
        areaSqMi: props.AREASQMI,
        objectId: props.OBJECTID,
        layer: 'dc_ward',
        layerName: 'DC Ward Boundaries',
        ...props,
      },
      source: this.buildSourceMetadata(),
    };
  }

  /**
   * Check for updates from DC Open Data
   *
   * DC wards rarely change - last redistricting was 2022.
   * Next expected change after 2030 census.
   */
  async checkForUpdates(): Promise<UpdateMetadata> {
    try {
      // Query layer metadata for modification date
      const response = await fetch(this.METADATA_API_URL);

      if (response.ok) {
        const metadata = await response.json() as {
          editingInfo?: { lastEditDate?: number };
        };

        if (metadata.editingInfo?.lastEditDate) {
          const lastEditDate = new Date(metadata.editingInfo.lastEditDate);
          const currentYear = new Date().getFullYear();

          // If data was modified this year, consider it an update
          if (lastEditDate.getFullYear() === currentYear) {
            return {
              available: true,
              latestVersion: String(currentYear),
              currentVersion: DATA_VERSION,
              releaseDate: lastEditDate.toISOString(),
              releaseNotesUrl: this.source,
            };
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to check for DC ward updates', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // No updates available
    return {
      available: false,
      latestVersion: DATA_VERSION,
      currentVersion: DATA_VERSION,
      releaseDate: `${DATA_VERSION}-01-01T00:00:00Z`,
    };
  }

  /**
   * Get source attribution metadata
   */
  async getMetadata(): Promise<ProviderSourceMetadata> {
    return this.buildSourceMetadata();
  }

  /**
   * Build source metadata object
   */
  private buildSourceMetadata(): ProviderSourceMetadata {
    return {
      provider: this.name,
      url: this.source,
      version: DATA_VERSION,
      license: 'CC0-1.0', // DC Open Data is public domain
      updatedAt: new Date().toISOString(),
      checksum: '', // Set per-file in transform
      authorityLevel: 'municipal-agency',
      legalStatus: 'official', // Official municipal boundaries
      collectionMethod: 'portal-discovery',
      lastVerified: new Date().toISOString(),
      verifiedBy: 'automated',
      topologyValidated: false, // Not validated by this provider
      geometryRepaired: false,
      coordinateSystem: 'EPSG:4326',
      nextScheduledUpdate: '2032-01-01T00:00:00Z', // After 2030 census
      updateMonitoring: 'api-polling',
    };
  }

  /**
   * Compute SHA-256 checksum for data integrity
   */
  private computeChecksum(data: Buffer): string {
    const hash = createHash('sha256');
    hash.update(data);
    return hash.digest('hex');
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a new DC Wards provider instance
 */
export function createDCWardsProvider(): DCWardsProvider {
  return new DCWardsProvider();
}

/**
 * Validate that a boundary ID is a valid DC ward ID
 *
 * DC ward IDs follow the pattern: 11XX where XX is 01-08
 */
export function isValidDCWardId(id: string): boolean {
  if (typeof id !== 'string' || id.length !== 4) {
    return false;
  }

  if (!id.startsWith(DC_FIPS)) {
    return false;
  }

  const wardNumber = Number.parseInt(id.slice(2), 10);
  return wardNumber >= 1 && wardNumber <= 8;
}

/**
 * Get ward number from DC ward ID
 *
 * @param id - DC ward ID (e.g., "1101" for Ward 1)
 * @returns Ward number (1-8) or null if invalid
 */
export function getWardNumber(id: string): number | null {
  if (!isValidDCWardId(id)) {
    return null;
  }

  return Number.parseInt(id.slice(2), 10);
}
