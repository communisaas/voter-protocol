/**
 * Redistricting Gap Detector Integration Tests - WP-GAP-1
 *
 * Tests for the integration of RedistrictingGapDetector into the TIGERValidator.
 * Verifies that legislative layer validation (cd, sldu, sldl) properly detects
 * redistricting gaps and produces warnings without failing validation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TIGERValidator } from '../../../validators/tiger/validator.js';
import type { TIGERLayerType } from '../../../core/types.js';
import type { Polygon } from 'geojson';

/**
 * Create a minimal valid boundary for testing
 */
function createTestBoundary(geoid: string, name: string): {
  readonly geoid: string;
  readonly name: string;
  readonly geometry: Polygon;
  readonly properties: Record<string, unknown>;
} {
  return {
    geoid,
    name,
    geometry: {
      type: 'Polygon' as const,
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
      GEOID: geoid,
      NAME: name,
      STATEFP: geoid.substring(0, 2),
      NAMELSAD: name,
    },
  };
}

describe('TIGERValidator - Redistricting Gap Integration', () => {
  let validator: TIGERValidator;

  beforeEach(() => {
    validator = new TIGERValidator();
  });

  describe('Gap detection for legislative layers', () => {
    const legislativeLayers: TIGERLayerType[] = ['cd', 'sldu', 'sldl'];

    it.each(legislativeLayers)(
      'should check for redistricting gaps on %s layer',
      (layer) => {
        // Create a boundary for California (FIPS 06)
        const boundaries = [createTestBoundary('0601', 'Test District 1')];

        // Use a date that's NOT in a gap period (2024)
        const result = validator.validate(layer, boundaries, '06', new Date('2024-06-15'));

        // Should not have gap warning outside gap period
        expect(result.redistrictingGapWarning).toBeUndefined();
        expect(result.warnings).toBeUndefined();
      }
    );

    it.each(legislativeLayers)(
      'should detect gap during redistricting period for %s layer',
      (layer) => {
        // Create appropriate boundaries for each layer
        let boundaries;
        let stateFips: string;

        if (layer === 'cd') {
          // CD uses 4-digit GEOID (SSDD)
          boundaries = [createTestBoundary('0601', 'California 1st Congressional District')];
          stateFips = '06';
        } else {
          // SLDU/SLDL use 5-digit GEOID (SSDDD)
          boundaries = [createTestBoundary('06001', 'California District 1')];
          stateFips = '06';
        }

        // Use a date IN the gap period (Jan-Jun 2022)
        const result = validator.validate(layer, boundaries, stateFips, new Date('2022-03-15'));

        // Should have gap warning during gap period
        expect(result.redistrictingGapWarning).toBeDefined();
        expect(result.redistrictingGapWarning?.gapStatus.inGap).toBe(true);
        expect(result.redistrictingGapWarning?.gapStatus.recommendation).toBe('use-primary');
        expect(result.warnings).toBeDefined();
        expect(result.warnings?.length).toBeGreaterThan(0);

        // Validation should NOT fail (gap is a warning, not an error)
        // Quality score should still be calculated normally
        expect(result.qualityScore).toBeGreaterThanOrEqual(0);

        // Summary should include gap warning
        expect(result.summary).toContain('[WARNING]');
        expect(result.summary).toContain('Redistricting gap detected');
      }
    );

    it('should detect gap for Texas during 2022 gap period', () => {
      const boundaries = [createTestBoundary('4801', 'Texas 1st Congressional District')];

      const result = validator.validate('cd', boundaries, '48', new Date('2022-04-15'));

      expect(result.redistrictingGapWarning).toBeDefined();
      expect(result.redistrictingGapWarning?.gapStatus.inGap).toBe(true);
      // TX has court challenges noted in finalization info
      expect(result.redistrictingGapWarning?.gapStatus.finalizationInfo?.courtChallenges).toBe(true);
    });

    it('should NOT detect gap for NY before effective date', () => {
      // NY effective June 28, 2022 - check before that date
      const boundaries = [createTestBoundary('3601', 'New York 1st Congressional District')];

      // Before NY effective date (June 28, 2022)
      const result = validator.validate('cd', boundaries, '36', new Date('2022-03-15'));

      // NY should NOT be in gap yet (maps not effective until June 28)
      expect(result.redistrictingGapWarning).toBeUndefined();
    });

    it('should detect gap for NY after effective date', () => {
      const boundaries = [createTestBoundary('3601', 'New York 1st Congressional District')];

      // After NY effective date (June 28, 2022)
      const result = validator.validate('cd', boundaries, '36', new Date('2022-06-29'));

      // NY should now be in gap
      expect(result.redistrictingGapWarning).toBeDefined();
      expect(result.redistrictingGapWarning?.gapStatus.inGap).toBe(true);
    });
  });

  describe('Non-legislative layers', () => {
    const nonLegislativeLayers: TIGERLayerType[] = ['county', 'place', 'unsd', 'vtd'];

    it.each(nonLegislativeLayers)(
      'should NOT check for gaps on %s layer',
      (layer) => {
        // Create appropriate boundaries for the layer type
        let boundary;
        const stateFips = '06';

        switch (layer) {
          case 'county':
            // County uses 5-digit GEOID (SSCCC)
            boundary = createTestBoundary('06001', 'Alameda County');
            break;
          case 'place':
            // Place uses 7-digit GEOID (SSPPPPP)
            boundary = createTestBoundary('0668000', 'San Francisco');
            break;
          case 'unsd':
            // UNSD uses 7-digit GEOID (SSLLLLL)
            boundary = createTestBoundary('0600001', 'Test School District');
            break;
          case 'vtd':
            // VTD uses 11-char GEOID (SSCCCVVVVVV)
            boundary = createTestBoundary('06001000001', 'Precinct 1');
            break;
          default:
            boundary = createTestBoundary('0600001', 'Test Boundary');
        }

        // Use a date IN the gap period - should still not affect non-legislative
        const result = validator.validate(layer, [boundary], stateFips, new Date('2022-03-15'));

        // Non-legislative layers should never have gap warnings
        expect(result.redistrictingGapWarning).toBeUndefined();
      }
    );
  });

  describe('Validation without stateFips', () => {
    it('should skip gap check when stateFips is not provided', () => {
      const boundaries = [createTestBoundary('0601', 'Test District')];

      // No stateFips provided (undefined)
      const result = validator.validate('cd', boundaries, undefined, new Date('2022-03-15'));

      // Gap check requires stateFips, so no warning
      expect(result.redistrictingGapWarning).toBeUndefined();
    });
  });

  describe('Post-TIGER update period', () => {
    it('should NOT detect gap after July 2022', () => {
      const boundaries = [createTestBoundary('0601', 'California 1st Congressional District')];

      // After TIGER update (July 2022)
      const result = validator.validate('cd', boundaries, '06', new Date('2022-09-15'));

      // Should not have gap warning after TIGER updates
      expect(result.redistrictingGapWarning).toBeUndefined();
    });
  });

  describe('Future redistricting cycles', () => {
    it('should NOT detect gap during 2032 for unknown finalization dates', () => {
      const boundaries = [createTestBoundary('0601', 'California 1st Congressional District')];

      // 2030 cycle doesn't have finalization dates yet
      const result = validator.validate('cd', boundaries, '06', new Date('2032-03-15'));

      // The detector returns pre-finalization status for unknown states
      // This is expected behavior - we don't have future finalization data
      expect(result.redistrictingGapWarning).toBeUndefined();
    });
  });

  describe('Gap warning content', () => {
    it('should include proper recommendation in warning', () => {
      const boundaries = [createTestBoundary('0601', 'California 1st Congressional District')];

      const result = validator.validate('cd', boundaries, '06', new Date('2022-03-15'));

      expect(result.redistrictingGapWarning).toBeDefined();
      expect(result.redistrictingGapWarning?.recommendation).toContain('California');
      expect(result.redistrictingGapWarning?.recommendation).toContain('primary source');
    });

    it('should include TIGER staleness in reasoning', () => {
      const boundaries = [createTestBoundary('0601', 'California 1st Congressional District')];

      const result = validator.validate('cd', boundaries, '06', new Date('2022-03-15'));

      expect(result.redistrictingGapWarning).toBeDefined();
      expect(result.redistrictingGapWarning?.gapStatus.reasoning).toContain('stale');
      expect(result.redistrictingGapWarning?.gapStatus.reasoning).toContain('2022-07-15');
    });
  });

  describe('Validation result structure', () => {
    it('should preserve all validation fields when gap is detected', () => {
      const boundaries = [createTestBoundary('0601', 'California 1st Congressional District')];

      const result = validator.validate('cd', boundaries, '06', new Date('2022-03-15'));

      // All standard fields should be present
      expect(result.layer).toBe('cd');
      expect(result.stateFips).toBe('06');
      expect(result.qualityScore).toBeDefined();
      expect(result.completeness).toBeDefined();
      expect(result.topology).toBeDefined();
      expect(result.coordinates).toBeDefined();
      expect(result.validatedAt).toBeInstanceOf(Date);
      expect(result.summary).toBeDefined();

      // Gap warning should be present
      expect(result.redistrictingGapWarning).toBeDefined();
      expect(result.warnings).toBeDefined();
    });

    it('should NOT include optional fields when no gap is detected', () => {
      const boundaries = [createTestBoundary('0601', 'California 1st Congressional District')];

      const result = validator.validate('cd', boundaries, '06', new Date('2024-03-15'));

      // Standard fields present
      expect(result.layer).toBe('cd');

      // Optional gap-related fields should be absent
      expect(result.redistrictingGapWarning).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });
  });

  describe('Layer to boundary type mapping', () => {
    it('should correctly map cd layer to congressional', () => {
      const boundaries = [createTestBoundary('0601', 'California 1st Congressional District')];
      const result = validator.validate('cd', boundaries, '06', new Date('2022-03-15'));

      expect(result.redistrictingGapWarning?.gapStatus.gapType).toBe('post-finalization-pre-tiger');
    });

    it('should correctly map sldu layer to state_senate', () => {
      const boundaries = [createTestBoundary('06001', 'California State Senate District 1')];
      const result = validator.validate('sldu', boundaries, '06', new Date('2022-03-15'));

      expect(result.redistrictingGapWarning?.gapStatus.gapType).toBe('post-finalization-pre-tiger');
    });

    it('should correctly map sldl layer to state_house', () => {
      const boundaries = [createTestBoundary('06001', 'California State Assembly District 1')];
      const result = validator.validate('sldl', boundaries, '06', new Date('2022-03-15'));

      expect(result.redistrictingGapWarning?.gapStatus.gapType).toBe('post-finalization-pre-tiger');
    });
  });

  describe('State finalization info', () => {
    it('should include finalization info in gap status', () => {
      const boundaries = [createTestBoundary('0601', 'California 1st Congressional District')];

      const result = validator.validate('cd', boundaries, '06', new Date('2022-03-15'));

      expect(result.redistrictingGapWarning?.gapStatus.finalizationInfo).toBeDefined();
      expect(result.redistrictingGapWarning?.gapStatus.finalizationInfo?.stateCode).toBe('CA');
      expect(result.redistrictingGapWarning?.gapStatus.finalizationInfo?.state).toBe('California');
    });

    it('should note court challenges for affected states', () => {
      // Texas had court challenges
      const boundaries = [createTestBoundary('4801', 'Texas 1st Congressional District')];
      const result = validator.validate('cd', boundaries, '48', new Date('2022-03-15'));

      expect(result.redistrictingGapWarning?.gapStatus.finalizationInfo?.courtChallenges).toBe(true);
      expect(result.redistrictingGapWarning?.gapStatus.finalizationInfo?.notes).toContain('Voting Rights Act');
    });

    it('should not note court challenges for unaffected states', () => {
      // California did not have court challenges
      const boundaries = [createTestBoundary('0601', 'California 1st Congressional District')];
      const result = validator.validate('cd', boundaries, '06', new Date('2022-03-15'));

      expect(result.redistrictingGapWarning?.gapStatus.finalizationInfo?.courtChallenges).toBe(false);
    });
  });
});
