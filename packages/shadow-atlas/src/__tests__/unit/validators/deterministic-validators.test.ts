/**
 * Deterministic Validators Test Suite
 *
 * CRITICAL: These tests validate the validators that protect Shadow Atlas
 * from garbage municipal boundary data (90% of discoveries were wrong).
 *
 * TEST PHILOSOPHY: Test with REAL failure cases from discovery system:
 * - Alexander City: 5,235 transit stops (should REJECT)
 * - Alabaster: 14 DC land development plans (should REJECT)
 * - Legitimate city councils: 5-15 districts (should ACCEPT)
 */

import { describe, it, expect } from 'vitest';
import {
  NamePatternValidator,
  DistrictCountValidator,
  DeterministicValidationPipeline,
  type ValidationResult,
  type CityTarget,
} from '../../../validators/deterministic-validators.js';
import type { NormalizedGeoJSON } from '../types/index.js';
import type { AdministrativeLevel } from '../types/provider.js';

/**
 * Test helper: Create mock GeoJSON with specified feature count and names
 */
function createMockGeoJSON(
  featureCount: number,
  namePattern: (index: number) => string
): NormalizedGeoJSON {
  const features = Array.from({ length: featureCount }, (_, i) => ({
    type: 'Feature' as const,
    id: i,
    properties: {
      NAME: namePattern(i),
      OBJECTID: i,
    },
    geometry: {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-86.0, 33.0],
          [-86.0, 33.1],
          [-85.9, 33.1],
          [-85.9, 33.0],
          [-86.0, 33.0],
        ],
      ],
    },
  }));

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Test helper: Create mock city target
 */
function createMockCity(overrides: Partial<CityTarget> = {}): CityTarget {
  return {
    id: 'al-birmingham',
    name: 'Birmingham',
    region: 'AL',
    country: 'US',
    population: 200733,
    fips: '0107000',
    ...overrides,
  };
}

describe('NamePatternValidator', () => {
  const validator = new NamePatternValidator();

  describe('Red Flag Detection (should REJECT)', () => {
    it('should REJECT transit infrastructure data (Alexander City case)', () => {
      const geojson = createMockGeoJSON(
        5235, // Alexander City had 5,235 transit stops
        (i) => `Bus Stop ${i + 1}`
      );

      const result = validator.validate(geojson, 'council-district');

      expect(result.valid).toBe(false);
      expect(result.confidence).toBeLessThan(20);
      expect(result.issues.some(i => i.includes('transit/infrastructure'))).toBe(true);
    });

    it('should REJECT land development parcels (Alabaster case)', () => {
      const geojson = createMockGeoJSON(
        14, // Alabaster had 14 DC land development plans
        (i) => `Development Parcel ${String.fromCharCode(65 + i)}`
      );

      const result = validator.validate(geojson, 'council-district');

      expect(result.valid).toBe(false);
      expect(result.confidence).toBeLessThan(20);
      expect(result.issues.some(i => i.includes('transit/infrastructure'))).toBe(true);
    });

    it('should REJECT statewide legislative districts', () => {
      const geojson = createMockGeoJSON(
        35, // Typical state senate size
        (i) => `State Senate District ${i + 1}`
      );

      const result = validator.validate(geojson, 'council-district');

      expect(result.valid).toBe(false);
      expect(result.confidence).toBeLessThan(20);
      expect(result.issues.some(i => i.includes('state legislative'))).toBe(true);
    });

    it('should REJECT county commission data labeled as city council', () => {
      const geojson = createMockGeoJSON(
        5,
        (i) => `County Supervisor District ${i + 1}`
      );

      const result = validator.validate(geojson, 'council-district');

      expect(result.valid).toBe(false);
      expect(result.confidence).toBeLessThan(20);
      expect(result.issues.some(i => i.includes('county'))).toBe(true);
    });

    it('should REJECT land use/planning keywords', () => {
      const geojson = createMockGeoJSON(
        8,
        (i) => `Development Lot ${i + 1}` // "development" and "lot" are in transit keywords
      );

      const result = validator.validate(geojson, 'council-district');

      expect(result.valid).toBe(false);
      expect(result.confidence).toBeLessThan(20);
      // "development" and "lot" are in transit/infrastructure keywords
      expect(result.issues.some(i => i.includes('transit/infrastructure'))).toBe(true);
    });
  });

  describe('Green Flag Detection (should ACCEPT)', () => {
    it('should ACCEPT numbered council districts', () => {
      const geojson = createMockGeoJSON(
        9, // Birmingham has 9 council districts
        (i) => `Council District ${i + 1}`
      );

      const result = validator.validate(geojson, 'council-district');

      expect(result.valid).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(85);
      expect(result.issues).toHaveLength(0);
    });

    it('should ACCEPT ward-based naming', () => {
      const geojson = createMockGeoJSON(
        7,
        (i) => `Ward ${i + 1}`
      );

      const result = validator.validate(geojson, 'council-district');

      expect(result.valid).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(85);
      expect(result.issues).toHaveLength(0);
    });

    it('should ACCEPT letter-based district naming', () => {
      const geojson = createMockGeoJSON(
        5,
        (i) => `District ${String.fromCharCode(65 + i)}`
      );

      const result = validator.validate(geojson, 'council-district');

      expect(result.valid).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(85);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('Ambiguous Cases (should escalate to consensus)', () => {
    it('should flag ambiguous naming patterns with medium confidence', () => {
      const geojson = createMockGeoJSON(
        8,
        (i) => `Section ${i + 1}` // "Section" is not in green flag patterns
      );

      const result = validator.validate(geojson, 'council-district');

      expect(result.valid).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(60);
      expect(result.confidence).toBeLessThan(85);
    });

    it('should handle features with null/empty names', () => {
      const features = Array.from({ length: 5 }, (_, i) => ({
        type: 'Feature' as const,
        id: i,
        properties: {
          OBJECTID: i,
          // No NAME field
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [-86.0, 33.0],
              [-86.0, 33.1],
              [-85.9, 33.1],
              [-85.9, 33.0],
              [-86.0, 33.0],
            ],
          ],
        },
      }));

      const geojson: NormalizedGeoJSON = {
        type: 'FeatureCollection',
        features,
      };

      const result = validator.validate(geojson, 'council-district');

      // NEW BEHAVIOR: Null names accepted if feature count is reasonable (3-100)
      // We can generate synthetic names like "District 1", "District 2"
      expect(result.valid).toBe(true);
      expect(result.confidence).toBe(50); // Lower confidence but still valid
      expect(result.warnings.some(w => w.includes('null/empty'))).toBe(true);
    });
  });

  describe('Boundary Type Awareness', () => {
    it('should ALLOW county keywords for county-commission level', () => {
      const geojson = createMockGeoJSON(
        5,
        (i) => `County Commission District ${i + 1}`
      );

      const result = validator.validate(geojson, 'county-commission');

      // Should not reject based on county keywords when level is county-commission
      expect(result.valid).toBe(true);
    });

    it('should REJECT state keywords for county-commission level', () => {
      const geojson = createMockGeoJSON(
        5,
        (i) => `State Senate District ${i + 1}`
      );

      const result = validator.validate(geojson, 'county-commission');

      // State keywords should be rejected for county-commission too (municipal not in list)
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('state legislative'))).toBe(true);
    });
  });
});

describe('DistrictCountValidator', () => {
  const validator = new DistrictCountValidator();

  describe('Red Flag Detection (should REJECT)', () => {
    it('should REJECT transit infrastructure (5,235 features)', () => {
      const geojson = createMockGeoJSON(
        5235,
        (i) => `Feature ${i + 1}`
      );

      const result = validator.validate(geojson, 'council-district');

      expect(result.valid).toBe(false);
      expect(result.confidence).toBeLessThan(20);
      expect(result.issues.some(i => i.includes('outside valid range'))).toBe(true);
    });

    it('should REJECT impossibly small district counts', () => {
      const geojson = createMockGeoJSON(
        1, // Only 1 district is clearly invalid
        (i) => `District ${i + 1}`
      );

      const result = validator.validate(geojson, 'council-district');

      expect(result.valid).toBe(false);
      expect(result.confidence).toBeLessThan(20);
      expect(result.issues.some(i => i.includes('outside valid range'))).toBe(true);
    });

    it('should REJECT impossibly large council district counts', () => {
      const geojson = createMockGeoJSON(
        101, // Max is now 100 (Chicago has 50), so 101 should reject
        (i) => `District ${i + 1}`
      );

      const result = validator.validate(geojson, 'council-district');

      expect(result.valid).toBe(false);
      expect(result.confidence).toBeLessThan(20);
      expect(result.issues.some(i => i.includes('outside valid range'))).toBe(true);
    });
  });

  describe('Green Flag Detection (should ACCEPT)', () => {
    it('should ACCEPT typical city council size (9 districts)', () => {
      const geojson = createMockGeoJSON(9, (i) => `District ${i + 1}`);

      const result = validator.validate(geojson, 'council-district');

      expect(result.valid).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(90);
      expect(result.issues).toHaveLength(0);
    });

    it('should ACCEPT small city council (5 districts)', () => {
      const geojson = createMockGeoJSON(5, (i) => `District ${i + 1}`);

      const result = validator.validate(geojson, 'council-district');

      expect(result.valid).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(90);
    });

    it('should ACCEPT large city council (15 districts)', () => {
      const geojson = createMockGeoJSON(15, (i) => `District ${i + 1}`);

      const result = validator.validate(geojson, 'council-district');

      expect(result.valid).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(90);
    });
  });

  describe('Ambiguous Cases (should escalate)', () => {
    it('should flag unusual but valid counts with lower confidence', () => {
      const geojson = createMockGeoJSON(
        25, // Unusual but valid (some large cities have 20-25 districts)
        (i) => `District ${i + 1}`
      );

      const result = validator.validate(geojson, 'council-district');

      expect(result.valid).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(60);
      expect(result.confidence).toBeLessThan(90);
      expect(result.warnings.some(w => w.includes('unusual'))).toBe(true);
    });
  });

  describe('Boundary Type Awareness', () => {
    it('should use different bounds for county commissions', () => {
      const geojson = createMockGeoJSON(5, (i) => `District ${i + 1}`);

      const councilResult = validator.validate(geojson, 'council-district');
      const countyResult = validator.validate(geojson, 'county-commission');

      // 5 is typical for county (high confidence)
      expect(countyResult.confidence).toBeGreaterThanOrEqual(90);

      // 5 is typical for council too (high confidence)
      expect(councilResult.confidence).toBeGreaterThanOrEqual(90);
    });

    it('should reject large counts for county commissions', () => {
      const geojson = createMockGeoJSON(25, (i) => `District ${i + 1}`);

      const result = validator.validate(geojson, 'county-commission');

      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.includes('outside valid range'))).toBe(true);
    });

    it('should accept state legislative lower house counts', () => {
      const geojson = createMockGeoJSON(120, (i) => `District ${i + 1}`);

      const result = validator.validate(geojson, 'state-legislative-lower');

      expect(result.valid).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(90);
    });
  });
});

describe('DeterministicValidationPipeline', () => {
  const pipeline = new DeterministicValidationPipeline();
  const mockCity = createMockCity();

  describe('Real-World Failure Cases', () => {
    it('should REJECT Alexander City transit stops (5,235 features)', () => {
      const geojson = createMockGeoJSON(
        5235,
        (i) => `Bus Stop ${i + 1000}` // Realistic bus stop IDs
      );

      const result = pipeline.validate(geojson, mockCity, 'council-district');

      expect(result.valid).toBe(false);
      expect(result.confidence).toBeLessThan(20);

      // Should fail BOTH validators
      expect(result.validatorResults).toHaveLength(2);
      expect(result.validatorResults.every(r => !r.result.valid)).toBe(true);

      // Should have issues from both validators
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some(i => i.includes('transit'))).toBe(true);
      expect(result.issues.some(i => i.includes('outside valid range'))).toBe(true);
    });

    it('should REJECT Alabaster land development plans (14 features)', () => {
      const geojson = createMockGeoJSON(
        14,
        (i) => `Development Lot ${String.fromCharCode(65 + (i % 26))}-${Math.floor(i / 26) + 1}`
      );

      const result = pipeline.validate(geojson, mockCity, 'council-district');

      expect(result.valid).toBe(false);
      expect(result.confidence).toBeLessThan(20);

      // Name validator should fail (development keywords)
      const nameResult = result.validatorResults.find(
        r => r.validator === 'NamePatternValidator'
      );
      expect(nameResult?.result.valid).toBe(false);
    });

    it('should REJECT statewide legislative data', () => {
      const geojson = createMockGeoJSON(
        35,
        (i) => `State Senate District ${i + 1}`
      );

      const result = pipeline.validate(geojson, mockCity, 'council-district');

      expect(result.valid).toBe(false);
      expect(result.confidence).toBeLessThan(20);

      // Name validator should fail (state keywords)
      const nameResult = result.validatorResults.find(
        r => r.validator === 'NamePatternValidator'
      );
      expect(nameResult?.result.valid).toBe(false);
      expect(nameResult?.result.issues.some(i => i.includes('state legislative'))).toBe(true);
    });
  });

  describe('Real-World Success Cases', () => {
    it('should ACCEPT Birmingham city council districts (9 features)', () => {
      const geojson = createMockGeoJSON(
        9,
        (i) => `Council District ${i + 1}`
      );

      const result = pipeline.validate(geojson, mockCity, 'council-district');

      expect(result.valid).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(85); // Auto-accept threshold
      expect(result.issues).toHaveLength(0);

      // Both validators should pass with high confidence
      expect(result.validatorResults.every(r => r.result.valid)).toBe(true);
      expect(result.validatorResults.every(r => r.result.confidence >= 85)).toBe(true);
    });

    it('should ACCEPT typical ward-based districts', () => {
      const geojson = createMockGeoJSON(7, (i) => `Ward ${i + 1}`);

      const result = pipeline.validate(geojson, mockCity, 'council-district');

      expect(result.valid).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(85);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('Ambiguous Cases (escalate to consensus)', () => {
    it('should escalate borderline district counts (60-84 confidence)', () => {
      const geojson = createMockGeoJSON(
        25, // Unusual but not impossible
        (i) => `District ${i + 1}`
      );

      const result = pipeline.validate(geojson, mockCity, 'council-district');

      expect(result.valid).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(60);
      expect(result.confidence).toBeLessThan(85);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should escalate ambiguous naming patterns', () => {
      const geojson = createMockGeoJSON(
        8,
        (i) => `Section ${i + 1}` // Not in green flag patterns
      );

      const result = pipeline.validate(geojson, mockCity, 'council-district');

      expect(result.valid).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(60);
      expect(result.confidence).toBeLessThan(85);
    });
  });

  describe('Aggregate Confidence Scoring', () => {
    it('should use MINIMUM confidence across validators', () => {
      // Create data with high name confidence but medium count confidence
      const geojson = createMockGeoJSON(
        25, // Unusual count (60 confidence)
        (i) => `Council District ${i + 1}` // Perfect names (85+ confidence)
      );

      const result = pipeline.validate(geojson, mockCity, 'council-district');

      // Name validator should have high confidence
      const nameResult = result.validatorResults.find(
        r => r.validator === 'NamePatternValidator'
      );
      expect(nameResult?.result.confidence).toBeGreaterThanOrEqual(85);

      // Count validator should have medium confidence
      const countResult = result.validatorResults.find(
        r => r.validator === 'DistrictCountValidator'
      );
      expect(countResult?.result.confidence).toBeGreaterThanOrEqual(60);
      expect(countResult?.result.confidence).toBeLessThan(85);

      // Overall confidence should be MINIMUM (count validator's score)
      expect(result.confidence).toBe(countResult?.result.confidence);
    });

    it('should concatenate issues from all failed validators', () => {
      const geojson = createMockGeoJSON(
        5235, // Fails count validator
        (i) => `Bus Stop ${i}` // Fails name validator
      );

      const result = pipeline.validate(geojson, mockCity, 'council-district');

      expect(result.valid).toBe(false);

      // Should have issues from BOTH validators
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
      expect(result.issues.some(i => i.includes('transit'))).toBe(true);
      expect(result.issues.some(i => i.includes('outside valid range'))).toBe(true);
    });

    it('should concatenate warnings from all validators', () => {
      const geojson = createMockGeoJSON(
        25, // Warns from count validator (unusual)
        (i) => `District ${i + 1}` // No warnings from name validator
      );

      const result = pipeline.validate(geojson, mockCity, 'council-district');

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('unusual'))).toBe(true);
    });
  });

  describe('Validator Result Metadata', () => {
    it('should include individual validator results for debugging', () => {
      const geojson = createMockGeoJSON(9, (i) => `District ${i + 1}`);

      const result = pipeline.validate(geojson, mockCity, 'council-district');

      expect(result.validatorResults).toHaveLength(2);

      const nameResult = result.validatorResults.find(
        r => r.validator === 'NamePatternValidator'
      );
      const countResult = result.validatorResults.find(
        r => r.validator === 'DistrictCountValidator'
      );

      expect(nameResult).toBeDefined();
      expect(countResult).toBeDefined();

      expect(nameResult?.result).toHaveProperty('valid');
      expect(nameResult?.result).toHaveProperty('confidence');
      expect(nameResult?.result).toHaveProperty('issues');
      expect(nameResult?.result).toHaveProperty('warnings');
    });
  });
});

describe('Edge Cases and Robustness', () => {
  const pipeline = new DeterministicValidationPipeline();
  const mockCity = createMockCity();

  it('should handle empty feature collection', () => {
    const geojson: NormalizedGeoJSON = {
      type: 'FeatureCollection',
      features: [],
    };

    const result = pipeline.validate(geojson, mockCity, 'council-district');

    expect(result.valid).toBe(false);
    expect(result.confidence).toBeLessThan(20);
  });

  it('should handle features with varied property naming', () => {
    const features = [
      {
        type: 'Feature' as const,
        properties: { NAME: 'District 1' }, // Uppercase NAME
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[[-86, 33], [-86, 33.1], [-85.9, 33.1], [-85.9, 33], [-86, 33]]],
        },
      },
      {
        type: 'Feature' as const,
        properties: { name: 'District 2' }, // Lowercase name
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[[-86, 33], [-86, 33.1], [-85.9, 33.1], [-85.9, 33], [-86, 33]]],
        },
      },
      {
        type: 'Feature' as const,
        properties: { DISTRICT: 'District 3' }, // DISTRICT field
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[[-86, 33], [-86, 33.1], [-85.9, 33.1], [-85.9, 33], [-86, 33]]],
        },
      },
    ];

    const geojson: NormalizedGeoJSON = {
      type: 'FeatureCollection',
      features,
    };

    const result = pipeline.validate(geojson, mockCity, 'council-district');

    // Should handle varied naming and extract names properly
    // 3 districts passes (min is 3), names all match green flag patterns
    expect(result.valid).toBe(true);
  });

  it('should handle numeric district names', () => {
    const features = Array.from({ length: 9 }, (_, i) => ({
      type: 'Feature' as const,
      properties: { DISTRICT: i + 1 }, // Numeric value
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[-86, 33], [-86, 33.1], [-85.9, 33.1], [-85.9, 33], [-86, 33]]],
      },
    }));

    const geojson: NormalizedGeoJSON = {
      type: 'FeatureCollection',
      features,
    };

    const result = pipeline.validate(geojson, mockCity, 'council-district');

    // Should convert numbers to strings and validate
    expect(result.valid).toBe(true);
  });

  it('should handle mixed case keywords in names', () => {
    const geojson = createMockGeoJSON(
      9,
      (i) => `STATE SENATE DISTRICT ${i + 1}` // Uppercase keywords
    );

    const result = pipeline.validate(geojson, mockCity, 'council-district');

    // Should detect keywords regardless of case
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.includes('state legislative'))).toBe(true);
  });
});
