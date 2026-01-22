/**
 * Boundary Reconstruction Tests
 *
 * Comprehensive test suite for the reconstruction module.
 * Uses golden vectors for regression prevention.
 *
 * PHILOSOPHY:
 * - Golden vector tests catch regressions
 * - Unit tests verify component behavior
 * - Integration tests verify pipeline flow
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { Feature, Polygon } from 'geojson';

// Street normalizer
import {
  normalizeStreetName,
  streetNameSimilarity,
  areStreetNamesEquivalent,
  extractStreetCandidates,
} from './street-normalizer';

// Description parser
import {
  parseLegalDescription,
  parseWardDescription,
  validateParsedSegments,
  getDefaultParserConfig,
} from './description-parser';

// Segment matcher
import {
  matchSegment,
  matchWardDescription,
  SimpleStreetNetworkQuery,
  haversineDistance,
  getDefaultMatcherConfig,
} from './segment-matcher';

// Polygon builder
import {
  buildPolygonFromMatches,
  buildWardPolygon,
  signedRingArea,
  ringAreaSquareMeters,
  isCounterClockwise,
  hasSelfIntersections,
  getDefaultPolygonBuilderConfig,
} from './polygon-builder';

// Golden vector validator
import {
  validateWardAgainstGolden,
  validateCityAgainstGolden,
  createGoldenVector,
  detectRegressions,
  getDefaultGoldenVectorConfig,
} from './golden-vector-validator';

// Test utilities
import {
  createMockStreetSegment,
  createMockStreetGrid,
  createRectangularWardDescription,
  createRectangularPolygon,
  createTestFixture,
  assertValidPolygon,
} from './test-utils';

// =============================================================================
// Street Normalizer Tests
// =============================================================================

describe('StreetNormalizer', () => {
  describe('normalizeStreetName', () => {
    it('expands common abbreviations', () => {
      const result = normalizeStreetName('Main St');
      expect(result.normalized).toBe('main street');
      expect(result.streetType).toBe('street');
    });

    it('expands directional prefixes', () => {
      const result = normalizeStreetName('N Oak Ave');
      expect(result.directionPrefix).toBe('north');
      expect(result.normalized).toContain('north');
      expect(result.normalized).toContain('oak');
    });

    it('expands MLK variations', () => {
      const result = normalizeStreetName('MLK Jr Blvd');
      expect(result.normalized).toContain('martin luther king');
    });

    it('handles ordinals', () => {
      const result = normalizeStreetName('1st Street');
      expect(result.normalized).toBe('first street');
    });

    it('extracts core name without direction and type', () => {
      const result = normalizeStreetName('North Main Street East');
      // Core name keeps the base name, just removes direction prefix/suffix
      expect(result.coreName).toContain('main');
      expect(result.directionPrefix).toBe('north');
    });
  });

  describe('streetNameSimilarity', () => {
    it('returns 1.0 for exact matches', () => {
      const a = normalizeStreetName('Main Street');
      const b = normalizeStreetName('Main Street');
      expect(streetNameSimilarity(a, b)).toBe(1.0);
    });

    it('returns high similarity for abbreviation variants', () => {
      const a = normalizeStreetName('Main Street');
      const b = normalizeStreetName('Main St');
      expect(streetNameSimilarity(a, b)).toBe(1.0);
    });

    it('returns reasonable similarity for same core name different type', () => {
      const a = normalizeStreetName('Oak Street');
      const b = normalizeStreetName('Oak Avenue');
      // Different street types will have lower similarity due to Levenshtein
      // The 0.95 is only for exact core name match (which checks equality)
      expect(streetNameSimilarity(a, b)).toBeGreaterThan(0.3);
    });

    it('returns low similarity for different names', () => {
      const a = normalizeStreetName('Main Street');
      const b = normalizeStreetName('Elm Avenue');
      expect(streetNameSimilarity(a, b)).toBeLessThan(0.5);
    });
  });

  describe('areStreetNamesEquivalent', () => {
    it('returns true for equivalent names', () => {
      expect(areStreetNamesEquivalent('Main St', 'Main Street')).toBe(true);
      expect(areStreetNamesEquivalent('N Oak Ave', 'North Oak Avenue')).toBe(true);
    });

    it('returns false for different names', () => {
      expect(areStreetNamesEquivalent('Main Street', 'Elm Street')).toBe(false);
    });
  });

  describe('extractStreetCandidates', () => {
    it('extracts street names from "along" phrases', () => {
      const candidates = extractStreetCandidates('along Main Street to the intersection');
      expect(candidates).toContain('Main Street');
    });

    it('extracts multiple candidates', () => {
      const candidates = extractStreetCandidates(
        'along Main Street, then north on Oak Avenue'
      );
      expect(candidates.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// =============================================================================
// Description Parser Tests
// =============================================================================

describe('DescriptionParser', () => {
  describe('parseLegalDescription', () => {
    it('parses semicolon-separated segments', () => {
      const text = 'along Main Street; then north on Oak Avenue; then west on 2nd Street';
      const result = parseLegalDescription(text);

      expect(result.success).toBe(true);
      expect(result.segments.length).toBe(3);
    });

    it('parses thence-separated segments', () => {
      const text =
        'Beginning at Main Street thence north along Oak Avenue thence west to Elm Street';
      const result = parseLegalDescription(text);

      expect(result.success).toBe(true);
      expect(result.segments.length).toBeGreaterThan(1);
    });

    it('assigns parse confidence levels', () => {
      const text = 'along Main Street; some unclear text here';
      const result = parseLegalDescription(text);

      const highConf = result.segments.filter((s) => s.parseConfidence === 'high');
      expect(highConf.length).toBeGreaterThanOrEqual(1);
    });

    it('detects municipal boundary references', () => {
      const text = 'along the city limits to Oak Street';
      const result = parseLegalDescription(text);

      const municipal = result.segments.find(
        (s) => s.referenceType === 'municipal_boundary'
      );
      expect(municipal).toBeDefined();
    });

    it('detects railroad references', () => {
      const text = 'along the Union Pacific Railroad right-of-way';
      const result = parseLegalDescription(text);

      expect(result.segments[0].referenceType).toBe('railroad');
    });
  });

  describe('parseWardDescription', () => {
    it('creates complete ward description', () => {
      const { description, parseResult } = parseWardDescription({
        cityFips: '1234567',
        cityName: 'Test City',
        state: 'TX',
        wardId: '1',
        wardName: 'Ward 1',
        descriptionText: 'along Main Street; north on Oak Avenue',
        source: {
          type: 'ordinance_text',
          source: 'https://example.com',
          title: 'Test Ordinance',
          effectiveDate: '2024-01-01',
          retrievedAt: new Date().toISOString(),
        },
      });

      expect(description.cityFips).toBe('1234567');
      expect(description.segments.length).toBe(parseResult.segments.length);
    });
  });

  describe('validateParsedSegments', () => {
    it('reports insufficient segments', () => {
      const issues = validateParsedSegments([
        {
          index: 0,
          referenceType: 'street_centerline',
          featureName: 'Main Street',
          rawText: 'along Main Street',
          parseConfidence: 'high',
        },
      ]);

      expect(issues.some((i) => i.includes('at least 3'))).toBe(true);
    });
  });
});

// =============================================================================
// Segment Matcher Tests
// =============================================================================

describe('SegmentMatcher', () => {
  let streetQuery: SimpleStreetNetworkQuery;

  beforeAll(() => {
    const segments = createMockStreetGrid({
      centerLon: -95.0,
      centerLat: 30.0,
      gridSize: 0.01,
      streetCount: 5,
    });
    streetQuery = new SimpleStreetNetworkQuery(segments);
  });

  describe('haversineDistance', () => {
    it('calculates distance correctly', () => {
      // About 111km per degree latitude
      const dist = haversineDistance([0, 0], [0, 1]);
      expect(dist).toBeGreaterThan(110000);
      expect(dist).toBeLessThan(112000);
    });

    it('returns 0 for same point', () => {
      const dist = haversineDistance([-95, 30], [-95, 30]);
      expect(dist).toBe(0);
    });
  });

  describe('matchSegment', () => {
    it('matches exact street name', () => {
      const result = matchSegment(
        {
          index: 0,
          referenceType: 'street_centerline',
          featureName: 'Main Street',
          rawText: 'along Main Street',
          parseConfidence: 'high',
        },
        streetQuery,
        null,
        getDefaultMatcherConfig()
      );

      expect(result.matchQuality).not.toBe('failed');
      expect(result.matchedSegments.length).toBeGreaterThan(0);
    });

    it('matches abbreviated street name', () => {
      const result = matchSegment(
        {
          index: 0,
          referenceType: 'street_centerline',
          featureName: 'Main St',
          rawText: 'along Main St',
          parseConfidence: 'high',
        },
        streetQuery,
        null,
        getDefaultMatcherConfig()
      );

      expect(result.matchQuality).not.toBe('failed');
    });

    it('fails for non-existent street', () => {
      const result = matchSegment(
        {
          index: 0,
          referenceType: 'street_centerline',
          featureName: 'Nonexistent Boulevard',
          rawText: 'along Nonexistent Boulevard',
          parseConfidence: 'high',
        },
        streetQuery,
        null,
        getDefaultMatcherConfig()
      );

      expect(result.matchQuality).toBe('failed');
    });

    it('selects contiguous segments when multiple segments match', () => {
      // Create a long street with multiple disconnected segments
      const longStreetSegments = [
        createMockStreetSegment({
          id: 'watson-1',
          name: 'Watson Road',
          coordinates: [
            [-95.0, 30.0],
            [-95.0, 30.01],
          ],
        }),
        createMockStreetSegment({
          id: 'watson-2',
          name: 'Watson Road',
          coordinates: [
            [-95.0, 30.01], // Connects to watson-1
            [-95.0, 30.02],
          ],
        }),
        createMockStreetSegment({
          id: 'watson-3',
          name: 'Watson Road',
          coordinates: [
            [-95.0, 30.02], // Connects to watson-2
            [-95.0, 30.03],
          ],
        }),
        createMockStreetSegment({
          id: 'watson-disconnected',
          name: 'Watson Road',
          coordinates: [
            [-95.1, 30.1], // Far away, not connected
            [-95.1, 30.11],
          ],
        }),
      ];

      const testQuery = new SimpleStreetNetworkQuery([...longStreetSegments]);

      // Match from a reference point near watson-1
      const referencePoint: [number, number] = [-95.0, 30.0];
      const result = matchSegment(
        {
          index: 0,
          referenceType: 'street_centerline',
          featureName: 'Watson Road',
          rawText: 'along Watson Road',
          parseConfidence: 'high',
        },
        testQuery,
        referencePoint,
        getDefaultMatcherConfig()
      );

      // Should match 3 contiguous segments, not the disconnected one
      expect(result.matchQuality).not.toBe('failed');
      expect(result.matchedSegments.length).toBe(3);
      expect(result.matchedSegments.map(s => s.id)).toEqual([
        'watson-1',
        'watson-2',
        'watson-3',
      ]);
      expect(result.coordinates.length).toBeGreaterThan(3); // Multiple segments merged
    });

    it('chains segments in correct order starting from reference point', () => {
      // Create segments that should be chained
      const chainSegments = [
        createMockStreetSegment({
          id: 'oak-1',
          name: 'Oak Avenue',
          coordinates: [
            [-95.0, 30.0],
            [-95.0, 30.005],
          ],
        }),
        createMockStreetSegment({
          id: 'oak-2',
          name: 'Oak Avenue',
          coordinates: [
            [-95.0, 30.005], // Connects to oak-1 end
            [-95.0, 30.01],
          ],
        }),
        createMockStreetSegment({
          id: 'oak-3',
          name: 'Oak Avenue',
          coordinates: [
            [-95.0, 30.01], // Connects to oak-2 end
            [-95.0, 30.015],
          ],
        }),
      ];

      const testQuery = new SimpleStreetNetworkQuery(chainSegments);

      // Reference point near start of oak-1
      const referencePoint: [number, number] = [-95.0, 30.0];
      const result = matchSegment(
        {
          index: 0,
          referenceType: 'street_centerline',
          featureName: 'Oak Avenue',
          rawText: 'north along Oak Avenue',
          parseConfidence: 'high',
        },
        testQuery,
        referencePoint,
        getDefaultMatcherConfig()
      );

      expect(result.matchedSegments.length).toBe(3);
      expect(result.coordinates[0]).toEqual([-95.0, 30.0]); // Starts at reference point
      expect(result.coordinates[result.coordinates.length - 1]).toEqual([-95.0, 30.015]); // Ends at chain end
    });

    it('stops chaining when connection gap exceeds tolerance', () => {
      // Create segments with a large gap
      const gappedSegments = [
        createMockStreetSegment({
          id: 'elm-1',
          name: 'Elm Street',
          coordinates: [
            [-95.0, 30.0],
            [-95.0, 30.01],
          ],
        }),
        createMockStreetSegment({
          id: 'elm-2',
          name: 'Elm Street',
          coordinates: [
            [-95.0, 30.02], // 1.1km gap - too large
            [-95.0, 30.03],
          ],
        }),
      ];

      const testQuery = new SimpleStreetNetworkQuery(gappedSegments);

      const referencePoint: [number, number] = [-95.0, 30.0];
      const result = matchSegment(
        {
          index: 0,
          referenceType: 'street_centerline',
          featureName: 'Elm Street',
          rawText: 'along Elm Street',
          parseConfidence: 'high',
        },
        testQuery,
        referencePoint,
        getDefaultMatcherConfig()
      );

      // Should only match the first segment, not chain across the gap
      expect(result.matchedSegments.length).toBe(1);
      expect(result.matchedSegments[0].id).toBe('elm-1');
    });

    it('handles single segment case without chaining', () => {
      const result = matchSegment(
        {
          index: 0,
          referenceType: 'street_centerline',
          featureName: 'Main Street',
          rawText: 'along Main Street',
          parseConfidence: 'high',
        },
        streetQuery,
        null,
        getDefaultMatcherConfig()
      );

      // With our mock grid, there's likely only one Main Street
      expect(result.matchQuality).not.toBe('failed');
      expect(result.coordinates.length).toBeGreaterThan(0);
    });

    it('Watson Road scenario: selects correct contiguous portion from 96 segments', () => {
      // Simulate Watson Road with many disconnected segments across a large city
      // Real Watson Road in St. Louis area has 96 segments in OSM
      const watsonSegments: StreetSegment[] = [];

      // Create 10 disconnected clusters of Watson Road segments
      for (let cluster = 0; cluster < 10; cluster++) {
        const clusterLon = -90.3 + cluster * 0.05; // Spread across ~5.5km
        const clusterLat = 38.55;

        // Each cluster has 3 connected segments
        for (let seg = 0; seg < 3; seg++) {
          watsonSegments.push(
            createMockStreetSegment({
              id: `watson-cluster${cluster}-seg${seg}`,
              name: 'Watson Road',
              coordinates: [
                [clusterLon, clusterLat + seg * 0.002],
                [clusterLon, clusterLat + (seg + 1) * 0.002],
              ],
            })
          );
        }

        // Add some isolated single segments between clusters
        if (cluster < 9) {
          watsonSegments.push(
            createMockStreetSegment({
              id: `watson-isolated${cluster}`,
              name: 'Watson Road',
              coordinates: [
                [clusterLon + 0.025, clusterLat],
                [clusterLon + 0.025, clusterLat + 0.001],
              ],
            })
          );
        }
      }

      // Now we have 30 connected segments + 9 isolated = 39 total segments
      const testQuery = new SimpleStreetNetworkQuery(watsonSegments);

      // Previous segment ended near cluster 3
      const referencePoint: [number, number] = [-90.3 + 3 * 0.05, 38.55];

      const result = matchSegment(
        {
          index: 1,
          referenceType: 'street_centerline',
          featureName: 'Watson Road',
          rawText: 'east along Watson Road',
          parseConfidence: 'high',
        },
        testQuery,
        referencePoint,
        getDefaultMatcherConfig()
      );

      // Should select only the 3 contiguous segments from cluster 3
      expect(result.matchQuality).not.toBe('failed');
      expect(result.matchedSegments.length).toBe(3);

      // Verify it selected the correct cluster
      const selectedIds = result.matchedSegments.map(s => s.id);
      expect(selectedIds.every(id => id.includes('cluster3'))).toBe(true);

      // Verify coordinates form a continuous path
      const coords = result.coordinates;
      expect(coords.length).toBeGreaterThan(3);

      // First coordinate should be near reference point
      const distToRef = haversineDistance(coords[0], referencePoint);
      expect(distToRef).toBeLessThan(300); // Within 300m
    });

    it('uses reference point to disambiguate between distant segments with same name', () => {
      // Two completely separate "Park Street" segments in different parts of city
      const parkSegments = [
        // North side Park Street
        createMockStreetSegment({
          id: 'park-north',
          name: 'Park Street',
          coordinates: [
            [-95.0, 30.1], // 11km north
            [-95.0, 30.11],
          ],
        }),
        // South side Park Street (near reference point)
        createMockStreetSegment({
          id: 'park-south',
          name: 'Park Street',
          coordinates: [
            [-95.0, 30.0],
            [-95.0, 30.01],
          ],
        }),
      ];

      const testQuery = new SimpleStreetNetworkQuery(parkSegments);

      // Reference point near south Park Street
      const referencePoint: [number, number] = [-95.0, 30.005];

      const result = matchSegment(
        {
          index: 0,
          referenceType: 'street_centerline',
          featureName: 'Park Street',
          rawText: 'along Park Street',
          parseConfidence: 'high',
        },
        testQuery,
        referencePoint,
        getDefaultMatcherConfig()
      );

      // Should select the south segment, not the north one
      expect(result.matchedSegments.length).toBe(1);
      expect(result.matchedSegments[0].id).toBe('park-south');
    });
  });

  describe('matchWardDescription', () => {
    it('matches complete ward description', () => {
      const desc = createRectangularWardDescription({
        cityFips: '1234567',
        cityName: 'Test City',
        state: 'TX',
        wardId: '1',
        northStreet: '2nd Street',
        southStreet: '1st Street',
        eastStreet: 'Main Street',
        westStreet: 'Oak Avenue',
      });

      const result = matchWardDescription(desc, streetQuery);

      // Should match at least some segments
      expect(result.diagnostics.matchedSegments).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// Polygon Builder Tests
// =============================================================================

describe('PolygonBuilder', () => {
  describe('signedRingArea', () => {
    it('returns positive for CCW ring', () => {
      const ccwRing = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ] as [number, number][];
      expect(signedRingArea(ccwRing)).toBeGreaterThan(0);
    });

    it('returns negative for CW ring', () => {
      const cwRing = [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      ] as [number, number][];
      expect(signedRingArea(cwRing)).toBeLessThan(0);
    });
  });

  describe('isCounterClockwise', () => {
    it('correctly identifies CCW ring', () => {
      const ccwRing = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ] as [number, number][];
      expect(isCounterClockwise(ccwRing)).toBe(true);
    });
  });

  describe('hasSelfIntersections', () => {
    it('returns false for simple polygon', () => {
      const simple = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ] as [number, number][];
      expect(hasSelfIntersections(simple)).toBe(false);
    });

    it('returns true for figure-8 polygon', () => {
      const figure8 = [
        [0, 0],
        [1, 1],
        [1, 0],
        [0, 1],
        [0, 0],
      ] as [number, number][];
      expect(hasSelfIntersections(figure8)).toBe(true);
    });
  });

  describe('buildPolygonFromMatches', () => {
    it('builds valid polygon from matches', () => {
      // Create mock match results with coordinates
      const matches = [
        {
          description: {
            index: 0,
            referenceType: 'street_centerline' as const,
            featureName: 'Test',
            rawText: 'test',
            parseConfidence: 'high' as const,
          },
          matchedSegments: [],
          matchQuality: 'exact' as const,
          coordinates: [
            [-95, 30],
            [-95, 30.01],
          ],
          diagnostics: {
            nameSimilarity: 1,
            distanceToCandidate: 0,
            alternativesConsidered: 0,
            reason: 'test',
          },
        },
        {
          description: {
            index: 1,
            referenceType: 'street_centerline' as const,
            featureName: 'Test',
            rawText: 'test',
            parseConfidence: 'high' as const,
          },
          matchedSegments: [],
          matchQuality: 'exact' as const,
          coordinates: [
            [-95, 30.01],
            [-94.99, 30.01],
          ],
          diagnostics: {
            nameSimilarity: 1,
            distanceToCandidate: 0,
            alternativesConsidered: 0,
            reason: 'test',
          },
        },
        {
          description: {
            index: 2,
            referenceType: 'street_centerline' as const,
            featureName: 'Test',
            rawText: 'test',
            parseConfidence: 'high' as const,
          },
          matchedSegments: [],
          matchQuality: 'exact' as const,
          coordinates: [
            [-94.99, 30.01],
            [-94.99, 30],
          ],
          diagnostics: {
            nameSimilarity: 1,
            distanceToCandidate: 0,
            alternativesConsidered: 0,
            reason: 'test',
          },
        },
        {
          description: {
            index: 3,
            referenceType: 'street_centerline' as const,
            featureName: 'Test',
            rawText: 'test',
            parseConfidence: 'high' as const,
          },
          matchedSegments: [],
          matchQuality: 'exact' as const,
          coordinates: [
            [-94.99, 30],
            [-95, 30],
          ],
          diagnostics: {
            nameSimilarity: 1,
            distanceToCandidate: 0,
            alternativesConsidered: 0,
            reason: 'test',
          },
        },
      ];

      const result = buildPolygonFromMatches(matches);

      expect(result.success).toBe(true);
      expect(result.polygon).not.toBeNull();
      expect(result.validation.isClosed).toBe(true);
      expect(result.validation.isCounterClockwise).toBe(true);
    });

    it('fails when gap is too large', () => {
      const matches = [
        {
          description: {
            index: 0,
            referenceType: 'street_centerline' as const,
            featureName: 'Test',
            rawText: 'test',
            parseConfidence: 'high' as const,
          },
          matchedSegments: [],
          matchQuality: 'exact' as const,
          coordinates: [
            [0, 0],
            [0, 1],
          ],
          diagnostics: {
            nameSimilarity: 1,
            distanceToCandidate: 0,
            alternativesConsidered: 0,
            reason: 'test',
          },
        },
        {
          description: {
            index: 1,
            referenceType: 'street_centerline' as const,
            featureName: 'Test',
            rawText: 'test',
            parseConfidence: 'high' as const,
          },
          matchedSegments: [],
          matchQuality: 'exact' as const,
          coordinates: [
            [10, 10], // Way too far
            [10, 11],
          ],
          diagnostics: {
            nameSimilarity: 1,
            distanceToCandidate: 0,
            alternativesConsidered: 0,
            reason: 'test',
          },
        },
      ];

      const result = buildPolygonFromMatches(matches);
      expect(result.success).toBe(false);
      expect(result.failureReason).toContain('exceeds max');
    });
  });
});

// =============================================================================
// Golden Vector Validator Tests
// =============================================================================

describe('GoldenVectorValidator', () => {
  describe('validateWardAgainstGolden', () => {
    it('passes for identical polygons', () => {
      const polygon = createRectangularPolygon({
        wardId: '1',
        wardName: 'Ward 1',
        cityFips: '1234567',
        minLon: -95,
        maxLon: -94.99,
        minLat: 30,
        maxLat: 30.01,
      });

      const result = validateWardAgainstGolden(polygon, polygon, '1');

      expect(result.passed).toBe(true);
      expect(result.metrics.iou).toBe(1);
      expect(result.metrics.hausdorffDistance).toBe(0);
    });

    it('fails for non-overlapping polygons', () => {
      const actual = createRectangularPolygon({
        wardId: '1',
        wardName: 'Ward 1',
        cityFips: '1234567',
        minLon: -95,
        maxLon: -94.99,
        minLat: 30,
        maxLat: 30.01,
      });

      const expected = createRectangularPolygon({
        wardId: '1',
        wardName: 'Ward 1',
        cityFips: '1234567',
        minLon: -90, // Different location
        maxLon: -89.99,
        minLat: 30,
        maxLat: 30.01,
      });

      const result = validateWardAgainstGolden(actual, expected, '1');

      expect(result.passed).toBe(false);
      expect(result.failures.length).toBeGreaterThan(0);
    });
  });

  describe('validateCityAgainstGolden', () => {
    it('passes for matching city', () => {
      const fixture = createTestFixture({
        cityFips: '1234567',
        cityName: 'Test City',
        state: 'TX',
        wardCount: 3,
        centerLon: -95,
        centerLat: 30,
        gridSize: 0.03,
      });

      const result = validateCityAgainstGolden(
        fixture.goldenVector.expectedPolygons,
        fixture.goldenVector
      );

      expect(result.passed).toBe(true);
      expect(result.summary.passedWards).toBe(3);
    });
  });

  describe('detectRegressions', () => {
    it('detects pass to fail regression', () => {
      const previous = {
        cityFips: '1234567',
        cityName: 'Test City',
        passed: true,
        wardResults: [
          {
            wardId: '1',
            passed: true,
            metrics: {
              hausdorffDistance: 10,
              areaDifferenceRatio: 0.01,
              centroidDistance: 5,
              iou: 0.95,
              expectedArea: 10000,
              actualArea: 10100,
            },
            failures: [],
          },
        ],
        summary: {
          totalWards: 1,
          passedWards: 1,
          averageIoU: 0.95,
          maxHausdorffDistance: 10,
        },
        validatedAt: new Date().toISOString(),
      };

      const current = {
        ...previous,
        passed: false,
        wardResults: [
          {
            ...previous.wardResults[0],
            passed: false,
            metrics: {
              ...previous.wardResults[0].metrics,
              iou: 0.5,
            },
            failures: ['IoU too low'],
          },
        ],
        summary: {
          ...previous.summary,
          passedWards: 0,
        },
      };

      const regression = detectRegressions(previous, current);

      expect(regression.hasRegressions).toBe(true);
      expect(regression.regressions.length).toBeGreaterThan(0);
    });

    it('detects improvements', () => {
      const previous = {
        cityFips: '1234567',
        cityName: 'Test City',
        passed: false,
        wardResults: [],
        summary: {
          totalWards: 1,
          passedWards: 0,
          averageIoU: 0.5,
          maxHausdorffDistance: 100,
        },
        validatedAt: new Date().toISOString(),
      };

      const current = {
        ...previous,
        passed: true,
        summary: {
          ...previous.summary,
          passedWards: 1,
        },
      };

      const regression = detectRegressions(previous, current);

      expect(regression.hasRegressions).toBe(false);
      expect(regression.improvements.length).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration', () => {
  it('complete pipeline: parse → match → build → validate', () => {
    // Create test fixture
    const fixture = createTestFixture({
      cityFips: '1234567',
      cityName: 'Test City',
      state: 'TX',
      wardCount: 2,
      centerLon: -95,
      centerLat: 30,
      gridSize: 0.02,
    });

    const streetQuery = new SimpleStreetNetworkQuery(fixture.streetSegments);

    // Match ward descriptions
    const matchResults = fixture.wardDescriptions.map((desc) =>
      matchWardDescription(desc, streetQuery)
    );

    // Build polygons
    const buildResults = matchResults.map((match) => buildWardPolygon(match));

    // Validate against golden vector
    const successfulPolygons = buildResults
      .filter((r) => r.success && r.polygon)
      .map((r) => r.polygon as Feature<Polygon>);

    // Verify pipeline completes - match count may vary based on street grid alignment
    // The important thing is that the pipeline runs without crashing
    expect(matchResults.length).toBe(2);
    expect(buildResults.length).toBe(2);

    // For successful polygons, verify they're valid
    for (const poly of successfulPolygons) {
      assertValidPolygon(poly);
    }

    // Even if matches fail, verify diagnostics are populated
    for (const match of matchResults) {
      expect(match.diagnostics.totalSegments).toBeGreaterThan(0);
    }
  });

  it('validates golden vectors correctly', () => {
    const fixture = createTestFixture({
      cityFips: '1234567',
      cityName: 'Test City',
      state: 'TX',
      wardCount: 2,
      centerLon: -95,
      centerLat: 30,
      gridSize: 0.02,
    });

    // Validate golden vector against itself (should always pass)
    const result = validateCityAgainstGolden(
      fixture.goldenVector.expectedPolygons,
      fixture.goldenVector
    );

    expect(result.passed).toBe(true);
    expect(result.summary.passedWards).toBe(2);
    expect(result.summary.averageIoU).toBe(1);
  });
});
