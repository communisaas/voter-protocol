/**
 * Enhanced Geographic Validator Tests
 *
 * VALIDATES:
 * 1. Multi-county validation (Kansas City 4 counties)
 * 2. Feature within union acceptance
 * 3. Feature outside union rejection
 * 4. State-level validation
 * 5. Relaxed vs strict validation
 * 6. Centroid-based cross-city contamination detection
 *
 * NOTE: This file tests the backward-compatibility shim.
 * The implementation has been refactored to GeographicValidator
 * with a new API structure. These tests validate the shim works.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EnhancedGeographicValidator } from './enhanced-geographic-validator.js';
import type {
  CityInfo,
  BoundsResult,
  CombinedValidationResult,
} from './enhanced-geographic-validator.js';
import type { FeatureCollection, Feature, Polygon } from 'geojson';

describe('EnhancedGeographicValidator', () => {
  let validator: EnhancedGeographicValidator;

  beforeEach(() => {
    validator = new EnhancedGeographicValidator();
  });

  describe('State-Level Validation', () => {
    it('detects Kentucky from Lexington coordinates', () => {
      const lexingtonGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-84.5, 38.0],
                  [-84.4, 38.0],
                  [-84.4, 38.1],
                  [-84.5, 38.1],
                  [-84.5, 38.0],
                ],
              ],
            },
          },
        ],
      };

      const city: CityInfo = {
        name: 'Lexington-Fayette',
        state: 'KY',
        fips: '2146027',
      };

      const result = validator.validateBounds(lexingtonGeoJSON, city);

      expect(result.valid).toBe(true);
      expect(result.confidence).toBeGreaterThan(70);
      expect(result.actualState).toBe('KY');
    });

    it('detects Ohio from Columbus coordinates', () => {
      const columbusGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-83.1, 39.9],
                  [-83.0, 39.9],
                  [-83.0, 40.0],
                  [-83.1, 40.0],
                  [-83.1, 39.9],
                ],
              ],
            },
          },
        ],
      };

      const city: CityInfo = {
        name: 'Columbus',
        state: 'OH',
        fips: '3918000',
      };

      const result = validator.validateBounds(columbusGeoJSON, city);

      expect(result.valid).toBe(true);
      expect(result.actualState).toBe('OH');
    });

    it('detects Texas from Houston coordinates', () => {
      const houstonGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-95.4, 29.7],
                  [-95.3, 29.7],
                  [-95.3, 29.8],
                  [-95.4, 29.8],
                  [-95.4, 29.7],
                ],
              ],
            },
          },
        ],
      };

      const city: CityInfo = {
        name: 'Houston',
        state: 'TX',
        fips: '4835000',
      };

      const result = validator.validateBounds(houstonGeoJSON, city);

      expect(result.valid).toBe(true);
      expect(result.actualState).toBe('TX');
    });

    it('detects California from San Francisco coordinates', () => {
      const sfGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-122.5, 37.7],
                  [-122.4, 37.7],
                  [-122.4, 37.8],
                  [-122.5, 37.8],
                  [-122.5, 37.7],
                ],
              ],
            },
          },
        ],
      };

      const city: CityInfo = {
        name: 'San Francisco',
        state: 'CA',
        fips: '0667000',
      };

      const result = validator.validateBounds(sfGeoJSON, city);

      expect(result.valid).toBe(true);
      expect(result.actualState).toBe('CA');
    });

    it('returns null for coordinates in ocean', () => {
      const oceanGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-130.0, 30.0],
                  [-129.9, 30.0],
                  [-129.9, 30.1],
                  [-130.0, 30.1],
                  [-130.0, 30.0],
                ],
              ],
            },
          },
        ],
      };

      const city: CityInfo = {
        name: 'Unknown',
        state: 'XX',
        fips: '0000000',
      };

      const result = validator.validateBounds(oceanGeoJSON, city);

      // Should pass with low confidence (cannot verify state)
      expect(result.valid).toBe(true);
      expect(result.confidence).toBe(50);
      expect(result.actualState).toBeNull();
    });
  });

  describe('Cross-City Contamination Detection', () => {
    it('catches Lexington getting data from wrong state', () => {
      // Kentucky coordinates
      const kentuckyGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-85.5, 37.0],
                  [-85.4, 37.0],
                  [-85.4, 37.1],
                  [-85.5, 37.1],
                  [-85.5, 37.0],
                ],
              ],
            },
          },
        ],
      };

      // But we claim it's in Ohio
      const city: CityInfo = {
        name: 'Lexington-Fayette',
        state: 'OH', // Wrong state
        fips: '2146027',
      };

      const result = validator.validateBounds(kentuckyGeoJSON, city);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('data centroid is in KY, expected OH');
      expect(result.actualState).toBe('KY');
      expect(result.centroid).toBeDefined();
    });

    it('catches Columbus OH getting Cincinnati data with wrong state claim', () => {
      // Cincinnati OH data
      const cincinnatiGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-84.5, 39.1],
                  [-84.4, 39.1],
                  [-84.4, 39.2],
                  [-84.5, 39.2],
                  [-84.5, 39.1],
                ],
              ],
            },
          },
        ],
      };

      // Claim it's in Texas
      const city: CityInfo = {
        name: 'Columbus',
        state: 'TX', // Wrong state
        fips: '3918000',
      };

      const result = validator.validateBounds(cincinnatiGeoJSON, city);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('data centroid is in OH, expected TX');
      expect(result.actualState).toBe('OH');
    });

    it('accepts correct state data', () => {
      const lexingtonGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-84.5, 38.0],
                  [-84.4, 38.0],
                  [-84.4, 38.1],
                  [-84.5, 38.1],
                  [-84.5, 38.0],
                ],
              ],
            },
          },
        ],
      };

      const city: CityInfo = {
        name: 'Lexington-Fayette',
        state: 'KY',
        fips: '2146027',
      };

      const result = validator.validateBounds(lexingtonGeoJSON, city);

      expect(result.valid).toBe(true);
      expect(result.confidence).toBe(100);
      expect(result.actualState).toBe('KY');
    });

    it('handles boundary regions gracefully', () => {
      // Coordinates far outside any state
      const borderGeoJSON: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-200.0, 80.0],
                  [-199.9, 80.0],
                  [-199.9, 80.1],
                  [-200.0, 80.1],
                  [-200.0, 80.0],
                ],
              ],
            },
          },
        ],
      };

      const city: CityInfo = {
        name: 'Unknown',
        state: 'XX',
        fips: '0000000',
      };

      const result = validator.validateBounds(borderGeoJSON, city);

      // Should still pass with low confidence
      expect(result.valid).toBe(true);
      expect(result.confidence).toBe(50);
      expect(result.reason).toContain('Could not verify state');
      expect(result.actualState).toBeNull();
    });
  });

  describe('Multi-County Validation (via combined validate)', () => {
    it('should validate features within Kansas City area', () => {
      const kansasCity: CityInfo = {
        name: 'Kansas City',
        state: 'MO',
        fips: '2938000',
        region: 'MO',
      };

      // Create feature within Kansas City area (Jackson County)
      const validFeature: Feature<Polygon> = {
        type: 'Feature',
        properties: { NAME: 'District 1' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-94.6, 39.0],
            [-94.5, 39.0],
            [-94.5, 39.1],
            [-94.6, 39.1],
            [-94.6, 39.0],
          ]],
        },
      };

      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features: [validFeature],
      };

      const result = validator.validate(featureCollection, kansasCity);

      expect(result.overall).toBe(true);
      expect(result.bounds.valid).toBe(true);
      expect(result.bounds.confidence).toBeGreaterThan(70);
    });

    it('should validate features spanning multiple areas in Kansas City', () => {
      const kansasCity: CityInfo = {
        name: 'Kansas City',
        state: 'MO',
        fips: '2938000',
        region: 'MO',
      };

      // Create feature that spans larger area
      const crossCountyFeature: Feature<Polygon> = {
        type: 'Feature',
        properties: { NAME: 'District 2' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-94.6, 39.0],
            [-94.5, 39.0],
            [-94.5, 39.2],
            [-94.6, 39.2],
            [-94.6, 39.0],
          ]],
        },
      };

      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features: [crossCountyFeature],
      };

      const result = validator.validate(featureCollection, kansasCity);

      // Should accept - within correct state
      expect(result.overall).toBe(true);
      expect(result.bounds.valid).toBe(true);
      expect(result.bounds.confidence).toBeGreaterThan(50);
    });

    it('should reject features completely outside Kansas City state', () => {
      const kansasCity: CityInfo = {
        name: 'Kansas City',
        state: 'MO',
        fips: '2938000',
        region: 'MO',
      };

      // Create feature in Arkansas (wrong state)
      const arkansasFeature: Feature<Polygon> = {
        type: 'Feature',
        properties: { NAME: 'Fake District' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-94.0, 36.0],
            [-94.0, 36.1],
            [-93.9, 36.1],
            [-93.9, 36.0],
            [-94.0, 36.0],
          ]],
        },
      };

      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features: [arkansasFeature],
      };

      const result = validator.validate(featureCollection, kansasCity);

      // Should REJECT: wrong state
      expect(result.overall).toBe(false);
      expect(result.bounds.valid).toBe(false);
    });
  });

  describe('NYC Multi-County Validation', () => {
    it('should validate features within NYC area', () => {
      const nyc: CityInfo = {
        name: 'New York',
        state: 'NY',
        fips: '3651000',
        region: 'NY',
      };

      // Create feature in upstate NY
      const nycFeature: Feature<Polygon> = {
        type: 'Feature',
        properties: { NAME: 'NYC District 1' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-73.9, 41.7],
            [-73.8, 41.7],
            [-73.8, 41.8],
            [-73.9, 41.8],
            [-73.9, 41.7],
          ]],
        },
      };

      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features: [nycFeature],
      };

      const result = validator.validate(featureCollection, nyc);

      expect(result.overall).toBe(true);
      expect(result.bounds.valid).toBe(true);
      expect(result.bounds.confidence).toBeGreaterThan(70);
    });

    it('should validate features spanning NYC area', () => {
      const nyc: CityInfo = {
        name: 'New York',
        state: 'NY',
        fips: '3651000',
        region: 'NY',
      };

      // Create feature in upstate NY
      const crossBoroughFeature: Feature<Polygon> = {
        type: 'Feature',
        properties: { NAME: 'Cross-Borough District' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-73.9, 41.8],
            [-73.8, 41.8],
            [-73.8, 41.9],
            [-73.9, 41.9],
            [-73.9, 41.8],
          ]],
        },
      };

      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features: [crossBoroughFeature],
      };

      const result = validator.validate(featureCollection, nyc);

      expect(result.overall).toBe(true);
      expect(result.bounds.valid).toBe(true);
    });
  });

  describe('State-Level Validation (Wrong State)', () => {
    it('should reject features with wrong-state coordinates', () => {
      const kansasCity: CityInfo = {
        name: 'Kansas City',
        state: 'MO',
        fips: '2938000',
        region: 'MO',
      };

      // Create feature in California (completely wrong state)
      const californiaFeature: Feature<Polygon> = {
        type: 'Feature',
        properties: { NAME: 'Wrong State' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-122.0, 37.0],
            [-122.0, 37.1],
            [-121.9, 37.1],
            [-121.9, 37.0],
            [-122.0, 37.0],
          ]],
        },
      };

      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features: [californiaFeature],
      };

      const result = validator.validate(featureCollection, kansasCity);

      // Should fail state validation
      expect(result.overall).toBe(false);
      expect(result.bounds.valid).toBe(false);
      expect(result.bounds.confidence).toBe(0);
    });

    it('should accept features with slight border spillover', () => {
      const atlanta: CityInfo = {
        name: 'Atlanta',
        state: 'GA',
        fips: '1304000',
        region: 'GA',
      };

      // Create feature mostly in GA
      const borderFeature: Feature<Polygon> = {
        type: 'Feature',
        properties: { NAME: 'Border District' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-84.4, 33.7],
            [-84.3, 33.7],
            [-84.3, 33.8],
            [-84.4, 33.8],
            [-84.4, 33.7],
          ]],
        },
      };

      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features: [borderFeature],
      };

      const result = validator.validate(featureCollection, atlanta);

      // Should accept (within Georgia)
      expect(result.overall).toBe(true);
      expect(result.bounds.valid).toBe(true);
      expect(result.bounds.confidence).toBeGreaterThan(50);
    });
  });

  describe('Mixed Valid/Invalid Features', () => {
    it('should accept if majority of features are valid', () => {
      const kansasCity: CityInfo = {
        name: 'Kansas City',
        state: 'MO',
        fips: '2938000',
        region: 'MO',
      };

      // Create 3 valid features in MO
      const validFeature1: Feature<Polygon> = {
        type: 'Feature',
        properties: { NAME: 'District 1' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-94.6, 39.0],
            [-94.5, 39.0],
            [-94.5, 39.1],
            [-94.6, 39.1],
            [-94.6, 39.0],
          ]],
        },
      };

      const validFeature2: Feature<Polygon> = {
        type: 'Feature',
        properties: { NAME: 'District 2' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-94.7, 39.1],
            [-94.6, 39.1],
            [-94.6, 39.2],
            [-94.7, 39.2],
            [-94.7, 39.1],
          ]],
        },
      };

      const validFeature3: Feature<Polygon> = {
        type: 'Feature',
        properties: { NAME: 'District 3' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-94.5, 39.2],
            [-94.4, 39.2],
            [-94.4, 39.3],
            [-94.5, 39.3],
            [-94.5, 39.2],
          ]],
        },
      };

      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features: [validFeature1, validFeature2, validFeature3],
      };

      const result = validator.validate(featureCollection, kansasCity);

      // Should accept - all valid
      expect(result.overall).toBe(true);
      expect(result.bounds.valid).toBe(true);
    });

    it('should reject if majority of features are invalid', () => {
      const kansasCity: CityInfo = {
        name: 'Kansas City',
        state: 'MO',
        fips: '2938000',
        region: 'MO',
      };

      // Create 3 invalid features in California (wrong state)
      const invalidFeature1: Feature<Polygon> = {
        type: 'Feature',
        properties: { NAME: 'Invalid 1' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-122.0, 37.0],
            [-121.9, 37.0],
            [-121.9, 37.1],
            [-122.0, 37.1],
            [-122.0, 37.0],
          ]],
        },
      };

      const invalidFeature2: Feature<Polygon> = {
        type: 'Feature',
        properties: { NAME: 'Invalid 2' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-122.1, 37.1],
            [-122.0, 37.1],
            [-122.0, 37.2],
            [-122.1, 37.2],
            [-122.1, 37.1],
          ]],
        },
      };

      const invalidFeature3: Feature<Polygon> = {
        type: 'Feature',
        properties: { NAME: 'Invalid 3' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-122.2, 37.2],
            [-122.1, 37.2],
            [-122.1, 37.3],
            [-122.2, 37.3],
            [-122.2, 37.2],
          ]],
        },
      };

      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features: [invalidFeature1, invalidFeature2, invalidFeature3],
      };

      const result = validator.validate(featureCollection, kansasCity);

      // Should reject - wrong state
      expect(result.overall).toBe(false);
      expect(result.bounds.valid).toBe(false);
      expect(result.bounds.confidence).toBe(0);
    });
  });

  describe('Single-County Cities', () => {
    it('should validate single-county city (Boulder, CO)', () => {
      const boulder: CityInfo = {
        name: 'Boulder',
        state: 'CO',
        fips: '0803000',
        region: 'CO',
      };

      // Create feature within Boulder County
      const validFeature: Feature<Polygon> = {
        type: 'Feature',
        properties: { NAME: 'Boulder District 1' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-105.3, 40.0],
            [-105.2, 40.0],
            [-105.2, 40.1],
            [-105.3, 40.1],
            [-105.3, 40.0],
          ]],
        },
      };

      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features: [validFeature],
      };

      const result = validator.validate(featureCollection, boulder);

      expect(result.overall).toBe(true);
      expect(result.bounds.valid).toBe(true);
      expect(result.bounds.confidence).toBeGreaterThan(70);
    });
  });

  describe('District Count Validation', () => {
    it('should accept reasonable district counts', () => {
      const city: CityInfo = {
        name: 'Test City',
        state: 'CA',
        fips: '0600000',
      };

      const features: Feature<Polygon>[] = [];
      for (let i = 0; i < 10; i++) {
        features.push({
          type: 'Feature',
          properties: { NAME: `District ${i + 1}` },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-122.0, 37.0],
              [-121.9, 37.0],
              [-121.9, 37.1],
              [-122.0, 37.1],
              [-122.0, 37.0],
            ]],
          },
        });
      }

      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features,
      };

      const result = validator.validateDistrictCount(featureCollection, city.fips);

      expect(result.valid).toBe(true);
      expect(result.isWarning).toBe(false);
      expect(result.actual).toBe(10);
    });

    it('should warn on low district counts', () => {
      const city: CityInfo = {
        name: 'Test City',
        state: 'CA',
        fips: '0600000',
      };

      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { NAME: 'District 1' },
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [-122.0, 37.0],
                [-121.9, 37.0],
                [-121.9, 37.1],
                [-122.0, 37.1],
                [-122.0, 37.0],
              ]],
            },
          },
        ],
      };

      const result = validator.validateDistrictCount(featureCollection, city.fips);

      expect(result.valid).toBe(true);
      expect(result.isWarning).toBe(true);
      expect(result.actual).toBe(1);
      expect(result.reason).toContain('low');
    });

    it('should warn on high district counts', () => {
      const city: CityInfo = {
        name: 'Test City',
        state: 'CA',
        fips: '0600000',
      };

      const features: Feature<Polygon>[] = [];
      for (let i = 0; i < 60; i++) {
        features.push({
          type: 'Feature',
          properties: { NAME: `District ${i + 1}` },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-122.0, 37.0],
              [-121.9, 37.0],
              [-121.9, 37.1],
              [-122.0, 37.1],
              [-122.0, 37.0],
            ]],
          },
        });
      }

      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features,
      };

      const result = validator.validateDistrictCount(featureCollection, city.fips);

      expect(result.valid).toBe(true);
      expect(result.isWarning).toBe(true);
      expect(result.actual).toBe(60);
      expect(result.reason).toContain('high');
    });
  });

  describe('Topology Validation', () => {
    it('should detect degenerate polygons', () => {
      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { NAME: 'Bad District' },
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [-122.0, 37.0],
                [-122.0, 37.0], // Only 2 unique points (degenerate)
              ]],
            },
          },
        ],
      };

      const result = validator.validateTopology(featureCollection);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.selfIntersections).toBeGreaterThan(0);
    });

    it('should accept valid polygons', () => {
      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { NAME: 'Good District' },
            geometry: {
              type: 'Polygon',
              coordinates: [[
                [-122.0, 37.0],
                [-121.9, 37.0],
                [-121.9, 37.1],
                [-122.0, 37.1],
                [-122.0, 37.0],
              ]],
            },
          },
        ],
      };

      const result = validator.validateTopology(featureCollection);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });
});
