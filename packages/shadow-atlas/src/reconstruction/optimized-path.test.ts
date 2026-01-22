/**
 * Tests for optimized reconstruction path (pre-parsed segments)
 */

import { describe, it, expect } from 'vitest';
import {
  reconstructWard,
  reconstructWardFromParsed,
  reconstructCity,
  reconstructCityFromParsed,
  type WardLegalDescription,
  type SourceDocument,
} from './index.js';
import {
  createMockStreetGrid,
  createMockSourceDocument,
} from './test-utils.js';

describe('Optimized Reconstruction Path', () => {
  const source: SourceDocument = createMockSourceDocument({
    type: 'ordinance_text',
    source: 'test.pdf',
    title: 'Test Ward Ordinance',
  });

  const streetSegments = createMockStreetGrid({
    centerLat: 39.1,
    centerLon: -94.6,
    gridSize: 4,
    spacing: 0.01,
  });

  describe('reconstructWardFromParsed', () => {
    it('should accept pre-parsed description and skip parsing step', () => {
      // Pre-parsed ward description (simulating golden vector)
      const description: WardLegalDescription = {
        cityFips: '1234567',
        cityName: 'Test City',
        state: 'MO',
        wardId: '1',
        wardName: 'Ward 1',
        segments: [
          {
            index: 0,
            referenceType: 'street_centerline',
            featureName: 'Main Street',
            direction: 'north',
            rawText: 'north along Main Street',
            parseConfidence: 'high',
          },
          {
            index: 1,
            referenceType: 'street_centerline',
            featureName: 'First Avenue',
            direction: 'east',
            rawText: 'east along First Avenue',
            parseConfidence: 'high',
          },
          {
            index: 2,
            referenceType: 'street_centerline',
            featureName: 'Oak Street',
            direction: 'south',
            rawText: 'south along Oak Street',
            parseConfidence: 'high',
          },
          {
            index: 3,
            referenceType: 'street_centerline',
            featureName: 'Second Avenue',
            direction: 'west',
            rawText: 'west along Second Avenue',
            parseConfidence: 'high',
          },
        ],
        source,
      };

      const result = reconstructWardFromParsed(description, streetSegments);

      // Should run without error (success depends on street matching)
      expect(result.description).toBe(description); // Same reference

      // Should NOT have parseResult (that's the optimization!)
      expect('parseResult' in result).toBe(false);

      // Result structure should be correct
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('buildResult');
      expect(result).toHaveProperty('polygon');
      expect(result).toHaveProperty('failureReason');
    });

    it('should fail gracefully when segments are empty', () => {
      const emptyDescription: WardLegalDescription = {
        cityFips: '1234567',
        cityName: 'Test City',
        state: 'MO',
        wardId: '1',
        wardName: 'Ward 1',
        segments: [], // Empty!
        source,
      };

      const result = reconstructWardFromParsed(emptyDescription, streetSegments);

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('No segments in legal description');
      expect(result.polygon).toBe(null);
    });

    it('should freeze all result objects (immutability)', () => {
      const description: WardLegalDescription = {
        cityFips: '1234567',
        cityName: 'Test City',
        state: 'MO',
        wardId: '1',
        wardName: 'Ward 1',
        segments: [
          {
            index: 0,
            referenceType: 'street_centerline',
            featureName: 'Main Street',
            rawText: 'north along Main Street',
            parseConfidence: 'high',
          },
        ],
        source,
      };

      const result = reconstructWardFromParsed(description, streetSegments);

      // Result should be frozen
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.buildResult)).toBe(true);
      expect(Object.isFrozen(result.buildResult.repairs)).toBe(true);
      expect(Object.isFrozen(result.buildResult.validation)).toBe(true);
    });
  });

  describe('reconstructCityFromParsed', () => {
    it('should reconstruct multiple wards from pre-parsed descriptions', () => {
      const descriptions: readonly WardLegalDescription[] = [
        {
          cityFips: '1234567',
          cityName: 'Test City',
          state: 'MO',
          wardId: '1',
          wardName: 'Ward 1',
          segments: [
            {
              index: 0,
              referenceType: 'street_centerline',
              featureName: 'Main Street',
              rawText: 'along Main Street',
              parseConfidence: 'high',
            },
          ],
          source,
        },
        {
          cityFips: '1234567',
          cityName: 'Test City',
          state: 'MO',
          wardId: '2',
          wardName: 'Ward 2',
          segments: [
            {
              index: 0,
              referenceType: 'street_centerline',
              featureName: 'Oak Street',
              rawText: 'along Oak Street',
              parseConfidence: 'high',
            },
          ],
          source,
        },
      ];

      const result = reconstructCityFromParsed(descriptions, streetSegments);

      expect(result.results.length).toBe(2);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.results)).toBe(true);
      expect(Object.isFrozen(result.polygons)).toBe(true);
    });
  });

  describe('Comparison: Regular vs Optimized Path', () => {
    it('should skip parsing step in optimized path', () => {
      // Pre-parsed description
      const preParsedDescription: WardLegalDescription = {
        cityFips: '1234567',
        cityName: 'Test City',
        state: 'MO',
        wardId: '1',
        wardName: 'Ward 1',
        segments: [
          {
            index: 0,
            referenceType: 'street_centerline',
            featureName: 'Main Street',
            direction: 'north',
            rawText: 'north along Main Street',
            parseConfidence: 'high',
          },
          {
            index: 1,
            referenceType: 'street_centerline',
            featureName: 'First Avenue',
            direction: 'east',
            rawText: 'east along First Avenue',
            parseConfidence: 'high',
          },
          {
            index: 2,
            referenceType: 'street_centerline',
            featureName: 'Oak Street',
            direction: 'south',
            rawText: 'south along Oak Street',
            parseConfidence: 'high',
          },
          {
            index: 3,
            referenceType: 'street_centerline',
            featureName: 'Second Avenue',
            direction: 'west',
            rawText: 'west along Second Avenue',
            parseConfidence: 'high',
          },
        ],
        source,
      };

      // Regular path (with text parsing)
      const regularInput = {
        cityFips: '1234567',
        cityName: 'Test City',
        state: 'MO',
        wardId: '1',
        wardName: 'Ward 1',
        descriptionText: preParsedDescription.segments.map(s => s.rawText).join('; '),
        source,
      };

      const regularResult = reconstructWard(regularInput, streetSegments);
      const optimizedResult = reconstructWardFromParsed(preParsedDescription, streetSegments);

      // Regular path includes parseResult
      expect('parseResult' in regularResult).toBe(true);

      // Optimized path skips parseResult (the key optimization!)
      expect('parseResult' in optimizedResult).toBe(false);

      // Both have same structure otherwise
      expect(regularResult).toHaveProperty('success');
      expect(regularResult).toHaveProperty('buildResult');
      expect(optimizedResult).toHaveProperty('success');
      expect(optimizedResult).toHaveProperty('buildResult');
    });
  });
});
