/**
 * Geographic Bounds Validator for Shadow Atlas
 *
 * PURPOSE: Cross-validate portal-discovered council districts against authoritative
 * Census PLACE boundaries to catch wrong-state and wrong-city data.
 *
 * PROBLEM THIS SOLVES:
 * - Portal discovery returned Carolina, NC data for Carolina, AL (-78.87° vs -87°)
 * - Statewide portals returned Alabama state boundaries for individual cities
 * - No coordinate validation allowed wrong-geographic-area data to pollute database
 *
 * VALIDATION STRATEGY:
 * 1. Load city PLACE boundary from TIGER (Layer 2, 100% coverage)
 * 2. Check if council districts fit within/overlap city boundary
 * 3. Validate coordinates are in expected state bounding box
 * 4. Reject if districts extend significantly beyond city limits
 *
 * CONFIDENCE SCORING:
 * - 100% within city bounds: confidence +20
 * - Partial overlap: confidence +10, warn about spillover
 * - Outside city bounds: REJECT (confidence 0)
 * - Wrong state coordinates: REJECT (confidence 0)
 */

import type { FeatureCollection, Feature, Polygon, MultiPolygon, Position } from 'geojson';
import type { ValidationResult } from './deterministic-validators.js';
import type { CityTarget as BaseCityTarget } from './deterministic-validators.js';
import { TIGERPlaceProvider } from '../providers/tiger-place.js';
import type { NormalizedBoundary } from '../types/provider.js';

/**
 * Extended city target with geographic metadata
 */
export interface CityTarget extends BaseCityTarget {
  readonly fips: string;  // Required for PLACE lookup
}

/**
 * FIPS code to state abbreviation lookup
 */
const FIPS_TO_STATE: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY', '60': 'AS', '66': 'GU', '69': 'MP', '72': 'PR',
  '78': 'VI',
};

/**
 * State bounding boxes (approximate, for quick coordinate validation)
 * Format: [minLon, minLat, maxLon, maxLat]
 */
const STATE_BOUNDS: Record<string, readonly [number, number, number, number]> = {
  AL: [-88.5, 30.2, -84.9, 35.0],
  AK: [-180, 51, -129, 71.5],
  AZ: [-114.8, 31.3, -109.0, 37.0],
  AR: [-94.6, 33.0, -89.6, 36.5],
  CA: [-124.5, 32.5, -114.1, 42.0],
  CO: [-109.1, 37.0, -102.0, 41.0],
  CT: [-73.7, 40.9, -71.8, 42.1],
  DE: [-75.8, 38.4, -75.0, 39.8],
  FL: [-87.6, 24.5, -80.0, 31.0],
  GA: [-85.6, 30.4, -80.8, 35.0],
  HI: [-160, 18.9, -154.8, 22.2],
  ID: [-117.2, 42.0, -111.0, 49.0],
  IL: [-91.5, 37.0, -87.5, 42.5],
  IN: [-88.1, 37.8, -84.8, 41.8],
  IA: [-96.6, 40.4, -90.1, 43.5],
  KS: [-102.1, 37.0, -94.6, 40.0],
  KY: [-89.6, 36.5, -81.9, 39.1],
  LA: [-94.0, 29.0, -88.8, 33.0],
  ME: [-71.1, 43.0, -66.9, 47.5],
  MD: [-79.5, 37.9, -75.0, 39.7],
  MA: [-73.5, 41.2, -69.9, 42.9],
  MI: [-90.4, 41.7, -82.4, 48.3],
  MN: [-97.2, 43.5, -89.5, 49.4],
  MS: [-91.7, 30.2, -88.1, 35.0],
  MO: [-95.8, 36.0, -89.1, 40.6],
  MT: [-116.1, 44.4, -104.0, 49.0],
  NE: [-104.1, 40.0, -95.3, 43.0],
  NV: [-120.0, 35.0, -114.0, 42.0],
  NH: [-72.6, 42.7, -70.6, 45.3],
  NJ: [-75.6, 38.9, -73.9, 41.4],
  NM: [-109.1, 31.3, -103.0, 37.0],
  NY: [-79.8, 40.5, -71.9, 45.0],
  NC: [-84.3, 33.8, -75.5, 36.6],
  ND: [-104.1, 45.9, -96.6, 49.0],
  OH: [-84.8, 38.4, -80.5, 42.3],
  OK: [-103.0, 33.6, -94.4, 37.0],
  OR: [-124.6, 42.0, -116.5, 46.3],
  PA: [-80.5, 39.7, -74.7, 42.3],
  RI: [-71.9, 41.1, -71.1, 42.0],
  SC: [-83.4, 32.0, -78.5, 35.2],
  SD: [-104.1, 42.5, -96.4, 45.9],
  TN: [-90.3, 35.0, -81.6, 36.7],
  TX: [-106.7, 25.8, -93.5, 36.5],
  UT: [-114.1, 37.0, -109.0, 42.0],
  VT: [-73.4, 42.7, -71.5, 45.0],
  VA: [-83.7, 36.5, -75.2, 39.5],
  WA: [-124.8, 45.5, -116.9, 49.0],
  WV: [-82.6, 37.2, -77.7, 40.6],
  WI: [-92.9, 42.5, -86.2, 47.1],
  WY: [-111.1, 41.0, -104.0, 45.0],
  DC: [-77.1, 38.8, -76.9, 39.0],
};

/**
 * Geographic Bounds Validator
 *
 * Cross-validates council districts against Census PLACE boundaries
 */
export class GeographicBoundsValidator {
  private placeProvider: TIGERPlaceProvider;
  private placeBoundaryCache: Map<string, NormalizedBoundary>;

  constructor() {
    this.placeProvider = new TIGERPlaceProvider();
    this.placeBoundaryCache = new Map();
  }

  /**
   * Validate that council districts fit within city PLACE boundary
   */
  async validate(
    councilDistricts: FeatureCollection,
    city: CityTarget
  ): Promise<ValidationResult> {
    const issues: string[] = [];
    const warnings: string[] = [];
    let confidence = 100;

    // Step 1: Quick coordinate validation (reject obvious wrong-state data)
    const coordResult = this.validateCoordinates(councilDistricts, city.region);
    if (!coordResult.valid) {
      return coordResult;
    }

    confidence = Math.min(confidence, coordResult.confidence);
    warnings.push(...coordResult.warnings);

    // Step 2: Load city PLACE boundary from Layer 2
    try {
      const placeBoundary = await this.getPlaceBoundary(city.fips);

      // Step 3: Check if council districts fit within city bounds
      const boundsResult = this.validateDistrictBounds(
        councilDistricts,
        placeBoundary,
        city
      );

      confidence = Math.min(confidence, boundsResult.confidence);
      issues.push(...boundsResult.issues);
      warnings.push(...boundsResult.warnings);

      if (!boundsResult.valid) {
        return {
          valid: false,
          confidence: boundsResult.confidence,
          issues,
          warnings,
        };
      }

    } catch (error) {
      // If we can't load PLACE boundary, fall back to coordinate validation only
      warnings.push(
        `Could not load PLACE boundary for validation: ${(error as Error).message}`
      );
      confidence -= 10;
    }

    return {
      valid: issues.length === 0,
      confidence,
      issues,
      warnings,
    };
  }

  /**
   * Quick coordinate validation: ensure all coords within expected state
   */
  private validateCoordinates(
    geojson: FeatureCollection,
    state: string
  ): ValidationResult {
    const stateBounds = STATE_BOUNDS[state.toUpperCase()];

    if (!stateBounds) {
      return {
        valid: true,
        confidence: 70,
        issues: [],
        warnings: [`Unknown state code: ${state} (cannot validate coordinates)`],
      };
    }

    const [minLon, minLat, maxLon, maxLat] = stateBounds;
    let outOfBoundsCount = 0;
    const sampleOutOfBounds: Position[] = [];

    for (const feature of geojson.features) {
      const coords = this.extractCoordinates(feature);

      for (const [lon, lat] of coords) {
        if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) {
          outOfBoundsCount++;
          if (sampleOutOfBounds.length < 3) {
            sampleOutOfBounds.push([lon, lat]);
          }
        }
      }
    }

    if (outOfBoundsCount > 0) {
      const totalCoords = geojson.features.reduce(
        (sum, f) => sum + this.extractCoordinates(f).length,
        0
      );
      const outOfBoundsRatio = outOfBoundsCount / totalCoords;

      if (outOfBoundsRatio > 0.5) {
        // Majority of coordinates outside state bounds = WRONG STATE DATA
        return {
          valid: false,
          confidence: 0,
          issues: [
            `Coordinates outside ${state} bounds: ${sampleOutOfBounds.map(c => `[${c[0].toFixed(2)}, ${c[1].toFixed(2)}]`).join(', ')}`,
            `Expected: lon ${minLon.toFixed(1)} to ${maxLon.toFixed(1)}, lat ${minLat.toFixed(1)} to ${maxLat.toFixed(1)}`,
          ],
          warnings: [],
        };
      } else {
        // Some coordinates outside bounds = border spillover (acceptable with warning)
        return {
          valid: true,
          confidence: 80,
          issues: [],
          warnings: [
            `${outOfBoundsCount} coordinates slightly outside ${state} bounds (likely border spillover)`,
          ],
        };
      }
    }

    // All coordinates within state bounds
    return {
      valid: true,
      confidence: 100,
      issues: [],
      warnings: [],
    };
  }

  /**
   * Validate that council districts fit within city PLACE boundary
   */
  private validateDistrictBounds(
    councilDistricts: FeatureCollection,
    placeBoundary: NormalizedBoundary,
    city: CityTarget
  ): ValidationResult {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Count how many districts are within/overlap/outside city bounds
    let withinCount = 0;
    let overlapCount = 0;
    let outsideCount = 0;

    for (const district of councilDistricts.features) {
      const relationship = this.getGeometricRelationship(
        district,
        placeBoundary.geometry
      );

      if (relationship === 'within' || relationship === 'contains') {
        withinCount++;
      } else if (relationship === 'overlaps') {
        overlapCount++;
      } else {
        outsideCount++;
      }
    }

    const totalDistricts = councilDistricts.features.length;

    // All districts within city bounds = high confidence
    if (withinCount === totalDistricts) {
      return {
        valid: true,
        confidence: 100,
        issues: [],
        warnings: [],
      };
    }

    // Most districts within/overlapping = medium confidence with warning
    if ((withinCount + overlapCount) >= totalDistricts * 0.8) {
      return {
        valid: true,
        confidence: 80,
        issues: [],
        warnings: [
          `${outsideCount} of ${totalDistricts} districts extend beyond ${city.name} PLACE boundary (likely annexation/border updates)`,
        ],
      };
    }

    // Majority of districts outside city bounds = WRONG CITY DATA
    return {
      valid: false,
      confidence: 10,
      issues: [
        `${outsideCount} of ${totalDistricts} districts outside ${city.name} PLACE boundary (likely wrong-city or statewide data)`,
      ],
      warnings: [],
    };
  }

  /**
   * Get city PLACE boundary (with caching)
   */
  private async getPlaceBoundary(fips: string): Promise<NormalizedBoundary> {
    // Check cache first
    const cached = this.placeBoundaryCache.get(fips);
    if (cached) {
      return cached;
    }

    // Extract state FIPS (first 2 digits) and convert to state abbreviation
    const stateFips = fips.substring(0, 2);
    const stateAbbr = FIPS_TO_STATE[stateFips];

    if (!stateAbbr) {
      throw new Error(`Unknown state FIPS code: ${stateFips} (from city FIPS ${fips})`);
    }

    // Discover city PLACE boundary
    const cityTarget = {
      name: 'Unknown',  // Not needed for FIPS-based lookup
      state: stateAbbr,  // Use state abbreviation, not numeric FIPS
      fips: fips,
    };

    const rawFiles = await this.placeProvider.discoverCities([cityTarget]);

    if (rawFiles.length === 0) {
      throw new Error(`No PLACE boundary found for FIPS ${fips}`);
    }

    // Transform to normalized boundary
    const normalized = await this.placeProvider.transform(rawFiles);

    if (normalized.length === 0) {
      throw new Error(`Failed to transform PLACE boundary for FIPS ${fips}`);
    }

    // Cache for future lookups
    this.placeBoundaryCache.set(fips, normalized[0]);

    return normalized[0];
  }

  /**
   * Extract all coordinates from feature (handles Polygon and MultiPolygon)
   */
  private extractCoordinates(feature: Feature): Position[] {
    const coords: Position[] = [];

    if (feature.geometry.type === 'Polygon') {
      const polygon = feature.geometry as Polygon;
      for (const ring of polygon.coordinates) {
        coords.push(...ring);
      }
    } else if (feature.geometry.type === 'MultiPolygon') {
      const multiPolygon = feature.geometry as MultiPolygon;
      for (const polygon of multiPolygon.coordinates) {
        for (const ring of polygon) {
          coords.push(...ring);
        }
      }
    }

    return coords;
  }

  /**
   * Determine geometric relationship between district and city boundary
   * (Simplified bounding box check - full topological check would require turf.js)
   */
  private getGeometricRelationship(
    district: Feature,
    cityBoundary: Polygon | MultiPolygon
  ): 'within' | 'overlaps' | 'outside' | 'contains' {
    // Get bounding boxes
    const districtBBox = this.getBoundingBox(district);
    const cityBBox = this.getBoundingBox({ type: 'Feature', properties: {}, geometry: cityBoundary });

    // Check if district bbox is completely within city bbox
    if (
      districtBBox.minLon >= cityBBox.minLon &&
      districtBBox.maxLon <= cityBBox.maxLon &&
      districtBBox.minLat >= cityBBox.minLat &&
      districtBBox.maxLat <= cityBBox.maxLat
    ) {
      return 'within';
    }

    // Check if district bbox completely outside city bbox
    if (
      districtBBox.maxLon < cityBBox.minLon ||
      districtBBox.minLon > cityBBox.maxLon ||
      districtBBox.maxLat < cityBBox.minLat ||
      districtBBox.minLat > cityBBox.maxLat
    ) {
      return 'outside';
    }

    // Otherwise, assume overlap
    return 'overlaps';
  }

  /**
   * Calculate bounding box for feature
   */
  private getBoundingBox(feature: Feature): {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  } {
    const coords = this.extractCoordinates(feature);

    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    for (const [lon, lat] of coords) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }

    return { minLon, minLat, maxLon, maxLat };
  }
}
