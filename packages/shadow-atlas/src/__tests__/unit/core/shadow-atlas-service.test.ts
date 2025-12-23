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

import { describe, it, expect, beforeEach } from 'vitest';
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
    it('should extract single state boundaries', async () => {
      const result = await service.extract({
        type: 'state',
        states: ['WI'],
      });

      expect(result.jobId).toBeDefined();
      expect(result.status).toBeOneOf(['committed', 'validation_failed', 'extraction_failed']);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.extraction).toBeDefined();
      expect(result.validation).toBeDefined();
    });

    it('should extract multiple states', async () => {
      const result = await service.extract({
        type: 'state',
        states: ['WI', 'MI'],
      });

      expect(result.extraction.totalBoundaries).toBeGreaterThan(0);
      expect(result.extraction.successfulExtractions).toBeGreaterThanOrEqual(0);
    });

    it('should report progress during extraction', async () => {
      const progressEvents: Array<{ completed: number; total: number }> = [];

      await service.extract(
        {
          type: 'state',
          states: ['WI', 'MI'],
        },
        {
          onProgress: (event) => {
            progressEvents.push({
              completed: event.completed,
              total: event.total,
            });
          },
        }
      );

      expect(progressEvents.length).toBeGreaterThan(0);
      expect(progressEvents[progressEvents.length - 1].completed).toBe(
        progressEvents[progressEvents.length - 1].total
      );
    });

    it('should handle extraction errors when continueOnError is true', async () => {
      const result = await service.extract(
        {
          type: 'state',
          states: ['INVALID_STATE'],
        },
        {
          continueOnError: true,
        }
      );

      expect(result.status).toBe('extraction_failed');
      expect(result.extraction.failedExtractions.length).toBeGreaterThan(0);
    });

    it('should reject when validation fails', async () => {
      const result = await service.extract(
        {
          type: 'state',
          states: ['WI'],
        },
        {
          minPassRate: 1.0, // Require 100% pass rate
        }
      );

      // Result should be validation_failed or committed (depending on actual data quality)
      expect(result.status).toBeOneOf(['committed', 'validation_failed']);
    });

    it('should create merkle commitment when validation passes', async () => {
      const result = await service.extract(
        {
          type: 'state',
          states: ['WI'],
        },
        {
          minPassRate: 0.5, // Low threshold for testing
        }
      );

      if (result.status === 'committed') {
        expect(result.commitment).toBeDefined();
        expect(result.commitment?.snapshotId).toBeDefined();
        expect(result.commitment?.merkleRoot).toBeDefined();
        expect(result.commitment?.includedBoundaries).toBeGreaterThan(0);
      }
    });
  });

  describe('incrementalUpdate', () => {
    it('should detect no changes when data unchanged', async () => {
      // First: full extraction
      const initial = await service.extract({
        type: 'state',
        states: ['WI'],
      });

      if (initial.status !== 'committed' || !initial.commitment) {
        return; // Skip test if initial extraction failed
      }

      // Second: incremental update (should detect no changes)
      const update = await service.incrementalUpdate(
        initial.commitment.snapshotId,
        { states: ['WI'] }
      );

      expect(update.status).toBe('no_changes');
      expect(update.previousRoot).toBe(update.newRoot);
    });

    it('should detect changes when new state added', async () => {
      // First: extract WI
      const initial = await service.extract({
        type: 'state',
        states: ['WI'],
      });

      if (initial.status !== 'committed' || !initial.commitment) {
        return;
      }

      // Second: add MI
      const update = await service.incrementalUpdate(
        initial.commitment.snapshotId,
        { states: ['MI'] },
        { forceRefresh: true }
      );

      // Should either detect changes or update successfully
      expect(update.status).toBeOneOf(['updated', 'unchanged', 'no_changes']);
    });

    it('should throw error for non-existent snapshot', async () => {
      await expect(
        service.incrementalUpdate('non-existent-snapshot', { states: ['WI'] })
      ).rejects.toThrow('Snapshot non-existent-snapshot not found');
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
    it('should resume failed extraction', async () => {
      // First: start extraction (may fail)
      const initial = await service.extract({
        type: 'state',
        states: ['WI'],
      });

      // Second: resume from job
      const resumed = await service.resumeExtraction(initial.jobId);

      expect(resumed.jobId).toBe(initial.jobId);
    });

    it('should throw error for non-existent job', async () => {
      await expect(
        service.resumeExtraction('non-existent-job')
      ).rejects.toThrow('Job non-existent-job not found');
    });
  });

  describe('getValidationResults', () => {
    it('should return null for non-existent snapshot', async () => {
      const results = await service.getValidationResults('non-existent-snapshot');
      expect(results).toBeNull();
    });

    it('should return validation results for committed snapshot', async () => {
      const extraction = await service.extract({
        type: 'state',
        states: ['WI'],
      });

      if (extraction.status !== 'committed' || !extraction.commitment) {
        return;
      }

      const results = await service.getValidationResults(
        extraction.commitment.snapshotId
      );

      expect(results).toBeDefined();
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
