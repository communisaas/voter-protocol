/**
 * US Census Bureau TIGER/Line Provider
 *
 * Downloads authoritative boundary data for all US administrative levels:
 * - States (50 + DC + territories)
 * - Counties (3,143)
 * - Places/Municipalities (19,495)
 *
 * Data source: https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
 * Update frequency: Annual (released July)
 * License: Public domain (CC0-1.0)
 */

import { createHash } from 'node:crypto';
import type {
  BoundaryProvider,
  DownloadParams,
  RawBoundaryFile,
  NormalizedBoundary,
  UpdateMetadata,
  SourceMetadata,
  AdministrativeLevel,
} from '../types/provider.js';
import { transformShapefileToGeoJSON } from '../transformers/shapefile-to-geojson.js';

/**
 * US Census TIGER/Line provider implementation
 */
export class USCensusTIGERProvider implements BoundaryProvider {
  readonly countryCode = 'US';
  readonly name = 'US Census Bureau TIGER/Line';
  readonly source = 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html';
  readonly updateSchedule = 'annual' as const;
  readonly administrativeLevels: readonly AdministrativeLevel[] = [
    'state',
    'county',
    'city',
  ] as const;

  private readonly baseURL = 'https://www2.census.gov/geo/tiger';
  private readonly currentYear = '2024';

  /**
   * FIPS codes for all US states + DC
   * Source: https://www.census.gov/library/reference/code-lists/ansi.html
   */
  private readonly stateFIPSMap: Record<string, string> = {
    AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10',
    DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19',
    KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27',
    MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35',
    NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44',
    SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53',
    WV: '54', WI: '55', WY: '56',
  };

  /**
   * Download boundaries for specified administrative level
   */
  async download(params: DownloadParams): Promise<RawBoundaryFile[]> {
    const { level, region, version = this.currentYear, forceRefresh = false } = params;

    console.log(`[USCensusTIGER] Downloading ${level} boundaries for ${region ?? 'all states'}...`);

    switch (level) {
      case 'state':
        return this.downloadStates(version);
      case 'county':
        return this.downloadCounties(version, region);
      case 'city':
        return this.downloadPlaces(version, region);
      default:
        throw new Error(`Unsupported administrative level: ${level}`);
    }
  }

  /**
   * Download state boundaries
   */
  private async downloadStates(year: string): Promise<RawBoundaryFile[]> {
    const url = `${this.baseURL}/TIGER${year}/STATE/tl_${year}_us_state.zip`;

    const data = await this.downloadWithRetry(url);

    return [{
      url,
      format: 'shapefile',
      data,
      metadata: {
        year,
        level: 'state',
        scope: 'national',
      },
    }];
  }

  /**
   * Download county boundaries
   */
  private async downloadCounties(year: string, stateCode?: string): Promise<RawBoundaryFile[]> {
    if (stateCode) {
      // Single state
      const fips = this.stateFIPSMap[stateCode.toUpperCase()];
      if (!fips) {
        throw new Error(`Invalid state code: ${stateCode}`);
      }

      const url = `${this.baseURL}/TIGER${year}/COUNTY/tl_${year}_${fips}_county.zip`;
      const data = await this.downloadWithRetry(url);

      return [{
        url,
        format: 'shapefile',
        data,
        metadata: { year, level: 'county', fipsCode: fips, stateCode },
      }];
    }

    // All counties (national file)
    const url = `${this.baseURL}/TIGER${year}/COUNTY/tl_${year}_us_county.zip`;
    const data = await this.downloadWithRetry(url);

    return [{
      url,
      format: 'shapefile',
      data,
      metadata: { year, level: 'county', scope: 'national' },
    }];
  }

  /**
   * Download place/municipality boundaries
   */
  private async downloadPlaces(year: string, stateCode?: string): Promise<RawBoundaryFile[]> {
    const fipsCodes = stateCode
      ? [this.stateFIPSMap[stateCode.toUpperCase()]]
      : Object.values(this.stateFIPSMap);

    if (stateCode && !fipsCodes[0]) {
      throw new Error(`Invalid state code: ${stateCode}`);
    }

    const files: RawBoundaryFile[] = [];
    const total = fipsCodes.length;

    for (let i = 0; i < fipsCodes.length; i++) {
      const fips = fipsCodes[i];
      const stateName = Object.keys(this.stateFIPSMap).find(k => this.stateFIPSMap[k] === fips);

      console.log(`  [${i + 1}/${total}] Downloading ${stateName} (FIPS ${fips})...`);

      const url = `${this.baseURL}/TIGER${year}/PLACE/tl_${year}_${fips}_place.zip`;

      try {
        const data = await this.downloadWithRetry(url);

        files.push({
          url,
          format: 'shapefile',
          data,
          metadata: {
            year,
            level: 'city',
            fipsCode: fips,
            stateCode: stateName,
          },
        });
      } catch (error) {
        console.error(`  Failed to download ${stateName}:`, error);
        // Continue with other states
      }
    }

    console.log(`[USCensusTIGER] Downloaded ${files.length}/${total} states successfully`);

    return files;
  }

  /**
   * Transform raw Shapefiles to normalized GeoJSON
   */
  async transform(raw: RawBoundaryFile[]): Promise<NormalizedBoundary[]> {
    const boundaries: NormalizedBoundary[] = [];

    for (const file of raw) {
      console.log(`[USCensusTIGER] Transforming ${file.metadata.stateCode ?? file.metadata.scope}...`);

      // Transform Shapefile → WGS84 GeoJSON
      const geojson = await transformShapefileToGeoJSON(file.data, {
        targetCRS: 'EPSG:4326',
        validate: true,
        repair: true,
      });

      // Normalize to standard schema
      for (const feature of geojson.features) {
        const props = feature.properties ?? {};

        boundaries.push({
          id: props.GEOID as string ?? props.GEO_ID as string,
          name: props.NAME as string ?? props.NAMELSAD as string,
          level: this.inferLevel(file.metadata.level as string),
          parentId: this.extractParentId(props, file.metadata.level as string),
          geometry: feature.geometry,
          population: this.extractPopulation(props),
          properties: props,
          source: {
            provider: this.name,
            url: file.url,
            version: file.metadata.year as string,
            license: 'CC0-1.0',
            updatedAt: new Date().toISOString(),
            checksum: this.computeChecksum(file.data),

            // Trust Hierarchy
            authorityLevel: 'federal-mandate',
            legalStatus: 'binding',

            // Provenance Tracking
            collectionMethod: 'census-tiger',
            lastVerified: new Date().toISOString(),
            verifiedBy: 'automated',

            // Data Quality
            topologyValidated: true,
            geometryRepaired: true,
            coordinateSystem: 'EPSG:4326',

            // Update Tracking
            nextScheduledUpdate: this.getNextCensusRelease(),
            updateMonitoring: 'api-polling',
          },
        });
      }
    }

    console.log(`[USCensusTIGER] Transformed ${boundaries.length} boundaries`);

    return boundaries;
  }

  /**
   * Check for updates from Census Bureau
   */
  async checkForUpdates(): Promise<UpdateMetadata> {
    // Check if newer year is available
    const nextYear = (parseInt(this.currentYear) + 1).toString();
    const testURL = `${this.baseURL}/TIGER${nextYear}/PLACE/`;

    try {
      const response = await fetch(testURL, { method: 'HEAD' });

      if (response.ok) {
        return {
          available: true,
          latestVersion: nextYear,
          currentVersion: this.currentYear,
          releaseDate: `${nextYear}-07-01`, // Census releases in July
          releaseNotesUrl: `https://www.census.gov/programs-surveys/geography/technical-documentation/complete-technical-documentation/tiger-geo-line.${nextYear}.html`,
        };
      }
    } catch {
      // Next year not available yet
    }

    return {
      available: false,
      latestVersion: this.currentYear,
      currentVersion: this.currentYear,
      releaseDate: `${this.currentYear}-07-01`,
    };
  }

  /**
   * Get source metadata
   */
  async getMetadata(): Promise<SourceMetadata> {
    return {
      provider: this.name,
      url: this.source,
      version: this.currentYear,
      license: 'CC0-1.0',
      updatedAt: new Date().toISOString(),
      checksum: '',
    };
  }

  /**
   * Download file with retry logic
   */
  private async downloadWithRetry(
    url: string,
    maxRetries: number = 3,
    retryDelay: number = 2000
  ): Promise<Buffer> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } catch (error) {
        lastError = error as Error;
        console.warn(`    Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);

        if (attempt < maxRetries) {
          await this.sleep(retryDelay);
        }
      }
    }

    throw new Error(`Download failed after ${maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Infer administrative level from metadata
   */
  private inferLevel(metadataLevel: string): AdministrativeLevel {
    const levelMap: Record<string, AdministrativeLevel> = {
      state: 'state',
      county: 'county',
      city: 'city',
    };

    return levelMap[metadataLevel] ?? 'city';
  }

  /**
   * Extract parent ID from properties
   */
  private extractParentId(props: Record<string, unknown>, level: string): string | undefined {
    if (level === 'city') {
      // Cities have state FIPS as parent
      return props.STATEFP as string ?? undefined;
    }

    if (level === 'county') {
      // Counties have state FIPS as parent
      return props.STATEFP as string ?? undefined;
    }

    return undefined;
  }

  /**
   * Extract population if available
   * Note: TIGER/Line boundaries don't include population data
   */
  private extractPopulation(props: Record<string, unknown>): number | undefined {
    // TIGER/Line doesn't include population
    // Would need to join with separate population dataset
    return undefined;
  }

  /**
   * Compute SHA-256 checksum of data
   */
  private computeChecksum(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Get next Census release date (July 1st of next year)
   */
  private getNextCensusRelease(): string {
    const nextYear = parseInt(this.currentYear) + 1;
    return `${nextYear}-07-01T00:00:00.000Z`;
  }
}
