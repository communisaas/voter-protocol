/**
 * Supplemental District Overlay — General-Purpose Block-Level District Injection
 *
 * Follows the BEF overlay pattern: mutate block.districts.set(slot, geoid) between
 * BAF parsing and cell resolution. The cell resolver downstream handles virtual cell
 * splitting when blocks within a tract disagree.
 *
 * The overlay is slot-agnostic. The first consumer is city council wards (slot 6),
 * but the same engine supports fire districts (12), transit (13), etc.
 *
 * Algorithm per block:
 *   1. Look up block's city from slot 5 (place FIPS). Skip if city has no boundary data.
 *   2. Get tract centroid from the centroid index. All blocks in a tract share a centroid.
 *   3. Point-in-polygon test: centroid against each ward polygon for that city.
 *   4. First match → block.districts.set(slot, wardGeoid).
 *   5. No match → counted as unmatched (block may be in a gap between ward boundaries).
 *
 * @packageDocumentation
 */

import * as turf from '@turf/turf';
import type { Polygon, MultiPolygon } from 'geojson';
import type { BlockRecord } from './baf-parser.js';
import type { CityWardBoundaries, WardBoundary } from './ward-boundary-loader.js';
import type { TractCentroidIndex } from './tract-centroid-index.js';

// ============================================================================
// Types
// ============================================================================

export interface SupplementalOverlayOptions {
  /** Target slot in the 24-slot taxonomy (e.g., 6 for city council). */
  slot: number;
  /** Ward/district boundaries with GeoJSON geometry. */
  boundaries: CityWardBoundaries[];
  /** Tract centroid lookup. */
  centroidIndex: TractCentroidIndex;
  /** Log function. */
  log?: (msg: string) => void;
}

export interface SupplementalOverlayResult {
  /** Blocks updated per city FIPS. */
  updatedByCity: Map<string, number>;
  /** Total blocks updated. */
  totalUpdated: number;
  /** Blocks in covered cities where no ward polygon matched. */
  unmatched: number;
  /** Total blocks in covered cities (updated + unmatched). */
  totalInCoveredCities: number;
  /** Coverage: fraction of blocks in covered cities that got a district assignment. */
  coverage: number;
}

// ============================================================================
// Overlay Engine
// ============================================================================

/**
 * Overlay supplemental district boundaries onto block records.
 *
 * For each block whose city (slot 5) matches a boundary set, uses the tract
 * centroid to determine which ward/district the block falls within, then sets
 * the target slot.
 *
 * @param blocks - Mutable block map from parseBAFFilesAsync()
 * @param options - Overlay configuration
 * @returns Overlay statistics
 */
export function overlaySupplementalDistricts(
  blocks: Map<string, BlockRecord>,
  options: SupplementalOverlayOptions,
): SupplementalOverlayResult {
  const { slot, boundaries, centroidIndex, log = console.log } = options;

  // Build city FIPS → ward boundaries index with bounding box pre-filter
  const cityIndex = buildCityIndex(boundaries);

  // Track per-tract centroid PIP results to avoid redundant computation.
  // Key: `${tractGeoid}:${cityFips}`, Value: wardGeoid or null (no match).
  const tractWardCache = new Map<string, string | null>();

  const updatedByCity = new Map<string, number>();
  let totalUpdated = 0;
  let unmatched = 0;
  let totalInCoveredCities = 0;

  for (const [, block] of blocks) {
    // Get block's city from slot 5 (place FIPS)
    const cityGeoid = block.districts.get(5);
    if (!cityGeoid) continue;

    // Extract city FIPS from place GEOID.
    // Place GEOIDs are state(2) + place(5) = 7 digits.
    const cityFips = cityGeoid;
    const cityBounds = cityIndex.get(cityFips);
    if (!cityBounds) continue;

    totalInCoveredCities++;

    // Check tract-level cache first
    const cacheKey = `${block.tractGeoid}:${cityFips}`;
    const cached = tractWardCache.get(cacheKey);

    if (cached !== undefined) {
      if (cached !== null) {
        block.districts.set(slot, cached);
        updatedByCity.set(cityFips, (updatedByCity.get(cityFips) ?? 0) + 1);
        totalUpdated++;
      } else {
        unmatched++;
      }
      continue;
    }

    // Get tract centroid
    const centroid = centroidIndex.getCentroid(block.tractGeoid);
    if (!centroid) {
      tractWardCache.set(cacheKey, null);
      unmatched++;
      continue;
    }

    // Point-in-polygon test against each ward
    const wardGeoid = findContainingWard(centroid, cityBounds);
    tractWardCache.set(cacheKey, wardGeoid);

    if (wardGeoid) {
      block.districts.set(slot, wardGeoid);
      updatedByCity.set(cityFips, (updatedByCity.get(cityFips) ?? 0) + 1);
      totalUpdated++;
    } else {
      unmatched++;
    }
  }

  const coverage = totalInCoveredCities > 0
    ? totalUpdated / totalInCoveredCities
    : 0;

  log(`[OVERLAY] Slot ${slot}: ${totalUpdated.toLocaleString()} blocks updated, ${unmatched.toLocaleString()} unmatched, ${(coverage * 100).toFixed(1)}% coverage`);

  return {
    updatedByCity,
    totalUpdated,
    unmatched,
    totalInCoveredCities,
    coverage,
  };
}

// ============================================================================
// Spatial Index
// ============================================================================

interface IndexedCity {
  wards: Array<{
    wardGeoid: string;
    geometry: Polygon | MultiPolygon;
    bbox: [number, number, number, number]; // [minX, minY, maxX, maxY]
  }>;
}

/**
 * Build a city FIPS → ward boundaries index with precomputed bounding boxes.
 */
function buildCityIndex(
  boundaries: CityWardBoundaries[],
): Map<string, IndexedCity> {
  const index = new Map<string, IndexedCity>();

  for (const city of boundaries) {
    const wards = city.wards.map(w => ({
      wardGeoid: w.wardGeoid,
      geometry: w.geometry,
      bbox: computeBBox(w.geometry),
    }));

    index.set(city.cityFips, { wards });
  }

  return index;
}

/**
 * Compute bounding box for a geometry.
 * Returns [minLon, minLat, maxLon, maxLat].
 */
function computeBBox(
  geometry: Polygon | MultiPolygon,
): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const rings = geometry.type === 'Polygon'
    ? [geometry.coordinates[0]]
    : geometry.coordinates.map(p => p[0]);

  for (const ring of rings) {
    for (const coord of ring) {
      if (coord[0] < minX) minX = coord[0];
      if (coord[1] < minY) minY = coord[1];
      if (coord[0] > maxX) maxX = coord[0];
      if (coord[1] > maxY) maxY = coord[1];
    }
  }

  return [minX, minY, maxX, maxY];
}

/**
 * Find the ward polygon containing a point.
 *
 * Uses bounding box pre-filter before PIP to reduce computation.
 * Returns the wardGeoid of the first containing polygon, or null.
 */
function findContainingWard(
  point: [number, number],
  city: IndexedCity,
): string | null {
  const [lon, lat] = point;
  const turfPoint = turf.point([lon, lat]);

  for (const ward of city.wards) {
    // Bounding box pre-filter
    const [minX, minY, maxX, maxY] = ward.bbox;
    if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;

    // Full PIP test
    const turfGeom = ward.geometry.type === 'Polygon'
      ? turf.polygon(ward.geometry.coordinates)
      : turf.multiPolygon(ward.geometry.coordinates);

    if (turf.booleanPointInPolygon(turfPoint, turfGeom)) {
      return ward.wardGeoid;
    }
  }

  return null;
}
