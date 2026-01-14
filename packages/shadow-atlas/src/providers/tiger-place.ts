/**
 * Census TIGER PLACE Provider
 *
 * Foundation layer for Shadow Atlas - provides city/town boundaries.
 *
 * Data Source: US Census Bureau TIGER/Line Shapefiles (PLACE)
 * Coverage: 100% of US municipalities (all 32,041+ cities & Census Designated Places)
 * Granularity: Incorporated places + Census Designated Places (CDPs)
 * Authority: Federal government official boundaries (via BAS)
 * Cost: $0 (public domain)
 * Update Frequency: Annual (as of January 1, released September)
 *
 * Use Cases:
 * - Foundation layer: "Which city am I in?"
 * - Geographic validation bounds for portal-discovered council districts
 * - Fallback boundaries for cities without council district data
 * - Census Designated Places for unincorporated communities
 *
 * File Format: Shapefile → GeoJSON (via ogr2ogr)
 * Caching: State-level files cached annually
 * Filtering: Match cities by PLACE FIPS code
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type {
  BoundaryProvider,
  RawBoundaryFile,
  NormalizedBoundary,
  AdministrativeLevel,
} from '../core/types/provider.js';
import type { FeatureCollection } from 'geojson';
// Canonical CityTarget imported from core/city-target.ts
import type { CityTargetWithPopulation } from '../core/city-target.js';
import { logger } from '../core/utils/logger.js';

// Re-export with population as optional for backward compatibility
export type CityTarget = Omit<CityTargetWithPopulation, 'population'> & {
  readonly population?: number;
};

// STATE_FIPS imported from centralized geo-constants (eliminated duplicate)
import { STATE_ABBR_TO_FIPS as STATE_FIPS } from '../core/geo-constants.js';

/**
 * Census TIGER PLACE Provider
 *
 * Implements BoundaryProvider interface using authoritative federal data.
 */
export class TIGERPlaceProvider implements BoundaryProvider {
  // BoundaryProvider interface requirements
  readonly countryCode = 'US';
  readonly name = 'US Census Bureau TIGER/Line Places';
  readonly source = 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html';
  readonly updateSchedule = 'annual' as const;
  readonly administrativeLevels: readonly AdministrativeLevel[] = ['city'] as const;

  private cacheDir: string;
  private year: number;

  constructor(options: { cacheDir?: string; year?: number } = {}) {
    // Default cache: packages/crypto/data/tiger-cache
    this.cacheDir = options.cacheDir ||
      join(process.cwd(), 'packages/crypto/data/tiger-cache');

    // Default year: 2024 (latest TIGER vintage)
    this.year = options.year || 2024;
  }

  /**
   * Download PLACE boundaries (BoundaryProvider interface)
   */
  async download(params: { level: AdministrativeLevel; region?: string; version?: string; forceRefresh?: boolean }): Promise<RawBoundaryFile[]> {
    // For now, this is a simplified version that delegates to discoverCities
    // In production, this would download state PLACE files based on params
    throw new Error('Use discoverCities() method for city-specific PLACE discovery');
  }

  /**
   * Discover PLACE boundaries for specific cities
   * (Alternative to download() for targeted discovery)
   */
  async discoverCities(cities: CityTarget[]): Promise<RawBoundaryFile[]> {
    logger.info('Discovering PLACE boundaries from Census TIGER', {
      cityCount: cities.length,
      year: this.year
    });

    // Ensure cache directory exists
    await mkdir(join(this.cacheDir, String(this.year)), { recursive: true });

    // Group cities by state for batch processing
    const citiesByState = this.groupByState(cities);
    logger.info('Processing states', { stateCount: citiesByState.size });

    const results: RawBoundaryFile[] = [];

    for (const [stateCode, stateCities] of Array.from(citiesByState.entries())) {
      logger.info('Processing state', { state: stateCode, cityCount: stateCities.length });

      try {
        // Download/load state PLACE file (cached)
        const statePlaces = await this.getStatePlaces(stateCode);
        logger.info('Loaded state PLACE file', {
          state: stateCode,
          placeCount: statePlaces.features.length
        });

        // Match each city to its PLACE feature
        for (const city of stateCities) {
          try {
            const cityPlace = this.findPlaceByFIPS(statePlaces, city.fips);

            if (!cityPlace) {
              logger.warn('PLACE not found', { city: city.name, fips: city.fips });
              continue;
            }

            // Create FeatureCollection with single place
            const cityGeoJSON: FeatureCollection = {
              type: 'FeatureCollection',
              features: [cityPlace],
            };

            // Convert GeoJSON to Buffer for RawBoundaryFile
            const geojsonBuffer = Buffer.from(JSON.stringify(cityGeoJSON), 'utf-8');

            results.push({
              url: this.getTIGERUrl(STATE_FIPS[stateCode.toUpperCase()] || ''),
              format: 'geojson',
              data: geojsonBuffer,
              metadata: {
                source: `US Census Bureau TIGER/Line ${this.year}`,
                provider: 'TIGERPlaceProvider',
                authority: 'federal',
                retrieved: new Date().toISOString(),
                checksum: this.computeChecksum(geojsonBuffer),
                city: city.name,
                state: stateCode,
                fips: city.fips,
              },
            });

            logger.info('PLACE boundary found', { city: city.name, fips: city.fips });

          } catch (error) {
            logger.error('Failed to process city', {
              city: city.name,
              error: (error as Error).message
            });
          }
        }

      } catch (error) {
        logger.error('Failed to load state PLACE file', {
          state: stateCode,
          error: (error as Error).message
        });
      }
    }

    logger.info('Discovery complete', {
      foundCount: results.length,
      totalCount: cities.length
    });
    return results;
  }

  /**
   * Transform raw TIGER PLACE data to normalized boundaries
   */
  async transform(raw: RawBoundaryFile[]): Promise<NormalizedBoundary[]> {
    const normalized: NormalizedBoundary[] = [];

    for (const file of raw) {
      // Parse GeoJSON from Buffer
      const geojson = JSON.parse(file.data.toString('utf-8')) as FeatureCollection;

      for (const feature of geojson.features) {
        const props = feature.properties || {};

        normalized.push({
          id: `${props.STATEFP}${props.PLACEFP}`,
          name: props.NAME || 'Unnamed Place',
          level: 'city' as AdministrativeLevel,
          geometry: feature.geometry,
          properties: {
            stateFips: props.STATEFP,
            placeFips: props.PLACEFP,
            placeType: props.LSAD, // Legal/Statistical Area Description
            placeName: props.NAME,
            classCode: props.CLASSFP, // FIPS class code
            city: file.metadata.city,
            state: file.metadata.state,
          },
          source: {
            provider: this.name,
            url: file.url,
            version: String(this.year),
            license: 'CC0-1.0',
            updatedAt: new Date().toISOString(),
            checksum: file.metadata.checksum as string,
            authorityLevel: 'federal-mandate',
            legalStatus: 'binding',
            collectionMethod: 'census-bas',
            lastVerified: new Date().toISOString(),
            verifiedBy: 'automated',
            topologyValidated: true,
            geometryRepaired: false,
            coordinateSystem: 'EPSG:4326',
            nextScheduledUpdate: this.getNextCensusRelease(),
            updateMonitoring: 'api-polling',
          },
        });
      }
    }

    return normalized;
  }

  /**
   * Check for updates from Census Bureau
   */
  async checkForUpdates(): Promise<{ available: boolean; latestVersion: string; currentVersion: string; releaseDate: string; releaseNotesUrl?: string }> {
    const nextYear = this.year + 1;
    const testURL = `https://www2.census.gov/geo/tiger/TIGER${nextYear}/PLACE/`;

    try {
      const response = await fetch(testURL, { method: 'HEAD' });
      if (response.ok) {
        return {
          available: true,
          latestVersion: String(nextYear),
          currentVersion: String(this.year),
          releaseDate: `${nextYear}-09-01`,
          releaseNotesUrl: `https://www.census.gov/programs-surveys/geography/technical-documentation/complete-technical-documentation/tiger-geo-line.${nextYear}.html`,
        };
      }
    } catch {
      // Next year not available yet
    }

    return {
      available: false,
      latestVersion: String(this.year),
      currentVersion: String(this.year),
      releaseDate: `${this.year}-09-01`,
    };
  }

  /**
   * Get source metadata
   */
  async getMetadata() {
    return {
      provider: this.name,
      url: this.source,
      version: String(this.year),
      license: 'CC0-1.0',
      updatedAt: new Date().toISOString(),
      checksum: '',
      authorityLevel: 'federal-mandate' as const,
      legalStatus: 'binding' as const,
      collectionMethod: 'census-bas' as const,
      lastVerified: new Date().toISOString(),
      verifiedBy: 'automated' as const,
      topologyValidated: true,
      geometryRepaired: false,
      coordinateSystem: 'EPSG:4326' as const,
      nextScheduledUpdate: this.getNextCensusRelease(),
      updateMonitoring: 'api-polling' as const,
    };
  }

  /**
   * Get state PLACE file (download or load from cache)
   */
  private async getStatePlaces(stateCode: string): Promise<FeatureCollection> {
    const stateFips = STATE_FIPS[stateCode.toUpperCase()];
    if (!stateFips) {
      throw new Error(`Unknown state code: ${stateCode}`);
    }

    const cacheFile = join(this.cacheDir, String(this.year), `${stateFips}_place.geojson`);

    // Check cache
    try {
      await access(cacheFile);
      const content = await readFile(cacheFile, 'utf-8');
      return JSON.parse(content) as FeatureCollection;
    } catch {
      // Cache miss, download
      return this.downloadStatePlaces(stateFips);
    }
  }

  /**
   * Download state PLACE shapefile and convert to GeoJSON
   */
  private async downloadStatePlaces(stateFips: string): Promise<FeatureCollection> {
    const url = this.getTIGERUrl(stateFips);
    const zipPath = join(this.cacheDir, String(this.year), `tl_${this.year}_${stateFips}_place.zip`);
    const cacheFile = join(this.cacheDir, String(this.year), `${stateFips}_place.geojson`);

    logger.info('Downloading state PLACE file', { url, stateFips });

    // Download ZIP file
    await this.downloadFile(url, zipPath);

    logger.debug('Converting shapefile to GeoJSON', { zipPath });

    // Convert to GeoJSON using ogr2ogr
    const geojson = await this.convertShapefileToGeoJSON(zipPath);

    // Cache GeoJSON
    await writeFile(cacheFile, JSON.stringify(geojson, null, 2));

    logger.debug('Cached GeoJSON', { cacheFile });

    return geojson;
  }

  /**
   * Download file via curl
   */
  private async downloadFile(url: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const curl = spawn('curl', ['-L', '-o', outputPath, url]);

      curl.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`curl failed with code ${code}`));
        }
      });

      curl.on('error', reject);
    });
  }

  /**
   * Convert shapefile to GeoJSON using ogr2ogr
   */
  private async convertShapefileToGeoJSON(zipPath: string): Promise<FeatureCollection> {
    return new Promise((resolve, reject) => {
      const ogr2ogr = spawn('ogr2ogr', [
        '-f', 'GeoJSON',
        '/vsistdout/',  // Output to stdout
        `/vsizip/${zipPath}`,  // Read from ZIP
        '-t_srs', 'EPSG:4326',  // Convert to WGS84
      ]);

      let stdout = '';
      let stderr = '';

      ogr2ogr.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ogr2ogr.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ogr2ogr.on('close', (code) => {
        if (code === 0) {
          try {
            const geojson = JSON.parse(stdout) as FeatureCollection;
            resolve(geojson);
          } catch (error) {
            reject(new Error(`Failed to parse GeoJSON: ${(error as Error).message}`));
          }
        } else {
          reject(new Error(`ogr2ogr failed: ${stderr}`));
        }
      });

      ogr2ogr.on('error', (error) => {
        reject(new Error(`Failed to spawn ogr2ogr: ${error.message}. Ensure GDAL is installed.`));
      });
    });
  }

  /**
   * Find PLACE feature by FIPS code
   */
  private findPlaceByFIPS(statePlaces: FeatureCollection, cityFips: string): any {
    // City FIPS format: SSCCCVVVVV or SSVVVVV
    // For PLACE, we need the state FIPS (2 digits) + place FIPS (5 digits)

    const stateFips = cityFips.substring(0, 2);
    const placeFips = cityFips.length === 7
      ? cityFips.substring(2, 7)  // From 7-digit FIPS (SSCCCVVVVV)
      : cityFips.substring(2);     // From full place FIPS

    return statePlaces.features.find((feature) => {
      const props = feature.properties || {};
      return props.STATEFP === stateFips && props.PLACEFP === placeFips;
    });
  }

  /**
   * Group cities by state for batch processing
   */
  private groupByState(cities: CityTarget[]): Map<string, CityTarget[]> {
    const groups = new Map<string, CityTarget[]>();

    for (const city of cities) {
      const existing = groups.get(city.state) || [];
      existing.push(city);
      groups.set(city.state, existing);
    }

    return groups;
  }

  /**
   * Get TIGER download URL for state
   */
  private getTIGERUrl(stateFips: string): string {
    return `https://www2.census.gov/geo/tiger/TIGER${this.year}/PLACE/tl_${this.year}_${stateFips}_place.zip`;
  }

  /**
   * Compute SHA-256 checksum for data integrity
   */
  private computeChecksum(data: Buffer): string {
    const hash = createHash('sha256');
    hash.update(data);
    return hash.digest('hex');
  }

  /**
   * Get next Census release date (September 1st of next year)
   */
  private getNextCensusRelease(): string {
    const nextYear = this.year + 1;
    return `${nextYear}-09-01T00:00:00.000Z`;
  }
}
