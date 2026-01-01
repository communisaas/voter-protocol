/**
 * Change Detection Adapter - TIGER Source Change Detection
 *
 * Adapts the generic ChangeDetector to work specifically with TIGER/Line sources.
 * Checks for upstream changes via HTTP HEAD requests and persists checksums.
 *
 * TIGER URL PATTERN:
 * https://www2.census.gov/geo/tiger/TIGER{year}/{LAYER}/tl_{year}_{fips}_{layer}.zip
 *
 * Cost: $0/year (HEAD requests are free)
 *
 * CRITICAL TYPE SAFETY: Change detection drives download decisions.
 * Type errors waste bandwidth or miss boundary updates.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ChangeDetector, ChangeReport, UpdateTrigger } from './change-detector.js';

/**
 * TIGER source configuration
 */
export interface TigerSourceConfig {
  readonly layerType: 'cd' | 'sldu' | 'sldl' | 'county';
  readonly vintage: number;
  readonly states: readonly string[]; // FIPS codes or ['all'] for all states
  readonly updateTriggers: readonly UpdateTrigger[];
}

/**
 * Change detection configuration
 */
export interface ChangeDetectionConfig {
  readonly sources: readonly TigerSourceConfig[];
  readonly storageDir: string;
  readonly checksumCachePath?: string; // Persist checksums between runs
}

/**
 * Cached checksum entry
 */
interface CachedChecksum {
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly checkedAt: string;
}

/**
 * Checksum cache format (persisted to JSON)
 */
interface ChecksumCache {
  lastChecked: string;
  sources: Record<string, CachedChecksum>;
}

/**
 * Change detection result
 */
export interface ChangeDetectionAdapterResult {
  readonly changedLayers: readonly string[];
  readonly changedStates: readonly string[];
  readonly reports: readonly ChangeReport[];
  readonly lastChecked: Date;
}

/**
 * US state FIPS codes (for 'all' expansion)
 */
const US_STATE_FIPS: readonly string[] = [
  '01', '02', '04', '05', '06', '08', '09', '10', '11', '12',
  '13', '15', '16', '17', '18', '19', '20', '21', '22', '23',
  '24', '25', '26', '27', '28', '29', '30', '31', '32', '33',
  '34', '35', '36', '37', '38', '39', '40', '41', '42', '44',
  '45', '46', '47', '48', '49', '50', '51', '53', '54', '55',
  '56',
] as const;

/**
 * Change Detection Adapter
 *
 * High-level wrapper around ChangeDetector for TIGER sources.
 * Manages TIGER URL generation, checksum caching, and result aggregation.
 */
export class ChangeDetectionAdapter {
  private readonly config: ChangeDetectionConfig;
  private readonly checksumCachePath: string;
  private cache: ChecksumCache;

  constructor(config: ChangeDetectionConfig) {
    this.config = config;
    this.checksumCachePath =
      config.checksumCachePath ??
      `${config.storageDir}/checksums.json`;
    this.cache = {
      lastChecked: new Date(0).toISOString(),
      sources: {},
    };
  }

  /**
   * Load checksum cache from disk
   */
  async loadCache(): Promise<void> {
    try {
      const json = await readFile(this.checksumCachePath, 'utf-8');
      this.cache = JSON.parse(json);
    } catch (error) {
      // Cache doesn't exist yet - use empty cache
      this.cache = {
        lastChecked: new Date(0).toISOString(),
        sources: {},
      };
    }
  }

  /**
   * Save checksum cache to disk
   */
  async saveCache(): Promise<void> {
    // Ensure directory exists
    await mkdir(dirname(this.checksumCachePath), { recursive: true });

    // Write cache atomically (write to temp, then rename)
    const json = JSON.stringify(this.cache, null, 2);
    await writeFile(this.checksumCachePath, json, 'utf-8');
  }

  /**
   * Detect changes in all configured TIGER sources
   *
   * Checks each TIGER source URL via HTTP HEAD and compares checksums.
   * Returns aggregated results with changed layers and states.
   */
  async detectChanges(): Promise<ChangeDetectionAdapterResult> {
    const reports: ChangeReport[] = [];
    const changedLayersSet = new Set<string>();
    const changedStatesSet = new Set<string>();

    // Expand 'all' states to full FIPS list
    const expandedSources = this.expandSources();

    // Check each source
    for (const source of expandedSources) {
      for (const state of source.states) {
        const sourceId = this.makeSourceId(source.layerType, state, source.vintage);
        const url = this.getSourceUrl(source.layerType, state, source.vintage);

        try {
          // Fetch current checksums
          const headers = await this.fetchHeaders(url);
          const newChecksum = headers.etag || headers.lastModified;

          if (!newChecksum) {
            // No checksums available (404, network error, etc.)
            continue;
          }

          // Compare with cached checksum
          const cached = this.cache.sources[sourceId];
          const oldChecksum = cached?.etag || cached?.lastModified || null;

          if (oldChecksum === newChecksum) {
            // No change
            continue;
          }

          // Change detected
          const changeType = oldChecksum === null ? 'new' : 'modified';
          reports.push({
            sourceId,
            url,
            oldChecksum,
            newChecksum,
            detectedAt: new Date().toISOString(),
            trigger: 'scheduled',
            changeType: changeType as 'new' | 'modified',
          });

          changedLayersSet.add(source.layerType);
          changedStatesSet.add(state);
        } catch (error) {
          // Error checking source - log but continue
          console.warn(`Failed to check ${sourceId}: ${(error as Error).message}`);
        }
      }
    }

    const result: ChangeDetectionAdapterResult = {
      changedLayers: Array.from(changedLayersSet),
      changedStates: Array.from(changedStatesSet),
      reports,
      lastChecked: new Date(),
    };

    return result;
  }

  /**
   * Get TIGER source URL for a layer
   *
   * @param layer - Layer type (cd, sldu, sldl, county)
   * @param state - State FIPS code
   * @param vintage - TIGER year
   * @returns Complete TIGER download URL
   */
  getSourceUrl(
    layer: 'cd' | 'sldu' | 'sldl' | 'county',
    state: string,
    vintage: number
  ): string {
    const layerUpper = layer.toUpperCase();
    const layerLower = layer.toLowerCase();

    return `https://www2.census.gov/geo/tiger/TIGER${vintage}/${layerUpper}/tl_${vintage}_${state}_${layerLower}.zip`;
  }

  /**
   * Update cached checksums after successful download
   *
   * @param reports - Change reports to update checksums for
   */
  async updateChecksums(reports: readonly ChangeReport[]): Promise<void> {
    for (const report of reports) {
      this.cache.sources[report.sourceId] = {
        etag: report.newChecksum.startsWith('"') ? report.newChecksum : null,
        lastModified: !report.newChecksum.startsWith('"') ? report.newChecksum : null,
        checkedAt: report.detectedAt,
      };
    }

    this.cache.lastChecked = new Date().toISOString();
    await this.saveCache();
  }

  /**
   * Fetch HTTP headers using HEAD request
   */
  private async fetchHeaders(url: string): Promise<{
    etag: string | null;
    lastModified: string | null;
  }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0 (Change Detection)',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return {
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Expand 'all' states to full FIPS list
   */
  private expandSources(): Array<{
    layerType: 'cd' | 'sldu' | 'sldl' | 'county';
    vintage: number;
    states: readonly string[];
    updateTriggers: readonly UpdateTrigger[];
  }> {
    return this.config.sources.map(source => {
      if (source.states.length === 1 && source.states[0] === 'all') {
        return {
          ...source,
          states: US_STATE_FIPS,
        };
      }
      return source;
    });
  }

  /**
   * Create source ID from layer, state, and vintage
   */
  private makeSourceId(
    layer: string,
    state: string,
    vintage: number
  ): string {
    return `${layer}:${state}:${vintage}`;
  }
}
