/**
 * County Geometry Service
 *
 * PURPOSE: Compute union of county boundaries for multi-county cities
 * to fix false positives in geographic validation.
 *
 * ARCHITECTURE:
 * 1. Check multi-county registry for known cities
 * 2. Fetch county boundaries from Census TIGER/Line
 * 3. Compute union geometry using Turf.js
 * 4. Cache results for 24 hours (county boundaries rarely change)
 *
 * PERFORMANCE:
 * - Cold cache: ~1.5-2s (fetch + union computation)
 * - Warm cache: <10ms (in-memory lookup)
 *
 * DATA SOURCE: Census TIGER/Line County shapefiles
 * https://www2.census.gov/geo/tiger/TIGER2023/COUNTY/
 */

import type { Feature, Polygon, MultiPolygon, FeatureCollection } from 'geojson';
import { bbox as turfBbox } from '@turf/bbox';
import { union as turfUnion } from '@turf/union';
import { MULTI_COUNTY_REGISTRY, getCountiesForCity } from '../registry/multi-county-cities.js';
import { getPrimaryCountyForPlace } from '../registry/place-county-crosswalk.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * County union result with metadata
 */
export interface CountyUnionResult {
  readonly geometry: Polygon | MultiPolygon;  // Union geometry
  readonly counties: readonly string[];       // FIPS codes included
  readonly bbox: readonly [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  readonly source: 'census-tiger' | 'cache';  // Data source
}

/**
 * Cache entry with timestamp for TTL
 */
interface CacheEntry {
  readonly result: CountyUnionResult;
  readonly timestamp: number;
}

/**
 * County Geometry Service
 *
 * Handles multi-county boundary union computation with aggressive caching
 */
export class CountyGeometryService {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private countyData: FeatureCollection | null = null;

  /**
   * Get union of county boundaries for a city
   *
   * HANDLES:
   * - Multi-county cities (union all counties from registry)
   * - Single-county cities (infer from Census crosswalk)
   *
   * @param cityFips - 7-digit Census PLACE code
   * @returns Union geometry covering all counties
   */
  async getCountyUnion(cityFips: string): Promise<CountyUnionResult> {
    // Check cache first (with TTL validation)
    const cached = this.cache.get(cityFips);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return { ...cached.result, source: 'cache' };
    }

    // Determine counties for this city
    const countyFips = getCountiesForCity(cityFips);

    if (countyFips.length === 0) {
      // Single-county city: infer primary county from Census crosswalk
      const primaryCounty = await this.inferPrimaryCounty(cityFips);
      return this.computeCountyUnion([primaryCounty], cityFips);
    }

    // Multi-county city: compute union
    return this.computeCountyUnion(countyFips, cityFips);
  }

  /**
   * Compute union of county geometries
   *
   * @param countyFips - Array of 5-digit county FIPS codes
   * @param cityFips - City FIPS for cache key
   */
  private async computeCountyUnion(
    countyFips: readonly string[],
    cityFips: string
  ): Promise<CountyUnionResult> {
    // Fetch all county geometries in parallel
    const countyGeometries = await Promise.all(
      countyFips.map(fips => this.fetchCountyGeometry(fips))
    );

    // Handle single county (no union needed)
    if (countyGeometries.length === 1) {
      const singleCounty = countyGeometries[0];
      const bboxArray = turfBbox(singleCounty);
      const bboxTuple: readonly [number, number, number, number] = [
        bboxArray[0],
        bboxArray[1],
        bboxArray[2],
        bboxArray[3],
      ];

      const result: CountyUnionResult = {
        geometry: singleCounty.geometry,
        counties: countyFips,
        bbox: bboxTuple,
        source: 'census-tiger',
      };

      this.cache.set(cityFips, {
        result,
        timestamp: Date.now(),
      });

      return result;
    }

    // Compute union using Turf.js (requires FeatureCollection)
    const featureCollection = {
      type: 'FeatureCollection' as const,
      features: countyGeometries,
    };

    const unioned = turfUnion(featureCollection);
    if (!unioned) {
      throw new Error(
        `Failed to union counties: ${countyFips.join(', ')}`
      );
    }

    // Compute bounding box
    const bboxArray = turfBbox(unioned);
    const bboxTuple: readonly [number, number, number, number] = [
      bboxArray[0],
      bboxArray[1],
      bboxArray[2],
      bboxArray[3],
    ];

    const result: CountyUnionResult = {
      geometry: unioned.geometry,
      counties: countyFips,
      bbox: bboxTuple,
      source: 'census-tiger',
    };

    // Cache for 24 hours
    this.cache.set(cityFips, {
      result,
      timestamp: Date.now(),
    });

    return result;
  }

  /**
   * Load Census TIGER/Line county data
   *
   * Loads the pre-converted GeoJSON file containing all US county boundaries
   * from the TIGER/Line 2023 dataset.
   *
   * @returns FeatureCollection with all county geometries
   */
  private async loadCountyData(): Promise<FeatureCollection> {
    if (this.countyData) return this.countyData;

    const dataPath = path.join(__dirname, '../data/census-tiger-2023-counties.geojson');
    const raw = await fs.readFile(dataPath, 'utf-8');
    this.countyData = JSON.parse(raw) as FeatureCollection;
    return this.countyData;
  }

  /**
   * Fetch county boundary from Census TIGER/Line
   *
   * Loads county geometry from pre-downloaded TIGER/Line 2023 GeoJSON data.
   *
   * @param countyFips - 5-digit county FIPS code (e.g., "29095" for Jackson County, MO)
   * @returns Feature with county boundary geometry
   */
  private async fetchCountyGeometry(countyFips: string): Promise<Feature<Polygon | MultiPolygon>> {
    const data = await this.loadCountyData();

    const county = data.features.find(
      (f) => f.properties && f.properties.GEOID === countyFips
    );

    if (!county) {
      throw new Error(
        `County ${countyFips} not found in Census TIGER/Line 2023 data. ` +
        `Verify FIPS code is valid (5-digit format: SSCCC where SS=state, CCC=county).`
      );
    }

    return county as Feature<Polygon | MultiPolygon>;
  }

  /**
   * Infer primary county from city FIPS code
   *
   * Uses Census PLACE-to-county crosswalk registry for known cities.
   * For unknown places, throws error indicating missing crosswalk data.
   *
   * DATA SOURCE: Census Bureau Geographic Relationship Files
   * https://www2.census.gov/geo/docs/maps-data/data/rel2023/place_county/
   *
   * @param cityFips - 7-digit city FIPS code
   * @throws Error if city not found in crosswalk registry
   */
  private async inferPrimaryCounty(cityFips: string): Promise<string> {
    // Check crosswalk registry for known place-county mappings
    const primaryCounty = getPrimaryCountyForPlace(cityFips);

    if (primaryCounty) {
      return primaryCounty;
    }

    // Extract state FIPS (first 2 digits) for error message context
    const stateFips = cityFips.slice(0, 2);

    throw new Error(
      `Cannot infer primary county for city FIPS ${cityFips}. ` +
      `Place not found in crosswalk registry. ` +
      `Add to src/registry/place-county-crosswalk.ts or verify FIPS code is valid.`
    );
  }


  /**
   * Clear cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics (useful for monitoring)
   */
  getCacheStats(): {
    size: number;
    entries: Array<{ cityFips: string; age: number; counties: number }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([cityFips, entry]) => ({
      cityFips,
      age: now - entry.timestamp,
      counties: entry.result.counties.length,
    }));

    return {
      size: this.cache.size,
      entries,
    };
  }
}
