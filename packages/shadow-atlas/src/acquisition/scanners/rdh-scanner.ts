/**
 * Redistricting Data Hub Scanner
 *
 * Monitors Redistricting Data Hub (Princeton Gerrymandering Project) for new VTD releases.
 * RDH is the authoritative national aggregator for voting precinct (VTD) boundary data.
 *
 * DATA SOURCE: https://redistrictingdatahub.org/data/download-data/
 *
 * UPDATE CADENCE:
 * - Post-election: Q1 (January-March) after November elections
 * - Post-redistricting: Years following redistricting (2022, 2032, 2042)
 * - State-specific updates: Ad-hoc when states publish new precinct data
 *
 * PRIORITY STATES (high-volume, frequent updates):
 * - California, Texas, Florida, Ohio, Pennsylvania
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import {
  loadRDHCredentials,
  type RDHCredentials,
  type RDHDataset as RDHAPIDataset,
} from '../extractors/rdh-vtd-extractor.js';
import { logger } from '../../core/utils/logger.js';

/**
 * RDH dataset metadata
 */
export interface RDHDataset {
  readonly state: string;
  readonly stateFips: string;
  readonly dataType: 'vtd' | 'block' | 'blockgroup';
  readonly vintage: string; // e.g., "2020", "2022"
  readonly releaseDate: Date;
  readonly downloadUrl: string;
  readonly format: 'shapefile' | 'geojson';
  readonly fileSize: number; // bytes
  readonly checksum?: string;
}

/**
 * RDH scan result
 */
export interface RDHScanResult {
  readonly datasetsFound: readonly RDHDataset[];
  readonly newReleases: readonly RDHDataset[];
  readonly scannedAt: Date;
  readonly states: readonly string[];
}

/**
 * RDH scanner options
 */
export interface RDHScannerOptions {
  readonly states?: readonly string[]; // Filter to specific states (FIPS codes)
  readonly vintage?: string; // Filter to specific vintage (e.g., "2022")
  readonly checkNewOnly?: boolean; // Only return datasets newer than last scan
  readonly timeout?: number; // Request timeout in milliseconds
}

/**
 * Redistricting Data Hub Scanner
 *
 * Monitors RDH for new VTD releases and state-specific updates.
 */
export class RDHScanner {
  private readonly RDH_BASE_URL = 'https://redistrictingdatahub.org';
  private readonly RDH_API_URL = 'https://redistrictingdatahub.org/wp-json/download/list';
  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds

  // Track last scan timestamps per state
  private lastScans: Map<string, Date> = new Map();

  // API credentials (optional - falls back to web scraping if not provided)
  private readonly credentials: RDHCredentials | null;

  constructor(credentials?: RDHCredentials) {
    this.credentials = credentials ?? loadRDHCredentials();
  }

  /**
   * Scan RDH for VTD datasets
   *
   * NOTE: RDH does not have a public API as of 2026. This scanner uses
   * web scraping of the download page as a fallback. In production, we
   * recommend direct partnership with Princeton Gerrymandering Project
   * for API access.
   *
   * @param options - Scanner options
   * @returns Scan result with datasets found
   */
  async scan(options: RDHScannerOptions = {}): Promise<RDHScanResult> {
    const scannedAt = new Date();
    const timeout = options.timeout ?? this.DEFAULT_TIMEOUT;

    try {
      // Fetch RDH download page
      const downloadPageUrl = `${this.RDH_BASE_URL}/data/download-data/`;
      const response = await fetch(downloadPageUrl, {
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        logger.warn('RDH download page fetch failed', {
          url: downloadPageUrl,
          status: response.status
        });
        return {
          datasetsFound: [],
          newReleases: [],
          scannedAt,
          states: [],
        };
      }

      // Parse HTML to extract VTD dataset links
      const html = await response.text();
      const datasets = this.parseDownloadPage(html);

      // Filter by options
      let filteredDatasets = datasets;

      if (options.states && options.states.length > 0) {
        filteredDatasets = filteredDatasets.filter(d =>
          options.states!.includes(d.stateFips)
        );
      }

      if (options.vintage) {
        filteredDatasets = filteredDatasets.filter(
          d => d.vintage === options.vintage
        );
      }

      // Determine new releases
      const newReleases = options.checkNewOnly
        ? this.filterNewReleases(filteredDatasets)
        : filteredDatasets;

      // Update last scan timestamps
      for (const dataset of newReleases) {
        this.lastScans.set(dataset.stateFips, scannedAt);
      }

      const states = Array.from(
        new Set(filteredDatasets.map(d => d.stateFips))
      ).sort();

      return {
        datasetsFound: filteredDatasets,
        newReleases,
        scannedAt,
        states,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('RDH scan failed', {
        error: errorMessage,
        states: options.states,
        vintage: options.vintage
      });

      return {
        datasetsFound: [],
        newReleases: [],
        scannedAt,
        states: [],
      };
    }
  }

  /**
   * Scan specific priority states
   *
   * High-volume states with frequent VTD updates:
   * - California (06), Texas (48), Florida (12), Ohio (39), Pennsylvania (42)
   */
  async scanPriorityStates(): Promise<RDHScanResult> {
    const priorityStates = ['06', '12', '39', '42', '48'];

    return await this.scan({
      states: priorityStates,
      checkNewOnly: true,
    });
  }

  /**
   * List VTD datasets using authenticated RDH API
   *
   * Returns full dataset metadata with download URLs when credentials are available.
   * Falls back to web scraping if no credentials configured.
   *
   * @param stateCode - Two-letter state code (e.g., "CA", "TX")
   * @returns Array of RDH API dataset metadata
   */
  async listDatasetsAuthenticated(
    stateCode: string
  ): Promise<readonly RDHAPIDataset[]> {
    if (!this.credentials) {
      logger.warn('RDH credentials not configured', {
        stateCode,
        fallback: 'web scraping'
      });
      // Return empty array - caller should use scan() for unauthenticated access
      return [];
    }

    try {
      const params = new URLSearchParams({
        username: this.credentials.username,
        password: this.credentials.password,
        format: 'json',
        states: stateCode,
      });

      const response = await fetch(`${this.RDH_API_URL}?${params}`, {
        signal: AbortSignal.timeout(this.DEFAULT_TIMEOUT),
      });

      if (!response.ok) {
        logger.warn('RDH API request failed', {
          stateCode,
          status: response.status,
          statusText: response.statusText
        });
        return [];
      }

      const data: unknown = await response.json();

      if (!Array.isArray(data)) {
        const errorData = data as { message?: string };
        logger.error('RDH API returned error', {
          stateCode,
          message: errorData.message ?? String(data)
        });
        return [];
      }

      // Filter for VTD/precinct shapefiles (matches RDHVTDExtractor logic)
      const vtdDatasets = (data as readonly RDHAPIDataset[]).filter(d => {
        const title = (d.Title ?? '').toLowerCase();
        const filename = (d.Filename ?? '').toLowerCase();
        const isVTD =
          title.includes('vtd') ||
          filename.includes('vtd') ||
          title.includes('precinct') ||
          filename.includes('precinct');
        const isShapefile = d.Format === 'SHP';
        return isVTD && isShapefile;
      });

      // Sort: prefer 2020 VEST data, then 2022, then any
      const sortedDatasets = [...vtdDatasets].sort((a, b) => {
        const scoreA = a.Title.includes('VEST 2020')
          ? 0
          : a.Title.includes('VEST 2022')
            ? 1
            : 2;
        const scoreB = b.Title.includes('VEST 2020')
          ? 0
          : b.Title.includes('VEST 2022')
            ? 1
            : 2;
        return scoreA - scoreB;
      });

      return sortedDatasets;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('RDH API call failed', {
        stateCode,
        error: errorMessage
      });
      return [];
    }
  }

  /**
   * Check if scanner has API credentials configured
   *
   * @returns True if authenticated API access is available
   */
  hasCredentials(): boolean {
    return this.credentials !== null;
  }

  /**
   * Parse RDH download page HTML to extract VTD datasets
   *
   * NOTE: This is a fallback implementation using web scraping.
   * In production, use direct API access via partnership with
   * Princeton Gerrymandering Project.
   *
   * @param html - RDH download page HTML
   * @returns Array of parsed datasets
   */
  private parseDownloadPage(html: string): readonly RDHDataset[] {
    const datasets: RDHDataset[] = [];

    // Pattern to match VTD dataset links
    // Example: "California 2020 VTDs" or "TX_2022_vtds.zip"
    const vtdLinkPattern =
      /<a[^>]+href="([^"]+)"[^>]*>([^<]*(?:VTD|vtd|precinct)[^<]*)<\/a>/gi;

    let match;
    while ((match = vtdLinkPattern.exec(html)) !== null) {
      const [, url, linkText] = match;

      // Extract state and vintage from link text
      const stateMatch = linkText.match(/([A-Z]{2}|[A-Z][a-z]+)\s*(\d{4})/i);
      if (!stateMatch) continue;

      const [, stateStr, vintage] = stateMatch;

      // Convert state name to FIPS (simplified - production should use full lookup)
      const stateFips = this.stateToFips(stateStr);
      if (!stateFips) continue;

      // Determine format from URL
      const format = url.toLowerCase().endsWith('.geojson')
        ? 'geojson'
        : 'shapefile';

      datasets.push({
        state: stateStr,
        stateFips,
        dataType: 'vtd',
        vintage,
        releaseDate: new Date(), // Placeholder - scrape from page or use file metadata
        downloadUrl: url.startsWith('http') ? url : `${this.RDH_BASE_URL}${url}`,
        format,
        fileSize: 0, // Requires HEAD request to get actual size
      });
    }

    return datasets;
  }

  /**
   * Filter datasets to only new releases since last scan
   *
   * @param datasets - All datasets
   * @returns Datasets newer than last scan
   */
  private filterNewReleases(
    datasets: readonly RDHDataset[]
  ): readonly RDHDataset[] {
    return datasets.filter(dataset => {
      const lastScan = this.lastScans.get(dataset.stateFips);
      if (!lastScan) return true; // Never scanned - treat as new

      return dataset.releaseDate > lastScan;
    });
  }

  /**
   * Convert state abbreviation or name to FIPS code
   *
   * Simplified implementation - production should use comprehensive lookup table.
   *
   * @param state - State abbreviation or name
   * @returns Two-digit FIPS code, or null if not recognized
   */
  private stateToFips(state: string): string | null {
    // Simplified mapping for common states
    const fipsMap: Record<string, string> = {
      CA: '06',
      TX: '48',
      FL: '12',
      NY: '36',
      PA: '42',
      IL: '17',
      OH: '39',
      GA: '13',
      NC: '37',
      MI: '26',
      California: '06',
      Texas: '48',
      Florida: '12',
      'New York': '36',
      Pennsylvania: '42',
      Illinois: '17',
      Ohio: '39',
      Georgia: '13',
      'North Carolina': '37',
      Michigan: '26',
    };

    return fipsMap[state] ?? null;
  }

  /**
   * Check if state has VTD data available on RDH
   *
   * @param stateFips - Two-digit state FIPS code
   * @returns True if state has VTD data on RDH
   */
  async hasVTDData(stateFips: string): Promise<boolean> {
    const result = await this.scan({
      states: [stateFips],
    });

    return result.datasetsFound.length > 0;
  }

  /**
   * Get last scan timestamp for a state
   *
   * @param stateFips - Two-digit state FIPS code
   * @returns Last scan date, or null if never scanned
   */
  getLastScan(stateFips: string): Date | null {
    return this.lastScans.get(stateFips) ?? null;
  }

  /**
   * Clear scan history
   *
   * Useful for testing or resetting state.
   */
  clearScanHistory(): void {
    this.lastScans.clear();
  }
}

/**
 * Singleton instance for convenience
 */
export const rdhScanner = new RDHScanner();

// Re-export types from extractor for convenience
export type { RDHCredentials, RDHDataset as RDHAPIDataset } from '../extractors/rdh-vtd-extractor.js';
export { loadRDHCredentials } from '../extractors/rdh-vtd-extractor.js';
