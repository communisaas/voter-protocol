/**
 * Response Schema Tests
 *
 * SA-014: Tests for Zod schema validation of external API responses.
 *
 * Tests cover:
 * - Valid response parsing
 * - Invalid response rejection
 * - Error handling
 * - Edge cases
 */

import { describe, it, expect } from 'vitest';
import {
  // ArcGIS
  parseHubDatasetsResponse,
  parsePortalSearchResponse,
  parseArcGISServiceInfo,
  parseArcGISGeoJSONResponse,
  safeParseArcGISResponse,
  HubDatasetsResponseSchema,

  // Census
  parseTIGERWebServiceInfo,
  parseTIGERWebGeoJSONResponse,
  parseCensusDataAPIResponse,
  safeParseCensusResponse,
  isArcGISError,
  TIGERWebGeoJSONResponseSchema,

  // Socrata
  parseSocrataDiscoveryResponse,
  parseSocrataGeoJSONResponse,
  safeParseSocrataResponse,
  isSocrataError,
  SocrataDiscoveryResponseSchema,
} from '../index.js';

// ============================================================================
// ArcGIS Response Schema Tests
// ============================================================================

describe('ArcGIS Response Schemas', () => {
  describe('parseHubDatasetsResponse', () => {
    it('should parse valid Hub datasets response', () => {
      const validResponse = {
        data: [
          {
            id: 'abc123',
            type: 'Feature Layer',
            attributes: {
              name: 'City Council Districts',
              description: 'Official council district boundaries',
              url: 'https://services.arcgis.com/org/arcgis/rest/services/Districts/FeatureServer',
              serviceUrl: 'https://services.arcgis.com/org/arcgis/rest/services/Districts/FeatureServer',
              recordCount: 9,
            },
          },
        ],
        meta: {
          count: 1,
        },
      };

      const result = parseHubDatasetsResponse(validResponse);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].attributes.name).toBe('City Council Districts');
    });

    it('should reject response with missing required fields', () => {
      const invalidResponse = {
        data: [
          {
            // Missing id
            type: 'Feature Layer',
            attributes: {
              name: 'Districts',
            },
          },
        ],
      };

      expect(() => parseHubDatasetsResponse(invalidResponse)).toThrow();
    });

    it('should allow additional fields (passthrough)', () => {
      const responseWithExtra = {
        data: [
          {
            id: 'abc123',
            type: 'Feature Layer',
            attributes: {
              name: 'Districts',
              customField: 'extra data',
            },
            extraTopLevel: 'ignored',
          },
        ],
      };

      const result = parseHubDatasetsResponse(responseWithExtra);
      expect(result.data).toHaveLength(1);
    });

    it('should reject excessively large datasets array', () => {
      const tooManyDatasets = {
        data: Array(1001).fill({
          id: 'abc',
          type: 'Feature Layer',
          attributes: { name: 'Test' },
        }),
      };

      expect(() => parseHubDatasetsResponse(tooManyDatasets)).toThrow();
    });
  });

  describe('parsePortalSearchResponse', () => {
    it('should parse valid Portal search response', () => {
      const validResponse = {
        results: [
          {
            id: 'xyz789',
            title: 'Ward Boundaries',
            type: 'Feature Service',
            url: 'https://www.arcgis.com/home/item.html?id=xyz789',
          },
        ],
        total: 1,
        start: 1,
        num: 10,
      };

      const result = parsePortalSearchResponse(validResponse);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe('Ward Boundaries');
    });
  });

  describe('parseArcGISServiceInfo', () => {
    it('should parse valid service info response', () => {
      const validResponse = {
        currentVersion: 10.91,
        serviceDescription: 'Municipal boundaries',
        layers: [
          {
            id: 0,
            name: 'Council Districts',
            type: 'Feature Layer',
            geometryType: 'esriGeometryPolygon',
          },
        ],
      };

      const result = parseArcGISServiceInfo(validResponse);
      expect(result.layers).toHaveLength(1);
      expect(result.layers?.[0].name).toBe('Council Districts');
    });
  });

  describe('parseArcGISGeoJSONResponse', () => {
    it('should parse valid GeoJSON response', () => {
      const validResponse = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 1,
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-122.0, 37.0],
                  [-122.0, 38.0],
                  [-121.0, 38.0],
                  [-121.0, 37.0],
                  [-122.0, 37.0],
                ],
              ],
            },
            properties: {
              DISTRICT: '1',
              NAME: 'District 1',
            },
          },
        ],
      };

      const result = parseArcGISGeoJSONResponse(validResponse);
      expect(result.features).toHaveLength(1);
      expect(result.features[0].properties?.DISTRICT).toBe('1');
    });

    it('should parse MultiPolygon geometries', () => {
      const multiPolygonResponse = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'MultiPolygon',
              coordinates: [
                [
                  [
                    [-122.0, 37.0],
                    [-122.0, 38.0],
                    [-121.0, 38.0],
                    [-121.0, 37.0],
                    [-122.0, 37.0],
                  ],
                ],
                [
                  [
                    [-120.0, 36.0],
                    [-120.0, 37.0],
                    [-119.0, 37.0],
                    [-119.0, 36.0],
                    [-120.0, 36.0],
                  ],
                ],
              ],
            },
            properties: null,
          },
        ],
      };

      const result = parseArcGISGeoJSONResponse(multiPolygonResponse);
      expect(result.features[0].geometry?.type).toBe('MultiPolygon');
    });

    it('should reject non-FeatureCollection', () => {
      const invalidResponse = {
        type: 'Feature',
        geometry: null,
        properties: {},
      };

      expect(() => parseArcGISGeoJSONResponse(invalidResponse)).toThrow();
    });
  });

  describe('safeParseArcGISResponse', () => {
    it('should return success for valid data', () => {
      const result = safeParseArcGISResponse(
        { data: [], meta: {} },
        HubDatasetsResponseSchema
      );
      expect(result.success).toBe(true);
    });

    it('should return error for invalid data', () => {
      const result = safeParseArcGISResponse(
        { invalid: 'structure' },
        HubDatasetsResponseSchema
      );
      expect(result.success).toBe(false);
      expect('error' in result && result.error).toBeTruthy();
    });
  });
});

// ============================================================================
// Census Response Schema Tests
// ============================================================================

describe('Census Response Schemas', () => {
  describe('parseTIGERWebServiceInfo', () => {
    it('should parse valid TIGERweb service info', () => {
      const validResponse = {
        currentVersion: 10.91,
        serviceDescription: 'TIGERweb/tigerWMS_Current (MapServer)',
        mapName: 'tigerWMS_Current',
        layers: [
          {
            id: 0,
            name: 'States',
            type: 'Feature Layer',
            geometryType: 'esriGeometryPolygon',
          },
          {
            id: 1,
            name: 'Counties',
            type: 'Feature Layer',
            geometryType: 'esriGeometryPolygon',
          },
        ],
      };

      const result = parseTIGERWebServiceInfo(validResponse);
      expect(result.layers).toHaveLength(2);
      expect(result.mapName).toBe('tigerWMS_Current');
    });
  });

  describe('parseTIGERWebGeoJSONResponse', () => {
    it('should parse valid TIGERweb GeoJSON response', () => {
      const validResponse = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: '48201',
            geometry: {
              type: 'Polygon',
              coordinates: [[[-95.0, 29.0], [-95.0, 30.0], [-94.0, 30.0], [-94.0, 29.0], [-95.0, 29.0]]],
            },
            properties: {
              STATEFP: '48',
              COUNTYFP: '201',
              GEOID: '48201',
              NAME: 'Harris',
            },
          },
        ],
      };

      const result = parseTIGERWebGeoJSONResponse(validResponse);
      expect(result.features).toHaveLength(1);
    });

    it('should handle null geometry', () => {
      const responseWithNullGeom = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: null,
            properties: { NAME: 'Test' },
          },
        ],
      };

      const result = parseTIGERWebGeoJSONResponse(responseWithNullGeom);
      expect(result.features[0].geometry).toBeNull();
    });
  });

  describe('parseCensusDataAPIResponse', () => {
    it('should parse valid Census Data API response', () => {
      const validResponse = [
        ['NAME', 'B01001_001E', 'state'],
        ['California', '39538223', '06'],
        ['Texas', '29145505', '48'],
      ];

      const result = parseCensusDataAPIResponse(validResponse);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(['NAME', 'B01001_001E', 'state']);
    });

    it('should reject empty response', () => {
      expect(() => parseCensusDataAPIResponse([])).toThrow();
    });
  });

  describe('isArcGISError', () => {
    it('should detect ArcGIS error responses', () => {
      const errorResponse = {
        error: {
          code: 400,
          message: 'Unable to complete operation.',
          details: ['Invalid query parameter'],
        },
      };

      expect(isArcGISError(errorResponse)).toBe(true);
    });

    it('should not flag normal responses', () => {
      const normalResponse = {
        type: 'FeatureCollection',
        features: [],
      };

      expect(isArcGISError(normalResponse)).toBe(false);
    });
  });

  describe('safeParseCensusResponse', () => {
    it('should return error for ArcGIS error response', () => {
      const errorResponse = {
        error: {
          code: 500,
          message: 'Internal server error',
        },
      };

      const result = safeParseCensusResponse(errorResponse, TIGERWebGeoJSONResponseSchema);
      expect(result.success).toBe(false);
      expect('error' in result && result.error).toContain('500');
    });
  });
});

// ============================================================================
// Socrata Response Schema Tests
// ============================================================================

describe('Socrata Response Schemas', () => {
  describe('parseSocrataDiscoveryResponse', () => {
    it('should parse valid Discovery API response', () => {
      const validResponse = {
        results: [
          {
            resource: {
              id: '4u6w-8cgt',
              name: 'City Council Districts',
              description: 'Official district boundaries',
              type: 'dataset',
              distribution: [
                {
                  downloadURL: 'https://data.seattle.gov/resource/4u6w-8cgt.geojson',
                  mediaType: 'application/geo+json',
                },
              ],
            },
            classification: {
              domain_tags: ['boundaries', 'council'],
            },
            permalink: 'https://data.seattle.gov/d/4u6w-8cgt',
          },
        ],
        resultSetSize: 1,
      };

      const result = parseSocrataDiscoveryResponse(validResponse);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].resource.name).toBe('City Council Districts');
    });

    it('should handle missing optional fields', () => {
      const minimalResponse = {
        results: [
          {
            resource: {
              id: 'abc123',
              name: 'Test Dataset',
            },
          },
        ],
      };

      const result = parseSocrataDiscoveryResponse(minimalResponse);
      expect(result.results).toHaveLength(1);
    });
  });

  describe('parseSocrataGeoJSONResponse', () => {
    it('should parse valid Socrata GeoJSON response', () => {
      const validResponse = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [[[-122.0, 47.0], [-122.0, 48.0], [-121.0, 48.0], [-121.0, 47.0], [-122.0, 47.0]]],
            },
            properties: {
              district_id: '1',
              council_member: 'Test Name',
            },
          },
        ],
      };

      const result = parseSocrataGeoJSONResponse(validResponse);
      expect(result.features).toHaveLength(1);
    });

    it('should handle Point geometry', () => {
      const pointResponse = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [-122.0, 47.0],
            },
            properties: { name: 'Test Point' },
          },
        ],
      };

      const result = parseSocrataGeoJSONResponse(pointResponse);
      expect(result.features[0].geometry?.type).toBe('Point');
    });
  });

  describe('isSocrataError', () => {
    it('should detect Socrata error responses', () => {
      const errorResponse = {
        error: true,
        message: 'Resource not found',
        code: 'not_found',
      };

      expect(isSocrataError(errorResponse)).toBe(true);
    });

    it('should detect error by message/code fields', () => {
      const errorResponse = {
        message: 'Invalid SoQL query',
        code: 'query.compiler.invalid',
      };

      expect(isSocrataError(errorResponse)).toBe(true);
    });

    it('should not flag normal responses', () => {
      expect(isSocrataError({ results: [] })).toBe(false);
      expect(isSocrataError([{ name: 'Test' }])).toBe(false);
    });
  });

  describe('safeParseSocrataResponse', () => {
    it('should return error for Socrata error response', () => {
      const errorResponse = {
        error: true,
        message: 'Dataset not found',
        code: 'not_found',
      };

      const result = safeParseSocrataResponse(errorResponse, SocrataDiscoveryResponseSchema);
      expect(result.success).toBe(false);
      expect('error' in result && result.error).toContain('not found');
    });
  });
});

// ============================================================================
// Security Tests
// ============================================================================

describe('Schema Security', () => {
  describe('size limits', () => {
    it('should reject oversized datasets arrays', () => {
      const oversized = {
        data: Array(1001).fill({
          id: 'x',
          type: 'test',
          attributes: { name: 'test' },
        }),
      };

      expect(() => parseHubDatasetsResponse(oversized)).toThrow();
    });

    it('should reject oversized feature arrays', () => {
      const oversized = {
        type: 'FeatureCollection',
        features: Array(100001).fill({
          type: 'Feature',
          geometry: null,
          properties: {},
        }),
      };

      expect(() => parseArcGISGeoJSONResponse(oversized)).toThrow();
    });
  });

  describe('malicious input', () => {
    it('should reject prototype pollution attempts', () => {
      const maliciousResponse = {
        data: [
          {
            id: 'test',
            type: 'test',
            attributes: { name: 'test' },
            __proto__: { polluted: true },
          },
        ],
      };

      // Should parse without prototype pollution
      const result = parseHubDatasetsResponse(maliciousResponse);
      expect((result as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('should handle deeply nested objects safely', () => {
      // Create deeply nested object (potential DoS vector)
      const createDeep = (depth: number): object => {
        if (depth === 0) return { type: 'Polygon', coordinates: [[]] };
        return { nested: createDeep(depth - 1) };
      };

      const deepResponse = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: createDeep(100),
            properties: {},
          },
        ],
      };

      // Should reject invalid geometry structure
      expect(() => parseArcGISGeoJSONResponse(deepResponse)).toThrow();
    });
  });
});
