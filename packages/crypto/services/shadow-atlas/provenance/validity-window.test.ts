/**
 * Validity Window Tests - WP-FRESHNESS-2
 *
 * Tests for validity window calculation and confidence decay logic.
 * Verifies redistricting-aware confidence, TIGER release cycles, and
 * primary source validity periods.
 */

import { describe, it, expect } from 'vitest';
import {
  DefaultValidityWindowCalculator,
  calculateValidityWindow,
  computeConfidence,
  isInRedistrictingGap,
  getRedistrictingConfidenceFactor,
  type ValidityWindow,
  type BoundaryType,
  type SourceType,
} from './validity-window.js';

describe('ValidityWindowCalculator', () => {
  const calculator = new DefaultValidityWindowCalculator();

  describe('calculateWindow - TIGER sources', () => {
    it('should create 12-month validity window for TIGER', () => {
      const releaseDate = new Date('2023-07-15');
      const window = calculator.calculateWindow(
        'tiger',
        releaseDate,
        'congressional'
      );

      expect(window.sourceType).toBe('tiger');
      expect(window.validFrom.getUTCFullYear()).toBe(2023);
      expect(window.validFrom.getUTCMonth()).toBe(6); // July (0-indexed)
      expect(window.validUntil.getUTCFullYear()).toBe(2024);
      expect(window.validUntil.getUTCMonth()).toBe(6); // July
    });

    it('should use current year for TIGER URL generation', () => {
      const releaseDate = new Date('2024-07-01');
      const window = calculator.calculateWindow(
        'tiger',
        releaseDate,
        'state_senate'
      );

      expect(window.sourceId).toContain('tiger');
      expect(window.sourceId).toContain('state_senate');
      expect(window.sourceId).toContain('2024');
    });
  });

  describe('calculateWindow - Primary sources', () => {
    it('should create long validity window for primary sources', () => {
      const releaseDate = new Date('2022-01-01');
      const window = calculator.calculateWindow(
        'primary',
        releaseDate,
        'congressional'
      );

      expect(window.sourceType).toBe('primary');
      expect(window.confidence).toBe(1.0); // Primary always 1.0
      // Primary sources valid until next redistricting
      // From 2022, next redistricting year is 2031 (year ending in 1)
      // But if we're past redistricting, might be earlier - at minimum should be in 2020s or 2030s
      expect(window.validUntil.getUTCFullYear()).toBeGreaterThanOrEqual(2030);
    });

    it('should always have confidence 1.0 for primary sources', () => {
      const releaseDate = new Date('2022-06-15');
      const window = calculator.calculateWindow(
        'primary',
        releaseDate,
        'state_house'
      );

      expect(window.confidence).toBe(1.0);
    });
  });

  describe('computeConfidence', () => {
    it('should return 0 for expired windows', () => {
      const window: ValidityWindow = {
        sourceId: 'test',
        sourceType: 'tiger',
        validFrom: new Date('2022-07-01'),
        validUntil: new Date('2023-07-01'),
        confidence: 1.0,
      };

      // Check confidence after expiration
      const confidence = calculator.computeConfidence(
        window,
        new Date('2024-01-01')
      );
      expect(confidence).toBe(0.0);
    });

    it('should return 0 for not-yet-valid windows', () => {
      const window: ValidityWindow = {
        sourceId: 'test',
        sourceType: 'tiger',
        validFrom: new Date('2025-07-01'),
        validUntil: new Date('2026-07-01'),
        confidence: 1.0,
      };

      // Check confidence before valid
      const confidence = calculator.computeConfidence(
        window,
        new Date('2025-01-01')
      );
      expect(confidence).toBe(0.0);
    });

    it('should return 1.0 for primary sources regardless of time', () => {
      const window: ValidityWindow = {
        sourceId: 'test',
        sourceType: 'primary',
        validFrom: new Date('2022-01-01'),
        validUntil: new Date('2031-01-01'),
        confidence: 1.0,
      };

      // Even at 90% through window, primary is still 1.0
      const confidence = calculator.computeConfidence(
        window,
        new Date('2029-06-01')
      );
      expect(confidence).toBe(1.0);
    });

    it('should decay confidence for TIGER in last 25% of window', () => {
      const window: ValidityWindow = {
        sourceId: 'test',
        sourceType: 'tiger',
        validFrom: new Date('2023-07-01'),
        validUntil: new Date('2024-07-01'),
        confidence: 1.0,
      };

      // At 50% through window - should be 1.0
      const midConfidence = calculator.computeConfidence(
        window,
        new Date('2024-01-01')
      );
      expect(midConfidence).toBe(1.0);

      // At 90% through window - should be less than 1.0
      const lateConfidence = calculator.computeConfidence(
        window,
        new Date('2024-06-01')
      );
      expect(lateConfidence).toBeLessThan(1.0);
      expect(lateConfidence).toBeGreaterThan(0.4); // Minimum is 0.4
    });
  });

  describe('isInRedistrictingGap', () => {
    it('should return true during Jan-Jun 2022', () => {
      expect(calculator.isInRedistrictingGap(new Date('2022-01-15'))).toBe(
        true
      );
      expect(calculator.isInRedistrictingGap(new Date('2022-03-15'))).toBe(
        true
      );
      expect(calculator.isInRedistrictingGap(new Date('2022-06-15'))).toBe(
        true
      );
    });

    it('should return false after July 2022', () => {
      expect(calculator.isInRedistrictingGap(new Date('2022-07-15'))).toBe(
        false
      );
      expect(calculator.isInRedistrictingGap(new Date('2022-12-15'))).toBe(
        false
      );
    });

    it('should return true during Jan-Jun 2032', () => {
      expect(calculator.isInRedistrictingGap(new Date('2032-02-15'))).toBe(
        true
      );
      expect(calculator.isInRedistrictingGap(new Date('2032-05-15'))).toBe(
        true
      );
    });

    it('should return false in non-redistricting years', () => {
      expect(calculator.isInRedistrictingGap(new Date('2023-03-15'))).toBe(
        false
      );
      expect(calculator.isInRedistrictingGap(new Date('2025-01-15'))).toBe(
        false
      );
    });

    it('should return false in 2021 (first year of redistricting cycle)', () => {
      // 2021 is year ending in 1, not year ending in 2, so not in gap
      expect(calculator.isInRedistrictingGap(new Date('2021-03-15'))).toBe(
        false
      );
    });
  });

  describe('getRedistrictingConfidenceFactor', () => {
    it('should return 0.3 for congressional during gap', () => {
      const factor = calculator.getRedistrictingConfidenceFactor(
        'congressional',
        new Date('2022-03-15')
      );
      expect(factor).toBe(0.3);
    });

    it('should return 0.3 for state_senate during gap', () => {
      const factor = calculator.getRedistrictingConfidenceFactor(
        'state_senate',
        new Date('2022-03-15')
      );
      expect(factor).toBe(0.3);
    });

    it('should return 0.3 for state_house during gap', () => {
      const factor = calculator.getRedistrictingConfidenceFactor(
        'state_house',
        new Date('2022-03-15')
      );
      expect(factor).toBe(0.3);
    });

    it('should return 0.6 for voting_precinct during gap', () => {
      const factor = calculator.getRedistrictingConfidenceFactor(
        'voting_precinct',
        new Date('2022-03-15')
      );
      expect(factor).toBe(0.6);
    });

    it('should return 0.8 for county during gap', () => {
      const factor = calculator.getRedistrictingConfidenceFactor(
        'county',
        new Date('2022-03-15')
      );
      expect(factor).toBe(0.8);
    });

    it('should return 1.0 outside gap period', () => {
      const factor = calculator.getRedistrictingConfidenceFactor(
        'congressional',
        new Date('2023-03-15')
      );
      expect(factor).toBe(1.0);
    });
  });

  describe('TIGER confidence during redistricting years', () => {
    it('should return 0.3 during gap period (Jan-Jun of year ending in 2)', () => {
      const window: ValidityWindow = {
        sourceId: 'tiger-congressional-2021',
        sourceType: 'tiger',
        validFrom: new Date('2021-07-01'),
        validUntil: new Date('2022-07-01'),
        confidence: 1.0,
      };

      // During gap period (March 2022)
      const confidence = calculator.computeConfidence(
        window,
        new Date('2022-03-15')
      );
      expect(confidence).toBe(0.3);
    });

    it('should return 0.5 during first redistricting year (year ending in 1)', () => {
      const window: ValidityWindow = {
        sourceId: 'tiger-congressional-2020',
        sourceType: 'tiger',
        validFrom: new Date('2020-07-01'),
        validUntil: new Date('2021-07-01'),
        confidence: 1.0,
      };

      // During first redistricting year (March 2021)
      const confidence = calculator.computeConfidence(
        window,
        new Date('2021-03-15')
      );
      expect(confidence).toBe(0.5);
    });

    it('should return 0.9 after July update in second redistricting year', () => {
      const window: ValidityWindow = {
        sourceId: 'tiger-congressional-2022',
        sourceType: 'tiger',
        validFrom: new Date('2022-07-01'),
        validUntil: new Date('2023-07-01'),
        confidence: 1.0,
      };

      // After July 2022 update
      const confidence = calculator.computeConfidence(
        window,
        new Date('2022-09-15')
      );
      expect(confidence).toBe(0.9);
    });
  });

  describe('Helper functions', () => {
    it('calculateValidityWindow should use default calculator', () => {
      const window = calculateValidityWindow(
        'tiger',
        new Date('2023-07-01'),
        'congressional'
      );
      expect(window).toBeDefined();
      expect(window.sourceType).toBe('tiger');
    });

    it('computeConfidence should use default calculator', () => {
      const window: ValidityWindow = {
        sourceId: 'test',
        sourceType: 'primary',
        validFrom: new Date('2022-01-01'),
        validUntil: new Date('2031-01-01'),
        confidence: 1.0,
      };
      const confidence = computeConfidence(window, new Date('2025-01-01'));
      expect(confidence).toBe(1.0);
    });

    it('isInRedistrictingGap should use default calculator', () => {
      expect(isInRedistrictingGap(new Date('2022-03-15'))).toBe(true);
      expect(isInRedistrictingGap(new Date('2023-03-15'))).toBe(false);
    });

    it('getRedistrictingConfidenceFactor should use default calculator', () => {
      const factor = getRedistrictingConfidenceFactor(
        'congressional',
        new Date('2022-03-15')
      );
      expect(factor).toBe(0.3);
    });
  });

  describe('Edge cases', () => {
    it('should handle boundary at exact validFrom date', () => {
      const window: ValidityWindow = {
        sourceId: 'test',
        sourceType: 'tiger',
        validFrom: new Date('2023-07-01T00:00:00Z'),
        validUntil: new Date('2024-07-01T00:00:00Z'),
        confidence: 1.0,
      };

      const confidence = calculator.computeConfidence(
        window,
        new Date('2023-07-01T00:00:00Z')
      );
      // Should be valid at exact start
      expect(confidence).toBeGreaterThan(0);
    });

    it('should handle boundary at exact validUntil date', () => {
      const window: ValidityWindow = {
        sourceId: 'test',
        sourceType: 'tiger',
        validFrom: new Date('2023-07-01T00:00:00Z'),
        validUntil: new Date('2024-07-01T00:00:00Z'),
        confidence: 1.0,
      };

      const confidence = calculator.computeConfidence(
        window,
        new Date('2024-07-01T00:00:00Z')
      );
      // Should be expired at exact end
      expect(confidence).toBe(0);
    });

    it('should handle aggregator type (same as tiger)', () => {
      const window = calculator.calculateWindow(
        'aggregator',
        new Date('2023-07-01'),
        'congressional'
      );
      // Aggregators follow TIGER-like behavior
      expect(window.sourceType).toBe('tiger');
    });
  });
});
