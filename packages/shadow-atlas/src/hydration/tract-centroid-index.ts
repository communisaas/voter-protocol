/**
 * Tract Centroid Index — TIGER Tract Geometry → Centroid Lookup
 *
 * Downloads TIGER/Line tract shapefiles from Census FTP, computes centroids,
 * and provides a fast lookup: tractGeoid → [longitude, latitude].
 *
 * Used by the supplemental overlay to determine which ward polygon a tract
 * falls within (point-in-polygon test on the tract centroid).
 *
 * Data source: https://www2.census.gov/geo/tiger/TIGER2024/TRACT/
 * File pattern: tl_2024_{stateFips}_tract.zip
 *
 * Already-downloaded GeoJSON files in agents/data/census-places/ are a
 * different layer (places, not tracts). This module handles the tract layer.
 *
 * @packageDocumentation
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as shapefile from 'shapefile';
import JSZip from 'jszip';
import type { Feature, Polygon, MultiPolygon } from 'geojson';

// ============================================================================
// Types
// ============================================================================

export interface TractCentroidIndex {
  /** Get centroid [longitude, latitude] for a tract GEOID. */
  getCentroid(tractGeoid: string): [number, number] | undefined;
  /** Number of indexed tracts. */
  readonly size: number;
}

export interface TractCentroidOptions {
  /** Cache directory for downloaded TIGER files and computed centroids. */
  cacheDir: string;
  /** Log function. */
  log?: (msg: string) => void;
}

// ============================================================================
// Constants
// ============================================================================

const TIGER_TRACT_BASE_URL =
  'https://www2.census.gov/geo/tiger/TIGER2024/TRACT';

/** Centroid cache filename per state. */
function centroidCacheFile(stateFips: string): string {
  return `tract-centroids-${stateFips}.json`;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Build a centroid index for tracts in one or more states.
 *
 * Process per state:
 * 1. Check centroid cache (JSON map of GEOID → [lon, lat])
 * 2. If cache miss: download TIGER tract shapefile, extract, compute centroids
 * 3. Write centroid cache for next time
 *
 * @param stateFips - Single state FIPS or array of state FIPS codes
 * @param options - Cache directory and logging
 * @returns TractCentroidIndex with fast GEOID → centroid lookup
 */
export async function buildTractCentroidIndex(
  stateFips: string | string[],
  options: TractCentroidOptions,
): Promise<TractCentroidIndex> {
  const { cacheDir, log = console.log } = options;

  const tractCacheDir = join(cacheDir, 'tract-centroids');
  await mkdir(tractCacheDir, { recursive: true });

  const fipsList = Array.isArray(stateFips) ? stateFips : [stateFips];
  const centroids = new Map<string, [number, number]>();

  for (const fips of fipsList) {
    const stateCentroids = await loadStateCentroids(fips, tractCacheDir, log);
    for (const [geoid, centroid] of stateCentroids) {
      centroids.set(geoid, centroid);
    }
  }

  log(`[TRACT] Centroid index: ${centroids.size} tracts across ${fipsList.length} state(s)`);

  return {
    getCentroid(tractGeoid: string): [number, number] | undefined {
      return centroids.get(tractGeoid);
    },
    get size() {
      return centroids.size;
    },
  };
}

// ============================================================================
// Per-State Loading
// ============================================================================

async function loadStateCentroids(
  stateFips: string,
  cacheDir: string,
  log: (msg: string) => void,
): Promise<Map<string, [number, number]>> {
  const cacheFile = join(cacheDir, centroidCacheFile(stateFips));

  // Try centroid cache first
  try {
    const cached = await readFile(cacheFile, 'utf-8');
    const parsed: Record<string, [number, number]> = JSON.parse(cached);
    const map = new Map(Object.entries(parsed));
    log(`[TRACT] State ${stateFips}: ${map.size} tracts (cached)`);
    return map;
  } catch {
    // Cache miss — download and compute
  }

  // Download TIGER tract shapefile
  const zipUrl = `${TIGER_TRACT_BASE_URL}/tl_2024_${stateFips}_tract.zip`;
  log(`[TRACT] Downloading TIGER tracts for state ${stateFips}...`);

  const resp = await fetch(zipUrl);
  if (!resp.ok) {
    throw new Error(`Failed to download ${zipUrl}: HTTP ${resp.status}`);
  }

  const zipBuffer = Buffer.from(await resp.arrayBuffer());

  // Extract shapefile components
  const zip = await JSZip.loadAsync(zipBuffer);

  type ZipFile = { async(type: 'arraybuffer'): Promise<ArrayBuffer> };
  let shpFile: ZipFile | null = null;
  let dbfFile: ZipFile | null = null;

  zip.forEach((path: string, file: ZipFile) => {
    if (path.endsWith('.shp')) shpFile = file;
    else if (path.endsWith('.dbf')) dbfFile = file;
  });

  if (!shpFile || !dbfFile) {
    throw new Error(`Shapefile components not found in ${zipUrl}`);
  }

  const shpBuffer = await (shpFile as ZipFile).async('arraybuffer');
  const dbfBuffer = await (dbfFile as ZipFile).async('arraybuffer');

  // Parse features and compute centroids
  const source = await shapefile.open(shpBuffer, dbfBuffer);
  const centroids = new Map<string, [number, number]>();

  let result = await source.read();
  while (!result.done) {
    if (result.value) {
      const feature = result.value as Feature;
      const geoid = feature.properties?.GEOID as string | undefined;
      const geom = feature.geometry;

      if (geoid && geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
        const centroid = computeCentroid(geom as Polygon | MultiPolygon);
        if (centroid) {
          centroids.set(geoid, centroid);
        }
      }
    }
    result = await source.read();
  }

  log(`[TRACT] State ${stateFips}: ${centroids.size} tracts (downloaded)`);

  // Cache centroids
  const cacheObj: Record<string, [number, number]> = {};
  for (const [geoid, centroid] of centroids) {
    cacheObj[geoid] = centroid;
  }
  await writeFile(cacheFile, JSON.stringify(cacheObj));

  return centroids;
}

// ============================================================================
// Centroid Computation
// ============================================================================

/**
 * Compute the centroid of a Polygon or MultiPolygon.
 *
 * Uses the area-weighted centroid of the exterior ring(s).
 * For MultiPolygon, takes the centroid of the largest polygon by area.
 *
 * Returns [longitude, latitude] or undefined if geometry is degenerate.
 */
function computeCentroid(
  geometry: Polygon | MultiPolygon,
): [number, number] | undefined {
  if (geometry.type === 'Polygon') {
    return ringCentroid(geometry.coordinates[0]);
  }

  // MultiPolygon: use largest polygon
  let bestCentroid: [number, number] | undefined;
  let bestArea = 0;

  for (const polygon of geometry.coordinates) {
    const ring = polygon[0];
    const area = Math.abs(ringArea(ring));
    if (area > bestArea) {
      bestArea = area;
      bestCentroid = ringCentroid(ring);
    }
  }

  return bestCentroid;
}

/**
 * Compute the centroid of a polygon ring using the shoelace formula.
 */
function ringCentroid(ring: number[][]): [number, number] | undefined {
  if (ring.length < 3) return undefined;

  let cx = 0;
  let cy = 0;
  let area = 0;

  for (let i = 0; i < ring.length - 1; i++) {
    const x0 = ring[i][0];
    const y0 = ring[i][1];
    const x1 = ring[i + 1][0];
    const y1 = ring[i + 1][1];

    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }

  area *= 0.5;
  if (Math.abs(area) < 1e-12) return undefined;

  cx /= 6 * area;
  cy /= 6 * area;

  return [cx, cy];
}

/**
 * Compute signed area of a polygon ring (shoelace formula).
 */
function ringArea(ring: number[][]): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area * 0.5;
}
