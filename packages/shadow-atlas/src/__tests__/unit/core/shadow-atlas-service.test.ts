/**
 * ShadowAtlasService Tests
 *
 * Tests for the unified ShadowAtlas facade covering:
 * - Full extraction pipeline
 * - Incremental updates
 * - Resume from failure
 * - Change detection
 * - Health checks
 * - Error handling
 *
 * TYPE SAFETY: All test expectations are strongly typed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Polygon, MultiPolygon, Feature } from 'geojson';
import {
  createMockExtractor,
  createMockValidator,
  createMockProgressCallback,
} from '../../utils/shadow-atlas-mocks.js';

// Mock TIGER boundary provider BEFORE importing service
vi.mock('../../../providers/tiger-boundary-provider.js', () => ({
  TIGERBoundaryProvider: vi.fn().mockImplementation(() => ({
    downloadLayer: vi.fn().mockResolvedValue([{
      data: Buffer.from(JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [[[-90, 43], [-89, 43], [-89, 44], [-90, 44], [-90, 43]]] },
            properties: { GEOID: '5501', NAMELSAD: 'Congressional District 1' }
          }
        ]
      })),
      url: 'https://mock.tiger.gov/cd.zip',
      format: 'geojson',
      metadata: { featureCount: 1, layer: 'cd', vintage: 2024 }
    }]),
    transform: vi.fn().mockResolvedValue([
      {
        id: '5501',
        name: 'Congressional District 1',
        geometry: { type: 'Polygon', coordinates: [[[-90, 43], [-89, 43], [-89, 44], [-90, 44], [-90, 43]]] },
        properties: { GEOID: '5501', NAMELSAD: 'Congressional District 1' }
      }
    ]),
    healthCheck: vi.fn().mockResolvedValue({ available: true, latencyMs: 10 })
  }))
}));

// Mock TIGER validator
vi.mock('../../../validators/tiger-validator.js', () => ({
  TIGERValidator: vi.fn().mockImplementation(() => ({
    validate: vi.fn().mockReturnValue({
      layer: 'cd',
      qualityScore: 95,
      completeness: { valid: true, expected: 8, actual: 8, percentage: 100, missingGEOIDs: [], extraGEOIDs: [], summary: '8/8 boundaries present (100%)' },
      topology: { valid: true, selfIntersections: 0, overlaps: [], gaps: 0, invalidGeometries: [], summary: 'All geometries valid' },
      coordinates: { valid: true, outOfRangeCount: 0, nullCoordinates: [], suspiciousLocations: [], summary: 'All coordinates valid' }
    })
  }))
}));

// Mock state batch extractor
vi.mock('../../../providers/state-batch-extractor.js', () => ({
  StateBatchExtractor: vi.fn().mockImplementation(() => ({
    extractState: vi.fn().mockResolvedValue({
      state: 'WI',
      stateFips: '55',
      layers: [
        {
          layer: 'congressional',
          boundaries: [
            {
              id: '5501',
              name: 'Congressional District 1',
              type: 'congressional',
              geometry: { type: 'Polygon', coordinates: [[[-90, 43], [-89, 43], [-89, 44], [-90, 44], [-90, 43]]] },
              properties: { GEOID: '5501' }
            }
          ],
          metadata: { totalBoundaries: 1, sources: ['TIGER/Line'], extractedAt: new Date() }
        }
      ],
      metadata: { totalBoundaries: 1, sources: ['TIGER/Line'], extractedAt: new Date() }
    }),
    healthCheck: vi.fn().mockResolvedValue({ available: true, latencyMs: 10 })
  }))
}));

import { ShadowAtlasService } from '../../../core/shadow-atlas-service.js';
import { createTestService } from '../../../core/factory.js';

describe('ShadowAtlasService', () => {
  let service: ShadowAtlasService;

  beforeEach(() => {
    service = createTestService();
  });

  afterEach(() => {
    service.close();
  });

  describe('extract', () => {
    // R50-A1: extract() is now deprecated — it always throws directing users to buildAtlas()
    it('should throw deprecation error (R50-A1: dead code path removed)', async () => {
      await expect(
        service.extract({ type: 'state', states: ['WI'] })
      ).rejects.toThrow('DEPRECATED');
    });

    it('should mention buildAtlas() in deprecation message', async () => {
      await expect(
        service.extract({ type: 'state', states: ['WI'] })
      ).rejects.toThrow('buildAtlas()');
    });
  });

  describe('incrementalUpdate', () => {
    it.skip('should detect no changes when data unchanged (DEPRECATED)', async () => {
      // DEPRECATED: incrementalUpdate() has been removed
      // This test is kept for documentation purposes
    });

    it.skip('should detect changes when new state added (DEPRECATED)', async () => {
      // DEPRECATED: incrementalUpdate() has been removed
      // Use buildAtlas() instead
    });

    it('should throw error for non-existent snapshot', async () => {
      await expect(
        service.incrementalUpdate('non-existent-snapshot', { states: ['WI'] })
      ).rejects.toThrow('DEPRECATED');
    });
  });

  describe('detectChanges', () => {
    it('should detect changes in scope', async () => {
      const changes = await service.detectChanges({
        type: 'state',
        states: ['WI'],
      });

      expect(changes).toBeDefined();
      expect(changes.hasChanges).toBeDefined();
      expect(changes.checkMethod).toBeOneOf(['etag', 'last-modified', 'count', 'hash']);
      expect(changes.confidence).toBeGreaterThanOrEqual(0);
      expect(changes.confidence).toBeLessThanOrEqual(1);
    });

    it('should return all regions for global scope', async () => {
      const changes = await service.detectChanges({
        type: 'global',
      });

      expect(changes.unchangedRegions).toBeDefined();
    });
  });

  describe('resumeExtraction', () => {
    // R50-A1: resumeExtraction() is now deprecated — it always throws directing users to buildAtlas()
    it('should throw deprecation error (R50-A1: dead code path removed)', async () => {
      await expect(
        service.resumeExtraction('any-job-id')
      ).rejects.toThrow('DEPRECATED');
    });

    it('should mention buildAtlas() in deprecation message', async () => {
      await expect(
        service.resumeExtraction('any-job-id')
      ).rejects.toThrow('buildAtlas()');
    });
  });

  describe('getValidationResults', () => {
    it('should return null for non-existent snapshot', async () => {
      const results = await service.getValidationResults('non-existent-snapshot');
      expect(results).toBeNull();
    });

    it.skip('should return validation results for committed snapshot (DEPRECATED: extract() removed, R50-A1)', async () => {
      // extract() now throws DEPRECATED error — this test path is no longer reachable.
      // Validation results are tested via buildAtlas() in shadow-atlas-service.build-atlas.test.ts.
    });
  });

  describe('healthCheck', () => {
    it('should report healthy providers', async () => {
      const health = await service.healthCheck();

      expect(health.healthy).toBeDefined();
      expect(health.providers).toBeDefined();
      expect(health.providers.length).toBeGreaterThan(0);
      expect(health.checkedAt).toBeInstanceOf(Date);
    });

    it('should include provider latency', async () => {
      const health = await service.healthCheck();

      for (const provider of health.providers) {
        expect(provider.name).toBeDefined();
        expect(provider.available).toBeDefined();
        expect(provider.latencyMs).toBeGreaterThanOrEqual(0);
        expect(provider.issues).toBeDefined();
      }
    });
  });

  describe('validateTIGER', () => {
    it('should validate single layer with default options', async () => {
      const result = await service.validateTIGER({
        layers: ['cd'],
      });

      expect(result).toBeDefined();
      expect(result.state).toBe('all');
      expect(result.stateName).toBe('National');
      expect(result.year).toBeGreaterThan(2020);
      expect(result.layers).toHaveLength(1);
      expect(result.layers[0].layer).toBe('cd');
      expect(result.averageQualityScore).toBeGreaterThanOrEqual(0);
      expect(result.averageQualityScore).toBeLessThanOrEqual(100);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.validatedAt).toBeInstanceOf(Date);
    }, 60000); // Extended timeout for network requests

    it('should validate all layers', async () => {
      const result = await service.validateTIGER({
        layers: ['cd', 'sldu', 'sldl', 'county'],
        qualityThreshold: 80,
      });

      expect(result.layers).toHaveLength(4);
      expect(result.layers.map(l => l.layer)).toEqual(['cd', 'sldu', 'sldl', 'county']);
      expect(result.qualityThreshold).toBe(80);

      for (const layer of result.layers) {
        expect(layer.qualityScore).toBeGreaterThanOrEqual(0);
        expect(layer.qualityScore).toBeLessThanOrEqual(100);
        expect(layer.completeness).toBeDefined();
        expect(layer.topology).toBeDefined();
        expect(layer.coordinates).toBeDefined();
        expect(layer.summary).toBeDefined();
      }
    }, 120000); // Extended timeout for multiple layers

    it('should validate specific state', async () => {
      const result = await service.validateTIGER({
        state: '55', // Wisconsin FIPS code
        layers: ['cd'],
      });

      expect(result.state).toBe('55');
      expect(result.stateName).toContain('Wisconsin');
      expect(result.layers).toHaveLength(1);
    }, 60000);

    it('should use custom year', async () => {
      const result = await service.validateTIGER({
        layers: ['cd'],
        year: 2023,
      });

      expect(result.year).toBe(2023);
    }, 60000);

    it('should apply quality threshold', async () => {
      const result = await service.validateTIGER({
        layers: ['cd'],
        qualityThreshold: 95,
      });

      expect(result.qualityThreshold).toBe(95);
      expect(result.overallValid).toBeDefined();

      // If below threshold, overallValid should be false
      if (result.averageQualityScore < 95) {
        expect(result.overallValid).toBe(false);
        expect(result.summary).toContain('FAIL');
      } else {
        expect(result.overallValid).toBe(true);
        expect(result.summary).toContain('PASS');
      }
    }, 60000);

    it('should provide detailed completeness results', async () => {
      const result = await service.validateTIGER({
        layers: ['cd'],
      });

      const cdLayer = result.layers[0];
      expect(cdLayer.completeness.expected).toBeGreaterThan(0);
      expect(cdLayer.completeness.actual).toBeGreaterThanOrEqual(0);
      expect(cdLayer.completeness.percentage).toBeGreaterThanOrEqual(0);
      expect(cdLayer.completeness.percentage).toBeLessThanOrEqual(100);
      expect(cdLayer.completeness.missingGEOIDs).toBeDefined();
      expect(cdLayer.completeness.extraGEOIDs).toBeDefined();
      expect(cdLayer.completeness.summary).toBeDefined();
    }, 60000);

    it('should provide topology validation results', async () => {
      const result = await service.validateTIGER({
        layers: ['cd'],
      });

      const cdLayer = result.layers[0];
      expect(cdLayer.topology.selfIntersections).toBeGreaterThanOrEqual(0);
      expect(cdLayer.topology.overlaps).toBeDefined();
      expect(cdLayer.topology.gaps).toBeGreaterThanOrEqual(0);
      expect(cdLayer.topology.invalidGeometries).toBeDefined();
      expect(cdLayer.topology.summary).toBeDefined();
    }, 60000);

    it('should provide coordinate validation results', async () => {
      const result = await service.validateTIGER({
        layers: ['cd'],
      });

      const cdLayer = result.layers[0];
      expect(cdLayer.coordinates.outOfRangeCount).toBeGreaterThanOrEqual(0);
      expect(cdLayer.coordinates.nullCoordinates).toBeDefined();
      expect(cdLayer.coordinates.suspiciousLocations).toBeDefined();
      expect(cdLayer.coordinates.summary).toBeDefined();
    }, 60000);

    it('should handle validation errors gracefully', async () => {
      // Test with invalid state FIPS code
      const result = await service.validateTIGER({
        state: '99', // Invalid FIPS code
        layers: ['cd'],
      });

      // Should not throw, but may have failed layers
      expect(result).toBeDefined();
      expect(result.layers).toHaveLength(1);

      // Result might be valid or invalid depending on provider behavior
      // but should not crash
    }, 60000);
  });
});
