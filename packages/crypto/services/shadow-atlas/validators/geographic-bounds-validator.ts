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

// Consolidated geo constants imported from single source of truth
import { STATE_BOUNDS, STATE_FIPS_TO_ABBR } from '../core/geo-constants.js';
// extractCoordinates imported from centralized geo-utils (eliminated duplicate)
import { extractCoordinatesFromFeature } from '../core/geo-utils.js';

// Alias for backward compatibility with local usage
const FIPS_TO_STATE = STATE_FIPS_TO_ABBR;

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
    const coordResult = this.validateCoordinates(councilDistricts, city.region || 'unknown');
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
      const coords = extractCoordinatesFromFeature(feature);

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
        (sum, f) => sum + extractCoordinatesFromFeature(f).length,
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
        placeBoundary.geometry as Polygon | MultiPolygon
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

  // extractCoordinates moved to core/geo-utils.ts - use extractCoordinatesFromFeature()

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
    const coords = extractCoordinatesFromFeature(feature);

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
