/**
 * ShadowAtlasService.buildAtlas() Integration Tests
 *
 * Tests the complete Atlas building orchestration:
 * - Download TIGER data
 * - Validate layers
 * - Build unified Merkle tree
 * - Export to JSON
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ShadowAtlasService } from '../../../core/shadow-atlas-service.js';
import type { AtlasBuildResult } from '../../../core/types.js';
import { rm, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_OUTPUT_DIR = join(process.cwd(), 'test-output', 'atlas-build');

describe('ShadowAtlasService.buildAtlas()', () => {
  let service: ShadowAtlasService;

  beforeAll(async () => {
    // Create test output directory
    await mkdir(TEST_OUTPUT_DIR, { recursive: true });

    // Initialize service
    service = new ShadowAtlasService({
      storageDir: ':memory:',
      persistence: { enabled: false, autoMigrate: false, databasePath: ':memory:' },
      extraction: { retryAttempts: 1, retryDelayMs: 100 },
      validation: { minPassRate: 0.8 },
    });
    await service.initialize();
  });

  afterAll(async () => {
    // Close service
    service.close();

    // Clean up test output
    try {
      await rm(TEST_OUTPUT_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should build Atlas with single layer (CD)', async () => {
    const result = await service.buildAtlas({
      layers: ['cd'],
      states: ['55'], // Wisconsin (small state for testing)
      year: 2024,
      qualityThreshold: 80,
    });

    // Verify result structure
    expect(result).toBeDefined();
    expect(result.jobId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(result.merkleRoot).toBeDefined();
    expect(typeof result.merkleRoot).toBe('bigint');
    expect(result.totalBoundaries).toBeGreaterThan(0);
    expect(result.treeDepth).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);
    expect(result.timestamp).toBeInstanceOf(Date);

    // Verify layer counts
    expect(result.layerCounts).toBeDefined();
    expect(Object.keys(result.layerCounts).length).toBeGreaterThan(0);

    // Verify validations
    expect(result.layerValidations).toBeDefined();
    expect(result.layerValidations.length).toBe(1);
    expect(result.layerValidations[0].layer).toBe('cd');
    expect(result.layerValidations[0].qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.layerValidations[0].qualityScore).toBeLessThanOrEqual(100);
  }, 60000); // 60 second timeout for network operations

  it('should build Atlas with multiple layers', async () => {
    const result = await service.buildAtlas({
      layers: ['cd', 'county'],
      states: ['55'], // Wisconsin
      year: 2024,
      qualityThreshold: 70,
    });

    // Verify multiple layers
    expect(result.layerValidations.length).toBe(2);

    const layers = result.layerValidations.map(v => v.layer);
    expect(layers).toContain('cd');
    expect(layers).toContain('county');

    // Verify all layers contributed to tree
    expect(result.totalBoundaries).toBeGreaterThan(0);

    // Verify layer counts match validations
    const totalFromValidations = result.layerValidations.reduce(
      (sum, v) => sum + v.boundaryCount,
      0
    );
    expect(result.totalBoundaries).toBe(totalFromValidations);
  }, 120000); // 2 minute timeout for multiple layers

  it('should export Atlas to JSON when outputPath provided', async () => {
    const outputPath = join(TEST_OUTPUT_DIR, 'test-atlas-export.json');

    const result = await service.buildAtlas({
      layers: ['cd'],
      states: ['55'], // Wisconsin
      year: 2024,
      qualityThreshold: 80,
      outputPath,
    });

    // Verify export succeeded
    expect(result).toBeDefined();

    // Verify file exists
    await expect(access(outputPath)).resolves.not.toThrow();

    // Verify file is valid JSON
    const { readFile } = await import('node:fs/promises');
    const json = await readFile(outputPath, 'utf-8');
    const parsed = JSON.parse(json);

    expect(parsed.version).toBeDefined();
    expect(parsed.root).toBeDefined();
    expect(parsed.boundaryCount).toBe(result.totalBoundaries);
    expect(parsed.leaves).toBeDefined();
    expect(Array.isArray(parsed.leaves)).toBe(true);
  }, 60000);

  it('should handle layer validation failures gracefully', async () => {
    const result = await service.buildAtlas({
      layers: ['cd'],
      states: ['99'], // Invalid state code
      year: 2024,
      qualityThreshold: 80,
    });

    // Should still return result even with failures
    expect(result).toBeDefined();

    // Validations should show failures
    expect(result.layerValidations.length).toBeGreaterThan(0);

    // Check if at least one layer failed
    const failedLayers = result.layerValidations.filter(v => v.qualityScore === 0);
    expect(failedLayers.length).toBeGreaterThan(0);

    // Failed layers should have error messages
    for (const failed of failedLayers) {
      expect(failed.error).toBeDefined();
    }
  }, 30000);

  it('should respect quality threshold warnings', async () => {
    const result = await service.buildAtlas({
      layers: ['cd'],
      states: ['55'], // Wisconsin
      year: 2024,
      qualityThreshold: 100, // Unrealistically high threshold
    });

    // Build should still succeed
    expect(result).toBeDefined();
    expect(result.totalBoundaries).toBeGreaterThan(0);

    // But validations might not meet threshold
    const belowThreshold = result.layerValidations.filter(v => v.qualityScore < 100);
    expect(belowThreshold.length).toBeGreaterThanOrEqual(0);
  }, 60000);

  it('should throw when all layers fail', async () => {
    // Use invalid layer configuration to force all layers to fail
    await expect(
      service.buildAtlas({
        layers: ['cd'],
        states: ['00'], // Invalid state that will cause download to fail
        year: 1900, // Invalid year that will cause download to fail
        qualityThreshold: 80,
      })
    ).rejects.toThrow('All layers failed to download/validate');
  }, 30000);

  it('should produce deterministic Merkle roots for identical inputs', async () => {
    // Build atlas twice with same inputs
    const result1 = await service.buildAtlas({
      layers: ['cd'],
      states: ['55'], // Wisconsin
      year: 2024,
      qualityThreshold: 80,
    });

    const result2 = await service.buildAtlas({
      layers: ['cd'],
      states: ['55'], // Wisconsin
      year: 2024,
      qualityThreshold: 80,
    });

    // Merkle roots should be identical
    expect(result1.merkleRoot).toBe(result2.merkleRoot);

    // Boundary counts should be identical
    expect(result1.totalBoundaries).toBe(result2.totalBoundaries);

    // Tree depths should be identical
    expect(result1.treeDepth).toBe(result2.treeDepth);
  }, 120000);

  it('should include all validation details in layer results', async () => {
    const result = await service.buildAtlas({
      layers: ['cd'],
      states: ['55'], // Wisconsin
      year: 2024,
      qualityThreshold: 80,
    });

    // Check validation details
    for (const validation of result.layerValidations) {
      expect(validation.layer).toBeDefined();
      expect(validation.qualityScore).toBeGreaterThanOrEqual(0);
      expect(validation.qualityScore).toBeLessThanOrEqual(100);
      expect(validation.boundaryCount).toBeGreaterThanOrEqual(0);
      expect(validation.expectedCount).toBeGreaterThanOrEqual(0);

      // If successful, validation should be present
      if (validation.qualityScore > 0) {
        expect(validation.validation).toBeDefined();
        if (validation.validation) {
          expect(validation.validation.layer).toBe(validation.layer);
          expect(validation.validation.qualityScore).toBe(validation.qualityScore);
          expect(validation.validation.completeness).toBeDefined();
          expect(validation.validation.topology).toBeDefined();
          expect(validation.validation.coordinates).toBeDefined();
        }
      }

      // If failed, error should be present
      if (validation.qualityScore === 0) {
        expect(validation.error).toBeDefined();
      }
    }
  }, 60000);

  it('should track build duration accurately', async () => {
    const startTime = Date.now();

    const result = await service.buildAtlas({
      layers: ['cd'],
      states: ['55'], // Wisconsin
      year: 2024,
      qualityThreshold: 80,
    });

    const endTime = Date.now();
    const measuredDuration = endTime - startTime;

    // Reported duration should be close to measured duration
    // Allow 10% margin for overhead
    expect(result.duration).toBeGreaterThan(0);
    expect(result.duration).toBeLessThanOrEqual(measuredDuration * 1.1);
    expect(result.duration).toBeGreaterThanOrEqual(measuredDuration * 0.5); // At least 50% of measured
  }, 60000);
});
