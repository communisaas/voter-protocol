/**
 * Ward Boundary Loader — Download + Cache Ward GeoJSON from ArcGIS
 *
 * Downloads ward/council district GeoJSON from ArcGIS FeatureServer endpoints
 * discovered by the bulk ingestion pipeline. Each city's boundaries are cached
 * as a single GeoJSON file.
 *
 * Ward number extraction follows multiple heuristics:
 * 1. Explicit field: DISTRICT, WARD, COUNCIL_DIST, DIST_NUM, DIST_NO
 * 2. Name field: Extract trailing number from NAME (e.g., "Ward 3" → 3)
 * 3. Fallback: Feature index + 1
 *
 * @packageDocumentation
 */

import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteFile } from '../core/utils/atomic-write.js';
import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';
import type { WardEntry } from './ward-registry.js';
import { fetchWithSizeLimit } from './fetch-with-size-limit.js';

// ============================================================================
// Types
// ============================================================================

export interface WardBoundary {
  /** Ward number (1-based). */
  wardNumber: number;
  /** Ward GEOID: cityFips + zero-padded ward number (9 digits). */
  wardGeoid: string;
  /** GeoJSON geometry (Polygon or MultiPolygon). */
  geometry: Polygon | MultiPolygon;
  /** Raw GeoJSON properties from the source. */
  properties: Record<string, unknown>;
}

export interface CityWardBoundaries {
  /** City FIPS code. */
  cityFips: string;
  /** City name. */
  cityName: string;
  /** State abbreviation. */
  state: string;
  /** Parsed ward boundaries. */
  wards: WardBoundary[];
}

export interface WardBoundaryLoaderOptions {
  /** Cache directory for downloaded GeoJSON files. */
  cacheDir: string;
  /** Max retry attempts per download (default: 3). */
  maxRetries?: number;
  /** Max age for cached files in ms (default: 30 days). */
  maxCacheAgeMs?: number;
  /** Log function. */
  log?: (msg: string) => void;
}

export interface WardBoundaryLoaderResult {
  /** Successfully loaded cities. */
  loaded: CityWardBoundaries[];
  /** Cities that failed to load (network error, parse error, etc.). */
  failed: Array<{ cityFips: string; error: string }>;
}

// ============================================================================
// Ward Number Field Detection
// ============================================================================

/**
 * Common field names for ward/district numbers in ArcGIS data.
 * Ordered by specificity (most specific first).
 */
const WARD_NUMBER_FIELDS = [
  'DISTRICT', 'WARD', 'COUNCIL_DIST', 'DIST_NUM', 'DIST_NO',
  'WARD_NUM', 'WARD_NO', 'COUNCIL', 'DIST', 'WARDNUM',
  'DISTRICT_NUMBER', 'WARD_NUMBER', 'NUMBER', 'NUM',
];

/**
 * Fields commonly containing a name with an embedded number.
 */
const WARD_NAME_FIELDS = ['NAME', 'WARD_NAME', 'DIST_NAME', 'LABEL'];

/**
 * Extract ward number from a GeoJSON feature's properties.
 *
 * Strategy:
 * 1. Check explicit numeric fields (DISTRICT, WARD, etc.)
 * 2. Parse trailing number from name fields ("Ward 3" → 3)
 * 3. Return undefined if no number found
 */
function extractWardNumber(properties: Record<string, unknown>): number | undefined {
  // Normalize property keys to uppercase for matching
  const upperProps = new Map<string, unknown>();
  for (const [key, value] of Object.entries(properties)) {
    upperProps.set(key.toUpperCase(), value);
  }

  // Strategy 1: Explicit numeric fields
  for (const field of WARD_NUMBER_FIELDS) {
    const value = upperProps.get(field);
    if (value !== undefined && value !== null) {
      const num = typeof value === 'number' ? value : parseInt(String(value), 10);
      if (!isNaN(num) && num > 0 && num <= 100) {
        return num;
      }
    }
  }

  // Strategy 2: Parse number from name fields
  for (const field of WARD_NAME_FIELDS) {
    const value = upperProps.get(field);
    if (typeof value === 'string') {
      const match = value.match(/(\d+)\s*$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > 0 && num <= 100) return num;
      }
      // Also try "District A" → ordinal (A=1, B=2, etc.)
      const letterMatch = value.match(/\b([A-Z])\s*$/i);
      if (letterMatch) {
        const ord = letterMatch[1].toUpperCase().charCodeAt(0) - 64; // A=1
        if (ord > 0 && ord <= 26) return ord;
      }
    }
  }

  return undefined;
}

// ============================================================================
// Loader
// ============================================================================

/**
 * Download and cache ward boundaries for a list of cities.
 *
 * For each WardEntry, constructs an ArcGIS GeoJSON query URL from the
 * FeatureServer layer URL, downloads the result, extracts ward numbers,
 * and caches the raw GeoJSON.
 *
 * @param entries - Ward registry entries to load
 * @param options - Download and cache configuration
 * @returns Loaded boundaries and failures
 */
export async function loadWardBoundaries(
  entries: WardEntry[],
  options: WardBoundaryLoaderOptions,
): Promise<WardBoundaryLoaderResult> {
  const {
    cacheDir,
    maxRetries = 3,
    maxCacheAgeMs = 30 * 24 * 60 * 60 * 1000, // 30 days
    log = console.log,
  } = options;

  const wardCacheDir = join(cacheDir, 'wards');
  await mkdir(wardCacheDir, { recursive: true });

  const loaded: CityWardBoundaries[] = [];
  const failed: Array<{ cityFips: string; error: string }> = [];

  for (const entry of entries) {
    try {
      const boundaries = await loadSingleCity(
        entry,
        wardCacheDir,
        maxRetries,
        maxCacheAgeMs,
        log,
      );
      if (boundaries.wards.length > 0) {
        loaded.push(boundaries);
      } else {
        failed.push({ cityFips: entry.cityFips, error: 'No valid ward features' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ cityFips: entry.cityFips, error: msg });
      log(`[WARD] Failed to load ${entry.cityName} (${entry.cityFips}): ${msg}`);
    }
  }

  log(`[WARD] Loaded: ${loaded.length} cities, Failed: ${failed.length}`);
  return { loaded, failed };
}

async function loadSingleCity(
  entry: WardEntry,
  cacheDir: string,
  maxRetries: number,
  maxCacheAgeMs: number,
  log: (msg: string) => void,
): Promise<CityWardBoundaries> {
  const cachePath = join(cacheDir, `${entry.cityFips}.geojson`);

  // Check cache
  let geojson: FeatureCollection;
  let fromCache = false;

  try {
    const fileStat = await stat(cachePath);
    const age = Date.now() - fileStat.mtimeMs;
    if (age < maxCacheAgeMs) {
      const raw = await readFile(cachePath, 'utf-8');
      geojson = JSON.parse(raw);
      fromCache = true;
    } else {
      geojson = await fetchWardGeoJSON(entry.sourceUrl, maxRetries);
      // Atomic write via shared atomicWriteFile utility
      await atomicWriteFile(cachePath, JSON.stringify(geojson));
    }
  } catch {
    // Cache miss or stale — download
    geojson = await fetchWardGeoJSON(entry.sourceUrl, maxRetries);
    // Atomic write via shared atomicWriteFile utility
    await atomicWriteFile(cachePath, JSON.stringify(geojson));
  }

  if (!geojson.features || geojson.features.length === 0) {
    throw new Error('Empty FeatureCollection');
  }

  // Parse ward boundaries from features
  const wards = parseWardFeatures(geojson.features, entry.cityFips);

  if (!fromCache) {
    log(`[WARD] Downloaded ${entry.cityName} (${entry.state}): ${wards.length} wards`);
  }

  return {
    cityFips: entry.cityFips,
    cityName: entry.cityName,
    state: entry.state,
    wards,
  };
}

/**
 * R58-A2: Extract a deterministic anchor point [lon, lat] from a feature's geometry.
 * Uses the first coordinate of the exterior ring. Falls back to [0, 0] for
 * null/unsupported geometries (these are filtered out later).
 */
function featureAnchor(feature: Feature): [number, number] {
  const geom = feature.geometry;
  if (!geom) return [0, 0];
  if (geom.type === 'Polygon') return geom.coordinates[0]?.[0] as [number, number] ?? [0, 0];
  if (geom.type === 'MultiPolygon') return geom.coordinates[0]?.[0]?.[0] as [number, number] ?? [0, 0];
  return [0, 0];
}

/**
 * Parse GeoJSON features into WardBoundary objects.
 *
 * Extracts ward numbers and builds ward GEOIDs.
 * Features without valid geometry or ward number are skipped.
 */
function parseWardFeatures(
  features: Feature[],
  cityFips: string,
): WardBoundary[] {
  const wards: WardBoundary[] = [];
  const usedNumbers = new Set<number>();

  // R58-A2: Sort features by geometry anchor point for deterministic ward numbering.
  // ArcGIS FeatureServer does not guarantee stable feature ordering across requests.
  // Without this sort, "next available" ward numbers and index-based fallbacks
  // depend on iteration order, producing different GEOIDs (and thus different
  // Merkle roots) from the same source data.
  const sorted = [...features].sort((a, b) => {
    const [ax, ay] = featureAnchor(a);
    const [bx, by] = featureAnchor(b);
    if (ay !== by) return ay - by; // latitude first
    return ax - bx;                // then longitude
  });

  for (let i = 0; i < sorted.length; i++) {
    const feature = sorted[i];
    const geom = feature.geometry;

    // Only accept Polygon and MultiPolygon geometries
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) {
      continue;
    }

    const props = (feature.properties ?? {}) as Record<string, unknown>;
    let wardNumber = extractWardNumber(props);

    // Fallback: use feature index + 1
    if (wardNumber === undefined) {
      wardNumber = i + 1;
    }

    // Avoid duplicate ward numbers
    if (usedNumbers.has(wardNumber)) {
      // Find next available number
      let next = wardNumber + 1;
      while (usedNumbers.has(next)) next++;
      wardNumber = next;
    }
    usedNumbers.add(wardNumber);

    const wardGeoid = cityFips + String(wardNumber).padStart(2, '0');

    wards.push({
      wardNumber,
      wardGeoid,
      geometry: geom as Polygon | MultiPolygon,
      properties: props,
    });
  }

  return wards;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Fetch ward GeoJSON from an ArcGIS FeatureServer layer.
 *
 * Appends the standard query parameters to get all features as GeoJSON.
 */
async function fetchWardGeoJSON(
  layerUrl: string,
  maxRetries: number,
): Promise<FeatureCollection> {
  // R49-F2: Size-limited fetch — ward boundaries are large GeoJSON but should never exceed 100 MB
  const MAX_SIZE = 100 * 1024 * 1024;
  const queryUrl = `${layerUrl}/query?where=1%3D1&outFields=*&f=geojson`;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const text = await fetchWithSizeLimit(queryUrl, MAX_SIZE);
      const data = JSON.parse(text);

      // ArcGIS sometimes returns error objects instead of GeoJSON
      if (data.error) {
        throw new Error(`ArcGIS error: ${data.error.message || JSON.stringify(data.error)}`);
      }

      if (data.type !== 'FeatureCollection') {
        throw new Error(`Expected FeatureCollection, got ${data.type}`);
      }

      return data as FeatureCollection;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await sleep(1000 * Math.pow(2, attempt - 1));
      }
    }
  }

  throw new Error(
    `Failed to download ${queryUrl} after ${maxRetries} attempts: ${lastError?.message}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
