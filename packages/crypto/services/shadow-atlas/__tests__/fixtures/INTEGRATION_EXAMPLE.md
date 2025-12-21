# Topology Fixtures Integration Example

**How to use these fixtures with the actual topology validator service**

## Quick Start

```typescript
import { describe, test, expect } from 'vitest';
import { PERFECT_TILING_FIXTURE, ALL_TOPOLOGY_FIXTURES } from './fixtures/topology-fixtures';
import { createValidationConfig } from './fixtures/topology-validation-types';
import { TopologyValidator } from '../services/topology-validator';

const validator = new TopologyValidator();

test('Perfect tiling passes validation', () => {
  const [parent, ...children] = PERFECT_TILING_FIXTURE.features;

  const config = createValidationConfig(parent, children, 'VTD');
  const result = validator.validate(config);

  expect(result.valid).toBe(true);
  expect(result.gapPercentage).toBe(0);
  expect(result.overlapPercentage).toBe(0);
});
```

## Implementation: Real Topology Validator

Here's what a production topology validator implementation looks like using these fixtures:

```typescript
// services/topology-validator.ts
import * as turf from '@turf/turf';
import type {
  TopologyValidator,
  TopologyValidationConfig,
  TopologyValidationResult,
  DetailedTopologyValidationResult,
  OverlapDetails,
  GapDetails,
} from '../__tests__/fixtures/topology-validation-types';

export class TurfTopologyValidator implements TopologyValidator {
  /**
   * Validate topology using REAL turf.js geometric operations
   * NO MOCKING - this validates actual polygon intersections, unions, and areas
   */
  validate(config: TopologyValidationConfig): TopologyValidationResult {
    const startTime = Date.now();
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Calculate parent area using REAL turf.area
    const parentArea = turf.area(config.parent);

    if (parentArea === 0) {
      errors.push('Parent feature has zero area');
      return this.createErrorResult(config, errors, warnings, startTime);
    }

    // 2. Calculate union of all children using REAL turf.union
    let childrenUnion: Feature<Polygon> | null = null;

    try {
      childrenUnion = config.children.reduce<Feature<Polygon> | null>(
        (union, child) => {
          if (!union) return child as Feature<Polygon>;
          const result = turf.union(turf.featureCollection([union, child as Feature<Polygon>]));
          return result as Feature<Polygon>;
        },
        null
      );
    } catch (error) {
      errors.push(`Failed to compute union of children: ${error.message}`);
      return this.createErrorResult(config, errors, warnings, startTime);
    }

    const childrenUnionArea = childrenUnion ? turf.area(childrenUnion) : 0;

    // 3. Calculate total area of children (including overlaps) using REAL turf.area
    const totalChildArea = config.children.reduce(
      (sum, child) => sum + turf.area(child),
      0
    );

    // 4. Calculate metrics
    const gapArea = Math.max(0, parentArea - childrenUnionArea);
    const gapPercentage = (gapArea / parentArea) * 100;

    const overlapArea = Math.max(0, totalChildArea - childrenUnionArea);
    const overlapPercentage = (overlapArea / parentArea) * 100;

    const totalCoverage = (childrenUnionArea / parentArea) * 100;

    // 5. Validate against thresholds
    if (gapPercentage > config.tolerance) {
      errors.push(
        `Gap ${gapPercentage.toFixed(4)}% exceeds tolerance ${config.tolerance}%`
      );
    }

    if (!config.allowOverlaps && overlapPercentage > config.tolerance) {
      errors.push(
        `Overlap ${overlapPercentage.toFixed(4)}% exceeds tolerance ${config.tolerance}% (layer type: ${config.layerType})`
      );
    }

    // 6. Warnings for edge cases
    if (totalCoverage < 90) {
      warnings.push(`Low coverage: ${totalCoverage.toFixed(2)}%`);
    }

    if (config.allowOverlaps && overlapPercentage > 50) {
      warnings.push(`High overlap: ${overlapPercentage.toFixed(2)}%`);
    }

    return {
      valid: errors.length === 0,
      gapPercentage,
      overlapPercentage,
      totalCoverage,
      parentArea,
      childrenUnionArea,
      overlapArea,
      gapArea,
      errors,
      warnings,
      metadata: {
        childCount: config.children.length,
        layerType: config.layerType,
        tolerance: config.tolerance,
        allowOverlaps: config.allowOverlaps ?? false,
        timestamp: startTime,
      },
    };
  }

  validateDetailed(config: TopologyValidationConfig): DetailedTopologyValidationResult {
    const baseResult = this.validate(config);

    // Calculate detailed overlap information
    const overlaps = this.computeOverlaps(config.children);
    const gaps = this.computeGaps(config.parent, config.children);

    // Find invalid features (e.g., zero area, invalid geometry)
    const invalidFeatures = config.children
      .filter(child => {
        try {
          const area = turf.area(child);
          return area === 0 || !Number.isFinite(area);
        } catch {
          return true;
        }
      })
      .map(child => ({
        geoid: child.properties?.GEOID ?? 'UNKNOWN',
        reason: 'Invalid geometry or zero area',
      }));

    return {
      ...baseResult,
      overlaps,
      gaps,
      invalidFeatures,
    };
  }

  validateOverlaps(children: readonly Feature<Polygon>[]): readonly OverlapDetails[] {
    const overlaps: OverlapDetails[] = [];

    // Check all pairs using REAL turf.intersect
    for (let i = 0; i < children.length; i++) {
      for (let j = i + 1; j < children.length; j++) {
        const childA = children[i];
        const childB = children[j];

        const intersection = turf.intersect(
          turf.featureCollection([childA, childB])
        );

        if (intersection) {
          const intersectionArea = turf.area(intersection);

          // Only report non-trivial overlaps (>0.0001 m²)
          if (intersectionArea > 0.0001) {
            overlaps.push({
              featureA: childA.properties?.GEOID ?? 'UNKNOWN',
              featureB: childB.properties?.GEOID ?? 'UNKNOWN',
              intersectionArea,
              overlapPercentage: 0, // Calculated against parent in full validation
              intersectionGeometry: intersection.geometry as Polygon,
            });
          }
        }
      }
    }

    return overlaps;
  }

  validateGaps(
    parent: Feature<Polygon>,
    children: readonly Feature<Polygon>[]
  ): readonly GapDetails[] {
    // Union all children
    const childrenUnion = children.reduce<Feature<Polygon> | null>(
      (union, child) => {
        if (!union) return child as Feature<Polygon>;
        return turf.union(turf.featureCollection([union, child as Feature<Polygon>])) as Feature<Polygon>;
      },
      null
    );

    if (!childrenUnion) {
      return [{
        gapArea: turf.area(parent),
        gapPercentage: 100,
        gapGeometry: parent.geometry,
      }];
    }

    // Calculate gap using REAL turf.difference
    const gap = turf.difference(
      turf.featureCollection([parent, childrenUnion])
    );

    if (!gap) {
      return []; // No gap
    }

    const gapArea = turf.area(gap);
    const parentArea = turf.area(parent);
    const gapPercentage = (gapArea / parentArea) * 100;

    return [{
      gapArea,
      gapPercentage,
      gapGeometry: gap.geometry as Polygon,
    }];
  }

  private computeOverlaps(children: readonly Feature<Polygon>[]): readonly OverlapDetails[] {
    return this.validateOverlaps(children);
  }

  private computeGaps(
    parent: Feature<Polygon>,
    children: readonly Feature<Polygon>[]
  ): readonly GapDetails[] {
    return this.validateGaps(parent, children);
  }

  private createErrorResult(
    config: TopologyValidationConfig,
    errors: string[],
    warnings: string[],
    timestamp: number
  ): TopologyValidationResult {
    return {
      valid: false,
      gapPercentage: 0,
      overlapPercentage: 0,
      totalCoverage: 0,
      parentArea: 0,
      childrenUnionArea: 0,
      overlapArea: 0,
      gapArea: 0,
      errors,
      warnings,
      metadata: {
        childCount: config.children.length,
        layerType: config.layerType,
        tolerance: config.tolerance,
        allowOverlaps: config.allowOverlaps ?? false,
        timestamp,
      },
    };
  }
}
```

## Test Suite Using Fixtures

```typescript
// services/topology-validator.test.ts
import { describe, test, expect, beforeEach } from 'vitest';
import {
  PERFECT_TILING_FIXTURE,
  GAP_DETECTED_FIXTURE,
  OVERLAP_DETECTED_FIXTURE,
  VALID_OVERLAP_FIXTURE,
  ALL_TOPOLOGY_FIXTURES,
} from '../__tests__/fixtures/topology-fixtures';
import {
  createValidationConfig,
  formatValidationResult,
  VALIDATION_CONSTANTS,
} from '../__tests__/fixtures/topology-validation-types';
import { TurfTopologyValidator } from './topology-validator';

describe('TurfTopologyValidator', () => {
  let validator: TurfTopologyValidator;

  beforeEach(() => {
    validator = new TurfTopologyValidator();
  });

  describe('validate()', () => {
    test('perfect tiling fixture passes', () => {
      const [parent, ...children] = PERFECT_TILING_FIXTURE.features;
      const config = createValidationConfig(parent, children, 'VTD');

      const result = validator.validate(config);

      expect(result.valid).toBe(true);
      expect(result.gapPercentage).toBeLessThan(VALIDATION_CONSTANTS.MAX_GAP_PERCENTAGE);
      expect(result.overlapPercentage).toBeLessThan(VALIDATION_CONSTANTS.MAX_OVERLAP_PERCENTAGE);
      expect(result.totalCoverage).toBeGreaterThan(VALIDATION_CONSTANTS.MIN_COVERAGE_PERCENTAGE);
      expect(result.errors).toHaveLength(0);
    });

    test('gap detected fixture fails', () => {
      const [parent, ...children] = GAP_DETECTED_FIXTURE.features;
      const config = createValidationConfig(parent, children, 'VTD');

      const result = validator.validate(config);

      expect(result.valid).toBe(false);
      expect(result.gapPercentage).toBeGreaterThan(VALIDATION_CONSTANTS.MAX_GAP_PERCENTAGE);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Gap');
    });

    test('overlap detected fixture fails for tiling layer', () => {
      const [parent, ...children] = OVERLAP_DETECTED_FIXTURE.features;
      const config = createValidationConfig(parent, children, 'VTD');

      const result = validator.validate(config);

      expect(result.valid).toBe(false);
      expect(result.overlapPercentage).toBeGreaterThan(VALIDATION_CONSTANTS.MAX_OVERLAP_PERCENTAGE);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Overlap');
    });

    test('valid overlap fixture passes for non-tiling layer', () => {
      const [parent, ...children] = VALID_OVERLAP_FIXTURE.features;
      const config = createValidationConfig(parent, children, 'PLACE');

      const result = validator.validate(config);

      expect(result.valid).toBe(true);
      expect(result.overlapPercentage).toBeGreaterThan(0); // Has overlaps
      expect(result.errors).toHaveLength(0); // But no errors for PLACE layer
    });
  });

  describe('validateDetailed()', () => {
    test('provides overlap details for overlapping features', () => {
      const [parent, ...children] = OVERLAP_DETECTED_FIXTURE.features;
      const config = createValidationConfig(parent, children, 'VTD');

      const result = validator.validateDetailed(config);

      expect(result.overlaps.length).toBeGreaterThan(0);
      expect(result.overlaps[0].featureA).toBeTruthy();
      expect(result.overlaps[0].featureB).toBeTruthy();
      expect(result.overlaps[0].intersectionArea).toBeGreaterThan(0);
      expect(result.overlaps[0].intersectionGeometry).toBeDefined();
    });

    test('provides gap details for incomplete coverage', () => {
      const [parent, ...children] = GAP_DETECTED_FIXTURE.features;
      const config = createValidationConfig(parent, children, 'VTD');

      const result = validator.validateDetailed(config);

      expect(result.gaps.length).toBeGreaterThan(0);
      expect(result.gaps[0].gapArea).toBeGreaterThan(0);
      expect(result.gaps[0].gapPercentage).toBeGreaterThan(0);
      expect(result.gaps[0].gapGeometry).toBeDefined();
    });
  });

  describe('validateOverlaps()', () => {
    test('detects overlaps between features', () => {
      const [, ...children] = OVERLAP_DETECTED_FIXTURE.features;

      const overlaps = validator.validateOverlaps(children);

      expect(overlaps.length).toBeGreaterThan(0);
      expect(overlaps[0].intersectionArea).toBeGreaterThan(0);
    });

    test('returns empty array for non-overlapping features', () => {
      const [, ...children] = PERFECT_TILING_FIXTURE.features;

      const overlaps = validator.validateOverlaps(children);

      // Perfect tiling may have microscopic overlaps at edges (shared borders)
      // but they should be negligible (<0.0001 m²)
      const significantOverlaps = overlaps.filter(o => o.intersectionArea > 0.0001);
      expect(significantOverlaps).toHaveLength(0);
    });
  });

  describe('validateGaps()', () => {
    test('detects gaps in coverage', () => {
      const [parent, ...children] = GAP_DETECTED_FIXTURE.features;

      const gaps = validator.validateGaps(parent, children);

      expect(gaps.length).toBeGreaterThan(0);
      expect(gaps[0].gapArea).toBeGreaterThan(0);
      expect(gaps[0].gapPercentage).toBeGreaterThan(0);
    });

    test('returns empty array for perfect coverage', () => {
      const [parent, ...children] = PERFECT_TILING_FIXTURE.features;

      const gaps = validator.validateGaps(parent, children);

      // Perfect tiling may have microscopic gaps from floating-point precision
      const significantGaps = gaps.filter(g => g.gapPercentage > 0.001);
      expect(significantGaps).toHaveLength(0);
    });
  });

  describe('Parameterized tests across all fixtures', () => {
    test.each(ALL_TOPOLOGY_FIXTURES)(
      '$name - should $expectedOutcome',
      ({ fixture, expectedOutcome, layerType, tilingExpected }) => {
        const [parent, ...children] = fixture.features;
        const config = createValidationConfig(parent, children, layerType, {
          allowOverlaps: !tilingExpected,
        });

        const result = validator.validate(config);

        if (expectedOutcome === 'PASS') {
          expect(result.valid).toBe(true);
        } else {
          expect(result.valid).toBe(false);
        }

        // Log validation result for debugging
        console.log(formatValidationResult(result));
      }
    );
  });
});
```

## Integration with Shadow Atlas Pipeline

```typescript
// core/shadow-atlas-service.ts
import type { Feature, Polygon } from 'geojson';
import { TurfTopologyValidator } from '../services/topology-validator';
import { createValidationConfig } from '../__tests__/fixtures/topology-validation-types';
import type { LayerType } from '../__tests__/fixtures/topology-validation-types';

export class ShadowAtlasService {
  private topologyValidator = new TurfTopologyValidator();

  /**
   * Validate topology for a specific layer within a county
   */
  async validateLayerTopology(
    countyGEOID: string,
    layerType: LayerType
  ): Promise<void> {
    // 1. Load county geometry from TIGER data
    const countyFeature = await this.loadCountyGeometry(countyGEOID);

    // 2. Load child layer features (VTDs, COUSUBs, etc.)
    const childFeatures = await this.loadChildLayerFeatures(countyGEOID, layerType);

    // 3. Validate topology using REAL geometric operations
    const config = createValidationConfig(countyFeature, childFeatures, layerType);
    const result = this.topologyValidator.validateDetailed(config);

    // 4. Log validation results
    console.log(formatValidationResult(result));

    // 5. Store validation report
    if (!result.valid) {
      await this.storeValidationReport(countyGEOID, layerType, result);
    }

    // 6. Throw error if validation fails (strict mode)
    if (!result.valid && this.strictMode) {
      throw new Error(
        `Topology validation failed for ${countyGEOID} ${layerType}: ${result.errors.join(', ')}`
      );
    }
  }

  private async loadCountyGeometry(geoid: string): Promise<Feature<Polygon>> {
    // Load from TIGER Shapefile or cached GeoJSON
    // ...
  }

  private async loadChildLayerFeatures(
    countyGEOID: string,
    layerType: LayerType
  ): Promise<Feature<Polygon>[]> {
    // Load from TIGER Shapefile or cached GeoJSON
    // ...
  }

  private async storeValidationReport(
    countyGEOID: string,
    layerType: LayerType,
    result: DetailedTopologyValidationResult
  ): Promise<void> {
    // Store in database or file system
    // ...
  }
}
```

## Key Takeaways

1. **Zero Mocking**: Validator uses REAL turf.js operations (`area`, `union`, `intersect`, `difference`)
2. **Type Safety**: TypeScript interfaces ensure type-safe integration
3. **Test Fixtures**: Provide predictable geometries for validation logic testing
4. **Production Ready**: Same validator works with test fixtures AND real TIGER data
5. **Detailed Diagnostics**: Overlap/gap geometries help debug topology issues

---

**If these tests pass, your topology validator correctly handles real geometric operations. If they fail, fix the validator or the geometry—not the mocks.**
