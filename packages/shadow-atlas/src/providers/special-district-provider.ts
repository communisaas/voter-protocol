/**
 * Special District Boundary Provider - Abstract Base Class
 *
 * Template for special district providers (fire, library, hospital, water, utility, transit).
 * Special districts are NOT in TIGER data and must be sourced from:
 * - State GIS portals (most comprehensive)
 * - County LAFCo portals (California)
 * - Municipal GIS servers
 * - OpenStreetMap (fallback)
 *
 * Each state has different special district types and sources.
 * Extend this class for state-specific implementations.
 *
 * @example
 * ```typescript
 * // Create California fire districts provider
 * const caFireProvider = new CaliforniaFireDistrictsProvider();
 * const raw = await caFireProvider.download({ level: 'district' });
 * const boundaries = await caFireProvider.transform(raw);
 * ```
 */

import type { Geometry, Polygon, MultiPolygon, FeatureCollection } from 'geojson';
import type {
  BoundaryProvider,
  RawBoundaryFile,
  NormalizedBoundary,
  ProviderSourceMetadata,
  UpdateMetadata,
  DownloadParams,
  AdministrativeLevel,
  AuthorityLevel,
  LegalStatus,
  CollectionMethod,
  VerificationSource,
  UpdateMonitoringMethod,
} from '../core/types/index.js';
import { logger } from '../core/utils/logger.js';

// ============================================================================
// Special District Type Definitions
// ============================================================================

/**
 * Special district categories ordered by civic participation priority
 *
 * Districts with elected boards/commissioners are prioritized higher
 * for civic engagement tracking.
 */
export type SpecialDistrictType =
  | 'fire'      // Fire protection districts - often elected commissioners
  | 'library'   // Library districts - often elected boards
  | 'hospital'  // Hospital/healthcare districts - mixed governance
  | 'water'     // Water districts - usually appointed boards
  | 'utility'   // Utility districts (electric, gas, sewer) - usually appointed
  | 'transit'   // Transit districts - usually appointed boards
  | 'park'      // Park and recreation districts - often elected
  | 'cemetery'  // Cemetery districts - usually appointed
  | 'mosquito'  // Mosquito abatement districts - usually appointed
  | 'flood'     // Flood control districts - usually appointed
  | 'soil'      // Soil conservation districts - often elected
  | 'airport';  // Airport districts - usually appointed

/**
 * Civic priority ranking for special district types
 * Higher values indicate more civic engagement opportunities
 */
export const SPECIAL_DISTRICT_PRIORITY: Record<SpecialDistrictType, number> = {
  fire: 90,      // High - often elected, critical services
  library: 85,   // High - often elected, community engagement
  park: 80,      // High - often elected, community programs
  hospital: 75,  // Medium-high - mixed governance
  soil: 70,      // Medium - often elected in rural areas
  water: 60,     // Medium - important infrastructure
  transit: 55,   // Medium - regional planning input
  utility: 50,   // Medium - rate input opportunities
  flood: 45,     // Lower - technical governance
  airport: 40,   // Lower - appointed boards
  mosquito: 35,  // Lower - technical governance
  cemetery: 30,  // Lower - rarely elected
};

/**
 * Governance type for special districts
 */
export type GovernanceType =
  | 'elected-board'      // Directly elected board/commissioners
  | 'appointed-board'    // Appointed by county/city officials
  | 'mixed'              // Some elected, some appointed
  | 'independent'        // Independent special district
  | 'dependent';         // Dependent on parent government

/**
 * Special district metadata beyond standard NormalizedBoundary
 */
export interface SpecialDistrictMetadata {
  /** Type of special district */
  districtType: SpecialDistrictType;

  /** Governance structure */
  governanceType?: GovernanceType;

  /** Number of board/commissioner seats */
  boardSeats?: number;

  /** Election cycle (years) */
  electionCycle?: number;

  /** Parent government (if dependent) */
  parentGovernment?: string;

  /** Formation date (ISO 8601) */
  formationDate?: string;

  /** Principal act or enabling legislation */
  enablingAct?: string;

  /** LAFCo reference (California only) */
  lafcoReference?: string;

  /** Services provided */
  services?: string[];
}

/**
 * Extended normalized boundary for special districts
 */
export interface NormalizedSpecialDistrict extends NormalizedBoundary {
  /** Special district specific metadata */
  specialDistrictMetadata: SpecialDistrictMetadata;
}

// ============================================================================
// Abstract Base Class
// ============================================================================

/**
 * Abstract base class for special district boundary providers
 *
 * Extend this class for state-specific implementations.
 * Each state may have different data sources and governance structures.
 *
 * @abstract
 */
export abstract class SpecialDistrictProvider implements BoundaryProvider {
  /** Country code - always US for special districts */
  readonly countryCode = 'US';

  /** Provider name - must be implemented by subclasses */
  abstract readonly name: string;

  /** Official data source - must be implemented by subclasses */
  abstract readonly source: string;

  /** State FIPS code - required for special districts */
  abstract readonly stateFips: string;

  /** Type of special district */
  abstract readonly districtType: SpecialDistrictType;

  /** Update schedule - special districts typically update annually */
  readonly updateSchedule = 'annual' as const;

  /** Administrative levels - special districts are always 'district' */
  readonly administrativeLevels: readonly AdministrativeLevel[] = ['district'] as const;

  /** Cache directory for downloaded data */
  protected cacheDir: string;

  /** Maximum retry attempts for network requests */
  protected maxRetries: number;

  /** Retry delay in milliseconds */
  protected retryDelayMs: number;

  constructor(options: {
    cacheDir?: string;
    maxRetries?: number;
    retryDelayMs?: number;
  } = {}) {
    this.cacheDir = options.cacheDir ||
      `${process.cwd()}/data/special-districts`;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelayMs = options.retryDelayMs || 1000;
  }

  // ============================================================================
  // Abstract Methods - Must be implemented by subclasses
  // ============================================================================

  /**
   * Get the data source URL for this state/district type
   *
   * @returns URL to fetch GeoJSON data from
   */
  protected abstract getSourceUrl(): string;

  /**
   * Parse state-specific GeoJSON response into normalized boundaries
   *
   * @param featureCollection - GeoJSON FeatureCollection from source
   * @returns Array of normalized boundaries with special district metadata
   */
  protected abstract parseFeatures(
    featureCollection: FeatureCollection
  ): NormalizedSpecialDistrict[];

  /**
   * Get source attribution metadata
   *
   * @returns Provider source metadata for provenance tracking
   */
  abstract getMetadata(): Promise<ProviderSourceMetadata>;

  // ============================================================================
  // BoundaryProvider Interface Implementation
  // ============================================================================

  /**
   * Download boundaries from source
   *
   * Implements BoundaryProvider.download() for special districts.
   * Handles caching, retry logic, and error handling.
   *
   * @param params - Download parameters (level, region, version, forceRefresh)
   * @returns Array of raw boundary files
   */
  async download(params: DownloadParams): Promise<RawBoundaryFile[]> {
    const url = this.getSourceUrl();

    logger.info('Downloading special district boundaries', {
      districtType: this.districtType,
      state: this.stateFips
    });

    let response: Response;
    let lastError: Error | undefined;

    // Retry loop with exponential backoff
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        response = await fetch(url);

        if (!response.ok) {
          throw new Error(
            `Failed to fetch ${this.districtType} districts for ${this.stateFips}: ${response.status} ${response.statusText}`
          );
        }

        const geojsonText = await response.text();
        const data = Buffer.from(geojsonText, 'utf-8');

        logger.info('Download complete', {
          provider: this.name,
          bytes: data.length
        });

        return [{
          url,
          format: 'geojson',
          data,
          metadata: {
            source: this.source,
            provider: this.name,
            authority: 'state-agency',
            retrieved: new Date().toISOString(),
            layer: this.districtType,
            scope: 'state',
            stateFips: this.stateFips,
            forceRefresh: params.forceRefresh ?? false,
          },
        }];
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.maxRetries) {
          const delay = this.retryDelayMs * Math.pow(2, attempt);
          logger.warn('Download attempt failed, retrying', {
            attempt: attempt + 1,
            maxRetries: this.maxRetries + 1,
            delayMs: delay,
            error: lastError.message
          });
          await this.sleep(delay);
        }
      }
    }

    throw new Error(
      `Download failed after ${this.maxRetries + 1} attempts: ${lastError?.message}`
    );
  }

  /**
   * Transform raw data to normalized boundaries
   *
   * Implements BoundaryProvider.transform() for special districts.
   * Parses GeoJSON and normalizes to standard schema.
   *
   * @param raw - Array of raw boundary files
   * @returns Array of normalized special district boundaries
   */
  async transform(raw: RawBoundaryFile[]): Promise<NormalizedSpecialDistrict[]> {
    const boundaries: NormalizedSpecialDistrict[] = [];

    for (const file of raw) {
      try {
        const geojsonText = file.data.toString('utf-8');
        const featureCollection = JSON.parse(geojsonText) as FeatureCollection;

        const parsed = this.parseFeatures(featureCollection);
        boundaries.push(...parsed);

        logger.info('Transformed boundaries', {
          districtType: this.districtType,
          boundaryCount: parsed.length
        });
      } catch (error) {
        logger.error('Transform error', {
          provider: this.name,
          error: (error as Error).message
        });
      }
    }

    return boundaries;
  }

  /**
   * Check for updates from source
   *
   * Implements BoundaryProvider.checkForUpdates() for special districts.
   * Default implementation checks for annual updates.
   *
   * @returns Update metadata with availability status
   */
  async checkForUpdates(): Promise<UpdateMetadata> {
    const currentYear = new Date().getFullYear();
    const url = this.getSourceUrl();

    try {
      // HEAD request to check if source is available
      const response = await fetch(url, { method: 'HEAD' });

      if (response.ok) {
        const lastModified = response.headers.get('last-modified');
        const releaseDate = lastModified
          ? new Date(lastModified).toISOString()
          : `${currentYear}-01-01T00:00:00.000Z`;

        return {
          available: true,
          latestVersion: String(currentYear),
          currentVersion: String(currentYear - 1),
          releaseDate,
        };
      }
    } catch {
      // Source not reachable
    }

    return {
      available: false,
      latestVersion: String(currentYear - 1),
      currentVersion: String(currentYear - 1),
      releaseDate: `${currentYear - 1}-01-01T00:00:00.000Z`,
    };
  }

  // ============================================================================
  // Protected Helper Methods
  // ============================================================================

  /**
   * Create base source metadata for subclass implementations
   *
   * @param overrides - Partial metadata to override defaults
   * @returns Complete provider source metadata
   */
  protected createBaseMetadata(
    overrides: Partial<ProviderSourceMetadata> = {}
  ): ProviderSourceMetadata {
    const now = new Date().toISOString();
    const currentYear = new Date().getFullYear();

    return {
      provider: this.name,
      url: this.source,
      version: String(currentYear),
      license: 'CC0-1.0',
      updatedAt: now,
      checksum: '',
      authorityLevel: 'state-agency' as AuthorityLevel,
      legalStatus: 'official' as LegalStatus,
      collectionMethod: 'portal-discovery' as CollectionMethod,
      lastVerified: now,
      verifiedBy: 'automated' as VerificationSource,
      topologyValidated: false,
      geometryRepaired: false,
      coordinateSystem: 'EPSG:4326',
      updateMonitoring: 'api-polling' as UpdateMonitoringMethod,
      ...overrides,
    };
  }

  /**
   * Create normalized boundary from GeoJSON feature
   *
   * @param id - Unique identifier for the district
   * @param name - Human-readable name
   * @param geometry - GeoJSON geometry (Polygon or MultiPolygon)
   * @param properties - Additional properties from source
   * @param metadata - Special district metadata
   * @returns Normalized special district boundary
   */
  protected createNormalizedBoundary(
    id: string,
    name: string,
    geometry: Geometry,
    properties: Record<string, unknown>,
    metadata: SpecialDistrictMetadata
  ): NormalizedSpecialDistrict {
    return {
      id,
      name,
      level: 'district',
      geometry,
      properties: {
        ...properties,
        stateFips: this.stateFips,
        districtType: this.districtType,
      },
      source: this.createBaseMetadata(),
      specialDistrictMetadata: metadata,
    };
  }

  /**
   * Sleep for specified milliseconds
   *
   * @param ms - Milliseconds to sleep
   * @returns Promise that resolves after delay
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get civic priority score for this district type
   *
   * @returns Priority score (0-100)
   */
  getCivicPriority(): number {
    return SPECIAL_DISTRICT_PRIORITY[this.districtType] ?? 0;
  }
}

// ============================================================================
// Example Implementation: California Fire Districts
// ============================================================================

/**
 * California Fire Protection Districts Provider
 *
 * Sources fire protection district boundaries from California State GIS.
 * California has approximately 370 fire protection districts with various
 * governance structures.
 *
 * Data Source: California State GIS Portal
 * Authority: State agency (CalFire, County LAFCos)
 * Update Frequency: Annual
 *
 * @example
 * ```typescript
 * const provider = new CaliforniaFireDistrictsProvider();
 * const raw = await provider.download({ level: 'district' });
 * const boundaries = await provider.transform(raw);
 * console.log(`Found ${boundaries.length} fire districts`);
 * ```
 */
export class CaliforniaFireDistrictsProvider extends SpecialDistrictProvider {
  readonly name = 'California Fire Protection Districts';
  readonly source = 'https://gis.data.ca.gov/datasets/fire-protection-districts';
  readonly stateFips = '06';
  readonly districtType = 'fire' as const;

  /**
   * Get the GeoJSON API endpoint for California fire districts
   */
  protected getSourceUrl(): string {
    // California State GIS ArcGIS REST API endpoint
    // Returns GeoJSON with fire protection district boundaries
    return 'https://gis.data.ca.gov/datasets/CALFIRE-Forestry::fire-protection-districts/explore?location=36.778254,-119.417931,5.00&showTable=true';
  }

  /**
   * Parse California fire district features
   *
   * Field mappings for California fire district data:
   * - DIST_NAME or NAME: District name
   * - COUNTY: County name
   * - ACRES: Area in acres
   * - FORMATION: Formation date
   */
  protected parseFeatures(
    featureCollection: FeatureCollection
  ): NormalizedSpecialDistrict[] {
    const boundaries: NormalizedSpecialDistrict[] = [];

    for (let i = 0; i < featureCollection.features.length; i++) {
      const feature = featureCollection.features[i];
      const props = feature.properties ?? {};

      // Extract name from various possible fields
      const name = (props['DIST_NAME'] ??
        props['NAME'] ??
        props['FIRE_DIST'] ??
        `Fire District ${i + 1}`) as string;

      // Generate unique ID: state FIPS + sequential number
      const id = `${this.stateFips}FD${String(i + 1).padStart(5, '0')}`;

      // Extract special district metadata
      const metadata: SpecialDistrictMetadata = {
        districtType: 'fire',
        governanceType: this.inferGovernanceType(props),
        services: ['fire-protection', 'emergency-response'],
        parentGovernment: props['COUNTY'] as string | undefined,
      };

      // Add formation date if available
      if (props['FORMATION'] || props['FORMED']) {
        metadata.formationDate = String(props['FORMATION'] ?? props['FORMED']);
      }

      boundaries.push(
        this.createNormalizedBoundary(
          id,
          name,
          feature.geometry,
          props,
          metadata
        )
      );
    }

    return boundaries;
  }

  /**
   * Infer governance type from properties
   */
  private inferGovernanceType(
    props: Record<string, unknown>
  ): GovernanceType {
    const distType = String(props['DIST_TYPE'] ?? props['TYPE'] ?? '').toLowerCase();

    if (distType.includes('independent')) {
      return 'independent';
    }
    if (distType.includes('dependent') || distType.includes('csd')) {
      return 'dependent';
    }

    // Default to elected board for California fire districts
    return 'elected-board';
  }

  /**
   * Get metadata for California fire districts
   */
  async getMetadata(): Promise<ProviderSourceMetadata> {
    return this.createBaseMetadata({
      provider: 'california-state-gis',
      url: this.source,
      license: 'CC0-1.0',
      authorityLevel: 'state-agency',
      legalStatus: 'official',
      collectionMethod: 'portal-discovery',
    });
  }
}

// ============================================================================
// Provider Registry
// ============================================================================

/**
 * Registry of special district providers indexed by state FIPS + district type
 *
 * Key format: `{stateFips}-{districtType}` (e.g., "06-fire" for CA fire districts)
 *
 * @example
 * ```typescript
 * // Get California fire districts provider
 * const provider = SPECIAL_DISTRICT_PROVIDERS.get('06-fire');
 * if (provider) {
 *   const boundaries = await provider.download({ level: 'district' });
 * }
 *
 * // Register a new provider
 * SPECIAL_DISTRICT_PROVIDERS.set('48-water', new TexasWaterDistrictsProvider());
 * ```
 */
export const SPECIAL_DISTRICT_PROVIDERS: Map<string, SpecialDistrictProvider> = new Map();

// Register California fire districts as example implementation
SPECIAL_DISTRICT_PROVIDERS.set('06-fire', new CaliforniaFireDistrictsProvider());

/**
 * Get a provider by state FIPS and district type
 *
 * @param stateFips - Two-digit state FIPS code
 * @param districtType - Type of special district
 * @returns Provider instance or undefined if not registered
 *
 * @example
 * ```typescript
 * const provider = getSpecialDistrictProvider('06', 'fire');
 * ```
 */
export function getSpecialDistrictProvider(
  stateFips: string,
  districtType: SpecialDistrictType
): SpecialDistrictProvider | undefined {
  return SPECIAL_DISTRICT_PROVIDERS.get(`${stateFips}-${districtType}`);
}

/**
 * Register a special district provider
 *
 * @param provider - Provider instance to register
 *
 * @example
 * ```typescript
 * registerSpecialDistrictProvider(new TexasWaterDistrictsProvider());
 * ```
 */
export function registerSpecialDistrictProvider(
  provider: SpecialDistrictProvider
): void {
  const key = `${provider.stateFips}-${provider.districtType}`;
  SPECIAL_DISTRICT_PROVIDERS.set(key, provider);
}

/**
 * Get all registered providers for a state
 *
 * @param stateFips - Two-digit state FIPS code
 * @returns Array of providers for the state
 *
 * @example
 * ```typescript
 * const caProviders = getProvidersForState('06');
 * console.log(`California has ${caProviders.length} special district providers`);
 * ```
 */
export function getProvidersForState(
  stateFips: string
): SpecialDistrictProvider[] {
  const providers: SpecialDistrictProvider[] = [];

  for (const [key, provider] of SPECIAL_DISTRICT_PROVIDERS) {
    if (key.startsWith(`${stateFips}-`)) {
      providers.push(provider);
    }
  }

  return providers;
}

/**
 * Get all registered providers for a district type
 *
 * @param districtType - Type of special district
 * @returns Array of providers for the district type (across all states)
 *
 * @example
 * ```typescript
 * const fireProviders = getProvidersByType('fire');
 * console.log(`${fireProviders.length} states have fire district providers`);
 * ```
 */
export function getProvidersByType(
  districtType: SpecialDistrictType
): SpecialDistrictProvider[] {
  const providers: SpecialDistrictProvider[] = [];

  for (const [key, provider] of SPECIAL_DISTRICT_PROVIDERS) {
    if (key.endsWith(`-${districtType}`)) {
      providers.push(provider);
    }
  }

  return providers;
}

/**
 * Get all registered district types for a state
 *
 * @param stateFips - Two-digit state FIPS code
 * @returns Array of district types available for the state
 *
 * @example
 * ```typescript
 * const types = getDistrictTypesForState('06');
 * // ['fire', 'water', 'transit', ...]
 * ```
 */
export function getDistrictTypesForState(
  stateFips: string
): SpecialDistrictType[] {
  const types: SpecialDistrictType[] = [];

  for (const [key] of SPECIAL_DISTRICT_PROVIDERS) {
    if (key.startsWith(`${stateFips}-`)) {
      const districtType = key.split('-')[1] as SpecialDistrictType;
      types.push(districtType);
    }
  }

  return types;
}
