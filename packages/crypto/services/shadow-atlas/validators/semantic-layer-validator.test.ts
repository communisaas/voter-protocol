/**
 * Semantic Layer Validator Tests
 *
 * Validates semantic filtering of GIS layers to identify council districts.
 *
 * Test Strategy:
 * 1. High-confidence matches: "Council Districts" → 85%+
 * 2. Medium-confidence matches: "Ward Boundaries" → 60-80%
 * 3. Low-confidence matches: Ambiguous names → 40-60%
 * 4. False positives: "Parks", "Schools" → <30%
 * 5. Integration: Filter Portland layers to find voting districts
 *
 * TYPE SAFETY: Nuclear-level strictness - no `any`, no loose casts.
 */

import { describe, it, expect } from 'vitest';
import { SemanticLayerValidator } from './semantic-layer-validator.js';
import type { GISLayer } from '../services/gis-server-discovery.js';
import type { CityTarget } from '../providers/us-council-district-discovery.js';

/**
 * Test city context
 */
const TEST_CITY: CityTarget = {
  fips: '2938000',
  name: 'Kansas City',
  state: 'MO',
};

/**
 * Helper to create mock GIS layer
 */
function createMockLayer(overrides: Partial<GISLayer>): GISLayer {
  return {
    id: 0,
    name: 'Test Layer',
    type: 'Feature Layer',
    geometryType: 'esriGeometryPolygon',
    fields: [],
    featureCount: null,
    extent: null,
    url: 'https://example.com/layer/0',
    ...overrides,
  };
}

describe('SemanticLayerValidator', () => {
  describe('High-Confidence Matches', () => {
    it('should score "City Council Districts" highly (85%+)', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'City Council Districts',
        geometryType: 'esriGeometryPolygon',
        fields: [
          { name: 'DISTRICT', type: 'esriFieldTypeInteger', alias: null },
          { name: 'COUNCIL_MEMBER', type: 'esriFieldTypeString', alias: null },
        ],
        featureCount: 6,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(1);
      expect(matches[0].confidence).toBeGreaterThan(85);
      // Implementation generates: 'Name matches high-confidence pattern: "..."'
      expect(matches[0].reasons.some(r => r.startsWith('Name matches high-confidence pattern:'))).toBe(true);
      // Implementation generates: 'Polygon geometry (expected for districts)'
      expect(matches[0].reasons).toContain('Polygon geometry (expected for districts)');
      // Implementation generates: 'Fields contain: DISTRICT, COUNCIL'
      expect(matches[0].reasons.some(r => r.includes('DISTRICT'))).toBe(true);
    });

    it('should score "District Council Boundaries" highly', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'District Council Boundaries',
        geometryType: 'esriGeometryPolygon',
        fields: [
          { name: 'DISTRICT_NUM', type: 'esriFieldTypeInteger', alias: null },
          { name: 'MEMBER_NAME', type: 'esriFieldTypeString', alias: null },
        ],
        featureCount: 8,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(1);
      expect(matches[0].confidence).toBeGreaterThan(80);
    });

    it('should score "Municipal Districts" highly', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Municipal Districts',
        geometryType: 'esriGeometryPolygon',
        fields: [
          { name: 'DISTRICT', type: 'esriFieldTypeInteger', alias: null },
        ],
        featureCount: 5,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(1);
      expect(matches[0].confidence).toBeGreaterThan(75);
    });
  });

  describe('Medium-Confidence Matches', () => {
    it('should score "Ward Boundaries" with medium confidence', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Ward Boundaries',
        geometryType: 'esriGeometryPolygon',
        fields: [
          { name: 'WARD', type: 'esriFieldTypeInteger', alias: null },
          { name: 'WARD_NAME', type: 'esriFieldTypeString', alias: null },
        ],
        featureCount: 10,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(1);
      expect(matches[0].confidence).toBeGreaterThan(60);
      expect(matches[0].confidence).toBeLessThan(85);
      // Implementation generates: 'Name matches medium-confidence pattern: "..."'
      expect(matches[0].reasons.some(r => r.startsWith('Name matches medium-confidence pattern:'))).toBe(true);
    });

    it('should score "Civic Districts" with medium confidence', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Civic Districts',
        geometryType: 'esriGeometryPolygon',
        fields: [
          { name: 'DISTRICT_ID', type: 'esriFieldTypeInteger', alias: null },
        ],
        featureCount: 7,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(1);
      expect(matches[0].confidence).toBeGreaterThan(50);
    });
  });

  describe('Negative Keyword Filtering', () => {
    it('should reject "Voting Precincts 2024"', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Voting Precincts 2024',
        geometryType: 'esriGeometryPolygon',
        fields: [
          { name: 'PRECINCT_ID', type: 'esriFieldTypeInteger', alias: null },
        ],
        featureCount: 150,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      // Should be filtered out (confidence = 0 due to negative keyword)
      expect(matches.length).toBe(0);
    });

    it('should reject "Election Precincts"', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Election Precincts',
        geometryType: 'esriGeometryPolygon',
        featureCount: 200,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(0);
    });

    it('should reject "Tree Canopy Cover"', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Tree Canopy Cover',
        geometryType: 'esriGeometryPolygon',
        featureCount: 50,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(0);
    });

    it('should reject "Zoning Overlay Districts"', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Zoning Overlay Districts',
        geometryType: 'esriGeometryPolygon',
        featureCount: 15,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(0);
    });

    it('should reject "Polling Locations"', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Polling Locations',
        geometryType: 'esriGeometryPoint',
        featureCount: 100,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(0);
    });

    it('should reject "Parcel Boundaries"', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Parcel Boundaries',
        geometryType: 'esriGeometryPolygon',
        featureCount: 5000,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(0);
    });

    it('should accept legitimate "City Council Districts" (not rejected by negative keywords)', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'City Council Districts',
        geometryType: 'esriGeometryPolygon',
        fields: [
          { name: 'DISTRICT', type: 'esriFieldTypeInteger', alias: null },
        ],
        featureCount: 8,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(1);
      expect(matches[0].confidence).toBeGreaterThan(70);
    });

    it('should accept "Ward Boundaries" (not rejected by negative keywords)', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Ward Boundaries',
        geometryType: 'esriGeometryPolygon',
        fields: [
          { name: 'WARD', type: 'esriFieldTypeInteger', alias: null },
        ],
        featureCount: 6,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(1);
      expect(matches[0].confidence).toBeGreaterThan(60);
    });
  });

  describe('False Positive Filtering', () => {
    it('should score "Parks and Recreation" low', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Parks and Recreation',
        geometryType: 'esriGeometryPolygon',
        fields: [
          { name: 'PARK_NAME', type: 'esriFieldTypeString', alias: null },
        ],
        featureCount: 150,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      // Should be filtered out (confidence < 50)
      expect(matches.length).toBe(0);
    });

    it('should score "School Districts" low', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'School Districts',
        geometryType: 'esriGeometryPolygon',
        featureCount: 45,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(0); // Filtered out by false-positive penalty
    });

    it('should score "Fire Districts" low', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Fire Districts',
        geometryType: 'esriGeometryPolygon',
        featureCount: 8,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(0);
    });

    it('should score "Congressional Districts" low', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Congressional Districts',
        geometryType: 'esriGeometryPolygon',
        featureCount: 5,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(0);
    });

    it('should score "State Senate Districts" low', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'State Senate Districts',
        geometryType: 'esriGeometryPolygon',
        featureCount: 12,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(0);
    });
  });

  describe('Geometry Type Validation', () => {
    it('should penalize non-polygon geometry', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Council District Points',
        geometryType: 'esriGeometryPoint', // Point data, not polygons
        fields: [
          { name: 'DISTRICT', type: 'esriFieldTypeInteger', alias: null },
        ],
        featureCount: 6,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      // Should have lower confidence due to point geometry
      if (matches.length > 0) {
        expect(matches[0].confidence).toBeLessThan(60);
        expect(matches[0].reasons).toContain(expect.stringContaining('Non-polygon'));
      }
    });

    it('should reward polygon geometry', () => {
      const validator = new SemanticLayerValidator();
      const polygonLayer = createMockLayer({
        name: 'Council Districts',
        geometryType: 'esriGeometryPolygon',
      });

      const matches = validator.filterCouncilDistrictLayers([polygonLayer], TEST_CITY);

      expect(matches.length).toBe(1);
      // Implementation generates: 'Polygon geometry (expected for districts)'
      expect(matches[0].reasons).toContain('Polygon geometry (expected for districts)');
    });
  });

  describe('Feature Count Validation', () => {
    it('should reward typical district count (3-25)', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Council Districts',
        geometryType: 'esriGeometryPolygon',
        featureCount: 8, // Typical council size
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(1);
      // Implementation generates: 'Feature count 8 in expected range (3-25)'
      expect(matches[0].reasons).toContain('Feature count 8 in expected range (3-25)');
    });

    it('should penalize very high feature count (>100)', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Districts',
        geometryType: 'esriGeometryPolygon',
        featureCount: 250, // Too many for council districts
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      if (matches.length > 0) {
        expect(matches[0].reasons).toContain(expect.stringContaining('too high'));
      }
    });

    it('should penalize very low feature count (<3)', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Districts',
        geometryType: 'esriGeometryPolygon',
        featureCount: 1, // Too few for districts
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      if (matches.length > 0) {
        expect(matches[0].reasons).toContain(expect.stringContaining('too low'));
      }
    });

    it('should handle null feature count gracefully', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Council Districts',
        geometryType: 'esriGeometryPolygon',
        featureCount: null,
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(1);
      // Implementation generates: 'Feature count unknown (neutral)'
      expect(matches[0].reasons).toContain('Feature count unknown (neutral)');
    });
  });

  describe('Field Schema Validation', () => {
    it('should reward DISTRICT field', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Council Districts', // High-confidence name to ensure match passes threshold
        geometryType: 'esriGeometryPolygon',
        fields: [
          { name: 'DISTRICT', type: 'esriFieldTypeInteger', alias: null },
        ],
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(1);
      // Implementation generates: 'Fields contain: DISTRICT'
      expect(matches[0].reasons.some(r => r.includes('DISTRICT'))).toBe(true);
    });

    it('should reward COUNCIL field', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Council Districts', // High-confidence name to ensure match passes threshold
        geometryType: 'esriGeometryPolygon',
        fields: [
          { name: 'COUNCIL_ID', type: 'esriFieldTypeInteger', alias: null },
        ],
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(1);
      // Implementation generates: 'Fields contain: COUNCIL'
      expect(matches[0].reasons.some(r => r.includes('COUNCIL'))).toBe(true);
    });

    it('should reward WARD field', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Ward Boundaries', // Medium-confidence name to ensure match passes threshold
        geometryType: 'esriGeometryPolygon',
        fields: [
          { name: 'WARD_NUM', type: 'esriFieldTypeInteger', alias: null },
        ],
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(1);
      // Implementation generates: 'Fields contain: WARD'
      expect(matches[0].reasons.some(r => r.includes('WARD'))).toBe(true);
    });

    it('should accumulate points for multiple relevant fields', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Council Districts', // High-confidence name to ensure match passes threshold
        geometryType: 'esriGeometryPolygon',
        fields: [
          { name: 'DISTRICT', type: 'esriFieldTypeInteger', alias: null },
          { name: 'COUNCIL_MEMBER', type: 'esriFieldTypeString', alias: null },
          { name: 'WARD_NAME', type: 'esriFieldTypeString', alias: null },
        ],
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(1);
      // Implementation generates: 'Fields contain: DISTRICT, COUNCIL, WARD'
      const fieldReason = matches[0].reasons.find(r => r.startsWith('Fields contain:'));
      expect(fieldReason).toBeDefined();
      expect(fieldReason).toContain('DISTRICT');
      expect(fieldReason).toContain('COUNCIL');
      expect(fieldReason).toContain('WARD');
    });
  });

  describe('Geographic Extent Validation', () => {
    it('should reward city-scale extent', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Council Districts',
        geometryType: 'esriGeometryPolygon',
        extent: {
          xmin: -94.7,
          ymin: 39.0,
          xmax: -94.3,
          ymax: 39.3,
          spatialReference: { wkid: 4326 },
        },
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBe(1);
      // Implementation generates: 'Geographic extent reasonable for city (bonus)'
      expect(matches[0].reasons).toContain('Geographic extent reasonable for city (bonus)');
    });

    it('should penalize state-scale extent', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Districts',
        geometryType: 'esriGeometryPolygon',
        extent: {
          xmin: -95.8,
          ymin: 36.0,
          xmax: -89.1,
          ymax: 40.6, // Entire state of Missouri
          spatialReference: { wkid: 4326 },
        },
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      if (matches.length > 0) {
        expect(matches[0].reasons).toContain(expect.stringContaining('too large'));
      }
    });

    it('should penalize point-scale extent', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Districts',
        geometryType: 'esriGeometryPolygon',
        extent: {
          xmin: -94.5,
          ymin: 39.1,
          xmax: -94.49,
          ymax: 39.11, // Very small
          spatialReference: { wkid: 4326 },
        },
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      if (matches.length > 0) {
        expect(matches[0].reasons).toContain(expect.stringContaining('too small'));
      }
    });
  });

  describe('Ranking and Filtering', () => {
    it('should rank candidates by confidence', () => {
      const validator = new SemanticLayerValidator();

      const layers: GISLayer[] = [
        createMockLayer({
          name: 'Parks',
          geometryType: 'esriGeometryPolygon',
          featureCount: 100,
        }),
        createMockLayer({
          name: 'Council Districts',
          geometryType: 'esriGeometryPolygon',
          fields: [{ name: 'DISTRICT', type: 'esriFieldTypeInteger', alias: null }],
          featureCount: 6,
        }),
        createMockLayer({
          name: 'Ward Boundaries',
          geometryType: 'esriGeometryPolygon',
          fields: [{ name: 'WARD', type: 'esriFieldTypeInteger', alias: null }],
          featureCount: 8,
        }),
      ];

      const matches = validator.filterCouncilDistrictLayers(layers, TEST_CITY);

      // Should be sorted by confidence (highest first)
      expect(matches.length).toBeGreaterThan(0);
      for (let i = 1; i < matches.length; i++) {
        expect(matches[i - 1].confidence).toBeGreaterThanOrEqual(matches[i].confidence);
      }

      // Top match should be "Council Districts"
      expect(matches[0].layer.name).toBe('Council Districts');
    });

    it('should filter out low-confidence matches (<50%)', () => {
      const validator = new SemanticLayerValidator();

      const layers: GISLayer[] = [
        createMockLayer({
          name: 'Random Layer',
          geometryType: 'esriGeometryPoint',
          featureCount: 500,
        }),
      ];

      const matches = validator.filterCouncilDistrictLayers(layers, TEST_CITY);

      expect(matches.length).toBe(0); // Should be filtered out
    });

    it('should get top N candidates', () => {
      const validator = new SemanticLayerValidator();

      const layers: GISLayer[] = [
        createMockLayer({ id: 1, name: 'Council Districts', geometryType: 'esriGeometryPolygon', featureCount: 6 }),
        createMockLayer({ id: 2, name: 'Ward Boundaries', geometryType: 'esriGeometryPolygon', featureCount: 8 }),
        createMockLayer({ id: 3, name: 'Civic Districts', geometryType: 'esriGeometryPolygon', featureCount: 5 }),
        createMockLayer({ id: 4, name: 'Municipal Districts', geometryType: 'esriGeometryPolygon', featureCount: 7 }),
      ];

      const matches = validator.filterCouncilDistrictLayers(layers, TEST_CITY);
      const topTwo = validator.getTopCandidates(matches, 2);

      expect(topTwo.length).toBeLessThanOrEqual(2);
    });

    it('should filter to high-confidence matches only (≥70%)', () => {
      const validator = new SemanticLayerValidator();

      const layers: GISLayer[] = [
        createMockLayer({
          name: 'City Council Districts',
          geometryType: 'esriGeometryPolygon',
          fields: [{ name: 'DISTRICT', type: 'esriFieldTypeInteger', alias: null }],
          featureCount: 6,
        }),
        createMockLayer({
          name: 'Districts',
          geometryType: 'esriGeometryPolygon',
          featureCount: 10,
        }),
      ];

      const matches = validator.filterCouncilDistrictLayers(layers, TEST_CITY);
      const highConfidence = validator.getHighConfidenceMatches(matches);

      for (const match of highConfidence) {
        expect(match.confidence).toBeGreaterThanOrEqual(70);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty layer list', () => {
      const validator = new SemanticLayerValidator();
      const matches = validator.filterCouncilDistrictLayers([], TEST_CITY);

      expect(matches).toBeDefined();
      expect(matches.length).toBe(0);
    });

    it('should handle layer with no fields', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Council Districts',
        geometryType: 'esriGeometryPolygon',
        fields: [],
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBeGreaterThan(0);
      // Implementation generates: 'No district-related fields found'
      expect(matches[0].reasons).toContain('No district-related fields found');
    });

    it('should handle layer with null geometry type', () => {
      const validator = new SemanticLayerValidator();
      const layer = createMockLayer({
        name: 'Council Districts',
        geometryType: null,
        fields: [
          { name: 'DISTRICT', type: 'esriFieldTypeInteger', alias: null },
        ],
        featureCount: 8, // Add feature count to boost confidence over 50% threshold
      });

      const matches = validator.filterCouncilDistrictLayers([layer], TEST_CITY);

      expect(matches.length).toBeGreaterThan(0);
      // Implementation generates: 'Geometry type unknown (neutral)'
      expect(matches[0].reasons).toContain('Geometry type unknown (neutral)');
    });
  });
});
