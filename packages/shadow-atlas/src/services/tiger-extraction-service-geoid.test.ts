/**
 * TIGER Extraction Service GEOID Validation Tests
 *
 * Tests integration of GEOID completeness checking into extraction workflow.
 */

import { describe, it, expect, vi } from 'vitest';
import { TIGERExtractionService } from './tiger-extraction-service.js';
import type { TIGERLayerResult } from './tiger-extraction-service.js';
import { getExpectedCongressionalGEOIDs } from '../registry/expected-geoids.js';

describe('TIGERExtractionService - GEOID Validation', () => {
  describe('validate() with GEOID completeness checking', () => {
    it('validates complete congressional district extraction', async () => {
      const service = new TIGERExtractionService();

      // Mock complete California congressional district data
      const expectedGEOIDs = getExpectedCongressionalGEOIDs('06');
      const mockFeatures = expectedGEOIDs.map((geoid) => ({
        id: geoid,
        name: `District ${geoid.slice(2)}`,
        level: 'district' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
        },
        properties: {
          type: 'congressional_district',
          jurisdiction: 'federal',
          stateFips: '06',
        },
        source: {
          provider: 'Census TIGER',
          url: 'https://tigerweb.geo.census.gov',
          version: '2024',
          license: 'Public Domain',
          updatedAt: new Date().toISOString(),
          checksum: '',
          authorityLevel: 'federal-mandate' as const,
          legalStatus: 'binding' as const,
          collectionMethod: 'census-tiger' as const,
          lastVerified: new Date().toISOString(),
          verifiedBy: 'automated',
          topologyValidated: false,
          geometryRepaired: false,
          coordinateSystem: 'EPSG:4326',
          updateMonitoring: 'api-polling' as const,
        },
      }));

      const mockResult: TIGERLayerResult = {
        layer: 'congressional',
        features: mockFeatures,
        metadata: {
          source: 'Census TIGER/Line 2024',
          retrievedAt: new Date().toISOString(),
          featureCount: mockFeatures.length,
          expectedCount: 52,
          isComplete: true,
          validation: {
            isValid: true,
            expected: 52,
            actual: 52,
            difference: 0,
            confidence: 1.0,
          },
        },
      };

      const validation = await service.validate(mockResult);

      expect(validation.valid).toBe(true);
      expect(validation.expected).toBe(52);
      expect(validation.actual).toBe(52);
      expect(validation.missingGEOIDs).toEqual([]);
      expect(validation.extraGEOIDs).toEqual([]);
      expect(validation.summary).toContain('✅ Valid');
    });

    it('detects missing congressional districts', async () => {
      const service = new TIGERExtractionService();

      // Mock incomplete data (missing district 12)
      const expectedGEOIDs = getExpectedCongressionalGEOIDs('06');
      const incompleteGEOIDs = expectedGEOIDs.filter((geoid) => geoid !== '0612');

      const mockFeatures = incompleteGEOIDs.map((geoid) => ({
        id: geoid,
        name: `District ${geoid.slice(2)}`,
        level: 'district' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
        },
        properties: {
          type: 'congressional_district',
          jurisdiction: 'federal',
          stateFips: '06',
        },
        source: {
          provider: 'Census TIGER',
          url: 'https://tigerweb.geo.census.gov',
          version: '2024',
          license: 'Public Domain',
          updatedAt: new Date().toISOString(),
          checksum: '',
          authorityLevel: 'federal-mandate' as const,
          legalStatus: 'binding' as const,
          collectionMethod: 'census-tiger' as const,
          lastVerified: new Date().toISOString(),
          verifiedBy: 'automated',
          topologyValidated: false,
          geometryRepaired: false,
          coordinateSystem: 'EPSG:4326',
          updateMonitoring: 'api-polling' as const,
        },
      }));

      const mockResult: TIGERLayerResult = {
        layer: 'congressional',
        features: mockFeatures,
        metadata: {
          source: 'Census TIGER/Line 2024',
          retrievedAt: new Date().toISOString(),
          featureCount: mockFeatures.length,
          expectedCount: 52,
          isComplete: false,
          validation: {
            isValid: false,
            expected: 52,
            actual: 51,
            difference: -1,
            confidence: 0.7,
          },
        },
      };

      const validation = await service.validate(mockResult);

      expect(validation.valid).toBe(false);
      expect(validation.expected).toBe(52);
      expect(validation.actual).toBe(51);
      expect(validation.missingGEOIDs).toContain('0612');
      expect(validation.missingGEOIDs).toHaveLength(1);
      expect(validation.summary).toContain('❌ Invalid');
      expect(validation.summary).toContain('1 missing GEOIDs');
    });

    it('detects unexpected congressional districts', async () => {
      const service = new TIGERExtractionService();

      // Mock data with extra districts
      const expectedGEOIDs = getExpectedCongressionalGEOIDs('06');
      const extraGEOIDs = [...expectedGEOIDs, '0699']; // Fake district

      const mockFeatures = extraGEOIDs.map((geoid) => ({
        id: geoid,
        name: `District ${geoid.slice(2)}`,
        level: 'district' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
        },
        properties: {
          type: 'congressional_district',
          jurisdiction: 'federal',
          stateFips: '06',
        },
        source: {
          provider: 'Census TIGER',
          url: 'https://tigerweb.geo.census.gov',
          version: '2024',
          license: 'Public Domain',
          updatedAt: new Date().toISOString(),
          checksum: '',
          authorityLevel: 'federal-mandate' as const,
          legalStatus: 'binding' as const,
          collectionMethod: 'census-tiger' as const,
          lastVerified: new Date().toISOString(),
          verifiedBy: 'automated',
          topologyValidated: false,
          geometryRepaired: false,
          coordinateSystem: 'EPSG:4326',
          updateMonitoring: 'api-polling' as const,
        },
      }));

      const mockResult: TIGERLayerResult = {
        layer: 'congressional',
        features: mockFeatures,
        metadata: {
          source: 'Census TIGER/Line 2024',
          retrievedAt: new Date().toISOString(),
          featureCount: mockFeatures.length,
          expectedCount: 52,
          isComplete: false,
          validation: {
            isValid: false,
            expected: 52,
            actual: 53,
            difference: 1,
            confidence: 0.7,
          },
        },
      };

      const validation = await service.validate(mockResult);

      expect(validation.valid).toBe(false);
      expect(validation.extraGEOIDs).toContain('0699');
      expect(validation.extraGEOIDs).toHaveLength(1);
      expect(validation.summary).toContain('❌ Invalid');
      expect(validation.summary).toContain('1 unexpected GEOIDs');
    });

    it('validates layers without GEOID support', async () => {
      const service = new TIGERExtractionService();

      // School districts don't have GEOID validation yet
      const mockFeatures = [
        {
          id: 'UNSD001',
          name: 'Test School District',
          level: 'district' as const,
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
          },
          properties: {
            type: 'school_district',
            jurisdiction: 'local',
            stateFips: '06',
          },
          source: {
            provider: 'Census TIGER',
            url: 'https://tigerweb.geo.census.gov',
            version: '2024',
            license: 'Public Domain',
            updatedAt: new Date().toISOString(),
            checksum: '',
            authorityLevel: 'state-mandate' as const,
            legalStatus: 'binding' as const,
            collectionMethod: 'census-tiger' as const,
            lastVerified: new Date().toISOString(),
            verifiedBy: 'automated',
            topologyValidated: false,
            geometryRepaired: false,
            coordinateSystem: 'EPSG:4326',
            updateMonitoring: 'api-polling' as const,
          },
        },
      ];

      const mockResult: TIGERLayerResult = {
        layer: 'school_unified',
        features: mockFeatures,
        metadata: {
          source: 'Census TIGER/Line 2024',
          retrievedAt: new Date().toISOString(),
          featureCount: 1,
          expectedCount: 0,
          isComplete: true,
          validation: {
            isValid: true,
            expected: null,
            actual: 1,
            difference: 0,
            confidence: 0.0,
          },
        },
      };

      const validation = await service.validate(mockResult);

      // Should still validate (count-only, no GEOID validation)
      expect(validation.missingGEOIDs).toEqual([]);
      expect(validation.extraGEOIDs).toEqual([]);
    });
  });
});
